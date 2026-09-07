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

  it.each(["distance-desc", "ascent-desc"] as const)(
    "saves and retrieves sortOrder: %s (item 99)",
    async (sortOrder) => {
      await saveRouteLibraryPreferences({ sortOrder });

      await expect(getRouteLibraryPreferences()).resolves.toEqual({ sortOrder });
    },
  );

  it("normalises a raw legacy distance-asc row (written by 0.4.12 or earlier) to distance-desc (item 99 follow-up)", async () => {
    await db.routeLibraryPreferences.put({
      id: "route-library",
      sortOrder: "distance-asc",
    });

    await expect(getRouteLibraryPreferences()).resolves.toEqual({
      sortOrder: "distance-desc",
    });
  });

  it("normalises a raw legacy ascent-asc row (written by 0.4.12 or earlier) to ascent-desc (item 99 follow-up)", async () => {
    await db.routeLibraryPreferences.put({
      id: "route-library",
      sortOrder: "ascent-asc",
    });

    await expect(getRouteLibraryPreferences()).resolves.toEqual({
      sortOrder: "ascent-desc",
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
