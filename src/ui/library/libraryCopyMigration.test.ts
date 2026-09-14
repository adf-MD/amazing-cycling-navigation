import { describe, expect, it } from "vitest";
import { en } from "../../i18n/messages.en.ts";

/**
 * Backlog item 113 stage 2: a structural guard that the Route Library,
 * route-tag and GPX-import surface draws its copy from the catalogue
 * rather than from literals in the component.
 *
 * This is a **precise allowlist tied to named modules**, not a
 * repository-wide string sweep. A sweep would be brittle in both
 * directions: it would trip over a rider's own route name in a fixture,
 * and it would quietly pass for any string nobody thought to add to it.
 * Here each entry is a literal that genuinely used to live in that file,
 * so the test fails on the parent commit and keeps failing if any of it
 * is ever reintroduced inline.
 *
 * It deliberately asserts nothing about *rendered* output — that is what
 * the 402 existing copy-coupled tests in this directory already do, and
 * they pass unchanged because every English string is byte-identical.
 */

/**
 * Source with comments removed.
 *
 * The assertions below are about **code**, not prose: several of these
 * modules quite properly quote their own former wording in a doc comment
 * explaining what changed and why, and that documentation is worth
 * keeping. Without this, the test would be pressuring the next author to
 * delete the explanation rather than the literal.
 *
 * The `//` heuristic deliberately spares `://`, so a URL inside a string
 * is not mistaken for a comment. That is sufficient here and is checked
 * by the self-test below rather than assumed.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Source text via Vite's own `?raw` module graph rather than a filesystem
 * read: it resolves exactly the module the bundle would include, and it
 * needs no Node globals, which are not typed in this directory.
 */
const MODULE_SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob("./*.{ts,tsx}", { query: "?raw", import: "default", eager: true }),
  ).map(([path, source]) => [path, stripComments(source)]),
);

function readModule(relativePath: string): string {
  const source = MODULE_SOURCES[relativePath];
  if (source === undefined) throw new Error(`No source for ${relativePath}`);
  return source;
}

/** Literals that must no longer appear inline in each migrated module. */
const MIGRATED_LITERALS: Readonly<Record<string, readonly string[]>> = {
  "./RouteLibrary.tsx": [
    "Route library",
    "Search routes",
    "Clear search",
    "Sort by",
    "Most recent",
    "Name A–Z",
    "Longest route",
    "Most total ascent",
    "Loading routes…",
    "No routes saved yet. Import a GPX file to get started.",
    "No routes match the selected tags.",
    "Filter by tags",
    "Clear tag filters",
    "That file could not be imported.",
    "That route could not be exported.",
    "That route could not be deleted.",
    "This route could not be pinned. Try again.",
    "This route could not be unpinned. Try again.",
    "That tag could not be renamed. Try again.",
    "That tag could not be deleted. Try again.",
    "Enter a new name for this tag.",
    "Finish saving that route's tags first, then manage tags.",
    "Wait for the route deletion to finish, then manage tags.",
    "Wait for the ride switch to finish, then manage tags.",
    "Wait for the tag update to finish, then filter by tags.",
    "This preference could not be saved on this device. Try again.",
  ],
  "./RouteListItem.tsx": [
    "Route name",
    "Add a tag",
    "Add tag",
    "Tag suggestions",
    "Save tags",
    "This route's tags could not be saved. Try again.",
    "Edit tags",
    "Add tags",
    "Delete route",
    "Deleting…",
    "Return to paused ride",
    "This route will be permanently deleted from this device. This cannot be",
    // The pin control's name was a verb fragment glued to the route name.
    '${isPinned ? "Unpin" : "Pin"}',
  ],
  "./RouteTagManager.tsx": [
    "Manage tags",
    "No tags left. Add tags from a route to manage them here.",
    "Tag to manage",
    "Choose a tag",
    "New name",
    "Choose a tag to rename, merge or delete it everywhere it is used.",
    "Applying…",
    "Merge tags",
    "Rename tag",
    "Delete tag",
    // The inline duplicate of formatRouteCount.
    '"1 route"',
  ],
  "./ImportGpxButton.tsx": ["Import GPX", "Import GPX file"],
  "./tagLifecycleMessages.ts": [
    "already exists, so this merges the two tags on",
    "will be removed from",
    "The routes themselves are not deleted and stay in your library.",
    "is no longer used by any route, so nothing changed.",
    "Those routes are still saved.",
    // The shared sub-clause injected into five different sentences.
    "on ${formatRouteCount",
    // The quote helper: quotation marks are language-specific punctuation
    // and now live inside the messages themselves.
    "“${",
  ],
  "./routeCountCopy.ts": ['"1 route"', "routes`"],
  "./routeLibraryView.ts": [
    "No routes would remain",
    "would remain",
    "1 filter active",
    "filters active",
  ],
};

describe("the comment stripper this guard depends on", () => {
  it("removes block, JSDoc and trailing line comments", () => {
    expect(stripComments("/* gone */ kept")).toBe(" kept");
    expect(stripComments("kept // gone")).toBe("kept ");
    expect(stripComments("/**\n * gone\n */\nkept")).toBe("\nkept");
  });

  it("does not mistake a URL inside a string for a comment", () => {
    expect(stripComments('const a = "https://example.com/x";')).toContain(
      "https://example.com/x",
    );
  });

  it("still sees an ordinary code literal", () => {
    // The negative control for the stripper itself: if it were too
    // greedy, every assertion below would pass vacuously.
    expect(stripComments('const a = "Search routes";')).toContain("Search routes");
  });
});

describe("Route Library copy is drawn from the catalogue", () => {
  for (const [modulePath, literals] of Object.entries(MIGRATED_LITERALS)) {
    describe(modulePath, () => {
      const source = readModule(modulePath);

      for (const literal of literals) {
        it(`no longer contains ${JSON.stringify(literal)} inline`, () => {
          expect(source).not.toContain(literal);
        });
      }

      it("reaches the catalogue, directly or through a helper that does", () => {
        expect(source).toMatch(/i18n\/(useTranslate|translate|messages\.en)\.ts/);
      });
    });
  }
});

describe("the migrated copy helpers stay pure", () => {
  // Backlog item 113's boundary rule: a pure function receives the
  // translator or locale explicitly. It must never reach for React
  // context, `navigator`, the host's default locale or storage, because
  // any of those would make its output depend on where it is called from
  // rather than on what it is given — and would make it untestable
  // without a React tree.
  const PURE_COPY_MODULES = [
    "./tagLifecycleMessages.ts",
    "./routeCountCopy.ts",
    "./routeLibraryView.ts",
  ] as const;

  for (const modulePath of PURE_COPY_MODULES) {
    describe(modulePath, () => {
      const source = readModule(modulePath);

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
          "toLocaleDateString",
        ]) {
          expect(source, forbidden).not.toContain(forbidden);
        }
      });

      it("reads storage only as a type, never as a value", () => {
        // A type-only import carries no runtime behaviour and is erased
        // at build time; a value import would mean the function reads
        // persisted state of its own, which is what must not happen.
        const storageImports = [...source.matchAll(/^import (type )?.*storage\/.*$/gm)];
        for (const [line, isTypeOnly] of storageImports.map(
          (match) => [match[0], match[1]] as const,
        )) {
          expect(isTypeOnly, line).toBeDefined();
        }
      });
    });
  }

  it("pins the route-name collator to an explicit locale, not the host's", () => {
    // Deliberately still en-GB in this stage — see the module's own note.
    // What matters here is that a locale is named at all: an unpinned
    // Intl.Collator() would sort differently on a German CI machine.
    const source = readModule("./routeLibraryView.ts");
    expect(source).toContain('new Intl.Collator("en-GB"');
    expect(source).not.toMatch(/new Intl\.Collator\(\s*[,)]/);
  });
});

describe("the stage-2 catalogue keys", () => {
  const STAGE_2_PREFIXES = ["routes.", "tags.", "gpx."] as const;

  it("exist for every migrated surface", () => {
    const keys = Object.keys(en);
    for (const prefix of STAGE_2_PREFIXES) {
      expect(keys.some((key) => key.startsWith(prefix))).toBe(true);
    }
  });

  it("uses a plural entry wherever a count chooses the wording", () => {
    // The `=== 1` tests these replaced could not express a language with
    // more than two categories.
    for (const key of [
      "routes.count",
      "routes.filtersActive",
      "routes.wouldRemain",
      "tags.manage.option",
      "tags.preview.rename",
      "tags.preview.merge",
      "tags.preview.renameTo",
      "tags.confirm.mergeMessage",
      "tags.confirm.deleteMessage",
      "tags.success.deleted",
      "tags.success.merged",
      "tags.success.renamed",
    ] as const) {
      const entry = en[key];
      expect(typeof entry, key).toBe("object");
      expect(entry, key).toHaveProperty("one");
      expect(entry, key).toHaveProperty("other");
    }
  });

  it("keeps the quotation marks inside the message, not in a helper", () => {
    // Punctuation is language-specific: German uses low-high quotes. The
    // rider's own tag sits between them, untouched.
    expect(en["tags.confirm.deleteTitle"]).toBe("Delete the tag “{tag}”?");
    expect(en["routes.card.deleteConfirmTitle"]).toBe("Delete “{name}”?");
  });
});
