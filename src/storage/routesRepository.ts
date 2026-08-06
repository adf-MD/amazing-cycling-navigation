import { db } from "./db.ts";
import type { PlannedRoute } from "../domain/types.ts";
import { systemClock, type Clock } from "../platform/clock.ts";

export async function saveRoute(route: PlannedRoute): Promise<void> {
  await db.routes.put(route);
}

export async function getRoute(id: string): Promise<PlannedRoute | undefined> {
  return db.routes.get(id);
}

export async function listRoutes(): Promise<PlannedRoute[]> {
  return db.routes.orderBy("createdAt").reverse().toArray();
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

export async function deleteRoute(id: string): Promise<void> {
  await db.routes.delete(id);
}
