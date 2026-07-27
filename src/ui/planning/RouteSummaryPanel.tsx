import { useEffect, useRef, useState } from "react";
import type { PlannedRoute, RouteWarning } from "../../domain/types.ts";
import { prefersReducedMotion } from "../../platform/environmentContext.ts";
import { formatAscent, formatDistanceKm } from "../shared/routeSummary.ts";

export interface RouteSummaryPanelProps {
  route: PlannedRoute;
  waypointCount: number;
  /** Already coalesced by the caller (see PlanningScreen), and the same
   * array MapView's warningOverlay is fed — so a list index here always
   * matches the highlighted map segment. */
  warnings: readonly RouteWarning[];
  selectedWarningIndex: number | null;
  onSelectWarning: (index: number) => void;
  onClearWarningSelection: () => void;
  /** Increments once per map-originated warning selection (including a
   * repeat tap on an already-selected warning) — the one-shot signal to
   * scroll the matching entry into view and announce it. Never itself a
   * selection source; PlanningScreen derives it alongside
   * selectedWarningIndex. A list-originated selection does not bump
   * this, since the entry is already where the user is interacting. */
  revealToken: number;
}

function formatMetres(metres: number): string {
  return `${String(Math.round(metres))} m`;
}

/**
 * Distance, ascent/descent, provider provenance, surface breakdown and
 * inspectable warnings for a calculated route — shown before save/export,
 * per CLAUDE.md. Never claims more precision than the response actually
 * carried: unknown-surface distance is shown as its own figure, not folded
 * into "paved".
 */
export function RouteSummaryPanel({
  route,
  waypointCount,
  warnings,
  selectedWarningIndex,
  onSelectWarning,
  onClearWarningSelection,
  revealToken,
}: RouteSummaryPanelProps) {
  const surface = route.surfaceSummary;
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastRevealTokenRef = useRef(revealToken);
  // The index a map-originated tap most recently revealed, or null. Only
  // ever set inside the effect below, and only ever rendered when it
  // still matches the current selectedWarningIndex — so a stale reveal
  // (e.g. the rider later re-selects the same warning from the list)
  // never resurrects the announcement/scroll for a non-map action.
  const [justRevealedIndex, setJustRevealedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (revealToken !== lastRevealTokenRef.current) {
      // A genuine fresh map-originated selection (including a repeat tap
      // on an already-selected warning, which still bumps revealToken) —
      // scroll it into view and mark it as just revealed.
      lastRevealTokenRef.current = revealToken;
      selectedButtonRef.current?.scrollIntoView({
        block: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
      setJustRevealedIndex(selectedWarningIndex);
    } else {
      // selectedWarningIndex changed via some other path (a list click or
      // an explicit clear) — no scroll, and any previous reveal is now
      // stale.
      setJustRevealedIndex(null);
    }
  }, [revealToken, selectedWarningIndex]);

  const justRevealedWarning =
    justRevealedIndex !== null && justRevealedIndex === selectedWarningIndex
      ? warnings[justRevealedIndex]
      : undefined;

  return (
    <section aria-label="Route summary">
      <p>
        {formatDistanceKm(route.distanceMetres)} · {formatAscent(route.ascentMetres)}
        {route.descentMetres !== null
          ? ` · ${String(Math.round(route.descentMetres))} m descent`
          : ""}
      </p>
      <p>
        {waypointCount} waypoint{waypointCount === 1 ? "" : "s"}
      </p>
      {route.source.kind === "planner" ? (
        <p>
          Routed via {route.source.provider ?? "unknown provider"}
          {route.source.profile ? ` (${route.source.profile})` : ""}
        </p>
      ) : null}
      {surface ? (
        <>
          <ul aria-label="Surface breakdown">
            <li>Paved: {formatMetres(surface.pavedMetres)}</li>
            <li>Questionable: {formatMetres(surface.questionableMetres)}</li>
            <li>Unsuitable: {formatMetres(surface.unsuitableMetres)}</li>
            <li>Unknown: {formatMetres(surface.unknownMetres)}</li>
          </ul>
          <p>
            Based on available data only — not a guarantee of road quality, legal access
            or current conditions.
          </p>
        </>
      ) : null}
      {warnings.length > 0 ? (
        <>
          <ul aria-label="Route warnings">
            {warnings.map((warning, index) => {
              const isSelected = index === selectedWarningIndex;
              return (
                // Warnings have no stable id of their own; the array is
                // rebuilt wholesale on every calculation, so index is safe.
                <li key={index}>
                  <button
                    ref={isSelected ? selectedButtonRef : undefined}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (isSelected) {
                        onClearWarningSelection();
                      } else {
                        onSelectWarning(index);
                      }
                    }}
                  >
                    {warning.message} —{" "}
                    {formatMetres(
                      warning.endDistanceMetres - warning.startDistanceMetres,
                    )}
                    {" ("}
                    {formatDistanceKm(warning.startDistanceMetres)}–
                    {formatDistanceKm(warning.endDistanceMetres)}
                    {")"}
                  </button>
                </li>
              );
            })}
          </ul>
          {justRevealedWarning ? (
            <p role="status">
              Selected warning: {justRevealedWarning.message} (
              {formatDistanceKm(justRevealedWarning.startDistanceMetres)}–
              {formatDistanceKm(justRevealedWarning.endDistanceMetres)}).
            </p>
          ) : null}
          {selectedWarningIndex !== null ? (
            <button type="button" onClick={onClearWarningSelection}>
              Clear warning selection
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
