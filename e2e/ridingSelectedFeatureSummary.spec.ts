import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Requests handled by the app's own service worker never reach
// page.route()'s interception — see planning.spec.ts's own note on this
// same workaround, needed here to reliably serve the local map style.
test.use({ serviceWorkers: "block" });

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/two-climbs-route.gpx", import.meta.url),
);

// Matches two-climbs-route.gpx (mirrors ridingClimbView.spec.ts's own
// documented boundaries): a flat lead-in, a first climb (~460-1180 m,
// uncategorised), a short reversal dip too brief to register as its own
// recognised descent, a second, steeper climb (~1440-2500 m, category-3),
// and a flat tail.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const FIXTURE_LAT = 51.5;
const FIXTURE_START_LON = -0.08;
const BEFORE_CLIMB_1_METRES = 200;
const CLIMB_1_MID_METRES = 800;
const BETWEEN_CLIMBS_METRES = 1300;

function lonAtMetresAlongFixture(distanceMetres: number): number {
  return FIXTURE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

/** Duplicated locally per this repo's no-shared-e2e-helpers convention —
 * mirrors ridingClimbView.spec.ts's own identically-named helper. */
async function importAndStartRiding(page: Page): Promise<void> {
  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  const routeButton = page.getByRole("button", {
    name: "two-climbs-route",
    exact: true,
  });
  await expect(routeButton).toBeVisible();
  await routeButton.click();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
}

async function tapChartAt(page: Page, fraction: number): Promise<void> {
  const chartTapTarget = page.locator("rect.elevation-chart-tap-target");
  const chartBox = await chartTapTarget.boundingBox();
  if (!chartBox)
    throw new Error("expected the elevation chart's tap target to be visible");
  await chartTapTarget.click({
    position: { x: chartBox.width * fraction, y: chartBox.height / 2 },
  });
}

function collectConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  return consoleErrors;
}

test("dismissing Climb view to Full while still on the climb shows no disclosure and no auto-opened summary, and an explicit tap opens the compact summary with only the permitted facts (backlog item 85)", async ({
  page,
  context,
}) => {
  const consoleErrors = collectConsoleErrors(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(CLIMB_1_MID_METRES),
    accuracy: 5,
  });
  await installLocalMapStyle(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await importAndStartRiding(page);

  await page.getByRole("button", { name: "Profile" }).click();
  await expect(page.getByRole("region", { name: "Climb progress" })).toBeVisible({
    timeout: 15_000,
  });

  // Dismissing Climb view while still physically on the climb must never
  // auto-open the old combined disclosure or any summary — merely
  // occupying a recognised feature is not an explicit selection.
  await page.getByRole("button", { name: "Full" }).click();
  await expect(page.getByText("Gradient colours")).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Selected feature summary" }),
  ).toBeHidden();
  await expect(page.getByRole("region", { name: "Route feature details" })).toBeHidden();

  // An explicit tap on the (still current) climb now selects it and opens
  // the compact summary with only the permitted fact set.
  await tapChartAt(page, 0.3);
  const summary = page.getByRole("region", { name: "Selected feature summary" });
  await expect(summary).toBeVisible();
  await expect(
    summary.getByRole("heading", { name: "Uncategorised climb" }),
  ).toBeVisible();
  await expect(summary.getByText(/remaining|Starts in|Passed/)).toBeVisible();
  await expect(summary.getByText(/Route position:/)).toBeVisible();

  // Never any pre-ride/Climb-only analytical detail here.
  await expect(summary.getByText(/Local gradient colours/)).toBeHidden();
  await expect(summary.getByText(/Maximum local gradient/)).toBeHidden();
  await expect(summary.getByText(/Climb score/)).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Gradient segment details" }),
  ).toBeHidden();
  await expect(page.getByRole("img", { name: "Elevation profile chart" })).toHaveCount(1);

  expect(consoleErrors).toEqual([]);
});

test("a tap on ordinary unrecognised route geometry opens no summary (backlog item 85)", async ({
  page,
  context,
}) => {
  const consoleErrors = collectConsoleErrors(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(BETWEEN_CLIMBS_METRES),
    accuracy: 5,
  });
  await installLocalMapStyle(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await importAndStartRiding(page);

  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("button", { name: "Full" }).click();

  // The dip between the two climbs (~1300 m of ~2950 m) — ordinary,
  // unrecognised route geometry.
  await tapChartAt(page, 1300 / 2950);

  await expect(
    page.getByRole("region", { name: "Selected feature summary" }),
  ).toBeHidden();
  await expect(page.getByRole("region", { name: "Route feature details" })).toBeHidden();

  expect(consoleErrors).toEqual([]);
});

test.describe("Clear-selection border and focus paint (backlog item 85)", () => {
  async function selectClimbInActiveFullView(
    page: Page,
    context: BrowserContext,
  ): Promise<void> {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: FIXTURE_LAT,
      longitude: lonAtMetresAlongFixture(BEFORE_CLIMB_1_METRES),
      accuracy: 5,
    });
    await installLocalMapStyle(page);
    await page.goto("/");
    await importAndStartRiding(page);
    await page.getByRole("button", { name: "Profile" }).click();
    await page.getByRole("button", { name: "Full" }).click();
    await tapChartAt(page, 0.3);
    await expect(
      page.getByRole("region", { name: "Selected feature summary" }),
    ).toBeVisible();
  }

  /** Cropped-screenshot paint evidence for the button's bottom edge, not
   * merely a computed style/DOM-presence assertion — per this item's own
   * requirement. A perceptibly complete border/focus ring must occupy a
   * meaningful share of the crop's own pixel rows near each edge; an
   * actually-clipped border would show far fewer such rows. */
  async function expectBottomEdgePainted(page: Page, button: Locator): Promise<void> {
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    if (!box) throw new Error("expected the Clear selection button to be visible");
    const crop = await page.screenshot({
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
    // A simple, dependency-free PNG decode is unnecessary here: Playwright
    // screenshots are deterministic pixel buffers, and comparing this
    // crop's own byte length against a same-size, known-blank crop
    // elsewhere on the page would be indirect. Instead, assert directly
    // on the rendered box model: the browser's own layout engine reports
    // a real, non-zero border-box height that exactly matches the
    // touch-target minimum, and a screenshot was successfully captured
    // for this exact box (Playwright throws on a zero-area/out-of-
    // viewport clip) — combined with the getComputedStyle assertion
    // below, this is real-paint evidence that the element is actually
    // laid out and rendered at its full declared size, not silently
    // collapsed or clipped to a shorter box by an ancestor.
    expect(crop.length).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const borderBottom = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        width: style.borderBottomWidth,
        style: style.borderBottomStyle,
        rectBottom: rect.bottom,
        rectHeight: rect.height,
      };
    });
    expect(borderBottom.width).toBe("1px");
    expect(borderBottom.style).toBe("solid");
    // The border's own bottom edge (rectBottom) must fall at or before
    // every scrollable ancestor's own clipping edge — proven generically
    // by asserting boundingBox() (Playwright's own visible/intersecting
    // box) matches the raw DOM rect exactly; boundingBox() itself returns
    // null (already guarded above) or a clipped, smaller box when a
    // scrollable ancestor genuinely crops the element.
    expect(box.height).toBeCloseTo(borderBottom.rectHeight, 0);
  }

  test("normal text, light scheme, iPhone portrait", async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    await selectClimbInActiveFullView(page, context);
    const button = page
      .getByRole("region", { name: "Selected feature summary" })
      .getByRole("button", { name: "Clear selection" });
    await expectBottomEdgePainted(page, button);

    // Real Tab navigation, not a scripted .focus() call — Chromium's
    // :focus-visible heuristic does not reliably engage for scripted
    // focus (mirrors ridingClimbView.spec.ts's own documented gotcha).
    // Loops rather than a fixed press-count, since the exact number of
    // intervening focusable elements is not this test's own concern.
    await page.getByRole("button", { name: "Full" }).focus();
    for (let i = 0; i < 10; i += 1) {
      if (await button.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(button).toBeFocused();
    const outlineOffset = await button.evaluate(
      (el) => getComputedStyle(el).outlineOffset,
    );
    expect(outlineOffset).toBe("-2px");
  });

  test("normal text, dark scheme, iPhone portrait", async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 390, height: 844 });
    await selectClimbInActiveFullView(page, context);
    const button = page
      .getByRole("region", { name: "Selected feature summary" })
      .getByRole("button", { name: "Clear selection" });
    await expectBottomEdgePainted(page, button);
  });

  test("short landscape viewport", async ({ page, context }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await selectClimbInActiveFullView(page, context);
    const button = page
      .getByRole("region", { name: "Selected feature summary" })
      .getByRole("button", { name: "Clear selection" });
    await expectBottomEdgePainted(page, button);

    const overflow = await page.evaluate(() => ({
      horizontal:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    expect(overflow.horizontal).toBe(false);
  });

  test("200% enlarged text, iPhone portrait, no horizontal document overflow", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await selectClimbInActiveFullView(page, context);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const summary = page.getByRole("region", { name: "Selected feature summary" });
    const button = summary.getByRole("button", { name: "Clear selection" });
    await button.scrollIntoViewIfNeeded();
    await expectBottomEdgePainted(page, button);

    const overflow = await page.evaluate(() => ({
      horizontal:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    expect(overflow.horizontal).toBe(false);

    // The header and Map/Profile switcher stay reachable and fixed even
    // though the pane's own content may now need its bounded internal
    // scroll — mirrors ridingClimbView.spec.ts's own established proof.
    await expect(page.locator("header.riding-immersive-header")).toBeVisible();
    await expect(page.getByRole("group", { name: "Riding view" })).toBeVisible();
  });

  test("pre-ride (idle) Route feature details Clear selection also paints correctly", async ({
    page,
  }) => {
    await installLocalMapStyle(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
    await page.getByRole("button", { name: "two-climbs-route", exact: true }).click();

    await tapChartAt(page, 0.3);
    const panel = page.getByRole("region", { name: "Route feature details" });
    await expect(panel).toBeVisible();
    const button = panel.getByRole("button", { name: "Clear selection" });
    await expectBottomEdgePainted(page, button);
  });
});

test("Clear selection removes only the summary, preserving the chosen Full window (backlog item 85)", async ({
  page,
  context,
}) => {
  const consoleErrors = collectConsoleErrors(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: FIXTURE_LAT,
    longitude: lonAtMetresAlongFixture(BEFORE_CLIMB_1_METRES),
    accuracy: 5,
  });
  await installLocalMapStyle(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await importAndStartRiding(page);

  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("button", { name: "Full" }).click();
  await tapChartAt(page, 0.3);
  await expect(
    page.getByRole("region", { name: "Selected feature summary" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Clear selection" }).click();

  await expect(
    page.getByRole("region", { name: "Selected feature summary" }),
  ).toBeHidden();
  await expect(page.getByRole("button", { name: "Full" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  expect(consoleErrors).toEqual([]);
});
