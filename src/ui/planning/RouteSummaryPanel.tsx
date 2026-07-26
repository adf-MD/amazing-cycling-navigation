import type { PlannedRoute, RouteWarning } from "../../domain/types.ts";
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
}: RouteSummaryPanelProps) {
  const surface = route.surfaceSummary;

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
