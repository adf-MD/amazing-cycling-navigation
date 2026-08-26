import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { inflateSync as zlibInflateSync } from "node:zlib";
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

  /** Minimal, dependency-free PNG decoder for 8-bit, non-interlaced RGB
   * (colour type 2) or RGBA (colour type 6) — the two formats a Playwright
   * screenshot buffer actually uses (verified empirically: an opaque page
   * crop decodes as colour type 2). Built and validated during backlog item
   * 85's real-iPhone-screenshot follow-up, against both a Chromium
   * screenshot and the real device PNG that motivated this fix. */
  function decodePng(buf: Buffer): {
    width: number;
    height: number;
    pixels: Buffer;
    bytesPerPixel: number;
  } {
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatChunks: Buffer[] = [];
    while (offset < buf.length) {
      const len = buf.readUInt32BE(offset);
      const type = buf.toString("ascii", offset + 4, offset + 8);
      const data = buf.subarray(offset + 8, offset + 8 + len);
      if (type === "IHDR") {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data.readUInt8(8);
        colorType = data.readUInt8(9);
      } else if (type === "IDAT") {
        idatChunks.push(data);
      } else if (type === "IEND") {
        break;
      }
      offset += 12 + len;
    }
    if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
      throw new Error(
        `unsupported PNG format bitDepth=${String(bitDepth)} colorType=${String(colorType)}`,
      );
    }
    const raw = zlibInflateSync(Buffer.concat(idatChunks));
    const bytesPerPixel = colorType === 6 ? 4 : 3;
    const stride = width * bytesPerPixel;
    const pixels = Buffer.alloc(height * stride);
    let rawOffset = 0;
    for (let y = 0; y < height; y += 1) {
      const filterType = raw[rawOffset];
      rawOffset += 1;
      const rowStart = y * stride;
      const prevRowStart = (y - 1) * stride;
      for (let x = 0; x < stride; x += 1) {
        const rawByte = raw[rawOffset + x];
        const a = x >= bytesPerPixel ? pixels[rowStart + x - bytesPerPixel] : 0;
        const b = y > 0 ? pixels[prevRowStart + x] : 0;
        const c =
          y > 0 && x >= bytesPerPixel ? pixels[prevRowStart + x - bytesPerPixel] : 0;
        let value: number;
        switch (filterType) {
          case 0:
            value = rawByte;
            break;
          case 1:
            value = (rawByte + a) & 0xff;
            break;
          case 2:
            value = (rawByte + b) & 0xff;
            break;
          case 3:
            value = (rawByte + Math.floor((a + b) / 2)) & 0xff;
            break;
          case 4: {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            value = (rawByte + predictor) & 0xff;
            break;
          }
          default:
            throw new Error(`unsupported filter type ${String(filterType)}`);
        }
        pixels[rowStart + x] = value;
      }
      rawOffset += stride;
    }
    return { width, height, pixels, bytesPerPixel };
  }

  function pixelAt(
    img: { width: number; pixels: Buffer; bytesPerPixel: number },
    x: number,
    y: number,
  ): [number, number, number] {
    const idx = y * img.width * img.bytesPerPixel + x * img.bytesPerPixel;
    return [img.pixels[idx], img.pixels[idx + 1], img.pixels[idx + 2]];
  }

  function colourClose(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    tolerance: number,
  ): boolean {
    return (
      Math.abs(a[0] - b[0]) <= tolerance &&
      Math.abs(a[1] - b[1]) <= tolerance &&
      Math.abs(a[2] - b[2]) <= tolerance
    );
  }

  function parseRgb(cssColour: string): [number, number, number] {
    const match = /rgba?\(([^)]+)\)/.exec(cssColour);
    if (!match) throw new Error(`expected an rgb()/rgba() colour, got: ${cssColour}`);
    const parts = match[1].split(",").map((part) => parseFloat(part.trim()));
    return [parts[0], parts[1], parts[2]];
  }

  /** The colour this button's visible edge is actually painted with,
   * regardless of which CSS mechanism paints it: a plain `border-color`
   * when opaque, or — since the item-85 follow-up fix — the colour
   * carried by an inset `box-shadow` once `border-color` is made
   * transparent. Reading it this way (rather than assuming border-color)
   * keeps this comparison correct across that change. */
  async function resolveVisibleEdgeColour(
    button: Locator,
  ): Promise<[number, number, number]> {
    const colourString = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      const borderColor = style.borderColor;
      const isTransparent =
        borderColor === "transparent" ||
        /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(borderColor);
      if (!isTransparent) return borderColor;
      const match = /rgba?\([^)]+\)/.exec(style.boxShadow);
      if (!match) {
        throw new Error(
          `border-color is transparent but no box-shadow colour was found: ${style.boxShadow}`,
        );
      }
      return match[0];
    });
    return parseRgb(colourString);
  }

  /** Real-pixel paint evidence for the button's border, not merely a
   * computed-style/DOM-presence assertion. Crops exactly to the button's
   * own border box (no margin) so row 0 is the top border's own first
   * pixel row and the last row is the bottom border's own last pixel row
   * — counting from a margin would silently return zero both sides and
   * pass falsely. Samples a column at the crop's horizontal midpoint,
   * safely inside the straight central segment and clear of both rounded
   * corners (each corner is only a small fraction of the button's width),
   * and counts how many consecutive rows from the top, and separately
   * from the bottom, match the button's actual visible edge colour within
   * a small tolerance — the same method used to measure the real iPhone
   * screenshot that motivated this fix (docs/project/evidence/item-85/).
   * Chromium does not reproduce that screenshot's measured top/bottom
   * asymmetry either before or after this file's CSS change (confirmed
   * separately, off-repo, against both a Chromium screenshot and the real
   * device PNG) — a pass here is Chromium non-regression evidence only,
   * not proof the real-device defect is fixed. */
  async function expectBottomEdgePainted(page: Page, button: Locator): Promise<void> {
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    if (!box) throw new Error("expected the Clear selection button to be visible");
    expect(box.height).toBeGreaterThanOrEqual(44);

    const borderBottom = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        width: style.borderBottomWidth,
        style: style.borderBottomStyle,
        rectHeight: rect.height,
      };
    });
    expect(borderBottom.width).toBe("1px");
    expect(borderBottom.style).toBe("solid");
    // boundingBox() (Playwright's own visible/intersecting box) matching
    // the raw DOM rect height rules out a scrollable ancestor genuinely
    // clipping the element (it would otherwise return null or a shorter
    // box) — a different failure mode from the border-colour check below.
    expect(box.height).toBeCloseTo(borderBottom.rectHeight, 0);

    const crop = await page.screenshot({
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
    const img = decodePng(crop);
    const expected = await resolveVisibleEdgeColour(button);
    const sampleX = Math.floor(img.width / 2);
    const tolerance = 16;

    // boundingBox() reports fractional CSS coordinates that do not always
    // line up exactly with the screenshot's rasterised device-pixel rows
    // (confirmed empirically: a fractional box.y can shift the crop by one
    // row against where the border/ring actually paints) — so scan a
    // short, bounded distance inward from each edge to find the border's
    // own first matching row before counting its run. Counting from index
    // 0/height-1 directly would silently return zero on both sides
    // whenever that rounding shifts the crop, and pass falsely.
    const searchLimit = Math.min(6, Math.floor(img.height / 4));

    function findFirstMatch(fromTop: boolean): number | null {
      for (let step = 0; step <= searchLimit; step += 1) {
        const y = fromTop ? step : img.height - 1 - step;
        if (colourClose(pixelAt(img, sampleX, y), expected, tolerance)) return y;
      }
      return null;
    }

    function countRunFrom(startIndex: number, direction: 1 | -1): number {
      let count = 0;
      let y = startIndex;
      while (
        y >= 0 &&
        y < img.height &&
        colourClose(pixelAt(img, sampleX, y), expected, tolerance)
      ) {
        count += 1;
        y += direction;
      }
      return count;
    }

    const topStart = findFirstMatch(true);
    const bottomStart = findFirstMatch(false);
    expect(topStart).not.toBeNull();
    expect(bottomStart).not.toBeNull();
    const topRows = topStart === null ? 0 : countRunFrom(topStart, 1);
    const bottomRows = bottomStart === null ? 0 : countRunFrom(bottomStart, -1);
    expect(topRows).toBeGreaterThan(0);
    expect(bottomRows).toBe(topRows);
  }

  /** Proves *which* CSS mechanism paints the button's visible edge — a
   * pixel comparison alone cannot distinguish an opaque `border` from an
   * inset `box-shadow` painted at the same position. Written fail-first:
   * confirmed failing against the pre-fix tree (border-color was still
   * the opaque `--colour-border`, no box-shadow was present) for the
   * predicted reason, then confirmed passing once the CSS change landed.
   * Parses box-shadow's individual components rather than asserting the
   * full serialised string, since a browser's computed-style ordering of
   * an inset box-shadow's colour/offsets/spread is not guaranteed stable. */
  test("Clear selection paints its visible edge via an inset box-shadow, not border-color", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await selectClimbInActiveFullView(page, context);
    const button = page
      .getByRole("region", { name: "Selected feature summary" })
      .getByRole("button", { name: "Clear selection" });

    const style = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { borderColor: s.borderColor, boxShadow: s.boxShadow };
    });

    expect(
      style.borderColor === "transparent" ||
        /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(style.borderColor),
    ).toBe(true);

    expect(style.boxShadow).toMatch(/inset/);
    const colourMatch = /rgba?\([^)]+\)/.exec(style.boxShadow);
    expect(colourMatch).not.toBeNull();
    const lengths = style.boxShadow.match(/-?[\d.]+px/g) ?? [];
    expect(lengths).toEqual(["0px", "0px", "0px", "1px"]);
    const expectedColour = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--colour-border"),
    );
    // --colour-border is an author-authored hex/named literal (e.g.
    // "#767676"); resolve it to the same rgb() serialisation the browser
    // reports box-shadow's colour in, via a throwaway element, rather
    // than assuming a specific colour syntax here.
    const expectedRgb = await page.evaluate((hex) => {
      const probe = document.createElement("div");
      probe.style.color = hex;
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    }, expectedColour.trim());
    expect(colourMatch?.[0]).toBe(expectedRgb);
  });

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
