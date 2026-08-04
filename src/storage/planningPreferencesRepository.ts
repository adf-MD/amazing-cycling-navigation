import { db } from "./db.ts";
import {
  fromStoredPlanningPreferences,
  toStoredPlanningPreferences,
  type PlanningPreferences,
} from "./mapping.ts";

const PLANNING_PREFERENCES_ID = "planning";

/**
 * Always resolves to a concrete PlanningPreferences, never undefined — "no
 * row saved yet" is itself a meaningful, defaulted state here (see
 * fromStoredPlanningPreferences), unlike getProviderKey/getDraft.
 */
export async function getPlanningPreferences(): Promise<PlanningPreferences> {
  const stored = await db.planningPreferences.get(PLANNING_PREFERENCES_ID);
  return fromStoredPlanningPreferences(stored);
}

export async function savePlanningPreferences(
  preferences: PlanningPreferences,
): Promise<void> {
  await db.planningPreferences.put({
    id: PLANNING_PREFERENCES_ID,
    ...toStoredPlanningPreferences(preferences),
  });
}
