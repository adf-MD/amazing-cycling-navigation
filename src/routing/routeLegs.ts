import type { Coordinate, PlannedRoute, Waypoint } from "../domain/types.ts";
import { mergeAbortSignals } from "../platform/abortSignals.ts";
import type { RoutingOptions, RoutingProvider } from "./provider.ts";

/** Structural check, not `instanceof Error` — a fetch abort's DOMException
 * doesn't reliably satisfy `instanceof Error` in every runtime (notably
 * jsdom), and this must never wrap/replace it: doing so would strip the
 * `name === "AbortError"` property callers rely on to distinguish
 * cancellation from a genuine failure. */
function isErrorLike(value: unknown): value is Error {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "message" in value
  );
}

/** An ordered A→B pair a route needs a leg calculated for. Direction
 * matters — A→B and B→A are distinct requirements. */
export interface RouteLegRequirement {
  readonly start: Coordinate;
  readonly end: Coordinate;
}

/** A resolved leg: the requirement it satisfies, its cache key, and the
 * provider's own two-point PlannedRoute for it. */
export interface CalculatedRouteLeg {
  readonly key: string;
  readonly requirement: RouteLegRequirement;
  readonly route: PlannedRoute;
}

/** Ample for any realistically-sized route plus the distinct legs an
 * editing session's undo/redo history can revisit, at negligible per-entry
 * memory cost (one small PlannedRoute each). */
export const LEG_CACHE_MAX_ENTRIES = 64;

/** No unbounded Promise.all — a small, named concurrency ceiling on
 * in-flight leg requests. */
export const LEG_REQUEST_CONCURRENCY_LIMIT = 2;

/** Derives the n-1 consecutive, ordered leg requirements for n waypoints
 * (A→B, B→C, ...). Keyed on each waypoint's own coordinate, never its id —
 * moving a waypoint (same id, new coordinate) must still change which
 * requirements it produces. */
export function deriveLegRequirements(
  waypoints: readonly Waypoint[],
): RouteLegRequirement[] {
  const requirements: RouteLegRequirement[] = [];
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const start = waypoints[i];
    const end = waypoints[i + 1];
    if (!start || !end) continue;
    requirements.push({ start: start.coordinate, end: end.coordinate });
  }
  return requirements;
}

/** Exact-value key composition — coordinates come from stable, user-placed
 * waypoints (never noisy GPS), so bit-identical equality is correct and
 * simplest here. This is a deliberately different concern from
 * stitchPlannedRouteLegs.ts's seam-tolerance distance comparison, which
 * legitimately wants tolerance between two independently-returned
 * geometries. Never includes an API key — only the routing options and
 * coordinates a rider already sees on the map. */
function buildRouteLegKey(
  providerToken: number,
  requirement: RouteLegRequirement,
  options: RoutingOptions,
): string {
  const [startLon, startLat] = requirement.start;
  const [endLon, endLat] = requirement.end;
  return [
    providerToken,
    options.profile,
    options.avoidFerries ?? false,
    startLon,
    startLat,
    endLon,
    endLat,
  ].join("|");
}

/** A small, deterministic, bounded leg cache — plain in-memory Map with a
 * hand-rolled LRU eviction, no new dependency. Session-only: never
 * persisted, cleared entirely when a fresh instance is created (the
 * caller's responsibility whenever the adapter/provider instance
 * changes — see getProviderInstanceToken). */
export class RouteLegCache {
  private readonly entries = new Map<string, PlannedRoute>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = LEG_CACHE_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): PlannedRoute | undefined {
    const route = this.entries.get(key);
    if (route === undefined) return undefined;
    // Touch: re-insertion moves this key to the end of Map's insertion
    // order, i.e. most-recently-used.
    this.entries.delete(key);
    this.entries.set(key, route);
    return route;
  }

  set(key: string, route: PlannedRoute): void {
    this.entries.delete(key);
    this.entries.set(key, route);
    if (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
  }
}

const providerInstanceTokens = new WeakMap<RoutingProvider, number>();
let nextProviderInstanceToken = 0;

/** A stable, opaque per-instance token for a RoutingProvider — assigned
 * once per distinct adapter object the first time it's seen. Used both as
 * a leg-cache-key component and as the signal a caller should swap in a
 * fresh RouteLegCache, so a leg from one adapter instance is never served
 * from a cache another instance populated. */
export function getProviderInstanceToken(adapter: RoutingProvider): number {
  const existing = providerInstanceTokens.get(adapter);
  if (existing !== undefined) return existing;
  const token = nextProviderInstanceToken;
  nextProviderInstanceToken += 1;
  providerInstanceTokens.set(adapter, token);
  return token;
}

export interface ResolveRouteLegsContext {
  adapter: RoutingProvider;
  cache: RouteLegCache;
  providerToken: number;
  signal?: AbortSignal;
  /** Invoked synchronously, once, with the number of legs that need a
   * fresh provider request this batch (0 if every leg was already
   * cached) — before any request is dispatched. Purely for UI progress
   * transparency; never required for correctness. */
  onBatchStart?: (missingLegCount: number) => void;
}

/**
 * Resolves every leg requirement — from cache where possible, from the
 * provider (through its normal public calculateRoute([start, end], ...)
 * call, never a second ORS code path) for the rest — with no more than
 * LEG_REQUEST_CONCURRENCY_LIMIT requests in flight at once. Every
 * successful leg is cached immediately and unconditionally, even after a
 * sibling leg in the same batch has failed, so it stays reusable later.
 * Failed or aborted legs are never cached.
 *
 * Owns its own internal AbortController, merged with the caller's
 * `signal` (if any) via mergeAbortSignals — it never reaches into the
 * caller's own AbortController. External supersession (the caller's
 * signal aborting) and a decisive failure from any one leg (which aborts
 * this internal controller, cancelling sibling in-flight legs "when
 * safe") both surface identically: an outright promise rejection with
 * whichever error occurred first. The caller's own AbortError handling
 * covers both cases without needing to distinguish them here. Never
 * returns a partial result — either every requirement resolves, or the
 * promise rejects.
 */
export async function resolveRouteLegsInOrder(
  requirements: readonly RouteLegRequirement[],
  options: RoutingOptions,
  ctx: ResolveRouteLegsContext,
): Promise<CalculatedRouteLeg[]> {
  const keys = requirements.map((requirement) =>
    buildRouteLegKey(ctx.providerToken, requirement, options),
  );

  const results: (CalculatedRouteLeg | undefined)[] = requirements.map(
    (requirement, index) => {
      const key = keys[index];
      if (key === undefined) return undefined;
      const cachedRoute = ctx.cache.get(key);
      return cachedRoute ? { key, requirement, route: cachedRoute } : undefined;
    },
  );

  const missingIndexes: number[] = [];
  results.forEach((result, index) => {
    if (result === undefined) missingIndexes.push(index);
  });

  ctx.onBatchStart?.(missingIndexes.length);

  if (missingIndexes.length === 0) {
    return results as CalculatedRouteLeg[];
  }

  const internalController = new AbortController();
  const effectiveSignal = mergeAbortSignals(ctx.signal, internalController.signal);

  // A mutable holder object, not a bare local — read/written across
  // concurrently-running worker() invocations separated by `await`
  // points, where a bare closed-over `let` can mislead static narrowing
  // about whether it can still be null at a given point.
  const failureState: { error: Error | null } = { error: null };
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      if (failureState.error !== null) return;
      const listIndex = cursor;
      cursor += 1;
      if (listIndex >= missingIndexes.length) return;

      const requirementIndex = missingIndexes[listIndex];
      if (requirementIndex === undefined) continue;
      const requirement = requirements[requirementIndex];
      const key = keys[requirementIndex];
      if (!requirement || key === undefined) continue;

      try {
        const route = await ctx.adapter.calculateRoute(
          [requirement.start, requirement.end],
          options,
          effectiveSignal,
        );
        ctx.cache.set(key, route);
        results[requirementIndex] = { key, requirement, route };
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TypeScript's flow analysis can't see that a concurrently-running sibling worker() may have already set failureState.error during the `await` above; this check is genuinely load-bearing for keeping the first decisive failure.
        if (failureState.error === null) {
          failureState.error = isErrorLike(error) ? error : new Error(String(error));
          internalController.abort();
        }
        return;
      }
    }
  }

  const workerCount = Math.min(LEG_REQUEST_CONCURRENCY_LIMIT, missingIndexes.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (failureState.error !== null) {
    throw failureState.error;
  }

  return results as CalculatedRouteLeg[];
}
