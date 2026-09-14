import { describe, expect, it, vi } from "vitest";
import {
  entryPlaceholderNames,
  type MatchingEntry,
  type MessageEntry,
  type Placeholders,
} from "./catalogue.ts";
import {
  createTranslator,
  formatMessage,
  MessageFormatError,
  type Catalogue,
} from "./translate.ts";
import { en } from "./messages.en.ts";

/**
 * Fixture catalogues, deliberately wrong in one way each.
 *
 * Stage 1 has no German catalogue to check the real English one against —
 * it is authored and reviewed in a later stage — so the validation
 * machinery is proved against fixtures instead. That is stronger, not
 * weaker: a fixture can be made wrong on purpose, which the real pair
 * never should be.
 */
const CORRECT = {
  greeting: "Hello",
  distance: "{distance} remaining",
  routes: { one: "1 route", other: "{count} routes" },
  intro: { rich: "Read the {link} first." },
} as const;

type FixtureKey = keyof typeof CORRECT;
type FixtureCatalogue = {
  readonly [K in FixtureKey]: MatchingEntry<(typeof CORRECT)[K]>;
};

function placeholderSets(
  catalogue: Readonly<Record<string, MessageEntry>>,
): Record<string, readonly string[]> {
  return Object.fromEntries(
    Object.entries(catalogue).map(([key, entry]) => [
      key,
      [...entryPlaceholderNames(entry)].sort(),
    ]),
  );
}

/** The parity check this repository runs for real once German exists. */
function assertPlaceholderParity(
  source: Readonly<Record<string, MessageEntry>>,
  translated: Readonly<Record<string, MessageEntry>>,
): void {
  expect(placeholderSets(translated)).toEqual(placeholderSets(source));
}

describe("catalogue parity", () => {
  it("accepts a correct translation", () => {
    const translated: FixtureCatalogue = {
      greeting: "Hallo",
      distance: "Noch {distance}",
      routes: { one: "1 Route", other: "{count} Routen" },
      intro: { rich: "Lies zuerst {link}." },
    };
    expect(() => {
      assertPlaceholderParity(CORRECT, translated);
    }).not.toThrow();
  });

  it("rejects a renamed placeholder, which key parity alone cannot see", () => {
    // Negative control 2. Every key is present and every shape matches, so
    // the compiler is satisfied — only the placeholder check catches this.
    const renamed: FixtureCatalogue = {
      greeting: "Hallo",
      distance: "Noch {entfernung}",
      routes: { one: "1 Route", other: "{count} Routen" },
      intro: { rich: "Lies zuerst {link}." },
    };
    expect(() => {
      assertPlaceholderParity(CORRECT, renamed);
    }).toThrow();
  });

  it("rejects a placeholder dropped from only one plural variant", () => {
    const dropped: FixtureCatalogue = {
      greeting: "Hallo",
      distance: "Noch {distance}",
      routes: { one: "1 Route", other: "Mehrere Routen" },
      intro: { rich: "Lies zuerst {link}." },
    };
    expect(() => {
      assertPlaceholderParity(CORRECT, dropped);
    }).toThrow();
  });

  it("reads placeholders from both plural variants, not just one", () => {
    expect(entryPlaceholderNames({ one: "{a} x", other: "{b} y" })).toEqual(["a", "b"]);
  });
});

describe("catalogue shape parity, at compile time", () => {
  it("rejects a plain string where a plural entry is required", () => {
    const wrong = {
      greeting: "Hallo",
      distance: "Noch {distance}",
      // @ts-expect-error a plural key may not hold a plain string
      routes: "Routen",
      intro: { rich: "Lies zuerst {link}." },
    } satisfies FixtureCatalogue;
    expect(wrong).toBeDefined();
  });

  it("rejects a plain string where a rich entry is required", () => {
    const wrong = {
      greeting: "Hallo",
      distance: "Noch {distance}",
      routes: { one: "1 Route", other: "{count} Routen" },
      // @ts-expect-error a rich key may not hold a plain string
      intro: "Lies zuerst den Link.",
    } satisfies FixtureCatalogue;
    expect(wrong).toBeDefined();
  });

  it("rejects a missing key and an unknown extra key", () => {
    const missing = {
      greeting: "Hallo",
      distance: "Noch {distance}",
      routes: { one: "1 Route", other: "{count} Routen" },
      // @ts-expect-error `intro` is missing
    } satisfies FixtureCatalogue;
    expect(missing).toBeDefined();

    const extra = {
      greeting: "Hallo",
      distance: "Noch {distance}",
      routes: { one: "1 Route", other: "{count} Routen" },
      intro: { rich: "Lies zuerst {link}." },
      // @ts-expect-error `farewell` is not a key of the source catalogue
      farewell: "Tschüss",
    } satisfies FixtureCatalogue;
    expect(extra).toBeDefined();
  });
});

describe("placeholder types, at compile time", () => {
  it("derives the parameter names from the message text", () => {
    const noPlaceholders: Placeholders<"Hello"> = undefined as never;
    expect(noPlaceholders).toBeUndefined();

    const one: Placeholders<"{distance} remaining"> = "distance";
    expect(one).toBe("distance");

    const two: Placeholders<"{a} and {b}"> = "b";
    expect(two).toBe("b");

    // @ts-expect-error "c" is not a placeholder in this message
    const wrong: Placeholders<"{a} and {b}"> = "c";
    expect(wrong).toBe("c");
  });
});

describe("formatMessage", () => {
  it("substitutes named values, including numbers", () => {
    expect(formatMessage("{a} of {b}", { a: "3", b: 10 }, "k")).toBe("3 of 10");
  });

  it("substitutes a repeated placeholder everywhere it appears", () => {
    expect(formatMessage("{x}-{x}", { x: "9" }, "k")).toBe("9-9");
  });

  it("throws when a placeholder has no value", () => {
    expect(() => formatMessage("{a}", {}, "k")).toThrow(MessageFormatError);
  });

  it("throws when a supplied parameter is not used", () => {
    // Both directions matter: an unused parameter means the call site and
    // the message have drifted, which is the same defect seen from the
    // other side.
    expect(() => formatMessage("plain", { a: "1" }, "k")).toThrow(MessageFormatError);
  });

  it("leaves text with no placeholders untouched", () => {
    expect(formatMessage("plain text", undefined, "k")).toBe("plain text");
  });

  it("is not confused by repeated calls, which a shared /g regex would be", () => {
    // Negative control for the stateful-regex defect: a module-level /g
    // pattern carries lastIndex between calls, so the second call would
    // start mid-string and silently miss a placeholder.
    for (let i = 0; i < 5; i += 1) {
      expect(formatMessage("{a}|{b}", { a: "1", b: "2" }, "k")).toBe("1|2");
    }
  });
});

describe("the translator", () => {
  const catalogue = CORRECT as unknown as Catalogue;
  const translator = createTranslator("en", catalogue);

  it("renders a plain message with no parameters", () => {
    expect((translator.t as (k: string) => string)("greeting")).toBe("Hello");
  });

  it("renders a plain message with parameters", () => {
    expect(
      (translator.t as (k: string, p: Record<string, string>) => string)("distance", {
        distance: "5 km",
      }),
    ).toBe("5 km remaining");
  });

  it("selects a plural category by locale rules and exposes count", () => {
    const plural = translator.plural as (k: string, n: number) => string;
    expect(plural("routes", 1)).toBe("1 route");
    expect(plural("routes", 0)).toBe("0 routes");
    expect(plural("routes", 7)).toBe("7 routes");
  });

  it("does not reject a plural message that never interpolates its count", () => {
    const countless = { thing: { one: "one thing", other: "many things" } };
    const t = createTranslator("en", countless as unknown as Catalogue);
    const plural = t.plural as (k: string, n: number) => string;
    expect(plural("thing", 1)).toBe("one thing");
    expect(plural("thing", 3)).toBe("many things");
  });

  it("exposes a rich message's template rather than rendering it as text", () => {
    expect((translator.richTemplate as (k: string) => string)("intro")).toBe(
      "Read the {link} first.",
    );
  });

  it("reports the Intl locale for the active language", () => {
    expect(translator.locale).toBe("en-GB");
    expect(createTranslator("de", catalogue).locale).toBe("de-DE");
  });
});

describe("the real English catalogue", () => {
  it("has no entry that declares a placeholder it cannot describe", () => {
    for (const [key, entry] of Object.entries(en)) {
      for (const name of entryPlaceholderNames(entry)) {
        expect(name, `${key} placeholder`).toMatch(/^[a-z][A-Za-z0-9]*$/);
      }
    }
  });

  it("throws in development rather than rendering a hole a rider would see", () => {
    const broken = { greeting: "{unexpected}" } as unknown as Catalogue;
    const t = createTranslator("en", broken);
    expect(() => (t.t as (k: string) => string)("greeting")).toThrow(MessageFormatError);
  });

  it("renders every parameterless plain message without throwing", () => {
    const translator = createTranslator("en", en);
    for (const [key, entry] of Object.entries(en)) {
      if (typeof entry !== "string") continue;
      if (entryPlaceholderNames(entry).length > 0) continue;
      expect((translator.t as (k: string) => string)(key)).toBe(entry);
    }
  });

  it("falls back to English and records the failure rather than throwing in production", () => {
    // The production path must never throw at a rider mid-ride. Verified
    // by taking the development branch out, which is what the shipped
    // build does statically.
    const broken = { greeting: "{unexpected}" } as unknown as Catalogue;
    const t = createTranslator("en", broken);
    vi.stubEnv("DEV", false);
    vi.stubEnv("MODE", "production");
    try {
      // Both catalogues fail for this fabricated key, so the honest result
      // is an empty string — never the message key, which would mean
      // nothing to a rider.
      expect((t.t as (k: string) => string)("greeting")).toBe("");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
