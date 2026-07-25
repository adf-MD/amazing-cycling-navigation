import { useSyncExternalStore } from "react";

/**
 * A sanitised record of one map-imagery lifecycle event, for the
 * Diagnostics screen. Deliberately limited to values safe to show or
 * export as-is: booleans, a closed category union, a timestamp, and the
 * configured tile provider's own short id (e.g. "openfreemap-liberty",
 * never a raw tile/style URL). Never the rider's position, route
 * coordinates, or a raw provider error message/URL.
 *
 * Glyph (label) fetch failures are deliberately not a category here —
 * verified against the installed MapLibre version, it swallows these
 * internally with only a console.warn and fires no event of any kind, so
 * there is no way to detect them today. Reported as a genuine platform
 * gap rather than a category that could never actually be produced.
 */
export type MapDiagnosticCategory =
  | "style-request-or-parse-failure"
  | "tile-request-failure"
  | "sprite-failure"
  /** Inferred from the existing stuck-route-source timeout (GeoJSON
   * processing is dispatched to MapLibre's worker) — the worker itself
   * has no error channel MapLibre exposes, so this is a proxy signal,
   * not a directly observed worker crash. */
  | "worker-failure"
  | "webgl-init-failure"
  | "initial-load-timeout"
  | "fallback-activated"
  | "manual-retry"
  | "auto-retry"
  | "imagery-recovered";

export interface MapAttemptDiagnostic {
  timestampIso: string;
  tileProviderId: string;
  category: MapDiagnosticCategory;
  wasOnline: boolean;
  /** True only for the auto-retry-on-resume path (visibilitychange,
   * online, or pageshow while fallback is active) — false for every
   * other category, including manual-retry. */
  justResumed: boolean;
}

const MAX_ENTRIES = 10;

let entries: MapAttemptDiagnostic[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function recordMapAttempt(diagnostic: MapAttemptDiagnostic): void {
  entries = [diagnostic, ...entries].slice(0, MAX_ENTRIES);
  notify();
}

export function getRecentMapAttempts(): readonly MapAttemptDiagnostic[] {
  return entries;
}

export function subscribeMapDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearMapDiagnostics(): void {
  entries = [];
  notify();
}

export function useRecentMapAttempts(): readonly MapAttemptDiagnostic[] {
  return useSyncExternalStore(subscribeMapDiagnostics, getRecentMapAttempts);
}

const CATEGORY_LABEL: Record<MapDiagnosticCategory, string> = {
  "style-request-or-parse-failure": "Map style failed to load or parse",
  "tile-request-failure": "A map tile request failed",
  "sprite-failure": "Map sprite (icons) failed to load",
  "worker-failure": "The map's background worker did not respond in time",
  "webgl-init-failure":
    "This device or browser could not initialise map graphics (WebGL)",
  "initial-load-timeout": "Map style did not become ready in time",
  "fallback-activated": "Switched to the plain background",
  "manual-retry": "Map imagery retry requested",
  "auto-retry":
    "Map imagery retry attempted automatically after resuming or reconnecting",
  "imagery-recovered": "Map imagery loaded successfully",
};

/** Plain-language label for one recorded attempt, for the Diagnostics
 * screen — never interpolates anything beyond the closed category label
 * itself, so this is always safe to render as-is. */
export function describeMapAttempt(entry: MapAttemptDiagnostic): string {
  return CATEGORY_LABEL[entry.category];
}
