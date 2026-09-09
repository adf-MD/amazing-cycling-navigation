import { resolveTagSpelling, tagIdentityKey } from "../../domain/routeTags.ts";

/**
 * The two pure resolutions the global tag manager (backlog item 100 stage
 * 4A) needs, shared by the panel that renders them and by RouteLibrary,
 * which builds the operation — one implementation, so the preview copy,
 * the confirmation and the write can never disagree about what is about
 * to happen.
 */

/** The display spelling the corpus currently establishes for an identity,
 * or null if nothing carries it. */
export function findTagSpelling(tags: readonly string[], key: string): string | null {
  return tags.find((tag) => tagIdentityKey(tag) === key) ?? null;
}

/** The source tag the manager should actually act on: the chosen one, or
 * the neutral placeholder ("") once the corpus no longer carries it.
 *
 * Deliberately derived rather than stored-and-reconciled, and used for
 * BEHAVIOUR — the disabled state, the preview and confirmation copy, the
 * target resolution and the operation handed to storage — not merely for
 * the rendered <select> value. A <select> whose value matches no option
 * silently displays the first one, so deriving only the display would
 * leave every other path reading a stale key and arm a destructive action
 * against the wrong tag. */
export function resolveEffectiveSourceKey(
  tags: readonly string[],
  sourceKey: string,
): string {
  if (sourceKey === "") return "";
  return findTagSpelling(tags, sourceKey) === null ? "" : sourceKey;
}

export interface ResolvedTagTarget {
  /** null when the typed name is empty or whitespace-only. */
  readonly targetSpelling: string | null;
  /** The typed name resolves to an identity some OTHER tag already holds,
   * so this rename is really a merge and needs explicit confirmation. */
  readonly isMerge: boolean;
}

/** Resolves what a typed new name should actually become, in three cases:
 *
 * 1. its identity equals the source's — a display-only respelling, and the
 *    TYPED spelling wins;
 * 2. its identity matches another existing tag — a merge, and that tag's
 *    ESTABLISHED spelling wins;
 * 3. otherwise — a plain rename, and the typed spelling wins.
 *
 * All three fall out of reusing resolveTagSpelling with the source tag
 * excluded from the known corpus. Excluding it is load-bearing: passing
 * the full corpus would make a deliberate case-only rename ("Gravel" →
 * "gravel") resolve straight back to the existing spelling and silently
 * become a no-op. */
export function resolveTagLifecycleTarget(
  tags: readonly string[],
  sourceKey: string,
  typedName: string,
): ResolvedTagTarget {
  const others = tags.filter((tag) => tagIdentityKey(tag) !== sourceKey);
  const targetSpelling = resolveTagSpelling(typedName, others);
  if (targetSpelling === null) {
    return { targetSpelling: null, isMerge: false };
  }
  const targetKey = tagIdentityKey(targetSpelling);
  return {
    targetSpelling,
    isMerge: others.some((tag) => tagIdentityKey(tag) === targetKey),
  };
}
