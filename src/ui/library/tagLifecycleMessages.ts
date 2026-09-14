/**
 * Every user-facing string for the global tag manager (backlog item 100
 * stage 4A), kept out of RouteLibrary.tsx so pluralisation and the
 * project's curly-quote house style are directly unit-testable — both are
 * exactly the kind of detail a DOM-level test tends to wave through.
 *
 * Every count in THIS module is the repository's own authoritative
 * `sourceRouteCount`, never a pre-submit UI count. That claim is about
 * these messages alone. The shared `formatRouteCount` it used to define
 * moved to routeCountCopy.ts when backlog item 111 needed the same
 * pluralisation for a derived UI count, and that formatter deliberately
 * carries no such claim of its own.
 *
 * Backlog item 113 stage 2. Three things changed, and none of them changes
 * a single English character:
 *
 * 1. Each message is now **one whole catalogue sentence** rather than
 *    fragments joined at the call site. The old code built a `scope`
 *    clause (`on 3 routes`) and injected it into five different
 *    sentences; that works only because English happens to put it last,
 *    and it is exactly the shape a translator cannot reorder.
 * 2. The curly quotes moved **into** the messages. They are punctuation,
 *    and punctuation is language-specific — German uses low-high quotes.
 *    The rider's own tag name is interpolated between them and is never
 *    altered, cased or re-quoted.
 * 3. Singular and plural are selected by `Intl.PluralRules` for the active
 *    locale instead of an `=== 1` test.
 *
 * The translator is passed in explicitly, so every function here stays
 * pure and callable from a fixture test with no React tree.
 */

import type { Translator } from "../../i18n/translate.ts";

export interface TagLifecycleConfirmation {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
}

/** A merge is confirmed explicitly, naming BOTH tags and the affected
 * route count, so a rename can never silently become a merge. */
export function describeMergeConfirmation(
  translator: Translator,
  sourceTag: string,
  targetTag: string,
  sourceRouteCount: number,
): TagLifecycleConfirmation {
  return {
    title: translator.t("tags.confirm.mergeTitle", {
      source: sourceTag,
      target: targetTag,
    }),
    message: translator.plural("tags.confirm.mergeMessage", sourceRouteCount, {
      source: sourceTag,
      target: targetTag,
    }),
    confirmLabel: translator.t("tags.manage.merge"),
  };
}

/** On a screen where "Delete" otherwise means deleting a route, the copy
 * has to say plainly that the routes themselves survive. */
export function describeDeleteConfirmation(
  translator: Translator,
  tag: string,
  sourceRouteCount: number,
): TagLifecycleConfirmation {
  return {
    title: translator.t("tags.confirm.deleteTitle", { tag }),
    message: translator.plural("tags.confirm.deleteMessage", sourceRouteCount, { tag }),
    confirmLabel: translator.t("tags.manage.delete"),
  };
}

/** The live scope line shown before submitting, so the rider always knows
 * how far a global change reaches — and, when the typed name collides
 * with an existing tag, that it is about to become a merge. */
export function describeTagLifecyclePreview(
  translator: Translator,
  input: {
    readonly sourceTag: string;
    readonly targetTag: string | null;
    readonly isMerge: boolean;
    readonly routeCount: number;
  },
): string {
  const { sourceTag, targetTag, isMerge, routeCount } = input;
  if (targetTag === null) {
    return translator.plural("tags.preview.rename", routeCount, { source: sourceTag });
  }
  if (isMerge) {
    return translator.plural("tags.preview.merge", routeCount, {
      source: sourceTag,
      target: targetTag,
    });
  }
  return translator.plural("tags.preview.renameTo", routeCount, {
    source: sourceTag,
    target: targetTag,
  });
}

export type TagLifecycleSummary =
  | { kind: "rename"; sourceTag: string; targetTag: string; merged: boolean }
  | { kind: "delete"; sourceTag: string };

export function describeTagLifecycleSuccess(
  translator: Translator,
  summary: TagLifecycleSummary,
  sourceRouteCount: number,
): string {
  if (sourceRouteCount === 0) {
    return translator.t("tags.success.unused", { source: summary.sourceTag });
  }
  if (summary.kind === "delete") {
    return translator.plural("tags.success.deleted", sourceRouteCount, {
      source: summary.sourceTag,
    });
  }
  if (summary.merged) {
    return translator.plural("tags.success.merged", sourceRouteCount, {
      source: summary.sourceTag,
      target: summary.targetTag,
    });
  }
  return translator.plural("tags.success.renamed", sourceRouteCount, {
    source: summary.sourceTag,
    target: summary.targetTag,
  });
}
