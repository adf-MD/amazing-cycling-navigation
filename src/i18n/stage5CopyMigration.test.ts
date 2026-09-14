import { describe, expect, it } from "vitest";

/**
 * Backlog item 113 stage 5: the scoped, named-module migration allowlist,
 * the same instrument stages 2, 3 and 4 each used for their own surface.
 *
 * Every entry is a literal that genuinely lived in that named module on
 * this stage's parent `f87a8b9`, so the whole list fails there and keeps
 * failing if any of it is reintroduced inline. Comments are stripped
 * first, because several of these modules quite properly quote their own
 * former wording while explaining what changed — without that the test
 * would pressure the next author to delete the explanation rather than
 * the literal.
 */

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  )
    .filter(([path]) => !path.includes(".test.") && !path.includes("/test/"))
    .map(([path, source]) => [path.replace(/^\.\.\//, "src/"), stripComments(source)]),
);

function read(path: string): string {
  const source = SOURCES[path];
  if (source === undefined) throw new Error(`No source found for ${path}`);
  return source;
}

const MIGRATED: Readonly<Record<string, readonly string[]>> = {
  "src/ui/diagnostics/DiagnosticsScreen.tsx": [
    'aria-label="Status"',
    ">Status</h1>",
    ">System status</h2>",
    ">App version</dt>",
    '"Not supported by this browser"',
    '"Not registered"',
    '"Waiting to activate"',
    '"Not yet requested"',
    '"Not applicable yet"',
    '"Testing…"',
    "Estimated app storage",
    "Checking storage estimate",
    "Storage pressure warning",
    "Geolocation permission",
    "Last known fix accuracy",
    "Last known fix age",
    "Active session",
    "Copy diagnostic report",
    "Copied to clipboard.",
    "Could not copy automatically",
    "Recent routing attempts",
    "Recent map imagery attempts",
    "No errors recorded this session.",
    "Why a fetch can fail before an HTTP response",
    "What HTTP statuses mean",
    "Add one in Settings to enable this test",
    "Headers constructed",
    "Fetch returned a promise",
    "Active service worker script",
    "Installed/standalone display",
    // The helpers that used to author their own text.
    "formatFixAge(ageMs",
    "STORAGE_BYTE_UNITS",
    "CONNECTION_TEST_STAGE_DESCRIPTIONS",
  ],
  "src/App.tsx": [
    '"Couldn\'t check for an unfinished ride"',
    "Whether you have an unfinished ride could not be checked",
    '"Discard and continue"',
    '"End and switch"',
    '"Discarding…"',
    '"Ending…"',
    '"Starting…"',
    "Discarding your unfinished ride…",
    "Ending your current ride…",
    "Starting free roam…",
    "Opening your paused ride…",
    '"Check again"',
    "an unfinished ride on another route",
    "an unfinished free roam session",
    "the saved route will remain in your library, but ",
    "This unfinished ride could not be ended on this device. Try again.",
    "Free roam could not be started on this device. Try again.",
    "This paused ride's status could not be checked. Try again.",
    "This route is no longer in your library",
    'cancelLabel="Cancel"',
    "An update is ready.",
    "Update now",
  ],
  "src/ui/shared/routeSummary.ts": [
    '"ascent not available"',
    "} km`",
    "} m`",
    "}%`",
    "m ascent`",
    "m loss`",
    "toFixed(1)}",
    'replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",")',
  ],
  "src/navigation/routeFeaturePalette.ts": [
    '"Uncategorised climb"',
    '"Category 1 climb"',
    '"HC climb"',
    "Recognised descent (moderate, 3% to just below 6%)",
    "Recognised descent (very steep, 9% or more)",
    "Uncategorised or Category 4 climb",
    "Gentle, flat or brief descent",
    "Extremely steep climb",
    "Shallower than the descent threshold",
    "Moderate descent",
    '"Below 3%"',
    '"12% or more"',
    '"dark red"',
    '"light blue"',
    "Ordinary route (including sections with missing",
  ],
  "src/ui/settings/providerKeyStatus.ts": [
    '"No key configured"',
    "Key saved on this device, not yet verified",
    "Key last verified ${",
    "Quota reached, retry after ${",
    'new Intl.DateTimeFormat("en-GB"',
  ],
  "src/routing/routingDiagnostics.ts": [
    "Device reported offline",
    "Request timed out",
    "The stored key could not be used in a request header",
    "Fetch could not be invoked",
    "Fetch promise rejected before an HTTP response was exposed",
    "HTTP response received: ${status}",
  ],
  "src/map/mapDiagnostics.ts": [
    "Map style failed to load or parse",
    "A map tile request failed",
    "This device or browser could not initialise map graphics (WebGL)",
    "Switched to the plain background",
    "Map imagery loaded successfully",
  ],
  "src/routing/routingConnectionTest.ts": [
    "No OpenRouteService key is configured, so no request was sent.",
    "The request's headers could not be constructed.",
    "A valid cycling route was received.",
    "An HTTP response was received from OpenRouteService.",
  ],
  "src/ui/diagnostics/activeSessionSummary.ts": [
    '"None"',
    '"Free roam"',
    '"Checking…"',
    '"Route unavailable"',
    '"Session unavailable"',
  ],
  "src/ui/shared/ElevationChart.tsx": [
    "No route loaded.",
    "Elevation data is not available for this route.",
    '"Elevation profile"',
    '"Elevation profile chart"',
    " (some sections have no elevation data)",
    "Current route position: ",
    "Last known position: ",
    "Distance guides ahead at ",
  ],
  "src/ui/shared/RouteFeatureDetailsPanel.tsx": [
    '"Route feature details"',
    '"Recognised descent"',
    '"Maximum"',
    '"Steepest"',
    "Route position: ",
    "Climb score: ",
  ],
  "src/ui/shared/GradientSegmentDetailsPanel.tsx": [
    '"Gradient segment details"',
    "Route position: ",
    "Elevation: ",
  ],
  "src/ui/shared/GradientColoursDisclosure.tsx": [
    "Gradient colours",
    "Recognised route features",
    "Detailed local gradient",
    "Overall climb colours depend on climb length and average gradient",
    "Detailed colours show local gradient over approximately",
  ],
  "src/ui/shared/RouteFeatureLegend.tsx": ["Recognised route features legend"],
  "src/ui/shared/ClearSelectionButton.tsx": ["Clear selection\n"],
  "src/ui/shared/ClimbCategoriesDisclosure.tsx": ["Climb categories<"],
  "src/ui/shared/ClimbGradientBandLegend.tsx": ["Detailed climb gradient legend"],
  "src/ui/shared/DescentLocalLegend.tsx": ["Detailed descent gradient legend"],
  "src/ui/shared/ClimbLocalGradientDisclosure.tsx": [
    "Local gradient colours on this climb<",
  ],
  "src/ui/shared/DescentLocalGradientDisclosure.tsx": [
    "Local gradient colours on this descent<",
  ],
  "src/ui/shared/ConfirmDialog.tsx": [
    'confirmLabel = "Confirm"',
    'cancelLabel = "Cancel"',
  ],
};

describe("stage 5 copy comes from the catalogue", () => {
  for (const [path, literals] of Object.entries(MIGRATED)) {
    describe(path, () => {
      const source = read(path);
      for (const literal of literals) {
        it(`no longer contains ${JSON.stringify(literal)} inline`, () => {
          expect(source).not.toContain(literal);
        });
      }
    });
  }
});

describe("stage 5's own helpers stay pure", () => {
  for (const path of [
    "src/ui/shared/routeSummary.ts",
    "src/ui/settings/providerKeyStatus.ts",
    "src/routing/routingDiagnostics.ts",
    "src/map/mapDiagnostics.ts",
    "src/ui/diagnostics/activeSessionSummary.ts",
  ]) {
    describe(path, () => {
      const source = read(path);

      it("takes a Translator rather than reaching for one", () => {
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
          "toLocaleDateString",
          "documentElement.lang",
        ]) {
          expect(source, forbidden).not.toContain(forbidden);
        }
      });

      it("never constructs an Intl object without an explicit locale", () => {
        const constructions = [...source.matchAll(/new Intl\.(\w+)\(([^,)]*)/g)];
        for (const [, kind, firstArgument] of constructions) {
          expect(firstArgument, `new Intl.${kind ?? "?"}`).toContain("translator.locale");
        }
      });
    });
  }
});

describe("the generic confirmation component authors no copy of its own", () => {
  const source = read("src/ui/shared/ConfirmDialog.tsx");

  it("requires both labels from its caller", () => {
    expect(source).toContain("confirmLabel: string;");
    expect(source).toContain("cancelLabel: string;");
  });

  it("never reads the language itself", () => {
    // A generic component whose whole value is holding no opinions must
    // not acquire one about the rider's language.
    expect(source).not.toContain("useTranslate");
    expect(source).not.toContain("Translator");
  });

  it("keeps its item-118 contract", () => {
    for (const kept of [
      "headingLevel",
      "containerRef",
      "autoFocus",
      "TITLE_TAGS",
      "Escape",
    ]) {
      expect(source, kept).toContain(kept);
    }
  });
});
