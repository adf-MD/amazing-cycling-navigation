import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readPlanningDraftRow } from "./support/rideStateDb.ts";

// Proves CLAUDE.md backlog item 123 in both engines (this file runs under
// the "chromium" and "webkit-smoke" projects): on a touch-capable context
// a touch tap on the Planning map places nothing, a mouse click on the same
// map still places a waypoint — per interaction, not per device — the
// crosshair control keeps adding, moving and inserting by touch, the
// keyboard path is unchanged, and the empty-list hint no longer tells
// touch users to tap the map.
//
// WebKit here is Playwright's Linux WebKit, whose page.touchscreen.tap is
// a real touch through WebKit's own event pipeline (measured: pointerdown
// with pointerType "touch", touchstart, then compatibility mousedown/
// mouseup and a click) but which cannot pan or pinch. Measured on the
// unchanged 0.4.45 build, WebKit reports that touch-generated click's own
// pointerType as "mouse" — which is why the classification rests on the
// pointer sequence, never on the click alone. Genuine touch pans, pinches
// and double taps are covered in Chromium by
// androidPlanningTouchPlacement.spec.ts.
//
// No test in this file contacts a live map or routing provider.

test.use({
  serviceWorkers: "block",
  hasTouch: true,
  viewport: { width: 390, height: 844 },
});

const DB_NAME = "amazing-cycling-navigation";
const DRAFT_AUTOSAVE_DEBOUNCE_MS = 900;
const NARROW_PORTRAIT = { width: 320, height: 844 } as const;
const HINT = {
  en: { plan: "Plan", text: "No waypoints yet. Use the crosshair to add one." },
  de: {
    plan: "Planen",
    text: "Noch keine Wegpunkte. Nutze das Fadenkreuz, um einen Wegpunkt zu setzen.",
  },
} as const;

interface Point {
  x: number;
  y: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RecordedInput {
  type: string;
  pointerType: string | null;
}

/** Capture-phase record of the input that reaches MapLibre's canvas
 * container, duplicated from androidPlanningTouchPlacement.spec.ts per this
 * repo's no-shared-e2e-helpers-across-specs convention. */
async function installInputRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: { type: string; pointerType: string | null }[] = [];
    (globalThis as unknown as { __item123InputLog: typeof log }).__item123InputLog = log;
    for (const type of ["pointerdown", "touchstart", "click"]) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (!target.closest(".maplibregl-canvas-container")) return;
          log.push({
            type,
            pointerType: event instanceof PointerEvent ? event.pointerType : null,
          });
        },
        { capture: true, passive: true },
      );
    }
  });
}

async function takeRecordedInput(page: Page): Promise<RecordedInput[]> {
  return page.evaluate(() =>
    (
      globalThis as unknown as { __item123InputLog: RecordedInput[] }
    ).__item123InputLog.splice(0),
  );
}

function countOf(
  log: readonly RecordedInput[],
  type: string,
  pointerType?: string,
): number {
  return log.filter(
    (entry) =>
      entry.type === type &&
      (pointerType === undefined || entry.pointerType === pointerType),
  ).length;
}

/** Scrolls Planning to the top — where the map sits whole below the
 * navigation — and measures the map afresh. Planning keeps the previous
 * screen's scroll offset (item 125), and tapping a waypoint row scrolls
 * the page, so a box measured earlier cannot be trusted for a gesture. */
async function mapBox(page: Page, map: Locator): Promise<Box> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(100);
  const box = await map.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("the Planning map has no bounding box");
  if (box.y < 0 || box.y + box.height > viewport.height) {
    throw new Error(`the Planning map is not wholly in view: ${JSON.stringify(box)}`);
  }
  return box;
}

/** A point on open map, clear of the centre crosshair, the placement
 * control (bottom centre) and the right-hand map controls. */
async function openMapPoint(
  page: Page,
  map: Locator,
  fx = 0.3,
  fy = 0.3,
): Promise<Point> {
  const box = await mapBox(page, map);
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** Duplicated from planningPlacementLabelFit.spec.ts per this repo's
 * convention: writes the app-preferences singleton directly. */
async function seedLanguagePreference(page: Page, language: string): Promise<void> {
  await page.evaluate(
    async ({ dbName, language }) => {
      await new Promise<void>((resolve, reject) => {
        // Dexie stores schema version N as IndexedDB version N*10.
        const request = indexedDB.open(dbName, 50);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("appPreferences")) {
            db.createObjectStore("appPreferences", { keyPath: "id" });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("appPreferences", "readwrite");
          tx.objectStore("appPreferences").put({ id: "app", language });
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
    { dbName: DB_NAME, language },
  );
}

interface PlanningFixture {
  map: Locator;
  callout: Locator;
}

async function openPlanning(
  page: Page,
  context: BrowserContext,
  language: keyof typeof HINT = "en",
): Promise<PlanningFixture> {
  await installInputRecorder(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await installLocalMapStyle(page);
  await page.goto("/");
  if (language !== "en") {
    await seedLanguagePreference(page, language);
    await page.reload();
  }
  await page.getByRole("button", { name: HINT[language].plan, exact: true }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  const callout = page.locator(".planning-crosshair-callout");
  // Disabled until the one-time regional framing settles.
  await expect(callout).toBeEnabled({ timeout: 15_000 });
  const map = page.locator('[data-testid="map-container"]');
  await mapBox(page, map);
  await takeRecordedInput(page);
  return { map, callout };
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(DRAFT_AUTOSAVE_DEBOUNCE_MS + 300);
}

/** Taps a waypoint-row toggle (a waypoint, Move or Insert after) once it
 * has stopped moving, and confirms the tap registered — a missed tap on a
 * row button would otherwise surface later as a misleading placement
 * failure. */
async function tapToggle(page: Page, button: Locator): Promise<void> {
  await button.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await button.tap();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

function markers(page: Page): Locator {
  return page.locator(".planning-waypoint-marker");
}

async function readWaypointCoordinates(page: Page): Promise<number[][]> {
  const draft = await readPlanningDraftRow(page);
  const waypoints = (draft?.waypoints ?? []) as { coordinate: number[] }[];
  return waypoints.map((waypoint) => waypoint.coordinate);
}

/** Relocates the crosshair with a mouse drag — WebKit here cannot pan by
 * touch — then waits for the placement control to be usable again. */
async function mousePan(page: Page, fixture: PlanningFixture, dx: number, dy: number) {
  const start = await openMapPoint(page, fixture.map, 0.5, 0.3);
  const centreBefore = await fixture.map.getAttribute("data-camera-center");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect
    .poll(() => fixture.map.getAttribute("data-camera-center"))
    .not.toBe(centreBefore);
  await expect(fixture.callout).toBeEnabled();
}

test.describe("Planning touch placement in both engines (item 123)", () => {
  test("a touch tap on the map places nothing; a mouse click straight after it places one", async ({
    page,
    context,
  }) => {
    const fixture = await openPlanning(page, context);

    const touchPoint = await openMapPoint(page, fixture.map);
    await page.touchscreen.tap(touchPoint.x, touchPoint.y);
    await settle(page);
    const touchInput = await takeRecordedInput(page);
    expect(countOf(touchInput, "pointerdown", "touch")).toBe(1);
    expect(countOf(touchInput, "touchstart")).toBe(1);
    expect(countOf(touchInput, "click"), "a click reached the map").toBe(1);
    await expect(markers(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

    await page.touchscreen.tap(touchPoint.x, touchPoint.y);
    const mousePoint = await openMapPoint(page, fixture.map, 0.6, 0.3);
    await page.mouse.click(mousePoint.x, mousePoint.y);
    await settle(page);
    const mixedInput = await takeRecordedInput(page);
    expect(countOf(mixedInput, "pointerdown", "touch")).toBe(1);
    expect(countOf(mixedInput, "pointerdown", "mouse")).toBe(1);
    expect(countOf(mixedInput, "click")).toBe(2);
    await expect(markers(page)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  });

  test("the crosshair control adds, moves and inserts on the intended waypoint by touch, and a touch tap never completes a pending Move", async ({
    page,
    context,
  }) => {
    const fixture = await openPlanning(page, context);
    const { callout } = fixture;

    await callout.tap();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
    await mousePan(page, fixture, -60, 40);
    await callout.tap();
    await expect(
      page.getByRole("button", { name: "Waypoint 2", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => readWaypointCoordinates(page), {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .toHaveLength(2);
    const [startCoordinate, secondCoordinate] = await readWaypointCoordinates(page);

    await tapToggle(page, page.getByRole("button", { name: "Waypoint 2", exact: true }));
    const secondRow = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Waypoint 2", exact: true }) });
    await tapToggle(page, secondRow.getByRole("button", { name: "Move", exact: true }));
    await expect(callout).toHaveText("Move waypoint 2 here");
    await takeRecordedInput(page);
    const touchPoint = await openMapPoint(page, fixture.map, 0.25, 0.25);
    await page.touchscreen.tap(touchPoint.x, touchPoint.y);
    await settle(page);
    expect(
      countOf(await takeRecordedInput(page), "click"),
      "a click reached the map",
    ).toBe(1);
    await expect(callout).toHaveText("Move waypoint 2 here");
    expect(await readWaypointCoordinates(page)).toEqual([
      startCoordinate,
      secondCoordinate,
    ]);

    await mousePan(page, fixture, 50, -30);
    await callout.tap();
    await expect(callout).not.toHaveText("Move waypoint 2 here");
    await expect
      .poll(async () => (await readWaypointCoordinates(page))[1], {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .not.toEqual(secondCoordinate);
    const [startAfterMove, movedSecond] = await readWaypointCoordinates(page);
    expect(startAfterMove).toEqual(startCoordinate);

    await tapToggle(page, page.getByRole("button", { name: "Start", exact: true }));
    const startRow = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Start", exact: true }) });
    await tapToggle(
      page,
      startRow.getByRole("button", { name: "Insert after", exact: true }),
    );
    await expect(callout).toHaveText("Insert after the start");
    await mousePan(page, fixture, 40, 50);
    await callout.tap();
    await expect(
      page.getByRole("button", { name: "Waypoint 3", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => readWaypointCoordinates(page), {
        timeout: DRAFT_AUTOSAVE_DEBOUNCE_MS + 4_000,
      })
      .toHaveLength(3);
    const afterInsert = await readWaypointCoordinates(page);
    expect(afterInsert[0]).toEqual(startCoordinate);
    expect(afterInsert[2]).toEqual(movedSecond);
    expect(afterInsert[1]).not.toEqual(startCoordinate);
    expect(afterInsert[1]).not.toEqual(movedSecond);
  });

  test("the keyboard path is unchanged: Enter and Space on the focused map place nothing, Enter on the crosshair control places (regression guard)", async ({
    page,
    context,
  }) => {
    const fixture = await openPlanning(page, context);

    await page.locator(".maplibregl-canvas").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await settle(page);
    expect(countOf(await takeRecordedInput(page), "click")).toBe(0);
    await expect(markers(page)).toHaveCount(0);

    await fixture.callout.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  });

  for (const language of ["en", "de"] as const) {
    test(`the empty-list hint names only the crosshair and fits a 320px phone (${language})`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize(NARROW_PORTRAIT);
      await openPlanning(page, context, language);

      const hint = page.getByText(HINT[language].text, { exact: true });
      await expect(hint).toBeVisible();
      const geometry = await hint.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return {
          textLeft: text.left,
          textRight: text.right,
          boxLeft: box.left,
          boxRight: box.right,
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
        };
      });
      expect(geometry.textLeft).toBeGreaterThanOrEqual(geometry.boxLeft - 0.5);
      expect(geometry.textRight).toBeLessThanOrEqual(geometry.boxRight + 0.5);
      expect(geometry.boxRight).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    });
  }
});
