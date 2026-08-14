import { useEffect, useRef, useState } from "react";
import type { PlannedRoute } from "../../domain/types.ts";
import { logError } from "../../platform/errorLog.ts";
import { resolveStoredRideSessionKind } from "../../storage/mapping.ts";
import {
  clearActiveRideState,
  getActiveRideState,
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
}

type RidingLauncherHydrationStatus = "loading" | "ready" | "failed";

type RidingLauncherSessionState =
  | { status: "none" }
  | { status: "resumable"; route: PlannedRoute }
  | { status: "unresumable"; reason: "route-missing" | "unsupported-kind" };

const NONE_SESSION_STATE: RidingLauncherSessionState = { status: "none" };

type LauncherClearAction = "end-ride" | "discard-unfinished";

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
 * The idle Ride screen's launcher — reachable whenever no route is
 * currently selected in App.tsx (a fresh app load, an ordinary "Ride" tab
 * visit with nothing open, or the moment after a successful End/Finish ride
 * lands here). Inspects the persisted singleton active-session row itself
 * on every mount, rather than relying on App's own transient selectedRoute
 * (always null here by construction) — so a session persisted before a
 * reload is still discoverable. All recovery stays local/offline: only
 * getActiveRideState/getRoute are read here, never a routing-provider
 * request.
 */
export function RidingLauncher({ onResumeRoute, onChooseRoute }: RidingLauncherProps) {
  const [hydrationStatus, setHydrationStatus] =
    useState<RidingLauncherHydrationStatus>("loading");
  const hydrationGenerationRef = useRef(0);
  const [hydrationRetryToken, setHydrationRetryToken] = useState(0);
  const [sessionState, setSessionState] =
    useState<RidingLauncherSessionState>(NONE_SESSION_STATE);

  // Mirrors PlanningScreen.tsx's own hydration-generation/retry-token
  // pattern exactly. A two-step async read (ride state, then conditionally
  // the route it references) rather than a .then() chain, since the second
  // read depends on the first's own result.
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
      const kind = resolveStoredRideSessionKind(stored);
      if (kind !== "route") {
        setSessionState({ status: "unresumable", reason: "unsupported-kind" });
        setHydrationStatus("ready");
        return;
      }
      const route = await getRoute(stored.routeId);
      if (hydrationGenerationRef.current !== generation) return;
      setSessionState(
        route
          ? { status: "resumable", route }
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

  // Exactly one of "End ride" (resumable) or "Discard unfinished ride"
  // (unresumable) is ever offered at a time — sessionState.status alone
  // determines which, so no separate "which action is this dialog for"
  // state is needed.
  const clearAction: LauncherClearAction | null =
    sessionState.status === "resumable"
      ? "end-ride"
      : sessionState.status === "unresumable"
        ? "discard-unfinished"
        : null;

  // The launcher's own shared clear-session handler — parameterised on
  // "end-ride" vs "discard-unfinished" exactly like RidingScreen.tsx's own
  // performFinalizeRide(source) is parameterised on "end"/"finish": both
  // actions do identical storage-clear-then-reset-to-"none" work and differ
  // only in copy. Calls clearActiveRideState() directly rather than
  // instantiating useRideNavigation (which requires a PlannedRoute —
  // unavailable at all for the route-missing case, and architecturally
  // backwards for the resumable case too, since there is no live
  // GPS/camera/wake-lock/completion state here to reset; RidingScreen was
  // never mounted for this route this session). This stays the one
  // authoritative persisted-session clear path: both this function and
  // useRideNavigation.finish() call through clearActiveRideState(); neither
  // reaches into Dexie directly.
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
      // Focus restoration is handled by the effect below, not directly
      // here — mirrors RidingScreen.tsx's own performFinalizeRide: the
      // trigger is still disabled in the DOM at this exact synchronous
      // point, so a direct .focus() call here would silently no-op.
    } finally {
      isClearActionPendingRef.current = false;
      setActiveClearAction(null);
    }
  };

  useEffect(() => {
    if (!clearError) return;
    clearTriggerRef.current?.focus();
  }, [clearError]);

  const handleClearTriggerClick = () => {
    if (isClearConfirmOpen || isClearActionPendingRef.current) return;
    setClearError(null);
    setIsClearConfirmOpen(true);
  };

  const handleClearCancel = () => {
    // Escape can bypass a disabled Cancel button, so guard here too.
    if (isClearActionPendingRef.current) return;
    setIsClearConfirmOpen(false);
    clearTriggerRef.current?.focus();
  };

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
        </>
      ) : null}

      {hydrationStatus === "ready" && sessionState.status === "resumable" ? (
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
          <button
            type="button"
            className="btn-danger"
            ref={clearTriggerRef}
            onClick={handleClearTriggerClick}
            disabled={activeClearAction !== null}
          >
            End ride
          </button>
          {clearError?.action === "end-ride" ? (
            <p className="field-error" role="alert">
              {clearError.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {hydrationStatus === "ready" && sessionState.status === "unresumable" ? (
        <div className="panel stack">
          <p>{describeUnresumableReason(sessionState.reason)}</p>
          <button
            type="button"
            className="btn-danger"
            ref={clearTriggerRef}
            onClick={handleClearTriggerClick}
            disabled={activeClearAction !== null}
          >
            Discard unfinished ride
          </button>
          {clearError?.action === "discard-unfinished" ? (
            <p className="field-error" role="alert">
              {clearError.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {clearAction ? (
        <ConfirmDialog
          open={isClearConfirmOpen}
          title={LAUNCHER_CLEAR_ACTION_COPY[clearAction].dialogTitle}
          message={LAUNCHER_CLEAR_ACTION_COPY[clearAction].dialogMessage}
          confirmLabel={
            activeClearAction === clearAction
              ? LAUNCHER_CLEAR_ACTION_COPY[clearAction].confirmPendingLabel
              : LAUNCHER_CLEAR_ACTION_COPY[clearAction].confirmLabel
          }
          cancelLabel="Cancel"
          confirmDisabled={activeClearAction === clearAction}
          cancelDisabled={activeClearAction === clearAction}
          onConfirm={() => {
            void performClearSession(clearAction);
          }}
          onCancel={handleClearCancel}
        />
      ) : null}
    </section>
  );
}
