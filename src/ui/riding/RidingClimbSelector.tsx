import type { ClimbFeature } from "../../navigation/routeFeatures.ts";
import { CLIMB_CATEGORY_NAMES } from "../../navigation/routeFeaturePalette.ts";
import { formatDistanceKmValue } from "../shared/routeSummary.ts";

export interface RidingClimbSelectorProps {
  /** Recognised climbs on the route, in route order (see
   * listClimbsInRouteOrder) — never re-sorted here. */
  climbs: readonly ClimbFeature[];
  /** The currently selected climb's id, or null for "All route". */
  selectedClimbId: string | null;
  /** Called with a climb id, or null when "All route" is chosen. */
  onSelectClimb: (climbId: string | null) => void;
}

const ALL_ROUTE_VALUE = "all";

/**
 * Pre-ride-only "Recognised climbs" section: a native, keyboard- and
 * touch-friendly `<select>` listing every recognised climb in route
 * order, numbered from 1, plus an "All route" option that clears the
 * selection. Deliberately renders no details card of its own — the
 * caller's existing RouteFeatureDetailsPanel (already driven by the same
 * selection state, shared with map/chart-tap selection) is reused for
 * that, so there is only ever one climb-information card on screen by
 * construction, never two competing panels to keep in sync.
 */
export function RidingClimbSelector({
  climbs,
  selectedClimbId,
  onSelectClimb,
}: RidingClimbSelectorProps) {
  if (climbs.length === 0) {
    return (
      <section aria-label="Recognised climbs" className="panel stack">
        <h2>Recognised climbs</h2>
        <p>
          No recognised climbs. A recognised climb must be at least 500 m long and average
          at least 3%.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Recognised climbs" className="panel stack">
      <h2 id="recognised-climbs-heading">Recognised climbs</h2>
      <select
        className="recognised-climb-select"
        aria-labelledby="recognised-climbs-heading"
        value={selectedClimbId ?? ALL_ROUTE_VALUE}
        onChange={(event) => {
          const value = event.target.value;
          onSelectClimb(value === ALL_ROUTE_VALUE ? null : value);
        }}
      >
        <option value={ALL_ROUTE_VALUE}>All route</option>
        {climbs.map((climb, index) => (
          <option key={climb.id} value={climb.id}>
            {`Climb ${String(index + 1)} · ${CLIMB_CATEGORY_NAMES[climb.category]} · starts at ${formatDistanceKmValue(climb.startDistanceMetres)} km`}
          </option>
        ))}
      </select>
      {selectedClimbId === null ? (
        <p>
          {`${String(climbs.length)} recognised climb${climbs.length === 1 ? "" : "s"} on this route`}
        </p>
      ) : null}
    </section>
  );
}
