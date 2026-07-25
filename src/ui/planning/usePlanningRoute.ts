import { useCallback, useEffect, useRef, useState } from "react";
import type { PlannedRoute, Waypoint } from "../../domain/types.ts";
import { logError } from "../../platform/errorLog.ts";
import type { RoutingProfile, RoutingProvider } from "../../routing/provider.ts";
import {
  RoutingError,
  type RoutingErrorReason,
} from "../../routing/openRouteServiceErrors.ts";
import type { ProviderKeyOutcome } from "../../storage/db.ts";
import { recordProviderKeyVerification } from "../../storage/providerKeyRepository.ts";

/** Debounce applied to automatic recalculation after a completed waypoint
 * edit, once a route already exists. The very first calculation is always
 * the explicit calculateNow() action, never debounced. */
const RECALCULATION_DEBOUNCE_MS = 900;

export type PlanningRouteState =
  | { kind: "no-waypoints" }
  | { kind: "insufficient-waypoints" }
  | { kind: "unrouted-preview"; waypoints: readonly Waypoint[] }
  | { kind: "routed"; route: PlannedRoute; waypoints: readonly Waypoint[] };

export interface UsePlanningRouteOptions {
  waypoints: readonly Waypoint[];
  profile: RoutingProfile;
  avoidFerries: boolean;
  adapter: RoutingProvider;
}

export interface UsePlanningRouteResult {
  state: PlanningRouteState;
  /** Session-only — never a claim about the key's own validity by
   * itself; see the outcome recorded via recordProviderKeyVerification
   * for that. */
  lastErrorMessage: string | null;
  /** True for both the very first calculation and any later
   * recalculation — the UI can show this as "Calculating…"/"Updating…"
   * without needing to know which. */
  isCalculating: boolean;
  /** The explicit first-calculation action; also usable as a manual
   * retry after a failure. */
  calculateNow: () => void;
}

function deriveBaseState(waypoints: readonly Waypoint[]): PlanningRouteState {
  if (waypoints.length === 0) return { kind: "no-waypoints" };
  if (waypoints.length === 1) return { kind: "insufficient-waypoints" };
  return { kind: "unrouted-preview", waypoints };
}

/** Maps an adapter error reason to the coarse, provider-independent
 * outcome persisted for Settings — null means "not informative about the
 * key's own validity", so nothing is recorded (see RoutingError's own
 * doc comment for the full reasoning). */
function mapErrorReasonToOutcome(reason: RoutingErrorReason): ProviderKeyOutcome | null {
  switch (reason) {
    case "unauthorized":
      return "rejected";
    case "forbidden":
    case "rate-limited":
      return "quota-limited";
    case "offline":
    case "network-failure":
    case "timeout":
      return "unavailable";
    default:
      return null;
  }
}

function describeRoutingError(error: RoutingError): string {
  switch (error.reason) {
    case "no-api-key":
      return "Road routing requires your personal OpenRouteService key.";
    case "unauthorized":
      return "Your OpenRouteService key was rejected. Check it in Settings.";
    case "forbidden":
      return "Access was denied — check your OpenRouteService account, permissions or daily quota in Settings.";
    case "rate-limited":
      return "The routing rate limit was reached. Try again shortly.";
    case "offline":
      return "You are offline. Connect to calculate a route.";
    case "network-failure":
      return "The routing request failed. Check your connection and try again.";
    case "timeout":
      return "The routing request timed out. Try again.";
    case "malformed-response":
    case "no-geometry":
    case "unknown":
      return "The routing provider returned an unusable response. Try again.";
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

/**
 * Owns the debounced recalculation / cancellation / retention lifecycle
 * for Planning's routed result. Never calls the provider while panning —
 * only in response to calculateNow() or a genuine waypoints/profile/
 * avoidFerries change once a route already exists. A failed
 * recalculation always retains the previous successful `route` object
 * unchanged, reported separately via `lastErrorMessage`.
 */
export function usePlanningRoute({
  waypoints,
  profile,
  avoidFerries,
  adapter,
}: UsePlanningRouteOptions): UsePlanningRouteResult {
  const [routedResult, setRoutedResult] = useState<{
    route: PlannedRoute;
    waypoints: readonly Waypoint[];
  } | null>(null);
  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // Dropping below 2 waypoints clears any previous result: an old route
  // no longer corresponds to the current waypoints at all. Adjusted
  // during render (React's documented pattern for "reset state when a
  // prop changes") rather than in an effect body, so this never causes
  // an extra committed render with stale data.
  const isInsufficientWaypoints = waypoints.length < 2;
  const [wasInsufficientWaypoints, setWasInsufficientWaypoints] = useState(
    isInsufficientWaypoints,
  );
  if (isInsufficientWaypoints !== wasInsufficientWaypoints) {
    setWasInsufficientWaypoints(isInsufficientWaypoints);
    if (isInsufficientWaypoints && routedResult !== null) {
      setRoutedResult(null);
    }
  }

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const debounceTimeoutRef = useRef<number | undefined>(undefined);
  const hasRoutedResultRef = useRef(false);
  useEffect(() => {
    hasRoutedResultRef.current = routedResult !== null;
  }, [routedResult]);

  // Read fresh inside the stable runCalculation callback, rather than
  // depending on waypoints/profile/avoidFerries directly, so
  // calculateNow()'s identity stays stable across renders.
  const latestRef = useRef({ waypoints, profile, avoidFerries });
  useEffect(() => {
    latestRef.current = { waypoints, profile, avoidFerries };
  }, [waypoints, profile, avoidFerries]);

  const runCalculation = useCallback(() => {
    const {
      waypoints: currentWaypoints,
      profile: currentProfile,
      avoidFerries: currentAvoidFerries,
    } = latestRef.current;
    if (currentWaypoints.length < 2) return;

    // Cancel any in-flight request before starting a new one — the
    // requestSeq guard below additionally protects against applying a
    // superseded response even independent of abort timing.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestSeq = ++requestSeqRef.current;

    setIsCalculating(true);
    setLastErrorMessage(null);

    adapter
      .calculateRoute(
        currentWaypoints.map((waypoint) => waypoint.coordinate),
        { profile: currentProfile, avoidFerries: currentAvoidFerries },
        controller.signal,
      )
      .then((route) => {
        if (requestSeq !== requestSeqRef.current) return;
        setIsCalculating(false);
        setRoutedResult({ route, waypoints: currentWaypoints });
        recordProviderKeyVerification("verified").catch((error: unknown) => {
          logError("planning-record-verification", error);
        });
      })
      .catch((error: unknown) => {
        if (requestSeq !== requestSeqRef.current) return;
        if (isAbortError(error)) {
          // Cancellation or supersession — never a user-facing error.
          return;
        }
        setIsCalculating(false);
        if (error instanceof RoutingError) {
          setLastErrorMessage(describeRoutingError(error));
          const outcome = mapErrorReasonToOutcome(error.reason);
          if (outcome) {
            const rateLimitResetAt = error.retryAfterSeconds
              ? new Date(Date.now() + error.retryAfterSeconds * 1000).toISOString()
              : null;
            recordProviderKeyVerification(outcome, rateLimitResetAt).catch(
              (recordError: unknown) => {
                logError("planning-record-verification", recordError);
              },
            );
          }
        } else {
          setLastErrorMessage("The route could not be calculated. Try again.");
        }
        logError("planning-calculate-route", error);
      });
  }, [adapter]);

  const calculateNow = useCallback(() => {
    window.clearTimeout(debounceTimeoutRef.current);
    runCalculation();
  }, [runCalculation]);

  // Debounced recalculation after a completed waypoint/profile/ferry
  // edit — but only once a route already exists (checked via a ref, not
  // routedResult directly, so this effect never re-fires merely because
  // a calculation it started has just completed). Fewer than 2 waypoints
  // is handled during render above, not here.
  useEffect(() => {
    if (waypoints.length < 2) return;
    if (!hasRoutedResultRef.current) return;
    window.clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = window.setTimeout(() => {
      runCalculation();
    }, RECALCULATION_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(debounceTimeoutRef.current);
    };
  }, [waypoints, profile, avoidFerries, runCalculation]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      window.clearTimeout(debounceTimeoutRef.current);
    };
  }, []);

  const state: PlanningRouteState = routedResult
    ? { kind: "routed", route: routedResult.route, waypoints: routedResult.waypoints }
    : deriveBaseState(waypoints);

  return { state, lastErrorMessage, isCalculating, calculateNow };
}
