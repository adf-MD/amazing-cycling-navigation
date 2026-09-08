import { describe, expect, it } from "vitest";
import { normalizeRouteTags } from "./routeTags.ts";

// Explicit \u escapes are used throughout for accented characters rather
// than literal glyphs, so the exact Unicode composition under test (NFC
// precomposed vs. a base letter plus a combining mark) is unambiguous in
// the source rather than depending on how an editor or tool happens to
// encode a typed accented character.
const CAFE_PRECOMPOSED = "caf\u00e9"; // "cafe" + a single precomposed e-acute codepoint (NFC)
const CAFE_COMBINING = "cafe\u0301"; // "cafe" + a separate combining acute accent mark
const STRASSE_ESZETT = "stra\u00dfe"; // German "strasse" spelled with sharp-s (eszett)

describe("normalizeRouteTags", () => {
  it("returns an empty array for non-array input", () => {
    expect(normalizeRouteTags(undefined)).toEqual([]);
    expect(normalizeRouteTags(null)).toEqual([]);
    expect(normalizeRouteTags("commute")).toEqual([]);
    expect(normalizeRouteTags(42)).toEqual([]);
    expect(normalizeRouteTags({ tags: ["commute"] })).toEqual([]);
  });

  it("keeps only string entries, discarding numbers, null, booleans, objects and nested arrays", () => {
    expect(
      normalizeRouteTags(["commute", 42, null, undefined, true, {}, ["gravel"]]),
    ).toEqual(["commute"]);
  });

  it("trims leading and trailing whitespace from each tag", () => {
    expect(normalizeRouteTags(["  commute  "])).toEqual(["commute"]);
  });

  it("collapses internal whitespace runs, including Unicode whitespace, to a single ordinary space", () => {
    expect(normalizeRouteTags(["week  end", "week   end", "week\tend"])).toEqual([
      "week end",
    ]);
  });

  it("discards empty and whitespace-only entries", () => {
    expect(normalizeRouteTags(["", "   ", "\t\n", "commute"])).toEqual(["commute"]);
  });

  it("deduplicates case-insensitively, keeping the first-seen spelling", () => {
    expect(normalizeRouteTags(["Commute", "COMMUTE", "commute"])).toEqual(["Commute"]);
  });

  it("preserves first-occurrence order of the surviving, deduplicated tags", () => {
    expect(normalizeRouteTags(["weekend", "commute", "gravel", "commute"])).toEqual([
      "weekend",
      "commute",
      "gravel",
    ]);
  });

  it("unifies NFC-equivalent spellings of the same visible text (precomposed vs. combining-mark forms)", () => {
    expect(CAFE_PRECOMPOSED).not.toBe(CAFE_COMBINING); // genuinely different byte sequences
    expect(normalizeRouteTags([CAFE_PRECOMPOSED, CAFE_COMBINING])).toEqual([
      CAFE_PRECOMPOSED,
    ]);
  });

  it("treats diacritic variants as distinct tags: an accented and unaccented spelling both survive unmerged", () => {
    expect(normalizeRouteTags([CAFE_PRECOMPOSED, "cafe"])).toEqual([
      CAFE_PRECOMPOSED,
      "cafe",
    ]);
  });

  it("is not full Unicode case folding: an eszett spelling and its double-s expansion remain distinct tags", () => {
    expect(normalizeRouteTags([STRASSE_ESZETT, "strasse"])).toEqual([
      STRASSE_ESZETT,
      "strasse",
    ]);
  });

  it("does not mutate the input array or any of its string elements", () => {
    const input = [" Commute ", "GRAVEL"];
    const inputCopy = [...input];

    normalizeRouteTags(input);

    expect(input).toEqual(inputCopy);
  });

  it("returns a new array reference every call, never the input array itself", () => {
    const input = ["commute"];
    const result = normalizeRouteTags(input);

    expect(result).not.toBe(input);
  });
});
