import type { PlannedRoute } from "../../domain/types.ts";
import { formatAscent, formatDistanceKm } from "../shared/routeSummary.ts";

export interface RouteSummaryPanelProps {
  route: PlannedRoute;
  waypointCount: number;
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
export function RouteSummaryPanel({ route, waypointCount }: RouteSummaryPanelProps) {
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
        <ul aria-label="Surface breakdown">
          <li>Paved: {formatMetres(surface.pavedMetres)}</li>
          <li>Questionable: {formatMetres(surface.questionableMetres)}</li>
          <li>Unsuitable: {formatMetres(surface.unsuitableMetres)}</li>
          <li>Unknown: {formatMetres(surface.unknownMetres)}</li>
        </ul>
      ) : null}
      {route.warnings.length > 0 ? (
        <ul aria-label="Route warnings">
          {route.warnings.map((warning, index) => (
            // Warnings have no stable id of their own; the array is
            // rebuilt wholesale on every calculation, so index is safe.
            <li key={index}>{warning.message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
