import type { Translator } from "../../i18n/translate.ts";

/**
 * The application's shared unit formatters.
 *
 * Backlog item 113 stage 5. Stages 2, 3 and 4 each deferred this module
 * for the same reason — it is imported by Riding, Planning, Settings and
 * Status alike, so migrating it from any one of them would have dragged
 * the others in. Stage 5 owns the shared components, so it lands here.
 *
 * Every function takes the translator **explicitly**. None of them is a
 * component, several run inside imperative map layers, and the project's
 * rule is that a pure function never reads React context, storage,
 * `navigator` or a mutable global to discover the language.
 *
 * The numeric part is produced by `Intl.NumberFormat` with the
 * translator's own locale, never the host default. German gives `61,5`
 * and `80.000`, which is the whole point.
 *
 * **Each function rounds exactly as it did before, then hands `Intl` a
 * value that is already at the right precision.** That ordering is
 * load-bearing and was established by measurement, not assumed. Handing
 * `Intl` the raw number instead changes English output in three ways, all
 * of which a naive migration would have shipped silently:
 *
 * - `Math.round` rounds a half towards +∞, so `-0.5` becomes `-0`, while
 *   `Intl`'s default `halfExpand` rounds it away from zero, to `-1`;
 * - `String(-0)` is `"0"` but `Intl` renders `-0` as `"-0"`, so every
 *   small negative distance or elevation would have grown a minus sign;
 * - `(0.15).toFixed(1)` is `"0.1"`, because 0.15 is not exactly
 *   representable in binary, while `Intl` gives `"0.2"`.
 *
 * Rounding first and formatting the result reproduces the previous output
 * for all three. A probe over 400,029 values — every documented edge case
 * plus a large pseudo-random spread — found **no** difference in any of
 * the four formatters. `signDisplay` is deliberately not used for the same
 * reason: it inspects the rounded value, so a gradient of `-0.04` would
 * lose the minus sign the old code showed.
 */

function fixedOneDecimal(translator: Translator, value: number): string {
  return new Intl.NumberFormat(translator.locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  }).format(Number(value.toFixed(1)));
}

/** `Number(String(...))` rather than the bare rounded value: `Math.round`
 * yields `-0` for any small negative, and only the `String` round trip
 * collapses that to `0` the way the previous output did. */
function wholeNumber(translator: Translator, value: number, useGrouping = false): string {
  return new Intl.NumberFormat(translator.locale, {
    maximumFractionDigits: 0,
    useGrouping,
  }).format(Number(String(Math.round(value))));
}

export function formatDistanceKm(translator: Translator, metres: number): string {
  return translator.t("format.distanceKm", {
    distance: fixedOneDecimal(translator, metres / 1000),
  });
}

/** Just the numeric km value, no unit — for a "start–end km" range with
 * one trailing unit, unlike formatDistanceKm's own "X.X km" (used where
 * each figure stands alone). */
export function formatDistanceKmValue(translator: Translator, metres: number): string {
  return fixedOneDecimal(translator, metres / 1000);
}

export function formatMetres(translator: Translator, metres: number): string {
  return translator.t("format.metres", { metres: wholeNumber(translator, metres) });
}

/** Signed percentage, e.g. "+7.0%" or "-11.2%" — used for gradient
 * figures where the sign itself is meaningful (climb vs descent).
 *
 * The leading `+` is decided from the **raw** value, exactly as before, so
 * a shallow climb of `+0.04%` still reads `+0.0%`. A negative keeps the
 * minus the number formatter supplies. See this module's header for why
 * `signDisplay` is not used. */
export function formatGradientPercent(
  translator: Translator,
  gradientPercent: number,
): string {
  const magnitude = fixedOneDecimal(translator, gradientPercent);
  return translator.t("format.gradientPercent", {
    gradient: gradientPercent > 0 ? `+${magnitude}` : magnitude,
  });
}

export function formatAscent(
  translator: Translator,
  ascentMetres: number | null,
): string {
  return ascentMetres === null
    ? translator.t("format.ascentUnavailable")
    : translator.t("format.ascent", { metres: wholeNumber(translator, ascentMetres) });
}

/** The descent counterpart of formatAscent, for a recognised descent's own
 * elevationLossMetres (always a plain number, never null, unlike a whole
 * route's optional ascentMetres). */
export function formatDescentLoss(translator: Translator, lossMetres: number): string {
  return translator.t("format.descentLoss", {
    metres: wholeNumber(translator, lossMetres),
  });
}

/** A tiered rounding policy for a distance-to-manoeuvre display, deliberately
 * coarser the closer the rounding granularity gets to typical consumer GPS
 * accuracy — never implying more precision than the fix actually supports.
 * This slice's own judgement call (CLAUDE.md only requires "increasingly
 * prominent inside 500 m", not a specific rounding scheme): >= 1000 m
 * reuses formatDistanceKm; 200-999 m rounds to the nearest 50 m; 50-199 m
 * rounds to the nearest 10 m; below 50 m rounds to the nearest 5 m. */
export function formatManoeuvreDistance(translator: Translator, metres: number): string {
  const clamped = Math.max(0, metres);
  if (clamped >= 1000) return formatDistanceKm(translator, clamped);
  const roundingMetres = clamped >= 200 ? 50 : clamped >= 50 ? 10 : 5;
  return formatMetres(translator, Math.round(clamped / roundingMetres) * roundingMetres);
}

/** Thousands-separated whole number — used only for Settings' climb-score
 * thresholds (1,500 to 80,000), which read awkwardly with no separator.
 * Unlike every other formatter here this one carries no unit, so it needs
 * no catalogue entry: the grouping separator is the only locale-dependent
 * part, and `Intl` owns that. */
export function formatWholeNumber(translator: Translator, value: number): string {
  return wholeNumber(translator, value, true);
}
