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
  it("resolves avoidFerriesByDefault: true and profileByDefault: cycling-road when no row has been saved", async () => {
    await expect(getPlanningPreferences()).resolves.toEqual({
      avoidFerriesByDefault: true,
      profileByDefault: "cycling-road",
    });
  });

  it("saves and retrieves avoidFerriesByDefault: false alongside cycling-regular", async () => {
    await savePlanningPreferences({
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-regular",
    });

    await expect(getPlanningPreferences()).resolves.toEqual({
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-regular",
    });
  });

  it("saving true after false persists the updated ferries value without disturbing the profile", async () => {
    await savePlanningPreferences({
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-regular",
    });
    await savePlanningPreferences({
      avoidFerriesByDefault: true,
      profileByDefault: "cycling-regular",
    });

    await expect(getPlanningPreferences()).resolves.toEqual({
      avoidFerriesByDefault: true,
      profileByDefault: "cycling-regular",
    });
  });

  it("saving cycling-road after cycling-regular persists the updated profile without disturbing the ferry preference", async () => {
    await savePlanningPreferences({
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-regular",
    });
    await savePlanningPreferences({
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-road",
    });

    await expect(getPlanningPreferences()).resolves.toEqual({
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-road",
    });
  });

  it("stores only the expected fields on the underlying row", async () => {
    await savePlanningPreferences({
      avoidFerriesByDefault: false,
      profileByDefault: "cycling-road",
    });

    const stored = await db.planningPreferences.get("planning");
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      ["id", "avoidFerriesByDefault", "profileByDefault"].sort(),
    );
  });
});
