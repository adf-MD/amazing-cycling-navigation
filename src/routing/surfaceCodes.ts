export type SurfaceClassification =
  "paved" | "questionable-surface" | "unsuitable-surface";

/**
 * Maps OpenRouteService's numeric "surface" extra_info value codes to this
 * project's own paved/questionable/unsuitable/unknown classification
 * (see CLAUDE.md's planning-surface policy: strongly prefer paved roads,
 * treat fine gravel/compacted surfaces/paving stones as questionable
 * rather than universally suitable, and strongly discourage sand/grass/
 * ground/rough tracks).
 *
 * Sourced from research into ORS's publicly documented Extra Info surface
 * codes — NOT independently verified against a live response in this
 * session (this sandbox's outbound HTTPS fetch tool is unavailable for
 * all hosts). Spot-check this table against a real routed response once a
 * key exists, and treat it as the first thing to correct if surface
 * summaries look wrong. Codes absent from this table always resolve to
 * "unknown" — never "unsuitable-surface" and never an implied paved
 * status, per CLAUDE.md: missing/unrecognised surface data is uncertainty
 * to expose, not proof a road is unsuitable.
 */
const SURFACE_CODE_TO_CLASSIFICATION: Readonly<Record<number, SurfaceClassification>> = {
  1: "paved", // Paved
  3: "paved", // Asphalt
  4: "paved", // Concrete
  2: "questionable-surface", // Unpaved
  5: "questionable-surface", // Cobblestone
  6: "questionable-surface", // Metal
  7: "questionable-surface", // Wood
  8: "questionable-surface", // Compacted gravel
  9: "questionable-surface", // Fine gravel
  10: "questionable-surface", // Gravel
  14: "questionable-surface", // Paving stones
  18: "questionable-surface", // Grass paver
  11: "unsuitable-surface", // Dirt
  12: "unsuitable-surface", // Ground
  13: "unsuitable-surface", // Ice
  15: "unsuitable-surface", // Sand
  16: "unsuitable-surface", // Woodchips
  17: "unsuitable-surface", // Grass
};

export function classifySurfaceCode(code: number): SurfaceClassification | "unknown" {
  return SURFACE_CODE_TO_CLASSIFICATION[code] ?? "unknown";
}
