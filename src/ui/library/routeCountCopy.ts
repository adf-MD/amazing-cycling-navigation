/**
 * Route-count pluralisation for the Route Library, kept in its own leaf
 * module so more than one consumer can share exactly one rule.
 *
 * It began life inside tagLifecycleMessages.ts, whose own header makes an
 * authoritative-source claim about every count in it ("the repository's
 * own authoritative `sourceRouteCount`, never a pre-submit UI count").
 * Backlog item 111's prospective tag-filter counts are precisely a
 * derived UI count, so importing the formatter out of that module would
 * have left that claim reading as though it covered them too. Extracting
 * it keeps one pluralisation rule without extending a safety statement
 * over a count it was never written about.
 */

/** "1 route" / "3 routes". */
export function formatRouteCount(count: number): string {
  return count === 1 ? "1 route" : `${String(count)} routes`;
}
