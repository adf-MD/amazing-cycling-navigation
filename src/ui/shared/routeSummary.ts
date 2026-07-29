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
