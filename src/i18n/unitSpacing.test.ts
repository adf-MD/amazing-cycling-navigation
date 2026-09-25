import { describe, expect, it } from "vitest";
import { en } from "./messages.en.ts";
import { de } from "./messages.de.ts";
import type { MessageEntry } from "./catalogue.ts";
import { englishTranslator } from "./englishTranslator.ts";
import { createTranslator } from "./translate.ts";
import { formatDistanceKm, formatMetres } from "../ui/shared/routeSummary.ts";
import { describeRoutingError } from "../routing/routingErrorPresentation.ts";
import {
  describeConnectionTestStage,
  type RoutingConnectionTestStage,
} from "../routing/routingConnectionTest.ts";
import {
  RoutingError,
  type RoutingErrorReason,
} from "../routing/openRouteServiceErrors.ts";

/**
 * Item 113's 25 September 2026 follow-up. On the installed iPhone the
 * Planning warning rows broke `261` / `m` across two lines, and Settings
 * broke German `3` / `%`. Every number–unit pair in both catalogues now
 * joins with U+00A0, so the pair moves to the next line as a whole.
 *
 * U+00A0 rather than the narrow U+202F: the latter may be missing from
 * MapLibre's glyph ranges, and U+00A0 renders at a space's own width in
 * the DOM and in SVG alike.
 *
 * In scope: unit symbols, and `Höhenmeter`, which is visible in Planning
 * and the pre-ride summary. Out of scope: spelled-out units such as
 * `kilometres` or `Kilometer`, which only ever reach an accessible name
 * or an announcement, where a line break is never painted.
 */

const UNIT = "(?:m|km|ms|min|MB|B|KiB|MiB|GiB|TiB|Hm|%|Höhenmeter)";
const VALUE = "(?:\\{[^{}]+\\}|\\d)";
// Deliberately not global: `test()` on a global RegExp keeps `lastIndex`
// between calls, which would skip matches across entries.
const ORDINARY_SPACE_PAIR = new RegExp(
  `${VALUE} ${UNIT}(?![\\p{L}\\p{N}])|(?<!\\p{L})km ${VALUE}`,
  "u",
);
const NBSP_PAIR = new RegExp(
  `${VALUE}\u00a0${UNIT}(?![\\p{L}\\p{N}])|(?<!\\p{L})km\u00a0${VALUE}`,
  "gu",
);

function texts(catalogue: Record<string, MessageEntry>): [string, string][] {
  return Object.entries(catalogue).flatMap(([key, entry]) =>
    typeof entry === "string"
      ? [[key, entry] as [string, string]]
      : Object.values(entry)
          .filter((value): value is string => typeof value === "string")
          .map((value) => [key, value] as [string, string]),
  );
}

describe("number–unit pairs never break", () => {
  it("the rule matches what it claims to", () => {
    expect(ORDINARY_SPACE_PAIR.test("{metres} m")).toBe(true);
    expect(ORDINARY_SPACE_PAIR.test("unter 3 %")).toBe(true);
    expect(ORDINARY_SPACE_PAIR.test("ab km {start}")).toBe(true);
    expect(ORDINARY_SPACE_PAIR.test("{count} mit")).toBe(false);
    expect("{metres}\u00a0m".match(NBSP_PAIR)).toHaveLength(1);
  });

  for (const [language, catalogue] of [
    ["en", en],
    ["de", de],
  ] as const) {
    it(`uses a non-breaking space in every ${language} pair`, () => {
      const offenders = texts(catalogue)
        .filter(([, text]) => ORDINARY_SPACE_PAIR.test(text))
        .map(([key]) => key);
      expect(offenders).toEqual([]);
    });
  }

  it("still has the pairs it protects", () => {
    // Pinned from below so a rule that silently stopped matching cannot
    // pass as "no offenders".
    const count = (catalogue: Record<string, MessageEntry>) =>
      texts(catalogue).reduce(
        (total, [, text]) => total + (text.match(NBSP_PAIR)?.length ?? 0),
        0,
      );
    expect(count(en)).toBeGreaterThanOrEqual(29);
    expect(count(de)).toBeGreaterThanOrEqual(32);
  });

  it("reaches the formatted output", () => {
    const german = createTranslator("de", de);
    expect(formatMetres(german, 261)).toBe("261\u00a0m");
    expect(formatDistanceKm(german, 15_400)).toBe("15,4\u00a0km");
    expect(formatMetres(englishTranslator, 261)).toBe("261\u00a0m");
  });
});

describe("the copied diagnostic report stays plain text", () => {
  // The report is English by construction (decision R4) and is pasted
  // into messages and issues, where a non-breaking space would defeat a
  // plain-text search. None of its catalogue-derived sentences carries a
  // unit today; this sweeps every one so that stays true.
  const REASONS: Record<RoutingErrorReason, true> = {
    "no-api-key": true,
    "invalid-header-value": true,
    "header-construction-failure": true,
    "invalid-request-construction": true,
    "fetch-invocation-failure": true,
    unauthorized: true,
    forbidden: true,
    "rate-limited": true,
    offline: true,
    "transport-failure": true,
    timeout: true,
    "no-route-found": true,
    "no-routable-point": true,
    "provider-unavailable": true,
    "provider-error": true,
    "malformed-response": true,
    "no-geometry": true,
    "leg-stitching-failed": true,
    unknown: true,
  };
  const STAGES: Record<RoutingConnectionTestStage, true> = {
    "not-attempted-no-key": true,
    "invalid-key-syntax": true,
    "header-construction": true,
    "request-construction": true,
    "fetch-invocation": true,
    offline: true,
    timeout: true,
    "transport-response-unavailable": true,
    "http-response": true,
    "response-parsing": true,
    "route-processing": true,
    success: true,
  };

  it("has no non-breaking space in any routing-error description", () => {
    for (const reason of Object.keys(REASONS) as RoutingErrorReason[]) {
      for (const extras of [{}, { httpStatus: 503, providerErrorCode: 2009 }]) {
        const text = describeRoutingError(
          englishTranslator,
          new RoutingError({ reason, message: "internal", ...extras }),
        );
        expect(text, reason).not.toContain("\u00a0");
      }
    }
  });

  it("has no non-breaking space in any stage description", () => {
    for (const stage of Object.keys(STAGES) as RoutingConnectionTestStage[]) {
      expect(describeConnectionTestStage(englishTranslator, stage), stage).not.toContain(
        "\u00a0",
      );
    }
  });
});
