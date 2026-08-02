import type { PlannedRoute } from "../../domain/types.ts";

/**
 * Which route's name button should receive focus after `deletedId` is
 * removed from `routes`: the next surviving route, else the previous one,
 * else `null` (caller falls back to the Routes heading). `routes` must be
 * the list as it stood immediately before deletion.
 */
export function computeFocusRouteIdAfterDelete(
  routes: readonly PlannedRoute[],
  deletedId: string,
): string | null {
  const index = routes.findIndex((route) => route.id === deletedId);
  if (index === -1) {
    return null;
  }
  return routes[index + 1]?.id ?? (index > 0 ? routes[index - 1]?.id : undefined) ?? null;
}
