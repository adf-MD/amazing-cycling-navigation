import { describe, expect, it } from "vitest";
import { en } from "../../i18n/messages.en.ts";

/**
 * Backlog item 113 stage 3: the same scoped, named-module allowlist stage 2
 * introduced for the Route Library, extended to Planning, route warnings,
 * the GPX domain and the routing-provider presenter.
 *
 * Precise by construction, not a repository-wide English sweep: every
 * entry is a literal that genuinely used to live in that module, so the
 * test fails on the parent commit and keeps failing if any of it is
 * reintroduced inline.
 */

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../{ui/planning,routing,gpx}/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).map(([path, source]) => [path, stripComments(source)]),
);

function readModule(name: string): string {
  const match = Object.entries(SOURCES).find(([path]) => path.endsWith(`/${name}`));
  if (!match) throw new Error(`No source found for ${name}`);
  return match[1];
}

const MIGRATED_LITERALS: Readonly<Record<string, readonly string[]>> = {
  "PlanningScreen.tsx": [
    '"Planning"',
    "Plan a route",
    "Loading your draft",
    "Your saved draft could not be loaded",
    "Zoom in",
    "Zoom out",
    "North-up, top-down view",
    "Locate me",
    "Your location could not be determined.",
    "Clear the selected warning to place or move a waypoint.",
    "Waypoint actions",
    "Return to start",
    "Reverse route",
    "Add to end",
    "Calculate route",
    "Try again",
    "Cycling profile for this draft",
    "Avoid ferries for this draft",
    "Save or export",
    "Clear this draft?",
    "Saved routes are not affected.",
    "Calculate a complete routed result before saving or exporting.",
    "The route could not be saved on this device. Try again.",
    "The draft could not be cleared on this device. Try again.",
    "The route could not be exported.",
    "Reversed editable copy created.",
    "Routing: ",
    " route sections",
  ],
  "RouteSummaryPanel.tsx": [
    "Route summary",
    "Route overview",
    "m descent",
    "waypoint{waypointCount",
    "Routed via ",
    "unknown provider",
    "Surface breakdown",
    "Based on available data only",
    "Route warnings",
    "Clear warning selection",
    "Selected warning: ",
    "Unknown surface",
    "Questionable surface",
    // The stored message is no longer the source of a warning's text.
    "warning.message",
    "warning.surface.label",
  ],
  "WaypointList.tsx": [
    "No waypoints yet.",
    '"Waypoints"',
    '"Start"',
    "`Waypoint ${",
    "`Move ${label}",
    "`Delete ${label}`",
    "`${label} actions`",
    "Insert after",
  ],
  "NoApiKeyNotice.tsx": [
    "Road routing requires your personal OpenRouteService key.",
    "Open Settings",
  ],
  "planningInteractionMode.ts": [
    "Add waypoint here",
    "the start",
    "`waypoint ${",
    "`Move ${",
    "`Insert after ${",
  ],
  "describeStaleRouteStatus.ts": ["Recalculating", "Waiting to recalculate"],
  "usePlanningRoute.ts": ["The route could not be calculated. Try again."],
  "routingProfiles.ts": [
    "Road bike",
    "General cycling",
    "Prefers roads suitable",
    "cycling infrastructure",
  ],
  "routingErrorPresentation.ts": [
    "Road routing requires your personal",
    "was rejected. Check it in Settings.",
    "The routing rate limit was reached.",
    "You are offline.",
    "could not be reached.",
    "temporarily unavailable (HTTP",
    "provider code ",
    "unusable response",
    "could not be joined into one continuous route",
  ],
  "routeWarningCopy.ts": [
    // The describer must not reintroduce inline prose of its own.
    "Questionable surface for a road bike",
    "Route includes steps.",
  ],
};

describe("Planning and its domain copy come from the catalogue", () => {
  for (const [moduleName, literals] of Object.entries(MIGRATED_LITERALS)) {
    describe(moduleName, () => {
      const source = readModule(moduleName);
      for (const literal of literals) {
        it(`no longer contains ${JSON.stringify(literal)} inline`, () => {
          expect(source).not.toContain(literal);
        });
      }
    });
  }
});

describe("the copy helpers Planning owns stay pure", () => {
  for (const moduleName of [
    "planningInteractionMode.ts",
    "describeStaleRouteStatus.ts",
    "routeWarningCopy.ts",
    "routingProfiles.ts",
    "routingErrorPresentation.ts",
  ]) {
    describe(moduleName, () => {
      const source = readModule(moduleName);

      it("takes a Translator rather than reading one", () => {
        expect(source).toContain("Translator");
        expect(source).not.toContain("useTranslate");
        expect(source).not.toContain("englishTranslator");
      });

      it("reads no ambient locale", () => {
        for (const forbidden of [
          "navigator.",
          "useContext",
          "toLocaleLowerCase",
          "toLocaleString",
        ]) {
          expect(source, forbidden).not.toContain(forbidden);
        }
      });
    });
  }
});

describe("the GPX domain reports data, not sentences", () => {
  it("gives every parse error a typed detail", () => {
    const source = readModule("errors.ts");
    expect(source).toContain("GpxErrorDetail");
    expect(source).toContain("limitMb");
    expect(source).toContain("longitude");
    expect(source).toContain("elevation");
  });

  it("distinguishes the two no-track-or-route cases that share one reason", () => {
    // Three throw sites share `reason: "no-track-or-route"` but produce
    // two different sentences, so the reason alone could never have
    // reconstructed the text. The detail kind is finer than the reason.
    const source = readModule("errors.ts");
    expect(source).toContain("no-usable-points");
    expect(source).toContain('"no-track-or-route": "no-track-or-route"');
  });

  it("carries the track and route counts as numbers on the notice", () => {
    const source = readModule("parseGpx.ts");
    expect(source).toContain("count: tracks.length");
    expect(source).toContain("count: routes.length");
  });
});

describe("the stage-3 catalogue keys", () => {
  it("exist for every migrated surface", () => {
    const keys = Object.keys(en);
    for (const prefix of [
      "planning.",
      "routeSummary.",
      "warning.",
      "surface.",
      "routingError.",
      "gpx.error.",
      "gpx.notice.",
      "routingProfile.",
    ]) {
      expect(
        keys.some((key) => key.startsWith(prefix)),
        prefix,
      ).toBe(true);
    }
  });

  it("covers every surface type with its own label key", () => {
    for (const key of [
      "surface.unknown",
      "surface.paved",
      "surface.asphalt",
      "surface.concrete",
      "surface.unpavedUnspecified",
      "surface.metal",
      "surface.wood",
      "surface.compactedGravel",
      "surface.gravel",
      "surface.pavingStones",
      "surface.grassPaver",
      "surface.dirt",
      "surface.ground",
      "surface.ice",
      "surface.sand",
      "surface.grass",
    ] as const) {
      expect(typeof en[key], key).toBe("string");
    }
  });
});
