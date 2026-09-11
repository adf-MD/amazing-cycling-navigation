/**
 * The north-up control's artwork, as data rather than as a string buried
 * in JSX (backlog item 110 presentation follow-up).
 *
 * It lives in its own module for two reasons: the containment proof in
 * northArrowGeometry.test.ts needs the very same numbers the component
 * draws, and a non-component export from the `.tsx` would trip
 * `react-refresh/only-export-components`.
 */

/** Every coordinate below is in this square user-space box. */
export const VIEWBOX_UNITS = 24;

/** The point both rotations turn about: the dart's CSS `rotate(-bearing)`
 * and the letter's compensating `rotate(+bearing)`. They cancel exactly
 * only because they share this centre. */
export const ROTATION_CENTRE: readonly [number, number] = [12, 12];

/**
 * The shipped item 110 dart, unchanged. Preserved byte-for-byte: the
 * follow-up enlarges the rendered box and adds a letter, and is expressly
 * not permitted to alter this silhouette.
 */
export const DART_PATH = "M12 3 L19 20.5 L12 16 L5 20.5 Z";

/** The same shape as vertices, for the geometric containment proof. */
export const DART_VERTICES: readonly (readonly [number, number])[] = [
  [12, 3],
  [19, 20.5],
  [12, 16],
  [5, 20.5],
];

/**
 * The upright `N`, drawn rather than set as text.
 *
 * Drawn, because a text glyph's size and weight come from whichever font
 * in the system stack happens to be resolved — SF Pro on an installed
 * iPhone, something else entirely in CI — and this letter has under a
 * pixel of clearance to give away. As a path it is identical everywhere.
 *
 * Two vertical stems joined by a diagonal, inked to the full bounds
 * below: all four corners of that box carry ink (the stem tops and
 * bottoms), which is why the containment proof can test the corners.
 */
export const NORTH_LETTER_PATH =
  "M10.11 14.15 V9.85 H11.06 L12.94 12.95 V9.85 H13.89 V14.15 H12.94 L11.06 11.05 V14.15 Z";

/** The letter's ink bounds, centred on ROTATION_CENTRE. */
export const NORTH_LETTER_BOUNDS = {
  minX: 10.11,
  maxX: 13.89,
  minY: 9.85,
  maxY: 14.15,
} as const;

/** The four ink-bearing corners the containment proof sweeps. */
export const NORTH_LETTER_CORNERS: readonly (readonly [number, number])[] = [
  [NORTH_LETTER_BOUNDS.minX, NORTH_LETTER_BOUNDS.minY],
  [NORTH_LETTER_BOUNDS.maxX, NORTH_LETTER_BOUNDS.minY],
  [NORTH_LETTER_BOUNDS.maxX, NORTH_LETTER_BOUNDS.maxY],
  [NORTH_LETTER_BOUNDS.minX, NORTH_LETTER_BOUNDS.maxY],
];

/**
 * The rendered size of the whole icon box. 38px, not the 22px item 110
 * shipped and not the 26px first proposed: the letter stays upright while
 * the dart turns under it, so it is invariant under that rotation and
 * must fit the largest disc centred on ROTATION_CENTRE that lies inside
 * the dart — radius 3.3425 units, set by the two slanted edges. At 26px
 * that disc leaves the letter -1.23px of clearance and at 32px -0.39px,
 * i.e. it would clip the dart at some bearings. 38px yields +0.76px at
 * every bearing, which northArrowGeometry.test.ts sweeps degree by
 * degree. The hosting button stays 48px throughout.
 */
export const NORTH_ARROW_SIZE_PX = 38;

/** Rotates a point clockwise by `degrees` about ROTATION_CENTRE, matching
 * SVG's own `rotate(a cx cy)` convention (positive is clockwise, because
 * the y axis points down). */
export function rotateAboutCentre(
  point: readonly [number, number],
  degrees: number,
): readonly [number, number] {
  const radians = (degrees * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const [cx, cy] = ROTATION_CENTRE;
  const dx = point[0] - cx;
  const dy = point[1] - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** Shortest distance from `point` to the segment `a`-`b`. */
function distanceToSegment(
  point: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared === 0) {
    return Math.hypot(point[0] - a[0], point[1] - a[1]);
  }
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / lengthSquared),
  );
  return Math.hypot(point[0] - (a[0] + t * vx), point[1] - (a[1] + t * vy));
}

/** The dart's outline as explicit segment pairs — built once, so no
 * geometry below has to index into an array (this project compiles with
 * `noUncheckedIndexedAccess`, and a silently-undefined vertex in a
 * containment proof would be worse than a compile error). */
const DART_EDGES: readonly (readonly [
  readonly [number, number],
  readonly [number, number],
])[] = DART_VERTICES.map((vertex, index) => [
  vertex,
  DART_VERTICES[(index + 1) % DART_VERTICES.length] ?? vertex,
]);

/**
 * True when `point` lies inside the dart. The dart is concave (the notch),
 * so this uses the standard even-odd ray cast rather than a convex test.
 */
export function isInsideDart(point: readonly [number, number]): boolean {
  const [x, y] = point;
  let inside = false;
  for (const [a, b] of DART_EDGES) {
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Distance from `point` to the dart's outline, signed positive when the
 * point is inside. This is the clearance the follow-up's contract is
 * stated in, expressed in user units — multiply by `sizePx / VIEWBOX_UNITS`
 * for pixels.
 */
export function clearanceInsideDart(point: readonly [number, number]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const [a, b] of DART_EDGES) {
    nearest = Math.min(nearest, distanceToSegment(point, a, b));
  }
  return isInsideDart(point) ? nearest : -nearest;
}

/**
 * The worst clearance the upright letter has against the dart at `bearingDegrees`.
 *
 * The letter is fixed on screen while the dart turns beneath it, so in the
 * dart's own coordinates the letter appears rotated by `+bearingDegrees`.
 * Rotating the letter's corners and measuring them against the stationary
 * dart is therefore exactly equivalent to, and far cheaper than,
 * rotating the dart.
 */
export function letterClearanceAtBearing(bearingDegrees: number): number {
  let worst = Number.POSITIVE_INFINITY;
  for (const corner of NORTH_LETTER_CORNERS) {
    worst = Math.min(
      worst,
      clearanceInsideDart(rotateAboutCentre(corner, bearingDegrees)),
    );
  }
  return worst;
}
