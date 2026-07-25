import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMapDiagnostics,
  describeMapAttempt,
  getRecentMapAttempts,
  recordMapAttempt,
  type MapAttemptDiagnostic,
} from "./mapDiagnostics.ts";

function buildDiagnostic(
  overrides: Partial<MapAttemptDiagnostic> = {},
): MapAttemptDiagnostic {
  return {
    timestampIso: "2026-01-01T00:00:00.000Z",
    tileProviderId: "openfreemap-liberty",
    category: "fallback-activated",
    wasOnline: true,
    justResumed: false,
    ...overrides,
  };
}

beforeEach(() => {
  clearMapDiagnostics();
});

describe("recordMapAttempt / getRecentMapAttempts", () => {
  it("stores the most recent attempt first", () => {
    recordMapAttempt(buildDiagnostic({ category: "fallback-activated" }));
    recordMapAttempt(buildDiagnostic({ category: "manual-retry" }));

    expect(getRecentMapAttempts().map((entry) => entry.category)).toEqual([
      "manual-retry",
      "fallback-activated",
    ]);
  });

  it("caps the log at 10 entries", () => {
    for (let i = 0; i < 15; i += 1) {
      recordMapAttempt(buildDiagnostic({ timestampIso: String(i) }));
    }

    expect(getRecentMapAttempts()).toHaveLength(10);
    expect(getRecentMapAttempts()[0]?.timestampIso).toBe("14");
  });

  it("clearMapDiagnostics empties the log", () => {
    recordMapAttempt(buildDiagnostic());
    clearMapDiagnostics();

    expect(getRecentMapAttempts()).toEqual([]);
  });
});

describe("describeMapAttempt", () => {
  it.each([
    ["style-request-or-parse-failure", /style/i],
    ["tile-request-failure", /tile/i],
    ["sprite-failure", /sprite/i],
    ["worker-failure", /worker/i],
    ["webgl-init-failure", /webgl/i],
    ["initial-load-timeout", /ready in time/i],
    ["fallback-activated", /plain background/i],
    ["manual-retry", /retry requested/i],
    ["auto-retry", /automatically/i],
    ["imagery-recovered", /loaded successfully/i],
  ] as const)("describes %s in plain language", (category, expected) => {
    expect(describeMapAttempt(buildDiagnostic({ category }))).toMatch(expected);
  });
});

describe("diagnostic content", () => {
  it("never carries a coordinate, key, header or raw-URL-shaped field", () => {
    recordMapAttempt(
      buildDiagnostic({ category: "tile-request-failure", justResumed: true }),
    );

    const [entry] = getRecentMapAttempts();
    expect(Object.keys(entry ?? {}).sort()).toEqual(
      ["timestampIso", "tileProviderId", "category", "wasOnline", "justResumed"].sort(),
    );
  });
});
