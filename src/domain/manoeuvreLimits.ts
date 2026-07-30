/** Shared by routing/normalizeOpenRouteServiceRoute.ts (provider instructions)
 * and gpx/parseAcnExtension.ts (re-imported instructions) — both write into
 * Manoeuvre.instruction. Lives in domain/ so gpx/ never needs to depend on
 * routing/. */
export const MAX_MANOEUVRE_INSTRUCTION_LENGTH = 200;
