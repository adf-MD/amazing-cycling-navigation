import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import {
  forceMapStyleFailure,
  installLocalMapStyleWithTileSource,
  type TileFailureController,
} from "./support/localMapStyle.ts";

// Backlog item 128 (C6): at ordinary text Planning's imagery message stays
// inside the map but takes the top slot (top: 8px, Planning-scoped), and
// Planning's own three messages — Locate failed, clear the selected
// warning, clear the selected route feature — sit in normal flow below the
// map. At 0.4.49 the banner started at 72px and its Retry covered the
// placement crosshair at 375x667 and at 320x844 in German, and everywhere
// just below item 114's enlarged-text switch.
//
// A .smoke spec, so the webkit-smoke project runs it as well as chromium.
// Every measurement waits for its own state's settling signal
// (data-map-ready only where that state allows it), is taken twice and
// must not change in between, and fails if a node detaches mid-measurement.
// The full measured matrix and the design comparison are in
// docs/design/planning-imagery-banner/README.md.
//
// Browser-root text scaling here is not iOS Larger Text, and none of this
// is installed-iPhone evidence.

test.use({ serviceWorkers: "block" });

const DB_NAME = "amazing-cycling-navigation";
const ORS_URL_GLOB = "https://api.heigit.org/**";
const SIZES = {
  "375x667": { width: 375, height: 667 },
  // Item 122: the 340px ordinary floor, where the German imagery message
  // overlapped the crosshair by 15px at the earlier 280px floor.
  "320x568": { width: 320, height: 568 },
  "320x844": { width: 320, height: 844 },
  "390x844": { width: 390, height: 844 },
  "430x932": { width: 430, height: 932 },
} as const;
type SizeName = keyof typeof SIZES;
const COPY = {
  en: {
    plan: "Plan",
    calculate: "Calculate route",
    locateFailed: "Your location could not be determined.",
    clearWarning: "Clear the selected warning to place or move a waypoint.",
    clearFeature: "Clear the selected route feature to place or move a waypoint.",
    featureDetails: "Route feature details",
  },
  de: {
    plan: "Planen",
    calculate: "Route berechnen",
    locateFailed: "Dein Standort konnte nicht bestimmt werden.",
    clearWarning:
      "Eine Warnung ist ausgewählt. Hebe die Auswahl auf, bevor du einen Wegpunkt setzt oder verschiebst.",
    clearFeature:
      "Ein Streckenmerkmal ist ausgewählt. Hebe die Auswahl auf, bevor du einen Wegpunkt setzt oder verschiebst.",
    featureDetails: "Details zum Routenabschnitt",
  },
} as const;
type Language = keyof typeof COPY;

/** A straight route along 51.5°N: a questionable stretch over its first
 * three segments (a warning), then flat, then a steady 8% climb over its
 * last 14 segments (about 0.97 km) — a recognised route feature that the
 * elevation chart can select without touching the map. */
const ROUTE_POINT_COUNT = 21;
const CLIMB_START_INDEX = 6;
const MOCK_ORS_RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        summary: { distance: 1390, duration: 300, ascent: 78, descent: 0 },
        segments: [
          {
            distance: 1390,
            duration: 300,
            steps: [
              {
                distance: 1390,
                duration: 300,
                type: 0,
                instruction: "Head east",
                way_points: [0, ROUTE_POINT_COUNT - 1],
              },
            ],
          },
        ],
        extras: {
          surface: {
            values: [
              [0, 3, 8],
              [3, ROUTE_POINT_COUNT - 1, 1],
            ],
          },
        },
      },
      geometry: {
        type: "LineString",
        coordinates: Array.from({ length: ROUTE_POINT_COUNT }, (_, i) => [
          -0.1 + i * 0.001,
          51.5,
          i < CLIMB_START_INDEX ? 10 : 10 + (i - CLIMB_START_INDEX) * 5.56,
        ]),
      },
    },
  ],
};

/** Duplicated per this repo's no-shared-e2e-helpers convention: writes the
 * app-preferences singleton and, when asked, a dummy routing key. */
async function seedPreferences(
  page: Page,
  language: Language,
  withKey: boolean,
): Promise<void> {
  await page.evaluate(
    async ({ dbName, language, withKey }) => {
      await new Promise<void>((resolve, reject) => {
        // Dexie stores schema version N as IndexedDB version N*10.
        const request = indexedDB.open(dbName, 50);
        request.onsuccess = () => {
          const db = request.result;
          const stores = withKey
            ? ["appPreferences", "providerKeys"]
            : ["appPreferences"];
          const tx = db.transaction(stores, "readwrite");
          tx.objectStore("appPreferences").put({ id: "app", language });
          if (withKey) {
            tx.objectStore("providerKeys").put({
              id: "openrouteservice",
              apiKey: "dummy-e2e-key",
              savedAt: new Date().toISOString(),
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            reject(new Error(tx.error?.message ?? "IndexedDB request failed"));
          };
        };
        request.onerror = () => {
          reject(new Error(request.error?.message ?? "IndexedDB request failed"));
        };
      });
    },
    { dbName: DB_NAME, language, withKey },
  );
}

type ImageryState = "fallback" | "tile-error" | "delayed";

/** Opens Planning in one imagery state and waits for that state's own
 * settling signal — never a blanket data-map-ready="true", which the
 * delayed state deliberately keeps false. */
async function openPlanning(
  page: Page,
  size: SizeName,
  language: Language,
  state: ImageryState,
  withRoute = false,
): Promise<TileFailureController | null> {
  await page.setViewportSize(SIZES[size]);
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 51.5, longitude: -0.1 });
  let tiles: TileFailureController | null = null;
  if (state === "fallback") {
    await forceMapStyleFailure(page);
  } else {
    tiles = await installLocalMapStyleWithTileSource(page);
    if (state === "delayed") tiles.holdTiles();
  }
  if (withRoute) {
    await page.route(ORS_URL_GLOB, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(MOCK_ORS_RESPONSE),
      });
    });
  }
  await page.goto("/");
  await seedPreferences(page, language, withRoute);
  await page.reload();
  await page.getByRole("button", { name: COPY[language].plan, exact: true }).click();
  const map = page.getByTestId("map-container");
  const control = page.locator(".planning-crosshair-callout");
  if (state === "delayed") {
    await expect.poll(() => tiles?.heldTileRequestCount() ?? 0).toBeGreaterThan(0);
    await expect(page.getByTestId("map-imagery-delayed-banner")).toBeVisible({
      timeout: 10_000,
    });
    await expect(map).toHaveAttribute("data-map-ready", "false");
    return tiles;
  }
  await expect(control).toBeEnabled({ timeout: 15_000 });
  await expect(map).toHaveAttribute("data-map-ready", "true", { timeout: 20_000 });
  if (state === "fallback") {
    await expect(page.getByTestId("map-fallback-banner")).toBeVisible({
      timeout: 15_000,
    });
  } else if (tiles) {
    // A genuinely new tile request must fail: Zoom in asks for tiles that
    // are not cached.
    const failedBefore = tiles.failedTileRequestCount();
    tiles.failTiles();
    await page.locator(".planning-map-zoom-controls button").first().click();
    await expect.poll(() => tiles.failedTileRequestCount()).toBeGreaterThan(failedBefore);
    await expect(page.getByTestId("tiles-unavailable-banner")).toBeVisible({
      timeout: 15_000,
    });
  }
  return tiles;
}

async function setRootFontSize(page: Page, value: string): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.style.fontSize = value;
  }, value);
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

async function failLocate(page: Page): Promise<void> {
  // getApproximateLocationOnce accepts a cached fix, so make the one-shot
  // request fail outright.
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (_success, error) => {
      error?.({
        code: 1,
        message: "denied",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
    };
  });
  await page.locator(".planning-map-controls button").nth(1).click();
  await expect(page.locator(".planning-map-status-message")).toHaveCount(1);
}

async function succeedLocate(page: Page): Promise<void> {
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (success) => {
      const coords: GeolocationCoordinates = {
        latitude: 51.5,
        longitude: -0.1,
        accuracy: 20,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      };
      const position: GeolocationPosition = {
        coords,
        timestamp: Date.now(),
        toJSON: () => ({}),
      };
      success(position);
    };
  });
  await page.locator(".planning-map-controls button").nth(1).click();
  await expect(page.locator(".planning-map-status-message")).toHaveCount(0);
}

interface Box {
  x: number;
  y: number;
  r: number;
  b: number;
  w: number;
  h: number;
}

interface Measurement {
  enlarged: boolean;
  map: { w: number; h: number };
  /** Item 122's size reference: the box item 114's switch reads. */
  reference: { w: number; h: number };
  ring: Box;
  control: Box;
  imagery: { testId: string; box: Box; inMap: boolean; retry: Box | null }[];
  planning: {
    text: string;
    box: Box;
    inMap: boolean;
    inViewport: boolean;
    clipped: boolean;
  }[];
  belowBlockHeight: number;
  gapToNextPanel: number;
  ringCentreReachesMap: boolean;
  imageryTextReachesMap: boolean[];
  retryHit: boolean[];
  canvasId: string | null;
  nodeCounts: { overlay: number; attribution: number; canvas: number };
  overflowX: number;
  connected: boolean;
}

/** One pass over the live layout, with the map scrolled to the middle of
 * the viewport. Boxes are relative to the map's own top-left corner. */
async function measureOnce(page: Page): Promise<Measurement> {
  return page.evaluate(() => {
    const need = (selector: string): HTMLElement => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`missing ${selector}`);
      return el;
    };
    const map = need(".planning-map-container");
    map.scrollIntoView({ block: "center" });
    const mr = map.getBoundingClientRect();
    const rel = (r: DOMRect) => ({
      x: r.left - mr.left,
      y: r.top - mr.top,
      r: r.right - mr.left,
      b: r.bottom - mr.top,
      w: r.width,
      h: r.height,
    });
    const reachesMap = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest(".maplibregl-canvas-container") ??
        null) !== null;
    const ringEl = need(".planning-crosshair");
    const ringRect = ringEl.getBoundingClientRect();
    const imageryEls = [...document.querySelectorAll<HTMLElement>(".map-status-message")];
    const planningEls = [
      ...document.querySelectorAll<HTMLElement>(".planning-map-status-message"),
    ];
    const imageryTextReachesMap: boolean[] = [];
    const retryHit: boolean[] = [];
    const imagery = imageryEls.map((el) => {
      const text = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
      if (text && map.contains(el)) {
        const range = document.createRange();
        range.selectNodeContents(text);
        for (const line of range.getClientRects()) {
          imageryTextReachesMap.push(
            reachesMap(line.left + line.width / 2, line.top + line.height / 2),
          );
        }
      }
      const retry = el.querySelector<HTMLElement>(".map-status-retry-button");
      if (retry) {
        const r = retry.getBoundingClientRect();
        retryHit.push(
          document
            .elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            ?.closest(".map-status-retry-button") === retry,
        );
      }
      return {
        testId: el.dataset.testid ?? "",
        box: rel(el.getBoundingClientRect()),
        inMap: map.contains(el),
        retry: retry ? rel(retry.getBoundingClientRect()) : null,
      };
    });
    const planning = planningEls.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: el.textContent,
        box: rel(r),
        inMap: map.contains(el),
        inViewport:
          r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        clipped:
          el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
      };
    });
    const below = map.nextElementSibling;
    const next = below?.nextElementSibling ?? null;
    const canvas = map.querySelector<HTMLElement>("canvas.maplibregl-canvas");
    if (canvas && !canvas.dataset.item128Id) {
      canvas.dataset.item128Id = String(Math.random()).slice(2);
    }
    return {
      enlarged: map.classList.contains("planning-map-container--enlarged-text"),
      map: { w: mr.width, h: mr.height },
      reference: (() => {
        const r = need(".planning-map-size-reference").getBoundingClientRect();
        return { w: r.width, h: r.height };
      })(),
      ring: rel(ringRect),
      control: rel(need(".planning-crosshair-callout").getBoundingClientRect()),
      imagery,
      planning,
      belowBlockHeight:
        below?.classList.contains("planning-map-below") === true
          ? below.getBoundingClientRect().height
          : Number.NaN,
      gapToNextPanel:
        next?.classList.contains("planning-section") === true
          ? next.getBoundingClientRect().top - mr.bottom
          : Number.NaN,
      ringCentreReachesMap: reachesMap(
        ringRect.left + ringRect.width / 2,
        ringRect.top + ringRect.height / 2,
      ),
      imageryTextReachesMap,
      retryHit,
      canvasId: canvas?.dataset.item128Id ?? null,
      nodeCounts: {
        overlay: document.querySelectorAll(".map-status-overlay").length,
        attribution: document.querySelectorAll(".map-attribution").length,
        canvas: document.querySelectorAll("canvas.maplibregl-canvas").length,
      },
      overflowX:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      connected: [map, ringEl, ...imageryEls, ...planningEls].every((n) => n.isConnected),
    };
  });
}

/** Two samples 300ms apart that must agree, with every node still
 * attached: a message coming or going mid-measurement must never read as a
 * layout result. */
async function measure(page: Page): Promise<Measurement> {
  const signature = (m: Measurement) =>
    JSON.stringify([m.enlarged, m.map, m.ring, m.control, m.imagery, m.planning]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const first = await measureOnce(page);
    await page.waitForTimeout(300);
    const second = await measureOnce(page);
    if (first.connected && second.connected && signature(first) === signature(second)) {
      return second;
    }
  }
  throw new Error("the layout did not settle across three paired samples");
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
}

/** The imagery message, if any, is inside the map and clear of the ring;
 * the crosshair point and the imagery text reach the map; Retry is on top
 * and keeps its 44x112 minimum; nothing overflows horizontally. */
function expectImageryClearsCrosshair(m: Measurement, context: string): void {
  const report = `${context}: ${JSON.stringify(m)}`;
  expect(m.imagery.length, report).toBeGreaterThan(0);
  for (const message of m.imagery) {
    expect(message.inMap, report).toBe(true);
    expect(overlap(message.box, m.ring), report).toBe(false);
    if (message.retry) {
      expect(message.retry.w, report).toBeGreaterThanOrEqual(112);
      expect(message.retry.h, report).toBeGreaterThanOrEqual(44);
    }
  }
  expect(m.ringCentreReachesMap, report).toBe(true);
  expect(m.imageryTextReachesMap.length, report).toBeGreaterThan(0);
  expect(m.imageryTextReachesMap.every(Boolean), report).toBe(true);
  expect(m.retryHit.every(Boolean), report).toBe(true);
  expect(m.overflowX, report).toBeLessThanOrEqual(0);
}

/** Every Planning message is below the map, readable and fully in view
 * with the map centred, and collides with no imagery message. */
function expectPlanningMessagesBelowMap(
  m: Measurement,
  expected: number,
  context: string,
): void {
  const report = `${context}: ${JSON.stringify(m)}`;
  expect(m.planning.length, report).toBe(expected);
  for (const message of m.planning) {
    expect(message.inMap, report).toBe(false);
    expect(message.box.y, report).toBeGreaterThanOrEqual(m.map.h);
    expect(message.inViewport, report).toBe(true);
    expect(message.clipped, report).toBe(false);
    for (const imagery of m.imagery) {
      expect(overlap(message.box, imagery.box), report).toBe(false);
    }
  }
  expect(m.overflowX, report).toBeLessThanOrEqual(0);
}

/** With no Planning message, the below-map block is empty and adds no
 * space: the next panel is one ordinary 16px .screen gap below the map. */
function expectNoEmptyGap(m: Measurement, context: string): void {
  const report = `${context}: ${JSON.stringify(m)}`;
  expect(m.planning, report).toHaveLength(0);
  expect(m.belowBlockHeight, report).toBe(0);
  expect(m.gapToNextPanel, report).toBeCloseTo(16, 0);
}

/** The map, its canvas node and the placement control are exactly where
 * they were: a message appearing, changing or clearing moved nothing. */
function expectMapUnmoved(
  before: Measurement,
  after: Measurement,
  context: string,
): void {
  const report = `${context}: ${JSON.stringify({ before, after })}`;
  expect(after.map, report).toEqual(before.map);
  expect(after.canvasId, report).toBe(before.canvasId);
  expect(after.control, report).toEqual(before.control);
  expect(after.ring, report).toEqual(before.ring);
}

/** The root font size just below the size at which item 114's layout
 * engages (width or height under 17rem): the largest ordinary text. Since
 * item 122 the switch reads the size reference, which keeps the enlarged
 * layout's height, not the taller ordinary map. */
function justBelowSwitch(m: Measurement): string {
  return `${(Math.min(m.reference.w, m.reference.h) / 17 - 0.02).toFixed(3)}px`;
}

for (const size of Object.keys(SIZES) as SizeName[]) {
  for (const language of ["en", "de"] as const) {
    test(`ordinary text, ${size} ${language}: the imagery message clears the crosshair and Planning's own message sits below the map`, async ({
      page,
    }) => {
      await openPlanning(page, size, language, "fallback");

      const alone = await measure(page);
      expect(alone.enlarged).toBe(false);
      if (size === "320x568") {
        // Item 122's floor, with item 114's switch inactive: the ordinary map
        // at 340px, the reference at its 280px floor (17.5rem at 16px).
        expect(alone.map).toEqual({ w: 288, h: 340 });
        expect(alone.reference).toEqual({ w: 288, h: 280 });
      }
      expectImageryClearsCrosshair(alone, "imagery alone");
      expectNoEmptyGap(alone, "imagery alone");

      await failLocate(page);
      const withMessage = await measure(page);
      expectImageryClearsCrosshair(withMessage, "with Locate failed");
      expectPlanningMessagesBelowMap(withMessage, 1, "with Locate failed");
      expect(withMessage.planning[0]?.text).toBe(COPY[language].locateFailed);
      expectMapUnmoved(alone, withMessage, "Locate failed appeared");
      expect(withMessage.imagery[0]?.box).toEqual(alone.imagery[0]?.box);

      await succeedLocate(page);
      const cleared = await measure(page);
      expectNoEmptyGap(cleared, "Locate failed cleared");
      expectMapUnmoved(alone, cleared, "Locate failed cleared");

      await setRootFontSize(page, justBelowSwitch(alone));
      const largest = await measure(page);
      expect(largest.enlarged, "still the ordinary layout").toBe(false);
      expectImageryClearsCrosshair(largest, "just below the switch");
      await failLocate(page);
      const largestWithMessage = await measure(page);
      expectImageryClearsCrosshair(
        largestWithMessage,
        "just below the switch, with Locate failed",
      );
      expectPlanningMessagesBelowMap(
        largestWithMessage,
        1,
        "just below the switch, with Locate failed",
      );
    });
  }
}

for (const state of ["tile-error", "delayed"] as const) {
  for (const [size, language] of [
    ["375x667", "en"],
    ["375x667", "de"],
    ["320x844", "de"],
  ] as const) {
    test(`ordinary text, ${size} ${language}: the ${state} message clears the crosshair`, async ({
      page,
    }) => {
      const tiles = await openPlanning(page, size, language, state);
      try {
        const m = await measure(page);
        expect(m.imagery.map((message) => message.testId)).toEqual([
          state === "tile-error"
            ? "tiles-unavailable-banner"
            : "map-imagery-delayed-banner",
        ]);
        expectImageryClearsCrosshair(m, state);
      } finally {
        await tiles?.releaseTiles();
      }
    });
  }
}

for (const size of ["375x667", "320x844"] as const) {
  for (const language of ["en", "de"] as const) {
    test(`ordinary text, ${size} ${language}: the selected-warning and selected-feature messages sit below the map`, async ({
      page,
    }) => {
      const copy = COPY[language];
      await openPlanning(page, size, language, "fallback", true);
      // Two waypoints by mouse, beside the banner and below both control
      // clusters (item 123: only a mouse click places on the map).
      const map = page.getByTestId("map-container");
      await map.scrollIntoViewIfNeeded();
      const mapBox = await map.boundingBox();
      if (!mapBox) throw new Error("expected the map to be measurable");
      await map.click({ position: { x: 40, y: 170 } });
      await map.click({ position: { x: mapBox.width - 40, y: 170 } });
      const calculate = page.getByRole("button", { name: copy.calculate });
      await expect(calculate).toBeEnabled();
      await calculate.click();
      const warning = page.locator("ul.route-warning-list .route-warning-button").first();
      await expect(warning).toBeVisible({ timeout: 15_000 });

      await warning.click();
      await expect(page.getByText(copy.clearWarning, { exact: true })).toBeVisible();
      const withWarning = await measure(page);
      expectImageryClearsCrosshair(withWarning, "warning selected");
      expectPlanningMessagesBelowMap(withWarning, 1, "warning selected");
      expect(withWarning.planning[0]?.text).toBe(copy.clearWarning);

      // The real feature selection, through the elevation chart's own tap
      // path (handleChartTapDistance), which does not depend on where the
      // warning selection framed the map. The tap target spans the whole
      // route distance, so 75% of its width lies inside the climb.
      const tapTarget = page.locator(
        ".route-overview-elevation-section rect.elevation-chart-tap-target",
      );
      await tapTarget.scrollIntoViewIfNeeded();
      const tapBox = await tapTarget.boundingBox();
      if (!tapBox) throw new Error("expected the elevation chart to be measurable");
      await tapTarget.click({
        position: { x: tapBox.width * 0.75, y: tapBox.height / 2 },
      });
      await expect(page.getByRole("region", { name: copy.featureDetails })).toBeVisible();
      await expect(page.getByText(copy.clearFeature, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.clearWarning, { exact: true })).toHaveCount(0);
      const withFeature = await measure(page);
      expectImageryClearsCrosshair(withFeature, "feature selected");
      expectPlanningMessagesBelowMap(withFeature, 1, "feature selected");
      expect(withFeature.planning[0]?.text).toBe(copy.clearFeature);
    });
  }
}

for (const [size, language] of [
  ["390x844", "en"],
  ["375x667", "de"],
] as const) {
  test(`switching to and from item 114's enlarged layout at ${size} ${language} keeps Planning's message below the map and the same nodes`, async ({
    page,
  }) => {
    await openPlanning(page, size, language, "fallback");
    await failLocate(page);
    const ordinary = await measure(page);
    await page.locator(".planning-map-status-message").evaluate((el) => {
      el.dataset.item128Node = "kept";
    });
    // Item 122: the switch reads the size reference, so its ratios are
    // computed from it, not from the taller ordinary map.
    const rootFor = (ratio: number) =>
      `${(Math.min(ordinary.reference.w, ordinary.reference.h) / ratio).toFixed(3)}px`;
    const enlargedClass = page.locator(".planning-map-container--enlarged-text");

    const expectEnlarged = async (context: string) => {
      const m = await measure(page);
      expect(m.enlarged, context).toBe(true);
      expect(m.nodeCounts, context).toEqual({ overlay: 1, attribution: 1, canvas: 1 });
      expect(m.canvasId, context).toBe(ordinary.canvasId);
      // The enlarged layout keeps the earlier height: the map is the size
      // of the reference, which itself never changes with the layout.
      expect(m.map, context).toEqual(ordinary.reference);
      expect(m.reference, context).toEqual(ordinary.reference);
      const order = await page.evaluate(() => {
        const messages = document.querySelector(".planning-map-messages");
        const imagery = document.querySelector(".map-status-message");
        const own = document.querySelector<HTMLElement>(".planning-map-status-message");
        const attribution = document.querySelector(".map-attribution");
        return {
          imageryBelow: messages?.contains(imagery) ?? false,
          imageryFirst:
            imagery !== null &&
            own !== null &&
            (imagery.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING) !==
              0,
          attributionInStrip:
            (attribution?.closest(".planning-map-attribution-strip") ?? null) !== null,
          sameOwnNode: own?.dataset.item128Node === "kept",
        };
      });
      expect(order, context).toEqual({
        imageryBelow: true,
        imageryFirst: true,
        attributionInStrip: true,
        sameOwnNode: true,
      });
    };

    await setRootFontSize(
      page,
      `${(Math.min(ordinary.reference.w, ordinary.reference.h) / 17 + 0.02).toFixed(3)}px`,
    );
    await expect(enlargedClass).toHaveCount(1);
    await expectEnlarged("engaged");

    // Between the engage (17) and release (17.25) ratios: still enlarged.
    await setRootFontSize(page, rootFor(17.1));
    await expectEnlarged("held by the hysteresis");

    await setRootFontSize(page, rootFor(17.3));
    await expect(enlargedClass).toHaveCount(0);
    const released = await measure(page);
    expectImageryClearsCrosshair(released, "released");
    expectPlanningMessagesBelowMap(released, 1, "released");
    expect(released.canvasId).toBe(ordinary.canvasId);
    expect(released.map).toEqual(ordinary.map);
    expect(
      await page
        .locator(".planning-map-status-message")
        .evaluate((el) => el.dataset.item128Node),
    ).toBe("kept");
    expect(
      await page
        .locator(".planning-map-container .map-status-overlay")
        .evaluate((el) => getComputedStyle(el).top),
    ).toBe("8px");
  });
}

test("Riding's pre-ride overview keeps its imagery overlay at 72px (Planning-only change)", async ({
  page,
}) => {
  await forceMapStyleFailure(page);
  await page.goto("/");
  await page
    .getByLabel("Import GPX file")
    .setInputFiles(fileURLToPath(new URL("./fixtures/smoke-route.gpx", import.meta.url)));
  await page.getByRole("button", { name: "smoke-route", exact: true }).click();
  const banner = page.getByTestId("map-fallback-banner");
  await expect(banner).toBeVisible({ timeout: 20_000 });
  expect(
    await banner.evaluate((el) => {
      const overlay = el.closest(".map-status-overlay");
      return {
        top: overlay ? getComputedStyle(overlay).top : null,
        inPlanningMap: el.closest(".planning-map-container") !== null,
      };
    }),
  ).toEqual({ top: "72px", inPlanningMap: false });
});
