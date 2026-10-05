import { expect, test, type Locator, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readPlanningDraftRow } from "./support/rideStateDb.ts";

// Backlog item 122 — Planning's larger map and Calculate-first order — in
// both engines (this file runs under the "chromium" and "webkit-smoke"
// projects), from draft rows and a dummy routing key seeded directly in
// IndexedDB, with the routing provider answered locally (and held, where a
// calculation must be observed while it runs).
//
// Synthetic safe-area insets, where set, are assumptions — 47/34 px for an
// iPhone 13-class installed PWA, 20/0 px for an iPhone SE class — never
// readings from the rider's phone. Root text sizes are browser scaling, not
// iOS Larger Text.

test.use({ serviceWorkers: "block" });

const DB_NAME = "amazing-cycling-navigation";
const ORS_URL_GLOB = "https://api.heigit.org/**";
const DRAFT_NAME = "Map area check";
const GAP = 8;

type Language = "en" | "de";

const COPY = {
  en: {
    plan: "Plan",
    routes: "Routes",
    routeName: "Route name",
    calculate: "Calculate route",
    undo: "Undo",
    reverse: "Reverse route",
    waypointTwo: "Waypoint 2",
    move: "Move",
    deselect: "Deselect waypoint",
    save: "Save route",
    stale: /^(Waiting to recalculate|Recalculating)/,
  },
  de: {
    plan: "Planen",
    routes: "Routen",
    routeName: "Routenname",
    calculate: "Route berechnen",
    undo: "Rückgängig",
    reverse: "Route umkehren",
    waypointTwo: "Wegpunkt 2",
    move: "Verschieben",
    deselect: "Wegpunkt abwählen",
    save: "Route speichern",
    stale: /^(Die Neuberechnung|Die Route wird)/,
  },
} as const;

interface Insets {
  top: number;
  bottom: number;
}

/** A three-waypoint inverted V, so a point straight below the apex lies
 * inside the V and off the route line. */
const WAYPOINTS = [
  { id: "wp-a", coordinate: [-0.1, 51.5] },
  { id: "wp-b", coordinate: [-0.09, 51.51] },
  { id: "wp-c", coordinate: [-0.08, 51.5] },
];

function draftRow(kind: "ordinary" | "estimated"): object {
  return {
    id: "draft",
    waypoints: WAYPOINTS,
    routeName: DRAFT_NAME,
    avoidFerries: true,
    profile: "cycling-road",
    updatedAt: "2026-10-05T08:00:00.000Z",
    ...(kind === "estimated"
      ? {
          editCopySourceRouteId: "route-map-area",
          editCopyWaypointsOrigin: "derived",
          editCopyOperation: "forward",
        }
      : {}),
  };
}

function buildOrsResponse(coordinates: readonly (readonly number[])[]): object {
  const densified: number[][] = [];
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const [startLon = 0, startLat = 0] = coordinates[i] ?? [];
    const [endLon = 0, endLat = 0] = coordinates[i + 1] ?? [];
    for (let step = 0; step < 5; step += 1) {
      const t = step / 5;
      densified.push([
        startLon + t * (endLon - startLon),
        startLat + t * (endLat - startLat),
        10,
      ]);
    }
  }
  const [lastLon = 0, lastLat = 0] = coordinates[coordinates.length - 1] ?? [];
  densified.push([lastLon, lastLat, 10]);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { summary: { distance: 100, duration: 20 } },
        geometry: { type: "LineString", coordinates: densified },
      },
    ],
  };
}

/** Answers the routing provider locally. While held, requests wait until
 * released, so a running calculation can be measured. */
interface Provider {
  hold: (held: boolean) => void;
  release: () => Promise<void>;
  requests: () => number;
}

async function installProvider(page: Page): Promise<Provider> {
  let held = false;
  let requests = 0;
  let waiting: (() => Promise<void>)[] = [];
  await page.route(ORS_URL_GLOB, async (route) => {
    const request = route.request();
    let coordinates: (readonly number[])[] = [];
    if (request.method() === "POST") {
      requests += 1;
      coordinates = (request.postDataJSON() as { coordinates: (readonly number[])[] })
        .coordinates;
    }
    const answer = () =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(buildOrsResponse(coordinates)),
      });
    if (held && request.method() === "POST") {
      waiting.push(answer);
      return;
    }
    await answer();
  });
  // See planning.spec.ts: without this, the POST to the mocked endpoint
  // intermittently never reaches Playwright's request interception.
  await page.addInitScript(() => {
    const originalFetch = fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
  });
  return {
    hold: (value) => {
      held = value;
    },
    release: async () => {
      held = false;
      const pending = waiting;
      waiting = [];
      for (const answer of pending) await answer();
    },
    requests: () => requests,
  };
}

async function writeRows(
  page: Page,
  rows: { store: string; row: object }[],
): Promise<void> {
  await page.evaluate(
    ({ dbName, rows }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(
            rows.map((entry) => entry.store),
            "readwrite",
          );
          for (const entry of rows) tx.objectStore(entry.store).put(entry.row);
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
      }),
    { dbName: DB_NAME, rows },
  );
}

const navButton = (page: Page, label: string): Locator =>
  page.getByRole("navigation").getByRole("button", { name: label, exact: true });

/** Waits for scrollY to hold still over timer-driven samples (never
 * animation frames: headless WebKit can defer them). */
async function settle(page: Page, quietMs = 300): Promise<void> {
  await page.evaluate(
    (quietMs) =>
      new Promise<void>((resolve) => {
        let last = scrollY;
        let since = performance.now();
        const start = performance.now();
        const tick = () => {
          if (scrollY !== last) {
            last = scrollY;
            since = performance.now();
          }
          if (performance.now() - since >= quietMs || performance.now() - start > 5_000) {
            resolve();
            return;
          }
          setTimeout(tick, 25);
        };
        setTimeout(tick, 25);
      }),
    quietMs,
  );
}

/** Sets synthetic safe-area insets on the root and reads them back. */
async function setInsets(page: Page, insets: Insets): Promise<void> {
  const readBack = await page.evaluate((insets) => {
    const style = document.documentElement.style;
    style.setProperty("--safe-area-inset-top", `${String(insets.top)}px`);
    style.setProperty("--safe-area-inset-bottom", `${String(insets.bottom)}px`);
    const computed = getComputedStyle(document.documentElement);
    return [
      computed.getPropertyValue("--safe-area-inset-top").trim(),
      computed.getPropertyValue("--safe-area-inset-bottom").trim(),
    ];
  }, insets);
  expect(readBack).toEqual([`${String(insets.top)}px`, `${String(insets.bottom)}px`]);
}

/** Loads the app with the routing provider answered locally, stores the
 * key, the language and the draft, reloads, opens Planning and waits for
 * the draft and the map. */
async function openPlanning(
  page: Page,
  language: Language,
  viewport: { width: number; height: number },
  kind: "ordinary" | "estimated",
  insets: Insets,
): Promise<Provider> {
  await page.setViewportSize(viewport);
  await installLocalMapStyle(page);
  const provider = await installProvider(page);
  await page.goto("/");
  await expect(navButton(page, COPY.en.plan)).toBeVisible();
  await writeRows(page, [
    { store: "appPreferences", row: { id: "app", language } },
    {
      store: "providerKeys",
      row: {
        id: "openrouteservice",
        apiKey: "dummy-e2e-key",
        savedAt: "2026-10-05T08:00:00.000Z",
      },
    },
    { store: "planningDrafts", row: draftRow(kind) },
  ]);
  await page.reload();
  await navButton(page, COPY[language].plan).click();
  await expect(page.getByLabel(COPY[language].routeName, { exact: true })).toHaveValue(
    DRAFT_NAME,
  );
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await setInsets(page, insets);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await settle(page);
  return provider;
}

/** Calculate route: since item 122 the one primary button directly in the
 * actions panel, whatever its label while a calculation runs. */
const calculateButton = (page: Page): Locator =>
  page.locator(".planning-section:has(> [role='group']) > button.btn-primary");

const staleNote = (page: Page, language: Language): Locator =>
  page.locator(".planning-calculate-status p.status-row").filter({
    hasText: COPY[language].stale,
  });

/** A real mouse click at the element's centre, after proving that point is
 * inside the viewport and hits the element itself — never through
 * Playwright's own scroll-into-view. Returns the point. */
async function pointerClick(
  page: Page,
  locator: Locator,
): Promise<{ x: number; y: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("pointerClick: element is not laid out");
  const point = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const viewport = page.viewportSize();
  expect(point.y, "the click point is inside the viewport").toBeGreaterThan(0);
  expect(point.y, "the click point is inside the viewport").toBeLessThan(
    viewport?.height ?? 0,
  );
  const hits = await locator.evaluate((element, p) => {
    const hit = document.elementFromPoint(p.x, p.y);
    return hit !== null && (hit === element || element.contains(hit));
  }, point);
  expect(hits, "the click point hits the intended element").toBe(true);
  await page.mouse.click(point.x, point.y);
  return point;
}

interface RowSnapshot {
  scrollY: number;
  /** The editing row's top in page coordinates. */
  rowTop: number;
  calculateHeight: number;
  calculateLabel: string;
  /** Calculate's place against the usable band, in viewport coordinates. */
  calculateTop: number;
  calculateBottom: number;
  bandTop: number;
  bandBottom: number;
  editingEnabled: Record<string, boolean>;
}

async function snapshot(page: Page, bottomInset: number): Promise<RowSnapshot> {
  return page.evaluate(
    ({ gap, bottomInset }) => {
      const group = document.querySelector(".planning-section > [role='group']");
      const calculate = document.querySelector(
        ".planning-section:has(> [role='group']) > button.btn-primary",
      );
      const header = document.querySelector("header.app-header--sticky");
      if (!group || !calculate || !header) throw new Error("missing element");
      const groupBox = group.getBoundingClientRect();
      const calcBox = calculate.getBoundingClientRect();
      const editingEnabled: Record<string, boolean> = {};
      for (const button of group.querySelectorAll("button")) {
        editingEnabled[button.textContent.trim()] = !button.disabled;
      }
      return {
        scrollY: window.scrollY,
        rowTop: groupBox.top + window.scrollY,
        calculateHeight: calcBox.height,
        calculateLabel: calculate.textContent.trim(),
        calculateTop: calcBox.top,
        calculateBottom: calcBox.bottom,
        bandTop: header.getBoundingClientRect().bottom + gap,
        bandBottom: window.innerHeight - bottomInset - gap,
        editingEnabled,
      };
    },
    { gap: GAP, bottomInset },
  );
}

/** Scrolls so the editing row sits in the middle of the viewport, when it
 * is not already wholly in view. */
async function bringRowIntoView(page: Page): Promise<void> {
  await page.evaluate(() => {
    const group = document.querySelector(".planning-section > [role='group']");
    if (!group) throw new Error("no editing row");
    const box = group.getBoundingClientRect();
    if (box.top >= 120 && box.bottom <= window.innerHeight - 60) return;
    window.scrollBy(0, box.top - window.innerHeight / 2);
  });
  await settle(page);
}

/** Waits until the draft is routed and current: Calculate reads its plain
 * label, no stale note is shown and Save is enabled. */
async function expectRouted(page: Page, language: Language): Promise<void> {
  await expect(calculateButton(page)).toHaveText(COPY[language].calculate, {
    timeout: 15_000,
  });
  await expect(staleNote(page, language)).toHaveCount(0, { timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: COPY[language].save, exact: true }),
  ).toBeEnabled({ timeout: 15_000 });
}

/** Records a measurement for the report, both as an annotation and as a
 * log line. */
function record(label: string, value: unknown): void {
  const description = `${label}: ${JSON.stringify(value)}`;
  test.info().annotations.push({ type: "measurement", description });
  console.log(`MEASURE ${test.info().project.name} ${description}`);
}

const RECALCULATION_CASES = [
  {
    language: "en",
    width: 390,
    height: 844,
    insets: { top: 47, bottom: 34 },
    main: true,
  },
  {
    language: "de",
    width: 390,
    height: 844,
    insets: { top: 47, bottom: 34 },
    main: true,
  },
  {
    language: "en",
    width: 375,
    height: 667,
    insets: { top: 20, bottom: 0 },
    main: false,
  },
  {
    language: "de",
    width: 375,
    height: 667,
    insets: { top: 20, bottom: 0 },
    main: false,
  },
  {
    language: "en",
    width: 320,
    height: 568,
    insets: { top: 20, bottom: 0 },
    main: false,
  },
  {
    language: "de",
    width: 320,
    height: 568,
    insets: { top: 20, bottom: 0 },
    main: false,
  },
] as const;

for (const { language, width, height, insets, main } of RECALCULATION_CASES) {
  test(`the editing row during a multi-section recalculation and two quick Undo taps (${language}, ${String(width)}x${String(height)}, synthetic ${String(insets.top)}/${String(insets.bottom)} insets)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const provider = await openPlanning(
      page,
      language,
      { width, height },
      "ordinary",
      insets,
    );
    const copy = COPY[language];

    // Route the draft.
    await calculateButton(page).click();
    await expectRouted(page, language);
    expect(provider.requests()).toBeGreaterThan(0);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await settle(page);
    const arrival = await snapshot(page, insets.bottom);
    record("arrival, scroll 0", arrival);
    if (main) {
      expect(
        arrival.calculateTop,
        "Calculate below the band's top",
      ).toBeGreaterThanOrEqual(arrival.bandTop);
      expect(
        arrival.calculateBottom,
        "Calculate above the band's bottom (synthetic insets)",
      ).toBeLessThanOrEqual(arrival.bandBottom);
    }

    // A multi-section recalculation: moving the middle waypoint changes both
    // of its legs, the automatic recalculation follows after its debounce,
    // and the held provider keeps it running while it is measured. (Reverse
    // route would not do: it recalculates nothing until Calculate.)
    await page.getByRole("button", { name: copy.waypointTwo, exact: true }).click();
    await page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: copy.waypointTwo, exact: true }) })
      .getByRole("button", { name: copy.move, exact: true })
      .click();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await settle(page);
    const map = page.getByTestId("map-container");
    const mapBox = await map.boundingBox();
    if (!mapBox) throw new Error("map not laid out");
    const before = await snapshot(page, insets.bottom);
    provider.hold(true);
    await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height * 0.45);
    await expect(staleNote(page, language)).toHaveCount(1);
    const stale = await snapshot(page, insets.bottom);
    await expect(calculateButton(page)).not.toHaveText(copy.calculate, {
      timeout: 10_000,
    });
    const during = await snapshot(page, insets.bottom);
    await provider.release();
    await expectRouted(page, language);
    const after = await snapshot(page, insets.bottom);
    record("recalculation before", before);
    record("recalculation stale note shown", stale);
    record("recalculation during", during);
    record("recalculation after", after);

    if (main && Math.abs(during.rowTop - before.rowTop) > 0.5) {
      await page.screenshot({ path: test.info().outputPath("row-moved-during.png") });
    }

    // Two quick Undo taps. Build two history entries first: two waypoints
    // placed by mouse inside the V, each recalculated.
    const deselect = page.getByRole("button", { name: copy.deselect, exact: true });
    if ((await deselect.count()) > 0) await deselect.click();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await settle(page);
    // The moved waypoint has been autosaved before its coordinates are kept.
    await expect
      .poll(
        async () =>
          ((await readPlanningDraftRow(page))?.waypoints as { coordinate: number[] }[])[1]
            ?.coordinate,
        { timeout: 10_000 },
      )
      .not.toEqual(WAYPOINTS[1]?.coordinate);
    const stored = await readPlanningDraftRow(page);
    const routedWaypoints = (stored?.waypoints ?? []) as { coordinate: number[] }[];
    for (const dy of [0.12, 0.22]) {
      const count = await page.locator(".waypoint-list li").count();
      await page.mouse.click(
        mapBox.x + mapBox.width / 2,
        mapBox.y + mapBox.height * (0.5 + dy),
      );
      await expect(page.locator(".waypoint-list li")).toHaveCount(count + 1);
      await expectRouted(page, language);
    }
    await expect(page.locator(".waypoint-list li")).toHaveCount(5);

    await bringRowIntoView(page);
    const undo = page.getByRole("button", { name: copy.undo, exact: true });
    const undoBefore = await snapshot(page, insets.bottom);
    provider.hold(true);
    const point = await pointerClick(page, undo);
    await expect(staleNote(page, language)).toHaveCount(1);
    const afterFirst = await snapshot(page, insets.bottom);
    const stillUndo = await undo.evaluate((element, p) => {
      const hit = document.elementFromPoint(p.x, p.y);
      return hit !== null && (hit === element || element.contains(hit));
    }, point);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator(".waypoint-list li")).toHaveCount(3);
    const afterSecond = await snapshot(page, insets.bottom);
    await provider.release();
    await expectRouted(page, language);
    const cleared = await snapshot(page, insets.bottom);
    record("undo before", undoBefore);
    record("undo after first tap (stale note appears)", afterFirst);
    record("undo second tap still on Undo", stillUndo);
    record("undo after second tap", afterSecond);
    record("undo after the note clears", cleared);

    // Both history changes: the draft is back to the routed three waypoints.
    await expect
      .poll(
        async () =>
          (
            (await readPlanningDraftRow(page))?.waypoints as { coordinate: number[] }[]
          ).map((w) => w.coordinate),
        { timeout: 10_000 },
      )
      .toEqual(routedWaypoints.map((w) => w.coordinate));

    if (main) {
      for (const [name, snap] of [
        ["stale note shown", stale],
        ["during the calculation", during],
        ["after the calculation", after],
      ] as const) {
        expect(
          Math.abs(snap.rowTop - before.rowTop),
          `row unmoved: ${name}`,
        ).toBeLessThanOrEqual(0.5);
      }
      expect(stillUndo, "the second tap still lands on Undo").toBe(true);
      for (const [name, snap] of [
        ["after the first Undo", afterFirst],
        ["after the second Undo", afterSecond],
        ["after the note clears", cleared],
      ] as const) {
        expect(
          Math.abs(snap.rowTop - undoBefore.rowTop),
          `row unmoved: ${name}`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
  });
}

const INDICATOR = { en: "Editing a copy", de: "Kopie in Bearbeitung" } as const;

/** The panel's buttons ahead of the routing options, in DOM order: since
 * item 122, Calculate route, then the editing actions. */
async function actionOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const section = document.querySelector(".planning-section:has(> [role='group'])");
    if (!section) throw new Error("no actions panel");
    return [
      ...section.querySelectorAll(":scope > button, :scope > [role='group'] button"),
    ].map((button) => button.textContent.trim());
  });
}

interface Layout {
  map: { w: number; h: number; bottom: number };
  reference: { w: number; h: number };
  calculateIsFirst: boolean;
  calculateTop: number;
  calculateBottom: number;
  bandTop: number;
  bandBottom: number;
  enlarged: boolean;
}

async function layout(page: Page, bottomInset: number): Promise<Layout> {
  return page.evaluate(
    ({ gap, bottomInset }) => {
      const need = (selector: string): Element => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`missing ${selector}`);
        return element;
      };
      const map = need(".planning-map-container");
      const mapBox = map.getBoundingClientRect();
      const referenceBox = need(".planning-map-size-reference").getBoundingClientRect();
      const section = need(".planning-section:has(> [role='group'])");
      const calculate = need(
        ".planning-section:has(> [role='group']) > button.btn-primary",
      );
      const calcBox = calculate.getBoundingClientRect();
      return {
        map: { w: mapBox.width, h: mapBox.height, bottom: mapBox.bottom },
        reference: { w: referenceBox.width, h: referenceBox.height },
        calculateIsFirst: section.firstElementChild === calculate,
        calculateTop: calcBox.top,
        calculateBottom: calcBox.bottom,
        bandTop: need("header.app-header--sticky").getBoundingClientRect().bottom + gap,
        bandBottom: window.innerHeight - bottomInset - gap,
        enlarged: map.classList.contains("planning-map-container--enlarged-text"),
      };
    },
    { gap: GAP, bottomInset },
  );
}

function expectCalculateInBand(l: Layout, context: string): void {
  expect(
    l.calculateTop,
    `${context}: Calculate below the band's top`,
  ).toBeGreaterThanOrEqual(l.bandTop);
  expect(
    l.calculateBottom,
    `${context}: Calculate above the band's bottom`,
  ).toBeLessThanOrEqual(l.bandBottom);
}

/** Scrolls the element to the middle of the viewport and returns whether it
 * then lies wholly inside the usable band. */
async function reachable(
  page: Page,
  target: Locator,
  bottomInset: number,
): Promise<boolean> {
  await target.evaluate((element) => {
    element.scrollIntoView({ block: "center" });
  });
  await settle(page);
  return target.evaluate(
    (element, { gap, bottomInset }) => {
      const header = document.querySelector("header.app-header--sticky");
      if (!header) return false;
      const box = element.getBoundingClientRect();
      return (
        box.top >= header.getBoundingClientRect().bottom + gap &&
        box.bottom <= window.innerHeight - bottomInset - gap
      );
    },
    { gap: GAP, bottomInset },
  );
}

for (const language of ["en", "de"] as const) {
  for (const kind of ["ordinary", "estimated"] as const) {
    test(`390x844 (${language}, ${kind}): a 358x480 map, Calculate directly below it and inside the band with synthetic 47/34 insets, then the editing actions`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await openPlanning(page, language, { width: 390, height: 844 }, kind, {
        top: 47,
        bottom: 34,
      });
      const copy = COPY[language];
      const arrival = await layout(page, 34);
      record(`arrival ${kind}, synthetic 47/34`, arrival);
      expect(arrival.enlarged).toBe(false);
      expect(arrival.map).toMatchObject({ w: 358, h: 480 });
      expect(arrival.reference).toEqual({ w: 358, h: 380 });
      expect(arrival.map.h % 20).toBe(0);
      expect(arrival.reference.h % 20).toBe(0);
      expect(arrival.calculateIsFirst, "Calculate opens the actions panel").toBe(true);
      expect(arrival.calculateTop - arrival.map.bottom).toBeLessThan(60);
      expectCalculateInBand(arrival, `${kind}, synthetic 47/34`);
      expect(await actionOrder(page)).toEqual([
        copy.calculate,
        copy.undo,
        language === "en" ? "Redo" : "Wiederholen",
        language === "en" ? "Return to start" : "Zurück zum Start",
        copy.reverse,
      ]);

      // Selecting a waypoint adds Deselect waypoint to the editing row and
      // leaves Calculate where it was.
      await page.getByRole("button", { name: copy.waypointTwo, exact: true }).click();
      await expect(
        page.getByRole("button", { name: copy.deselect, exact: true }),
      ).toBeVisible();
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await settle(page);
      const selected = await layout(page, 34);
      record(`waypoint selected ${kind}`, selected);
      expect(selected.calculateTop).toBe(arrival.calculateTop);
      expect((await actionOrder(page)).at(-1)).toBe(copy.deselect);
      expectCalculateInBand(selected, `${kind}, waypoint selected`);

      // A zero-inset reference for the same arrangement.
      await setInsets(page, { top: 0, bottom: 0 });
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await settle(page);
      const zero = await layout(page, 0);
      record(`zero insets ${kind}, waypoint selected`, zero);
      expectCalculateInBand(zero, `${kind}, zero insets`);

      if (kind === "estimated") {
        // With the copy's explanation open, everything below can still be
        // reached by scrolling.
        await setInsets(page, { top: 47, bottom: 34 });
        await page
          .getByRole("button", { name: INDICATOR[language], exact: true })
          .evaluate((el) => {
            (el as HTMLElement).click();
          });
        await expect(
          page.getByRole("button", { name: INDICATOR[language], exact: true }),
        ).toHaveAttribute("aria-expanded", "true");
        expect(
          await reachable(page, calculateButton(page), 34),
          "Calculate reachable",
        ).toBe(true);
        expect(
          await reachable(page, page.locator(".planning-section > [role='group']"), 34),
          "the editing row reachable",
        ).toBe(true);
        expect(
          await reachable(page, page.locator(".waypoint-list"), 34),
          "the waypoint list",
        ).toBe(true);
        expect(
          await reachable(page, page.locator(".planning-section summary").first(), 34),
          "the routing options",
        ).toBe(true);
        expect(
          await reachable(
            page,
            page.getByRole("button", { name: copy.save, exact: true }),
            34,
          ),
          "the save controls",
        ).toBe(true);
      }
    });
  }
}

test("375x667 (de, estimated copy, synthetic 20/0 insets): a 343x380 map, with the editing row reachable by scrolling", async ({
  page,
}) => {
  await openPlanning(page, "de", { width: 375, height: 667 }, "estimated", {
    top: 20,
    bottom: 0,
  });
  const arrival = await layout(page, 0);
  record("375x667 de estimated arrival", arrival);
  expect(arrival.enlarged).toBe(false);
  expect(arrival.map).toMatchObject({ w: 343, h: 380 });
  expect(arrival.reference).toEqual({ w: 343, h: 300 });
  expect(arrival.calculateIsFirst).toBe(true);
  expect(
    await reachable(page, page.locator(".planning-section > [role='group']"), 0),
  ).toBe(true);
});

const SWITCH_CASES = [
  { language: "de", width: 375, height: 667, ordinaryHeight: 380, enlargedHeight: 300 },
  { language: "en", width: 390, height: 844, ordinaryHeight: 480, enlargedHeight: 380 },
] as const;

for (const { language, width, height, ordinaryHeight, enlargedHeight } of SWITCH_CASES) {
  test(`item 114's switch at ${String(width)}x${String(height)} (${language}): the accepted entry and exit points from both directions, one flip per crossing, and the enlarged layout's earlier height`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openPlanning(page, language, { width, height }, "ordinary", {
      top: 0,
      bottom: 0,
    });
    const start = await layout(page, 0);
    expect(start.enlarged).toBe(false);
    expect(start.map.h).toBe(ordinaryHeight);
    expect(start.reference.h).toBe(enlargedHeight);
    const side = Math.min(start.reference.w, start.reference.h);
    await page.evaluate(() => {
      const map = document.querySelector(".planning-map-container");
      if (!map) throw new Error("no map");
      const w = window as unknown as { __flips: number };
      w.__flips = 0;
      new MutationObserver(() => {
        w.__flips += 1;
      }).observe(map, { attributes: true, attributeFilter: ["class"] });
    });
    const steps = [
      // [root font, expected enlarged, flips since the previous step]
      [`${(side / 17.1).toFixed(3)}px`, false, 0], // inside the hysteresis, from below
      [`${(side / 16.9).toFixed(3)}px`, true, 1], // engaged
      [`${(side / 17.1).toFixed(3)}px`, true, 0], // inside the hysteresis, from above
      [`${(side / 17.3).toFixed(3)}px`, false, 1], // released
      ["32px", true, 1], // 200%
      [`${(side / 17.1).toFixed(3)}px`, true, 0], // back down, still held
      [`${(side / 17.3).toFixed(3)}px`, false, 1], // released again
    ] as const;
    for (const [root, expectedEnlarged, expectedFlips] of steps) {
      const flipsBefore = await page.evaluate(
        () => (window as unknown as { __flips: number }).__flips,
      );
      await page.evaluate((root) => {
        document.documentElement.style.fontSize = root;
      }, root);
      expect(
        Number.parseFloat(
          await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
        ),
      ).toBeCloseTo(Number.parseFloat(root), 2);
      // Headless WebKit defers rendering updates, and with them
      // ResizeObserver delivery, until there is pointer activity: nudge the
      // pointer over the page header while waiting for the expected layout,
      // then allow a quiet period so a late or repeated flip is still counted.
      for (let i = 0; i < 30; i += 1) {
        await page.mouse.move(4, 4 + (i % 2));
        if ((await layout(page, 0)).enlarged === expectedEnlarged) break;
        await page.waitForTimeout(100);
      }
      for (let i = 0; i < 5; i += 1) {
        await page.mouse.move(4, 4 + (i % 2));
        await page.waitForTimeout(100);
      }
      const l = await layout(page, 0);
      const flips =
        (await page.evaluate(() => (window as unknown as { __flips: number }).__flips)) -
        flipsBefore;
      record(`switch ${root}`, { enlarged: l.enlarged, map: l.map.h, flips });
      expect(l.enlarged, `${root}: layout`).toBe(expectedEnlarged);
      expect(flips, `${root}: class flips`).toBe(expectedFlips);
      expect(l.map.h, `${root}: map height`).toBe(
        expectedEnlarged ? enlargedHeight : ordinaryHeight,
      );
      expect(l.reference.h, `${root}: the reference never changes`).toBe(enlargedHeight);
      expect(l.map.h % 20).toBe(0);
      if (expectedEnlarged) {
        await expect(
          page.locator(".planning-map-attribution-strip .map-attribution"),
        ).toHaveCount(1);
      }
    }
  });
}

for (const { width, height, mapHeight } of [
  { width: 390, height: 844, mapHeight: 480 },
  { width: 320, height: 568, mapHeight: 340 },
] as const) {
  test(`basic map interaction at ${String(width)}x${String(height)} (a ${String(mapHeight)}px map): pan, rotate and pitch drags complete, and a mouse click and the crosshair control each add a waypoint`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openPlanning(page, "en", { width, height }, "ordinary", { top: 0, bottom: 0 });
    const map = page.getByTestId("map-container");
    const box = await map.boundingBox();
    if (!box) throw new Error("map not laid out");
    expect(Math.round(box.height)).toBe(mapHeight);
    const attribute = (name: string) => map.getAttribute(name);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const unchangedBox = async () => {
      expect(await map.boundingBox(), "the map did not resize").toEqual(box);
    };

    // A left-button pan, released inside the map.
    const centreBefore = await attribute("data-camera-center");
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 30, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect.poll(() => attribute("data-camera-center")).not.toBe(centreBefore);
    await unchangedBox();

    // A right-button rotation past MapLibre's 7-degree snap, paused before
    // release inside the map (item 21's guidance for synthetic drags).
    await page.mouse.move(cx - 60, cy - 40);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(cx + 60, cy - 40, { steps: 15 });
    await page.waitForTimeout(150);
    await page.mouse.up({ button: "right" });
    await expect
      .poll(async () => Math.abs(Number(await attribute("data-camera-bearing"))))
      .toBeGreaterThan(10);
    await unchangedBox();

    // A right-button pitch.
    await page.mouse.move(cx, cy + 20);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(cx, cy - 40, { steps: 15 });
    await page.waitForTimeout(150);
    await page.mouse.up({ button: "right" });
    await expect
      .poll(async () => Number(await attribute("data-camera-pitch")))
      .toBeGreaterThan(5);
    await unchangedBox();

    // A mouse click places a waypoint; the crosshair control places another.
    const waypoints = page.locator(".waypoint-list li");
    await expect(waypoints).toHaveCount(3);
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
    await expect(waypoints).toHaveCount(4);
    await page.locator(".planning-crosshair-callout").click();
    await expect(waypoints).toHaveCount(5);
    await unchangedBox();
  });
}
