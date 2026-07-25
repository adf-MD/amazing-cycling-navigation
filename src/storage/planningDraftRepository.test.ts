import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import { clearDraft, getDraft, saveDraft } from "./planningDraftRepository.ts";
import type { Waypoint } from "../domain/types.ts";

const waypoints: Waypoint[] = [
  { id: "a", coordinate: [-1.5, 53.8] },
  { id: "b", coordinate: [-1.4, 53.8] },
];

beforeEach(async () => {
  await db.planningDrafts.clear();
});

describe("planningDraftRepository", () => {
  it("returns undefined when no draft has been saved", async () => {
    await expect(getDraft()).resolves.toBeUndefined();
  });

  it("saves and retrieves a draft's waypoints", async () => {
    await saveDraft(waypoints);

    const draft = await getDraft();
    expect(draft?.waypoints).toEqual(waypoints);
    expect(draft?.updatedAt).toEqual(expect.any(String));
  });

  it("saving again overwrites the previous draft", async () => {
    await saveDraft(waypoints);
    const replacement: Waypoint[] = [{ id: "c", coordinate: [0, 0] }];

    await saveDraft(replacement);

    const draft = await getDraft();
    expect(draft?.waypoints).toEqual(replacement);
  });

  it("clears the draft", async () => {
    await saveDraft(waypoints);

    await clearDraft();

    await expect(getDraft()).resolves.toBeUndefined();
  });
});
