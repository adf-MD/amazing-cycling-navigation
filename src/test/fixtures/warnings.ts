import type { RouteWarning } from "../../domain/types.ts";

/**
 * Synthetic RouteWarning fixtures for the kinds no producer currently
 * emits (only questionable-surface/unsuitable-surface come from a real
 * calculated route today, via normalizeOpenRouteServiceRoute.ts). These
 * are hand-constructed for tests only — not derived from, or verified
 * against, any live provider response — used solely to prove the
 * map/Planning presentation layers correctly handle every
 * RouteWarningKind ahead of any provider actually producing them.
 */

export const SYNTHETIC_UNKNOWN_SURFACE_WARNING: RouteWarning = {
  kind: "unknown-surface",
  startDistanceMetres: 100,
  endDistanceMetres: 250,
  message: "Surface not confirmed — may be unpaved.",
};

export const SYNTHETIC_ACCESS_WARNING: RouteWarning = {
  kind: "access",
  startDistanceMetres: 400,
  endDistanceMetres: 420,
  message: "Access may be restricted on this section.",
};

export const SYNTHETIC_STEPS_WARNING: RouteWarning = {
  kind: "steps",
  startDistanceMetres: 600,
  endDistanceMetres: 610,
  message: "Steps — dismount required.",
};

export const SYNTHETIC_FORD_WARNING: RouteWarning = {
  kind: "ford",
  startDistanceMetres: 800,
  endDistanceMetres: 815,
  message: "Ford crossing — may be impassable when water is high.",
};

export const SYNTHETIC_FERRY_WARNING: RouteWarning = {
  kind: "ferry",
  startDistanceMetres: 1000,
  endDistanceMetres: 1050,
  message: "Ferry crossing required.",
};

export const SYNTHETIC_OTHER_WARNING: RouteWarning = {
  kind: "other",
  startDistanceMetres: 1200,
  endDistanceMetres: 1230,
  message: "Route notice.",
};

/** One warning per RouteWarningKind not yet produced by a real provider,
 * spanning a >1230 m synthetic route so every warning's range is
 * distinct and non-overlapping. */
export const ALL_SYNTHETIC_WARNING_KINDS: readonly RouteWarning[] = [
  SYNTHETIC_UNKNOWN_SURFACE_WARNING,
  SYNTHETIC_ACCESS_WARNING,
  SYNTHETIC_STEPS_WARNING,
  SYNTHETIC_FORD_WARNING,
  SYNTHETIC_FERRY_WARNING,
  SYNTHETIC_OTHER_WARNING,
];
