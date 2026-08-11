import { useCallback, useReducer } from "react";
import type { Coordinate } from "../../domain/types.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";
import type { OffRouteLevel } from "../../navigation/types.ts";
import {
  INITIAL_ROUTE_COMPLETION_TRACKER_STATE,
  isRouteCompletionCandidateEligible,
  isRouteCompletionConfirmed,
  routeCompletionTrackerReducer,
  type RouteCompletionTrackerState,
} from "../../navigation/rideCompletion.ts";

export interface UseRouteCompletionCandidateOptions {
  routeId: string;
  /** Whether the ride is actively tracking (a live geolocation watch) —
   * never merely the pre-ride or Resume-riding screen. */
  isRideActive: boolean;
  currentFix: GeolocationFix | null;
  isStale: boolean;
  offRouteLevel: OffRouteLevel;
  reliableDistanceFromStartMetres: number | null;
  routeTotalDistanceMetres: number;
  routeFinalCoordinate: Coordinate | null;
}

export interface UseRouteCompletionCandidateResult {
  isConfirmed: boolean;
  /** "Keep riding" — suppresses the completion suggestion for the
   * remainder of this ride session (until reset). */
  dismiss: () => void;
  /** Clears both the consecutive-fix count and any dismissal. Called
   * automatically on a routeId change, and explicitly by the shared
   * finalisation callback (End ride/Finish ride never change routeId, so
   * the automatic reset alone wouldn't cover starting the same route
   * fresh again). */
  reset: () => void;
}

interface HookState {
  tracker: RouteCompletionTrackerState;
  /** The routeId/fix a fix was last evaluated against — held in reducer
   * state, not a ref, so the "already evaluated this fix" dedupe check
   * below can be a pure read during render (refs may not be read or
   * written during render — see react-hooks/refs). */
  lastRouteId: string;
  lastEvaluatedFix: GeolocationFix | null;
}

type HookEvent =
  | { type: "route-changed"; routeId: string }
  | { type: "fix-evaluated"; fix: GeolocationFix; eligible: boolean }
  | { type: "dismiss" }
  | { type: "reset" };

function hookReducer(state: HookState, event: HookEvent): HookState {
  switch (event.type) {
    case "route-changed":
      return {
        tracker: INITIAL_ROUTE_COMPLETION_TRACKER_STATE,
        lastRouteId: event.routeId,
        lastEvaluatedFix: null,
      };
    case "fix-evaluated":
      return {
        ...state,
        tracker: routeCompletionTrackerReducer(state.tracker, {
          type: "fix-evaluated",
          eligible: event.eligible,
        }),
        lastEvaluatedFix: event.fix,
      };
    case "dismiss":
      return {
        ...state,
        tracker: routeCompletionTrackerReducer(state.tracker, { type: "dismiss" }),
      };
    case "reset":
      return {
        ...state,
        tracker: INITIAL_ROUTE_COMPLETION_TRACKER_STATE,
        lastEvaluatedFix: null,
      };
    default:
      return state;
  }
}

/**
 * Tracks whether the rider's recent GPS fixes conservatively confirm route
 * completion — see navigation/rideCompletion.ts for the pure eligibility
 * and tracker logic this wraps. Uses the same "conditional dispatch during
 * render" idiom RidingScreen.tsx already established for
 * reachedManoeuvreIndex (never a useEffect): a fix is only ever evaluated
 * once, tracked by object identity — held in reducer state (read directly
 * during render), not a ref — so neither an unrelated re-render nor React
 * 18 StrictMode's double-invoked render can double-count it.
 */
export function useRouteCompletionCandidate(
  options: UseRouteCompletionCandidateOptions,
): UseRouteCompletionCandidateResult {
  const [state, dispatch] = useReducer(hookReducer, {
    tracker: INITIAL_ROUTE_COMPLETION_TRACKER_STATE,
    lastRouteId: options.routeId,
    lastEvaluatedFix: null,
  });

  if (options.routeId !== state.lastRouteId) {
    dispatch({ type: "route-changed", routeId: options.routeId });
  } else if (
    options.isRideActive &&
    options.currentFix !== null &&
    options.currentFix !== state.lastEvaluatedFix
  ) {
    const eligible = isRouteCompletionCandidateEligible({
      isRideActive: options.isRideActive,
      isStale: options.isStale,
      offRouteLevel: options.offRouteLevel,
      currentCoordinate: options.currentFix.coordinate,
      currentAccuracyMetres: options.currentFix.accuracyMetres,
      reliableDistanceFromStartMetres: options.reliableDistanceFromStartMetres,
      routeTotalDistanceMetres: options.routeTotalDistanceMetres,
      routeFinalCoordinate: options.routeFinalCoordinate,
    });
    dispatch({ type: "fix-evaluated", fix: options.currentFix, eligible });
  }

  const dismiss = useCallback(() => {
    dispatch({ type: "dismiss" });
  }, []);
  const reset = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);

  return {
    isConfirmed: isRouteCompletionConfirmed(state.tracker),
    dismiss,
    reset,
  };
}
