import type { OffRouteLevel } from "./types.ts";

export const POSSIBLY_OFF_ROUTE_BASE_METRES = 20;
export const OFF_ROUTE_BASE_METRES = 50;
export const ACCURACY_MULTIPLIER = 1.0;
export const MAX_TRUSTED_ACCURACY_METRES = 100;
export const CONSECUTIVE_TO_ESCALATE = 3;
export const CONSECUTIVE_TO_DEESCALATE = 2;

export type RawClassification = OffRouteLevel | "untrusted";

/** Classifies a single fix by lateral distance, with thresholds that inflate with reported GPS accuracy. */
export function classifyRawFix(
  lateralDistanceMetres: number,
  accuracyMetres: number,
): RawClassification {
  if (accuracyMetres > MAX_TRUSTED_ACCURACY_METRES) {
    return "untrusted";
  }

  const possiblyThreshold =
    POSSIBLY_OFF_ROUTE_BASE_METRES + accuracyMetres * ACCURACY_MULTIPLIER;
  const offThreshold = OFF_ROUTE_BASE_METRES + accuracyMetres * ACCURACY_MULTIPLIER;

  if (lateralDistanceMetres >= offThreshold) return "off-route";
  if (lateralDistanceMetres >= possiblyThreshold) return "possibly-off-route";
  return "on-route";
}

/**
 * As classifyRawFix, but a just-reacquired projection lock (e.g. after a
 * background gap) is always treated as untrusted for that one fix, so
 * resuming a ride never itself trips an off-route warning.
 */
export function classifyFix(
  lateralDistanceMetres: number,
  accuracyMetres: number,
  reacquired: boolean,
): RawClassification {
  if (reacquired) return "untrusted";
  return classifyRawFix(lateralDistanceMetres, accuracyMetres);
}

export interface OffRouteMachineState {
  level: OffRouteLevel;
  candidateLevel: OffRouteLevel | null;
  streak: number;
}

export const INITIAL_OFF_ROUTE_STATE: OffRouteMachineState = {
  level: "on-route",
  candidateLevel: null,
  streak: 0,
};

const LEVEL_ORDER: Record<OffRouteLevel, number> = {
  "on-route": 0,
  "possibly-off-route": 1,
  "off-route": 2,
};

function isEscalation(from: OffRouteLevel, to: OffRouteLevel): boolean {
  return LEVEL_ORDER[to] > LEVEL_ORDER[from];
}

/**
 * Escalating (on → possibly → off) requires CONSECUTIVE_TO_ESCALATE
 * matching fixes in a row; de-escalating requires CONSECUTIVE_TO_DEESCALATE.
 * An untrusted fix leaves the state — including any in-progress streak —
 * completely unchanged, rather than resetting it or counting toward a
 * different candidate. A direct off-route -> on-route jump is possible
 * once enough clean fixes arrive; there is no forced intermediate
 * "possibly" confirmation on the way down.
 */
export function nextOffRouteState(
  previous: OffRouteMachineState,
  raw: RawClassification,
): OffRouteMachineState {
  if (raw === "untrusted") {
    return previous;
  }

  if (raw === previous.level) {
    return { level: raw, candidateLevel: null, streak: 0 };
  }

  const streak = previous.candidateLevel === raw ? previous.streak + 1 : 1;
  const required = isEscalation(previous.level, raw)
    ? CONSECUTIVE_TO_ESCALATE
    : CONSECUTIVE_TO_DEESCALATE;

  if (streak >= required) {
    return { level: raw, candidateLevel: null, streak: 0 };
  }

  return { level: previous.level, candidateLevel: raw, streak };
}
