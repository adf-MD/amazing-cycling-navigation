import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import { getAppPreferences, saveAppPreferences } from "./appPreferencesRepository.ts";
import { fromStoredAppPreferences, toStoredAppPreferences } from "./mapping.ts";
import { resolveLanguage } from "../i18n/language.ts";

beforeEach(async () => {
  await db.appPreferences.clear();
});

describe("fromStoredAppPreferences", () => {
  it("defaults to following the device when no row has ever been saved", () => {
    expect(fromStoredAppPreferences(undefined)).toEqual({ language: "device" });
  });

  it("defaults when the stored value is not a recognised preference", () => {
    for (const language of ["", "fr", "en-GB", "DEVICE", "null"]) {
      expect(fromStoredAppPreferences({ id: "app", language })).toEqual({
        language: "device",
      });
    }
  });

  it("preserves a recognised preference whose language is not available yet", () => {
    // The property this whole table exists to protect. German has no
    // catalogue in this stage, so it cannot be *resolved* to — but the
    // stored choice must survive, or a build that cannot yet honour a
    // preference would destroy it instead of deferring it.
    expect(fromStoredAppPreferences({ id: "app", language: "de" })).toEqual({
      language: "de",
    });
  });

  it("preserves an available preference too", () => {
    expect(fromStoredAppPreferences({ id: "app", language: "en" })).toEqual({
      language: "en",
    });
  });
});

describe("round trip through IndexedDB", () => {
  it("saves and reads back each recognised preference unchanged", async () => {
    for (const language of ["device", "en", "de"] as const) {
      await saveAppPreferences({ language });
      expect(await getAppPreferences()).toEqual({ language });
    }
  });

  it("keeps a stored 'de' byte-identical across a read, while resolving to English", async () => {
    // Reading must not normalise, rewrite or re-save. The gate lives in
    // resolveLanguage, never at the storage boundary — so the row still
    // says "de" afterwards and the effective language is still English.
    await saveAppPreferences({ language: "de" });

    const read = await getAppPreferences();
    expect(read.language).toBe("de");
    expect(resolveLanguage(read.language, ["de-DE"])).toBe("en");

    const row = await db.appPreferences.get("app");
    expect(row?.language).toBe("de");
  });

  it("recovers a corrupt row without rewriting it", async () => {
    await db.appPreferences.put({ id: "app", language: "klingon" });
    expect(await getAppPreferences()).toEqual({ language: "device" });
    // Defaulting is a read-time resolution, not a repair: the row is left
    // exactly as found, so nothing is destroyed by merely being read.
    expect((await db.appPreferences.get("app"))?.language).toBe("klingon");
  });

  it("stores exactly one singleton row however many times it is saved", async () => {
    await saveAppPreferences({ language: "en" });
    await saveAppPreferences({ language: "device" });
    expect(await db.appPreferences.count()).toBe(1);
  });
});

describe("toStoredAppPreferences", () => {
  it("writes the preference verbatim", () => {
    expect(toStoredAppPreferences({ language: "de" })).toEqual({ language: "de" });
  });
});

describe("the schema", () => {
  it("declares appPreferences at version 5", () => {
    expect(db.verno).toBe(5);
    expect(db.tables.map((table) => table.name)).toContain("appPreferences");
  });
});
