import { describe, expect, it } from "vitest";
import { en } from "../../i18n/messages.en.ts";

/**
 * Backlog item 113 stage 4: the scoped, named-module allowlist stage 2
 * introduced for the Route Library and stage 3 extended to Planning, now
 * covering route Riding, free roam, the ride launcher, the climb views
 * and the map layers.
 *
 * Deliberately not a repository-wide English sweep. Every entry below is
 * a literal that genuinely lived in that named module on this stage's
 * parent, so the whole list fails there and keeps failing if any of it is
 * reintroduced inline. A repository-wide grep would instead flag the
 * catalogue itself, test fixtures and every rider-supplied route name.
 */

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../{ui/riding,map}/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  )
    .filter(([path]) => !path.includes(".test."))
    .map(([path, source]) => [path, stripComments(source)]),
);

function readModule(name: string): string {
  const match = Object.entries(SOURCES).find(([path]) => path.endsWith(`/${name}`));
  if (!match) throw new Error(`No source found for ${name}`);
  return match[1];
}

const MIGRATED_LITERALS: Readonly<Record<string, readonly string[]>> = {
  "RidingStatusCard.tsx": [
    "On route",
    "Possibly off route",
    "Off route",
    "Waiting for a GPS fix",
    "GPS error",
    "Offline",
    "kilometres remaining",
    "metres ascent remaining",
    "ascent remaining not available",
    "ascent unavailable",
    "Retry map imagery",
  ],
  "FreeRoamStatusCard.tsx": [
    '"Location"',
    "Location — signal lost",
    "Waiting for a GPS fix",
    "GPS error",
    "Retry map imagery",
  ],
  "rideStatusText.ts": ["s ago", " min ago", "Stale${", '"Live"', "GPS ±"],
  "manoeuvreLabels.ts": [
    "Turn left",
    "Turn right",
    "Sharp left turn",
    "Sharp right turn",
    "Bear left",
    "Bear right",
    "Continue straight ahead",
    "Go through the roundabout",
    "Make a U-turn",
    "Arrive at the finish",
    "Start of route",
    "Continue on the route",
    '"Waypoint"',
  ],
  "RidingNextManoeuvrePanel.tsx": [" — based on your last known position"],
  "RidingCompactManoeuvreCue.tsx": [" — last known position"],
  "RidingScreen.tsx": [
    "Follow my location",
    "North-up, top-down view",
    "Zoom in",
    "Zoom out",
    "Waiting…",
    "End this ride?",
    "Ending ride…",
    "Pausing…",
    "The ride could not be ended on this device. Try again.",
    "The ride could not be paused on this device. Try again.",
    "Finish ride could not be completed on this device. Try again.",
    "Location access is needed to track your progress on this ride.",
    "This browser does not support location services.",
    "Your location is currently unavailable.",
    "Resume riding to continue tracking your progress.",
    "Replace your current draft?",
    "Replace and edit",
    "Creating editable copy…",
    "Your existing draft could not be checked. Try again.",
    "Elevation profile view",
    "Elevation profile for selected recognised descent",
  ],
  "FreeRoamScreen.tsx": [
    "Follow my location",
    "North-up, top-down view",
    "Zoom out",
    "Waiting…",
    '"Free roam"',
    "End this ride?",
    "Ending ride…",
    "Pausing…",
    "Free roam could not be paused on this device. Try again.",
    "The ride could not be ended on this device. Try again.",
    "Your free roam position and camera state will be cleared.",
    "This browser does not support location services.",
    "Your location is currently unavailable.",
  ],
  "RidingLauncher.tsx": [
    "Start free roam",
    "Resume free roam",
    "Resume ride",
    "Starting…",
    "Resuming…",
    "Ending ride…",
    "Discarding…",
    "End this ride?",
    "End ride",
    "Discard unfinished ride?",
    "Discard unfinished ride",
    "You have an unfinished ride on this route.",
    "You have an unfinished free roam session.",
    "Your free roam position and camera state will be cleared.",
    "This unfinished ride can't be recovered by this version of the app.",
    "This unfinished ride could not be discarded on this device. Try again.",
    "The ride could not be ended on this device. Try again.",
    "Free roam could not be ended on this device. Try again.",
  ],
  "RidingClimbCue.tsx": ["Climb active", "View climb"],
  "RidingClimbSelector.tsx": [
    "All route",
    "Recognised climbs",
    "No recognised climbs",
    "A recognised climb must be at least",
    "starts at",
  ],
  "RidingClimbPreviewPanel.tsx": ["Climb preview"],
  "RidingClimbProgressPanel.tsx": ["Climb progress"],
  "RidingRouteCompletionPanel.tsx": ["Finishing ride…", "Route complete"],
  "RidingSelectedFeatureSummaryPanel.tsx": [
    "Selected feature summary",
    "Recognised descent",
    "Starts in ",
    " ago`",
    " remaining`",
  ],
  "RidingUntrustedGpxNotice.tsx": [
    "No turn cues",
    "No trusted turn information is available for this imported GP",
    "Follow the route line on the map",
  ],
  "RidingWakeLockControl.tsx": [
    "Screen on",
    "The screen could not be kept awake",
    "Tap to try again",
  ],
  "MapView.tsx": ["Map is taking longer than expected to load."],
  "mapImageryRecoveryPresentation.ts": [
    "Map failed to load. Check your connection and try again.",
    "Map imagery unavailable. Your position is still shown.",
    "Map imagery unavailable — showing your route on a plain background.",
  ],
  "distanceBadgeLayer.ts": ["kilometre${", 'join(" and ")', "from route start`"],
  "planningLayer.ts": ["Start waypoint 1", "`Waypoint ${"],
};

describe("Riding, free-roam and map copy come from the catalogue", () => {
  for (const [moduleName, literals] of Object.entries(MIGRATED_LITERALS)) {
    if (literals.length === 0) continue;
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

describe("the copy helpers these surfaces own stay pure", () => {
  for (const moduleName of [
    "manoeuvreLabels.ts",
    "rideStatusText.ts",
    "mapImageryRecoveryPresentation.ts",
    "distanceBadgeLayer.ts",
    "planningLayer.ts",
  ]) {
    describe(moduleName, () => {
      const source = readModule(moduleName);

      it("takes a Translator rather than reaching for one", () => {
        expect(source).toContain("Translator");
        expect(source).not.toContain("useTranslate");
        expect(source).not.toContain("englishTranslator");
      });

      it("reads no ambient locale", () => {
        // An imperative map layer runs outside React entirely, so an
        // ambient read here would be invisible to the provider and would
        // silently format in the host's language.
        for (const forbidden of [
          "navigator.",
          "useContext",
          "toLocaleLowerCase",
          "toLocaleString",
          "documentElement.lang",
        ]) {
          expect(source, forbidden).not.toContain(forbidden);
        }
      });

      it("never constructs an Intl object without an explicit locale", () => {
        // `new Intl.ListFormat()` with no locale silently adopts the host
        // default. Every construction must pass translator.locale.
        const constructions = [...source.matchAll(/new Intl\.(\w+)\(([^)]*)/g)];
        for (const [, kind, args] of constructions) {
          expect(args, `new Intl.${kind ?? "?"}`).toContain("translator.locale");
        }
      });
    });
  }
});

describe("the stage-4 catalogue keys", () => {
  it("exist for every migrated surface", () => {
    const keys = Object.keys(en);
    for (const prefix of [
      "ride.",
      "freeRoam.",
      "launcher.",
      "climb.",
      "manoeuvre.",
      "map.",
    ]) {
      expect(
        keys.some((key) => key.startsWith(prefix)),
        prefix,
      ).toBe(true);
    }
  });

  it("covers every manoeuvre type with its own label key", () => {
    for (const key of [
      "manoeuvre.left",
      "manoeuvre.right",
      "manoeuvre.sharpLeft",
      "manoeuvre.sharpRight",
      "manoeuvre.slightLeft",
      "manoeuvre.slightRight",
      "manoeuvre.continue",
      "manoeuvre.roundabout",
      "manoeuvre.uTurn",
      "manoeuvre.finish",
      "manoeuvre.start",
      "manoeuvre.waypoint",
      "manoeuvre.fallback",
    ] as const) {
      expect(typeof en[key], key).toBe("string");
    }
  });

  it("keeps the two map-imagery surfaces as separate keys", () => {
    // Route riding says the route is still shown; free roam must not.
    // One shared key would make that distinction impossible to translate.
    const keys = Object.keys(en).filter((key) => key.startsWith("map.imagery."));
    for (const state of ["delayed", "tileError", "fallback"] as const) {
      expect(keys, state).toContain(`map.imagery.${state}.route`);
      expect(keys, state).toContain(`map.imagery.${state}.freeRoam`);
    }
    // `load-error` is the one state that genuinely says the same thing in
    // both surfaces, so it is deliberately a single key.
    expect(keys).toContain("map.imagery.loadError");
  });
});
