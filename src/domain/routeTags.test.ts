import { describe, expect, it } from "vitest";
import {
  collectTagSuggestions,
  normalizeRouteTags,
  resolveTagSpelling,
  sortTagsForDisplay,
  tagIdentityKey,
  tagsEqualByIdentity,
} from "./routeTags.ts";

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

describe("tagIdentityKey", () => {
  it("treats case, whitespace and NFC variants as the same identity", () => {
    expect(tagIdentityKey("Gravel")).toBe(tagIdentityKey("gravel"));
    expect(tagIdentityKey("  week  end  ")).toBe(tagIdentityKey("week end"));
    expect(tagIdentityKey(CAFE_PRECOMPOSED)).toBe(tagIdentityKey(CAFE_COMBINING));
  });

  it("does not fold diacritics or full Unicode case equivalence", () => {
    expect(tagIdentityKey(CAFE_PRECOMPOSED)).not.toBe(tagIdentityKey("cafe"));
    expect(tagIdentityKey(STRASSE_ESZETT)).not.toBe(tagIdentityKey("strasse"));
  });
});

describe("tagsEqualByIdentity", () => {
  it("is true for the same tags spelled differently, regardless of order", () => {
    expect(tagsEqualByIdentity(["gravel", "Weekend"], ["WEEKEND", "Gravel"])).toBe(true);
  });

  it("is false when lengths differ, even if one is a subset", () => {
    expect(tagsEqualByIdentity(["gravel"], ["gravel", "weekend"])).toBe(false);
  });

  it("is false when the identity sets differ", () => {
    expect(tagsEqualByIdentity(["gravel"], ["weekend"])).toBe(false);
  });

  it("is true for two empty arrays", () => {
    expect(tagsEqualByIdentity([], [])).toBe(true);
  });
});

describe("sortTagsForDisplay", () => {
  it("orders case-insensitively and numeric-aware, en-GB collation", () => {
    expect(sortTagsForDisplay(["Route 10", "route 2", "commute"])).toEqual([
      "commute",
      "route 2",
      "Route 10",
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(sortTagsForDisplay([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = ["gravel", "commute"];
    const inputCopy = [...input];

    sortTagsForDisplay(input);

    expect(input).toEqual(inputCopy);
  });
});

describe("resolveTagSpelling", () => {
  it("returns null for a whitespace-only candidate", () => {
    expect(resolveTagSpelling("   ", ["Gravel"])).toBeNull();
  });

  it("adopts an existing known spelling for a case/whitespace/NFC variant", () => {
    expect(resolveTagSpelling("  GRAVEL  ", ["Gravel"])).toBe("Gravel");
    expect(resolveTagSpelling(CAFE_COMBINING, [CAFE_PRECOMPOSED])).toBe(CAFE_PRECOMPOSED);
  });

  it("returns the candidate's own normalised spelling when it is genuinely new", () => {
    expect(resolveTagSpelling("  Weekend  ride  ", ["Gravel"])).toBe("Weekend ride");
  });

  it("never cross-resolves diacritic or eszett variants", () => {
    expect(resolveTagSpelling("cafe", [CAFE_PRECOMPOSED])).toBe("cafe");
    expect(resolveTagSpelling("strasse", [STRASSE_ESZETT])).toBe("strasse");
  });
});

describe("collectTagSuggestions", () => {
  it("collects deduplicated, sorted suggestions from several routes' tag arrays", () => {
    expect(
      collectTagSuggestions([
        { tags: ["Gravel", "Weekend"] },
        { tags: ["commute"] },
        { tags: [] },
      ]),
    ).toEqual(["commute", "Gravel", "Weekend"]);
  });

  it("collapses cross-route case/whitespace/NFC duplicates to one identity, keeping the first established spelling before sorting", () => {
    expect(
      collectTagSuggestions([
        { tags: ["Gravel"] },
        { tags: ["gravel", "GRAVEL"] },
        { tags: [CAFE_COMBINING] },
        { tags: [CAFE_PRECOMPOSED] },
      ]),
    ).toEqual([CAFE_PRECOMPOSED, "Gravel"]);
  });

  it("keeps diacritic and eszett variants as distinct suggestions (sorted stably, since the display collator's base sensitivity treats them as equal-weight)", () => {
    expect(
      collectTagSuggestions([{ tags: [CAFE_PRECOMPOSED, "cafe"] }, { tags: [] }]),
    ).toEqual([CAFE_PRECOMPOSED, "cafe"]);
    expect(collectTagSuggestions([{ tags: [STRASSE_ESZETT, "strasse"] }])).toEqual([
      STRASSE_ESZETT,
      "strasse",
    ]);
  });

  it("returns an empty array when there are no routes or all routes are untagged", () => {
    expect(collectTagSuggestions([])).toEqual([]);
    expect(collectTagSuggestions([{ tags: [] }, { tags: [] }])).toEqual([]);
  });

  it("does not mutate the input routes or their tag arrays", () => {
    const routes = [{ tags: ["Gravel", "commute"] }];
    const routesCopy = JSON.parse(JSON.stringify(routes)) as typeof routes;

    collectTagSuggestions(routes);

    expect(routes).toEqual(routesCopy);
  });
});
