/**
 * Small Riding-scoped text-formatting module, shared between
 * RidingStatusCard.tsx and FreeRoamStatusCard.tsx (backlog item 82) so the
 * two cards' GPS accuracy/freshness wording cannot drift apart again. Kept
 * in its own module rather than exported from either card component, so
 * neither file mixes a component export with plain function exports —
 * mirrors manoeuvreLabels.ts's own established rationale for this shape
 * (keeps both components Vite Fast-Refresh friendly).
 */

import type { Translator } from "../../i18n/translate.ts";

export function formatFixAge(translator: Translator, ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return translator.t("ride.fixAge.seconds", { seconds });
  return translator.t("ride.fixAge.minutes", {
    minutes: Math.round(seconds / 60),
  });
}

export interface GpsStatusLineParams {
  accuracyMetres: number;
  isStale: boolean;
  fixAgeMs: number | null;
}

/**
 * Route Riding's original wording convention, now shared: `GPS ±N m ·
 * Live`, `GPS ±N m · Stale (Ns ago | N min ago)`, or `GPS ±N m · Stale`
 * when the fix age itself is unknown. A fresh (non-stale) fix never shows
 * an age, even when fixAgeMs is non-null.
 */
export function formatGpsStatusLine(
  translator: Translator,
  { accuracyMetres, isStale, fixAgeMs }: GpsStatusLineParams,
): string {
  const freshness = !isStale
    ? translator.t("ride.gpsFresh")
    : fixAgeMs !== null
      ? translator.t("ride.gpsStaleWithAge", {
          age: formatFixAge(translator, fixAgeMs),
        })
      : translator.t("ride.gpsStale");
  return translator.t("ride.gpsStatus", {
    accuracy: Math.round(accuracyMetres),
    freshness,
  });
}
