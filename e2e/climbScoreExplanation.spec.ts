import { expect, test, type Page } from "@playwright/test";
import { forceMapStyleFailure } from "./support/localMapStyle.ts";

// A dedicated GPX fixture with a single recognised climb (0-2000 m at a
// steady 8% grade) — deliberately not shared with gradientColouring.spec.ts's
// own climb-then-descent fixture, since this file only needs one climb to
// select and never inspects a descent. Coordinates are spaced by real
// geodesic distance so GPX-import's own distance computation classifies the
// climb consistently.
const FIXTURE_LAT = 51.5;
const STEP_METRES = 100;
const CLIMB_END_METRES = 2000;
const CLIMB_GRADE_PERCENT = 8;
const LON_PER_METRE = 1 / (111_320 * Math.cos((FIXTURE_LAT * Math.PI) / 180));

function lonAtMetres(distanceMetres: number): number {
  return distanceMetres * LON_PER_METRE;
}

function buildClimbRouteGpx(name: string): string {
  const pointCount = CLIMB_END_METRES / STEP_METRES + 1;
  const trkpts = Array.from({ length: pointCount }, (_, index) => {
    const distanceMetres = index * STEP_METRES;
    const elevationMetres = (distanceMetres * CLIMB_GRADE_PERCENT) / 100;
    return `      <trkpt lat="${String(FIXTURE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"><ele>${String(elevationMetres)}</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

async function importClimbRoute(page: Page, name = "climb-only-route"): Promise<void> {
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${name}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildClimbRouteGpx(name)),
  });
  const routeButton = page.getByRole("button", { name, exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
}

async function selectTheClimb(page: Page): Promise<void> {
  await page
    .getByRole("combobox", { name: "Recognised climbs" })
    .selectOption({ index: 1 });
  await expect(page.getByRole("region", { name: "Route feature details" })).toBeVisible();
  await expect(page.getByText(/Climb score:/)).toBeVisible();
}

test.describe("Settings climb-score explanation round trip (item 78)", () => {
  test("'How is this calculated?' opens and focuses the explanation, with accurate rendered thresholds", async ({
    page,
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

    await forceMapStyleFailure(page);
    await page.goto("/");
    await importClimbRoute(page);
    await selectTheClimb(page);

    await page.getByRole("button", { name: "How is this calculated?" }).click();

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    const details = page.locator("details", {
      has: page.getByText("How climbs are classified"),
    });
    await expect(details).toHaveAttribute("open", "");
    const focusedText = await page.evaluate(
      () => document.activeElement?.textContent ?? null,
    );
    expect(focusedText).toBe("How climbs are classified");

    // Accurate, authoritative thresholds — not a second hand-typed copy.
    await expect(page.getByText(/minimum score of 1,500/)).toBeVisible();
    await expect(page.getByText(/Uncategorised: below 8,000/)).toBeVisible();
    await expect(page.getByText(/Category 4: 8,000 to 15,999/)).toBeVisible();
    await expect(page.getByText(/Category 3: 16,000 to 31,999/)).toBeVisible();
    await expect(page.getByText(/Category 2: 32,000 to 63,999/)).toBeVisible();
    await expect(page.getByText(/Category 1: 64,000 to 79,999/)).toBeVisible();
    await expect(page.getByText(/HC: 80,000 or more/)).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test("returning via the Ride tab restores the same route and climb selection, and repeated activation works again", async ({
    page,
  }) => {
    await forceMapStyleFailure(page);
    await page.goto("/");
    await importClimbRoute(page);
    await selectTheClimb(page);
    const heading = page.getByRole("heading", { name: /^Climb 1 · / });
    const headingText = await heading.textContent();

    await page.getByRole("button", { name: "How is this calculated?" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    await page.getByRole("button", { name: "Ride" }).click();
    await expect(page.getByRole("heading", { name: "climb-only-route" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Recognised climbs" })).toHaveValue(
      "climb-0",
    );
    await expect(page.getByRole("heading", { name: headingText ?? "" })).toBeVisible();

    // Repeated activation: pressing the action again from this restored
    // state must open and focus the explanation a second time.
    await page.getByRole("button", { name: "How is this calculated?" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    const details = page.locator("details", {
      has: page.getByText("How climbs are classified"),
    });
    await expect(details).toHaveAttribute("open", "");
    const focusedText = await page.evaluate(
      () => document.activeElement?.textContent ?? null,
    );
    expect(focusedText).toBe("How climbs are classified");
  });

  // This app has no URL router or browser-history integration (a single
  // in-memory `screen` state drives every navigation) — a literal
  // browser/OS Back button therefore has no distinct code path here to
  // test. The in-app "Ride" tab return exercised above is the only
  // meaningful "return" path for this hand-off.

  test.describe("390x844 phone viewport, enlarged text", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    // Not an absolute "no overflow at all" claim: at a genuine 200% root
    // font size on a 390px viewport, this app's persistent primary
    // navigation (5 labelled tabs) and Settings' existing OpenRouteService
    // key-entry row already overflow slightly on their own, with or
    // without any of this item's content — confirmed directly, by
    // measuring the plain Routes screen and a plain Settings visit at the
    // same viewport/zoom with none of item 78's elements ever rendered.
    // That is a pre-existing condition outside this item's scope (no
    // climb/descent legend, score-help action or Settings panel involved)
    // and must not be fixed here. What this test proves instead is that
    // this item's own additions introduce no *further* overflow beyond
    // whatever the screen already has — the scrollWidth measured with the
    // new disclosure/panel content collapsed vs expanded must be equal.
    test("expanding the new local-gradient disclosure and Settings explanation adds no further horizontal overflow at 200% text", async ({
      page,
    }) => {
      await forceMapStyleFailure(page);
      await page.goto("/");
      await importClimbRoute(page);
      await selectTheClimb(page);

      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      const beforeExpand = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );

      await page.getByText("Gradient colours on this climb").click();
      await expect(page.locator(".gradient-legend-entry").first()).toBeVisible();
      const afterExpand = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(afterExpand).toBeLessThanOrEqual(beforeExpand);

      await page.getByRole("button", { name: "How is this calculated?" }).click();
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
      const details = page.locator("details", {
        has: page.getByText("How climbs are classified"),
      });
      await expect(details).toHaveAttribute("open", "");
      const withPanelOpen = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );

      // Collapse the now-auto-opened panel to measure this screen's own
      // baseline, then compare — the panel's own content must add nothing.
      await page.getByText("How climbs are classified").click();
      await expect(details).not.toHaveAttribute("open", "");
      const withPanelClosed = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(withPanelOpen).toBeLessThanOrEqual(withPanelClosed);
    });
  });
});
