import { useTranslate } from "../../i18n/useTranslate.ts";
import type { ClimbFeature } from "../../navigation/routeFeatures.ts";
import { CLIMB_CATEGORY_NAME_KEYS } from "../../navigation/routeFeaturePalette.ts";
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
 *
 * Rendered by RidingScreen.tsx as an embedded subsection directly inside
 * the Route profile card's elevation section — immediately after the main
 * elevation chart and its gradient-colours disclosure, immediately before
 * RouteFeatureDetailsPanel — so it deliberately carries no `.panel` box of
 * its own (plain `.stack` spacing only), matching that section's other,
 * already-unboxed subsections.
 */
export function RidingClimbSelector({
  climbs,
  selectedClimbId,
  onSelectClimb,
}: RidingClimbSelectorProps) {
  const translator = useTranslate();
  const { t } = translator;
  if (climbs.length === 0) {
    return (
      <section aria-label={t("climb.selectorLabel")} className="stack">
        <h2>{t("climb.selectorLabel")}</h2>
        <p>{t("climb.empty")}</p>
      </section>
    );
  }

  return (
    <section aria-label={t("climb.selectorLabel")} className="stack">
      <h2 id="recognised-climbs-heading">{t("climb.selectorLabel")}</h2>
      <select
        className="recognised-climb-select"
        aria-labelledby="recognised-climbs-heading"
        value={selectedClimbId ?? ALL_ROUTE_VALUE}
        onChange={(event) => {
          const value = event.target.value;
          onSelectClimb(value === ALL_ROUTE_VALUE ? null : value);
        }}
      >
        <option value={ALL_ROUTE_VALUE}>{t("climb.allRoute")}</option>
        {climbs.map((climb, index) => (
          <option key={climb.id} value={climb.id}>
            {t("climb.option", {
              number: index + 1,
              category: t(CLIMB_CATEGORY_NAME_KEYS[climb.category]),
              start: formatDistanceKmValue(translator, climb.startDistanceMetres),
            })}
          </option>
        ))}
      </select>
      {selectedClimbId === null ? (
        <p>{translator.plural("climb.count", climbs.length)}</p>
      ) : null}
    </section>
  );
}
