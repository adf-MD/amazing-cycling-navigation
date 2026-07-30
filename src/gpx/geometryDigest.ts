import type { Coordinate } from "../domain/types.ts";

/**
 * Deterministic textual form of a track's coordinate sequence, used as the
 * input to the geometry-binding digest (see computeGeometryDigestHex).
 * Each point is `lon,lat`, points joined by "\n". Elevation is
 * deliberately excluded — manoeuvre anchoring is index/distance-based, not
 * elevation-based (CLAUDE.md's geometry-canonicalisation guidance).
 *
 * Longitude/latitude are stringified with plain `String(x)` — the exact
 * same stringification exportGpx.ts already uses for `<trkpt lat lon>`
 * attribute values (no explicit rounding either side). This is what makes
 * export-time and import-time canonicalisation provably agree:
 * `Number(String(x)) === x` for every finite double per the JS spec, so
 * `String(Number(String(x))) === String(x)` — a value written out and
 * re-parsed always re-stringifies identically.
 */
export function canonicalizeTrackGeometry(coordinates: readonly Coordinate[]): string {
  return coordinates
    .map(([longitude, latitude]) => `${String(longitude)},${String(latitude)}`)
    .join("\n");
}

/**
 * Lower-case hex SHA-256 digest of a canonicalised geometry string, via the
 * Web Crypto API (no dependency, no custom cryptographic implementation).
 * This is an integrity/binding check between a GPX file's ACN navigation
 * extension and its own track geometry — not a digital signature and not
 * proof of authorship.
 */
export async function computeGeometryDigestHex(canonical: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonical);
  const digestBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digestBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
