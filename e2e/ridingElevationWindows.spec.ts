import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts, which needs the same workaround for ORS mocking. This
// spec also needs it to reliably serve the local map style.
test.use({ serviceWorkers: "block" });

// A dedicated fixture, not a reuse of distanceBadges.spec.ts's own
// distance-badges-route.gpx: that fixture's ~1000 m point spacing exceeds
// gradient.ts's MAX_ELEVATION_GAP_METRES (500 m), so analyzeRouteElevation
// Profile drops every point as an unanalysable single-point "run" and the
// resulting displayPoints carry no elevation at all — ElevationChart then
// renders only its own "Elevation data is not available for this route."
// early-return state, with no chart/guides ever drawn. Confirmed directly
// by an initial real run of this spec against that fixture, which timed
// out waiting for guide text that could never appear. This fixture uses
// 200 m spacing (well under the 500 m threshold) and a flat 20 m
// elevation (avg gradient 0%, so no recognised climb ever forms — the
// route stays exactly Full/2 km/10 km with no conditional Climb button)
// across 25 km, long enough for both the 2 km and 10 km windows and a
// genuine route-end truncation.
const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/elevation-distance-guides-route.gpx", import.meta.url),
);
const FIXTURE_START_LON = -0.2;
const FIXTURE_LAT = 51.5;
const FIXTURE_METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const FIXTURE_TOTAL_METRES = 25000;

function lonAtMetresAlongFixture(distanceMetres: number): number {
  return FIXTURE_START_LON + distanceMetres / FIXTURE_METRES_PER_DEGREE_LON;
}

async function openRouteAndStartRiding(page: Page) {
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  const routeButton = page.getByRole("button", {
    name: "elevation-distance-guides-route",
    exact: true,
  });
  await expect(routeButton).toBeVisible();
  await routeButton.click();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
}

/** Active Riding now defaults to the Map view (backlog item 56) — the
 * elevation window group/chart/guides live in the Profile pane, which is
 * aria-hidden until this is called. */
async function switchToProfile(page: Page) {
  await page.getByRole("button", { name: "Profile" }).click();
}

function guideLabelLocator(page: Page) {
  return page.locator("text.elevation-chart-distance-guide-label");
}

// The global button:focus-visible outline (2px width + 2px offset = 4px)
// protrudes further than .is-selected's own 2px box-shadow ring, and
// Playwright's boundingBox() excludes both entirely — so the known
// worst-case ring spread must be added explicitly rather than merely
// checking the button's own border box sits inside the group, which would
// still pass while the ring itself is clipped (backlog item 76).
const RING_SPREAD_PX = 4;

async function expectSelectedButtonRingClearsGroupEdge(
  page: Page,
  edge: "left" | "right",
) {
  const group = page.getByRole("group", { name: "Elevation profile view" });
  const selectedButton = group.locator(".elevation-window-button.is-selected");
  const groupBox = await group.boundingBox();
  const selectedBox = await selectedButton.boundingBox();
  if (!groupBox || !selectedBox) {
    throw new Error(
      "expected both the elevation-window group and its selected button to have a bounding box",
    );
  }
  if (edge === "left") {
    expect(selectedBox.x - RING_SPREAD_PX).toBeGreaterThanOrEqual(groupBox.x);
  } else {
    expect(selectedBox.x + selectedBox.width + RING_SPREAD_PX).toBeLessThanOrEqual(
      groupBox.x + groupBox.width,
    );
  }
}

test("offers the reduced Full/2 km/10 km button set, with 2 km selected on a fresh ride", async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: FIXTURE_START_LON,
    accuracy: 5,
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await openRouteAndStartRiding(page);
  await switchToProfile(page);

  const group = page.getByRole("group", { name: "Elevation profile view" });
  await expect(group).toBeVisible();
  // No recognised climb exists on this flat fixture, so no conditional
  // Climb button is ever appended — exactly the three standard buttons.
  const labels = await group.getByRole("button").allTextContents();
  expect(labels).toEqual(["Full", "2 km", "10 km"]);

  await expect(page.getByRole("button", { name: "2 km" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(async () => guideLabelLocator(page).allTextContents(), { timeout: 15_000 })
    .toEqual(["1 km"]);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("the 10 km view shows all four 2/4/6/8 km guides at a mid-route position", async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: FIXTURE_START_LON,
    accuracy: 5,
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await openRouteAndStartRiding(page);
  await switchToProfile(page);

  // 10 km mark: comfortably mid-route, so a 10 km window (ending at
  // 20 km) is never route-end-truncated against this 25 km fixture.
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(10_000),
    accuracy: 5,
  });
  await expect
    .poll(async () => guideLabelLocator(page).allTextContents(), { timeout: 15_000 })
    .toEqual(["1 km"]);

  await page.getByRole("button", { name: "10 km" }).click();

  await expect
    .poll(async () => guideLabelLocator(page).allTextContents(), { timeout: 15_000 })
    .toEqual(["2 km", "4 km", "6 km", "8 km"]);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("guides are progressively omitted as the rider approaches the route finish (route-end truncation)", async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: FIXTURE_START_LON,
    accuracy: 5,
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await openRouteAndStartRiding(page);
  await switchToProfile(page);

  // 10,000 m with the 10 km window still comfortably inside the route
  // (10,000 + 10,000 = 20,000 <= 25,000 total) — all four guides present.
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(10_000),
    accuracy: 5,
  });
  await page.getByRole("button", { name: "10 km" }).click();
  await expect
    .poll(async () => guideLabelLocator(page).allTextContents(), { timeout: 15_000 })
    .toEqual(["2 km", "4 km", "6 km", "8 km"]);

  // 22,500 m leaves only 2,500 m of route — the window truncates to
  // [22500, 25000], so only the 2 km guide (at 24,500) still lands
  // inside it; 4/6/8 km would fall past the route's own end and are
  // correctly omitted rather than clamped or hidden by CSS.
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(FIXTURE_TOTAL_METRES - 2_500),
    accuracy: 5,
  });
  await expect
    .poll(async () => guideLabelLocator(page).allTextContents(), { timeout: 15_000 })
    .toEqual(["2 km"]);

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test.describe("phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no document overflow, horizontal or vertical, with the reduced button row and guide labels, and the selected button's ring clears both group edges (backlog item 76)", async ({
    page,
    context,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: FIXTURE_START_LON,
      accuracy: 5,
    });

    const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

    await page.goto("/");
    await openRouteAndStartRiding(page);
    await switchToProfile(page);

    // Full is the leftmost button (2 km is selected by default per item
    // 54) — select it explicitly to prove the left-edge clearance the
    // field bug was actually observed on.
    await page.getByRole("button", { name: "Full" }).click();
    await expect(page.getByRole("button", { name: "Full" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expectSelectedButtonRingClearsGroupEdge(page, "left");

    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(10_000),
      accuracy: 5,
    });
    await page.getByRole("button", { name: "10 km" }).click();
    await expect
      .poll(async () => guideLabelLocator(page).allTextContents(), { timeout: 15_000 })
      .toEqual(["2 km", "4 km", "6 km", "8 km"]);

    // 10 km is the rightmost of the three standard buttons — proves the
    // symmetric right-edge contract the backlog also requires.
    await expectSelectedButtonRingClearsGroupEdge(page, "right");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);

    // The reserved label gutter (backlog item 70) must not push the fixed
    // Riding shell into needing its own internal scroll at ordinary text
    // size — this is the worst case already on screen: the 10 km view
    // with all four guides showing.
    const profilePaneOverflow = await page.evaluate(() => {
      const pane = document.querySelector(".ride-profile-pane--immersive");
      if (!pane) return null;
      return pane.scrollHeight - pane.clientHeight;
    });
    expect(profilePaneOverflow).not.toBeNull();
    expect(profilePaneOverflow).toBeLessThanOrEqual(0);

    expect(unexpectedOpenFreeMapRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
