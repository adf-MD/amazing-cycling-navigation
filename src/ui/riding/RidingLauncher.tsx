import { useTranslate } from "../../i18n/useTranslate.ts";
import type { ParameterlessMessageKey, Translator } from "../../i18n/translate.ts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PlannedRoute } from "../../domain/types.ts";
import { logError } from "../../platform/errorLog.ts";
import {
  isStoredFreeRoamRideState,
  isStoredRouteRideState,
} from "../../storage/mapping.ts";
import {
  clearActiveRideStateIfSession,
  getActiveRideStateWithSessionId,
} from "../../storage/rideStateRepository.ts";
import { getRoute } from "../../storage/routesRepository.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { formatAscent, formatDistanceKm } from "../shared/routeSummary.ts";

export interface RidingLauncherProps {
  /** Selects the resumed route and opens it into RidingScreen — mirrors
   * App.tsx's existing onOpenRoute-driven handlers' shape. This component
   * itself still never starts geolocation — App.tsx pairs this call with a
   * one-use resume intent (backlog item 72) that RidingScreen consumes only
   * once its own restoration has genuinely completed, starting GPS and
   * requesting Follow in the same tap that presses "Resume ride" here.
   * App.tsx also re-validates this against current storage at click time
   * (backlog item 73) before honouring the resume intent at all. */
  onResumeRoute: (route: PlannedRoute) => void;
  onChooseRoute: () => void;
  /** Fired by the "Start free roam" button. Unlike the old shared
   * onOpenFreeRoam callback, this component no longer persists anything
   * itself — App.tsx's own unfinished-session switch guard (backlog item
   * 73) owns writing the fresh session row, since that write must not
   * happen until the guard has confirmed there's nothing to silently
   * overwrite. isFreeRoamPending/freeRoamError reflect that work's
   * progress back down to this button. */
  onStartFreeRoam: () => void;
  /** Fired by the "Resume free roam" button — the persisted row already
   * exists, so unlike onStartFreeRoam this never writes anything; App.tsx
   * still re-validates against current storage first (backlog item 73)
   * before genuinely resuming it. */
  onResumeFreeRoam: () => void;
  /** True while App.tsx's guard/write for either free-roam action is in
   * flight — disables both free-roam buttons and shows a pending label. */
  isFreeRoamPending?: boolean;
  /** Set by App.tsx when a free-roam start/resume attempt failed (a guard
   * check or the fresh-session write) — rendered as an accessible error
   * beneath whichever free-roam button is currently showing. */
  freeRoamError?: string | null;
  /** Bumped by App.tsx once, immediately after any confirmed different-
   * session switch (backlog item 73) has successfully cleared storage —
   * re-triggers this component's own hydration so it never continues
   * showing a session that was just deliberately ended out from under it. */
  sessionRefreshToken?: number;
  /** Called once per successful check of the stored session (backlog item
   * 132) — with the route when the session is a resumable route ride,
   * otherwise with null (no session, free roam, a missing route or an
   * unsupported kind). Returning true means the owner is replacing this
   * launcher with that route's own screen, so the launcher keeps its
   * checking status rather than flashing its summary first; returning
   * false renders every branch exactly as before. A failed read never
   * calls it, so the failure and its Retry are unchanged, and a check that
   * settles after this launcher has unmounted is discarded by the
   * generation guard below before it can call it. Must keep a stable
   * identity: it is a dependency of the hydration effect. */
  onSessionChecked?: (route: PlannedRoute | null) => boolean;
}

type RidingLauncherHydrationStatus = "loading" | "ready" | "failed";

/** Every stored session shown carries the identity it was read with
 * (backlog item 140), which an End ride or Discard confirmation keeps. */
type RidingLauncherSessionState =
  | { status: "none" }
  | { status: "resumable-route"; route: PlannedRoute; sessionId: string }
  | { status: "resumable-free-roam"; sessionId: string }
  | {
      status: "unresumable";
      reason: "route-missing" | "unsupported-kind";
      sessionId: string;
    };

const NONE_SESSION_STATE: RidingLauncherSessionState = { status: "none" };

function sessionIdOf(state: RidingLauncherSessionState): string | null {
  return state.status === "none" ? null : state.sessionId;
}

/** The notice after a confirmation found its session gone or replaced
 * (backlog item 140): "awaiting-read" until the launcher's re-read has
 * succeeded, then "shown"; a failed re-read never shows it. */
type StaleSessionNotice = "none" | "awaiting-read" | "shown";

type LauncherClearAction = "end-ride" | "end-free-roam" | "discard-unfinished";

/** Backlog item 113 stage 4: the five rider-facing fields are catalogue
 * keys; `logContext` deliberately stays a raw identifier, because it is a
 * diagnostics key and not copy. Two entries share a title and confirm
 * label but differ in message and error, which is why this stays a table
 * per action rather than collapsing into one shared set of keys. */
const LAUNCHER_CLEAR_ACTION_COPY: Record<
  LauncherClearAction,
  {
    dialogTitle: ParameterlessMessageKey;
    dialogMessage: ParameterlessMessageKey;
    confirmLabel: ParameterlessMessageKey;
    confirmPendingLabel: ParameterlessMessageKey;
    errorMessage: ParameterlessMessageKey;
    logContext: string;
  }
> = {
  "end-ride": {
    dialogTitle: "riding.endConfirmTitle",
    dialogMessage: "riding.endConfirmMessage",
    confirmLabel: "ride.endRide",
    confirmPendingLabel: "ride.endingRide",
    errorMessage: "riding.endFailed",
    logContext: "riding-launcher-end-ride",
  },
  "end-free-roam": {
    dialogTitle: "freeRoam.endConfirmTitle",
    dialogMessage: "freeRoam.endConfirmMessage",
    confirmLabel: "ride.endRide",
    confirmPendingLabel: "ride.endingRide",
    errorMessage: "launcher.endFreeRoamFailed",
    logContext: "riding-launcher-end-free-roam",
  },
  "discard-unfinished": {
    dialogTitle: "launcher.discardTitle",
    dialogMessage: "launcher.discardMessage",
    confirmLabel: "launcher.discardConfirm",
    confirmPendingLabel: "launcher.discarding",
    errorMessage: "launcher.discardFailed",
    logContext: "riding-launcher-discard-unfinished",
  },
};

function describeUnresumableReason(
  translator: Translator,
  reason: "route-missing" | "unsupported-kind",
): string {
  return reason === "route-missing"
    ? translator.t("launcher.routeMissing")
    : translator.t("launcher.unsupportedKind");
}

/**
 * The idle Ride screen's launcher — reachable whenever no ride content is
 * currently selected in App.tsx (a fresh app load, an ordinary "Ride" tab
 * visit with nothing open, or the moment after a successful End/Finish ride
 * lands here). Inspects the persisted singleton active-session row itself
 * on every mount, rather than relying on App's own transient ride-content
 * state (always "none" here by construction) — so a session persisted
 * before a reload is still discoverable. All recovery stays local/offline:
 * only getActiveRideState/getRoute are read here, never a routing-provider
 * request, and starting free roam never requests geolocation either — only
 * App.tsx's own guard/write and FreeRoamScreen's subsequent mount effect
 * do that, once onStartFreeRoam/onResumeFreeRoam fires.
 *
 * Since backlog item 132 the first Ride entry after a cold start shows a
 * stored route ride's own paused screen instead of this launcher's summary
 * of it: App decides that through onSessionChecked, from this launcher's
 * own check, so loading, a failed read with Retry, a missing route and an
 * unsupported session all keep this launcher's existing presentation.
 */
export function RidingLauncher({
  onResumeRoute,
  onChooseRoute,
  onStartFreeRoam,
  onResumeFreeRoam,
  isFreeRoamPending = false,
  freeRoamError = null,
  sessionRefreshToken,
  onSessionChecked,
}: RidingLauncherProps) {
  const translator = useTranslate();
  const { t } = translator;
  const [hydrationStatus, setHydrationStatus] =
    useState<RidingLauncherHydrationStatus>("loading");
  const hydrationGenerationRef = useRef(0);
  const [hydrationRetryToken, setHydrationRetryToken] = useState(0);
  const [sessionState, setSessionState] =
    useState<RidingLauncherSessionState>(NONE_SESSION_STATE);
  // The session the open End ride or Discard confirmation was opened for,
  // or null while none is open (backlog item 140). Captured when it opens
  // and never replaced while it stays open; Confirm clears only this one.
  const [confirmingSessionId, setConfirmingSessionId] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<StaleSessionNotice>("none");

  // Mirrors PlanningScreen.tsx's own hydration-generation/retry-token
  // pattern exactly. A multi-step async read (ride state, then
  // conditionally the route it references) rather than a .then() chain,
  // since the later step depends on the first's own result.
  useEffect(() => {
    const generation = ++hydrationGenerationRef.current;

    // Shows what this read found. A confirmation stays anchored to the
    // session it was opened for (backlog item 140): a read showing any
    // other session closes it rather than re-targeting it. A notice
    // awaiting this read is shown now that it has succeeded.
    function present(next: RidingLauncherSessionState) {
      setSessionState(next);
      setHydrationStatus("ready");
      setConfirmingSessionId((confirming) =>
        confirming !== null && confirming !== sessionIdOf(next) ? null : confirming,
      );
      setStaleNotice((notice) => (notice === "awaiting-read" ? "shown" : notice));
    }

    async function hydrate() {
      // Gives a stored row without an identity one, in the same
      // transaction as the read, so End ride or Discard below can only
      // ever clear exactly this session (backlog item 140).
      const stored = await getActiveRideStateWithSessionId();
      if (hydrationGenerationRef.current !== generation) return;
      if (!stored) {
        onSessionChecked?.(null);
        present(NONE_SESSION_STATE);
        return;
      }
      // Read before the kind checks: an unsupported row narrows to never.
      const { sessionId } = stored;
      if (isStoredFreeRoamRideState(stored)) {
        onSessionChecked?.(null);
        present({ status: "resumable-free-roam", sessionId });
        return;
      }
      if (!isStoredRouteRideState(stored)) {
        onSessionChecked?.(null);
        present({
          status: "unresumable",
          reason: "unsupported-kind",
          sessionId,
        });
        return;
      }
      const route = await getRoute(stored.routeId);
      if (hydrationGenerationRef.current !== generation) return;
      if (!route) {
        onSessionChecked?.(null);
        present({
          status: "unresumable",
          reason: "route-missing",
          sessionId,
        });
        return;
      }
      // The owner is opening this route's own paused screen in place of
      // the launcher, so nothing here changes: the checking status stays
      // until the launcher unmounts.
      if (onSessionChecked?.(route) === true) return;
      present({ status: "resumable-route", route, sessionId });
    }

    hydrate().catch((error: unknown) => {
      if (hydrationGenerationRef.current !== generation) return;
      logError("riding-launcher-load-session", error);
      // Never "ready" — the failure UI below offers an explicit retry;
      // every "ready" render branch is gated strictly behind
      // hydrationStatus === "ready", so a failure is never mistaken for
      // "no session". A notice awaiting this read is dropped: the existing
      // failure explains the state instead.
      setHydrationStatus("failed");
      setStaleNotice((notice) => (notice === "awaiting-read" ? "none" : notice));
    });

    return () => {
      if (hydrationGenerationRef.current === generation) {
        hydrationGenerationRef.current += 1;
      }
    };
  }, [hydrationRetryToken, sessionRefreshToken, onSessionChecked]);

  const clearTriggerRef = useRef<HTMLButtonElement>(null);
  const [activeClearAction, setActiveClearAction] = useState<LauncherClearAction | null>(
    null,
  );
  const [clearError, setClearError] = useState<{
    action: LauncherClearAction;
    message: string;
  } | null>(null);
  // Synchronous guard against a rapid double End-ride/Discard submission —
  // mirrors RidingScreen.tsx's own isFinalizeActionPendingRef idiom.
  const isClearActionPendingRef = useRef(false);
  // The clear trigger unmounts/remounts as its confirmation opens/closes
  // (item 50's in-place confirmation morph — see renderClearAction below),
  // so Cancel/Escape and a failed clear both record a pending focus request
  // here instead of calling .focus() directly — mirrors
  // PlanningScreen.tsx's pendingClearDraftFocusRef and RidingScreen.tsx's
  // pendingEndRideFocusRef exactly (items 49/50).
  const pendingClearFocusRef = useRef(false);

  // Exactly one clear action is ever offered at a time — sessionState.status
  // alone determines which, so no separate "which action is this dialog
  // for" state is needed.
  const clearAction: LauncherClearAction | null =
    sessionState.status === "resumable-route"
      ? "end-ride"
      : sessionState.status === "resumable-free-roam"
        ? "end-free-roam"
        : sessionState.status === "unresumable"
          ? "discard-unfinished"
          : null;

  // The launcher's own shared clear-session handler — parameterised on the
  // three LauncherClearAction values exactly like RidingScreen.tsx's own
  // performFinalizeRide(source) is parameterised on "end"/"finish": every
  // action does identical storage-clear-then-reset-to-"none" work and
  // differs only in copy. Clears through clearActiveRideStateIfSession()
  // rather than instantiating a navigation hook (which requires either a
  // PlannedRoute — unavailable for the route-missing case — or, for free roam, a live
  // GPS/camera/wake-lock session this screen never runs, since
  // FreeRoamScreen was never mounted for this session this page lifetime).
  // None of this, nor useRideNavigation.finish()/useFreeRoamNavigation.finish(),
  // reaches into Dexie directly; all of it goes through
  // rideStateRepository.ts.
  //
  // Backlog item 140: the clear is conditioned on the session this
  // confirmation was opened for, checked and applied in one transaction.
  // When that session is no longer the one stored — ended, or replaced by
  // a newer one, in another window — nothing is deleted: the confirmation
  // closes with neither success nor an error, the launcher re-reads what
  // is actually stored, and once that read succeeds a notice says nothing
  // was deleted. No focus is moved, as on success.
  const performClearSession = async (action: LauncherClearAction, sessionId: string) => {
    if (isClearActionPendingRef.current) return;
    isClearActionPendingRef.current = true;
    setActiveClearAction(action);
    setClearError(null);
    try {
      const outcome = await clearActiveRideStateIfSession(sessionId);
      if (outcome === "cleared") {
        setSessionState(NONE_SESSION_STATE);
        setConfirmingSessionId(null);
      } else {
        setConfirmingSessionId(null);
        setStaleNotice("awaiting-read");
        setHydrationStatus("loading");
        setHydrationRetryToken((token) => token + 1);
      }
    } catch (error) {
      logError(LAUNCHER_CLEAR_ACTION_COPY[action].logContext, error);
      setClearError({
        action,
        message: translator.t(LAUNCHER_CLEAR_ACTION_COPY[action].errorMessage),
      });
      setConfirmingSessionId(null);
      // Restoring focus is deferred to the pending-ref effect below rather
      // than called directly here — mirrors RidingScreen.tsx's own
      // performFinalizeRide: the trigger is still disabled/absent in the
      // DOM at this exact synchronous point, so a direct .focus() call
      // here would silently no-op.
      pendingClearFocusRef.current = true;
    } finally {
      isClearActionPendingRef.current = false;
      setActiveClearAction(null);
    }
  };

  // A no-deps effect re-checks pendingClearFocusRef's readiness (mounted
  // AND enabled) on every render, rather than consuming the request
  // unconditionally on the first post-set commit — mirrors
  // PlanningScreen.tsx's pendingClearDraftFocusRef effect exactly.
  useEffect(() => {
    if (!pendingClearFocusRef.current) return;
    const trigger = clearTriggerRef.current;
    if (!trigger || trigger.disabled) return;
    pendingClearFocusRef.current = false;
    trigger.focus();
  });

  const handleClearTriggerClick = () => {
    if (confirmingSessionId !== null || isClearActionPendingRef.current) return;
    const presentedSessionId = sessionIdOf(sessionState);
    if (presentedSessionId === null) return;
    setClearError(null);
    setStaleNotice("none");
    setConfirmingSessionId(presentedSessionId);
  };

  const handleClearCancel = () => {
    // Escape can bypass a disabled Cancel button, so guard here too.
    if (isClearActionPendingRef.current) return;
    pendingClearFocusRef.current = true;
    setConfirmingSessionId(null);
  };

  // Renders the current clear action (End ride / Discard unfinished ride) in
  // place: either the trigger button (plus any error) or the confirmation
  // itself, never both — called from whichever single panel is currently
  // active below, so the ConfirmDialog JSX exists at exactly one call site
  // and can never mount twice, since the three panels are themselves
  // mutually exclusive (backlog item 50's in-place confirmation morph,
  // mirroring RidingScreen.tsx's own renderEndRideAction and
  // PlanningScreen.tsx's Clear-draft treatment from item 49). Closes over
  // the already-derived clearAction rather than taking a parameter, since a
  // panel only ever calls this when clearAction already corresponds to it.
  function renderClearAction(): ReactNode {
    if (!clearAction) return null;
    const copy = LAUNCHER_CLEAR_ACTION_COPY[clearAction];
    if (confirmingSessionId !== null) {
      const sessionId = confirmingSessionId;
      return (
        <ConfirmDialog
          open
          title={t(copy.dialogTitle)}
          message={t(copy.dialogMessage)}
          confirmLabel={
            activeClearAction === clearAction
              ? t(copy.confirmPendingLabel)
              : t(copy.confirmLabel)
          }
          cancelLabel={t("ride.cancel")}
          confirmDisabled={activeClearAction === clearAction}
          cancelDisabled={activeClearAction === clearAction}
          onConfirm={() => {
            void performClearSession(clearAction, sessionId);
          }}
          onCancel={handleClearCancel}
        />
      );
    }
    return (
      <>
        <button
          type="button"
          className="btn-danger"
          ref={clearTriggerRef}
          onClick={handleClearTriggerClick}
          disabled={activeClearAction !== null}
        >
          {t(copy.confirmLabel)}
        </button>
        {clearError?.action === clearAction ? (
          <p className="field-error" role="alert">
            {clearError.message}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <section className="screen" aria-label={t("launcher.landmarkLabel")}>
      <h1 className="screen-title">{t("launcher.title")}</h1>

      {/* Backlog item 140: a stable, initially empty polite region, present
          before its message (as item 141's notice is), filled once when a
          confirmation's session had gone and the re-read has succeeded.
          Visually hidden, so it takes no place in the screen's gap; the
          visible notice below is not live. */}
      <p className="visually-hidden" role="status" aria-atomic="true">
        {staleNotice === "shown" ? t("launcher.staleSessionNotice") : ""}
      </p>

      {hydrationStatus === "loading" ? (
        <p className="status-row" role="status">
          {t("launcher.checking")}
        </p>
      ) : null}

      {hydrationStatus === "failed" ? (
        <div className="row">
          <p className="field-error" role="alert">
            {t("launcher.checkFailed")}
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setStaleNotice("none");
              setHydrationStatus("loading");
              setHydrationRetryToken((token) => token + 1);
            }}
          >
            {t("launcher.retry")}
          </button>
        </div>
      ) : null}

      {hydrationStatus === "ready" && staleNotice === "shown" ? (
        <p className="status-row">{t("launcher.staleSessionNotice")}</p>
      ) : null}

      {hydrationStatus === "ready" && sessionState.status === "none" ? (
        <>
          <p>{t("launcher.noRoute")}</p>
          <button type="button" className="btn-primary" onClick={onChooseRoute}>
            {t("launcher.chooseRoute")}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onStartFreeRoam}
            disabled={isFreeRoamPending}
          >
            {isFreeRoamPending
              ? t("launcher.startingFreeRoam")
              : t("launcher.startFreeRoam")}
          </button>
          {freeRoamError ? (
            <p className="field-error" role="alert">
              {freeRoamError}
            </p>
          ) : null}
        </>
      ) : null}

      {hydrationStatus === "ready" && sessionState.status === "resumable-route" ? (
        <div className="panel stack">
          <h2>{sessionState.route.name}</h2>
          <p className="route-card-meta">
            {formatDistanceKm(translator, sessionState.route.distanceMetres)} ·{" "}
            {formatAscent(translator, sessionState.route.ascentMetres)}
          </p>
          <p>{t("launcher.unfinishedRide")}</p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              onResumeRoute(sessionState.route);
            }}
          >
            {t("launcher.resumeRide")}
          </button>
          <div className="ride-launcher-clear-row stack">{renderClearAction()}</div>
        </div>
      ) : null}

      {hydrationStatus === "ready" && sessionState.status === "resumable-free-roam" ? (
        <div className="panel stack">
          <h2>{t("launcher.freeRoamHeading")}</h2>
          <p>{t("launcher.unfinishedFreeRoam")}</p>
          <button
            type="button"
            className="btn-primary"
            onClick={onResumeFreeRoam}
            disabled={isFreeRoamPending}
          >
            {isFreeRoamPending
              ? t("launcher.resumingFreeRoam")
              : t("launcher.resumeFreeRoam")}
          </button>
          {freeRoamError ? (
            <p className="field-error" role="alert">
              {freeRoamError}
            </p>
          ) : null}
          <div className="ride-launcher-clear-row stack">{renderClearAction()}</div>
        </div>
      ) : null}

      {hydrationStatus === "ready" && sessionState.status === "unresumable" ? (
        <div className="panel stack">
          <p>{describeUnresumableReason(translator, sessionState.reason)}</p>
          <div className="ride-launcher-clear-row stack">{renderClearAction()}</div>
        </div>
      ) : null}
    </section>
  );
}
