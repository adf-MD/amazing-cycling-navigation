/**
 * Suggests a Planning draft name for a route or draft being reversed (see
 * "Reverse route" in PlanningScreen.tsx's waypointHistoryReducer, backlog
 * item 38). Preserves the complete source name unmutated — no trimming,
 * no language-aware suffix detection or removal — and appends " (reversed)"
 * verbatim, unconditionally, even for a blank/whitespace-only input. The
 * result is freely editable afterwards in Planning's own route-name field,
 * which already trims on Save/Export (PlanningScreen.tsx's
 * handleSave/handleExport), so this helper needs no whitespace handling of
 * its own. Deliberately does not dedupe against any existing Route Library
 * name: duplicate route names are an already-accepted, pre-existing
 * condition governed by the Route Library itself. Reversing an
 * already-reversed route's suggested name (producing
 * "X (reversed) (reversed)") is expected, not a bug this helper tries to
 * prevent — the rider can always edit the field.
 *
 * The "an unnamed/blank draft's name stays blank" rule is intentionally
 * NOT implemented here — it's a Planning-specific business rule about what
 * "unnamed" means, not a generic string-suffixing concern, so it lives at
 * this function's sole caller, waypointHistoryReducer's "reverse" case,
 * which checks for a blank name before ever calling this function.
 */
export function suggestReversedRouteName(sourceName: string): string {
  return `${sourceName} (reversed)`;
}
