import { db } from "./db.ts";
import type { LibraryRoute, PlannedRoute } from "../domain/types.ts";
import * as routeTags from "../domain/routeTags.ts";
import { normalizeRouteTags, tagIdentityKey } from "../domain/routeTags.ts";
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

/** One global tag lifecycle operation (backlog item 100 stage 4A).
 * `sourceKey` is a tagIdentityKey; `targetSpelling` is the settled display
 * spelling the caller has already resolved (see RouteLibrary.tsx's own
 * three-way source/merge/novel resolution). A rename to an identity that
 * already exists IS the merge — there is deliberately no separate merge
 * operation, because the storage work is identical and only the
 * confirmation wording differs. */
export type RouteTagLifecycleOperation =
  | { kind: "rename"; sourceKey: string; targetSpelling: string }
  | { kind: "delete"; sourceKey: string };

/** `sourceRouteCount` is the number of saved routes that carried the
 * source identity when the transaction ran — the authoritative,
 * rider-facing number every message uses, never a pre-submit UI count.
 * `writtenRouteCount` can be lower (an already-canonical respelling
 * changes nothing on disk) and exists so "writes only the routes that
 * actually change" is directly testable; it is deliberately NOT used for
 * copy, since "0 routes updated" would be nonsense for a successful no-op.
 * A `sourceRouteCount` of 0 means the tag is no longer used by any route,
 * so there is no separate "source-missing" status to leave untested. */
export type RouteTagLifecycleOutcome =
  | { status: "applied"; sourceRouteCount: number; writtenRouteCount: number }
  | { status: "invalid-target" };

/** Applies a global tag rename, merge or delete across every saved route
 * as ONE Dexie transaction (backlog item 100 stage 4A).
 *
 * Deliberately not a loop of independent updateRouteTags() promises: a
 * failure part-way through must leave every route unchanged, so the rows
 * are re-read inside the transaction and the outcome is built and
 * returned from inside the callback too — nothing that can throw runs
 * after the await, so a rejection always implies the transaction aborted
 * and no live-query invalidation ever fired.
 *
 * Candidate rows are selected by the SOURCE identity alone: a route that
 * only ever carried the target is left byte-identical. (Within a selected
 * row, applyTagRename does map the target identity too — that is what
 * deduplicates a merge and settles the spelling there.) A consequence
 * worth stating: a merge does not repair a spelling variation that
 * already existed among target-only rows. It cannot create one — a rename
 * to a novel identity has no target rows at all, and a display-only
 * respelling has source identity === target identity, so every row
 * carrying it is a source row and all are rewritten.
 *
 * A row is written only when the result differs from the RAW stored value
 * by exact element-wise equality, not from its canonicalised form: a
 * legacy row whose bytes still differ from what this module guarantees
 * (say ["Gravel", "gravel"]) must be rewritten, not skipped as
 * "unchanged". Only the non-indexed `tags` field is touched, so no Dexie
 * version bump or index change is needed — see db.ts's own note.
 *
 * The three domain helpers below are deliberately called through the
 * module namespace (`routeTags.x`) rather than as named imports. That is
 * what lets routesRepository.test.ts inject a failure PART-WAY THROUGH
 * this loop — the atomicity proof, and the only thing that makes the
 * "replace the transaction with independent writes" negative control
 * discriminate — without any production test seam and without weakening
 * the transaction. Converting them to named imports would silently
 * disarm that control. */
export async function applyRouteTagLifecycle(
  operation: RouteTagLifecycleOperation,
): Promise<RouteTagLifecycleOutcome> {
  const sourceKey = tagIdentityKey(operation.sourceKey);
  if (operation.kind === "rename") {
    const [target] = normalizeRouteTags([operation.targetSpelling]);
    if (target === undefined) {
      return { status: "invalid-target" };
    }
  }

  return db.transaction("rw", db.routes, async () => {
    const stored = await db.routes.toArray();
    let sourceRouteCount = 0;
    let writtenRouteCount = 0;

    for (const row of stored) {
      if (!routeTags.tagsContainIdentity(row.tags, sourceKey)) continue;
      sourceRouteCount += 1;

      const next =
        operation.kind === "rename"
          ? routeTags.applyTagRename(row.tags, sourceKey, operation.targetSpelling)
          : routeTags.applyTagRemoval(row.tags, sourceKey);

      const raw = row.tags;
      const unchanged =
        Array.isArray(raw) &&
        raw.length === next.length &&
        raw.every((tag, index) => tag === next[index]);
      if (unchanged) continue;

      await db.routes.update(row.id, { tags: next });
      writtenRouteCount += 1;
    }

    return { status: "applied", sourceRouteCount, writtenRouteCount };
  });
}
