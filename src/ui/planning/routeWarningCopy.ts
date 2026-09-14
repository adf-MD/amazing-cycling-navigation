import type { RouteWarning, SurfaceType } from "../../domain/types.ts";
import { isStructuralWarningKind } from "../../domain/routeWarnings.ts";
import type { ParameterlessMessageKey, Translator } from "../../i18n/translate.ts";

/**
 * Rider-facing copy for a route warning, selected at render time from the
 * warning's own semantic data.
 *
 * Backlog item 113 stage 3. Warning text used to be generated once, when
 * the route was calculated, and stored with it — so a route saved last
 * year carries last year's English sentence forever. Deriving the text
 * here instead means an existing route localises correctly with **no
 * migration, no rewrite of stored data and no change to the GPX format**:
 * `kind` and `surface.type` were already being persisted alongside the
 * message, and they are all this needs.
 *
 * `warning.message` is still read, but only as the honest fallback for a
 * warning that predates `surface` (see below). It is deliberately not
 * removed from the stored shape: it is what the diagnostics log and any
 * other reader of an older route still see.
 *
 * Pure, and takes its translator explicitly — no React context, no
 * storage, no ambient locale.
 */

// Typed as the parameterless subset, so a key that needs interpolation
// cannot be listed here and then called without its parameters.
const SURFACE_LABEL_KEYS: Readonly<Record<SurfaceType, ParameterlessMessageKey>> = {
  unknown: "surface.unknown",
  paved: "surface.paved",
  asphalt: "surface.asphalt",
  concrete: "surface.concrete",
  "unpaved-unspecified": "surface.unpavedUnspecified",
  metal: "surface.metal",
  wood: "surface.wood",
  "compacted-gravel": "surface.compactedGravel",
  gravel: "surface.gravel",
  "paving-stones": "surface.pavingStones",
  "grass-paver": "surface.grassPaver",
  dirt: "surface.dirt",
  ground: "surface.ground",
  ice: "surface.ice",
  sand: "surface.sand",
  grass: "surface.grass",
};

/**
 * A surface's display name.
 *
 * Keyed on `type`, never on the stored `label`, which makes an older
 * route's stale wording correct itself — the surface table was corrected
 * once already, and a route saved before that carries the old label. Safe
 * because type and label determine each other one-to-one, proved by
 * enumeration in `src/domain/routeWarnings.test.ts`.
 */
export function formatSurfaceLabel(
  translator: Translator,
  surfaceType: SurfaceType,
): string {
  return translator.t(SURFACE_LABEL_KEYS[surfaceType]);
}

/** The short heading used for a warning row that carries surface detail. */
export function describeSurfaceWarningKind(
  translator: Translator,
  warning: RouteWarning,
): string {
  switch (warning.kind) {
    case "unknown-surface":
      return translator.t("warning.surfaceKind.unknown");
    case "questionable-surface":
      return translator.t("warning.surfaceKind.questionable");
    case "unsuitable-surface":
      return translator.t("warning.surfaceKind.unsuitable");
    default:
      // Unreachable in practice — `surface` is only ever set for the
      // three kinds above — but total rather than throwing, matching the
      // defensive style this replaced.
      return translator.t("warning.surfaceKind.other");
  }
}

/**
 * The full sentence for a warning.
 *
 * Three cases, mirroring `routeWarningIdentity`:
 *
 * 1. **Structural** — the kind alone selects the sentence.
 * 2. **Surface, with detail** — the kind selects the frame and
 *    `surface.type` the surface name. Note the English frame no longer
 *    lower-cases the first letter of the surface name the way the stored
 *    message did: that trick only works in a language where a common noun
 *    is lower-case mid-sentence, and it is now the catalogue's business
 *    how the two fit together.
 * 3. **Surface, no detail** — a warning saved before `surface` existed.
 *    Its stored sentence is the only record of which surface it described,
 *    so it is shown as saved. That is an honest fallback, not a missing
 *    translation: inventing a key here would mean guessing which surface a
 *    rider's own saved route was talking about.
 */
export function describeRouteWarning(
  translator: Translator,
  warning: RouteWarning,
): string {
  if (isStructuralWarningKind(warning.kind)) {
    switch (warning.kind) {
      case "steps":
        return translator.t("warning.structural.steps");
      case "ferry":
        return translator.t("warning.structural.ferry");
      case "ford":
        return translator.t("warning.structural.ford");
      case "access":
        return translator.t("warning.structural.access");
      default:
        return translator.t("warning.structural.other");
    }
  }

  if (warning.surface === undefined) {
    return warning.message;
  }

  const surface = formatSurfaceLabel(translator, warning.surface.type);
  switch (warning.kind) {
    case "questionable-surface":
      return translator.t("warning.surface.questionable", { surface });
    case "unsuitable-surface":
      return translator.t("warning.surface.unsuitable", { surface });
    default:
      return translator.t("warning.surface.unknown");
  }
}
