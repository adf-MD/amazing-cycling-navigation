import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import { clearDraft, getDraft, saveDraft } from "./planningDraftRepository.ts";
import type { Waypoint } from "../domain/types.ts";
import type { PlanningDraftContent } from "./mapping.ts";

const waypoints: Waypoint[] = [
  { id: "a", coordinate: [-1.5, 53.8] },
  { id: "b", coordinate: [-1.4, 53.8] },
];

const content: PlanningDraftContent = {
  waypoints,
  routeName: "Coastal loop",
  avoidFerries: false,
  profile: "cycling-regular",
};

beforeEach(async () => {
  await db.planningDrafts.clear();
});

describe("planningDraftRepository", () => {
  it("returns undefined when no draft has been saved", async () => {
    await expect(getDraft()).resolves.toBeUndefined();
  });

  it("saves and retrieves a draft's waypoints, route name, avoid-ferries preference and cycling profile", async () => {
    await saveDraft(content);

    const draft = await getDraft();
    expect(draft).toEqual({ ...content, editCopyOperation: "forward" });
  });

  it("stamps an updatedAt timestamp on the underlying stored row", async () => {
    await saveDraft(content);

    const stored = await db.planningDrafts.get("draft");
    expect(stored?.updatedAt).toEqual(expect.any(String));
  });

  it("saving again overwrites the previous draft", async () => {
    await saveDraft(content);
    const replacement: PlanningDraftContent = {
      waypoints: [{ id: "c", coordinate: [0, 0] }],
      routeName: "Replacement",
      avoidFerries: true,
      profile: "cycling-road",
    };

    await saveDraft(replacement);

    const draft = await getDraft();
    expect(draft).toEqual({ ...replacement, editCopyOperation: "forward" });
  });

  it("clears the draft", async () => {
    await saveDraft(content);

    await clearDraft();

    await expect(getDraft()).resolves.toBeUndefined();
  });

  it("defaults route name, avoid-ferries and profile for a draft written before those fields existed", async () => {
    // A raw legacy row, written directly (not via saveDraft), which
    // genuinely lacks routeName/avoidFerries/profile.
    await db.planningDrafts.put({
      id: "draft",
      waypoints,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const draft = await getDraft();

    expect(draft).toEqual({
      waypoints,
      routeName: "Planned route",
      avoidFerries: true,
      profile: "cycling-road",
      editCopyOperation: "forward",
    });
  });

  it("never persists an API key or any transient selection/mode state", async () => {
    await saveDraft(content);

    const stored = await db.planningDrafts.get("draft");
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      ["id", "waypoints", "updatedAt", "routeName", "avoidFerries", "profile"].sort(),
    );
  });
});
