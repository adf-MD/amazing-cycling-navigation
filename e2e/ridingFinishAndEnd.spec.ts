import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow } from "./support/rideStateDb.ts";

const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
// Metres per degree of longitude at latitude 51.5 — the same conversion
// factor ridingNextManoeuvre.spec.ts's own fixture uses, reused here rather
// than re-derived.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 10;

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

test("ends a ride, returns to a clean pre-ride overview, and survives a reload with no restored progress", async ({
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
  await dialog.getByRole("button", { name: "End ride" }).click();

  // Same route, clean pre-ride overview.
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume riding" })).toBeHidden();
  await expect(page.getByRole("button", { name: "End ride" })).toBeHidden();

  // Deterministic replacement for a fixed sleep before reload — see
  // waitForClearedRideState's own doc comment for why polling for the
  // row's absence is race-free here.
  await waitForClearedRideState(page);
  await page.reload();

  await page.getByRole("button", { name: routeName, exact: true }).click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume riding" })).toBeHidden();

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
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
  await expect(page.getByText("On route")).toBeVisible();
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(420) });
  await expect(page.getByText("Route complete")).toBeHidden();

  // A single fix at the finish is not enough on its own.
  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: lonAtMetres(ROUTE_LENGTH_METRES),
  });
  await expect(page.getByText("Remaining: 0.0 km")).toBeVisible();
  await expect(page.getByText("Route complete")).toBeHidden();

  // A second consecutive fix at the finish confirms completion.
  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: lonAtMetres(ROUTE_LENGTH_METRES),
  });
  await expect(page.getByText("Route complete")).toBeVisible();

  // Nothing was cleared merely by showing the panel — the rider can still
  // navigate away and come back to a resumable ride (not asserted via
  // reload here to keep this test focused; End ride's own reload proof
  // covers that path).
  const finishButton = page.getByRole("button", { name: "Finish ride" });
  await expect(finishButton).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep riding" })).toBeVisible();

  await finishButton.click();

  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Resume riding" })).toBeHidden();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
