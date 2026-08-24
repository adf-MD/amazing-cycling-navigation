import type { PlannedRoute } from "../../domain/types.ts";
import type { StoredRideState } from "../../storage/db.ts";
import {
  isStoredFreeRoamRideState,
  isStoredRouteRideState,
  resolveStoredRideSessionKind,
} from "../../storage/mapping.ts";

/**
 * What the rider is attempting to open/resume/start — one of App.tsx's
 * five ride-content entry points (a Routes-card open, a Planning save that
 * opens Riding, the launcher's Resume ride, and Start/Resume free roam).
 * Carries the full PlannedRoute (not just an id) so a caller can both
 * classify against it and open it directly on a favourable outcome with no
 * second repository lookup.
 */
export type RideSessionTarget =
  { kind: "route"; route: PlannedRoute } | { kind: "free-roam" };

/**
 * The result of comparing the persisted singleton active-session row
 * against a requested RideSessionTarget (backlog item 73):
 * - "proceed": no unfinished session exists at all.
 * - "resume": the persisted row is the exact same session already — a
 *   route session with a matching routeId, or free roam vs. free roam
 *   (free-roam rows carry no distinguishing id, so any existing free-roam
 *   row is always the "same" session as a fresh free-roam request).
 * - "conflict": a genuinely different unfinished session is persisted —
 *   `existing` records what kind it was (including "unsupported" for a
 *   present-but-unrecognised `kind`, which still needs the same
 *   confirm-then-clear treatment as a genuine different-session conflict,
 *   never a silent pass-through).
 */
export type RideTransitionOutcome =
  | { kind: "proceed" }
  | { kind: "resume" }
  | { kind: "conflict"; existing: "route" | "free-roam" | "unsupported" };

/**
 * Pure classification, deliberately storage- and React-free: the async
 * shell that reads getActiveRideState() and handles a read failure lives
 * one layer up, in App.tsx, since this function can't itself observe a
 * rejected read. Built entirely on the existing storage/mapping.ts
 * discriminators so the "legacy row with no kind field is a route" and
 * "a present-but-unrecognised kind is unsupported, never silently treated
 * as a route" rules stay in exactly one place.
 */
export function classifyRideTransition(
  stored: StoredRideState | undefined,
  target: RideSessionTarget,
): RideTransitionOutcome {
  if (!stored) return { kind: "proceed" };

  if (resolveStoredRideSessionKind(stored) === "unsupported") {
    return { kind: "conflict", existing: "unsupported" };
  }

  if (target.kind === "route") {
    if (!isStoredRouteRideState(stored)) {
      return { kind: "conflict", existing: "free-roam" };
    }
    return stored.routeId === target.route.id
      ? { kind: "resume" }
      : { kind: "conflict", existing: "route" };
  }

  return isStoredFreeRoamRideState(stored)
    ? { kind: "resume" }
    : { kind: "conflict", existing: "route" };
}
