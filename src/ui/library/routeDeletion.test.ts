import { describe, expect, it } from "vitest";
import {
  clearFailedRouteDeletion,
  dismissRouteDeletion,
  isRouteDeletionBusy,
  markRouteDeletionCommitted,
  markRouteDeletionFailed,
  reconcileRouteDeletion,
  startRouteDeletion,
  type RouteDeletion,
} from "./routeDeletion.ts";

const deleting: RouteDeletion = { attempt: 2, routeId: "route-a", phase: "deleting" };
const committed: RouteDeletion = { ...deleting, phase: "committed" };
const failed: RouteDeletion = { ...deleting, phase: "failed" };

describe("routeDeletion (backlog item 124, D-02)", () => {
  it("starts an attempt in the deleting phase", () => {
    expect(startRouteDeletion(3, "route-b")).toEqual({
      attempt: 3,
      routeId: "route-b",
      phase: "deleting",
    });
  });

  it("is busy while deleting or committed, and not once failed or absent", () => {
    expect(isRouteDeletionBusy(deleting)).toBe(true);
    expect(isRouteDeletionBusy(committed)).toBe(true);
    expect(isRouteDeletionBusy(failed)).toBe(false);
    expect(isRouteDeletionBusy(null)).toBe(false);
  });

  it("commits or fails only its own running attempt", () => {
    expect(markRouteDeletionCommitted(deleting, 2)).toEqual(committed);
    expect(markRouteDeletionFailed(deleting, 2)).toEqual(failed);
    // A late result for an older attempt, or for an attempt already
    // settled, changes nothing — and returns the very same object.
    for (const current of [deleting, committed, failed, null]) {
      expect(markRouteDeletionCommitted(current, 1)).toBe(current);
      expect(markRouteDeletionFailed(current, 1)).toBe(current);
    }
    expect(markRouteDeletionCommitted(failed, 2)).toBe(failed);
    expect(markRouteDeletionFailed(committed, 2)).toBe(committed);
  });

  it("dismisses only a failed attempt, and only that attempt", () => {
    expect(dismissRouteDeletion(failed, 2)).toBeNull();
    expect(dismissRouteDeletion(failed, 1)).toBe(failed);
    expect(dismissRouteDeletion(deleting, 2)).toBe(deleting);
    expect(dismissRouteDeletion(committed, 2)).toBe(committed);
    expect(dismissRouteDeletion(null, 2)).toBeNull();
  });

  it("reconciles a committed or failed attempt, never a running one", () => {
    expect(reconcileRouteDeletion(committed, 2)).toBeNull();
    expect(reconcileRouteDeletion(failed, 2)).toBeNull();
    expect(reconcileRouteDeletion(deleting, 2)).toBe(deleting);
    expect(reconcileRouteDeletion(committed, 1)).toBe(committed);
  });

  it("clears a failed attempt for a newer interaction, never a running or committed one", () => {
    expect(clearFailedRouteDeletion(failed)).toBeNull();
    expect(clearFailedRouteDeletion(deleting)).toBe(deleting);
    expect(clearFailedRouteDeletion(committed)).toBe(committed);
    expect(clearFailedRouteDeletion(null)).toBeNull();
  });
});
