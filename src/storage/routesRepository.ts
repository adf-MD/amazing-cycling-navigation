import { db } from "./db.ts";
import type { LibraryRoute, PlannedRoute } from "../domain/types.ts";
import { normalizeRouteTags } from "../domain/routeTags.ts";
import { systemClock, type Clock } from "../platform/clock.ts";

/** Normalises a route's `tags` field into the canonical array every
 * LibraryRoute written or read through this module is guaranteed to
 * carry. Shared by saveRoute (write time) and getRoute/listRoutes (read
 * time) so a legacy row (no `tags` key) or a corrupted stored value can
 * never surface unnormalised, and so both directions can never drift
 * apart from each other. */
function toLibraryRoute(route: PlannedRoute): LibraryRoute {
  return { ...route, tags: normalizeRouteTags(route.tags) };
}

export async function saveRoute(route: PlannedRoute): Promise<void> {
  await db.routes.put(toLibraryRoute(route));
}

export async function getRoute(id: string): Promise<LibraryRoute | undefined> {
  const stored = await db.routes.get(id);
  return stored ? toLibraryRoute(stored) : undefined;
}

export async function listRoutes(): Promise<LibraryRoute[]> {
  const stored = await db.routes.orderBy("createdAt").reverse().toArray();
  return stored.map(toLibraryRoute);
}

export async function renameRoute(id: string, name: string): Promise<void> {
  await db.routes.update(id, { name });
}

export async function pinRoute(id: string, clock: Clock = systemClock): Promise<void> {
  await db.routes.update(id, { pinnedAt: new Date(clock.now()).toISOString() });
}

export async function unpinRoute(id: string): Promise<void> {
  await db.routes.update(id, { pinnedAt: null });
}

/** Normalises then persists a route's tag collection as a partial update —
 * every other field, including pinnedAt, is left untouched, exactly like
 * renameRoute/pinRoute/unpinRoute above. Stage 1 adds this purely as a
 * storage primitive; nothing in stage 1 calls it — it exists for stage
 * 2's future tag editor to build on. */
export async function updateRouteTags(
  id: string,
  tags: readonly string[],
): Promise<void> {
  await db.routes.update(id, { tags: normalizeRouteTags(tags) });
}

export async function deleteRoute(id: string): Promise<void> {
  await db.routes.delete(id);
}
