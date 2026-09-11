import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readPlanningDraftRow } from "./support/rideStateDb.ts";

// Proves CLAUDE.md backlog item 109: Planning's "Add waypoint here"
// placement control keeps visual and pointer precedence over the numbered
// waypoint markers behind it, and keeps a clear isolation band around
// itself so a marker whose centre lands on its edge reads as being behind
// the control rather than attached to it.
//
// The defect this file guards against was real and reported from the
// installed iPhone: .planning-crosshair-callout was the only piece of
// Planning map chrome with no z-index of its own, so although it is
// already its own stacking context (position: absolute + transform) it sat
// at CSS 2.1 Appendix E's step 6 while .planning-waypoint-marker
// (z-index: 2) and .distance-badge-marker (z-index: 1) reach step 7 — and
// nothing between them establishes an intervening stacking context. See
// src/index.css for the full reasoning behind the chosen value of 3.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block" });

const ORS_URL_GLOB = "https://api.heigit.org/**";
const DUMMY_KEY = "dummy-e2e-key";
const PHONE_PORTRAIT = { width: 390, height: 844 } as const;
/** A deliberately conservative floor for the containment checks only. The
 * repository has never declared or acceptance-tested a portrait width
 * narrower than 390px (every phone-viewport describe in e2e/ uses
 * 390x844), so this is a guard against future regressions at a realistic
 * small phone width, NOT a new support commitment. */
const NARROW_PORTRAIT = { width: 320, height: 844 } as const;
const DRAFT_AUTOSAVE_DEBOUNCE_MS = 900;
/** .planning-crosshair-callout's isolation band, in CSS px — must stay in
 * step with index.css's `box-shadow: 0 0 0 var(--space-4)`. Read back from
 * the computed style in `readIsolationBandWidth` rather than trusted
 * blindly, so a stylesheet change cannot silently make these checks sample
 * the wrong region. */
const EXPECTED_ISOLATION_BAND_PX = 4;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** See planning.spec.ts's identical workaround: without this, the POST to
 * the (page.route-mocked) ORS endpoint intermittently never reaches
 * Playwright's request interception in this test environment. */
async function fixWindowFetch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalFetch = fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
  });
}

/** Mirrors reverseRoute.spec.ts's own helper (duplicated locally per this
 * project's established no-shared-e2e-helpers-across-specs convention).
 * Geolocation is granted so Planning's fresh-session regional framing
 * settles on a sane camera — without it a map click resolves to an
 * out-of-range longitude. No route is ever calculated in this file, so the
 * ORS mock only has to exist, not to return real geometry. */
async function preparePlanning(page: Page, context: BrowserContext): Promise<void> {
  await fixWindowFetch(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await installLocalMapStyle(page);
  await page.route(ORS_URL_GLOB, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: "{}",
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("OpenRouteService API key").fill(DUMMY_KEY);
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  // The one-time fresh-session regional framing has to settle before any
  // geometry here means anything — the placement control is disabled until
  // it does, so waiting for it to become enabled is the settle signal.
  await expect(page.getByRole("button", { name: "Add waypoint here" })).toBeEnabled({
    timeout: 15_000,
  });
}

function boxOrThrow(box: Rect | null, what: string): Rect {
  if (!box) throw new Error(`expected ${what} to lay out`);
  return box;
}

async function rectOf(locator: Locator, what: string): Promise<Rect> {
  return boxOrThrow(await locator.boundingBox(), what);
}

/** The control's whole painted footprint, border box plus its isolation
 * band — the region a rider actually perceives as "the control". */
function visualRect(border: Rect, bandPx: number): Rect {
  return {
    x: border.x - bandPx,
    y: border.y - bandPx,
    width: border.width + bandPx * 2,
    height: border.height + bandPx * 2,
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Reads the isolation band's real width out of the computed box-shadow
 * spread, so these tests sample the band the stylesheet actually paints.
 * Chromium serialises it as "rgb(r, g, b) 0px 0px 0px 4px". */
async function readIsolationBandWidth(callout: Locator): Promise<number> {
  const shadow = await callout.evaluate((el) => getComputedStyle(el).boxShadow);
  const lengths = [...shadow.matchAll(/(-?[\d.]+)px/g)].map((match) => Number(match[1]));
  // Index 3 is the spread radius. A missing entry reads back as undefined
  // at run time even though the element type says otherwise, and
  // Number.isFinite rejects it, so this one guard covers both a shadow
  // with too few lengths and a shadow with none at all.
  const spread = lengths[3];
  if (!Number.isFinite(spread)) {
    throw new Error(`could not read an isolation-band spread from "${shadow}"`);
  }
  return spread;
}

/** A plain left-button pan through MapLibre's own DragPanHandler — the
 * ordinary camera pipeline, never DragRotateHandler (whose stuck-gesture
 * failure mode this project has hit in CI before).
 *
 * The start point is derived from the live geometry rather than fixed
 * fractions, so the press can never land on the placement control itself
 * (which would swallow the gesture and silently make the fixture a no-op)
 * or on the top-corner control clusters. The pause before mouseup empties
 * MapLibre's ~160ms inertia window, so the camera lands exactly where the
 * drag left it instead of drifting on afterwards. */
async function panMapBy(page: Page, map: Locator, callout: Locator, dy: number) {
  const mapBox = await rectOf(map, "the map container");
  const calloutBox = await rectOf(callout, "the placement control");
  const startX = mapBox.x + mapBox.width / 2;
  const startY = Math.max(mapBox.y + 24, calloutBox.y - 24 - Math.max(dy, 0));
  const endY = startY + dy;
  if (endY < mapBox.y + 4 || endY > calloutBox.y - 4) {
    throw new Error(`a ${String(dy)}px pan cannot be started clear of the control`);
  }
  const centreBefore = await map.getAttribute("data-camera-center");
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, endY, { steps: 12 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect.poll(() => map.getAttribute("data-camera-center")).not.toBe(centreBefore);
  await expect(callout).toBeEnabled();
}

/** Pans the real camera until the given marker's centre sits on the
 * placement control's top border — the exact geometry the installed-iPhone
 * screenshot showed, reached entirely through the real map/camera/waypoint
 * pipeline. Nothing here is a coordinate copied from that screenshot:
 * every number is measured from the live layout at run time, so the
 * fixture follows the CSS rather than pinning it. */
async function driveMarkerOntoControlEdge(
  page: Page,
  map: Locator,
  marker: Locator,
  callout: Locator,
): Promise<{ marker: Rect; callout: Rect }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const markerBox = await rectOf(marker, "the waypoint marker");
    const calloutBox = await rectOf(callout, "the placement control");
    const residual = calloutBox.y - (markerBox.y + markerBox.height / 2);
    if (Math.abs(residual) <= 1) return { marker: markerBox, callout: calloutBox };
    await panMapBy(page, map, callout, residual);
  }
  const markerBox = await rectOf(marker, "the waypoint marker");
  const calloutBox = await rectOf(callout, "the placement control");
  expect(
    Math.abs(calloutBox.y - (markerBox.y + markerBox.height / 2)),
  ).toBeLessThanOrEqual(1);
  return { marker: markerBox, callout: calloutBox };
}

/** MapLibre's .maplibregl-marker rule sets will-change: transform, which
 * promotes every marker onto its own compositor layer — so a screenshot
 * taken the instant a camera settle is reported can still show the
 * previous frame. Two rendered frames is enough for the compositor to
 * catch up. Same reasoning, same fix, as distanceBadges.spec.ts's own
 * verifyBadgePaint. */
async function settleCompositor(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/** Screenshots one region twice — once with `subject` painted normally,
 * once with it hidden — and reports whether the composited pixels are
 * byte-for-byte identical. Playwright's PNG encoding of identical pixel
 * data is deterministic (verified directly: two consecutive captures of an
 * unchanged region are equal), so identical bytes mean the element
 * contributes nothing at all to that region, and differing bytes mean it
 * genuinely paints there. This is the whole proof, with no colour
 * constant involved; the absolute colour checks below back it up rather
 * than replace it. */
async function regionChangesWhenHidden(
  page: Page,
  subject: Locator,
  region: Rect,
): Promise<boolean> {
  await settleCompositor(page);
  const visible = await page.screenshot({ clip: region });
  const originalDisplay = await subject.evaluate((el) => el.style.display);
  let hidden: Buffer;
  try {
    await subject.evaluate((el) => {
      el.style.display = "none";
    });
    await settleCompositor(page);
    hidden = await page.screenshot({ clip: region });
  } finally {
    await subject.evaluate((el, original) => {
      el.style.display = original;
    }, originalDisplay);
  }
  await settleCompositor(page);
  return !visible.equals(hidden);
}

/** Fraction of pixels in `region` within `tolerance` of `expected`.
 * Decodes an already-composited Playwright PNG inside the page via a
 * throwaway 2D canvas — the established idiom in planning.spec.ts and
 * androidDistanceBadges.spec.ts. It never touches MapLibre's own WebGL
 * canvas, which under preserveDrawingBuffer: false would not reflect the
 * composited output at all. */
async function regionCoverage(
  page: Page,
  region: Rect,
  expected: string,
  tolerance = 20,
): Promise<number> {
  await settleCompositor(page);
  const png = await page.screenshot({ clip: region });
  return page.evaluate(
    async ({
      pngBase64,
      rgb,
      tol,
    }: {
      pngBase64: string;
      rgb: readonly [number, number, number];
      tol: number;
    }) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = `data:image/png;base64,${pngBase64}`;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("expected a 2D context");
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let matched = 0;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        total += 1;
        if (
          Math.abs(data[i] - rgb[0]) <= tol &&
          Math.abs(data[i + 1] - rgb[1]) <= tol &&
          Math.abs(data[i + 2] - rgb[2]) <= tol
        ) {
          matched += 1;
        }
      }
      return total === 0 ? 0 : matched / total;
    },
    { pngBase64: png.toString("base64"), rgb: parseRgb(expected), tol: tolerance },
  );
}

function parseRgb(colour: string): [number, number, number] {
  const parts = [...colour.matchAll(/[\d.]+/g)].map((match) => Number(match[0]));
  if (parts.length < 3) {
    throw new Error(`could not parse a colour from "${colour}"`);
  }
  const [r, g, b] = parts;
  return [r, g, b];
}

/** Walks both ancestor chains to their common ancestor and rejects any
 * intervening stacking context, so a z-index comparison between the two
 * elements is genuinely meaningful. Copied from distanceBadges.spec.ts's
 * identical item-84 helper. */
async function haveStackingSafeAncestry(
  page: Page,
  a: Locator,
  b: Locator,
): Promise<boolean> {
  const handleA = await a.elementHandle();
  const handleB = await b.elementHandle();
  if (!handleA || !handleB) {
    throw new Error("expected both elements to exist for an ancestry check");
  }
  return page.evaluate(
    ([elA, elB]) => {
      function establishesStackingContext(el: Element): boolean {
        const style = getComputedStyle(el);
        if (style.position !== "static" && style.zIndex !== "auto") return true;
        if (parseFloat(style.opacity) < 1) return true;
        if (style.transform !== "none") return true;
        if (style.filter !== "none") return true;
        if (style.isolation === "isolate") return true;
        if (style.mixBlendMode !== "normal") return true;
        if (
          style.willChange
            .split(",")
            .some((property) =>
              ["transform", "opacity", "filter"].includes(property.trim()),
            )
        ) {
          return true;
        }
        if (
          ["layout", "paint", "strict", "content"].some((keyword) =>
            style.contain.includes(keyword),
          )
        ) {
          return true;
        }
        return false;
      }
      function ancestorsOf(el: Element): Element[] {
        const chain: Element[] = [];
        let current = el.parentElement;
        while (current) {
          chain.push(current);
          current = current.parentElement;
        }
        return chain;
      }
      const ancestorsA = ancestorsOf(elA as Element);
      const ancestorsB = ancestorsOf(elB as Element);
      const common = ancestorsA.find((el) => ancestorsB.includes(el));
      if (!common)
        throw new Error("expected the two elements to share a common ancestor");
      const pathA = ancestorsA.slice(0, ancestorsA.indexOf(common));
      const pathB = ancestorsB.slice(0, ancestorsB.indexOf(common));
      return ![...pathA, ...pathB].some((el) => establishesStackingContext(el));
    },
    [handleA, handleB],
  );
}

async function zoomToBand(
  page: Page,
  map: Locator,
  direction: "in" | "out",
  target: "close" | "regional" | "overview",
): Promise<void> {
  const canvas = map.locator("canvas");
  await canvas.focus();
  for (let attempt = 0; attempt < 18; attempt += 1) {
    if ((await map.getAttribute("data-marker-zoom-band")) === target) return;
    const zoomBefore = await map.getAttribute("data-camera-zoom");
    await page.keyboard.press(direction === "in" ? "Shift+=" : "Shift+-");
    await expect
      .poll(() => map.getAttribute("data-camera-zoom"), { timeout: 2_000 })
      .not.toBe(zoomBefore);
  }
  await expect(map).toHaveAttribute("data-marker-zoom-band", target);
}

async function readWaypointCoordinates(page: Page): Promise<readonly number[][]> {
  const draft = await readPlanningDraftRow(page);
  const waypoints = (draft?.waypoints ?? []) as { coordinate: number[] }[];
  return waypoints.map((waypoint) => waypoint.coordinate);
}

/** Three waypoints placed at three distinct camera centres, so waypoint 2
 * is an ORDINARY numbered marker (not the start or finish role, whose
 * colours differ) — the same kind of marker the field screenshot showed
 * sitting on the control.
 *
 * The close zoom band is established BEFORE any of them is placed, not
 * after: a fresh Planning session frames an approximately 50x50km box, so
 * three waypoints separated by 40 screen px there end up thousands of px
 * apart once the camera zooms in to the close band (confirmed directly —
 * the first draft of this fixture produced a 10330px residual). Placing
 * them at the zoom the fixture actually uses keeps the separation exactly
 * 40px. Zooming back OUT afterwards only ever brings them closer
 * together, which the zoom-band test relies on being harmless. */
async function buildCollisionFixture(page: Page, context: BrowserContext) {
  await preparePlanning(page, context);
  const map = page.locator('[data-testid="map-container"]');
  const callout = page.locator(".planning-crosshair-callout");
  await zoomToBand(page, map, "in", "close");
  await expect(callout).toBeEnabled();
  for (let index = 0; index < 3; index += 1) {
    await expect(callout).toBeEnabled();
    await callout.click();
    await expect(
      page.getByRole("button", {
        // WaypointList names the first waypoint "Start", not "Waypoint 1".
        name: index === 0 ? "Start" : `Waypoint ${String(index + 1)}`,
        exact: true,
      }),
    ).toBeVisible();
    // Placement always uses the map's own settled centre, so the marker it
    // produces must render at that centre and nowhere else. Checked at
    // every placement, because everything below reasons from where a
    // marker sits: a marker nudged away from its waypoint's real
    // coordinate could otherwise make the collision fixture "pass" by
    // never colliding at all.
    const placedBox = await rectOf(
      page.locator(".planning-waypoint-marker").last(),
      "the just-placed waypoint marker",
    );
    const mapBox = await rectOf(map, "the map container");
    expect(
      Math.abs(placedBox.x + placedBox.width / 2 - (mapBox.x + mapBox.width / 2)),
    ).toBeLessThanOrEqual(1.5);
    expect(
      Math.abs(placedBox.y + placedBox.height / 2 - (mapBox.y + mapBox.height / 2)),
    ).toBeLessThanOrEqual(1.5);
    if (index < 2) await panMapBy(page, map, callout, -40);
  }
  const marker = page.locator(".planning-waypoint-marker", { hasText: /^2$/ });
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveText("2");

  // ...and specifically for the ORDINARY marker this fixture goes on to
  // use. The per-placement check above can only ever see the start or
  // finish marker (a just-placed waypoint is always an endpoint), so it
  // alone would not notice an ordinary marker rendered away from its own
  // waypoint's coordinate. Waypoint 2 was placed at the map centre and
  // the camera has panned 40px once since, so that is exactly where it
  // must be.
  const ordinaryBox = await rectOf(marker, "the ordinary waypoint marker");
  const finalMapBox = await rectOf(map, "the map container");
  expect(
    Math.abs(
      ordinaryBox.x + ordinaryBox.width / 2 - (finalMapBox.x + finalMapBox.width / 2),
    ),
  ).toBeLessThanOrEqual(1.5);
  expect(
    Math.abs(
      ordinaryBox.y +
        ordinaryBox.height / 2 -
        (finalMapBox.y + finalMapBox.height / 2 - 40),
    ),
  ).toBeLessThanOrEqual(1.5);

  return { map, callout, marker };
}

/** Selects a waypoint only if it is not already selected. Re-tapping an
 * already-selected waypoint deselects it (CLAUDE.md's Planning behaviour),
 * which would take its Move/Insert-after actions away again — and a
 * completed Move leaves that same waypoint selected, so the second and
 * third passes through this sequence would otherwise toggle it off. */
async function ensureWaypointSelected(
  page: Page,
  row: Locator,
  name: string,
): Promise<void> {
  const insertAfter = row.getByRole("button", { name: "Insert after", exact: true });
  if (!(await insertAfter.isVisible())) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await expect(insertAfter).toBeVisible();
}

test.describe("Planning placement control layering (item 109)", () => {
  test.use({ viewport: PHONE_PORTRAIT });

  test("a waypoint marker driven onto the control paints nothing inside it and nothing in its isolation band, while staying fully visible beyond that band", async ({
    page,
    context,
  }) => {
    const { map, callout, marker } = await buildCollisionFixture(page, context);

    const bandPx = await readIsolationBandWidth(callout);
    expect(bandPx).toBe(EXPECTED_ISOLATION_BAND_PX);

    const { marker: markerBox, callout: calloutBox } = await driveMarkerOntoControlEdge(
      page,
      map,
      marker,
      callout,
    );

    // The fixture is only meaningful if the marker genuinely straddles the
    // control's top edge — asserted before anything is concluded from it,
    // so none of the checks below can pass vacuously.
    expect(intersects(markerBox, calloutBox)).toBe(true);
    expect(markerBox.y).toBeLessThan(calloutBox.y);
    expect(markerBox.y + markerBox.height).toBeGreaterThan(calloutBox.y);
    // Kept well clear of the control's 12px rounded corners, where the
    // band curves away and the map legitimately shows through.
    const markerCentreX = markerBox.x + markerBox.width / 2;
    expect(markerCentreX).toBeGreaterThan(calloutBox.x + 24);
    expect(markerCentreX).toBeLessThan(calloutBox.x + calloutBox.width - 24);

    // A z-index comparison only means anything if no ancestor between the
    // two elements starts a new stacking context.
    expect(await haveStackingSafeAncestry(page, marker, callout)).toBe(true);

    const sampleX = markerBox.x + 3;
    const sampleWidth = markerBox.width - 6;
    const insideControl: Rect = {
      x: sampleX,
      y: calloutBox.y,
      width: sampleWidth,
      height: markerBox.y + markerBox.height - calloutBox.y,
    };
    const isolationBand: Rect = {
      x: sampleX,
      y: calloutBox.y - bandPx,
      width: sampleWidth,
      height: bandPx,
    };
    const beyondTheBand: Rect = {
      x: markerCentreX - markerBox.width * 0.2,
      y: markerBox.y + markerBox.height * 0.18,
      width: markerBox.width * 0.4,
      height: markerBox.height * 0.15,
    };

    // The primary, colour-free proof: hiding the marker changes nothing
    // inside the control, and nothing in its isolation band — so it paints
    // no pixel in either. On the unfixed parent both of these are true.
    expect(await regionChangesWhenHidden(page, marker, insideControl)).toBe(false);
    expect(await regionChangesWhenHidden(page, marker, isolationBand)).toBe(false);
    // ...and the same measurement immediately beyond the band DOES change,
    // which is what stops the two assertions above being vacuous: the
    // marker really is there, really is protruding, and really is visible.
    expect(await regionChangesWhenHidden(page, marker, beyondTheBand)).toBe(true);

    // The supporting absolute proof, in real composited pixels. Both
    // colours are read from the live computed styles, never hard-coded.
    const calloutBackground = await callout.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    const markerBackground = await marker.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(await regionCoverage(page, insideControl, markerBackground)).toBeLessThan(
      0.02,
    );
    expect(await regionCoverage(page, isolationBand, markerBackground)).toBeLessThan(
      0.02,
    );
    expect(await regionCoverage(page, isolationBand, calloutBackground)).toBeGreaterThan(
      0.95,
    );
    expect(await regionCoverage(page, beyondTheBand, markerBackground)).toBeGreaterThan(
      0.9,
    );

    // The marker is untouched by all of this: still present, still
    // numbered, still carrying its accessible label.
    await expect(marker).toHaveText("2");
    await expect(page.getByRole("img", { name: "Waypoint 2" })).toBeVisible();
  });

  test("the control is the top hit target across its own surface, while the map stays reachable immediately outside it", async ({
    page,
    context,
  }) => {
    const { map, callout, marker } = await buildCollisionFixture(page, context);
    await driveMarkerOntoControlEdge(page, map, marker, callout);

    // Every sample across the control's own border box resolves to the
    // control. (Waypoint markers are pointer-events: none, so this already
    // held before item 109 — it is a regression guard here, not this
    // item's fail-first evidence, and is recorded as such.)
    const topmost = await callout.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const results: boolean[] = [];
      for (const fx of [0.04, 0.25, 0.5, 0.75, 0.96]) {
        for (const fy of [0.04, 0.25, 0.5, 0.75, 0.96]) {
          const stack = document.elementsFromPoint(
            rect.x + rect.width * fx,
            rect.y + rect.height * fy,
          );
          results.push(stack[0] === el);
        }
      }
      return results;
    });
    expect(topmost.every(Boolean)).toBe(true);
    expect(topmost).toHaveLength(25);

    // Immediately outside the control's painted footprint the map itself
    // is the top element — the isolation band is decoration, not an
    // invisible layer, and nothing oversized covers the map.
    const bandPx = await readIsolationBandWidth(callout);
    const calloutBox = await rectOf(callout, "the placement control");
    const probeX = calloutBox.x - bandPx - 8;
    const probeY = calloutBox.y + calloutBox.height / 2;
    const outsideTag = await page.evaluate(
      ({ x, y }: { x: number; y: number }) => {
        const stack = document.elementsFromPoint(x, y);
        return {
          topmost: stack[0]?.tagName ?? "",
          calloutIndex: stack.findIndex((el) =>
            el.classList.contains("planning-crosshair-callout"),
          ),
        };
      },
      { x: probeX, y: probeY },
    );
    expect(outsideTag.topmost).toBe("CANVAS");
    expect(outsideTag.calloutIndex).toBe(-1);

    // The control's hit area must never reach beyond what it actually
    // paints. Both thin strips just inside its own border box have to be
    // its own background colour, so a transparent but still hit-testable
    // extension — the invisible map-blocking layer this item must not
    // introduce — has nowhere to hide. Without this, an enlargement that
    // keeps the control's measured box and its probe point in step is
    // invisible to a purely box-relative check (confirmed: an 80px
    // transparent-padding control passed every other assertion here).
    const calloutBackground = await callout.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    const edgeStripHeight = calloutBox.height * 0.5;
    const edgeStripY = calloutBox.y + calloutBox.height * 0.25;
    for (const stripX of [calloutBox.x + 2, calloutBox.x + calloutBox.width - 5]) {
      const coverage = await regionCoverage(
        page,
        { x: stripX, y: edgeStripY, width: 3, height: edgeStripHeight },
        calloutBackground,
      );
      expect(coverage, `painted plate at x=${String(stripX)}`).toBeGreaterThan(0.9);
    }

    // And a real gesture started there genuinely pans the camera.
    const centreBefore = await map.getAttribute("data-camera-center");
    await page.mouse.move(probeX, probeY);
    await page.mouse.down();
    await page.mouse.move(probeX - 40, probeY - 30, { steps: 10 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    await expect
      .poll(() => map.getAttribute("data-camera-center"))
      .not.toBe(centreBefore);
  });

  test("placement, move, insert-after, undo and redo all still work with a marker against the control, and the marker's coordinate and number are unchanged throughout", async ({
    page,
    context,
  }) => {
    const { map, callout, marker } = await buildCollisionFixture(page, context);
    await driveMarkerOntoControlEdge(page, map, marker, callout);

    await expect
      .poll(() => readWaypointCoordinates(page), {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .toHaveLength(3);
    const originalCoordinates = await readWaypointCoordinates(page);
    const secondCoordinate = originalCoordinates[1];

    // Add: the control still appends, and the presentation fix moved no
    // existing waypoint.
    await expect(callout).toHaveText("Add waypoint here");
    await callout.click();
    await expect(
      page.getByRole("button", { name: "Waypoint 4", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => readWaypointCoordinates(page), {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .toHaveLength(4);
    await expect
      .poll(async () => (await readWaypointCoordinates(page))[1], {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .toEqual(secondCoordinate);

    // Undo / redo: unchanged.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(
      page.getByRole("button", { name: "Waypoint 4", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(
      page.getByRole("button", { name: "Waypoint 4", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(
      page.getByRole("button", { name: "Waypoint 4", exact: true }),
    ).toHaveCount(0);

    const waypointTwoRow = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Waypoint 2", exact: true }) });

    // Move: still reaches its own label and still relocates the waypoint.
    await ensureWaypointSelected(page, waypointTwoRow, "Waypoint 2");
    await waypointTwoRow.getByRole("button", { name: "Move", exact: true }).click();
    await expect(callout).toHaveText("Move waypoint 2 here");
    await expect(callout).toBeEnabled();
    await callout.click();
    await expect
      .poll(async () => (await readWaypointCoordinates(page))[1], {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .not.toEqual(secondCoordinate);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(async () => (await readWaypointCoordinates(page))[1], {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .toEqual(secondCoordinate);

    // Insert after: same.
    await ensureWaypointSelected(page, waypointTwoRow, "Waypoint 2");
    await waypointTwoRow
      .getByRole("button", { name: "Insert after", exact: true })
      .click();
    await expect(callout).toHaveText("Insert after waypoint 2");
    await expect(callout).toBeEnabled();
    await callout.click();
    await expect(
      page.getByRole("button", { name: "Waypoint 4", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => readWaypointCoordinates(page), {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .toHaveLength(4);
    await expect
      .poll(async () => (await readWaypointCoordinates(page))[1], {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .toEqual(secondCoordinate);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(
      page.getByRole("button", { name: "Waypoint 4", exact: true }),
    ).toHaveCount(0);

    // The whole sequence left every original coordinate exactly as it was.
    // Polled, not read once: the draft's own autosave is debounced, so a
    // bare read straight after the final Undo can still return the
    // pre-undo row even though the UI has already settled.
    await expect
      .poll(() => readWaypointCoordinates(page), {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .toEqual(originalCoordinates);
  });

  test("the control never collides with the map's own chrome, and its layering contract with both marker types holds", async ({
    page,
    context,
  }) => {
    const { map, callout } = await buildCollisionFixture(page, context);

    const bandPx = await readIsolationBandWidth(callout);
    const footprint = visualRect(await rectOf(callout, "the placement control"), bandPx);
    for (const selector of [
      ".planning-map-zoom-controls",
      ".planning-map-controls",
      ".planning-map-status-overlay",
      ".map-attribution",
    ]) {
      const chrome = page.locator(selector).first();
      await expect(chrome).toBeAttached();
      const chromeBox = await chrome.boundingBox();
      if (!chromeBox || chromeBox.height === 0) continue;
      expect(
        intersects(footprint, chromeBox),
        `${selector} must not overlap the placement control`,
      ).toBe(false);
    }

    // The control's whole painted footprint stays inside the map.
    const mapBox = await rectOf(map, "the map container");
    expect(footprint.x).toBeGreaterThanOrEqual(mapBox.x);
    expect(footprint.x + footprint.width).toBeLessThanOrEqual(mapBox.x + mapBox.width);
    expect(footprint.y).toBeGreaterThanOrEqual(mapBox.y);
    expect(footprint.y + footprint.height).toBeLessThanOrEqual(mapBox.y + mapBox.height);

    // Item 84's coupled pair is untouched and still ordered as it was, and
    // the control now sits strictly above both of them without joining the
    // z-index 5 overlay tier.
    const marker = page.locator(".planning-waypoint-marker").first();
    const calloutZ = Number(await callout.evaluate((el) => getComputedStyle(el).zIndex));
    const markerZ = Number(await marker.evaluate((el) => getComputedStyle(el).zIndex));
    const badgeZ = Number(
      await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.className = "distance-badge-marker";
        probe.style.position = "absolute";
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).zIndex;
        probe.remove();
        return value;
      }),
    );
    expect(markerZ).toBeGreaterThan(badgeZ);
    expect(calloutZ).toBeGreaterThan(markerZ);
    for (const selector of [
      ".planning-map-zoom-controls",
      ".planning-map-controls",
      ".planning-map-status-overlay",
      ".map-attribution",
    ]) {
      const overlayZ = Number(
        await page
          .locator(selector)
          .first()
          .evaluate((el) => getComputedStyle(el).zIndex),
      );
      expect(calloutZ).toBeLessThan(overlayZ);
    }
  });

  test("the correction holds at every marker zoom band", async ({ page, context }) => {
    const { map, callout, marker } = await buildCollisionFixture(page, context);
    const bandPx = await readIsolationBandWidth(callout);

    for (const band of ["close", "regional", "overview"] as const) {
      await zoomToBand(page, map, band === "close" ? "in" : "out", band);
      await expect(callout).toBeEnabled();
      const { marker: markerBox, callout: calloutBox } = await driveMarkerOntoControlEdge(
        page,
        map,
        marker,
        callout,
      );
      expect(intersects(markerBox, calloutBox), `band ${band}`).toBe(true);

      const sampleX = markerBox.x + 2;
      const sampleWidth = Math.max(4, markerBox.width - 4);
      const insideControl: Rect = {
        x: sampleX,
        y: calloutBox.y,
        width: sampleWidth,
        height: markerBox.y + markerBox.height - calloutBox.y,
      };
      const isolationBand: Rect = {
        x: sampleX,
        y: calloutBox.y - bandPx,
        width: sampleWidth,
        height: bandPx,
      };
      expect(
        await regionChangesWhenHidden(page, marker, insideControl),
        `band ${band}: inside the control`,
      ).toBe(false);
      expect(
        await regionChangesWhenHidden(page, marker, isolationBand),
        `band ${band}: isolation band`,
      ).toBe(false);
    }
  });
});

test.describe("Planning placement control containment (item 109)", () => {
  /** Builds the longest label describeCrosshairAction can produce —
   * `Insert after waypoint N` at a two-digit N. Every waypoint is placed at
   * the same camera centre, which is legal and keeps this fast: no routing
   * happens until Calculate, which this file never presses. */
  async function reachLongestLabel(page: Page, callout: Locator): Promise<void> {
    for (let index = 0; index < 12; index += 1) {
      await expect(callout).toBeEnabled();
      await callout.click();
    }
    await expect(
      page.getByRole("button", { name: "Waypoint 12", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Waypoint 12", exact: true }).click();
    await page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Waypoint 12", exact: true }) })
      .getByRole("button", { name: "Insert after", exact: true })
      .click();
    await expect(callout).toHaveText("Insert after waypoint 12");
  }

  async function expectReadableAndContained(
    callout: Locator,
    viewportWidth: number,
  ): Promise<void> {
    const bandPx = await readIsolationBandWidth(callout);
    const footprint = visualRect(await rectOf(callout, "the placement control"), bandPx);
    expect(footprint.x).toBeGreaterThanOrEqual(-1);
    expect(footprint.x + footprint.width).toBeLessThanOrEqual(viewportWidth + 1);

    const readability = await callout.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        textOverflow: style.textOverflow,
        overflow: style.overflow,
        fontSize: parseFloat(style.fontSize),
      };
    });
    // Wrapped, never clipped and never shrunk to fit.
    expect(readability.scrollWidth).toBeLessThanOrEqual(readability.clientWidth);
    expect(readability.scrollHeight).toBeLessThanOrEqual(readability.clientHeight);
    expect(readability.textOverflow).not.toBe("ellipsis");
    expect(readability.overflow).toBe("visible");

    const box = await rectOf(callout, "the placement control");
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  test("the longest reachable label stays readable and contained at the standard phone portrait width", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ ...PHONE_PORTRAIT });
    await preparePlanning(page, context);
    const callout = page.locator(".planning-crosshair-callout");
    await reachLongestLabel(page, callout);
    await expectReadableAndContained(callout, PHONE_PORTRAIT.width);
  });

  test("the longest reachable label stays readable and contained at the narrowest guarded portrait width", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ ...NARROW_PORTRAIT });
    await preparePlanning(page, context);
    const callout = page.locator(".planning-crosshair-callout");
    await reachLongestLabel(page, callout);
    await expectReadableAndContained(callout, NARROW_PORTRAIT.width);
  });

  test("at 200% browser text the longest label wraps rather than clipping or shrinking, stays a usable target, clears every other control and adds no horizontal overflow of its own", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ ...PHONE_PORTRAIT });
    await preparePlanning(page, context);
    const callout = page.locator(".planning-crosshair-callout");
    await reachLongestLabel(page, callout);

    const fontBefore = await callout.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await page.waitForTimeout(300);
    await expect(callout).toHaveText("Insert after waypoint 12");

    await expectReadableAndContained(callout, PHONE_PORTRAIT.width);
    const fontAfter = await callout.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    expect(fontAfter).toBeGreaterThan(fontBefore);

    // Clears every other map CONTROL at this text size, isolation band
    // included.
    //
    // .map-attribution is deliberately excluded here, and only here. At
    // 200% text it wraps to 62.25px tall, which lifts its top edge above
    // this control's fixed `bottom: 44px` — measured on the item-109
    // parent (commit 27fa0c8) as a 26.25px overlap of the control's own
    // BORDER BOX, with no box-shadow in the picture at all: callout
    // y -1663..-1493, attribution y -1519.25..-1457. That collision is
    // pre-existing, is caused by the attribution's own enlarged-text
    // height rather than by anything item 109 changed, and a box-shadow
    // never affects layout, so asserting its absence here would be
    // asserting someone else's defect. It is recorded as an out-of-scope
    // measured finding in docs/project/current-status.md instead.
    const bandPx = await readIsolationBandWidth(callout);
    const footprint = visualRect(await rectOf(callout, "the placement control"), bandPx);
    for (const selector of [
      ".planning-map-zoom-controls",
      ".planning-map-controls",
      ".planning-map-status-overlay",
    ]) {
      const chromeBox = await page.locator(selector).first().boundingBox();
      if (!chromeBox || chromeBox.height === 0) continue;
      expect(intersects(footprint, chromeBox), selector).toBe(false);
    }

    // A whole-document scrollWidth check at 200% trips on this app shell's
    // own pre-existing, unrelated primary-navigation overflow — confirmed
    // identically with no Planning map on screen, and already documented
    // in routeLibraryTags.spec.ts and routeLibrarySearchSort.spec.ts. So
    // the honest, load-bearing assertion is that this control contributes
    // nothing to it: hiding the control must leave the document's own
    // scrollWidth exactly as it was.
    const overflow = await callout.evaluate((el) => {
      const withControl = document.documentElement.scrollWidth;
      const original = el.style.display;
      el.style.display = "none";
      const withoutControl = document.documentElement.scrollWidth;
      el.style.display = original;
      return { withControl, withoutControl };
    });
    expect(overflow.withControl).toBe(overflow.withoutControl);
  });
});
