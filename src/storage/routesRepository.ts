import { db } from "./db.ts";
import type { PlannedRoute } from "../domain/types.ts";

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

export async function deleteRoute(id: string): Promise<void> {
  await db.routes.delete(id);
}
