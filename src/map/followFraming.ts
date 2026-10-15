/* Item 145: where the follow camera puts the rider when part of the map is
 * hidden or covered. Pure geometry, so it is testable without layout:
 * measuring the part of the canvas host its clipping ancestors leave
 * visible, and choosing the rider's anchor inside that region, clear of the
 * map's own overlays. followFramingController.ts decides when to apply it. */

/** A box in CSS px, relative to the canvas host's top-left corner. */
export interface HostRelativeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The visible part of the canvas host, host-relative, with the host's own
 * size and how much of it is hidden below. */
export interface VisibleRegion extends HostRelativeRect {
  hostWidth: number;
  hostHeight: number;
  clippedBottom: number;
}

/** The rider's disc for framing: its largest measured painted extent at a
 * follow position (12.0 px in Chromium, 12.25 px in WebKit, outline and
 * antialiasing included), plus a margin. */
export const FOLLOW_FRAMING_DISC_RADIUS_PX = 13;

/** Added only when the anchor has to move, never to a position that is
 * already whole and clear. */
export const FOLLOW_FRAMING_CLEARANCE_PX = 4;

/* Only overflow that hides content for good counts as clipping. A scroll
 * container, or the page itself, can bring a hidden part back into view:
 * Planning's map runs below the viewport while its page scrolls, and
 * counting that as clipping lifted its attribution onto the placement
 * control (item 145's prototype, corrected). */
function hidesOverflow(value: string): boolean {
  return value === "hidden" || value === "clip";
}

/** Every ancestor of `host` whose overflow clips it, nearest first. */
export function clippingAncestors(host: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (
    let node = host.parentElement;
    node && node !== document.documentElement;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (hidesOverflow(style.overflowX) || hidesOverflow(style.overflowY)) {
      result.push(node);
    }
  }
  return result;
}

/** The part of `host` its clipping ancestors leave visible (each
 * ancestor's padding box, per clipped axis). Null when the host has no size
 * (not laid out, or hidden), which means there is nothing to frame. */
export function measureVisibleRegion(
  host: HTMLElement,
  ancestors: readonly HTMLElement[] = clippingAncestors(host),
): VisibleRegion | null {
  const hostRect = host.getBoundingClientRect();
  if (hostRect.width <= 0 || hostRect.height <= 0) return null;
  let { left, top, right, bottom } = hostRect;
  for (const ancestor of ancestors) {
    const style = getComputedStyle(ancestor);
    const rect = ancestor.getBoundingClientRect();
    const paddingLeft = rect.left + ancestor.clientLeft;
    const paddingTop = rect.top + ancestor.clientTop;
    if (hidesOverflow(style.overflowX)) {
      left = Math.max(left, paddingLeft);
      right = Math.min(right, paddingLeft + ancestor.clientWidth);
    }
    if (hidesOverflow(style.overflowY)) {
      top = Math.max(top, paddingTop);
      bottom = Math.min(bottom, paddingTop + ancestor.clientHeight);
    }
  }
  bottom = Math.max(bottom, top);
  right = Math.max(right, left);
  return {
    left: left - hostRect.left,
    top: top - hostRect.top,
    right: right - hostRect.left,
    bottom: bottom - hostRect.top,
    hostWidth: hostRect.width,
    hostHeight: hostRect.height,
    clippedBottom: hostRect.bottom - bottom,
  };
}

export function hostRelativeRect(host: HTMLElement, element: Element): HostRelativeRect {
  const hostRect = host.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - hostRect.left,
    top: rect.top - hostRect.top,
    right: rect.right - hostRect.left,
    bottom: rect.bottom - hostRect.top,
  };
}

/** Whether a disc of `radius` around `point` lies wholly inside the region
 * and clear of every obstacle (touching counts as clear). */
export function isDiscWholeAndClear(
  region: VisibleRegion,
  obstacles: readonly HostRelativeRect[],
  point: { x: number; y: number },
  radius = FOLLOW_FRAMING_DISC_RADIUS_PX,
): boolean {
  const { x, y } = point;
  if (
    x - radius < region.left ||
    x + radius > region.right ||
    y - radius < region.top ||
    y + radius > region.bottom
  ) {
    return false;
  }
  return obstacles.every(
    (o) =>
      o.right <= x - radius ||
      o.left >= x + radius ||
      o.bottom <= y - radius ||
      o.top >= y + radius,
  );
}

export type FollowAnchorDecision =
  /** The ordinary anchor (the visible centre plus the ordinary offset) is
   * whole and clear, and is kept with no clearance requirement. */
  | { kind: "kept"; offsetPx: number }
  /** The nearest position whose disc plus the clearance lies inside the
   * visible region and clear of every obstacle across its full width. */
  | { kind: "moved"; offsetPx: number }
  /** No such position exists: the caller keeps its current framing rather
   * than moving the rider into an obstruction. */
  | { kind: "conflict" };

/** The follow anchor inside the visible region, as an offset from the
 * canvas host's centre, which is what the follow ease takes. The rider's
 * x is the host's centre: the follow offset is vertical only. */
export function decideFollowAnchor(
  region: VisibleRegion,
  obstacles: readonly HostRelativeRect[],
  ordinaryOffsetPx: number,
  radius = FOLLOW_FRAMING_DISC_RADIUS_PX,
  clearance = FOLLOW_FRAMING_CLEARANCE_PX,
): FollowAnchorDecision {
  const centreY = region.hostHeight / 2;
  const x = region.hostWidth / 2;
  const desiredY = (region.top + region.bottom) / 2 + ordinaryOffsetPx;
  if (isDiscWholeAndClear(region, obstacles, { x, y: desiredY }, radius)) {
    return { kind: "kept", offsetPx: desiredY - centreY };
  }
  const half = radius + clearance;
  const lowest = region.top + half;
  const highest = region.bottom - half;
  if (highest < lowest) return { kind: "conflict" };
  const forbidden = obstacles
    .filter((o) => o.right > x - half && o.left < x + half && o.bottom > o.top)
    .map((o) => [o.top - half, o.bottom + half] as const)
    .sort((a, b) => a[0] - b[0]);
  // The feasible centres: [lowest, highest] less the forbidden open
  // intervals.
  const feasible: (readonly [number, number])[] = [];
  let start = lowest;
  for (const [from, to] of forbidden) {
    if (to <= start) continue;
    if (from >= highest) break;
    if (from > start) feasible.push([start, Math.min(from, highest)]);
    start = Math.max(start, to);
    if (start > highest) break;
  }
  if (start <= highest) feasible.push([start, highest]);
  let best: number | null = null;
  for (const [from, to] of feasible) {
    const y = Math.min(Math.max(desiredY, from), to);
    if (best === null || Math.abs(y - desiredY) < Math.abs(best - desiredY)) best = y;
  }
  if (best === null) return { kind: "conflict" };
  return { kind: "moved", offsetPx: best - centreY };
}
