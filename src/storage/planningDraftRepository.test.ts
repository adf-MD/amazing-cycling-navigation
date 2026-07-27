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
};

beforeEach(async () => {
  await db.planningDrafts.clear();
});

describe("planningDraftRepository", () => {
  it("returns undefined when no draft has been saved", async () => {
    await expect(getDraft()).resolves.toBeUndefined();
  });

  it("saves and retrieves a draft's waypoints, route name and avoid-ferries preference", async () => {
    await saveDraft(content);

    const draft = await getDraft();
    expect(draft).toEqual(content);
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
    };

    await saveDraft(replacement);

    const draft = await getDraft();
    expect(draft).toEqual(replacement);
  });

  it("clears the draft", async () => {
    await saveDraft(content);

    await clearDraft();

    await expect(getDraft()).resolves.toBeUndefined();
  });

  it("defaults route name and avoid-ferries for a draft written before those fields existed", async () => {
    // A raw legacy row, written directly (not via saveDraft), which
    // genuinely lacks routeName/avoidFerries.
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
    });
  });

  it("never persists an API key or any transient selection/mode state", async () => {
    await saveDraft(content);

    const stored = await db.planningDrafts.get("draft");
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      ["id", "waypoints", "updatedAt", "routeName", "avoidFerries"].sort(),
    );
  });
});
