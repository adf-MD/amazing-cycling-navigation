import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { englishTranslator } from "../../i18n/englishTranslator.ts";
import { createTranslator } from "../../i18n/translate.ts";
import { catalogueFor } from "../../i18n/catalogues.ts";
import { SUPPORTED_LANGUAGES, resolveLanguage } from "../../i18n/language.ts";
import { describeActiveSession } from "./activeSessionSummary.ts";
import { describeProviderKeyStatus } from "../settings/providerKeyStatus.ts";
import { describeRoutingAttempt } from "../../routing/routingDiagnostics.ts";
import { describeMapAttempt } from "../../map/mapDiagnostics.ts";
import {
  describeConnectionTestStage,
  formatConnectionTestReport,
  type RoutingConnectionTestResult,
} from "../../routing/routingConnectionTest.ts";
import {
  formatAscent,
  formatDistanceKm,
  formatGradientPercent,
  formatMetres,
  formatWholeNumber,
} from "../shared/routeSummary.ts";
import {
  ROUTE_FEATURE_COLOURS,
  ROUTE_FEATURE_LABEL_KEYS,
  ROUTE_FEATURE_LEGEND_ENTRIES,
  MICRO_DETAIL_COLOURS,
  MICRO_DETAIL_LABEL_KEYS,
} from "../../navigation/routeFeaturePalette.ts";
import { RouteFeatureDetailsPanel } from "../shared/RouteFeatureDetailsPanel.tsx";
import type { StoredRideState } from "../../storage/db.ts";
import type { RoutingAttemptDiagnostic } from "../../routing/routingDiagnostics.ts";

const t = englishTranslator;

/** Hostile on purpose. Each of these is legal rider content or a real
 * provider/browser value, and each contains something that would break if
 * it were ever parsed as a catalogue message rather than substituted as
 * one. */
const HOSTILE_TEXT = [
  "My {weird} route",
  "status.session.none",
  "{count} Hügelweg",
  'Route "A" — 50% {distance}',
  "{{nested}}",
  "Große Straße {name}",
] as const;

function routeSession(routeId = "route-1"): StoredRideState {
  return {
    id: "active",
    kind: "route",
    routeId,
    startedAt: "2026-09-14T10:00:00.000Z",
  } as unknown as StoredRideState;
}

describe("active session: every state stays distinct, and names stay verbatim", () => {
  it("keeps the six states apart", () => {
    expect(describeActiveSession(t, undefined, undefined)).toBe("None");
    expect(
      describeActiveSession(
        t,
        { id: "active", kind: "free-roam" } as unknown as StoredRideState,
        undefined,
      ),
    ).toBe("Free roam");
    expect(describeActiveSession(t, routeSession(), undefined)).toBe("Checking…");
    expect(
      describeActiveSession(t, routeSession(), { routeId: "route-1", name: null }),
    ).toBe("Route unavailable");
    expect(
      describeActiveSession(
        t,
        { id: "active", kind: "something-new" } as unknown as StoredRideState,
        undefined,
      ),
    ).toBe("Session unavailable");
    // A result for a session that has since been replaced is never shown.
    expect(
      describeActiveSession(t, routeSession("route-2"), {
        routeId: "route-1",
        name: "Old route",
      }),
    ).toBe("Checking…");
  });

  for (const name of HOSTILE_TEXT) {
    it(`renders ${JSON.stringify(name)} verbatim`, () => {
      expect(describeActiveSession(t, routeSession(), { routeId: "route-1", name })).toBe(
        name,
      );
    });
  }

  it("never leaks the internal identifier", () => {
    const value = describeActiveSession(t, routeSession("a1b2c3-secret-id"), {
      routeId: "a1b2c3-secret-id",
      name: "Sunday loop",
    });
    expect(value).toBe("Sunday loop");
    expect(value).not.toContain("a1b2c3");
  });
});

describe("raw diagnostic values are substituted, never re-parsed", () => {
  function attempt(
    overrides: Partial<RoutingAttemptDiagnostic>,
  ): RoutingAttemptDiagnostic {
    return {
      attemptId: "a1",
      timestampIso: "2026-09-14T10:00:00.000Z",
      providerId: "openrouteservice",
      endpointHost: "api.openrouteservice.org",
      endpointPath: "/v2/directions/cycling-road/geojson",
      httpMethod: "POST",
      wasOnline: true,
      isSecureContext: true,
      isServiceWorkerControlled: false,
      isStandalone: false,
      waypointCount: 2,
      elapsedMs: 120,
      headersConstructed: true,
      requestConstructed: true,
      fetchInvoked: true,
      fetchReturnedPromise: true,
      responseReceived: false,
      category: "transport-failure",
      ...overrides,
    };
  }

  it("passes a brace-bearing sanitised error message through untouched", () => {
    // This is the exact failure the stage 2 boundary fix exists to
    // prevent, now on a value the rider never chose: a sanitised
    // transport message that happens to contain placeholder syntax must
    // be substituted as data, not treated as catalogue syntax.
    const line = describeRoutingAttempt(
      t,
      attempt({ errorName: "TypeError", errorMessage: "Failed to fetch {host}" }),
    );
    expect(line).toBe(
      "Fetch promise rejected before an HTTP response was exposed (TypeError: Failed to fetch {host})",
    );
  });

  it("keeps HTTP statuses and provider categories exact", () => {
    expect(
      describeRoutingAttempt(
        t,
        attempt({ responseReceived: true, httpStatus: 200, category: "success" }),
      ),
    ).toBe("HTTP response received: 200");
    expect(
      describeRoutingAttempt(
        t,
        attempt({ responseReceived: true, httpStatus: 429, category: "rate-limited" }),
      ),
    ).toBe("HTTP response received: 429 (rate-limited)");
    expect(describeRoutingAttempt(t, attempt({ responseReceived: true }))).toBe(
      "HTTP response received: unknown (transport-failure)",
    );
  });

  it("appends a reason code verbatim", () => {
    expect(
      describeRoutingAttempt(
        t,
        attempt({ transportFailureReasonCode: "generic-fetch-rejection" }),
      ),
    ).toBe(
      "Fetch promise rejected before an HTTP response was exposed (reason: generic-fetch-rejection)",
    );
  });

  it("describes a map attempt from its category alone", () => {
    expect(
      describeMapAttempt(t, {
        timestampIso: "2026-09-14T10:00:00.000Z",
        category: "webgl-init-failure",
      } as Parameters<typeof describeMapAttempt>[1]),
    ).toBe("This device or browser could not initialise map graphics (WebGL)");
  });
});

describe("the copied diagnostic report stays English (decision R4)", () => {
  const result: RoutingConnectionTestResult = {
    attemptId: "attempt-1",
    outcome: "failure",
    stage: "transport-response-unavailable",
    message: "OpenRouteService could not be reached.",
    elapsedMs: 340,
    waypointCount: 2,
    headersConstructed: true,
    requestConstructed: true,
    fetchInvoked: true,
    fetchReturnedPromise: true,
    responseReceived: false,
    errorName: "TypeError",
    errorMessage: "Failed to fetch",
    transportFailureReasonCode: "generic-fetch-rejection",
    isSecureContext: true,
    isServiceWorkerControlled: true,
    isStandalone: false,
    activeServiceWorkerScriptUrl: "https://example.test/sw.js",
  } as RoutingConnectionTestResult;

  it("keeps its field labels, machine tokens and URLs exactly as they were", () => {
    const report = formatConnectionTestReport(result);
    for (const line of [
      "OpenRouteService connection test report",
      "Attempt ID: attempt-1",
      "Outcome: failure",
      "Stage: transport-response-unavailable — The browser did not expose an HTTP response.",
      "Error: TypeError: Failed to fetch",
      "Safe reason code: generic-fetch-rejection",
      "Elapsed: 340 ms",
      "Secure context: yes",
      "Installed/standalone display: no",
      "Active service worker script: https://example.test/sw.js",
    ]) {
      expect(report, line).toContain(line);
    }
  });

  it("reads its one shared sentence through the English translator", () => {
    // The Status screen's own Stage row follows the rider; the report does
    // not. One function, one sentence, two languages — which is what makes
    // the report English by construction rather than by omission.
    const german = createTranslator("en", catalogueFor("en"));
    expect(describeConnectionTestStage(german, "success")).toBe(
      describeConnectionTestStage(englishTranslator, "success"),
    );
    expect(formatConnectionTestReport(result)).toContain(
      describeConnectionTestStage(englishTranslator, "transport-response-unavailable"),
    );
  });
});

describe("dates, numbers and ages use an explicit locale", () => {
  it("keeps the key-verification timestamp in UTC, and says so", () => {
    const status = describeProviderKeyStatus(
      t,
      { id: "ors", apiKey: "k", savedAt: "2026-09-14T16:04:00.000Z" } as never,
      { id: "ors", outcome: "verified", checkedAt: "2026-09-14T16:04:00.000Z" } as never,
      Date.parse("2026-09-14T17:00:00.000Z"),
    );
    // The zone is a promise about what the record means, not a
    // presentation preference, so it must not drift to local time.
    expect(status.headline).toBe("Key last verified 14 Sept 2026, 16:04 UTC");
  });

  it("formats every figure from the translator's locale, not the host's", () => {
    expect(formatDistanceKm(t, 61_500)).toBe("61.5 km");
    expect(formatDistanceKm(t, 1_234_560)).toBe("1234.6 km");
    expect(formatMetres(t, 1234.6)).toBe("1235 m");
    expect(formatAscent(t, 993)).toBe("993 m ascent");
    expect(formatAscent(t, null)).toBe("ascent not available");
    expect(formatWholeNumber(t, 1500)).toBe("1,500");
    expect(formatWholeNumber(t, 80_000)).toBe("80,000");
  });

  it("keeps the rounding and sign behaviour that preceded the migration", () => {
    // Each of these was measured against the previous implementation.
    // Math.round rounds a half towards +infinity; String(-0) is "0"; and
    // toFixed(1) reads 0.15 as 0.1 because it is not exactly
    // representable. Intl agrees with none of the three on its own.
    expect(formatMetres(t, -0.5)).toBe("0 m");
    expect(formatMetres(t, -0.4)).toBe("0 m");
    expect(formatGradientPercent(t, 0.15)).toBe("+0.1%");
    expect(formatGradientPercent(t, -0.15)).toBe("-0.1%");
    // A shallow climb still shows its plus sign even though it rounds to
    // zero, and a shallow descent still shows its minus.
    expect(formatGradientPercent(t, 0.04)).toBe("+0.0%");
    expect(formatGradientPercent(t, -0.04)).toBe("-0.0%");
    expect(formatGradientPercent(t, 0)).toBe("0.0%");
    expect(formatGradientPercent(t, 7)).toBe("+7.0%");
    expect(formatGradientPercent(t, -11.234)).toBe("-11.2%");
  });
});

describe("route-feature identity is the key, never the rendered name", () => {
  it("selects a colour from the identifier alone", () => {
    for (const key of Object.keys(
      ROUTE_FEATURE_LABEL_KEYS,
    ) as (keyof typeof ROUTE_FEATURE_LABEL_KEYS)[]) {
      expect(ROUTE_FEATURE_COLOURS[key], key).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // Uncategorised and Category 4 deliberately share a colour, and are
    // distinguished by their labels — which is exactly why a label must
    // never be used as identity.
    expect(ROUTE_FEATURE_COLOURS.uncategorised).toBe(ROUTE_FEATURE_COLOURS["category-4"]);
    expect(ROUTE_FEATURE_LABEL_KEYS.uncategorised).not.toBe(
      ROUTE_FEATURE_LABEL_KEYS["category-4"],
    );
  });

  it("keys every legend row on its visual keys, not on its text", () => {
    for (const entry of ROUTE_FEATURE_LEGEND_ENTRIES) {
      expect(entry.visualKeys.length).toBeGreaterThan(0);
      expect(entry.colour).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof entry.labelKey).toBe("string");
      expect(entry.labelKey.startsWith("feature.")).toBe(true);
    }
    const allKeys = ROUTE_FEATURE_LEGEND_ENTRIES.flatMap((entry) => entry.visualKeys);
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });

  it("gives every micro-detail key a colour and a label key", () => {
    for (const key of Object.keys(
      MICRO_DETAIL_COLOURS,
    ) as (keyof typeof MICRO_DETAIL_COLOURS)[]) {
      expect(MICRO_DETAIL_LABEL_KEYS[key], key).toBeDefined();
    }
  });

  it("renders the English name from the key", () => {
    expect(t.t(ROUTE_FEATURE_LABEL_KEYS["category-3"])).toBe("Category 3 climb");
    expect(t.t(ROUTE_FEATURE_LABEL_KEYS.hc)).toBe("HC climb");
    expect(t.t(ROUTE_FEATURE_LABEL_KEYS.moderate)).toBe(
      "Recognised descent (moderate, 3% to just below 6%)",
    );
  });

  it("shows the same swatch colour whatever the heading says", () => {
    const feature = {
      id: "climb-1000",
      kind: "climb" as const,
      category: "category-2" as const,
      startDistanceMetres: 1000,
      endDistanceMetres: 3000,
      lengthMetres: 2000,
      elevationGainMetres: 140,
      averageGradientPercent: 7,
      maxGradientPercent: 11.2,
      climbScore: 1400,
    };
    const plain = render(<RouteFeatureDetailsPanel feature={feature} />);
    expect(screen.getByText("Category 2 climb")).toBeInTheDocument();
    const plainSwatch = document.querySelector(".gradient-colour-swatch");
    const plainColour = plainSwatch?.getAttribute("style");
    plain.unmount();

    // The numbered heading is different copy for the same feature. The
    // colour must not move with it.
    render(<RouteFeatureDetailsPanel feature={feature} climbNumber={2} />);
    expect(screen.getByText("Climb 2 · Category 2")).toBeInTheDocument();
    expect(document.querySelector(".gradient-colour-swatch")?.getAttribute("style")).toBe(
      plainColour,
    );
    expect(screen.getByText("Average gradient: +7.0%")).toBeInTheDocument();
    expect(screen.getByText("Maximum local gradient: +11.2%")).toBeInTheDocument();
    expect(screen.getByText("Climb score: 1400")).toBeInTheDocument();
  });
});

describe("the English-only gate is untouched by this stage", () => {
  it("still offers English only", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["en"]);
  });

  it("still resolves a German device and a stored German preference to English", () => {
    expect(resolveLanguage("device", ["de-DE", "en-GB"])).toBe("en");
    expect(resolveLanguage("de", ["de-DE"])).toBe("en");
    expect(resolveLanguage("device", ["fr-FR", "de-AT"])).toBe("en");
  });
});
