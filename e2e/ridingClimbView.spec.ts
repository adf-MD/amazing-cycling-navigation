import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception (a documented Playwright limitation) — see
// planning.spec.ts, which needs the same workaround for ORS mocking. This
// spec also needs it to reliably serve the local map style.
test.use({ serviceWorkers: "block" });

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/two-climbs-route.gpx", import.meta.url),
);

// Matches two-climbs-route.gpx: a flat lead-in, a first climb (~460-1180 m,
// uncategorised), a short reversal dip too brief to register as its own
// recognised descent, a second, steeper climb (~1440-2500 m, category-3),
// and a flat tail. Exact boundaries are smoothing-driven edge rounding
// (see gradientColouring.spec.ts's own comment on a similarly-shaped
// fixture) — verified directly against the app's real detectRouteFeatures
// output while building this fixture, not hand-estimated from the GPX's
// own keyframe distances.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const FIXTURE_LAT = 51.5;
const FIXTURE_START_LON = -0.08;
const BEFORE_CLIMB_1_METRES = 200;
const CLIMB_1_MID_METRES = 800;
const CLIMB_2_MID_METRES = 2000;

function lonAtMetresAlongFixture(distanceMetres: number): number {
  return FIXTURE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

/** Mirrors ridingMapProfileViews.spec.ts's own identically-named helpers —
 * duplicated locally per this repo's no-shared-e2e-helpers convention. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isFullyWithin(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Shared import → Start riding flow, reused by both the main flow test and
 * the phone-viewport geometry test below — mirrors
 * ridingMapProfileViews.spec.ts's own importAndStartRiding, duplicated
 * locally per this repo's no-shared-e2e-helpers convention. */
async function importAndStartRiding(page: Page): Promise<void> {
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  // The route library labels an imported route by its GPX filename (minus
  // extension), not the file's own <name> tag.
  const routeButton = page.getByRole("button", {
    name: "two-climbs-route",
    exact: true,
  });
  await expect(routeButton).toBeVisible();
  await routeButton.click();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
}

test("auto-selects Climb view on entering each recognised climb, respects a manual standard-view choice mid-climb, and shows no percentage", async ({
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
    longitude: lonAtMetresAlongFixture(BEFORE_CLIMB_1_METRES),
    accuracy: 5,
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await importAndStartRiding(page);

  // Active Riding defaults to the Map view (backlog item 56). Before
  // entering the first climb, neither the Profile-pane Climb button nor
  // the Map-pane climb cue (backlog item 57) is offered.
  await expect(page.getByRole("button", { name: "Map" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const viewClimbButton = page.getByRole("button", { name: "View climb" });
  await expect(viewClimbButton).toBeHidden();

  const mapContainer = page.locator('[data-testid="map-container"]');
  const boxBeforeClimb = await mapContainer.boundingBox();
  expect(boxBeforeClimb).not.toBeNull();

  // Enters the first recognised climb — the Map climb cue appears without
  // switching away from Map (backlog item 57's own "must never
  // automatically switch away from Map" requirement).
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES),
    accuracy: 5,
  });

  await expect(viewClimbButton).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Map" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Profile" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // The cue is a non-layout-affecting overlay — the map's own box is
  // unchanged by its appearance.
  const boxWithClimbCue = await mapContainer.boundingBox();
  expect(boxWithClimbCue).toEqual(boxBeforeClimb);

  // A single "View climb" activation switches to Profile with Climb
  // already selected, in one action.
  await viewClimbButton.click();
  await expect(page.getByRole("button", { name: "Profile" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const climbButton = page.getByRole("button", { name: "Climb" });
  await expect(climbButton).toHaveAttribute("aria-pressed", "true");

  const progressPanel = page.getByRole("region", { name: "Climb progress" });
  await expect(progressPanel).toBeVisible();
  await expect(progressPanel).toContainText("Climb 1");
  await expect(progressPanel).toContainText(/km completed/);
  await expect(progressPanel).toContainText(/km remaining/);
  // No percentage-complete value anywhere in the panel — the panel's only
  // legitimate "%" use is the current-gradient figure, e.g. "+6.0%".
  await expect(progressPanel.getByText(/\d+%\s*(complete|done)/i)).toHaveCount(0);
  await expect(progressPanel.getByRole("progressbar")).toHaveCount(0);

  // The current-position marker (vertical line + dot) is present.
  const chart = page.getByRole("img", { name: "Elevation profile chart" });
  await expect(chart.locator("line.elevation-chart-marker")).toBeAttached();
  await expect(chart.locator("circle.elevation-chart-marker-dot")).toBeAttached();

  // Multiple authoritative detailed gradient fill colours are present —
  // the smoothed local gradient varies across this climb's own range (see
  // the fixture comment above), so more than one fill colour is expected.
  const fillPaths = chart.locator("path.elevation-chart-area-fill");
  await expect(fillPaths.first()).toBeAttached();
  const fillColours = new Set(
    await fillPaths.evaluateAll((paths) =>
      paths.map((path) => path.getAttribute("fill")),
    ),
  );
  expect(fillColours.size).toBeGreaterThan(1);

  // Manually selecting a standard view dismisses Climb for the rest of
  // this climb — "10 km" is deliberately distinct from the app's own
  // default "2 km" view, so this action is unambiguously a genuine
  // manual selection, not a no-op against an already-selected default.
  await page.getByRole("button", { name: "10 km" }).click();
  await expect(climbButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "10 km" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The dismissal suppresses the Map cue too, immediately, for the rest of
  // this climb.
  await page.getByRole("button", { name: "Map" }).click();
  await expect(viewClimbButton).toBeHidden();

  // Advancing further within the same climb must not force Climb view (or
  // the Map cue) back open.
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES + 200),
    accuracy: 5,
  });
  await expect(viewClimbButton).toBeHidden();

  await page.getByRole("button", { name: "Profile" }).click();
  await expect(page.getByRole("button", { name: "10 km" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(climbButton).toHaveAttribute("aria-pressed", "false");

  // Entering the second, different climb auto-selects Climb view again,
  // even though the first climb was dismissed.
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(CLIMB_2_MID_METRES),
    accuracy: 5,
  });
  await expect(climbButton).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
  await expect(progressPanel).toContainText("Climb 2");

  // The Map cue is re-offered for this later, distinct climb too, and can
  // be opened normally.
  await page.getByRole("button", { name: "Map" }).click();
  await expect(viewClimbButton).toBeVisible({ timeout: 15_000 });
  await viewClimbButton.click();
  await expect(page.getByRole("button", { name: "Profile" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(climbButton).toHaveAttribute("aria-pressed", "true");
  await expect(progressPanel).toContainText("Climb 2");

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test.describe("390×844 phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the Map climb cue is a real touch target, stays within the map, and does not overlap the control clusters, attribution or switcher", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES),
      accuracy: 5,
    });

    await installLocalMapStyle(page);
    await page.goto("/");
    await importAndStartRiding(page);

    const cueButton = page.getByRole("button", { name: "View climb" });
    await expect(cueButton).toBeVisible({ timeout: 15_000 });

    const mapContainer = page.locator('[data-testid="map-container"]');
    const cue = page.locator(".ride-climb-cue");
    const zoomControls = page.locator(".ride-map-zoom-controls");
    const cameraControls = page.locator(".ride-map-camera-controls");
    const attribution = page.locator(".map-attribution");
    const switcher = page.getByRole("group", { name: "Riding view" });

    const [
      mapBox,
      cueBox,
      cueButtonBox,
      zoomBox,
      cameraBox,
      attributionBox,
      switcherBox,
    ] = await Promise.all([
      mapContainer.boundingBox(),
      cue.boundingBox(),
      cueButton.boundingBox(),
      zoomControls.boundingBox(),
      cameraControls.boundingBox(),
      attribution.boundingBox(),
      switcher.boundingBox(),
    ]);
    expect(mapBox).not.toBeNull();
    expect(cueBox).not.toBeNull();
    expect(cueButtonBox).not.toBeNull();
    expect(zoomBox).not.toBeNull();
    expect(cameraBox).not.toBeNull();
    expect(attributionBox).not.toBeNull();
    expect(switcherBox).not.toBeNull();
    if (
      !mapBox ||
      !cueBox ||
      !cueButtonBox ||
      !zoomBox ||
      !cameraBox ||
      !attributionBox ||
      !switcherBox
    ) {
      throw new Error("expected every located element to have a bounding box");
    }

    // A real ≥44×44 px touch target.
    expect(cueButtonBox.width).toBeGreaterThanOrEqual(44);
    expect(cueButtonBox.height).toBeGreaterThanOrEqual(44);

    // Fully within the map, and clear of every other overlay.
    expect(isFullyWithin(cueBox, mapBox)).toBe(true);
    expect(intersects(cueBox, zoomBox)).toBe(false);
    expect(intersects(cueBox, cameraBox)).toBe(false);
    expect(intersects(cueBox, attributionBox)).toBe(false);
    expect(intersects(cueBox, switcherBox)).toBe(false);

    // No document-level horizontal overflow.
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
