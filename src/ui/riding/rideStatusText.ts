/**
 * Small Riding-scoped text-formatting module, shared between
 * RidingStatusCard.tsx and FreeRoamStatusCard.tsx (backlog item 82) so the
 * two cards' GPS accuracy/freshness wording cannot drift apart again. Kept
 * in its own module rather than exported from either card component, so
 * neither file mixes a component export with plain function exports —
 * mirrors manoeuvreLabels.ts's own established rationale for this shape
 * (keeps both components Vite Fast-Refresh friendly).
 */

export function formatFixAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${String(seconds)}s ago`;
  return `${String(Math.round(seconds / 60))} min ago`;
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
export function formatGpsStatusLine({
  accuracyMetres,
  isStale,
  fixAgeMs,
}: GpsStatusLineParams): string {
  const ageSuffix = isStale && fixAgeMs !== null ? ` (${formatFixAge(fixAgeMs)})` : "";
  return `GPS ±${String(Math.round(accuracyMetres))} m · ${isStale ? `Stale${ageSuffix}` : "Live"}`;
}
