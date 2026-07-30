import type { ManoeuvreProvenance, PlannedRoute } from "./types.ts";

// A Set, rather than a direct `=== / ===` comparison, so this genuinely
// checks membership rather than something TypeScript can already prove
// exhaustively true against ManoeuvreProvenance's current two variants —
// keeps this a real guard against a future non-trusted provenance kind.
const TRUSTED_PROVENANCE_KINDS: ReadonlySet<ManoeuvreProvenance["kind"]> = new Set([
  "routing-provider",
  "acn-gpx-extension",
]);

/**
 * Whether route.manoeuvres is safe to use for trusted next-manoeuvre
 * navigation (Riding's "next manoeuvre" panel, and GPX re-export). The
 * single source of truth for this decision — never re-derive it ad hoc
 * from source.kind elsewhere.
 *
 * A route with an explicit manoeuvreProvenance is trusted iff its kind is
 * one of the two recognised trusted kinds (a real discriminated check, not
 * merely presence, so a future non-trusted provenance kind could be added
 * without silently becoming trusted here).
 *
 * A route with NO manoeuvreProvenance (saved before this field existed, or
 * an ordinary GPX import that never carried a validated ACN extension)
 * falls back to the original implicit rule this app always used: trusted
 * iff it's a planner-sourced route with a non-empty manoeuvre list. This
 * keeps every pre-existing stored route and every ordinary GPX import
 * behaving exactly as before.
 */
export function hasTrustedManoeuvres(route: PlannedRoute): boolean {
  if (route.manoeuvres.length === 0) {
    return false;
  }
  if (route.manoeuvreProvenance) {
    return TRUSTED_PROVENANCE_KINDS.has(route.manoeuvreProvenance.kind);
  }
  return route.source.kind === "planner";
}
