import type { ZoomInterpolatedLineWidth } from "./mapAdapter.ts";

/**
 * Zoom-responsive route-line width policy: the single source of the
 * `line-width` zoom stops shared by every route/warning/preview layer in
 * MapView.tsx, so Planning and Riding resolve identical widths for the
 * same zoom by construction. Pure, MapLibre-free — sibling to
 * distanceBadgeLayer.ts/routeLayer.ts/planningLayer.ts. Produces
 * ZoomInterpolatedLineWidth values that addLineLayer (mapAdapter.ts) turns
 * into a native MapLibre `interpolate` expression, evaluated by MapLibre
 * itself on every render frame — no React state or effect drives route
 * width at all.
 */

// Provisional starting points, NOT yet verified against a real iPhone
// viewport — mirrors distanceBadgeLayer.ts's own documented humility for
// first-pass zoom bands. ROUTE_WIDTH_CLOSE_ZOOM deliberately equals
// DISTANCE_BADGE_STREET_ZOOM_MIN, so "close navigation zoom" means the
// same thing across both features.
export const ROUTE_WIDTH_OVERVIEW_ZOOM = 6;
export const ROUTE_WIDTH_REGIONAL_ZOOM = 11;
export const ROUTE_WIDTH_CLOSE_ZOOM = 15;

// Three independently-tuned recession curves, each expressed as a fraction
// of a layer's own close-zoom (unchanged, existing) width:
//  - RECEDING: the always-on coloured overlays (macro climb/descent,
//    micro gradient) — recede fastest, so at low zoom they read as a
//    narrower stripe over the neutral casing beneath them, rather than
//    fully covering it the way they do today at every zoom (today both
//    are the same fixed width, so the coloured overlay always completely
//    hides the casing — this is the confirmed root cause of a
//    long-descent route reading as solid blue).
//  - LEGIBLE: the neutral base/casing and selection halos (the selected
//    route-feature halo) — recede more gently, so the underlying route
//    shape stays traceable at every zoom.
//  - WARNING (backlog item 39): surface/access/ferry warning casings and
//    the selected-warning halo. Warnings originally shared LEGIBLE with
//    the neutral base/selection halos, which meant an ordinary warning
//    barely receded at low zoom and visually dominated a full-route
//    overview — exactly the problem RECEDING already solved for
//    climb/descent colouring. WARNING recedes faster than LEGIBLE (fixing
//    that), while staying wider than RECEDING's own climb/descent overlay
//    centre and LEGIBLE's own neutral route base at every zoom, and wider
//    than the selected route-feature halo (legibleWidthStops(9)) so a
//    selected warning still visually outranks a selected climb/descent
//    wherever they overlap. See warningWidthStops's own doc comment and
//    routeWidthPolicy.test.ts for the exact preserved inequalities.
// Applying one shared multiplier per family (rather than a bespoke curve
// per layer) means every within-family width relationship established at
// close zoom — e.g. a selection halo wider than what it rings — is
// preserved proportionally at every zoom, with no extra bookkeeping.
// At ROUTE_WIDTH_CLOSE_ZOOM every curve resolves to exactly 1 (today's
// unchanged width) by construction, matching the settled contract's
// requirement to preserve the current close-zoom relationship exactly.
const RECEDING_MULTIPLIERS = { overview: 0.4, regional: 0.65 } as const;
const LEGIBLE_MULTIPLIERS = { overview: 0.6, regional: 0.8 } as const;
const WARNING_MULTIPLIERS = { overview: 0.45, regional: 0.6 } as const;

function buildStops(
  closeWidthPx: number,
  multipliers: { overview: number; regional: number },
): ZoomInterpolatedLineWidth {
  return {
    stops: [
      { zoom: ROUTE_WIDTH_OVERVIEW_ZOOM, width: closeWidthPx * multipliers.overview },
      { zoom: ROUTE_WIDTH_REGIONAL_ZOOM, width: closeWidthPx * multipliers.regional },
      { zoom: ROUTE_WIDTH_CLOSE_ZOOM, width: closeWidthPx },
    ],
  };
}

/** Width policy for the always-on coloured climb/descent/gradient
 * overlays (ROUTE_FEATURE_LAYER_WIDTH, GRADIENT_LINE_WIDTH in
 * MapView.tsx) — recedes faster than legibleWidthStops so the overlay
 * reads as a narrower stripe over the neutral casing at low zoom, instead
 * of fully covering it. */
export function recedingWidthStops(closeWidthPx: number): ZoomInterpolatedLineWidth {
  return buildStops(closeWidthPx, RECEDING_MULTIPLIERS);
}

/** Width policy for the neutral route casing (remaining/completed line)
 * and selection halos (the selected route-feature halo) — recedes more
 * gently than recedingWidthStops, so the route stays traceable at every
 * zoom. */
export function legibleWidthStops(closeWidthPx: number): ZoomInterpolatedLineWidth {
  return buildStops(closeWidthPx, LEGIBLE_MULTIPLIERS);
}

/** Width policy for surface/access/ferry warning casings
 * (WARNING_CATEGORY_PAINT) and the selected-warning halo
 * (WARNING_SELECTED_PAINT) in MapView.tsx — backlog item 39. Recedes
 * faster than legibleWidthStops, so an ordinary warning no longer
 * visually dominates a full-route overview merely by sharing the neutral
 * casing's gentle curve, while staying strictly wider than
 * recedingWidthStops(5) (the climb/descent macro/micro overlay centre)
 * and legibleWidthStops(5) (the neutral route base) at every zoom, and
 * wider than legibleWidthStops(9) (the selected route-feature halo) so a
 * selected warning still visually outranks a selected climb/descent
 * wherever they overlap. See routeWidthPolicy.test.ts for the exact
 * preserved inequalities. */
export function warningWidthStops(closeWidthPx: number): ZoomInterpolatedLineWidth {
  return buildStops(closeWidthPx, WARNING_MULTIPLIERS);
}
