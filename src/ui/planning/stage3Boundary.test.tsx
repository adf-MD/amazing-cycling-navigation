import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { englishTranslator } from "../../i18n/englishTranslator.ts";
import {
  describeGpxErrorDetail,
  describeGpxExportErrorDetail,
  describeGpxImportNotice,
} from "../library/gpxMessages.ts";
import { describeRoutingError } from "../../routing/routingErrorPresentation.ts";
import { RoutingError } from "../../routing/openRouteServiceErrors.ts";
import {
  describeRouteWarning,
  describeSurfaceWarningKind,
  formatSurfaceLabel,
} from "./routeWarningCopy.ts";
import { RouteSummaryPanel } from "./RouteSummaryPanel.tsx";
import type { PlannedRoute, RouteWarning } from "../../domain/types.ts";
import { OpenRouteServiceAdapter } from "../../routing/openRouteServiceAdapter.ts";
import { SUPPORTED_LANGUAGES, resolveLanguage } from "../../i18n/language.ts";

const t = englishTranslator;

describe("typed GPX errors keep every parameter and distinction", () => {
  it("renders the size limit from the typed detail, not from prose", () => {
    expect(describeGpxErrorDetail(t, { kind: "too-large", limitMb: 20 })).toBe(
      "The selected file is larger than the 20 MB limit.",
    );
    expect(describeGpxErrorDetail(t, { kind: "too-large", limitMb: 5 })).toContain(
      "5 MB",
    );
  });

  it("reproduces the file's own raw coordinate text exactly", () => {
    expect(
      describeGpxErrorDetail(t, {
        kind: "invalid-coordinate",
        longitude: "999.9",
        latitude: "abc",
      }),
    ).toBe("Point has an invalid or out-of-range coordinate (lon=999.9, lat=abc).");
  });

  it("says which attribute was absent rather than inventing a value", () => {
    expect(
      describeGpxErrorDetail(t, {
        kind: "invalid-coordinate",
        longitude: null,
        latitude: null,
      }),
    ).toBe("Point has an invalid or out-of-range coordinate (lon=missing, lat=missing).");
  });

  it("reproduces raw elevation text, including punctuation that looks like syntax", () => {
    // A file's own text is data. Braces in it must not be read as
    // catalogue placeholders.
    expect(
      describeGpxErrorDetail(t, { kind: "invalid-elevation", elevation: "{count}" }),
    ).toBe('Point has a non-numeric elevation value "{count}".');
  });

  it("keeps the two no-track-or-route cases distinct, which the reason alone could not", () => {
    const noPoints = describeGpxErrorDetail(t, { kind: "no-usable-points" });
    const noElement = describeGpxErrorDetail(t, { kind: "no-track-or-route" });
    expect(noPoints).toBe("The file has no usable track or route points.");
    expect(noElement).toBe("The file has no track or route to import.");
    expect(noPoints).not.toBe(noElement);
  });

  it("covers the remaining validation distinctions", () => {
    expect(describeGpxErrorDetail(t, { kind: "empty-file" })).toBe(
      "The selected file is empty.",
    );
    expect(describeGpxErrorDetail(t, { kind: "unsupported-type" })).toBe(
      "Only .gpx files are supported.",
    );
    expect(describeGpxErrorDetail(t, { kind: "malformed-xml" })).toBe(
      "The file is not well-formed GPX/XML.",
    );
    expect(describeGpxExportErrorDetail(t, { kind: "crypto-unavailable" })).toContain(
      "Export was cancelled",
    );
  });
});

describe("typed GPX notices keep their counts and severity", () => {
  it("renders the track count from the typed field", () => {
    expect(
      describeGpxImportNotice(t, {
        kind: "multiple-tracks-first-used",
        count: 2,
        message: "ignored",
      }),
    ).toBe("This file contains 2 tracks; only the first was imported.");
  });

  it("renders the route count from the typed field", () => {
    expect(
      describeGpxImportNotice(t, {
        kind: "multiple-routes-first-used",
        count: 7,
        message: "ignored",
      }),
    ).toBe("This file contains 7 routes; only the first was imported.");
  });

  it("keeps the two extension-rejection notices distinct", () => {
    const turns = describeGpxImportNotice(t, {
      kind: "acn-extension-rejected",
      message: "ignored",
    });
    const planning = describeGpxImportNotice(t, {
      kind: "acn-planning-extension-rejected",
      message: "ignored",
    });
    expect(turns).toContain("turn information");
    expect(planning).toContain("planning waypoints");
    expect(turns).not.toBe(planning);
  });
});

describe("provider failures keep their status and diagnostic meaning", () => {
  function routingError(options: Partial<ConstructorParameters<typeof RoutingError>[0]>) {
    return new RoutingError({ reason: "unknown", message: "developer text", ...options });
  }

  it("keeps the HTTP status in the rider-facing sentence", () => {
    expect(
      describeRoutingError(
        t,
        routingError({ reason: "provider-unavailable", httpStatus: 502 }),
      ),
    ).toBe(
      "OpenRouteService is temporarily unavailable (HTTP 502). Your waypoints have been retained. Try again later.",
    );
  });

  it("says 'error' rather than inventing a status when none was received", () => {
    expect(
      describeRoutingError(t, routingError({ reason: "provider-unavailable" })),
    ).toContain("(HTTP error)");
  });

  it("keeps the provider's own numeric code", () => {
    expect(
      describeRoutingError(
        t,
        routingError({ reason: "no-route-found", providerErrorCode: 2009 }),
      ),
    ).toContain("(provider code 2009)");
  });

  it("omits the code suffix entirely when none was supplied", () => {
    expect(
      describeRoutingError(t, routingError({ reason: "no-route-found" })),
    ).not.toContain("provider code");
  });

  it("still distinguishes a local key problem from an unreachable provider", () => {
    const local = describeRoutingError(
      t,
      routingError({ reason: "invalid-header-value" }),
    );
    const remote = describeRoutingError(t, routingError({ reason: "transport-failure" }));
    expect(local).toContain("cannot be sent in a request header");
    expect(remote).toContain("could not be reached");
    expect(local).not.toBe(remote);
  });

  it("never echoes the developer-facing message the error carries", () => {
    expect(describeRoutingError(t, routingError({ reason: "unknown" }))).not.toContain(
      "developer text",
    );
  });
});

describe("warning copy comes from semantic data, not the stored sentence", () => {
  function warning(overrides: Partial<RouteWarning> = {}): RouteWarning {
    return {
      kind: "questionable-surface",
      startDistanceMetres: 0,
      endDistanceMetres: 100,
      message: "STALE STORED TEXT",
      surface: { type: "gravel", label: "STALE STORED LABEL" },
      ...overrides,
    };
  }

  it("ignores a stale stored label and renders the current surface name", () => {
    expect(formatSurfaceLabel(t, "gravel")).toBe("Gravel / fine gravel");
    expect(describeRouteWarning(t, warning())).toBe(
      "Questionable surface for a road bike: Gravel / fine gravel.",
    );
  });

  it("derives the structural sentence from the kind alone", () => {
    for (const [kind, expected] of [
      ["steps", "Route includes steps."],
      ["ferry", "Route includes a ferry."],
      ["ford", "Route includes a ford."],
      ["other", "Route includes a construction-designated way."],
    ] as const) {
      expect(
        describeRouteWarning(t, warning({ kind, surface: undefined, message: "STALE" })),
      ).toBe(expected);
    }
  });

  it("falls back honestly for a warning saved before surface detail existed", () => {
    // No structured surface: the stored sentence is the only record of
    // which surface it described, so it is shown as saved rather than
    // guessed at.
    expect(
      describeRouteWarning(
        t,
        warning({
          surface: undefined,
          message: "Questionable surface for a road bike: gravel.",
        }),
      ),
    ).toBe("Questionable surface for a road bike: gravel.");
  });

  it("gives each surface kind its own short heading", () => {
    expect(describeSurfaceWarningKind(t, warning({ kind: "unknown-surface" }))).toBe(
      "Unknown surface",
    );
    expect(describeSurfaceWarningKind(t, warning({ kind: "unsuitable-surface" }))).toBe(
      "Unsuitable surface",
    );
  });
});

describe("Planning renders user-authored content verbatim", () => {
  // Route names are data. Braces in one are the rider's punctuation, not
  // catalogue placeholder syntax.
  const HOSTILE = "Straße {count} “Tour”";

  function plannedRoute(): PlannedRoute {
    return {
      id: "r1",
      name: HOSTILE,
      createdAt: "2026-01-01T00:00:00.000Z",
      points: [],
      manoeuvres: [],
      distanceMetres: 12345,
      ascentMetres: 210,
      descentMetres: 200,
      warnings: [],
      source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
    };
  }

  it("renders the routed-via line with a provider and profile", () => {
    render(
      <RouteSummaryPanel
        route={plannedRoute()}
        waypointCount={3}
        warnings={[]}
        gradientSegments={[]}
        revealToken={0}
        selectedWarningIndex={null}
        onSelectWarning={() => undefined}
        onClearWarningSelection={() => undefined}
      />,
    );
    expect(
      screen.getByText("Routed via openrouteservice · Road bike (cycling-road)"),
    ).toBeInTheDocument();
    expect(screen.getByText("3 waypoints")).toBeInTheDocument();
  });

  it("keeps a hostile route name intact through the message formatter", () => {
    // Not rendered by this panel, but proves the formatter itself is safe
    // for the same content Planning stores and the library displays.
    expect(t.t("routes.card.deleteConfirmTitle", { name: HOSTILE })).toBe(
      `Delete “${HOSTILE}”?`,
    );
  });
});

describe("the openrouteservice request is unchanged by this stage", () => {
  it("sends no language field, and exactly the body it always sent", async () => {
    // Requesting German instructions belongs to the stage that enables
    // German, not to this one. English serialisation must stay
    // byte-identical, and changing interface-language infrastructure must
    // never cause a provider request to differ. Captured from the real
    // adapter, not asserted against a hand-written object — otherwise this
    // would pass even if the adapter never ran.
    let capturedBody: string | undefined;
    const adapter = new OpenRouteServiceAdapter({
      getApiKey: () => Promise.resolve("dummy-test-key"),
      fetchImpl: async (input) => {
        capturedBody = await (input as Request).text();
        return new Response(JSON.stringify({ features: [] }), {
          status: 200,
          headers: { "Content-Type": "application/geo+json" },
        });
      },
    });

    await adapter
      .calculateRoute(
        [
          [1, 2],
          [3, 4],
        ],
        { profile: "cycling-road" },
      )
      .catch(() => undefined);

    expect(capturedBody).toBeDefined();
    const body: unknown = JSON.parse(capturedBody ?? "");
    expect(Object.keys(body as Record<string, unknown>)).toEqual([
      "coordinates",
      "elevation",
      "extra_info",
      "instructions",
    ]);
    expect(body).not.toHaveProperty("language");
  });
});

describe("the supported-language gate is untouched by this stage", () => {
  it("still offers English only", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["en"]);
  });

  it("still resolves a German device and a stored German preference to English", () => {
    expect(resolveLanguage("device", ["de-DE", "en-GB"])).toBe("en");
    expect(resolveLanguage("de", ["de-DE"])).toBe("en");
  });
});
