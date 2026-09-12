import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow } from "./support/rideStateDb.ts";

// installLocalMapStyle's own doc comment requires this: requests handled by
// the app's service worker never reach page.route()'s interception, so
// without it the tile-style interception this spec relies on is not
// guaranteed to apply. Measured separately during item 32's investigation:
// adding it alone changed the completion flake's rate but did not remove it,
// so it is a harness-contract correction here, not the flake's cause.
test.use({ serviceWorkers: "block" });

const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
// Metres per degree of longitude at latitude 51.5 — the same conversion
// factor ridingNextManoeuvre.spec.ts's own fixture uses, reused here rather
// than re-derived.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 10;
/** The confirming finish fix, deliberately a few metres PAST the route's own
 * final coordinate rather than identical to the preceding one — matching the
 * closed-loop test's established pattern below, and giving the per-fix
 * acknowledgement an unambiguous coordinate to match. Still completion
 * eligible by both of rideCompletion.ts's gates: 5 m is far inside
 * ROUTE_COMPLETION_ENDPOINT_BASE_RADIUS_METRES (25 m), and the projection
 * clamps to the final point so reliable progress stays at the route total,
 * i.e. 0 m remaining against a 50 m threshold. */
const ROUTE_PAST_FINISH_METRES = ROUTE_LENGTH_METRES + 5;

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

// Deterministic replacement for a fixed sleep: finish() (useRideNavigation.ts,
// the sole caller of clearActiveRideState() in the app) awaits the storage
// clear FIRST, before any in-memory state change — so the persisted
// rideState row's absence is a race-free signal that finalisation has
// actually committed, strictly stronger than the pre-reload clean-UI
// assertions already in place above.
async function waitForClearedRideState(page: Page): Promise<void> {
  await expect.poll(() => readActiveRideStateRow(page), { timeout: 10_000 }).toBeNull();
}

interface ObservedFix {
  longitude: number;
  timestampMs: number;
}

async function readPersistedLastFix(page: Page): Promise<ObservedFix | null> {
  const row = await readActiveRideStateRow(page);
  const lastFix = row?.lastFix as
    { coordinate: [number, number]; timestampMs: number } | null | undefined;
  if (lastFix === null || lastFix === undefined) return null;
  return { longitude: lastFix.coordinate[0], timestampMs: lastFix.timestampMs };
}

/**
 * Backlog item 32. Issues one synthetic fix and does not return until the app
 * has genuinely COMMITTED it — proved by the persisted rideState row, which
 * useRideNavigation.ts rewrites from a render effect on every accepted fix.
 *
 * This exists because the alternative barriers are not barriers at all. A
 * negative `toBeHidden()` passes instantly, and `On route` is already visible
 * from the ride's very first fix, so neither delays the next override.
 * Measured in the pinned Playwright container during item 32's investigation:
 * with the 400 m and 420 m overrides issued back to back that way, all five
 * watchPosition callbacks were delivered every time, but in 8 of 40 runs only
 * FOUR reached a committed render — React coalesced the pair and the 420 m fix
 * was superseded before any render observed it. Since that was the second
 * arming fix, the ride never armed, the finish fix was then evaluated while
 * unarmed and reset the arming streak, and `Route complete` never appeared.
 *
 * The persisted row is a causal fence proving the fix reached committed app
 * state; it deliberately does not claim the completion reducer accepted it —
 * the assertions that follow each call are what prove that layer.
 */
async function setGeolocationAndAwaitFix(
  page: Page,
  context: BrowserContext,
  longitude: number,
  previous: ObservedFix | null,
): Promise<ObservedFix> {
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude });
  await expect
    .poll(
      async () => {
        const observed = await readPersistedLastFix(page);
        if (observed === null) return false;
        if (Math.abs(observed.longitude - longitude) > 1e-12) return false;
        // A distinct coordinate is the primary match; the timestamp guard
        // additionally rejects a stale row left by an earlier identical fix.
        return previous?.timestampMs !== observed.timestampMs;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const observed = await readPersistedLastFix(page);
  if (observed === null)
    throw new Error("expected a persisted fix after acknowledgement");
  return observed;
}

/** A simple, straight, densely-sampled GPX track — deliberately independent
 * of OpenRouteService, so this spec never needs routing-provider mocking.
 * The final track point's coordinate is what completion detection compares
 * a rider's fix against. */
function buildStraightRouteGpx(): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const distanceMetres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Finish/End test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

// Metres per degree of latitude — effectively latitude-independent (unlike
// longitude), so a single approximate constant is fine given this spec's
// generous distance margins.
const METRES_PER_DEGREE_LAT = 111_320;
const LOOP_SIDE_METRES = 300;
const LOOP_PERIMETER_METRES = LOOP_SIDE_METRES * 4;
const LOOP_LON_DELTA = LOOP_SIDE_METRES / METRES_PER_DEGREE_LON;
const LOOP_LAT_DELTA = LOOP_SIDE_METRES / METRES_PER_DEGREE_LAT;
// ~15 m south of the shared start/finish coordinate, continuing in side D's
// own direction of travel — the "rider continued a few metres past the
// finish looking for parking" field scenario.
const LOOP_PAST_FINISH_LATITUDE = ROUTE_LAT - 15 / METRES_PER_DEGREE_LAT;

/** A small square-loop route (~1.2 km perimeter) whose start and finish
 * share the same coordinate — east along side A, north along side B, west
 * along side C, south along side D back to the start. `distanceMetres` is
 * cumulative distance around the perimeter, starting at the shared
 * start/finish corner; `distanceMetres === LOOP_PERIMETER_METRES` returns
 * that same shared coordinate. */
function loopPositionAtMetres(distanceMetres: number): {
  latitude: number;
  longitude: number;
} {
  const clamped = Math.min(Math.max(distanceMetres, 0), LOOP_PERIMETER_METRES);
  if (clamped <= LOOP_SIDE_METRES) {
    const t = clamped / LOOP_SIDE_METRES;
    return { latitude: ROUTE_LAT, longitude: ROUTE_START_LON + t * LOOP_LON_DELTA };
  }
  if (clamped <= 2 * LOOP_SIDE_METRES) {
    const t = (clamped - LOOP_SIDE_METRES) / LOOP_SIDE_METRES;
    return {
      latitude: ROUTE_LAT + t * LOOP_LAT_DELTA,
      longitude: ROUTE_START_LON + LOOP_LON_DELTA,
    };
  }
  if (clamped <= 3 * LOOP_SIDE_METRES) {
    const t = (clamped - 2 * LOOP_SIDE_METRES) / LOOP_SIDE_METRES;
    return {
      latitude: ROUTE_LAT + LOOP_LAT_DELTA,
      longitude: ROUTE_START_LON + LOOP_LON_DELTA - t * LOOP_LON_DELTA,
    };
  }
  const t = (clamped - 3 * LOOP_SIDE_METRES) / LOOP_SIDE_METRES;
  return {
    latitude: ROUTE_LAT + LOOP_LAT_DELTA - t * LOOP_LAT_DELTA,
    longitude: ROUTE_START_LON,
  };
}

/** A densely-sampled (60 m spacing) closed-loop GPX track — the first and
 * final trkpt share the same coordinate, matching how a real closed-loop
 * ride would be recorded. */
function buildClosedLoopRouteGpx(): string {
  const segmentMetres = 60;
  const pointCount = LOOP_PERIMETER_METRES / segmentMetres + 1;
  const points = Array.from({ length: pointCount }, (_, index) => {
    const { latitude, longitude } = loopPositionAtMetres(segmentMetres * index);
    return `      <trkpt lat="${String(latitude)}" lon="${String(longitude)}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Closed-loop finish test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

test("ends a ride, returns to the empty Ride launcher, and survives a reload with no restored progress", async ({
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
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: "finish-end-route.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx()),
  });

  const routeName = "finish-end-route";
  const routeButton = page.getByRole("button", { name: routeName, exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  // Establish persisted progress partway along the route.
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
  await expect(page.getByText("On route")).toBeVisible();

  const endRideButton = page.getByRole("button", { name: "End ride" });
  await expect(endRideButton).toBeVisible();
  await endRideButton.click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("End this ride?")).toBeVisible();
  await expect(
    dialog.getByText(
      "Navigation progress for this ride will be cleared. The saved route will remain in your library.",
    ),
  ).toBeVisible();

  // The immersive header's own End slot (backlog item 55, superseding
  // item 50's original .ride-end-ride-row single-container structure)
  // goes empty once the confirmation opens, and the confirmation renders
  // as its own full-width row immediately after the header. The route
  // heading and on-route status stay visible around it throughout.
  const dialogFollowsHeaderDirectly = await page.evaluate(() => {
    const header = document.querySelector(".riding-immersive-header");
    const endSlot = document.querySelector(".riding-immersive-header-end");
    const confirmRow = document.querySelector(".ride-end-ride-confirm-row");
    const alertDialog = document.querySelector('[role="alertdialog"]');
    if (!header || !endSlot || !confirmRow || !alertDialog) return false;
    return (
      !endSlot.contains(alertDialog) &&
      header.nextElementSibling === confirmRow &&
      confirmRow.contains(alertDialog)
    );
  });
  expect(dialogFollowsHeaderDirectly).toBe(true);
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect(page.getByText("On route")).toBeVisible();

  // Cancel restores the trigger in the same slot, focused, with progress
  // untouched.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(endRideButton).toBeFocused();
  expect(await readActiveRideStateRow(page)).not.toBeNull();

  await endRideButton.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "End ride" }).click();

  // Empty Ride launcher — the route is no longer open, but remains saved
  // (the reload + reopen below proves this directly).
  await expect(page.getByRole("heading", { name: "Ride" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeHidden();
  await expect(page.getByRole("heading", { name: routeName })).toBeHidden();

  // Deterministic replacement for a fixed sleep before reload — see
  // waitForClearedRideState's own doc comment for why polling for the
  // row's absence is race-free here.
  await waitForClearedRideState(page);
  await page.reload();

  await page.getByRole("button", { name: routeName, exact: true }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeHidden();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// Regression coverage for a real iPhone field defect: on a closed-loop
// route (shared start/finish coordinate), progress could snap from
// near-total back to near-zero right at the finish — see
// projection.test.ts's "closed-loop start/finish coincidence" tests and
// RidingScreen.closedLoopCompletion.test.tsx for the lower-level proof.
// This proves the same real, integrated projection-to-completion-to-
// launcher path through actual geolocation-driven navigation, not just a
// mocked/unit-level one.
test("confirms route completion on a closed loop without snapping progress back to the start near the shared finish coordinate", async ({
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
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: "closed-loop-finish-route.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildClosedLoopRouteGpx()),
  });

  const routeName = "closed-loop-finish-route";
  const routeButton = page.getByRole("button", { name: routeName, exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  async function setGeolocationAndAwaitRemainingKm(
    distanceMetres: number,
    remainingKm: string,
  ): Promise<void> {
    const { latitude, longitude } = loopPositionAtMetres(distanceMetres);
    await context.setGeolocation({ latitude, longitude });
    await expect(page.getByText(`${remainingKm} km · 0 m ascent`)).toBeVisible();
  }

  // Arm via two consecutive interior fixes (50%/58% progress around the
  // loop), comfortably inside the 10%-80% interior-progress band and
  // geographically far from the shared finish's departure radius. Each
  // step waits for its own exact, distinctly-valued "Remaining" text —
  // not merely a fixed delay — so every fix is confirmed genuinely
  // applied (and progress genuinely advancing, never snapping back) before
  // the next one is issued.
  await setGeolocationAndAwaitRemainingKm(600, "0.6");
  await expect(page.getByText("On route")).toBeVisible();
  await setGeolocationAndAwaitRemainingKm(700, "0.5");

  // Walk forward towards the finish in several intermediate steps (not one
  // large jump — a large jump could itself trigger a legitimate reacquire
  // that resolves to the coincident start regardless of whether the fix
  // under test works, silently failing to exercise the bug at all).
  await setGeolocationAndAwaitRemainingKm(800, "0.4");
  await setGeolocationAndAwaitRemainingKm(900, "0.3");
  await setGeolocationAndAwaitRemainingKm(1000, "0.2");
  await setGeolocationAndAwaitRemainingKm(1100, "0.1");
  await expect(page.getByText("Route complete")).toBeHidden();

  // A single fix exactly at the shared finish coordinate is not enough on
  // its own — the existing two-consecutive-fix completion requirement.
  await setGeolocationAndAwaitRemainingKm(LOOP_PERIMETER_METRES, "0.0");
  await expect(page.getByText("On route")).toBeVisible();
  await expect(page.getByText("Route complete")).toBeHidden();

  // A second consecutive fix, a few metres past the finish (the "looking
  // for parking" field scenario), confirms completion without snapping
  // progress back to the start.
  await context.setGeolocation({
    latitude: LOOP_PAST_FINISH_LATITUDE,
    longitude: ROUTE_START_LON,
  });
  await expect(page.getByText("Route complete")).toBeVisible();
  await expect(page.getByText("0.0 km · 0 m ascent")).toBeVisible();

  const finishButton = page.getByRole("button", { name: "Finish ride" });
  await expect(finishButton).toBeVisible();
  // Finish ride stays confirmation-free and separate from End ride's own
  // in-place morph (backlog item 50) — no alertdialog exists before the
  // click, and clicking finalises directly with no confirmation appearing.
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await finishButton.click();
  await expect(page.getByRole("alertdialog")).toBeHidden();

  await expect(page.getByRole("heading", { name: "Ride" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeHidden();

  // Generic finalisation/reload plumbing (route-shape-independent) is
  // already fully proven by this file's straight-route test above —
  // polling the persisted row down to null is enough to close the loop
  // here without re-proving the full reload-and-reopen dance again.
  await waitForClearedRideState(page);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("conservatively confirms route completion only after consecutive fixes, and Finish ride clears recovery state", async ({
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
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: "finish-end-route.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx()),
  });

  const routeName = "finish-end-route";
  const routeButton = page.getByRole("button", { name: routeName, exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  // Well short of the finish — substantial remaining distance, so the
  // completion panel must not appear regardless of how many fixes land
  // here. These two consecutive interior fixes (40%/42% progress, both
  // well outside the arming departure radius around the finish) also
  // happen to be exactly the evidence that arms the ride — see
  // rideCompletion.test.ts/RidingScreen.completionArming.test.tsx for
  // arming-specific unit/component coverage; this e2e path proves the same
  // real geolocation-driven progression arms and then completes correctly
  // end-to-end, without needing a third deliberate arming step.
  const armingOne = await setGeolocationAndAwaitFix(
    page,
    context,
    lonAtMetres(400),
    null,
  );
  await expect(page.getByText("On route")).toBeVisible();
  const armingTwo = await setGeolocationAndAwaitFix(
    page,
    context,
    lonAtMetres(420),
    armingOne,
  );
  await expect(page.getByText("Route complete")).toBeHidden();

  // A single fix at the finish is not enough on its own.
  const finishOne = await setGeolocationAndAwaitFix(
    page,
    context,
    lonAtMetres(ROUTE_LENGTH_METRES),
    armingTwo,
  );
  await expect(page.getByText("0.0 km · 0 m ascent")).toBeVisible();
  await expect(page.getByText("Route complete")).toBeHidden();

  // A second consecutive fix at the finish confirms completion.
  await setGeolocationAndAwaitFix(
    page,
    context,
    lonAtMetres(ROUTE_PAST_FINISH_METRES),
    finishOne,
  );
  await expect(page.getByText("Route complete")).toBeVisible();

  // Nothing was cleared merely by showing the panel — the rider can still
  // navigate away and come back to a resumable ride (not asserted via
  // reload here to keep this test focused; End ride's own reload proof
  // covers that path).
  const finishButton = page.getByRole("button", { name: "Finish ride" });
  await expect(finishButton).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep riding" })).toBeVisible();

  await finishButton.click();

  // Empty Ride launcher — the route is no longer open, but remains saved
  // (the reload + reopen below proves this directly).
  await expect(page.getByRole("heading", { name: "Ride" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeHidden();
  await expect(page.getByRole("heading", { name: routeName })).toBeHidden();
  await expect(page.getByText("Route complete")).toBeHidden();
  await expect(page.getByRole("button", { name: "End ride" })).toBeHidden();

  // Deterministic replacement for a fixed sleep before reload — see
  // waitForClearedRideState's own doc comment for why polling for the
  // row's absence is race-free here.
  await waitForClearedRideState(page);
  await page.reload();
  await page.getByRole("button", { name: routeName, exact: true }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeHidden();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test.describe("390px phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the End-ride confirmation replaces the trigger with no horizontal overflow, and both stay real ≥44×44px touch targets", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    await page.goto("/");
    await page.getByLabel("Import GPX file").setInputFiles({
      name: "finish-end-route.gpx",
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(buildStraightRouteGpx()),
    });

    const routeName = "finish-end-route";
    await page.getByRole("button", { name: routeName, exact: true }).click();
    await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

    await page.getByRole("button", { name: "Start riding" }).click();
    await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
    await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
    await expect(page.getByText("On route")).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);

    const endRideButton = page.getByRole("button", { name: "End ride" });
    await expect(endRideButton).toBeVisible();
    const triggerBox = await endRideButton.boundingBox();
    expect(triggerBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await endRideButton.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    const dialogFollowsHeaderDirectly = await page.evaluate(() => {
      const header = document.querySelector(".riding-immersive-header");
      const endSlot = document.querySelector(".riding-immersive-header-end");
      const confirmRow = document.querySelector(".ride-end-ride-confirm-row");
      const alertDialog = document.querySelector('[role="alertdialog"]');
      if (!header || !endSlot || !confirmRow || !alertDialog) return false;
      return (
        !endSlot.contains(alertDialog) &&
        header.nextElementSibling === confirmRow &&
        confirmRow.contains(alertDialog)
      );
    });
    expect(dialogFollowsHeaderDirectly).toBe(true);
    const scrollWidthWithDialog = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidthWithDialog).toBeLessThanOrEqual(390);

    const cancelButton = dialog.getByRole("button", { name: "Cancel" });
    const cancelBox = await cancelButton.boundingBox();
    expect(cancelBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(cancelBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await cancelButton.click();
    await expect(dialog).toBeHidden();
    await expect(endRideButton).toBeFocused();

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
  });
});
