import type { ManoeuvreType } from "../domain/types.ts";

/**
 * OpenRouteService's numeric directions-step "type" codes, mapped to this
 * project's own canonical, provider-independent ManoeuvreType. Never
 * throws: a non-integer, out-of-range or otherwise unrecognised raw value
 * resolves to "unknown", matching the never-throws convention already
 * established by decodeSurfaceCode in surfaceCodes.ts.
 *
 * Two deliberate collapses, both judgement calls rather than provider
 * documentation gaps: codes 7 ("Enter roundabout") and 8 ("Exit
 * roundabout") both map to the single canonical "roundabout" (this app has
 * no separate enter/exit concept); codes 12 ("Keep left") and 13 ("Keep
 * right") map to "slight-left"/"slight-right" respectively, since a "keep"
 * manoeuvre reads to a rider the same way a gentle bear does. In both
 * cases the paired ORS instruction text (when present) still carries the
 * more specific detail.
 *
 * This function never returns "waypoint" — that value is synthesised only
 * by stitchPlannedRouteLegs.ts when it collapses a leg-boundary
 * finish+start pair, never by decoding a single raw step in isolation.
 */
const ORS_MANOEUVRE_TYPE_TABLE: Readonly<Record<number, ManoeuvreType>> = {
  0: "left",
  1: "right",
  2: "sharp-left",
  3: "sharp-right",
  4: "slight-left",
  5: "slight-right",
  6: "continue",
  7: "roundabout",
  8: "roundabout",
  9: "u-turn",
  10: "finish",
  11: "start",
  12: "slight-left",
  13: "slight-right",
};

export function decodeOrsManoeuvreType(raw: number | string): ManoeuvreType {
  if (typeof raw === "string" && raw.trim() === "") return "unknown";
  const code = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(code)) return "unknown";
  return ORS_MANOEUVRE_TYPE_TABLE[code] ?? "unknown";
}
