import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import {
  getRouteLibraryPreferences,
  saveRouteLibraryPreferences,
} from "./routeLibraryPreferencesRepository.ts";

beforeEach(async () => {
  await db.routeLibraryPreferences.clear();
});

describe("routeLibraryPreferencesRepository", () => {
  it("resolves sortOrder: most-recent when no row has been saved", async () => {
    await expect(getRouteLibraryPreferences()).resolves.toEqual({
      sortOrder: "most-recent",
    });
  });

  it("saves and retrieves sortOrder: name-asc", async () => {
    await saveRouteLibraryPreferences({ sortOrder: "name-asc" });

    await expect(getRouteLibraryPreferences()).resolves.toEqual({
      sortOrder: "name-asc",
    });
  });

  it("saving most-recent after name-asc persists the updated value", async () => {
    await saveRouteLibraryPreferences({ sortOrder: "name-asc" });
    await saveRouteLibraryPreferences({ sortOrder: "most-recent" });

    await expect(getRouteLibraryPreferences()).resolves.toEqual({
      sortOrder: "most-recent",
    });
  });

  it("stores only the expected fields on the underlying row", async () => {
    await saveRouteLibraryPreferences({ sortOrder: "name-asc" });

    const stored = await db.routeLibraryPreferences.get("route-library");
    expect(Object.keys(stored ?? {}).sort()).toEqual(["id", "sortOrder"].sort());
  });
});
