import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow, readSavedRouteId } from "./support/rideStateDb.ts";

// Backlog item 124, slices 1, 3, 7 and 8 — Chromium only (CDP CPU
// throttling, and to keep CI cost down; the cross-engine geometry is in
// confirmationReveal.smoke.spec.ts and, for slice 7's Edit copy and slice
// 8's End ride on the paused screen, editCopyConfirmationReveal.smoke.spec.ts
// and endRidePausedConfirmationReveal.smoke.spec.ts).
//
// What the frame recorder below can and cannot show. It samples the open
// confirmation's action buttons on every animation frame, from BEFORE the
// confirmation opens until the rider's click, and so shows whether the
// actions moved by more than 1px across the frames it sampled. It does not
// prove that the reveal lands before the first paint, and it does not
// distinguish a layout effect from a passive one: item 118's own negative
// control for exactly that did not discriminate at 20x or 50x CPU
// throttling, and that finding stands. useLayoutEffect is kept as the
// design guarantee; no claim beyond the sampled stability is made here.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const GAP = 8;

interface Surface {
  dialog: string;
  trigger: string;
}

const PLANNING_DISCLOSURE = "details:has(.planning-routing-disclosure-action-label)";
const PLANNING: Surface = {
  dialog: `${PLANNING_DISCLOSURE} + [role="dialog"]`,
  trigger: `${PLANNING_DISCLOSURE} + .row > button`,
};

function routeCard(routeId: string): Surface {
  const card = `li[data-route-id="${routeId}"]`;
  return {
    dialog: `${card} [role="dialog"]`,
    trigger: `${card} .route-list-item-actions > button.btn-danger`,
  };
}

/** Timer-driven, so it never depends on animation frames being scheduled. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = window.scrollY;
        let stable = 0;
        const tick = () => {
          const now = window.scrollY;
          stable = now === last ? stable + 1 : 0;
          last = now;
          if (stable >= 6) {
            resolve();
            return;
          }
          setTimeout(tick, 25);
        };
        setTimeout(tick, 25);
      }),
  );
}

/** Puts the opening button just inside the bottom of the usable band, so
 * opening needs a reveal. A programmatic scroll the test makes before the
 * app is asked to do anything. */
async function placeNearBandBottom(page: Page, surface: Surface): Promise<void> {
  await page.evaluate(
    ({ trigger, gap }) => {
      const node = document.querySelector(trigger);
      if (!node) throw new Error(`expected ${trigger}`);
      const safeArea =
        Number.parseFloat(
          getComputedStyle(document.documentElement)
            .getPropertyValue("--safe-area-inset-bottom")
            .trim(),
        ) || 0;
      const vv = window.visualViewport;
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const bandBottom = visibleBottom - (safeArea + gap);
      const r = node.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + r.top - (bandBottom - r.height - 4));
    },
    { trigger: surface.trigger, gap: GAP },
  );
  await settle(page);
}

async function recordDeliberateScrolls(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as unknown as {
      __acnScrollBy?: number[];
      __acnPatched?: boolean;
    };
    holder.__acnScrollBy = [];
    if (holder.__acnPatched === true) return;
    holder.__acnPatched = true;
    const original: (options?: ScrollToOptions) => void = window.scrollBy.bind(window);
    window.scrollBy = (options?: ScrollToOptions) => {
      holder.__acnScrollBy?.push(options?.top ?? 0);
      original(options);
    };
  });
}

function deliberateScrolls(page: Page): Promise<number[]> {
  return page.evaluate(
    () => (window as unknown as { __acnScrollBy?: number[] }).__acnScrollBy ?? [],
  );
}

/** Re-implemented per this repository's no-shared-e2e-helpers convention
 * from settings.spec.ts's item 118 recorder, scoped to one confirmation. */
async function installActionGeometryRecorder(
  page: Page,
  dialogSelector: string,
  limitMs: number,
): Promise<void> {
  await page.evaluate(
    ({ dialogSelector, limitMs }) => {
      const w = window as unknown as { __acnActions?: unknown };
      const start = performance.now();
      const recorder = {
        frames: [] as { t: number; actions: { label: string; top: number }[] }[],
        clickAt: null as number | null,
        activatedLabel: null as string | null,
      };
      w.__acnActions = recorder;
      const findDialog = () => document.querySelector(dialogSelector);
      const onClick = (event: MouseEvent) => {
        const target = event.target;
        const button = target instanceof Element ? target.closest("button") : null;
        if (
          recorder.activatedLabel === null &&
          button &&
          findDialog()?.contains(button)
        ) {
          recorder.activatedLabel = button.textContent.trim();
          recorder.clickAt = performance.now() - start;
        }
      };
      document.addEventListener("click", onClick, { capture: true });
      const tick = () => {
        const now = performance.now() - start;
        const dialog = findDialog();
        if (dialog) {
          recorder.frames.push({
            t: now,
            actions: [...dialog.querySelectorAll("button")].map((button) => ({
              label: button.textContent.trim(),
              top: button.getBoundingClientRect().top,
            })),
          });
        }
        if (now < limitMs && recorder.clickAt === null) {
          requestAnimationFrame(tick);
        } else {
          document.removeEventListener("click", onClick, { capture: true });
        }
      };
      requestAnimationFrame(tick);
    },
    { dialogSelector, limitMs },
  );
}

interface ActionGeometryRecording {
  frames: { t: number; actions: { label: string; top: number }[] }[];
  clickAt: number | null;
  activatedLabel: string | null;
}

function readActionGeometry(page: Page): Promise<ActionGeometryRecording> {
  return page.evaluate(
    () => (window as unknown as { __acnActions: ActionGeometryRecording }).__acnActions,
  );
}

const ACTION_RECORD_MS = 4000;
/** Under a 20x CPU throttle on a loaded machine, opening Planning's
 * confirmation and sampling three frames can take longer than the ordinary
 * window; the recorder still stops at the rider's click. */
const THROTTLED_ACTION_RECORD_MS = 20_000;
const ACTION_STABLE_TOLERANCE_PX = 1;
const MIN_ACTIONABLE_FRAMES = 3;

/** Waits for samples, never for stillness, and changes nothing in the
 * recording made from before the confirmation opened. */
async function waitForActionableFrames(page: Page, timeout: number): Promise<void> {
  await expect
    .poll(
      async () =>
        (await readActionGeometry(page)).frames.filter(
          (frame) => frame.actions.length > 0,
        ).length,
      {
        message: `the recorder to capture ${String(MIN_ACTIONABLE_FRAMES)} frames of the open confirmation before Cancel`,
        timeout,
      },
    )
    .toBeGreaterThanOrEqual(MIN_ACTIONABLE_FRAMES);
}

function expectNoSampledDrift(
  recorded: ActionGeometryRecording,
  expectedLabel: string,
): void {
  expect(recorded.clickAt).not.toBeNull();
  const clickAt = recorded.clickAt ?? 0;
  const actionable = recorded.frames.filter(
    (frame) => frame.actions.length > 0 && frame.t <= clickAt,
  );
  expect(actionable.length).toBeGreaterThanOrEqual(MIN_ACTIONABLE_FRAMES);
  const firstByLabel = new Map<string, number>();
  const drift: string[] = [];
  for (const frame of actionable) {
    for (const action of frame.actions) {
      const first = firstByLabel.get(action.label);
      if (first === undefined) {
        firstByLabel.set(action.label, action.top);
        continue;
      }
      const moved = Math.abs(action.top - first);
      if (moved > ACTION_STABLE_TOLERANCE_PX) {
        drift.push(
          `${action.label} moved ${moved.toFixed(1)}px by t=${frame.t.toFixed(0)}ms`,
        );
      }
    }
  }
  expect(drift).toEqual([]);
  expect(recorded.activatedLabel).toBe(expectedLabel);
}

async function openPlanningWithDraft(page: Page, context: BrowserContext): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await installLocalMapStyle(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByTestId("map-container")).toHaveAttribute(
    "data-map-ready",
    "true",
    {
      timeout: 20_000,
    },
  );
  const control = page.locator(".planning-crosshair-callout");
  for (let index = 0; index < 8; index += 1) {
    await expect(control).toBeEnabled({ timeout: 15_000 });
    await control.click();
  }
  await expect(page.locator(".waypoint-list li")).toHaveCount(8);
}

const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const ROUTE_NAMES = Array.from({ length: 8 }, (_, index) => `Route ${String(index + 1)}`);

function buildRouteGpx(): string {
  const points = Array.from({ length: 11 }, (_, index) => {
    const lon = -0.1 + (100 * index) / METRES_PER_DEGREE_LON;
    return `      <trkpt lat="51.5" lon="${String(lon)}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Confirmation reveal test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

async function openRoutesWithLibrary(page: Page, target: string): Promise<string> {
  await installLocalMapStyle(page);
  await page.goto("/");
  for (const name of ROUTE_NAMES) {
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${name}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(buildRouteGpx()),
    });
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  const id = await page
    .locator("li.route-card", {
      has: page.getByRole("button", { name: target, exact: true }),
    })
    .getAttribute("data-route-id");
  if (!id) throw new Error(`expected ${target}'s route id`);
  return id;
}

async function expectSettledActionsThenCancel(
  page: Page,
  surface: Surface,
  cancelLabel: string,
  { recordMs, frameWaitMs }: { recordMs: number; frameWaitMs: number } = {
    recordMs: ACTION_RECORD_MS,
    frameWaitMs: 2_000,
  },
): Promise<void> {
  await placeNearBandBottom(page, surface);
  await installActionGeometryRecorder(page, surface.dialog, recordMs);
  await page.locator(surface.trigger).click();
  const dialog = page.locator(surface.dialog);
  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole("button", { name: cancelLabel });
  await expect(cancel).toBeVisible();
  await waitForActionableFrames(page, frameWaitMs);
  await cancel.click();
  expectNoSampledDrift(await readActionGeometry(page), cancelLabel);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(surface.trigger)).toBeFocused();
}

test("Clear draft: the actions showed no drift across the sampled frames from opening to the rider's click", async ({
  page,
  context,
}) => {
  await openPlanningWithDraft(page, context);
  await expectSettledActionsThenCancel(page, PLANNING, "Cancel");
});

test("Delete route: the actions showed no drift across the sampled frames from opening to the rider's click", async ({
  page,
}) => {
  const routeId = await openRoutesWithLibrary(page, "Route 5");
  await expectSettledActionsThenCancel(page, routeCard(routeId), "Cancel");
});

for (const which of ["Clear draft", "Delete route"] as const) {
  test(`${which}: no sampled drift under a 20x CPU throttle either (sampling only; this does not separate effect timing)`, async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    let surface: Surface;
    if (which === "Clear draft") {
      await openPlanningWithDraft(page, context);
      surface = PLANNING;
    } else {
      surface = routeCard(await openRoutesWithLibrary(page, "Route 5"));
    }
    const cpu = await context.newCDPSession(page);
    await cpu.send("Emulation.setCPUThrottlingRate", { rate: 20 });
    try {
      await expectSettledActionsThenCancel(page, surface, "Cancel", {
        recordMs: THROTTLED_ACTION_RECORD_MS,
        frameWaitMs: 10_000,
      });
    } finally {
      await cpu.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }
  });
}

test("Delete route: a render caused by another tab renaming a different route does not reveal again or move focus", async ({
  page,
  context,
}) => {
  const routeId = await openRoutesWithLibrary(page, "Route 5");
  const surface = routeCard(routeId);
  await placeNearBandBottom(page, surface);
  await page.evaluate((trigger) => {
    document.querySelector<HTMLElement>(trigger)?.click();
  }, surface.trigger);
  await expect(page.locator(surface.dialog)).toHaveCount(1);
  await settle(page);
  const cancel = page.locator(surface.dialog).getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeFocused();
  const scrollYOpen = await page.evaluate(() => window.scrollY);
  await recordDeliberateScrolls(page);

  // The oldest route sorts last, below the target and off screen. A name of
  // the same length leaves every box above it exactly where it was.
  const other = await context.newPage();
  await other.goto("/");
  const otherCard = other.locator("li.route-card", {
    has: other.getByRole("button", { name: "Route 1", exact: true }),
  });
  await otherCard.getByRole("button", { name: "Rename" }).click();
  const nameField = other.getByRole("textbox", { name: "Route name" });
  await nameField.fill("Route Z");
  await nameField.press("Enter");
  await expect(other.getByRole("button", { name: "Route Z", exact: true })).toHaveCount(
    1,
  );

  // Proof that this page rendered the change while its confirmation stayed open.
  await expect(page.getByRole("button", { name: "Route Z", exact: true })).toHaveCount(1);
  await expect(page.locator(surface.dialog)).toHaveCount(1);
  await settle(page);
  expect(await deliberateScrolls(page)).toEqual([]);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollYOpen);
  await expect(cancel).toBeFocused();
  await other.close();
});

// --------------------------------------------------------------------------
// Slice 3: the switch confirmation that Planning's Open saved route shows
// beneath itself when another ride is unfinished. The same narrow claim as
// above: sampled stability of its actions only.

const SAVE_PANEL = ".planning-section:has(#planning-route-name)";
const SAVED_ROUTE_SWITCH: Surface = {
  dialog: `${SAVE_PANEL} > [role="dialog"]`,
  trigger: `${SAVE_PANEL} > .planning-saved-route > button`,
};

async function openPlanningWithSavedRouteAndPausedRide(
  page: Page,
  context: BrowserContext,
): Promise<Record<string, unknown> | null> {
  await page.addInitScript(() => {
    const originalFetch = fetch;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
  });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await installLocalMapStyle(page);
  await page.route("https://api.heigit.org/**", async (route) => {
    const body = route.request().postDataJSON() as { coordinates: number[][] } | null;
    const [start = [-0.1, 51.5], end = [-0.099, 51.501]] = body?.coordinates ?? [];
    const coordinates = Array.from({ length: 6 }, (_, index) => {
      const t = index / 5;
      return [
        (start[0] ?? 0) + t * ((end[0] ?? 0) - (start[0] ?? 0)),
        (start[1] ?? 0) + t * ((end[1] ?? 0) - (start[1] ?? 0)),
        10,
      ];
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { summary: { distance: 100, duration: 20 } },
            geometry: { type: "LineString", coordinates },
          },
        ],
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("OpenRouteService API key").fill("dummy-e2e-key");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();
  await page.getByRole("button", { name: "Routes", exact: true }).click();
  await page.getByLabel("Import GPX file").setInputFiles({
    name: "Paused ride.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildRouteGpx()),
  });
  await expect(
    page.getByRole("button", { name: "Paused ride", exact: true }),
  ).toBeVisible();
  const pausedId = await readSavedRouteId(page, "Paused ride");
  // Written without a reload, so the app does not restore the ride; the
  // guard reads storage at the moment Open saved route is pressed.
  await page.evaluate(
    (routeId) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("amazing-cycling-navigation");
        request.onerror = () => {
          reject(new Error("IndexedDB open failed"));
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("rideState", "readwrite");
          tx.objectStore("rideState").put({
            id: "active",
            kind: "route",
            routeId,
            startedAt: "2026-01-01T08:00:00.000Z",
            lastFix: null,
            lastMatchedPointIndex: 0,
            matchedDistanceFromStartMetres: 0,
            offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(new Error("IndexedDB write failed"));
          };
        };
      }),
    pausedId,
  );
  const rideRow = await readActiveRideStateRow(page);

  await page.getByRole("button", { name: "Plan", exact: true }).click();
  const map = page.getByTestId("map-container");
  await expect(map).toHaveAttribute("data-map-ready", "true", { timeout: 20_000 });
  await map.click({ position: { x: 100, y: 100 } });
  await map.click({ position: { x: 200, y: 150 } });
  await page.getByRole("button", { name: "Calculate route" }).click();
  const save = page.getByRole("button", { name: "Save route" });
  await expect(save).toBeEnabled({ timeout: 15_000 });
  await page.locator("#planning-route-name").fill("Saved beside a paused ride");
  await save.click();
  await expect(page.locator(SAVED_ROUTE_SWITCH.trigger)).toBeVisible();
  return rideRow;
}

test("Planning's saved-route switch confirmation: the actions showed no drift across the sampled frames from opening to the rider's click", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const rideRow = await openPlanningWithSavedRouteAndPausedRide(page, context);
  await expectSettledActionsThenCancel(page, SAVED_ROUTE_SWITCH, "Cancel");
  expect(await readActiveRideStateRow(page)).toEqual(rideRow);
});

test("Planning's saved-route switch confirmation: no sampled drift under a 20x CPU throttle either (sampling only; this does not separate effect timing)", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await openPlanningWithSavedRouteAndPausedRide(page, context);
  const cpu = await context.newCDPSession(page);
  await cpu.send("Emulation.setCPUThrottlingRate", { rate: 20 });
  try {
    await expectSettledActionsThenCancel(page, SAVED_ROUTE_SWITCH, "Cancel", {
      recordMs: THROTTLED_ACTION_RECORD_MS,
      frameWaitMs: 10_000,
    });
  } finally {
    await cpu.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
});

// Slice 7, C-12: Edit copy's replacement confirmation opens only after two
// storage reads, not in the click's own commit — the asynchronous opening
// item 95's prompt also has. At 200% root text in English its bottom opens
// 599 px below the usable band, so its opening is a reveal.

const EDIT_COPY_DIALOG =
  '.ride-start-panel > .stack:not(.ride-end-ride-panel-row) > [role="dialog"]';

async function openPreRideWithDraftAt200(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await installLocalMapStyle(page);
  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: "C-12 reveal route.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildRouteGpx()),
  });
  const routeButton = page.getByRole("button", {
    name: "C-12 reveal route",
    exact: true,
  });
  await expect(routeButton).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("amazing-cycling-navigation");
        request.onerror = () => {
          reject(new Error("IndexedDB open failed"));
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("planningDrafts", "readwrite");
          tx.objectStore("planningDrafts").put({
            id: "draft",
            waypoints: [
              { id: "wp-a", coordinate: [-0.1, 51.5] },
              { id: "wp-b", coordinate: [-0.09, 51.51] },
            ],
            routeName: "Unsaved plan",
            avoidFerries: true,
            profile: "cycling-road",
            updatedAt: "2026-10-03T08:00:00.000Z",
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(new Error("IndexedDB write failed"));
          };
        };
      }),
  );
  await routeButton.click();
  await expect(
    page.getByRole("button", { name: "Edit copy", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await settle(page);
}

async function expectEditCopySettledThenCancel(
  page: Page,
  { recordMs, frameWaitMs }: { recordMs: number; frameWaitMs: number },
): Promise<void> {
  const before = await page.evaluate(() => window.scrollY);
  await installActionGeometryRecorder(page, EDIT_COPY_DIALOG, recordMs);
  const editCopy = page.getByRole("button", { name: "Edit copy", exact: true });
  await editCopy.click();
  const dialog = page.locator(EDIT_COPY_DIALOG);
  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeVisible();
  await waitForActionableFrames(page, frameWaitMs);
  expect(
    (await page.evaluate(() => window.scrollY)) - before,
    "the opening was a reveal",
  ).toBeGreaterThan(100);
  await cancel.click();
  expectNoSampledDrift(await readActionGeometry(page), "Cancel");
  await expect(dialog).toHaveCount(0);
  await expect(editCopy).toBeFocused();
}

test("Edit copy's replacement confirmation: the actions showed no drift across the sampled frames from its asynchronous opening to the rider's click", async ({
  page,
  context,
}) => {
  await openPreRideWithDraftAt200(page, context);
  await expectEditCopySettledThenCancel(page, {
    recordMs: ACTION_RECORD_MS,
    frameWaitMs: 2_000,
  });
});

test("Edit copy's replacement confirmation: no sampled drift under a 20x CPU throttle either (sampling only; this does not separate effect timing)", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await openPreRideWithDraftAt200(page, context);
  const cpu = await context.newCDPSession(page);
  await cpu.send("Emulation.setCPUThrottlingRate", { rate: 20 });
  try {
    await expectEditCopySettledThenCancel(page, {
      recordMs: THROTTLED_ACTION_RECORD_MS,
      frameWaitMs: 10_000,
    });
  } finally {
    await cpu.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
});

// Slice 8, C-11: End ride's confirmation on the paused route screen, which
// opens in the click's own commit. At 200% root text in English its bottom
// opens 535 px below the usable band, so its opening is a reveal.

const END_RIDE_PANEL: Surface = {
  dialog: '.ride-end-ride-panel-row > [role="dialog"]',
  trigger: ".ride-end-ride-panel-row > button",
};

async function openPausedRouteAt200(page: Page, context: BrowserContext): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await installLocalMapStyle(page);
  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: "C-11 reveal route.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildRouteGpx()),
  });
  const routeButton = page.getByRole("button", {
    name: "C-11 reveal route",
    exact: true,
  });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await context.setGeolocation({
    latitude: 51.5,
    longitude: -0.1 + 400 / METRES_PER_DEGREE_LON,
  });
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "route", lastFix: expect.anything() });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeVisible();
  await expect(page.locator("header.app-header--sticky")).toBeAttached();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await settle(page);
}

async function expectEndRideSettledThenCancel(
  page: Page,
  { recordMs, frameWaitMs }: { recordMs: number; frameWaitMs: number },
): Promise<void> {
  const before = await page.evaluate(() => window.scrollY);
  await installActionGeometryRecorder(page, END_RIDE_PANEL.dialog, recordMs);
  await page.locator(END_RIDE_PANEL.trigger).click();
  const dialog = page.locator(END_RIDE_PANEL.dialog);
  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeVisible();
  await waitForActionableFrames(page, frameWaitMs);
  expect(
    (await page.evaluate(() => window.scrollY)) - before,
    "the opening was a reveal",
  ).toBeGreaterThan(100);
  await cancel.click();
  expectNoSampledDrift(await readActionGeometry(page), "Cancel");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(END_RIDE_PANEL.trigger)).toBeFocused();
}

test("End ride's confirmation on the paused screen: the actions showed no drift across the sampled frames from opening to the rider's click", async ({
  page,
  context,
}) => {
  await openPausedRouteAt200(page, context);
  await expectEndRideSettledThenCancel(page, {
    recordMs: ACTION_RECORD_MS,
    frameWaitMs: 2_000,
  });
});

test("End ride's confirmation on the paused screen: no sampled drift under a 20x CPU throttle either (sampling only; this does not separate effect timing)", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await openPausedRouteAt200(page, context);
  const cpu = await context.newCDPSession(page);
  await cpu.send("Emulation.setCPUThrottlingRate", { rate: 20 });
  try {
    await expectEndRideSettledThenCancel(page, {
      recordMs: THROTTLED_ACTION_RECORD_MS,
      frameWaitMs: 10_000,
    });
  } finally {
    await cpu.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
});
