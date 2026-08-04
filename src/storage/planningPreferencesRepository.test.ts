import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import {
  getPlanningPreferences,
  savePlanningPreferences,
} from "./planningPreferencesRepository.ts";

beforeEach(async () => {
  await db.planningPreferences.clear();
});

describe("planningPreferencesRepository", () => {
  it("resolves avoidFerriesByDefault: true when no row has been saved", async () => {
    await expect(getPlanningPreferences()).resolves.toEqual({
      avoidFerriesByDefault: true,
    });
  });

  it("saves and retrieves avoidFerriesByDefault: false", async () => {
    await savePlanningPreferences({ avoidFerriesByDefault: false });

    await expect(getPlanningPreferences()).resolves.toEqual({
      avoidFerriesByDefault: false,
    });
  });

  it("saving true after false persists the updated value", async () => {
    await savePlanningPreferences({ avoidFerriesByDefault: false });
    await savePlanningPreferences({ avoidFerriesByDefault: true });

    await expect(getPlanningPreferences()).resolves.toEqual({
      avoidFerriesByDefault: true,
    });
  });

  it("stores only the expected fields on the underlying row", async () => {
    await savePlanningPreferences({ avoidFerriesByDefault: false });

    const stored = await db.planningPreferences.get("planning");
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      ["id", "avoidFerriesByDefault"].sort(),
    );
  });
});
