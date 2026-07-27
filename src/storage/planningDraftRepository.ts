import { db } from "./db.ts";
import {
  fromStoredPlanningDraft,
  toStoredPlanningDraft,
  type PlanningDraftContent,
} from "./mapping.ts";

const DRAFT_ID = "draft";

export async function getDraft(): Promise<PlanningDraftContent | undefined> {
  const stored = await db.planningDrafts.get(DRAFT_ID);
  return stored ? fromStoredPlanningDraft(stored) : undefined;
}

export async function saveDraft(content: PlanningDraftContent): Promise<void> {
  await db.planningDrafts.put({
    id: DRAFT_ID,
    ...toStoredPlanningDraft(content),
    updatedAt: new Date().toISOString(),
  });
}

export async function clearDraft(): Promise<void> {
  await db.planningDrafts.delete(DRAFT_ID);
}
