import type { RouteSurfaceDetail } from "../domain/types.ts";

export type SurfaceClassification =
  "paved" | "questionable-surface" | "unsuitable-surface";

/** classification is routing-internal — never stamped onto a domain
 * RouteWarning (only type/label are; see
 * normalizeOpenRouteServiceRoute.ts's pushSurfaceWarning). */
export interface DecodedSurface extends RouteSurfaceDetail {
  classification: SurfaceClassification | "unknown";
}

/** The shared "no usable surface information" result — returned for any
 * code absent from SURFACE_CODE_TABLE (a genuinely unrecognised code,
 * ORS's own documented code 0 "Unknown", a malformed value, or one of
 * the three codes ORS has since removed). Also used directly by
 * normalizeOpenRouteServiceRoute.ts for its "no classified data at all"
 * cases (whole route missing / a gap between classified ranges), so
 * every unknown-surface warning stamps the same detail regardless of
 * which code path produced it. */
export const UNKNOWN_SURFACE: DecodedSurface = {
  type: "unknown",
  label: "No usable surface data",
  classification: "unknown",
};

/**
 * OpenRouteService's numeric "surface" extra_info value codes, mapped to
 * this project's own specific SurfaceType/label plus its paved/
 * questionable/unsuitable classification (see CLAUDE.md's planning-
 * surface policy: strongly prefer paved roads, treat fine gravel/
 * compacted surfaces/paving stones as questionable rather than
 * universally suitable, and strongly discourage sand/grass/ground/rough
 * tracks).
 *
 * Verified byte-for-byte against ORS's live documentation
 * (https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/extra-info/surface,
 * page's own "Updated at" metadata: 2024-05-23).
 *
 * Deliberately absent: code 0 ("Unknown" — ORS's own documented "no
 * data" code) and codes 5, 9 and 16 (Cobblestone, Fine Gravel and
 * Woodchips respectively — the three codes the live ORS docs explicitly
 * mark "The strike-through values have been recently removed"). Giving a
 * removed code a stale meaning would risk silently mis-classifying a
 * surface it no longer describes; falling through to UNKNOWN_SURFACE via
 * the same path as any other unrecognised code is simpler and inherently
 * safe — missing/unrecognised surface data is uncertainty to expose,
 * never proof a road is unsuitable (or, just as importantly, proof it's
 * paved).
 *
 * Classification buckets are unchanged from the prior table for every
 * code that already existed correctly — this is a code-table correction
 * plus label addition, not a policy change. Worth noting for a future
 * reviewer: ORS's live table now folds the OSM `woodchips` tag into code
 * 2 "Unpaved" (bucketed "questionable-surface" here, as code 2 always
 * has been) rather than under the old code 16 (which this project's
 * prior, stale table had bucketed "unsuitable-surface"). That is ORS's
 * own code consolidation, not a deliberate reclassification here.
 */
const SURFACE_CODE_TABLE: Readonly<Record<number, DecodedSurface>> = {
  1: { type: "paved", label: "Paved", classification: "paved" },
  3: { type: "asphalt", label: "Asphalt", classification: "paved" },
  4: { type: "concrete", label: "Concrete", classification: "paved" },
  2: {
    type: "unpaved-unspecified",
    label: "Unpaved (unspecified)",
    classification: "questionable-surface",
  },
  6: { type: "metal", label: "Metal", classification: "questionable-surface" },
  7: { type: "wood", label: "Wood", classification: "questionable-surface" },
  8: {
    type: "compacted-gravel",
    label: "Compacted gravel",
    classification: "questionable-surface",
  },
  10: {
    type: "gravel",
    label: "Gravel / fine gravel",
    classification: "questionable-surface",
  },
  14: {
    type: "paving-stones",
    label: "Paving stones / cobblestone",
    classification: "questionable-surface",
  },
  18: {
    type: "grass-paver",
    label: "Grass paver",
    classification: "questionable-surface",
  },
  11: { type: "dirt", label: "Dirt", classification: "unsuitable-surface" },
  12: {
    type: "ground",
    label: "Ground or mud",
    classification: "unsuitable-surface",
  },
  13: { type: "ice", label: "Ice or snow", classification: "unsuitable-surface" },
  15: { type: "sand", label: "Sand", classification: "unsuitable-surface" },
  17: { type: "grass", label: "Grass", classification: "unsuitable-surface" },
};

/** Decodes one ORS surface extra_info value code into this project's own
 * specific surface detail and classification. Never throws: a
 * non-integer/NaN/negative/unrecognised/removed code all resolve safely
 * to UNKNOWN_SURFACE, matching the same Number.isInteger guard pattern
 * used for waytype/waycategory decoding elsewhere in this file's
 * sibling normalisation code. */
export function decodeSurfaceCode(code: number): DecodedSurface {
  if (!Number.isInteger(code)) return UNKNOWN_SURFACE;
  return SURFACE_CODE_TABLE[code] ?? UNKNOWN_SURFACE;
}
