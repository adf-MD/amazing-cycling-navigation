import { db } from "./db.ts";
import {
  fromStoredAppPreferences,
  toStoredAppPreferences,
  type AppPreferences,
} from "./mapping.ts";

const APP_PREFERENCES_ID = "app";

/**
 * Always resolves to a concrete AppPreferences, never undefined — "no row
 * saved yet" is itself the meaningful default state (see
 * fromStoredAppPreferences), exactly as for the Route Library's own
 * preferences row.
 */
export async function getAppPreferences(): Promise<AppPreferences> {
  const stored = await db.appPreferences.get(APP_PREFERENCES_ID);
  return fromStoredAppPreferences(stored);
}

export async function saveAppPreferences(preferences: AppPreferences): Promise<void> {
  await db.appPreferences.put({
    id: APP_PREFERENCES_ID,
    ...toStoredAppPreferences(preferences),
  });
}
