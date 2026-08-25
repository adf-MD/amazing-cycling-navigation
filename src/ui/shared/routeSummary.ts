export function formatDistanceKm(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

/** Just the numeric km value, no unit — for a "start–end km" range with
 * one trailing unit, unlike formatDistanceKm's own "X.X km" (used where
 * each figure stands alone). */
export function formatDistanceKmValue(metres: number): string {
  return (metres / 1000).toFixed(1);
}

export function formatMetres(metres: number): string {
  return `${String(Math.round(metres))} m`;
}

/** Signed percentage, e.g. "+7.0%" or "-11.2%" — used for gradient
 * figures where the sign itself is meaningful (climb vs descent). */
export function formatGradientPercent(gradientPercent: number): string {
  return `${gradientPercent > 0 ? "+" : ""}${gradientPercent.toFixed(1)}%`;
}

export function formatAscent(ascentMetres: number | null): string {
  return ascentMetres === null
    ? "ascent not available"
    : `${String(Math.round(ascentMetres))} m ascent`;
}

/** A tiered rounding policy for a distance-to-manoeuvre display, deliberately
 * coarser the closer the rounding granularity gets to typical consumer GPS
 * accuracy — never implying more precision than the fix actually supports.
 * This slice's own judgement call (CLAUDE.md only requires "increasingly
 * prominent inside 500 m", not a specific rounding scheme): >= 1000 m
 * reuses formatDistanceKm; 200-999 m rounds to the nearest 50 m; 50-199 m
 * rounds to the nearest 10 m; below 50 m rounds to the nearest 5 m. */
export function formatManoeuvreDistance(metres: number): string {
  const clamped = Math.max(0, metres);
  if (clamped >= 1000) return formatDistanceKm(clamped);
  const roundingMetres = clamped >= 200 ? 50 : clamped >= 50 ? 10 : 5;
  return `${String(Math.round(clamped / roundingMetres) * roundingMetres)} m`;
}

/** Thousands-separated whole number — used only for Settings' climb-score
 * thresholds (1,500 to 80,000), which read awkwardly with no separator.
 * Manual digit-grouping rather than toLocaleString, matching this module's
 * house style of small, explicit, environment-independent formatters. */
export function formatWholeNumber(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
