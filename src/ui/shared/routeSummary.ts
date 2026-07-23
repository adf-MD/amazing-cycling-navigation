export function formatDistanceKm(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

export function formatAscent(ascentMetres: number | null): string {
  return ascentMetres === null
    ? "ascent not available"
    : `${String(Math.round(ascentMetres))} m ascent`;
}
