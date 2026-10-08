import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readPlanningDraftRow } from "./support/rideStateDb.ts";

// Proves CLAUDE.md backlog item 123 under genuine touch input: in Planning a
// touch (or pen) interaction on the map never places, moves or inserts a
// waypoint — only the deliberate crosshair placement control does — while
// a real mouse click on the map keeps placing one, decided per
// interaction rather than per device. This file runs under the
// "android-chrome" project (Pixel 7: touch-capable, so a mouse click here
// is the hybrid-device case) because genuine multi-point touch needs CDP
// Input.dispatchTouchEvent; Playwright's own page.touchscreen only taps.
//
// Every "places nothing" assertion is paired with the page-side input
// recorder below, which proves the gesture really arrived as touch (or
// pen) and records whether a DOM click reached MapLibre's canvas
// container — so a pass can never be explained by "no click happened".
//
// Measured on the unchanged 0.4.45 build, in this project: a touch tap,
// a touch movement inside Chromium's tap slop, the first tap of a
// double-tap zoom, and a pen tap each placed a waypoint (so did the first
// tap of a double-tap-and-drag zoom, which is not automated here: at a
// full parallel run CDP pacing made MapLibre's recognition of it
// load-dependent, and its first tap is an ordinary touch tap). Chromium withholds touchmove inside its ~15px tap slop, so a
// sub-slop movement there places a waypoint WITHOUT moving the camera, and
// a movement beyond it pans without any click: the rider's iPhone report
// of a pan that both moved the map and placed a waypoint is not
// reproducible in this engine and is not claimed here. Two-finger pinch
// and two-finger tap produced no click even before the change, so those
// two tests are regression guards, not fail-first evidence.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";
const DRAFT_AUTOSAVE_DEBOUNCE_MS = 900;
/** usePlanningRoute's RECALCULATION_DEBOUNCE_MS (900) plus a margin. */
const PAST_RECALCULATION_DEBOUNCE_MS = 1_500;
/** Between CDP touch events — androidMapCameraGestureRace.spec.ts found
 * unpaced dispatch unreliable, and this mirrors its spacing. */
const TOUCH_STEP_MS = 40;

interface Point {
  x: number;
  y: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RecordedInput {
  type: string;
  pointerType: string | null;
}

/** Records, in the capture phase, every input event that reaches MapLibre's
 * canvas container. Installed before any page script runs. */
async function installInputRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: { type: string; pointerType: string | null }[] = [];
    (globalThis as unknown as { __item123InputLog: typeof log }).__item123InputLog = log;
    for (const type of ["pointerdown", "touchstart", "click"]) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (!target.closest(".maplibregl-canvas-container")) return;
          log.push({
            type,
            pointerType: event instanceof PointerEvent ? event.pointerType : null,
          });
        },
        { capture: true, passive: true },
      );
    }
  });
}

async function takeRecordedInput(page: Page): Promise<RecordedInput[]> {
  return page.evaluate(() =>
    (
      globalThis as unknown as { __item123InputLog: RecordedInput[] }
    ).__item123InputLog.splice(0),
  );
}

function countOf(
  log: readonly RecordedInput[],
  type: string,
  pointerType?: string,
): number {
  return log.filter(
    (entry) =>
      entry.type === type &&
      (pointerType === undefined || entry.pointerType === pointerType),
  ).length;
}

/** See planning.spec.ts's identical workaround, duplicated per this
 * repo's no-shared-e2e-helpers-across-specs convention. */
async function fixWindowFetch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalFetch = fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
  });
}

function buildMockOrsResponseForCoordinates(coordinates: readonly (readonly number[])[]) {
  const densified: number[][] = [];
  const stepsPerLeg = 5;
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const [startLon, startLat] = coordinates[i];
    const [endLon, endLat] = coordinates[i + 1];
    for (let step = 0; step < stepsPerLeg; step += 1) {
      const t = step / stepsPerLeg;
      densified.push([
        startLon + t * (endLon - startLon),
        startLat + t * (endLat - startLat),
        10,
      ]);
    }
  }
  if (coordinates.length > 0) {
    const [lastLon, lastLat] = coordinates[coordinates.length - 1];
    densified.push([lastLon, lastLat, 10]);
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { summary: { distance: 100, duration: 20 } },
        geometry: { type: "LineString", coordinates: densified },
      },
    ],
  };
}

async function mockOrsRequests(page: Page): Promise<{ postCount: () => number }> {
  let posts = 0;
  await page.route(ORS_URL_GLOB, async (route) => {
    const request = route.request();
    let coordinates: (readonly number[])[] = [];
    if (request.method() === "POST") {
      posts += 1;
      coordinates = (request.postDataJSON() as { coordinates: (readonly number[])[] })
        .coordinates;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(buildMockOrsResponseForCoordinates(coordinates)),
    });
  });
  return { postCount: () => posts };
}

interface PlanningFixture {
  map: Locator;
  callout: Locator;
}

/** Opens Planning with a saved key and waits for the one-time regional
 * framing to settle — the placement control is disabled until it has. */
async function openPlanning(
  page: Page,
  context: BrowserContext,
): Promise<PlanningFixture> {
  await fixWindowFetch(page);
  await installInputRecorder(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await installLocalMapStyle(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("OpenRouteService API key").fill(DUMMY_KEY);
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();

  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  const callout = page.locator(".planning-crosshair-callout");
  await expect(callout).toBeEnabled({ timeout: 15_000 });
  const map = page.locator('[data-testid="map-container"]');
  await mapBox(page, map);
  await takeRecordedInput(page);
  return { map, callout };
}

function stroke(from: Point, to: Point, steps: number): Point[] {
  return Array.from({ length: steps + 1 }, (_, k) => ({
    x: from.x + ((to.x - from.x) * k) / steps,
    y: from.y + ((to.y - from.y) * k) / steps,
  }));
}

/** One genuine touch gesture: one stroke per finger, all strokes the same
 * length, dispatched through CDP so Chromium's own gesture pipeline (tap
 * detection, slop, compatibility mouse events) decides what follows. */
async function touchGesture(page: Page, strokes: readonly Point[][]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const pointsAt = (index: number) =>
    strokes.map((points, finger) => {
      const point = points[Math.min(index, points.length - 1)];
      return { x: point.x, y: point.y, id: finger + 1 };
    });
  const steps = Math.max(...strokes.map((points) => points.length));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: pointsAt(0),
  });
  for (let index = 1; index < steps; index += 1) {
    await page.waitForTimeout(TOUCH_STEP_MS);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: pointsAt(index),
    });
  }
  await page.waitForTimeout(TOUCH_STEP_MS);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function touchTap(page: Page, point: Point): Promise<void> {
  await touchGesture(page, [[point]]);
}

/** A stationary two-finger tap: both contacts down, a TOUCH_STEP_MS hold,
 * both up — still genuine CDP touch, paced as before. Both events carry
 * explicit CDP timestamps TOUCH_STEP_MS apart, which Chromium gives the DOM
 * touch events as their timeStamp; without them, each event's timeStamp
 * follows its own command's arrival, so a slow touchStart acknowledgement
 * stretches the contact. MapLibre 6.6.0's tap recogniser rejects a contact
 * longer than 500 ms by timeStamp. In CI run 37748819780 the two commands
 * started 500.9 ms apart (a 447 ms touchStart acknowledgement) and the tap
 * was not recognised; that its DOM contact exceeded 500 ms is inferred from
 * those command times, not recorded. The end timestamp is never in the
 * future: the real hold precedes it. */
async function twoFingerTap(page: Page, points: readonly [Point, Point]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const touchPoints = points.map((point, finger) => ({
    x: point.x,
    y: point.y,
    id: finger + 1,
  }));
  const startedAt = Date.now() / 1000;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints,
    timestamp: startedAt,
  });
  await page.waitForTimeout(TOUCH_STEP_MS);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
    timestamp: startedAt + TOUCH_STEP_MS / 1000,
  });
  await cdp.detach();
}

/** Two taps at one point, through one CDP session and paced like a
 * finger (40ms contacts, a 100ms gap). A separate session per tap once
 * drifted outside MapLibre's 500ms double-tap window under a full parallel
 * run, and unpaced contacts are not read as a tap pair reliably at all. */
async function doubleTap(page: Page, point: Point): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const touchPoints = [{ x: point.x, y: point.y, id: 1 }];
  for (let tap = 0; tap < 2; tap += 1) {
    if (tap > 0) await page.waitForTimeout(100);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
    await page.waitForTimeout(TOUCH_STEP_MS);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await cdp.detach();
}

/** A pen tap through Chromium's own input pipeline — pointerType "pen". */
async function penTap(page: Page, point: Point): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const base = { x: point.x, y: point.y, pointerType: "pen" as const };
  await cdp.send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved" });
  await cdp.send("Input.dispatchMouseEvent", {
    ...base,
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    ...base,
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await cdp.detach();
}

/** Scrolls Planning to the top — where the map sits whole below the
 * navigation — and measures the map afresh. Planning keeps the previous
 * screen's scroll offset (item 125), and tapping a waypoint row scrolls
 * the page, so a box measured earlier cannot be trusted for a gesture. */
async function mapBox(page: Page, map: Locator): Promise<Box> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(100);
  const box = await map.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("the Planning map has no bounding box");
  if (box.y < 0 || box.y + box.height > viewport.height) {
    throw new Error(`the Planning map is not wholly in view: ${JSON.stringify(box)}`);
  }
  return box;
}

/** A point on open map, clear of the centre crosshair, the placement
 * control (bottom centre) and the right-hand map controls. */
async function openMapPoint(
  page: Page,
  map: Locator,
  fx = 0.3,
  fy = 0.3,
): Promise<Point> {
  const box = await mapBox(page, map);
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** The open-map point furthest from the straight routed line between the
 * two waypoint markers (the mocked route is linear between them), asserted
 * to be well clear of it. */
async function pointClearOfRoute(page: Page, map: Locator): Promise<Point> {
  const box = await mapBox(page, map);
  const centres = await markers(page).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }),
  );
  if (centres.length !== 2)
    throw new Error(`expected two markers, found ${String(centres.length)}`);
  const [a, b] = centres;
  const distanceToRoute = (p: Point) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
    );
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  const candidates = [
    [0.2, 0.2],
    [0.2, 0.65],
    [0.7, 0.2],
    [0.7, 0.6],
    [0.45, 0.15],
  ].map(([fx, fy]) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy }));
  const best = candidates.reduce((kept, candidate) =>
    distanceToRoute(candidate) > distanceToRoute(kept) ? candidate : kept,
  );
  expect(
    distanceToRoute(best),
    "the tap point is well clear of the route",
  ).toBeGreaterThan(60);
  return best;
}

/** Lets MapLibre's own gesture handling and any debounced autosave run
 * out before a "nothing changed" assertion. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(DRAFT_AUTOSAVE_DEBOUNCE_MS + 300);
}

/** Taps a waypoint-row toggle (a waypoint, Move or Insert after) once it
 * has stopped moving, and confirms the tap registered — a missed tap on a
 * row button would otherwise surface later as a misleading placement
 * failure. */
async function tapToggle(page: Page, button: Locator): Promise<void> {
  await button.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await button.tap();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

function markers(page: Page): Locator {
  return page.locator(".planning-waypoint-marker");
}

async function readWaypointCoordinates(page: Page): Promise<number[][]> {
  const draft = await readPlanningDraftRow(page);
  const waypoints = (draft?.waypoints ?? []) as { coordinate: number[] }[];
  return waypoints.map((waypoint) => waypoint.coordinate);
}

/** Pans by a genuine touch drag well beyond the tap slop, then waits for
 * the camera to settle so the placement control is usable again. */
async function touchPan(page: Page, fixture: PlanningFixture, dx: number, dy: number) {
  const start = await openMapPoint(page, fixture.map, 0.5, 0.3);
  const centreBefore = await fixture.map.getAttribute("data-camera-center");
  await touchGesture(page, [stroke(start, { x: start.x + dx, y: start.y + dy }, 8)]);
  await expect
    .poll(() => fixture.map.getAttribute("data-camera-center"))
    .not.toBe(centreBefore);
  await expect(fixture.callout).toBeEnabled();
}

test.describe("Planning touch placement under genuine touch (item 123)", () => {
  test("a stationary touch tap places nothing, while a mouse click in the same touch-capable context places one — even straight after a touch", async ({
    page,
    context,
  }) => {
    const fixture = await openPlanning(page, context);
    const undo = page.getByRole("button", { name: "Undo" });

    await touchTap(page, await openMapPoint(page, fixture.map));
    await settle(page);
    const touchInput = await takeRecordedInput(page);
    expect(countOf(touchInput, "pointerdown", "touch")).toBe(1);
    expect(countOf(touchInput, "touchstart")).toBe(1);
    expect(countOf(touchInput, "click"), "a click reached the map").toBe(1);
    await expect(markers(page)).toHaveCount(0);
    await expect(page.getByText("No waypoints yet.", { exact: false })).toBeVisible();
    await expect(undo).toBeDisabled();

    // Per interaction, not per device: the very next mouse click places,
    // with no delay after the touch.
    await touchTap(page, await openMapPoint(page, fixture.map));
    const mousePoint = await openMapPoint(page, fixture.map, 0.6, 0.3);
    await page.mouse.click(mousePoint.x, mousePoint.y);
    await settle(page);
    const mixedInput = await takeRecordedInput(page);
    expect(countOf(mixedInput, "pointerdown", "touch")).toBe(1);
    expect(countOf(mixedInput, "pointerdown", "mouse")).toBe(1);
    expect(countOf(mixedInput, "click")).toBe(2);
    await expect(markers(page)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
    await expect(undo).toBeEnabled();
  });

  test("a touch movement inside the browser's tap slop places nothing", async ({
    page,
    context,
  }) => {
    const fixture = await openPlanning(page, context);
    const start = await openMapPoint(page, fixture.map);

    // 10px: inside Chromium's tap slop, so the browser still reports a
    // click — measured to place a waypoint on the unchanged build.
    await touchGesture(page, [stroke(start, { x: start.x, y: start.y + 10 }, 5)]);
    await settle(page);
    const input = await takeRecordedInput(page);
    expect(countOf(input, "pointerdown", "touch")).toBe(1);
    expect(countOf(input, "click"), "the browser still reported a tap").toBe(1);
    await expect(markers(page)).toHaveCount(0);
  });

  test("a touch pan beyond the tap slop moves the map and places nothing (regression guard)", async ({
    page,
    context,
  }) => {
    const fixture = await openPlanning(page, context);
    const start = await openMapPoint(page, fixture.map);
    const centreBefore = await fixture.map.getAttribute("data-camera-center");

    await touchGesture(page, [stroke(start, { x: start.x, y: start.y + 40 }, 8)]);
    await expect
      .poll(() => fixture.map.getAttribute("data-camera-center"))
      .not.toBe(centreBefore);
    await settle(page);
    const input = await takeRecordedInput(page);
    expect(countOf(input, "pointerdown", "touch")).toBe(1);
    await expect(markers(page)).toHaveCount(0);
  });

  test("a double-tap zoom changes the zoom and places nothing", async ({
    page,
    context,
  }) => {
    const fixture = await openPlanning(page, context);
    const point = await openMapPoint(page, fixture.map);

    const zoomBeforeDoubleTap = await fixture.map.getAttribute("data-camera-zoom");
    await doubleTap(page, point);
    await expect
      .poll(() => fixture.map.getAttribute("data-camera-zoom"))
      .not.toBe(zoomBeforeDoubleTap);
    await settle(page);
    const doubleTapInput = await takeRecordedInput(page);
    expect(countOf(doubleTapInput, "pointerdown", "touch")).toBe(2);
    expect(
      countOf(doubleTapInput, "click"),
      "the first tap's click reached the map",
    ).toBeGreaterThanOrEqual(1);
    await expect(markers(page)).toHaveCount(0);
  });

  test("a two-finger pinch and a two-finger tap change the zoom and place nothing (regression guard)", async ({
    page,
    context,
  }) => {
    const fixture = await openPlanning(page, context);
    const point = await openMapPoint(page, fixture.map, 0.45, 0.35);

    const zoomBeforePinch = await fixture.map.getAttribute("data-camera-zoom");
    await touchGesture(page, [
      stroke({ x: point.x - 30, y: point.y }, { x: point.x - 90, y: point.y }, 6),
      stroke({ x: point.x + 30, y: point.y }, { x: point.x + 90, y: point.y }, 6),
    ]);
    await expect
      .poll(() => fixture.map.getAttribute("data-camera-zoom"))
      .not.toBe(zoomBeforePinch);
    await settle(page);
    expect(countOf(await takeRecordedInput(page), "pointerdown", "touch")).toBe(2);
    await expect(markers(page)).toHaveCount(0);

    const zoomBeforeTwoFingerTap = await fixture.map.getAttribute("data-camera-zoom");
    await twoFingerTap(page, [
      { x: point.x - 30, y: point.y },
      { x: point.x + 30, y: point.y },
    ]);
    await expect
      .poll(() => fixture.map.getAttribute("data-camera-zoom"))
      .not.toBe(zoomBeforeTwoFingerTap);
    await settle(page);
    expect(countOf(await takeRecordedInput(page), "pointerdown", "touch")).toBe(2);
    await expect(markers(page)).toHaveCount(0);
  });

  test("a pen tap on the map places nothing — pen follows touch by the rider's decision", async ({
    page,
    context,
  }) => {
    const fixture = await openPlanning(page, context);

    await penTap(page, await openMapPoint(page, fixture.map));
    await settle(page);
    const input = await takeRecordedInput(page);
    expect(countOf(input, "pointerdown", "pen")).toBe(1);
    expect(countOf(input, "click"), "a click reached the map").toBe(1);
    await expect(markers(page)).toHaveCount(0);
  });

  test("ignored touch and pen interactions leave the draft, the routed legs and the undo history untouched", async ({
    page,
    context,
  }) => {
    const { postCount } = await mockOrsRequests(page);
    const fixture = await openPlanning(page, context);

    const first = await openMapPoint(page, fixture.map, 0.3, 0.3);
    const second = await openMapPoint(page, fixture.map, 0.6, 0.45);
    await page.mouse.click(first.x, first.y);
    await page.mouse.click(second.x, second.y);
    await expect(
      page.getByRole("button", { name: "Waypoint 2", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /calculate route/i }).click();
    await expect(page.getByRole("region", { name: "Route summary" })).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(() => readWaypointCoordinates(page), {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .toHaveLength(2);
    const coordinatesBefore = await readWaypointCoordinates(page);
    const postsBefore = postCount();
    await takeRecordedInput(page);

    // Away from the routed line: a touch tap on it would legitimately
    // select its unknown-surface warning, which is not what this proves.
    const point = await pointClearOfRoute(page, fixture.map);
    await touchTap(page, point);
    await page.waitForTimeout(600);
    await touchGesture(page, [stroke(point, { x: point.x + 10, y: point.y }, 5)]);
    await page.waitForTimeout(600);
    await penTap(page, point);
    await page.waitForTimeout(PAST_RECALCULATION_DEBOUNCE_MS);

    await expect(markers(page)).toHaveCount(2);
    expect(postCount(), "no routing request").toBe(postsBefore);
    expect(await readWaypointCoordinates(page)).toEqual(coordinatesBefore);
    const input = await takeRecordedInput(page);
    expect(countOf(input, "pointerdown", "touch")).toBe(2);
    expect(countOf(input, "pointerdown", "pen")).toBe(1);
    expect(countOf(input, "click"), "every gesture reached the map as a click").toBe(3);

    // The top of the history is still the second mouse placement.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(
      page.getByRole("button", { name: "Waypoint 2", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  });

  test("the crosshair control adds, moves and inserts on the intended waypoint by touch, and a map tap never completes a pending Move", async ({
    page,
    context,
  }) => {
    // The longest test here: three paced touch pans, a tap with its
    // settle, four row toggles and three autosave polls, every phase
    // needed. Measured on 6 October 2026, in the CI image with tracing:
    // 17.7s alone and unloaded; CI run 37483537843 spent the default 30s
    // and stopped at its last pan, every earlier step having passed; and
    // under a deliberately harsher load (4 CPUs, 2 workers) it completed,
    // every assertion passing, in 48-66s on both 0.4.66 and 0.4.67. The
    // budget covers that with margin; nothing waits longer as a result.
    test.setTimeout(90_000);
    const fixture = await openPlanning(page, context);
    const { callout } = fixture;

    await expect(callout).toHaveText("Add waypoint here");
    await callout.tap();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
    await touchPan(page, fixture, -60, 40);
    await callout.tap();
    await expect(
      page.getByRole("button", { name: "Waypoint 2", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => readWaypointCoordinates(page), {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .toHaveLength(2);
    const [startCoordinate, secondCoordinate] = await readWaypointCoordinates(page);

    // Move waypoint 2: a touch tap on the map leaves the Move pending.
    await tapToggle(page, page.getByRole("button", { name: "Waypoint 2", exact: true }));
    const secondRow = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Waypoint 2", exact: true }) });
    await tapToggle(page, secondRow.getByRole("button", { name: "Move", exact: true }));
    await expect(callout).toHaveText("Move waypoint 2 here");
    await takeRecordedInput(page);
    await touchTap(page, await openMapPoint(page, fixture.map, 0.25, 0.25));
    await settle(page);
    expect(
      countOf(await takeRecordedInput(page), "click"),
      "a click reached the map",
    ).toBe(1);
    await expect(callout).toHaveText("Move waypoint 2 here");
    expect(await readWaypointCoordinates(page)).toEqual([
      startCoordinate,
      secondCoordinate,
    ]);

    await touchPan(page, fixture, 50, -30);
    await callout.tap();
    await expect(callout).not.toHaveText("Move waypoint 2 here");
    await expect
      .poll(async () => (await readWaypointCoordinates(page))[1], {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .not.toEqual(secondCoordinate);
    const [startAfterMove, movedSecond] = await readWaypointCoordinates(page);
    expect(startAfterMove).toEqual(startCoordinate);

    // Insert after the start: lands between the start and waypoint 2.
    await tapToggle(page, page.getByRole("button", { name: "Start", exact: true }));
    const startRow = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Start", exact: true }) });
    await tapToggle(
      page,
      startRow.getByRole("button", { name: "Insert after", exact: true }),
    );
    await expect(callout).toHaveText("Insert after the start");
    await touchPan(page, fixture, 40, 50);
    await callout.tap();
    await expect(
      page.getByRole("button", { name: "Waypoint 3", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => readWaypointCoordinates(page), {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .toHaveLength(3);
    const afterInsert = await readWaypointCoordinates(page);
    expect(afterInsert[0]).toEqual(startCoordinate);
    expect(afterInsert[2]).toEqual(movedSecond);
    expect(afterInsert[1]).not.toEqual(startCoordinate);
    expect(afterInsert[1]).not.toEqual(movedSecond);
  });
});
