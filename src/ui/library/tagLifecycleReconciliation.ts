/**
 * The render-time reconciler for a global tag lifecycle operation
 * (backlog item 100 stage 4A). One pure function answers all three
 * questions the Route Library needs each render — what the selected tag
 * filters should now be, whether the pending marker has done its job, and
 * whether the operation may finally be reported as complete — so exactly
 * one setSelectedTagFilters call ever runs. Two separate render-time
 * blocks each computing a next selection from the same stale render scope
 * would clobber one another: whichever ran second would overwrite the
 * first's value.
 *
 * This subsumes stage 3's own standalone stale-key pruning, which used to
 * live inline in RouteLibrary.tsx; that stage's existing tests are the
 * behaviour-preserving safety net for the move, exactly as
 * normalizeRouteTags's suite was for tagIdentityKey's extraction in stage
 * 1.
 */

/** The single in-flight marker, covering BOTH the filter follow and the
 * manager's own completion, because both need exactly the same two
 * signals: the write settling, and the live-query corpus demonstrably
 * reflecting it. Two parallel state machines here would be the third
 * instance of the pattern that has already produced two production bugs
 * in this feature (commits 6f3e2d3 and 7eb4bf1).
 *
 * `outcome` deliberately carries the repository's own counts rather than
 * being a bare string: the completion path words the result from what
 * storage actually returned, never from a pre-submit UI count that the
 * live corpus may already have invalidated. */
export interface PendingTagLifecycle {
  readonly kind: "rename" | "delete";
  readonly sourceKey: string;
  /** The source tag's display spelling as it was when the operation was
   * submitted — kept on the marker so the success message can still name
   * it after the corpus has stopped carrying it. */
  readonly sourceSpelling: string;
  /** null for a delete. */
  readonly targetKey: string | null;
  /** null for a delete. */
  readonly targetSpelling: string | null;
  /** Whether this rename was really a merge into an existing tag, so the
   * success message can say so. Always false for a delete. */
  readonly isMerge: boolean;
  readonly outcome:
    | { readonly status: "pending" }
    | {
        readonly status: "applied";
        readonly sourceRouteCount: number;
        readonly writtenRouteCount: number;
      };
}

export interface TagLifecycleReconciliation {
  /** Non-null ONLY when the selection genuinely changes this render — the
   * caller must not call setState otherwise, or rendering loops. */
  readonly nextSelectedKeys: ReadonlySet<string> | null;
  /** The marker has done its job (or can never do it) and must be nulled. */
  readonly clearPending: boolean;
  /** Both signals have landed: the manager may now report success, reset
   * its form and hand focus on. */
  readonly completed: boolean;
}

const NOTHING: TagLifecycleReconciliation = {
  nextSelectedKeys: null,
  clearPending: false,
  completed: false,
};

/** Has the live-query corpus demonstrably caught up with this write?
 *
 * A zero-write outcome settles on the write signal alone: an
 * already-canonical respelling, or a source no route carries any more,
 * changes nothing on disk, so the corpus will never fire again and
 * waiting for it would hang the manager on "Applying…" forever. That is
 * exactly the successful-no-op case that broke stage 2. */
function isCorpusSettled(
  pending: PendingTagLifecycle,
  availableKeys: ReadonlySet<string>,
  availableTags: readonly string[],
): boolean {
  const { outcome } = pending;
  if (outcome.status !== "applied") return false;
  if (outcome.writtenRouteCount === 0) return true;

  if (pending.kind === "delete") {
    return !availableKeys.has(pending.sourceKey);
  }
  if (pending.targetKey === null || pending.targetSpelling === null) return false;

  // A display-only respelling never changes which identities exist, so an
  // identity-key predicate could never settle it. The corpus signal is the
  // established SPELLING for that identity instead.
  if (pending.targetKey === pending.sourceKey) {
    return availableTags.includes(pending.targetSpelling);
  }

  // The complete terminal predicate for an identity-changing rename or a
  // merge: the target exists AND the source is gone. "Target present"
  // alone is not enough — on a promise-first MERGE the target already
  // existed before the operation began, so that weaker test would be true
  // immediately, the marker would be cleared while the source was still
  // present, and the later live-query removal would prune the source
  // selection instead of following it to the target.
  return availableKeys.has(pending.targetKey) && !availableKeys.has(pending.sourceKey);
}

export function reconcileTagLifecycle(input: {
  readonly selectedKeys: ReadonlySet<string>;
  readonly availableKeys: ReadonlySet<string>;
  /** The corpus's established display spellings, in display order — the
   * Route Library's existing tagSuggestions memo. */
  readonly availableTags: readonly string[];
  readonly pending: PendingTagLifecycle | null;
  /** tagFiltersHydrated && routes !== undefined. useLiveQuery returns
   * undefined until IndexedDB resolves, so the corpus is legitimately
   * empty during that window and nothing may be pruned or completed yet. */
  readonly corpusReady: boolean;
}): TagLifecycleReconciliation {
  const { selectedKeys, availableKeys, availableTags, pending, corpusReady } = input;
  if (!corpusReady) return NOTHING;

  const settled =
    pending !== null && isCorpusSettled(pending, availableKeys, availableTags);

  // Bounded termination: if the write applied but BOTH identities have
  // since vanished (the tag was deleted again straight afterwards), the
  // terminal predicate can never come true, so the marker is abandoned
  // rather than protecting the source key indefinitely.
  const abandoned =
    pending !== null &&
    pending.kind === "rename" &&
    pending.targetKey !== null &&
    pending.outcome.status === "applied" &&
    !availableKeys.has(pending.sourceKey) &&
    !availableKeys.has(pending.targetKey);

  const next = new Set(selectedKeys);

  // `settled` already implies `pending !== null` — TypeScript's aliased-
  // condition narrowing carries that through, so repeating the check here
  // is flagged as unreachable rather than defensive.
  if (
    settled &&
    pending.kind === "rename" &&
    pending.targetKey !== null &&
    pending.targetKey !== pending.sourceKey &&
    // Only ever carries a filter the rider had ALREADY selected. A global
    // rename performed with no source filter active must never
    // spontaneously activate the target filter.
    next.has(pending.sourceKey)
  ) {
    next.delete(pending.sourceKey);
    // Set membership IS the merge collapse: source and target both
    // selected end as one target selection, never a duplicate.
    next.add(pending.targetKey);
  }

  for (const key of [...next]) {
    if (availableKeys.has(key)) continue;
    // Protected while a rename marker is live but not yet terminal:
    // without this, a live-query update arriving BEFORE the write settles
    // would prune the source key and leave the follow nothing to follow.
    // Never permanent masking — the marker is always cleared by `settled`
    // or `abandoned`, or explicitly on failure, after which the ordinary
    // prune runs on the very next render.
    if (
      pending !== null &&
      pending.kind === "rename" &&
      key === pending.sourceKey &&
      !settled
    ) {
      continue;
    }
    next.delete(key);
  }

  const changed =
    next.size !== selectedKeys.size || [...next].some((key) => !selectedKeys.has(key));

  return {
    nextSelectedKeys: changed ? next : null,
    clearPending: settled || abandoned,
    completed: settled,
  };
}
