import { describe, expect, it } from "vitest";
import { en, type MessageKey } from "./messages.en.ts";
import { de } from "./messages.de.ts";
import {
  entryPlaceholderNames,
  isPluralEntry,
  isRichEntry,
  placeholderNames,
  type MessageEntry,
} from "./catalogue.ts";
import { createTranslator } from "./translate.ts";
import { SUPPORTED_LANGUAGES, resolveLanguage } from "./language.ts";

/**
 * Backlog item 113 stage 6a: the real English/German pair.
 *
 * Stages 1–5 could only exercise the catalogue machinery against
 * controlled fixtures, because German did not exist. Now it does, so
 * these are the parity checks the accepted plan reserved for this point.
 *
 * What this file is **not**: evidence that the German is correct. A test
 * cannot read German. Completeness, shape, placeholders and the absence
 * of untranslated residue are machine-checkable; wording is not, and the
 * review document is what the user reads for that.
 *
 * German is built here with `createTranslator("de", de)` directly rather
 * than through `CATALOGUES`, so the application itself still has no route
 * to this catalogue at all.
 */

const german = createTranslator("de", de);
const KEYS = Object.keys(en) as MessageKey[];

function entryOf(catalogue: Record<string, MessageEntry>, key: string): MessageEntry {
  const entry = catalogue[key];
  if (entry === undefined) throw new Error(`No entry for ${key}`);
  return entry;
}

function kindOf(entry: MessageEntry): "plain" | "plural" | "rich" {
  if (isRichEntry(entry)) return "rich";
  if (isPluralEntry(entry)) return "plural";
  return "plain";
}

describe("key parity", () => {
  it("translates every English key, and adds none", () => {
    expect(Object.keys(de).sort()).toEqual(KEYS.slice().sort());
  });

  it("covers a representative key from every surface", () => {
    // A spot check that reads as documentation: if a whole surface were
    // ever dropped, the sorted-key comparison above would say only that
    // the lists differ.
    for (const key of [
      "nav.routes",
      "settings.title",
      "routes.title",
      "tags.manage.heading",
      "gpx.import",
      "planning.title",
      "warning.structural.steps",
      "surface.gravel",
      "routingError.offline",
      "map.retryImagery",
      "ride.status.onRoute",
      "freeRoam.title",
      "riding.landmarkLabel",
      "launcher.title",
      "climb.cueActive",
      "manoeuvre.left",
      "wakeLock.label",
      "format.distanceKm",
      "feature.label.hc",
      "legend.clearSelection",
      "elevation.noRoute",
      "providerKey.none",
      "routingLog.offline",
      "mapLog.fallbackActivated",
      "connectionTest.stage.success",
      "status.session",
      "switch.title",
      "update.ready",
    ] as const) {
      expect(de[key], key).toBeDefined();
    }
  });
});

describe("shape parity", () => {
  it("gives every entry the same kind as its English source", () => {
    const mismatches = KEYS.filter(
      (key) => kindOf(entryOf(en, key)) !== kindOf(entryOf(de, key)),
    );
    expect(mismatches).toEqual([]);
  });

  it("counts the three kinds exactly as English does", () => {
    const count = (catalogue: Record<string, MessageEntry>) => {
      const totals = { plain: 0, plural: 0, rich: 0 };
      for (const key of KEYS) totals[kindOf(entryOf(catalogue, key))] += 1;
      return totals;
    };
    expect(count(de)).toEqual(count(en));
    // Pinned literally so a silently shrinking catalogue is visible.
    expect(count(en)).toEqual({ plain: 743, plural: 18, rich: 2 });
  });

  it("gives every plural entry both German categories, non-empty", () => {
    // German and English share exactly `one` and `other`, which is why
    // the two-variant shape is enough for both.
    for (const key of KEYS) {
      const entry = entryOf(de, key);
      if (!isPluralEntry(entry)) continue;
      expect(entry.one.trim().length, `${key}.one`).toBeGreaterThan(0);
      expect(entry.other.trim().length, `${key}.other`).toBeGreaterThan(0);
    }
  });

  it("agrees with Intl.PluralRules about those two categories", () => {
    const rules = new Intl.PluralRules("de-DE");
    expect(rules.select(0)).toBe("other");
    expect(rules.select(1)).toBe("one");
    expect(rules.select(2)).toBe("other");
    expect(new Set(rules.resolvedOptions().pluralCategories)).toEqual(
      new Set(["one", "other"]),
    );
  });
});

describe("placeholder parity", () => {
  it("uses exactly the English placeholder names in every entry", () => {
    const mismatches: string[] = [];
    for (const key of KEYS) {
      const english = [...entryPlaceholderNames(entryOf(en, key))].sort();
      const german = [...entryPlaceholderNames(entryOf(de, key))].sort();
      if (JSON.stringify(english) !== JSON.stringify(german)) {
        mismatches.push(
          `${key}: ${JSON.stringify(english)} vs ${JSON.stringify(german)}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("checks each plural category separately, not just the union", () => {
    // A placeholder present in `other` but missing from `one` would pass
    // a union comparison and then render a hole for exactly one count.
    const mismatches: string[] = [];
    for (const key of KEYS) {
      const english = entryOf(en, key);
      const german = entryOf(de, key);
      if (!isPluralEntry(english) || !isPluralEntry(german)) continue;
      for (const variant of ["one", "other"] as const) {
        const e = [...placeholderNames(english[variant])].sort();
        const d = [...placeholderNames(german[variant])].sort();
        if (JSON.stringify(e) !== JSON.stringify(d)) {
          mismatches.push(
            `${key}.${variant}: ${JSON.stringify(e)} vs ${JSON.stringify(d)}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("leaves no unbalanced or empty brace anywhere in German", () => {
    for (const key of KEYS) {
      const entry = entryOf(de, key);
      const texts = isRichEntry(entry)
        ? [entry.rich]
        : isPluralEntry(entry)
          ? [entry.one, entry.other]
          : [entry];
      for (const text of texts) {
        const opens = (text.match(/\{/g) ?? []).length;
        const closes = (text.match(/\}/g) ?? []).length;
        expect(opens, `${key} braces`).toBe(closes);
        expect(text, `${key} empty placeholder`).not.toMatch(/\{\s*\}/);
      }
    }
  });
});

describe("the German catalogue renders", () => {
  it("substitutes every parameter of every plain and plural key", () => {
    // Every message is actually rendered, with a distinctive value per
    // placeholder, and the output must contain each value and no leftover
    // braces. `t()` throws on a missing or unexpected parameter, so this
    // also proves the derived parameter types match the German text.
    for (const key of KEYS) {
      const entry = entryOf(de, key);
      if (isRichEntry(entry)) continue;
      // Parameters come from the **English** entry, because that is what
      // the call sites actually pass — their types are derived from the
      // English text. Deriving them from German instead would let an
      // extra German placeholder fill itself and never be noticed.
      const params: Record<string, string> = {};
      for (const name of entryPlaceholderNames(entryOf(en, key))) {
        params[name] = `«${name}»`;
      }
      // One deliberately loose handle for this sweep only: the typed
      // signatures are derived per key, and this loop visits every key at
      // once. Every other call in this file goes through the real types.
      const loose = german as unknown as {
        t: (key: string, params?: Record<string, string>) => string;
        plural: (key: string, count: number, params?: Record<string, string>) => string;
      };
      const render = (count?: number): string =>
        count === undefined ? loose.t(key, params) : loose.plural(key, count, params);
      const outputs = isPluralEntry(entry) ? [render(1), render(7)] : [render()];
      for (const output of outputs) {
        expect(output, key).not.toMatch(/\{[^{}]+\}/);
        for (const name of entryPlaceholderNames(entryOf(en, key))) {
          if (name === "count") continue;
          expect(output, `${key} · ${name}`).toContain(`«${name}»`);
        }
      }
    }
  });

  it("selects the German plural category from the count", () => {
    expect(german.plural("routes.count", 1)).toBe("1 Route");
    expect(german.plural("routes.count", 0)).toBe("0 Routen");
    expect(german.plural("routes.count", 7)).toBe("7 Routen");
    expect(german.plural("routeSummary.waypointCount", 1)).toBe("1 Wegpunkt");
    expect(german.plural("routeSummary.waypointCount", 3)).toBe("3 Wegpunkte");
    expect(german.plural("climb.count", 1)).toBe("1 erkannter Anstieg auf dieser Route");
    expect(german.plural("climb.count", 4)).toBe("4 erkannte Anstiege auf dieser Route");
  });

  it("renders both rich templates with their placeholder intact", () => {
    expect(german.richTemplate("settings.ors.intro")).toContain("{link}");
    expect(german.richTemplate("settings.ors.usageStorage")).toContain("{emphasis}");
    // The safety statement must still be a statement, not a hedge.
    expect(de["settings.ors.usageStorageEmphasis"]).toBe("nicht verschlüsselt");
  });

  it("keeps the leading space on the two appended manoeuvre qualifiers", () => {
    expect(de["manoeuvre.frozenFull"].startsWith(" ")).toBe(true);
    expect(de["manoeuvre.frozenCompact"].startsWith(" ")).toBe(true);
    expect(de["routingError.providerCodeSuffix"].startsWith(" ")).toBe(true);
  });
});

describe("German formatting comes from the locale, never from the message", () => {
  it("uses the German locale for numbers and lists", () => {
    expect(german.locale).toBe("de-DE");
    const oneDecimal = new Intl.NumberFormat(german.locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      useGrouping: false,
    });
    expect(oneDecimal.format(Number((61.5).toFixed(1)))).toBe("61,5");
    expect(oneDecimal.format(Number((1234.56).toFixed(1)))).toBe("1234,6");
    const grouped = new Intl.NumberFormat(german.locale, {
      maximumFractionDigits: 0,
      useGrouping: true,
    });
    expect(grouped.format(1500)).toBe("1.500");
    expect(grouped.format(80_000)).toBe("80.000");
    expect(
      new Intl.ListFormat(german.locale, { style: "long", type: "conjunction" }).format([
        "2",
        "4",
        "6",
      ]),
    ).toBe("2, 4 und 6");
  });

  it("avoids a German negative zero exactly as English does", () => {
    const whole = new Intl.NumberFormat(german.locale, {
      maximumFractionDigits: 0,
      useGrouping: false,
    });
    // Stage 5's round-first rule, in German: Math.round(-0.4) is -0, and
    // only the String round trip collapses it.
    expect(whole.format(Number(String(Math.round(-0.4))))).toBe("0");
    expect(whole.format(Number(String(Math.round(-0.5))))).toBe("0");
  });

  it("never hard-codes a decimal comma or thousands point in a message", () => {
    // A translated message must not try to punctuate a number itself: the
    // formatter owns that, and a message that did it would be wrong for
    // every value but the one it was written against.
    const offenders: string[] = [];
    for (const key of KEYS) {
      const entry = entryOf(de, key);
      const texts = isRichEntry(entry)
        ? [entry.rich]
        : isPluralEntry(entry)
          ? [entry.one, entry.other]
          : [entry];
      for (const text of texts) {
        // A digit, a comma or point, then a digit — inside authored copy.
        if (/\d[.,]\d/.test(text)) offenders.push(`${key}: ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("informal address is used consistently", () => {
  // The approved decision is `du`. These are the forms that would betray
  // a formal register creeping in.
  // `\bSie\b` cannot distinguish the formal address from a
  // sentence-initial third-person "sie". That is not a weakness here: this
  // catalogue deliberately avoids sentence-initial "Sie" too, because a
  // reader cannot tell them apart either until the referent lands.
  const FORMAL = [
    /\bSie\b/,
    /\bIhre[nmrs]?\b/,
    /\bIhnen\b/,
    /\bIhr\b/,
    /\bversuchen Sie\b/i,
    /\bbitte geben Sie\b/i,
  ];

  /**
   * The one place the reviewer deliberately kept a sentence-initial "Sie",
   * and the reason it is safe here rather than a relaxation of the rule.
   *
   * `routeSummary.surfaceCaveat` reads "Die Angaben beruhen … Sie
   * garantieren weder …": "Sie" is the third-person plural pronoun for
   * "Die Angaben", which is the immediately preceding subject. Unlike the
   * `switch.conflict` case — where the referent arrived only after an
   * interpolated value and the sentence was reworded — the antecedent here
   * is unambiguous by the time the reader reaches the pronoun, and the
   * wording is approved. Listed by key, with the offending pattern named,
   * so a *different* formal form appearing in this same entry would still
   * fail.
   */
  const JUSTIFIED_FORMAL_MATCHES: Readonly<Record<string, string>> = {
    "routeSummary.surfaceCaveat":
      "third-person plural for 'Die Angaben', the immediately preceding subject",
  };

  it("contains no formal second-person form", () => {
    const offenders: string[] = [];
    for (const key of KEYS) {
      const entry = entryOf(de, key);
      const texts = isRichEntry(entry)
        ? [entry.rich]
        : isPluralEntry(entry)
          ? [entry.one, entry.other]
          : [entry];
      for (const text of texts) {
        for (const pattern of FORMAL) {
          if (!pattern.test(text)) continue;
          // Only the bare `Sie` ambiguity is ever excused, and only for a
          // named key. Every other pattern still fails everywhere.
          if (key in JUSTIFIED_FORMAL_MATCHES && pattern.source === "\\bSie\\b") continue;
          offenders.push(`${key}: ${text}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the justified-formal list honest", () => {
    // A stale excuse is as bad as a missing one: if the wording changes so
    // the pronoun is gone, the entry must leave this list.
    for (const key of Object.keys(JUSTIFIED_FORMAL_MATCHES)) {
      const entry = entryOf(de, key);
      const text = isRichEntry(entry)
        ? entry.rich
        : isPluralEntry(entry)
          ? `${entry.one} ${entry.other}`
          : entry;
      expect(/\bSie\b/.test(text), key).toBe(true);
    }
  });

  it("uses the informal forms where it addresses the rider at all", () => {
    // Not every message addresses the rider; those that do must use `du`.
    const informal = KEYS.filter((key) => {
      const entry = entryOf(de, key);
      const text = isRichEntry(entry)
        ? entry.rich
        : isPluralEntry(entry)
          ? `${entry.one} ${entry.other}`
          : entry;
      return /\b(du|dein|deine[nmrs]?|dir|dich)\b/i.test(text);
    });
    expect(informal.length).toBeGreaterThan(40);
  });
});

describe("no English residue where German was intended", () => {
  /**
   * The classified audit of the German catalogue itself. An entry whose
   * text is identical to English is allowed only when it belongs to one
   * of these classes; every member is named, so a genuinely untranslated
   * sentence cannot hide among them.
   */
  const JUSTIFIED_IDENTICAL: Readonly<Record<string, string>> = {
    // Proper and product names.
    "settings.ors.heading": "product name",
    // The same word in German.
    "nav.status": "same word in German",
    "status.landmarkLabel": "same word in German",
    "status.title": "same word in German",
    "planning.waypoints.start": "same word in German",
    "surface.asphalt": "same word in German",
    "surface.sand": "same word in German",
    "feature.colour.orange": "same word in German",
    "ride.pause": "same word in German",
    "routes.sort.nameAsc": "German spans the same alphabetical range",
    // Established loanwords in German technical and everyday use.
    "ride.online": "established loanword",
    "ride.offline": "established loanword",
    "status.online": "established loanword",
    "status.offline": "established loanword",
    "status.build": "machine-facing build identifier label",
    // International abbreviations and symbols.
    "feature.category.hc": "hors catégorie, the international cycling term",
    "feature.shortLabel.hc": "hors catégorie, the international cycling term",
    "feature.shortLabel.moderate": "glyph, deliberately unchanged",
    "feature.shortLabel.steep": "glyph, deliberately unchanged",
    "feature.shortLabel.verySteep": "glyph, deliberately unchanged",
    "providerKey.utcTimestamp": "UTC is an international abbreviation",
    // Pure composition or a bare unit: no words to translate.
    "routeSummary.warningRowSurface": "composition only",
    "routeSummary.warningRow": "composition only",
    "segmentDetails.heading": "composition only",
    "routingLog.withDetail": "composition only",
    "status.testResult": "composition only",
    "status.errorValue": "composition only",
    "ride.gpsStatus": "composition plus the SI unit",
    "riding.elevationWindow": "SI unit",
    "format.distanceKm": "SI unit",
    "format.metres": "SI unit",
    "elevation.range": "SI unit",
    "status.fixAccuracyValue": "SI unit",
    "status.storage.bytes": "byte unit",
    "status.storage.kibibytes": "byte unit",
    "status.storage.mebibytes": "byte unit",
    "status.storage.gibibytes": "byte unit",
    "status.storage.tebibytes": "byte unit",
    // Settled by the stage 6a review: `Tag`/`Tags` replaces
    // `Schlagwort`/`Schlagwörter` throughout, and it is the same word.
    "routes.card.tags": "the approved German term is the same word",
    "ride.gpsFresh": "established loanword in German",
    // Symbols and composition only. The review also removed the space
    // before `%` that German typography permits, keeping the figure the
    // same width in both languages on a constrained status line.
    "format.gradientPercent": "composition plus the per-cent sign",
    "status.storage.percentage": "composition plus the per-cent sign",
    "status.storage.lessThanOnePercent": "symbols only",
    // Endonyms, deliberately identical in both catalogues: a rider who
    // cannot read the current interface must still recognise their own
    // language in the selector.
    "settings.language.english": "an endonym, the same in both catalogues",
    "settings.language.german": "an endonym, the same in both catalogues",
  };

  function variants(entry: MessageEntry): readonly string[] {
    if (isRichEntry(entry)) return [entry.rich];
    if (isPluralEntry(entry)) return [entry.one, entry.other];
    return [entry];
  }

  it("justifies every entry that is textually identical to English", () => {
    const identical = KEYS.filter((key) => {
      const e = variants(entryOf(en, key));
      const d = variants(entryOf(de, key));
      return e.length === d.length && e.every((text, index) => text === d[index]);
    });
    const unjustified = identical.filter((key) => !(key in JUSTIFIED_IDENTICAL));
    expect(unjustified).toEqual([]);
    // And the list carries no stale entry, so removing a justification
    // when the translation changes is not optional.
    const stale = Object.keys(JUSTIFIED_IDENTICAL).filter(
      (key) => !identical.includes(key as MessageKey),
    );
    expect(stale).toEqual([]);
  });

  it("leaves no untranslated English sentence anywhere", () => {
    // A give-away English function word, in a message long enough to be
    // prose rather than a token. Deliberately crude and then narrowed by
    // the justified list above, which is the precise instrument.
    const ENGLISH_MARKERS =
      /\b(the|your|this|that|could not|unavailable|please|try again|and the|is not)\b/i;
    const offenders: string[] = [];
    for (const key of KEYS) {
      for (const text of variants(entryOf(de, key))) {
        if (text.length >= 12 && ENGLISH_MARKERS.test(text)) {
          offenders.push(`${key}: ${text}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses German quotation marks wherever English used curly or straight ones", () => {
    // Note which characters these are. German opens with „ (U+201E) and
    // closes with “ (U+201C) — and U+201C is the character English uses to
    // *open*. So the forbidden set is the English closing mark ” (U+201D)
    // and the straight ASCII quote, never U+201C, which is correct German.
    const offenders: string[] = [];
    for (const key of KEYS) {
      const english = variants(entryOf(en, key)).join(" ");
      if (!/[\u201C\u201D"]/.test(english)) continue;
      for (const text of variants(entryOf(de, key))) {
        if (/[\u201D"]/.test(text)) offenders.push(`${key}: no German quotes: ${text}`);
        if (!text.includes("\u201E"))
          offenders.push(`${key}: never opens with „: ${text}`);
        // Balanced: one closing mark for each opening one.
        const opens = (text.match(/\u201E/g) ?? []).length;
        const closes = (text.match(/\u201C/g) ?? []).length;
        if (opens !== closes)
          offenders.push(`${key}: ${String(opens)} „ against ${String(closes)} “`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("German is reachable", () => {
  it("is registered as an available catalogue", async () => {
    const { CATALOGUES, catalogueFor } = await import("./catalogues.ts");
    expect(Object.keys(CATALOGUES).sort()).toEqual(["de", "en"]);
    expect(catalogueFor("de")).toBe(de);
  });

  it("is in the supported set", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["en", "de"]);
  });

  it("resolves from a German device or a stored preference", () => {
    expect(resolveLanguage("device", ["de-DE", "en-GB"])).toBe("de");
    expect(resolveLanguage("device", ["de"])).toBe("de");
    expect(resolveLanguage("device", ["de-AT"])).toBe("de");
    expect(resolveLanguage("de", ["en-GB"])).toBe("de");
  });

  it("still falls back to English for a language it does not have", () => {
    const { catalogueFor } = { catalogueFor: (l: string) => (l === "de" ? de : en) };
    expect(catalogueFor("fr")).toBe(en);
    expect(resolveLanguage("device", ["fr-FR"])).toBe("en");
  });
});

describe("compact labels stay inside their accessible names", () => {
  // Item 113's 25 September 2026 follow-up: the riding header shows a
  // compact End label while the button's accessible name stays the full
  // one. WCAG 2.5.3 (label in name) needs the visible word inside the name,
  // so a translation that drifted apart would fail speech-control users.
  for (const [language, catalogue, locale] of [
    ["en", en, "en-GB"],
    ["de", de, "de-DE"],
  ] as const) {
    for (const [compactKey, fullKey] of [
      ["ride.endRideCompact", "ride.endRide"],
      ["climb.viewClimbCompact", "climb.viewClimb"],
    ] as const) {
      it(`${compactKey} is contained in ${fullKey} (${language})`, () => {
        const compact = catalogue[compactKey].toLocaleLowerCase(locale);
        const full = catalogue[fullKey].toLocaleLowerCase(locale);
        expect(compact.length).toBeGreaterThan(0);
        expect(full).toContain(compact);
      });
    }
  }
});
