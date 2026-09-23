import { describe, expect, it } from "vitest";
import {
  DOCUMENT_LANGUAGE_TAGS,
  FALLBACK_LANGUAGE,
  INTL_LOCALES,
  SUPPORTED_LANGUAGES,
  isAppLanguage,
  isLanguagePreference,
  isSupportedLanguage,
  readNavigatorLanguages,
  resolveLanguage,
} from "./language.ts";

describe("the supported-language gate", () => {
  it("offers both reviewed languages", () => {
    // This is the gate itself. It read ["en"] through stages 1 to 6a and
    // flipped here, in the stage that completed and reviewed the German
    // catalogue — deliberately, so enabling German could not be done
    // quietly.
    expect(SUPPORTED_LANGUAGES).toEqual(["en", "de"]);
    expect(isSupportedLanguage("de")).toBe(true);
    expect(isSupportedLanguage("en")).toBe(true);
    expect(isSupportedLanguage("fr")).toBe(false);
  });

  it("still treats German as a language the application knows about", () => {
    // The gate is about availability, never about whether "de" is a legal
    // value. A stored "de" must stay a recognised preference so it is
    // preserved rather than discarded — see the storage boundary tests.
    expect(isAppLanguage("de")).toBe(true);
    expect(isLanguagePreference("de")).toBe(true);
    expect(isLanguagePreference("device")).toBe(true);
  });

  it("rejects anything that is not a known preference", () => {
    for (const value of ["fr", "en-GB", "", "DEVICE", null, undefined, 7, {}]) {
      expect(isLanguagePreference(value)).toBe(false);
    }
  });
});

describe("resolveLanguage, device preference", () => {
  const cases: readonly (readonly [readonly string[] | undefined, string])[] = [
    // The first SUPPORTED entry wins, so order is what decides — not
    // whether German appears anywhere in the list.
    [["en-GB", "de-DE"], "en"],
    [["de-DE", "en-GB"], "de"],
    // An unsupported tag is skipped, never treated as a reason to stop.
    [["fr-FR", "de-DE"], "de"],
    [["fr-FR", "es-ES"], "en"],
    [["de"], "de"],
    [["de-AT"], "de"],
    [["de-CH"], "de"],
    [[], "en"],
    [undefined, "en"],
  ];

  for (const [languages, expected] of cases) {
    it(`resolves ${JSON.stringify(languages)} to ${expected}`, () => {
      expect(resolveLanguage("device", languages)).toBe(expected);
    });
  }

  it("is case- and whitespace-insensitive about the primary subtag", () => {
    expect(resolveLanguage("device", ["  EN-gb  "])).toBe("en");
  });

  it("skips a tag whose primary subtag merely starts with a known one", () => {
    // "eng" is not "en": matching must be on the whole primary subtag, not
    // a prefix, or a three-letter code would be silently misread.
    expect(resolveLanguage("device", ["eng-Latn"])).toBe(FALLBACK_LANGUAGE);
  });
});

describe("resolveLanguage, explicit override", () => {
  it("honours a supported override regardless of the device list", () => {
    expect(resolveLanguage("en", ["de-DE", "fr-FR"])).toBe("en");
  });

  it("honours a German override regardless of the device list", () => {
    expect(resolveLanguage("de", ["de-DE"])).toBe("de");
    expect(resolveLanguage("de", ["fr-FR"])).toBe("de");
    expect(resolveLanguage("de", undefined)).toBe("de");
  });

  it("still clamps an override the gate does not allow", () => {
    // The override branch is constrained by SUPPORTED_LANGUAGES exactly as
    // the device branch is. That constraint is what made a stored "de"
    // safe before German shipped, and it is what keeps an unknown value
    // safe now.
    expect(resolveLanguage("fr" as never, ["fr-FR"])).toBe("en");
    expect(resolveLanguage("klingon" as never, ["de-DE"])).toBe("de");
  });
});

describe("language tags", () => {
  it("declares en-GB for English and an unregioned de for German", () => {
    expect(DOCUMENT_LANGUAGE_TAGS.en).toBe("en-GB");
    expect(DOCUMENT_LANGUAGE_TAGS.de).toBe("de");
  });

  it("keeps the Intl locale separate from the document tag", () => {
    expect(INTL_LOCALES.en).toBe("en-GB");
    expect(INTL_LOCALES.de).toBe("de-DE");
  });
});

describe("readNavigatorLanguages", () => {
  it("prefers the ordered list", () => {
    expect(
      readNavigatorLanguages({ languages: ["de-DE", "en-GB"], language: "en-GB" }),
    ).toEqual(["de-DE", "en-GB"]);
  });

  it("falls back to the single value when the ordered list is absent or empty", () => {
    expect(readNavigatorLanguages({ languages: [], language: "de-DE" })).toEqual([
      "de-DE",
    ]);
    expect(
      readNavigatorLanguages({
        languages: undefined as unknown as readonly string[],
        language: "de-DE",
      }),
    ).toEqual(["de-DE"]);
  });

  it("treats null as 'there is no navigator', distinctly from an omitted argument", () => {
    // Passing undefined would select the default parameter and read the
    // real global instead, which is why absence is spelled null.
    expect(readNavigatorLanguages(null)).toEqual([]);
  });

  it("returns an empty list rather than throwing when there is nothing to read", () => {
    expect(readNavigatorLanguages({ languages: [], language: "" })).toEqual([]);
  });
});
