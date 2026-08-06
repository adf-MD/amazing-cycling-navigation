import { db } from "./db.ts";
import {
  fromStoredRouteLibraryPreferences,
  toStoredRouteLibraryPreferences,
  type RouteLibraryPreferences,
} from "./mapping.ts";

const ROUTE_LIBRARY_PREFERENCES_ID = "route-library";

/**
 * Always resolves to a concrete RouteLibraryPreferences, never undefined —
 * "no row saved yet" is itself a meaningful, defaulted state here (see
 * fromStoredRouteLibraryPreferences).
 */
export async function getRouteLibraryPreferences(): Promise<RouteLibraryPreferences> {
  const stored = await db.routeLibraryPreferences.get(ROUTE_LIBRARY_PREFERENCES_ID);
  return fromStoredRouteLibraryPreferences(stored);
}

export async function saveRouteLibraryPreferences(
  preferences: RouteLibraryPreferences,
): Promise<void> {
  await db.routeLibraryPreferences.put({
    id: ROUTE_LIBRARY_PREFERENCES_ID,
    ...toStoredRouteLibraryPreferences(preferences),
  });
}
