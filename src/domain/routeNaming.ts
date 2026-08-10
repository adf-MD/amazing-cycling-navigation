/**
 * Suggests a Planning draft name for a route about to be reversed (see
 * "Reverse route" in RidingScreen.tsx). Preserves the complete source name
 * unmutated — no trimming, no language-aware suffix detection or removal —
 * and appends " (reversed)" verbatim. The result is freely editable
 * afterwards in Planning's own route-name field, which already trims on
 * Save/Export (PlanningScreen.tsx's handleSave/handleExport), so this
 * helper needs no whitespace handling of its own. Deliberately does not
 * dedupe against any existing Route Library name: duplicate route names
 * are an already-accepted, pre-existing condition governed by the Route
 * Library itself. Reversing an already-reversed route's suggested name
 * (producing "X (reversed) (reversed)") is expected, not a bug this
 * helper tries to prevent — the rider can always edit the field.
 */
export function suggestReversedRouteName(sourceName: string): string {
  return `${sourceName} (reversed)`;
}
