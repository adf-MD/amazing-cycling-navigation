import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Proves backlog item 75 (compact active-Riding status and recovery
// presentation): the merged status card's geolocation-error row and
// compact offline indicator behave correctly, individually and together,
// in both route Riding and free roam — a scenario no earlier spec drove
// end to end in a real browser (existing coverage was either Vitest-only
// or map-imagery-specific, see mapImageryRecovery.spec.ts).
//
// context.clearPermissions() reliably fires a genuine PERMISSION_DENIED
// error on an already-active navigator.geolocation.watchPosition
// subscription in headless Chromium (confirmed empirically while writing
// this spec) — this is the real production error path, not a synthetic
// stand-in, and re-granting permission before "Try again" recovers a
// fresh live fix exactly as a rider re-allowing location access would.

test.use({ serviceWorkers: "block" });

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);
const ROUTE_START = { latitude: 51.5, longitude: -0.1 };

async function importAndStartRiding(page: Page): Promise<void> {
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  const routeButton = page.getByRole("button", { name: "smoke-route", exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
}

async function startFreeRoam(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await page.getByRole("button", { name: "Start free roam" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
}

test.describe("route Riding", () => {
  test("a geolocation error with a retained stale fix shows a compact urgent row, and Try again recovers a fresh live fix", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });
    await installLocalMapStyle(page);

    await page.goto("/");
    await importAndStartRiding(page);
    await expect(page.getByText(/On route|Possibly off route|Off route/)).toBeVisible();

    const card = page.locator(".ride-status-card");
    await expect(card).toContainText("GPS ±5 m");

    await context.clearPermissions();
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText(/location permission was denied/i);

    // The retained fix/status stay visible and become stale, rather than
    // being discarded when the error arrives.
    await expect(card).toContainText(/On route|Possibly off route|Off route/);
    await expect(card).toContainText("Stale");
    const retryButton = alert.getByRole("button", { name: "Try again" });
    const retryBox = await retryButton.boundingBox();
    expect(retryBox).not.toBeNull();
    if (retryBox) {
      expect(retryBox.width).toBeGreaterThanOrEqual(44);
      expect(retryBox.height).toBeGreaterThanOrEqual(44);
    }

    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: ROUTE_START.latitude,
      longitude: ROUTE_START.longitude + 0.00003,
      accuracy: 5,
    });
    await retryButton.click();

    await expect(alert).toHaveCount(0, { timeout: 10_000 });
    await expect(card).toContainText("Live");
  });

  test("a geolocation error before any fix shows a useful, non-empty card and stays retryable", async ({
    page,
  }) => {
    await installLocalMapStyle(page);

    await page.goto("/");
    await importAndStartRiding(page);

    const card = page.locator(".ride-status-card");
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("GPS error");
    await expect(card).toContainText("Try again");
    // Never an empty card: no remaining-distance/GPS rows exist yet, but
    // the top-row label and the error row are always present.
    await expect(card).not.toContainText(/km ·/);
  });

  test("simultaneous offline and a geolocation error leave a useful map region visible with essential controls reachable", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });
    await installLocalMapStyle(page);

    await page.goto("/");
    await importAndStartRiding(page);
    await expect(page.getByText(/On route|Possibly off route|Off route/)).toBeVisible();

    await context.setOffline(true);
    await context.clearPermissions();
    try {
      const card = page.locator(".ride-status-card");
      await expect(card).toContainText("Offline");
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });

      // Item 82 follow-up: the error and offline rows sit full-width below
      // the card's two-column main region, not squeezed into its narrow
      // left or right column.
      const cardBox = await card.boundingBox();
      const errorRowBox = await page.getByRole("alert").boundingBox();
      const offlineBox = await page.getByText("Offline").boundingBox();
      if (!cardBox || !errorRowBox || !offlineBox) {
        throw new Error("expected the card, error row and offline row to have a box");
      }
      expect(errorRowBox.x - cardBox.x).toBeLessThanOrEqual(20);
      expect(errorRowBox.width).toBeGreaterThanOrEqual(cardBox.width * 0.7);
      expect(offlineBox.x - cardBox.x).toBeLessThanOrEqual(20);
      expect(offlineBox.width).toBeGreaterThanOrEqual(cardBox.width * 0.7);

      const mapContainer = page.locator('[data-testid="map-container"]');
      const mapBox = await mapContainer.boundingBox();
      const viewport = page.viewportSize();
      if (!mapBox || !viewport) {
        throw new Error("expected the map container and viewport to have a size");
      }
      // The stacked status rows must not consume most of the screen: the
      // map still gets a genuinely useful share of the viewport height.
      expect(mapBox.height).toBeGreaterThan(viewport.height * 0.4);

      // Zoom/camera controls are pre-existing, deliberately unmounted while
      // geolocationStatus is "error" (unrelated to this slice — they
      // depend on an active GPS-follow watch to mean anything). The
      // Map/Profile switcher, elevation controls and attribution have no
      // such dependency and must stay reachable regardless.
      const switcher = page.getByRole("group", { name: "Riding view" });
      await expect(switcher).toBeVisible();
      await page.getByRole("button", { name: "Profile", exact: true }).click();
      await expect(
        page.getByRole("group", { name: "Elevation profile view" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Map", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Map", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("map-attribution")).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test.describe("layout robustness under the simultaneous-failure state", () => {
    test("390x844 portrait: no horizontal document scrolling", async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await context.grantPermissions(["geolocation"]);
      await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });
      await installLocalMapStyle(page);

      await page.goto("/");
      await importAndStartRiding(page);
      await expect(page.getByText(/On route|Possibly off route|Off route/)).toBeVisible();

      await context.setOffline(true);
      await context.clearPermissions();
      try {
        await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
        await expect(page.locator(".ride-status-card")).toContainText("Offline");
        const scrollWidth = await page.evaluate(
          () => document.documentElement.scrollWidth,
        );
        expect(scrollWidth).toBeLessThanOrEqual(390 + 1);
      } finally {
        await context.setOffline(false);
      }
    });

    test("844x390 short landscape: no horizontal document scrolling and the map floor still holds", async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await context.grantPermissions(["geolocation"]);
      await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });
      await installLocalMapStyle(page);

      await page.goto("/");
      await importAndStartRiding(page);
      await expect(page.getByText(/On route|Possibly off route|Off route/)).toBeVisible();

      await context.setOffline(true);
      await context.clearPermissions();
      try {
        await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
        await expect(page.locator(".ride-status-card")).toContainText("Offline");
        const scrollWidth = await page.evaluate(
          () => document.documentElement.scrollWidth,
        );
        expect(scrollWidth).toBeLessThanOrEqual(844 + 1);

        const mapContainer = page.locator('[data-testid="map-container"]');
        const mapBox = await mapContainer.boundingBox();
        expect(mapBox).not.toBeNull();
        if (mapBox) expect(mapBox.height).toBeGreaterThanOrEqual(160);
      } finally {
        await context.setOffline(false);
      }
    });

    test("enlarged text (200%): no horizontal document scrolling and controls stay reachable", async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await context.grantPermissions(["geolocation"]);
      await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });
      await installLocalMapStyle(page);

      await page.goto("/");
      await importAndStartRiding(page);
      await expect(page.getByText(/On route|Possibly off route|Off route/)).toBeVisible();

      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });

      await context.setOffline(true);
      await context.clearPermissions();
      try {
        await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
        await expect(page.locator(".ride-status-card")).toContainText("Offline");
        const scrollWidth = await page.evaluate(
          () => document.documentElement.scrollWidth,
        );
        expect(scrollWidth).toBeLessThanOrEqual(390 + 1);

        const retryButton = page
          .getByRole("alert")
          .getByRole("button", { name: "Try again" });
        await expect(retryButton).toBeVisible();
        const retryBox = await retryButton.boundingBox();
        expect(retryBox).not.toBeNull();
        if (retryBox) {
          expect(retryBox.width).toBeGreaterThanOrEqual(44);
          expect(retryBox.height).toBeGreaterThanOrEqual(44);
        }
      } finally {
        await context.setOffline(false);
      }
    });
  });
});

test.describe("free roam", () => {
  test("a geolocation error with a retained stale fix shows a compact urgent row, and Try again recovers a fresh live fix", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });
    await installLocalMapStyle(page);

    await page.goto("/");
    await startFreeRoam(page);

    const card = page.locator(".ride-status-card");
    await expect(card).toContainText("GPS ±");

    await context.clearPermissions();
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText(/location permission was denied/i);
    await expect(card).toContainText("Stale");

    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: ROUTE_START.latitude,
      longitude: ROUTE_START.longitude + 0.00003,
      accuracy: 5,
    });
    await alert.getByRole("button", { name: "Try again" }).click();

    await expect(alert).toHaveCount(0, { timeout: 10_000 });
    await expect(card).toContainText("Live");
  });

  test("a geolocation error before any fix shows a useful, non-empty card", async ({
    page,
  }) => {
    await installLocalMapStyle(page);

    await page.goto("/");
    await startFreeRoam(page);

    const card = page.locator(".ride-status-card");
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("GPS error");
    await expect(card).toContainText("Try again");
    await expect(card).not.toContainText(/GPS ±/);
  });

  test("simultaneous offline and a geolocation error leave a useful map region visible with essential controls reachable", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ ...ROUTE_START, accuracy: 5 });
    await installLocalMapStyle(page);

    await page.goto("/");
    await startFreeRoam(page);
    await expect(page.locator(".ride-status-card")).toContainText("GPS ±");

    await context.setOffline(true);
    await context.clearPermissions();
    try {
      const card = page.locator(".ride-status-card");
      await expect(card).toContainText("Offline");
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });

      // Item 82 follow-up: the error and offline rows sit full-width below
      // the card's two-column main region, not squeezed into its narrow
      // left or right column.
      const cardBox = await card.boundingBox();
      const errorRowBox = await page.getByRole("alert").boundingBox();
      const offlineBox = await page.getByText("Offline").boundingBox();
      if (!cardBox || !errorRowBox || !offlineBox) {
        throw new Error("expected the card, error row and offline row to have a box");
      }
      expect(errorRowBox.x - cardBox.x).toBeLessThanOrEqual(20);
      expect(errorRowBox.width).toBeGreaterThanOrEqual(cardBox.width * 0.7);
      expect(offlineBox.x - cardBox.x).toBeLessThanOrEqual(20);
      expect(offlineBox.width).toBeGreaterThanOrEqual(cardBox.width * 0.7);

      const mapContainer = page.locator('[data-testid="map-container"]');
      const mapBox = await mapContainer.boundingBox();
      const viewport = page.viewportSize();
      if (!mapBox || !viewport) {
        throw new Error("expected the map container and viewport to have a size");
      }
      expect(mapBox.height).toBeGreaterThan(viewport.height * 0.4);

      // Zoom/camera controls are pre-existing, deliberately unmounted
      // while geolocationStatus is "error" (unrelated to this slice) —
      // attribution has no such dependency and must stay reachable.
      await expect(page.getByTestId("map-attribution")).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
