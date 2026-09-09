import { describe, expect, it } from "vitest";
import {
  reconcileTagLifecycle,
  type PendingTagLifecycle,
} from "./tagLifecycleReconciliation.ts";

function pendingRename(
  overrides: Partial<PendingTagLifecycle> = {},
): PendingTagLifecycle {
  return {
    kind: "rename",
    sourceKey: "gravel",
    sourceSpelling: "Gravel",
    targetKey: "trail",
    targetSpelling: "Trail",
    isMerge: false,
    outcome: { status: "applied", sourceRouteCount: 2, writtenRouteCount: 2 },
    ...overrides,
  };
}

function run(input: {
  selected?: readonly string[];
  available?: readonly string[];
  availableTags?: readonly string[];
  pending?: PendingTagLifecycle | null;
  corpusReady?: boolean;
}) {
  return reconcileTagLifecycle({
    selectedKeys: new Set(input.selected ?? []),
    availableKeys: new Set(input.available ?? []),
    availableTags: input.availableTags ?? [],
    pending: input.pending ?? null,
    corpusReady: input.corpusReady ?? true,
  });
}

describe("reconcileTagLifecycle", () => {
  it("does nothing at all until the corpus is ready", () => {
    // useLiveQuery returns undefined until IndexedDB resolves, so an
    // empty corpus in that window must never erase a just-restored
    // selection.
    expect(run({ selected: ["gravel"], available: [], corpusReady: false })).toEqual({
      nextSelectedKeys: null,
      clearPending: false,
      completed: false,
    });
  });

  it("prunes a stale selected key with no pending operation, exactly as stage 3 did", () => {
    const result = run({ selected: ["gravel", "road"], available: ["road"] });
    expect([...(result.nextSelectedKeys ?? [])]).toEqual(["road"]);
    expect(result.completed).toBe(false);
  });

  it("returns a null selection whenever nothing changes, so rendering cannot loop", () => {
    expect(run({ selected: ["road"], available: ["road"] }).nextSelectedKeys).toBeNull();
    expect(run({ selected: [], available: ["road"] }).nextSelectedKeys).toBeNull();
  });

  it("protects the source key from pruning while the write is still pending", () => {
    // Live-query-first ordering: the corpus has already dropped "gravel"
    // but the write promise has not settled. Pruning here would leave the
    // follow nothing to follow.
    const result = run({
      selected: ["gravel"],
      available: ["trail"],
      pending: pendingRename({ outcome: { status: "pending" } }),
    });
    expect(result.nextSelectedKeys).toBeNull();
    expect(result.clearPending).toBe(false);
    expect(result.completed).toBe(false);
  });

  it("follows a selected source to the target once both signals have landed", () => {
    const result = run({
      selected: ["gravel"],
      available: ["trail"],
      pending: pendingRename(),
    });
    expect([...(result.nextSelectedKeys ?? [])]).toEqual(["trail"]);
    expect(result.clearPending).toBe(true);
    expect(result.completed).toBe(true);
  });

  it("does not follow while the target is present but the source has not yet gone", () => {
    // The promise-first MERGE case: the target already existed before the
    // operation, so a "target is present" test alone would clear the
    // marker here and the later source removal would prune the selection.
    const result = run({
      selected: ["gravel", "trail"],
      available: ["gravel", "trail"],
      pending: pendingRename(),
    });
    expect(result.nextSelectedKeys).toBeNull();
    expect(result.clearPending).toBe(false);
    expect(result.completed).toBe(false);
  });

  it("collapses a source and target both selected into exactly one target selection", () => {
    const result = run({
      selected: ["gravel", "trail"],
      available: ["trail"],
      pending: pendingRename(),
    });
    expect([...(result.nextSelectedKeys ?? [])]).toEqual(["trail"]);
  });

  it("does not activate the target filter when the source was never selected", () => {
    const result = run({
      selected: ["road"],
      available: ["trail", "road"],
      pending: pendingRename(),
    });
    expect(result.nextSelectedKeys).toBeNull();
    expect(result.clearPending).toBe(true);
    expect(result.completed).toBe(true);
  });

  it("still prunes an unrelated stale key while a rename marker is pending", () => {
    const result = run({
      selected: ["gravel", "ferry"],
      available: ["trail"],
      pending: pendingRename({ outcome: { status: "pending" } }),
    });
    expect([...(result.nextSelectedKeys ?? [])]).toEqual(["gravel"]);
    expect(result.clearPending).toBe(false);
  });

  it("preserves an unrelated selected key that is still in the corpus, across a follow", () => {
    const result = run({
      selected: ["gravel", "road"],
      available: ["trail", "road"],
      pending: pendingRename(),
    });
    expect([...(result.nextSelectedKeys ?? [])].sort()).toEqual(["road", "trail"]);
  });

  it("completes a delete once the corpus has dropped the identity, with no follow", () => {
    const pending: PendingTagLifecycle = {
      kind: "delete",
      sourceKey: "gravel",
      sourceSpelling: "Gravel",
      targetKey: null,
      targetSpelling: null,
      isMerge: false,
      outcome: { status: "applied", sourceRouteCount: 2, writtenRouteCount: 2 },
    };
    const pendingResult = run({ selected: ["gravel"], available: ["gravel"], pending });
    expect(pendingResult.completed).toBe(false);

    const settled = run({ selected: ["gravel"], available: [], pending });
    expect(settled.completed).toBe(true);
    expect(settled.clearPending).toBe(true);
    expect([...(settled.nextSelectedKeys ?? [])]).toEqual([]);
  });

  it("completes a display-only respelling on the established spelling, not an identity key", () => {
    const pending = pendingRename({
      targetKey: "gravel",
      targetSpelling: "GRAVEL",
    });
    expect(
      run({ available: ["gravel"], availableTags: ["Gravel"], pending }).completed,
    ).toBe(false);
    const settled = run({
      selected: ["gravel"],
      available: ["gravel"],
      availableTags: ["GRAVEL"],
      pending,
    });
    expect(settled.completed).toBe(true);
    expect(settled.nextSelectedKeys).toBeNull();
  });

  it("completes a zero-write outcome on the write signal alone", () => {
    // An already-canonical respelling, or a source no route carries any
    // more, will never change the corpus again — waiting for a corpus
    // signal would hang the manager forever.
    const pending = pendingRename({
      targetKey: "gravel",
      targetSpelling: "Gravel",
      outcome: { status: "applied", sourceRouteCount: 3, writtenRouteCount: 0 },
    });
    const result = run({ available: ["gravel"], availableTags: ["Gravel"], pending });
    expect(result.completed).toBe(true);
    expect(result.clearPending).toBe(true);
  });

  it("abandons a marker whose source and target have both vanished", () => {
    const result = run({
      selected: [],
      available: [],
      pending: pendingRename(),
    });
    expect(result.clearPending).toBe(true);
  });

  it("never completes while the outcome is still pending", () => {
    expect(
      run({
        available: ["trail"],
        pending: pendingRename({ outcome: { status: "pending" } }),
      }).completed,
    ).toBe(false);
  });
});
