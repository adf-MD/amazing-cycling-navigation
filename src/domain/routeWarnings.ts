import type { RouteWarning, RouteWarningKind } from "./types.ts";

/**
 * Semantic classification and identity for route warnings.
 *
 * Backlog item 113 stage 3. Warning copy used to be generated once, at
 * route-calculation time, and persisted with the route — so the stored
 * English sentence was the only thing that recorded what the warning
 * meant. Copy is now selected at render time from this semantic data
 * instead, which means old routes localise correctly with no migration,
 * no rewrite of stored data and no change to the GPX format.
 *
 * This lives in `domain` rather than beside the UI because identity is a
 * fact about the warning, not about how it is displayed: `navigation`'s
 * coalescing and the presentation layer must agree on when two warnings
 * are "the same warning", and neither should own that definition alone.
 */

/** Kinds produced by surface classification; these carry `surface` detail. */
const SURFACE_WARNING_KINDS: ReadonlySet<RouteWarningKind> = new Set([
  "unknown-surface",
  "questionable-surface",
  "unsuitable-surface",
]);

export function isSurfaceWarningKind(kind: RouteWarningKind): boolean {
  return SURFACE_WARNING_KINDS.has(kind);
}

/**
 * Kinds whose message is fully determined by the kind alone — steps, a
 * ford, a ferry, an access restriction, a construction-designated way.
 * They never carry surface detail.
 */
export function isStructuralWarningKind(kind: RouteWarningKind): boolean {
  return !isSurfaceWarningKind(kind);
}

/**
 * A stable key for "these two warnings say the same thing", independent of
 * the language they would be rendered in.
 *
 * Three cases, and the third is the honest one:
 *
 * 1. **Carries surface detail** — identity is `kind` plus `surface.type`.
 *    Safe because `surfaceCodes.ts`'s table maps type to label one-to-one
 *    in both directions, which this module's tests prove by enumerating
 *    the table rather than assuming it; if that ever stopped holding, the
 *    identity would need another field and those tests fail first.
 * 2. **Structural** — identity is the kind, since the kind alone selects
 *    the message.
 * 3. **A surface kind with no surface detail** — a warning saved before
 *    that field existed. Its stored message is the only remaining evidence
 *    of *which* surface it described, so it stays part of the identity.
 *    Dropping it would merge a legacy gravel stretch into a legacy sand
 *    one, a real loss of meaning; keeping it reproduces exactly the
 *    behaviour those warnings have always had.
 *
 * The distance range is deliberately excluded: coalescing exists to merge
 * adjacent ranges, so including it would defeat the purpose.
 *
 * Serialised as JSON rather than joined with a separator character, so no
 * two different warnings can collide through a message that happens to
 * contain whatever the separator would have been.
 */
export function routeWarningIdentity(warning: RouteWarning): string {
  if (warning.surface !== undefined) {
    return JSON.stringify([warning.kind, warning.surface.type, null]);
  }
  if (isStructuralWarningKind(warning.kind)) {
    return JSON.stringify([warning.kind, null, null]);
  }
  return JSON.stringify([warning.kind, null, warning.message]);
}
