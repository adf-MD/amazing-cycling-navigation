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
 */

import { formatRouteCount } from "./routeCountCopy.ts";

function quote(tag: string): string {
  return `“${tag}”`;
}

export interface TagLifecycleConfirmation {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
}

/** A merge is confirmed explicitly, naming BOTH tags and the affected
 * route count, so a rename can never silently become a merge. */
export function describeMergeConfirmation(
  sourceTag: string,
  targetTag: string,
  sourceRouteCount: number,
): TagLifecycleConfirmation {
  return {
    title: `Merge ${quote(sourceTag)} into ${quote(targetTag)}?`,
    message:
      `${quote(targetTag)} already exists, so this merges the two tags on ` +
      `${formatRouteCount(sourceRouteCount)}. ${quote(sourceTag)} will no longer ` +
      `exist. No route is deleted.`,
    confirmLabel: "Merge tags",
  };
}

/** On a screen where "Delete" otherwise means deleting a route, the copy
 * has to say plainly that the routes themselves survive. */
export function describeDeleteConfirmation(
  tag: string,
  sourceRouteCount: number,
): TagLifecycleConfirmation {
  return {
    title: `Delete the tag ${quote(tag)}?`,
    message:
      `${quote(tag)} will be removed from ${formatRouteCount(sourceRouteCount)}. ` +
      `The routes themselves are not deleted and stay in your library.`,
    confirmLabel: "Delete tag",
  };
}

/** The live scope line shown before submitting, so the rider always knows
 * how far a global change reaches — and, when the typed name collides
 * with an existing tag, that it is about to become a merge. */
export function describeTagLifecyclePreview(input: {
  readonly sourceTag: string;
  readonly targetTag: string | null;
  readonly isMerge: boolean;
  readonly routeCount: number;
}): string {
  const { sourceTag, targetTag, isMerge, routeCount } = input;
  const scope = `on ${formatRouteCount(routeCount)}`;
  if (targetTag === null) {
    return `Rename ${quote(sourceTag)} ${scope}.`;
  }
  if (isMerge) {
    return `Merge ${quote(sourceTag)} into ${quote(targetTag)} ${scope}.`;
  }
  return `Rename ${quote(sourceTag)} to ${quote(targetTag)} ${scope}.`;
}

export type TagLifecycleSummary =
  | { kind: "rename"; sourceTag: string; targetTag: string; merged: boolean }
  | { kind: "delete"; sourceTag: string };

export function describeTagLifecycleSuccess(
  summary: TagLifecycleSummary,
  sourceRouteCount: number,
): string {
  if (sourceRouteCount === 0) {
    return `${quote(summary.sourceTag)} is no longer used by any route, so nothing changed.`;
  }
  const scope = `on ${formatRouteCount(sourceRouteCount)}`;
  if (summary.kind === "delete") {
    return (
      `Deleted ${quote(summary.sourceTag)} from ${formatRouteCount(sourceRouteCount)}. ` +
      `Those routes are still saved.`
    );
  }
  if (summary.merged) {
    return `Merged ${quote(summary.sourceTag)} into ${quote(summary.targetTag)} ${scope}.`;
  }
  return `Renamed ${quote(summary.sourceTag)} to ${quote(summary.targetTag)} ${scope}.`;
}
