import { describe, expect, it } from "vitest";
import { en } from "./messages.en.ts";

/**
 * Backlog item 113 stage 5: the classified residual-copy audit.
 *
 * Stage 5 completes the English catalogue migration, so this is the test
 * that says what is deliberately left outside it and proves the list is
 * still true. It is **not** a repository-wide English grep: such a sweep
 * flags the catalogue itself, every explanatory comment, every identifier
 * and every fixture, and the pressure it creates is to delete the
 * explanation rather than the literal.
 *
 * Instead it reads production sources, strips comments, and checks each
 * named exclusion is still where this audit says it is — and, for the
 * ones that matter, that the rider-facing path really does go through the
 * catalogue instead.
 *
 * The seven categories, and what each means here:
 *
 * 1. **Provider or product name** — `OpenRouteService`, `OpenStreetMap`,
 *    `OpenFreeMap Liberty`, `GPX`, `ACN`. Names, not copy.
 * 2. **Machine token** — a schema key, an HTTP status, a URL, a GeoJSON
 *    type, a `KeyboardEvent.key`, a DOMException name, a diagnostic-report
 *    field label.
 * 3. **User-authored or imported content** — a route name, a tag, a
 *    provider manoeuvre instruction, a road name.
 * 4. **Internal identifier** — a CSS class, a `data-testid`, a filename,
 *    a screen key.
 * 5. **Retained English compatibility or diagnostic data** — a stored
 *    `Error.message` or `RouteWarning.message` that the interface no
 *    longer renders, kept so diagnostics, the error log and old stored
 *    data continue to mean what they always did.
 * 6. **Deferred to stage 6** — the language-selection copy itself.
 * 7. **Genuine missed rider-facing copy** — there is none; anything found
 *    in this class is migrated rather than listed.
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

describe("category 5 — retained English that the interface no longer renders", () => {
  // Each of these modules still authors an English sentence. That is
  // deliberate: it is stored, logged or thrown, and something older
  // depends on it reading exactly as it always has. What must hold is
  // that the *rider-facing* path goes through the catalogue instead.

  it("keeps GPX parse messages while the interface renders from the typed detail", () => {
    expect(read("src/gpx/parseGpx.ts")).toContain("The file is not well-formed GPX/XML.");
    // Stage 3's typed boundary: the library describes the error from
    // `detail.kind`, which is finer than `reason`, and never from the
    // sentence.
    const messages = read("src/ui/library/gpxMessages.ts");
    expect(messages).toContain("GpxErrorDetail");
    expect(messages).not.toContain("The file is not well-formed");
  });

  it("keeps RouteWarning.message stored, and renders it only for a legacy warning", () => {
    expect(read("src/routing/normalizeOpenRouteServiceRoute.ts")).toContain(
      "Questionable surface for a road bike",
    );
    const copy = read("src/ui/planning/routeWarningCopy.ts");
    // The single permitted read, and only where `surface` is absent —
    // a warning saved before that field existed, whose stored sentence is
    // the only remaining record of which surface it described.
    expect(copy).toContain("warning.surface === undefined");
    expect(copy).toContain("return warning.message;");
    expect(copy.match(/warning\.message/g)).toHaveLength(1);
  });

  it("keeps the surface table's English labels out of the rendered path", () => {
    expect(read("src/routing/surfaceCodes.ts")).toContain("Compacted gravel");
    // Stage 3 renders a surface from `surface.type` through the
    // catalogue. Reading `.label` for display would defeat both that and
    // the bidirectional type-to-label proof this audit must not disturb.
    expect(read("src/ui/planning/routeWarningCopy.ts")).not.toContain("surface.label");
    expect(read("src/ui/planning/RouteSummaryPanel.tsx")).not.toContain("surface.label");
  });

  it("keeps GeolocationError.message while both screens select from the reason", () => {
    expect(read("src/platform/geolocation.ts")).toContain(
      "Your location is currently unavailable.",
    );
    for (const path of [
      "src/ui/riding/RidingScreen.tsx",
      "src/ui/riding/FreeRoamScreen.tsx",
    ]) {
      const source = read(path);
      expect(source, path).toContain("switch (error.reason)");
      expect(source, path).not.toContain("geolocationError.message");
    }
  });

  it("keeps logged diagnostic sentences, which never reach the interface", () => {
    // A logError message is a diagnostic record. It is shown verbatim in
    // Status's Recent errors list as data, exactly like a browser's own
    // Error.message, and is not interface copy.
    expect(read("src/map/MapView.tsx")).toContain(
      'logError("map", "Route data did not finish loading in time")',
    );
    expect(read("src/ui/riding/useScreenWakeLock.ts")).toContain(
      "Wake lock released unexpectedly while visible",
    );
  });
});

describe("category 2 — the copied diagnostic report stays English (decision R4)", () => {
  const report = read("src/routing/routingConnectionTest.ts");

  it("keeps its own field labels out of the catalogue", () => {
    for (const label of [
      "OpenRouteService connection test report",
      "`Attempt ID: ${result.attemptId}`",
      "`Outcome: ${result.outcome}`",
      "`Elapsed: ${String(result.elapsedMs)} ms`",
      "`Secure context: ${yesNo(result.isSecureContext)}`",
    ]) {
      expect(report, label).toContain(label);
    }
  });

  it("is English by construction, not by omission", () => {
    // The one sentence the report shares with the Status screen is read
    // through the English translator explicitly. That keeps a single
    // source for the wording while the screen itself follows the rider.
    expect(report).toContain(
      "describeConnectionTestStage(englishTranslator, result.stage)",
    );
    expect(report).toContain("describeRoutingError(englishTranslator, error)");
    expect(report).not.toContain("useTranslate");
  });

  it("never passes a report or a raw diagnostic value back through the catalogue", () => {
    // A report is assembled text. Handing it to `t()` would make its
    // braces catalogue syntax, and a placeholder-looking fragment inside a
    // provider message or a route name would throw or be substituted.
    const screen = read("src/ui/diagnostics/DiagnosticsScreen.tsx");
    expect(screen).toContain("formatConnectionTestReport(connectionTestResult)");
    // Named directly rather than by a generic shape test: these are the
    // actual raw values this screen holds, and none of them may ever be
    // the first argument to `t()`. Handing one over would make its braces
    // catalogue syntax, so a provider message or a rider's route name
    // containing `{...}` would be substituted or would throw.
    const RAW_VALUES = [
      "formatConnectionTestReport(connectionTestResult)",
      "formatDiagnosticsReportHeader()",
      "connectionTestResult.message",
      "connectionTestResult.errorMessage",
      "connectionTestResult.errorName",
      "connectionTestResult.activeServiceWorkerScriptUrl",
      "connectionTestResult.stage",
      "entry.message",
      "entry.context",
      "report",
    ];
    for (const raw of RAW_VALUES) {
      // A word boundary before the call, not a bare substring search:
      // `writeText(report)` contains the characters "t(report" and would
      // otherwise fail this for no reason.
      const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const called = new RegExp(`\\b(?:t|plural|richTemplate)\\(\\s*${escaped}`);
      expect(called.test(screen), raw).toBe(false);
    }
    // Nothing on this screen derives a catalogue key from a value at all:
    // every lookup opens with a string literal, a ternary between two
    // literals, or an upper-case key table.
    const lookups = [...screen.matchAll(/\bt\(\s*([\s\S]{0,90})/g)].map((m) =>
      (m[1] ?? "").replace(/\s+/g, " ").trim(),
    );
    const unrecognised = lookups.filter(
      (argument) =>
        !/^["`]/.test(argument) &&
        !/^[A-Z][A-Z0-9_]*\b/.test(argument) &&
        // A ternary between two string literals, or a narrow local that
        // holds a key rather than a value.
        !/\?\s*["`]/.test(argument) &&
        !/^unitKey\b/.test(argument),
    );
    expect(unrecognised).toEqual([]);
  });
});

describe("category 3 — user-authored and imported content stays verbatim", () => {
  it("renders a route name as a value, never as a key", () => {
    const summary = read("src/ui/diagnostics/activeSessionSummary.ts");
    expect(summary).toContain("return name.length > 0 ? name :");
    expect(summary).not.toContain("t(name");
    expect(summary).not.toContain("translator.t(name");
  });

  it("passes a route name into the switch prompt as a parameter", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('t("switch.quotedRouteName", { name: target.route.name })');
    expect(app).not.toContain("t(target.route.name");
  });
});

describe("category 6 — language-selection copy is deferred to stage 6", () => {
  it("has no Language card, selector or device-language wording yet", () => {
    const keys = Object.keys(en);
    for (const forbidden of [
      "language.card",
      "language.title",
      "language.deviceLanguage",
      "language.english",
      "language.german",
    ]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    expect(read("src/ui/settings/SettingsScreen.tsx")).not.toContain("selectPreference");
  });
});

describe("category 7 — no genuine rider-facing copy is left inline", () => {
  // The scoped surfaces stage 5 owns. A module listed here has had every
  // rider-facing string migrated, so it must no longer contain a bare
  // English sentence in a JSX text position or an aria-label.
  const SCOPED = [
    "src/App.tsx",
    "src/ui/diagnostics/DiagnosticsScreen.tsx",
    "src/ui/diagnostics/activeSessionSummary.ts",
    "src/ui/shared/ClearSelectionButton.tsx",
    "src/ui/shared/ClimbCategoriesDisclosure.tsx",
    "src/ui/shared/ClimbGradientBandLegend.tsx",
    "src/ui/shared/ClimbLocalGradientDisclosure.tsx",
    "src/ui/shared/DescentLocalGradientDisclosure.tsx",
    "src/ui/shared/DescentLocalLegend.tsx",
    "src/ui/shared/ElevationChart.tsx",
    "src/ui/shared/GradientColoursDisclosure.tsx",
    "src/ui/shared/GradientSegmentDetailsPanel.tsx",
    "src/ui/shared/RouteFeatureDetailsPanel.tsx",
    "src/ui/shared/RouteFeatureLegend.tsx",
    "src/ui/shared/routeSummary.ts",
    "src/ui/settings/providerKeyStatus.ts",
    "src/navigation/routeFeaturePalette.ts",
  ] as const;

  it("leaves no literal aria-label in any scoped module", () => {
    for (const path of SCOPED) {
      const matches = read(path).match(/aria-label="[^"]+"/g) ?? [];
      expect(matches, path).toEqual([]);
    }
  });

  it("leaves no bare English sentence in a JSX text position", () => {
    // A JSX text node of three or more words starting with a capital.
    const sentence = />\s*[A-Z][a-z]+(?:\s+[a-z]+){2,}[^<{]*</g;
    for (const path of SCOPED) {
      const matches = read(path).match(sentence) ?? [];
      expect(matches, path).toEqual([]);
    }
  });

  it("leaves no English summary or heading text in a scoped disclosure", () => {
    for (const path of SCOPED) {
      const matches = read(path).match(/<(summary|h[1-6])>[A-Za-z][^<{]*</g) ?? [];
      expect(matches, path).toEqual([]);
    }
  });
});

describe("the catalogue is the only place production English lives", () => {
  it("holds every stage 5 prefix", () => {
    const keys = Object.keys(en);
    for (const prefix of [
      "status.",
      "update.",
      "switch.",
      "feature.",
      "legend.",
      "featureDetails.",
      "segmentDetails.",
      "elevation.",
      "format.",
      "providerKey.",
      "routingLog.",
      "mapLog.",
      "connectionTest.stage.",
    ]) {
      expect(
        keys.some((key) => key.startsWith(prefix)),
        prefix,
      ).toBe(true);
    }
  });

  it("still holds every earlier stage's prefixes, untouched", () => {
    const keys = Object.keys(en);
    for (const prefix of [
      "nav.",
      "settings.",
      "routes.",
      "tags.",
      "gpx.",
      "planning.",
      "warning.",
      "surface.",
      "ride.",
      "riding.",
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
});
