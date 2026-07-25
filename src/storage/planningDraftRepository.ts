import { db, type StoredPlanningDraft } from "./db.ts";
import type { Waypoint } from "../domain/types.ts";

const DRAFT_ID = "draft";

export async function getDraft(): Promise<StoredPlanningDraft | undefined> {
  return db.planningDrafts.get(DRAFT_ID);
}

export async function saveDraft(waypoints: readonly Waypoint[]): Promise<void> {
  await db.planningDrafts.put({
    id: DRAFT_ID,
    waypoints,
    updatedAt: new Date().toISOString(),
  });
}

export async function clearDraft(): Promise<void> {
  await db.planningDrafts.delete(DRAFT_ID);
}
