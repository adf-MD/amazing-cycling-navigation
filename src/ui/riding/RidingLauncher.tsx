import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PlannedRoute } from "../../domain/types.ts";
import { systemClock, type Clock } from "../../platform/clock.ts";
import { logError } from "../../platform/errorLog.ts";
import {
  isStoredFreeRoamRideState,
  isStoredRouteRideState,
  toStoredFreeRoamState,
} from "../../storage/mapping.ts";
import {
  clearActiveRideState,
  getActiveRideState,
  setActiveRideState,
} from "../../storage/rideStateRepository.ts";
import { getRoute } from "../../storage/routesRepository.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { formatAscent, formatDistanceKm } from "../shared/routeSummary.ts";

export interface RidingLauncherProps {
  /** Selects the resumed route and opens it into RidingScreen — mirrors
   * App.tsx's existing onOpenRoute-driven handlers' shape. Never starts
   * geolocation itself; RidingScreen's own pre-ride panel still gates the
   * GPS watch behind its own explicit "Resume riding" tap. */
  onResumeRoute: (route: PlannedRoute) => void;
  onChooseRoute: () => void;
  /** Fired once a free-roam session is ready to display — covers both
   * "Start free roam" (after this component has already persisted a fresh
   * session row) and "Resume free roam" (the row already existed) alike;
   * this component itself decides which one actually happened and never
   * exposes that distinction upward. Unlike onResumeRoute, this genuinely
   * starts geolocation (via FreeRoamScreen's own mount effect) — the
   * explicit tap that triggers this callback IS the deliberate user action
   * item 42's own spec requires. */
  onOpenFreeRoam: () => void;
  /** Set by App.tsx when a route-open attempt (from Routes or a Planning
   * save) was blocked because an unfinished free-roam session exists, or
   * because that check itself failed to read storage — never set for an
   * ordinary visit to this screen. Rendered as an accessible explanation
   * near the top, regardless of which session-state branch is active
   * below it. */
  blockedRouteOpenReason?: "free-roam-unfinished" | "check-failed" | null;
  clock?: Clock;
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

function describeBlockedRouteOpenReason(
  reason: "free-roam-unfinished" | "check-failed",
): string {
  return reason === "free-roam-unfinished"
    ? "You have an unfinished free roam session. End it before opening a saved route."
    : "Whether a free roam session is still active could not be checked, so the route was not opened. Try again.";
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
 * the resulting onOpenFreeRoam callback, and FreeRoamScreen's own mount
 * effect, do that.
 */
export function RidingLauncher({
  onResumeRoute,
  onChooseRoute,
  onOpenFreeRoam,
  blockedRouteOpenReason = null,
  clock = systemClock,
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
  }, [hydrationRetryToken]);

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

  // "Start free roam" — persists a fresh, minimal free-roam session row
  // BEFORE calling onOpenFreeRoam, so a storage failure keeps the rider on
  // this screen with no GPS watch ever started (backlog item 42's own
  // explicit requirement). A synchronous re-entrancy guard mirrors
  // isClearActionPendingRef above.
  const startFreeRoamTriggerRef = useRef<HTMLButtonElement>(null);
  const [isStartingFreeRoam, setIsStartingFreeRoam] = useState(false);
  const [startFreeRoamError, setStartFreeRoamError] = useState<string | null>(null);
  const isStartFreeRoamPendingRef = useRef(false);

  const handleStartFreeRoam = async () => {
    if (isStartFreeRoamPendingRef.current) return;
    isStartFreeRoamPendingRef.current = true;
    setIsStartingFreeRoam(true);
    setStartFreeRoamError(null);
    try {
      await setActiveRideState(
        toStoredFreeRoamState(
          new Date(clock.now()).toISOString(),
          null,
          {
            mode: "overview",
            coordinate: null,
            zoom: null,
            bearingDegrees: 0,
            pitchDegrees: 0,
          },
          null,
          false,
        ),
      );
      onOpenFreeRoam();
    } catch (error) {
      logError("riding-launcher-start-free-roam", error);
      setStartFreeRoamError("Free roam could not be started on this device. Try again.");
    } finally {
      isStartFreeRoamPendingRef.current = false;
      setIsStartingFreeRoam(false);
    }
  };

  return (
    <section className="screen" aria-label="Ride">
      <h1 className="screen-title">Ride</h1>

      {blockedRouteOpenReason ? (
        <p className="field-error" role="alert">
          {describeBlockedRouteOpenReason(blockedRouteOpenReason)}
        </p>
      ) : null}

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
            ref={startFreeRoamTriggerRef}
            onClick={() => {
              void handleStartFreeRoam();
            }}
            disabled={isStartingFreeRoam}
          >
            {isStartingFreeRoam ? "Starting…" : "Start free roam"}
          </button>
          {startFreeRoamError ? (
            <p className="field-error" role="alert">
              {startFreeRoamError}
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
            Resume route
          </button>
          <div className="ride-launcher-clear-row stack">{renderClearAction()}</div>
        </div>
      ) : null}

      {hydrationStatus === "ready" && sessionState.status === "resumable-free-roam" ? (
        <div className="panel stack">
          <h2>Free roam</h2>
          <p>You have an unfinished free roam session.</p>
          <button type="button" className="btn-primary" onClick={onOpenFreeRoam}>
            Resume free roam
          </button>
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
