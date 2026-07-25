import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRoutingDiagnostics,
  describeRoutingAttempt,
  getRecentRoutingAttempts,
  recordRoutingAttempt,
  type RoutingAttemptDiagnostic,
} from "./routingDiagnostics.ts";

function buildDiagnostic(
  overrides: Partial<RoutingAttemptDiagnostic> = {},
): RoutingAttemptDiagnostic {
  return {
    timestampIso: "2026-01-01T00:00:00.000Z",
    providerId: "openrouteservice",
    endpointHost: "api.heigit.org",
    endpointPath: "/directions/cycling-road/geojson",
    wasOnline: true,
    elapsedMs: 120,
    responseReceived: true,
    category: "success",
    ...overrides,
  };
}

beforeEach(() => {
  clearRoutingDiagnostics();
});

describe("recordRoutingAttempt / getRecentRoutingAttempts", () => {
  it("stores the most recent attempt first", () => {
    recordRoutingAttempt(buildDiagnostic({ category: "success" }));
    recordRoutingAttempt(buildDiagnostic({ category: "timeout" }));

    expect(getRecentRoutingAttempts().map((entry) => entry.category)).toEqual([
      "timeout",
      "success",
    ]);
  });

  it("caps the log at 10 entries", () => {
    for (let i = 0; i < 15; i += 1) {
      recordRoutingAttempt(buildDiagnostic({ elapsedMs: i }));
    }

    expect(getRecentRoutingAttempts()).toHaveLength(10);
    expect(getRecentRoutingAttempts()[0]?.elapsedMs).toBe(14);
  });

  it("clearRoutingDiagnostics empties the log", () => {
    recordRoutingAttempt(buildDiagnostic());
    clearRoutingDiagnostics();

    expect(getRecentRoutingAttempts()).toEqual([]);
  });
});

describe("describeRoutingAttempt", () => {
  it("describes a received HTTP response, including the non-success reason", () => {
    expect(
      describeRoutingAttempt(
        buildDiagnostic({
          responseReceived: true,
          httpStatus: 502,
          category: "provider-unavailable",
        }),
      ),
    ).toBe("HTTP response received: 502 (provider-unavailable)");
  });

  it("describes a successful received response with no reason suffix", () => {
    expect(
      describeRoutingAttempt(
        buildDiagnostic({ responseReceived: true, httpStatus: 200, category: "success" }),
      ),
    ).toBe("HTTP response received: 200");
  });

  it("distinguishes offline from a request that timed out", () => {
    expect(
      describeRoutingAttempt(
        buildDiagnostic({ responseReceived: false, category: "offline" }),
      ),
    ).toBe("Device reported offline");
    expect(
      describeRoutingAttempt(
        buildDiagnostic({ responseReceived: false, category: "timeout" }),
      ),
    ).toBe("Request timed out");
  });

  it("reports a transport failure as indistinguishable from other causes, never guessing", () => {
    expect(
      describeRoutingAttempt(
        buildDiagnostic({ responseReceived: false, category: "transport-failure" }),
      ),
    ).toBe("Fetch failed before an HTTP response was exposed to the browser");
  });
});

describe("diagnostic content", () => {
  it("never carries a key-, header-, coordinate- or body-shaped field", () => {
    recordRoutingAttempt(
      buildDiagnostic({ httpStatus: 502, category: "provider-unavailable" }),
    );

    const [entry] = getRecentRoutingAttempts();
    expect(Object.keys(entry ?? {}).sort()).toEqual(
      [
        "timestampIso",
        "providerId",
        "endpointHost",
        "endpointPath",
        "wasOnline",
        "elapsedMs",
        "responseReceived",
        "httpStatus",
        "category",
      ].sort(),
    );
  });
});
