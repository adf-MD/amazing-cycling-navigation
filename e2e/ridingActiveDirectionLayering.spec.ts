import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow } from "./support/rideStateDb.ts";

// Backlog item 98: on a route whose outbound and return legs are exactly
// coincident, the completed/remaining base layers alone cannot express the
// rider's current direction. acn-route-completed-line is added AFTER
// acn-route-remaining-line (MapView.tsx), and this codebase uses no
// beforeId anywhere, so at an exact geographic overlap the grey completed
// OUTBOUND trace paints over the green remaining RETURN trace immediately
// ahead of the rider. Physically confirmed on the installed iPhone PWA at
// 0.4.9.
//
// This spec proves it in a real browser, by sampling the WebGL canvas's own
// pixels — the repository's existing colour proofs (gradientColouring.spec.ts)
// only ever check presence/absence and relative x of colours on
// non-overlapping stretches, never which of two coincident layers actually
// won.

test.use({ serviceWorkers: "block" });

const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
// Metres per degree of longitude at latitude 51.5 — the same conversion
// factor ridingOutAndBackTurnaround.spec.ts's fixture uses.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;

const OUTBOUND_LENGTH_METRES = 1500;
const TOTAL_ROUTE_LENGTH_METRES = OUTBOUND_LENGTH_METRES * 2;
const SEGMENT_METRES = 50;

/** Where the rider is parked for the decisive screenshot: 900 m onto the
 * return leg, i.e. physical x = 600 m. Chosen so no kilometre distance
 * badge sits on top of the position marker (the 2 km badge is behind the
 * rider and therefore hidden by badgeDensityMode "active-upcoming"; the
 * 3 km badge is 600 m ahead, far outside the sampled band) — a badge is a
 * DOM element composited into the element screenshot and would otherwise
 * obscure the anchor. */
const SAMPLE_PROGRESS_METRES = 2400;

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

/** Physical position along the road for a cumulative route distance. */
function physicalMetres(routeDistanceMetres: number): number {
  return routeDistanceMetres <= OUTBOUND_LENGTH_METRES
    ? routeDistanceMetres
    : TOTAL_ROUTE_LENGTH_METRES - routeDistanceMetres;
}

/** An exact out-and-back GPX track, flat throughout, whose return leg
 * retraces the identical coordinates in reverse — a genuine
 * coordinate-for-coordinate coincidence. Synthetic, generic coordinates:
 * nothing here derives from any real recorded ride. */
function buildFlatCoincidentOutAndBackGpx(): string {
  const outboundDistances = Array.from(
    { length: OUTBOUND_LENGTH_METRES / SEGMENT_METRES + 1 },
    (_, index) => SEGMENT_METRES * index,
  );
  const returnDistances = outboundDistances
    .slice(0, -1)
    .toReversed()
    .map((outbound) => TOTAL_ROUTE_LENGTH_METRES - outbound);

  const points = [...outboundDistances, ...returnDistances]
    .map(
      (routeDistanceMetres) =>
        `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(physicalMetres(routeDistanceMetres)))}"><ele>10.0</ele></trkpt>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Active direction layering test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

/** The live position marker's own fill (MapView.tsx's acn-position-marker
 * circle layer). Used purely as an ANCHOR: it is the one unambiguous
 * on-canvas mark of where the rider actually is, so every colour claim
 * below is made relative to it rather than to hard-coded screen
 * coordinates. */
const POSITION_MARKER_COLOUR: readonly [number, number, number] = [0x1a, 0x73, 0xe8];

/** Half-width of the sampled band around the route line, and the y offsets
 * that define "just ahead of" and "just behind" the rider. Riding's follow
 * camera is direction-up (bearing from route tangent) and pitched
 * (FOLLOW_PITCH_DEGREES), so the route renders as a vertical line through
 * the marker with "ahead" above it. The offsets stay well inside
 * ACTIVE_DIRECTION_AHEAD_METRES at the pitched scale, and clear of the
 * marker's own disc. Sampling a band rather than the whole canvas is what
 * keeps DOM chrome composited into the element screenshot (buttons, status
 * card) out of the counts entirely. */
const BAND_HALF_WIDTH_PX = 15;
const NEAR_OFFSET_PX = 12;
const FAR_OFFSET_PX = 60;

/** A second, farther band used only by the classified scenario. With the
 * rider 200 m below the summit and a 300 m window, the window necessarily
 * crosses the turnaround, so its far portion (the return descent) lands on
 * exactly the same road as its near portion (the climb still being
 * ridden). Measured on this fixture, that self-overlap renders roughly
 * 90-160 px above the rider — the near band above is entirely below it, so
 * the overlap priority rule can only be observed here. */
const OVERLAP_NEAR_OFFSET_PX = 90;
const OVERLAP_FAR_OFFSET_PX = 160;

/** How many pixels of a colour that should be absent are still tolerated.
 * The overlay and the base route line resolve to the same width at
 * NAVIGATION_ZOOM, so the overlay covers the line exactly — but a single
 * antialiased pixel can still fall inside the tight matching radius at a
 * band's own edge, which was observed intermittently. Kept far below every
 * "present" assertion's own floor (100) and two orders of magnitude below
 * the ~166 pixels each defect actually produces, so this stays decisive
 * rather than vacuous. */
const ANTIALIASING_FLOOR_PIXELS = 10;

interface RegionCounts {
  total: number;
  byColour: Record<string, number>;
}

interface RoadSample {
  marker: { x: number; y: number; pixelCount: number };
  ahead: RegionCounts;
  behind: RegionCounts;
}

/** Runs entirely inside the page: decodes a screenshot PNG, locates the
 * position marker, then counts how many pixels in a narrow band just ahead
 * of and just behind the rider match each named road composite.
 *
 * The radius is deliberately TIGHTER than gradientColouring.spec.ts's
 * (100 vs 400): every target here is an exact interior composite over a
 * known flat background, and two of them are only ~30 apart in RGB, so a
 * radius-20 window could not separate them. A tight radius costs only
 * antialiased edge pixels, which are then excluded from every bucket
 * rather than misattributed to one. */
async function sampleRoadColours({
  pngBase64,
  colours,
  marker,
  bandHalfWidth,
  nearOffset,
  farOffset,
}: {
  pngBase64: string;
  colours: Record<string, readonly [number, number, number]>;
  marker: readonly [number, number, number];
  bandHalfWidth: number;
  nearOffset: number;
  farOffset: number;
}): Promise<RoadSample> {
  const COLOUR_THRESHOLD_SQUARED = 100;

  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => {
      resolve();
    };
    image.onerror = () => {
      reject(new Error("failed to decode captured screenshot"));
    };
  });
  image.src = `data:image/png;base64,${pngBase64}`;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas context unavailable");
  context.drawImage(image, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);

  function matches(offset: number, target: readonly [number, number, number]): boolean {
    const dr = (data[offset] ?? 0) - target[0];
    const dg = (data[offset + 1] ?? 0) - target[1];
    const db = (data[offset + 2] ?? 0) - target[2];
    return dr * dr + dg * dg + db * db <= COLOUR_THRESHOLD_SQUARED;
  }

  const MARKER_THRESHOLD_SQUARED = 400;
  function matchesMarker(offset: number): boolean {
    const dr = (data[offset] ?? 0) - marker[0];
    const dg = (data[offset + 1] ?? 0) - marker[1];
    const db = (data[offset + 2] ?? 0) - marker[2];
    return dr * dr + dg * dg + db * db <= MARKER_THRESHOLD_SQUARED;
  }

  let markerCount = 0;
  let markerSumX = 0;
  let markerSumY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (matchesMarker((y * width + x) * 4)) {
        markerCount += 1;
        markerSumX += x;
        markerSumY += y;
      }
    }
  }
  const markerX = markerCount > 0 ? Math.round(markerSumX / markerCount) : -1;
  const markerY = markerCount > 0 ? Math.round(markerSumY / markerCount) : -1;

  function countRegion(fromY: number, toY: number): RegionCounts {
    const byColour: Record<string, number> = {};
    for (const name of Object.keys(colours)) byColour[name] = 0;
    let total = 0;
    for (let y = Math.max(0, fromY); y < Math.min(height, toY); y++) {
      for (
        let x = Math.max(0, markerX - bandHalfWidth);
        x < Math.min(width, markerX + bandHalfWidth + 1);
        x++
      ) {
        const offset = (y * width + x) * 4;
        for (const [name, target] of Object.entries(colours)) {
          if (matches(offset, target)) {
            byColour[name] = (byColour[name] ?? 0) + 1;
            total += 1;
            break;
          }
        }
      }
    }
    return { total, byColour };
  }

  return {
    marker: { x: markerX, y: markerY, pixelCount: markerCount },
    ahead: countRegion(markerY - farOffset, markerY - nearOffset),
    behind: countRegion(markerY + nearOffset, markerY + farOffset),
  };
}

async function captureRoadSample(
  page: Page,
  colours: Record<string, readonly [number, number, number]>,
  nearOffset: number = NEAR_OFFSET_PX,
  farOffset: number = FAR_OFFSET_PX,
): Promise<RoadSample> {
  const canvasLocator = page.locator('[data-testid="map-container"] canvas');
  // MapLibre's paint/placement cycle runs independently of the source data
  // already being set — the same settle wait gradientColouring.spec.ts uses.
  await page.waitForTimeout(500);
  const pngBuffer = await canvasLocator.screenshot();
  return page.evaluate(sampleRoadColours, {
    pngBase64: pngBuffer.toString("base64"),
    colours,
    marker: POSITION_MARKER_COLOUR,
    bandHalfWidth: BAND_HALF_WIDTH_PX,
    nearOffset,
    farOffset,
  });
}

async function waitForPersistedFixLongitude(
  page: Page,
  longitude: number,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const row = await readActiveRideStateRow(page);
        const lastFix = row?.lastFix as
          { coordinate?: [number, number] } | null | undefined;
        return lastFix?.coordinate?.[0] ?? null;
      },
      { timeout: 15_000 },
    )
    .toBeCloseTo(longitude, 6);
}

async function readCommittedDistanceMetres(page: Page): Promise<number> {
  const row = await readActiveRideStateRow(page);
  const value = row?.lastReliableMatchedDistanceFromStartMetres;
  return typeof value === "number" ? value : Number.NaN;
}

test("paints the current route direction above the coincident completed trace on an exactly overlapping return leg", async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: lonAtMetres(0),
    accuracy: 5,
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: "active-direction-layering-route.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildFlatCoincidentOutAndBackGpx()),
  });

  const routeName = "active-direction-layering-route";
  const routeButton = page.getByRole("button", { name: routeName, exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  async function sendFixAtRouteDistance(routeDistanceMetres: number): Promise<void> {
    const longitude = lonAtMetres(physicalMetres(routeDistanceMetres));
    await context.setGeolocation({
      latitude: ROUTE_LAT,
      longitude,
      accuracy: 5,
    });
    await waitForPersistedFixLongitude(page, longitude);
  }

  for (
    let routeDistance = 100;
    routeDistance <= SAMPLE_PROGRESS_METRES;
    routeDistance += 100
  ) {
    await sendFixAtRouteDistance(routeDistance);
  }

  // Canonical progress must genuinely be on the RETURN leg before any
  // rendering claim is made — otherwise this proves nothing about
  // direction.
  expect(await readCommittedDistanceMetres(page)).toBeGreaterThan(
    OUTBOUND_LENGTH_METRES + 300,
  );

  const sample = await captureRoadSample(page, {
    // The opaque remaining-route green (#0a5f38) — what the near-ahead
    // direction overlay must paint on the coincident road.
    currentDirectionGreen: [0x0a, 0x5f, 0x38],
    // 0.7-alpha completed grey (#8a8f8c) composited over that same green:
    // what the rider actually sees today on the coincident return leg.
    completedOverRemaining: [0x64, 0x81, 0x73],
    // Completed grey composited over ITSELF over the local test style's
    // #dedede background — the doubled-back completed geometry behind the
    // rider, which must stay grey and is exactly what a naive global
    // completed/remaining layer reversal would destroy.
    completedSelfOverlap: [0x92, 0x96, 0x94],
  });

  // The anchor must genuinely have been found, or every claim below is
  // about an arbitrary band of the canvas. Finding it is also itself
  // rendered proof that the live position marker still paints above every
  // route line, including the new overlay, since the marker sits directly
  // on the route.
  expect(sample.marker.pixelCount).toBeGreaterThan(50);

  // Immediately AHEAD of the rider, on road the outbound leg has already
  // covered, the rider's current direction must win: the exact remaining
  // green, with none of the completed-over-remaining blend left.
  expect(sample.ahead.byColour.currentDirectionGreen).toBeGreaterThan(100);
  expect(sample.ahead.byColour.completedOverRemaining).toBeLessThan(
    ANTIALIASING_FLOOR_PIXELS,
  );

  // Immediately BEHIND the rider the doubled-back completed trace must
  // still read as completed. This is the assertion that fails if anyone
  // "fixes" the defect by globally reversing the completed and remaining
  // base layers, which would paint the still-remaining future occurrence
  // over genuinely-ridden road.
  expect(sample.behind.byColour.completedSelfOverlap).toBeGreaterThan(100);
  expect(sample.behind.byColour.currentDirectionGreen).toBeLessThan(
    ANTIALIASING_FLOOR_PIXELS,
  );

  expect(consoleErrors).toEqual([]);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
});

// ---------------------------------------------------------------------------
// Classified overlapping climb/descent.
//
// An exact retrace makes macro classification necessarily SYMMETRIC: at any
// physical point the outbound is a climb exactly when the return is a
// descent, with equal |gradient| and equal length, so both pass or both fail
// every eligibility gate. There is therefore no such thing as "flat outbound
// coincident with a recognised return descent" to build. And on the RETURN
// leg the macro/micro layers already clip to [matched, routeEnd], which
// excludes the outbound occurrence entirely.
//
// The classified defect is consequently reachable only on the OUTBOUND leg,
// and only when the active climb's own micro detail is NOT covering the road
// — i.e. when a different feature has been explicitly selected. Both states
// are measured below.

const CLIMB_LAT = 51.5;
const CLIMB_START_LON = -0.2;
const CLIMB_STEP_METRES = 25;
const CLIMB_FLAT_END_METRES = 500;
const CLIMB_SUMMIT_METRES = 2000;
const CLIMB_RETURN_END_METRES = 1400;
const CLIMB_GRADE_PERCENT = 11;

/** Where the rider is parked: 200 m below the summit, on road the return
 * descent also covers, and clear of any kilometre badge. */
const CLIMB_SAMPLE_PROGRESS_METRES = 1800;

/** Verified through the production analysers (analyzeRouteElevationProfile +
 * detectRouteFeatures) rather than assumed: this geometry yields a climb over
 * route 440–2000 m averaging 10.56% — climbScore in [16000, 32000), so
 * category-3 — whose local bands are "very-hard-climb", and a descent over
 * route 2000–2597 m averaging -11.01%, i.e. "very-steep". Every threshold
 * (MIN_FEATURE_LENGTH_METRES 500, MIN_CLIMB_AVERAGE_GRADIENT_PERCENT 3,
 * MIN_CLIMB_SCORE 1500, MAX_DESCENT_AVERAGE_GRADIENT_PERCENT -3) is cleared
 * with margin, and every classification boundary is avoided. */
function buildCoincidentClimbDescentGpx(): string {
  const xs: number[] = [];
  for (let x = 0; x <= CLIMB_SUMMIT_METRES; x += CLIMB_STEP_METRES) xs.push(x);
  for (
    let x = CLIMB_SUMMIT_METRES - CLIMB_STEP_METRES;
    x >= CLIMB_RETURN_END_METRES;
    x -= CLIMB_STEP_METRES
  )
    xs.push(x);

  const points = xs
    .map((x) => {
      const elevation =
        x <= CLIMB_FLAT_END_METRES
          ? 10
          : 10 + ((x - CLIMB_FLAT_END_METRES) * CLIMB_GRADE_PERCENT) / 100;
      const lon = CLIMB_START_LON + x / METRES_PER_DEGREE_LON;
      return `      <trkpt lat="${String(CLIMB_LAT)}" lon="${String(lon)}"><ele>${elevation.toFixed(1)}</ele></trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Active direction classified test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

const MACRO_CLIMB_CATEGORY_3: readonly [number, number, number] = [0xfd, 0xd8, 0x35];
const MICRO_VERY_HARD_CLIMB: readonly [number, number, number] = [0xb7, 0x1c, 0x1c];
const VERY_STEEP_DESCENT: readonly [number, number, number] = [0x1a, 0x1a, 0x4e];

const CLASSIFIED_COLOURS: Record<string, readonly [number, number, number]> = {
  macroClimb: MACRO_CLIMB_CATEGORY_3,
  microClimb: MICRO_VERY_HARD_CLIMB,
  descent: VERY_STEEP_DESCENT,
};

test("keeps the climbed direction's colour immediately ahead on a coincident climb/descent, whatever is explicitly selected", async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: CLIMB_LAT,
    longitude: CLIMB_START_LON,
    accuracy: 5,
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: "active-direction-classified-route.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildCoincidentClimbDescentGpx()),
  });

  const routeName = "active-direction-classified-route";
  const routeButton = page.getByRole("button", { name: routeName, exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  for (
    let routeDistance = 200;
    routeDistance <= CLIMB_SAMPLE_PROGRESS_METRES;
    routeDistance += 200
  ) {
    const longitude = CLIMB_START_LON + routeDistance / METRES_PER_DEGREE_LON;
    await context.setGeolocation({
      latitude: CLIMB_LAT,
      longitude,
      accuracy: 5,
    });
    await waitForPersistedFixLongitude(page, longitude);
  }
  expect(await readCommittedDistanceMetres(page)).toBeGreaterThan(1700);

  // (a) Nothing explicitly selected. The existing micro path already covers
  // the climbed road here, so this state is expected to be correct BEFORE
  // this item's change too — it is a no-regression control, not a defect.
  const withoutSelection = await captureRoadSample(page, CLASSIFIED_COLOURS);
  expect(withoutSelection.marker.pixelCount).toBeGreaterThan(50);
  expect(withoutSelection.ahead.byColour.microClimb).toBeGreaterThan(100);
  expect(withoutSelection.ahead.byColour.descent).toBeLessThan(ANTIALIASING_FLOOR_PIXELS);

  // (b) Explicitly select the opposite-direction feature through the real
  // UI: a map tap on the coincident road resolves to the macro layer's
  // topmost feature there, which is the return descent.
  await page.locator('[data-testid="map-container"] canvas').click({
    position: { x: withoutSelection.marker.x, y: withoutSelection.marker.y - 40 },
  });
  // The Profile pane carries the selected-feature summary. Switching to it
  // and back also proves the overlay survives a real Map/Profile switch,
  // which never remounts MapView.
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.getByText("Recognised descent")).toBeVisible();
  await page.getByRole("button", { name: "Map", exact: true }).click();

  const withSelection = await captureRoadSample(page, CLASSIFIED_COLOURS);
  // The selection stays truthfully represented in the details panel and on
  // the rest of the route, but must not decide the colour of the road the
  // rider is climbing right now. With the descent selected, the climb's own
  // presentation is its macro category colour, so that is what the local
  // overlay reproduces here.
  expect(withSelection.ahead.byColour.macroClimb).toBeGreaterThan(100);
  expect(withSelection.ahead.byColour.descent).toBeLessThan(ANTIALIASING_FLOOR_PIXELS);

  // Where the window's own two halves are geographically identical, the
  // piece nearest the rider in route order must win. Without that rule the
  // last stretch of the climb would paint as the descent that retraces it.
  const overlap = await captureRoadSample(
    page,
    CLASSIFIED_COLOURS,
    OVERLAP_NEAR_OFFSET_PX,
    OVERLAP_FAR_OFFSET_PX,
  );
  expect(overlap.ahead.byColour.macroClimb).toBeGreaterThan(100);
  expect(overlap.ahead.byColour.descent).toBeLessThan(ANTIALIASING_FLOOR_PIXELS);

  expect(consoleErrors).toEqual([]);
  expect(unexpectedOpenFreeMapRequests).toEqual([]);
});
