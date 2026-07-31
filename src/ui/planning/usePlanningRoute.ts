import { useCallback, useEffect, useRef, useState } from "react";
import type { PlannedRoute, Waypoint } from "../../domain/types.ts";
import { createRouteId } from "../../domain/id.ts";
import { logError } from "../../platform/errorLog.ts";
import type { RoutingProfile, RoutingProvider } from "../../routing/provider.ts";
import { RoutingError } from "../../routing/openRouteServiceErrors.ts";
import {
  describeRoutingError,
  mapErrorReasonToOutcome,
} from "../../routing/routingErrorPresentation.ts";
import {
  RouteLegCache,
  deriveLegRequirements,
  getProviderInstanceToken,
  resolveRouteLegsInOrder,
} from "../../routing/routeLegs.ts";
import { stitchPlannedRouteLegs } from "../../routing/stitchPlannedRouteLegs.ts";
import { recordProviderKeyVerification } from "../../storage/providerKeyRepository.ts";

/** Debounce applied to automatic recalculation after a completed waypoint
 * edit, once a route already exists. The very first calculation is always
 * the explicit calculateNow() action, never debounced. */
const RECALCULATION_DEBOUNCE_MS = 900;

export type PlanningRouteState =
  | { kind: "no-waypoints" }
  | { kind: "insufficient-waypoints" }
  | { kind: "unrouted-preview"; waypoints: readonly Waypoint[] }
  | {
      kind: "routed";
      route: PlannedRoute;
      waypoints: readonly Waypoint[];
      /** True only for the first route ever successfully calculated for
       * the current draft (including after any number of earlier failed
       * attempts) — false for every recalculation after that, however it
       * was triggered. Lets the caller fit the map's camera to the route
       * exactly once per draft, never on a later edit-triggered
       * recalculation. See hasRoutedResultRef below for how this is
       * derived. */
      isFirstRouteForDraft: boolean;
    };

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
  /** The number of route sections (legs) requiring a fresh provider
   * request in the current calculation batch, when more than one —
   * null otherwise (including once every leg was already cached, or
   * while not calculating at all). Purely for progress-text
   * transparency; never required for correctness. */
  updatingLegCount: number | null;
  /** The explicit first-calculation action; also usable as a manual
   * retry after a failure. */
  calculateNow: () => void;
  /** True whenever `state`'s routed result no longer matches the live
   * waypoints/profile/avoidFerries that would produce it — e.g. right
   * after any of those change, until the matching recalculation lands.
   * The caller must not let the rider save/export a stale result; see
   * canSaveOrExportPlan.ts. False whenever `state.kind !== "routed"`,
   * since there is no result to be stale. */
  isStale: boolean;
}

function deriveBaseState(waypoints: readonly Waypoint[]): PlanningRouteState {
  if (waypoints.length === 0) return { kind: "no-waypoints" };
  if (waypoints.length === 1) return { kind: "insufficient-waypoints" };
  return { kind: "unrouted-preview", waypoints };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

/** A deterministic, order-sensitive fingerprint of every route-affecting
 * Planning input — coordinate-based, never waypoint id (matching
 * routeLegs.ts's buildRouteLegKey convention exactly), so an edit that
 * replaces a waypoint's coordinate without changing its id is still
 * detected. Used only to detect whether the currently displayed routed
 * result still matches the live inputs that would produce it — never
 * exposed outside this hook. */
function computeRouteCalculationFingerprint(
  waypoints: readonly Waypoint[],
  profile: RoutingProfile,
  avoidFerries: boolean,
): string {
  return [profile, avoidFerries, ...waypoints.flatMap((w) => w.coordinate)].join("|");
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
    isFirstRouteForDraft: boolean;
    /** The fingerprint of the exact inputs that produced `route` —
     * compared against the hook's live props below to derive `isStale`.
     * Never surfaced outside this hook. */
    calculationFingerprint: string;
  } | null>(null);
  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [updatingLegCount, setUpdatingLegCount] = useState<number | null>(null);

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
  // Session-only leg cache, recreated whenever the adapter instance
  // changes — never persisted, never shared across a different provider.
  const legCacheRef = useRef<{ token: number; cache: RouteLegCache } | null>(null);
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

    const providerToken = getProviderInstanceToken(adapter);
    if (legCacheRef.current?.token !== providerToken) {
      legCacheRef.current = { token: providerToken, cache: new RouteLegCache() };
    }
    const legCache = legCacheRef.current.cache;

    setIsCalculating(true);
    setLastErrorMessage(null);

    const requirements = deriveLegRequirements(currentWaypoints);

    resolveRouteLegsInOrder(
      requirements,
      { profile: currentProfile, avoidFerries: currentAvoidFerries },
      {
        adapter,
        cache: legCache,
        providerToken,
        signal: controller.signal,
        onBatchStart: (missingLegCount) => {
          if (requestSeq !== requestSeqRef.current) return;
          setUpdatingLegCount(missingLegCount > 1 ? missingLegCount : null);
        },
      },
    )
      .then((legs) =>
        stitchPlannedRouteLegs(
          legs.map((leg) => leg.route),
          {
            id: createRouteId(),
            name: "Planned route",
            createdAt: new Date().toISOString(),
          },
        ),
      )
      .then((route) => {
        if (requestSeq !== requestSeqRef.current) return;
        setIsCalculating(false);
        setUpdatingLegCount(null);
        // Read before setRoutedResult below (which the effect further down
        // mirrors into hasRoutedResultRef) — captures whether this is the
        // first success for this draft, correct across any number of
        // earlier failed attempts, since a failure never reaches here.
        const isFirstRouteForDraft = !hasRoutedResultRef.current;
        setRoutedResult({
          route,
          waypoints: currentWaypoints,
          isFirstRouteForDraft,
          calculationFingerprint: computeRouteCalculationFingerprint(
            currentWaypoints,
            currentProfile,
            currentAvoidFerries,
          ),
        });
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
        setUpdatingLegCount(null);
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
    ? {
        kind: "routed",
        route: routedResult.route,
        waypoints: routedResult.waypoints,
        isFirstRouteForDraft: routedResult.isFirstRouteForDraft,
      }
    : deriveBaseState(waypoints);

  // Computed fresh every render off the hook's live props (never the
  // lagging latestRef, which only updates via its own effect) — so a
  // profile/avoidFerries/waypoint change is reflected as stale in the
  // very same render that changed it, before the debounce timer even
  // starts.
  const isStale =
    routedResult !== null &&
    routedResult.calculationFingerprint !==
      computeRouteCalculationFingerprint(waypoints, profile, avoidFerries);

  return {
    state,
    lastErrorMessage,
    isCalculating,
    updatingLegCount,
    calculateNow,
    isStale,
  };
}
