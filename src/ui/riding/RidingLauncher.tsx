import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PlannedRoute } from "../../domain/types.ts";
import { logError } from "../../platform/errorLog.ts";
import {
  isStoredFreeRoamRideState,
  isStoredRouteRideState,
} from "../../storage/mapping.ts";
import {
  clearActiveRideState,
  getActiveRideState,
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
}

type RidingLauncherHydrationStatus = "loading" | "ready" | "failed";

type RidingLauncherSessionState =
  | { status: "none" }
  | { status: "resumable-route"; route: PlannedRoute }
  | { status: "resumable-free-roam" }
  | { status: "unresumable"; reason: "route-missing" | "unsupported-kind" };

const NONE_SESSION_STATE: RidingLauncherSessionState = { status: "none" };

type LauncherClearAction = "end-ride" | "end-free-roam" | "discard-unfinished";

const LAUNCHER_CLEAR_ACTION_COPY: Record<
  LauncherClearAction,
  {
    dialogTitle: string;
    dialogMessage: string;
    confirmLabel: string;
    confirmPendingLabel: string;
    errorMessage: string;
    logContext: string;
  }
> = {
  "end-ride": {
    dialogTitle: "End this ride?",
    dialogMessage:
      "Navigation progress for this ride will be cleared. The saved route will remain in your library.",
    confirmLabel: "End ride",
    confirmPendingLabel: "Ending ride…",
    errorMessage: "The ride could not be ended on this device. Try again.",
    logContext: "riding-launcher-end-ride",
  },
  "end-free-roam": {
    dialogTitle: "End this ride?",
    dialogMessage: "Your free roam position and camera state will be cleared.",
    confirmLabel: "End ride",
    confirmPendingLabel: "Ending ride…",
    errorMessage: "Free roam could not be ended on this device. Try again.",
    logContext: "riding-launcher-end-free-roam",
  },
  "discard-unfinished": {
    dialogTitle: "Discard unfinished ride?",
    dialogMessage:
      "Only the stored progress for this unfinished ride will be removed — no saved route is affected.",
    confirmLabel: "Discard unfinished ride",
    confirmPendingLabel: "Discarding…",
    errorMessage:
      "This unfinished ride could not be discarded on this device. Try again.",
    logContext: "riding-launcher-discard-unfinished",
  },
};

function describeUnresumableReason(reason: "route-missing" | "unsupported-kind"): string {
  return reason === "route-missing"
    ? "This unfinished ride refers to a route that's no longer in your library, so it can't be resumed."
    : "This unfinished ride can't be recovered by this version of the app.";
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
 */
export function RidingLauncher({
  onResumeRoute,
  onChooseRoute,
  onStartFreeRoam,
  onResumeFreeRoam,
  isFreeRoamPending = false,
  freeRoamError = null,
  sessionRefreshToken,
}: RidingLauncherProps) {
  const [hydrationStatus, setHydrationStatus] =
    useState<RidingLauncherHydrationStatus>("loading");
  const hydrationGenerationRef = useRef(0);
  const [hydrationRetryToken, setHydrationRetryToken] = useState(0);
  const [sessionState, setSessionState] =
    useState<RidingLauncherSessionState>(NONE_SESSION_STATE);

  // Mirrors PlanningScreen.tsx's own hydration-generation/retry-token
  // pattern exactly. A multi-step async read (ride state, then
  // conditionally the route it references) rather than a .then() chain,
  // since the later step depends on the first's own result.
  useEffect(() => {
    const generation = ++hydrationGenerationRef.current;

    async function hydrate() {
      const stored = await getActiveRideState();
      if (hydrationGenerationRef.current !== generation) return;
      if (!stored) {
        setSessionState(NONE_SESSION_STATE);
        setHydrationStatus("ready");
        return;
      }
      if (isStoredFreeRoamRideState(stored)) {
        setSessionState({ status: "resumable-free-roam" });
        setHydrationStatus("ready");
        return;
      }
      if (!isStoredRouteRideState(stored)) {
        setSessionState({ status: "unresumable", reason: "unsupported-kind" });
        setHydrationStatus("ready");
        return;
      }
      const route = await getRoute(stored.routeId);
      if (hydrationGenerationRef.current !== generation) return;
      setSessionState(
        route
          ? { status: "resumable-route", route }
          : { status: "unresumable", reason: "route-missing" },
      );
      setHydrationStatus("ready");
    }

    hydrate().catch((error: unknown) => {
      if (hydrationGenerationRef.current !== generation) return;
      logError("riding-launcher-load-session", error);
      // Never "ready" — the failure UI below offers an explicit retry;
      // every "ready" render branch is gated strictly behind
      // hydrationStatus === "ready", so a failure is never mistaken for
      // "no session".
      setHydrationStatus("failed");
    });

    return () => {
      if (hydrationGenerationRef.current === generation) {
        hydrationGenerationRef.current += 1;
      }
    };
  }, [hydrationRetryToken, sessionRefreshToken]);

  const clearTriggerRef = useRef<HTMLButtonElement>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
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
  // differs only in copy. Calls clearActiveRideState() directly rather than
  // instantiating a navigation hook (which requires either a PlannedRoute —
  // unavailable for the route-missing case — or, for free roam, a live
  // GPS/camera/wake-lock session this screen never runs, since
  // FreeRoamScreen was never mounted for this session this page lifetime).
  // This stays the one authoritative persisted-session clear path: this
  // function and both useRideNavigation.finish()/useFreeRoamNavigation.finish()
  // call through clearActiveRideState(); none of them reach into Dexie
  // directly.
  const performClearSession = async (action: LauncherClearAction) => {
    if (isClearActionPendingRef.current) return;
    isClearActionPendingRef.current = true;
    setActiveClearAction(action);
    setClearError(null);
    try {
      await clearActiveRideState();
      setSessionState(NONE_SESSION_STATE);
      setIsClearConfirmOpen(false);
    } catch (error) {
      logError(LAUNCHER_CLEAR_ACTION_COPY[action].logContext, error);
      setClearError({
        action,
        message: LAUNCHER_CLEAR_ACTION_COPY[action].errorMessage,
      });
      setIsClearConfirmOpen(false);
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
    if (isClearConfirmOpen || isClearActionPendingRef.current) return;
    setClearError(null);
    setIsClearConfirmOpen(true);
  };

  const handleClearCancel = () => {
    // Escape can bypass a disabled Cancel button, so guard here too.
    if (isClearActionPendingRef.current) return;
    pendingClearFocusRef.current = true;
    setIsClearConfirmOpen(false);
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
    if (isClearConfirmOpen) {
      return (
        <ConfirmDialog
          open={isClearConfirmOpen}
          title={copy.dialogTitle}
          message={copy.dialogMessage}
          confirmLabel={
            activeClearAction === clearAction
              ? copy.confirmPendingLabel
              : copy.confirmLabel
          }
          cancelLabel="Cancel"
          confirmDisabled={activeClearAction === clearAction}
          cancelDisabled={activeClearAction === clearAction}
          onConfirm={() => {
            void performClearSession(clearAction);
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
          {copy.confirmLabel}
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
    <section className="screen" aria-label="Ride">
      <h1 className="screen-title">Ride</h1>

      {hydrationStatus === "loading" ? (
        <p className="status-row" role="status">
          Checking for an unfinished ride…
        </p>
      ) : null}

      {hydrationStatus === "failed" ? (
        <div className="row">
          <p className="field-error" role="alert">
            Your unfinished ride status could not be checked. Nothing has been changed.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setHydrationStatus("loading");
              setHydrationRetryToken((token) => token + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {hydrationStatus === "ready" && sessionState.status === "none" ? (
        <>
          <p>No route selected yet. Choose a route from Routes to start riding.</p>
          <button type="button" className="btn-primary" onClick={onChooseRoute}>
            Choose a route
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onStartFreeRoam}
            disabled={isFreeRoamPending}
          >
            {isFreeRoamPending ? "Starting…" : "Start free roam"}
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
            {formatDistanceKm(sessionState.route.distanceMetres)} ·{" "}
            {formatAscent(sessionState.route.ascentMetres)}
          </p>
          <p>You have an unfinished ride on this route.</p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              onResumeRoute(sessionState.route);
            }}
          >
            Resume ride
          </button>
          <div className="ride-launcher-clear-row stack">{renderClearAction()}</div>
        </div>
      ) : null}

      {hydrationStatus === "ready" && sessionState.status === "resumable-free-roam" ? (
        <div className="panel stack">
          <h2>Free roam</h2>
          <p>You have an unfinished free roam session.</p>
          <button
            type="button"
            className="btn-primary"
            onClick={onResumeFreeRoam}
            disabled={isFreeRoamPending}
          >
            {isFreeRoamPending ? "Resuming…" : "Resume free roam"}
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
          <p>{describeUnresumableReason(sessionState.reason)}</p>
          <div className="ride-launcher-clear-row stack">{renderClearAction()}</div>
        </div>
      ) : null}
    </section>
  );
}
