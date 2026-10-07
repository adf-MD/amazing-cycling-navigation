import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import {
  readActiveRideStateRow,
  writeActiveRideStateRow,
} from "./support/rideStateDb.ts";

// Backlog item 125: each primary view — Routes, Plan, Ride, Settings and
// Status — keeps its own scroll position for the current app session.
// Chromium only (a plain .spec.ts); screenScrollRestoration.smoke.spec.ts
// covers a representative subset in WebKit as well. Desktop browsers at
// 390×844 portrait, never the installed iPhone.
//
// Scroll positions are set programmatically, after the arriving view has
// settled, and only ever read back — so every expectation is the page's own
// clamped value. Navigation is real clicks. No live map or routing provider
// is contacted.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;

type View = "L" | "P" | "R" | "S" | "D";

const NAV_LABEL: Record<View, string> = {
  L: "Routes",
  P: "Plan",
  R: "Ride",
  S: "Settings",
  D: "Settings",
};

/** An element only the given view renders. */
const VIEW_MARKER: Record<View, string> = {
  L: ".route-list > li",
  P: "#planning-route-name",
  R: ".ride-start-panel",
  S: "#language-heading",
  D: "#diagnostics-system-status-heading",
};

function lonAtMetres(metres: number): number {
  return ROUTE_START_LON + metres / METRES_PER_DEGREE_LON;
}

function routeGpx(name: string): string {
  const points = Array.from({ length: 21 }, (_, index) => {
    const lon = lonAtMetres(100 * index);
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lon)}"><ele>${String(10 + index)}.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

async function prepare(page: Page, context: BrowserContext): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  await installLocalMapStyle(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  return pageErrors;
}

async function importRoutes(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const name = `Route ${String(index).padStart(2, "0")}`;
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${name}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(routeGpx(name)),
    });
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
}

const mainNav = (page: Page, label: string) =>
  page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: label });
const switcher = (page: Page, label: "Settings" | "Status") =>
  page
    .getByRole("navigation", { name: "Settings and Status" })
    .getByRole("button", { name: label });

/** Waits until scrollY has held still for `quietMs` of timer-driven samples
 * (never animation frames, which headless browsers may defer). */
async function settle(page: Page, quietMs = 150): Promise<number> {
  return page.evaluate(
    (quietMs) =>
      new Promise<number>((resolve) => {
        let last = scrollY;
        let since = performance.now();
        const start = performance.now();
        const tick = () => {
          if (scrollY !== last) {
            last = scrollY;
            since = performance.now();
          }
          if (performance.now() - since >= quietMs || performance.now() - start > 5_000) {
            resolve(scrollY);
            return;
          }
          setTimeout(tick, 10);
        };
        setTimeout(tick, 10);
      }),
    quietMs,
  );
}

const scrollYOf = (page: Page) => page.evaluate(() => scrollY);
const maxScrollOf = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.scrollingElement ?? document.documentElement;
    return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  });

/**
 * Runs a few animation frames, so an arrival's settle loop has finished
 * before a test scrolls programmatically. A rider's own touch or wheel ends
 * that loop at once; a test's scroll is neither. Headless WebKit defers
 * frames until pointer activity, so without this the loop's next frame ran
 * at the test's next click and undid its scroll (as item 121 measured);
 * requesting frames forces them to run.
 */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => {
          frames += 1;
          if (frames >= 6) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** Scrolls the settled view to `fraction` of its range and returns where it
 * landed. */
async function scrollViewTo(page: Page, fraction: number): Promise<number> {
  await settleFrames(page);
  const max = await maxScrollOf(page);
  const target = Math.max(Math.min(40, max), Math.round(max * fraction));
  await page.evaluate((top) => {
    window.scrollTo({ top, left: 0, behavior: "auto" });
  }, target);
  return settle(page);
}

/**
 * Clicks into a view and waits until that view's own marker is present and
 * scrollY holds `expected`. Returns the arrival time measured in the page —
 * from the click to the first sample with both — sampled every 4 ms.
 */
async function arriveAt(
  page: Page,
  click: () => Promise<void>,
  view: View,
  expected: number,
): Promise<number> {
  await page.evaluate(
    ({ marker, expected }) => {
      const record: { clickedAt: number | null; arrivedAt: number | null } = {
        clickedAt: null,
        arrivedAt: null,
      };
      (window as unknown as { __arrival: typeof record }).__arrival = record;
      window.addEventListener(
        "click",
        () => {
          record.clickedAt ??= performance.now();
        },
        { capture: true, once: true },
      );
      const started = performance.now();
      const timer = setInterval(() => {
        if (
          record.clickedAt !== null &&
          document.querySelector(marker) !== null &&
          Math.abs(scrollY - expected) <= 1
        ) {
          record.arrivedAt = performance.now();
          clearInterval(timer);
        } else if (performance.now() - started > 10_000) {
          clearInterval(timer);
        }
      }, 4);
    },
    { marker: VIEW_MARKER[view], expected },
  );
  await click();
  await expect(page.locator(VIEW_MARKER[view]).first()).toBeAttached();
  await expect
    .poll(async () => Math.abs((await scrollYOf(page)) - expected) <= 1, {
      message: `${view} at ${String(expected)}`,
    })
    .toBe(true);
  const landed = await settle(page);
  expect(
    Math.abs(landed - expected),
    `${view} stays at ${String(expected)}`,
  ).toBeLessThanOrEqual(1);
  return page.evaluate(() => {
    const record = (
      window as unknown as {
        __arrival: { clickedAt: number | null; arrivedAt: number | null };
      }
    ).__arrival;
    return record.clickedAt !== null && record.arrivedAt !== null
      ? record.arrivedAt - record.clickedAt
      : Number.NaN;
  });
}

function clickFor(page: Page, from: View, to: View): () => Promise<void> {
  if (from === "S" && to === "D") return () => switcher(page, "Status").click();
  if (from === "D" && to === "S") return () => switcher(page, "Settings").click();
  return () => mainNav(page, NAV_LABEL[to]).click();
}

async function openRouteFromRoutes(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.locator(VIEW_MARKER.R)).toBeVisible();
}

// Every ordered pair of the five views, once each, as consecutive steps
// of one walk. Entering the Settings section from another tab opens its
// last-viewed view, so the order honours that (found by search).
const WALK: readonly View[] = [
  "L",
  "P",
  "L",
  "R",
  "L",
  "S",
  "P",
  "R",
  "P",
  "S",
  "R",
  "S",
  "D",
  "L",
  "D",
  "P",
  "D",
  "R",
  "D",
  "S",
  "L",
];

test("every ordered pair of the five views restores each view's own position, never another's", async ({
  page,
  context,
}) => {
  const pageErrors = await prepare(page, context);
  await page.goto("/");
  await importRoutes(page, 12);
  await openRouteFromRoutes(page, "Route 00"); // Ride shows a pre-ride screen
  await mainNav(page, "Routes").click();
  await expect(page.locator(VIEW_MARKER.L).first()).toBeVisible();

  const saved = new Map<View, number>([["L", await settle(page)]]);
  const fractions = [0.35, 0.8, 0.55, 0.2, 0.65];
  const arrivals: { step: string; ms: number }[] = [];
  const started = Date.now();
  saved.set("L", await scrollViewTo(page, 0.5));

  for (let index = 1; index < WALK.length; index += 1) {
    const from = WALK[index - 1];
    const to = WALK[index];
    const expected = saved.get(to) ?? 0;
    const ms = await arriveAt(page, clickFor(page, from, to), to, expected);
    arrivals.push({ step: `${from}→${to} (${String(expected)})`, ms });
    saved.set(to, await scrollViewTo(page, fractions[index % fractions.length] ?? 0.5));
  }

  test.info().annotations.push({
    type: "arrival-ms",
    description: arrivals.map(({ step, ms }) => `${step}: ${ms.toFixed(0)}`).join("; "),
  });
  test.info().annotations.push({
    type: "walk-ms",
    description: String(Date.now() - started),
  });
  // Each view really had a distinct position of its own to come back to.
  expect(new Set(saved.values()).size).toBe(5);
  expect(pageErrors).toEqual([]);
});

test("a paused ride's screen comes back after its session is restored; End ride then shows the launcher from the top", async ({
  page,
  context,
}) => {
  const pageErrors = await prepare(page, context);
  await page.goto("/");
  await importRoutes(page, 1);
  await openRouteFromRoutes(page, "Route 00");
  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "route", lastFix: expect.anything() });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeVisible();
  await settle(page);
  const pausedAt = await scrollViewTo(page, 0.7);
  expect(pausedAt).toBeGreaterThan(40);

  await mainNav(page, "Plan").click();
  await expect(page.locator(VIEW_MARKER.P)).toBeAttached();
  await settle(page);
  await scrollViewTo(page, 0.3);

  await arriveAt(page, () => mainNav(page, "Ride").click(), "R", pausedAt);
  await expect(page.getByRole("button", { name: "Resume ride" })).toBeVisible();

  const panel = page.locator(".ride-start-panel");
  await panel.getByRole("button", { name: "End ride", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "End ride", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Choose a route" })).toBeVisible();
  await expect.poll(() => scrollYOf(page)).toBe(0);
  expect(pageErrors).toEqual([]);
});

/** Holds every storage estimate until released, so Status's content stays
 * unsettled; installed before the page loads. */
async function installEstimateHold(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const storage = navigator.storage as StorageManager | undefined;
    if (!storage) return;
    const original = storage.estimate.bind(storage);
    let release: () => void = () => undefined;
    let gate: Promise<void> = Promise.resolve();
    const control = {
      hold() {
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      release() {
        release();
      },
    };
    (window as unknown as { __estimateHold: typeof control }).__estimateHold = control;
    storage.estimate = async () => {
      await gate;
      return original();
    };
  });
}

/** Records every scroll call the app itself makes, from the start. */
async function installScrollCallRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { __appScrolls: string[] }).__appScrolls = calls;
    const scrollTo = window.scrollTo.bind(window);
    window.scrollTo = ((...args: Parameters<typeof window.scrollTo>) => {
      calls.push(`scrollTo ${JSON.stringify(args)}`);
      scrollTo(...args);
    }) as typeof window.scrollTo;
    const scrollBy = window.scrollBy.bind(window);
    window.scrollBy = ((...args: Parameters<typeof window.scrollBy>) => {
      calls.push(`scrollBy ${JSON.stringify(args)}`);
      scrollBy(...args);
    }) as typeof window.scrollBy;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (
      this: Element,
      arg?: boolean | ScrollIntoViewOptions,
    ) {
      calls.push("scrollIntoView");
      scrollIntoView.call(this, arg);
    };
  });
}

const resetScrollCalls = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __appScrolls: string[] }).__appScrolls.length = 0;
  });
const scrollCalls = (page: Page) =>
  page.evaluate(() => [
    ...(window as unknown as { __appScrolls: string[] }).__appScrolls,
  ]);

const holdEstimates = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __estimateHold: { hold(): void } }).__estimateHold.hold();
  });
const releaseEstimates = (page: Page) =>
  page.evaluate(() => {
    (
      window as unknown as { __estimateHold: { release(): void } }
    ).__estimateHold.release();
  });

async function statusWithPosition(
  page: Page,
): Promise<{ routesAt: number; statusAt: number }> {
  await page.goto("/");
  await importRoutes(page, 12);
  await mainNav(page, "Settings").click();
  await switcher(page, "Status").click();
  await expect(page.locator(VIEW_MARKER.D)).toBeAttached();
  await settle(page);
  const statusAt = await scrollViewTo(page, 0.6);
  await mainNav(page, "Routes").click();
  await expect(page.locator(VIEW_MARKER.L).first()).toBeVisible();
  await settle(page);
  const routesAt = await scrollViewTo(page, 0.25);
  expect(routesAt).not.toBe(statusAt);
  return { routesAt, statusAt };
}

test("Status waits for its storage estimate before coming back, and leaving it while it waits keeps its position", async ({
  page,
  context,
}) => {
  await prepare(page, context);
  await installEstimateHold(page);
  const { routesAt, statusAt } = await statusWithPosition(page);

  await holdEstimates(page);
  await mainNav(page, "Settings").click(); // Status, its estimate held
  await expect(page.getByText("Checking storage estimate…")).toBeVisible();
  await settle(page, 300);
  expect(await scrollYOf(page), "not restored while still loading").not.toBe(statusAt);

  await arriveAt(page, () => mainNav(page, "Routes").click(), "L", routesAt);
  await releaseEstimates(page);
  await arriveAt(page, () => mainNav(page, "Settings").click(), "D", statusAt);
});

test("a rider's wheel while Status is still loading cancels its restore for good", async ({
  page,
  context,
}) => {
  await prepare(page, context);
  await installEstimateHold(page);
  await installScrollCallRecorder(page);
  const { statusAt } = await statusWithPosition(page);

  await holdEstimates(page);
  await mainNav(page, "Settings").click();
  await expect(page.getByText("Checking storage estimate…")).toBeVisible();
  await page.mouse.move(6, 600);
  await page.mouse.wheel(0, 120);
  await settle(page);
  await resetScrollCalls(page);
  await releaseEstimates(page);
  await expect(page.getByText("Checking storage estimate…")).toBeHidden();
  const final = await settle(page, 400);

  // The estimate's lines arriving above can still move the page through the
  // browser's own scroll anchoring; what must not happen is the app
  // restoring Status's saved position after the rider's wheel.
  expect(await scrollCalls(page), "the app made no scroll call").toEqual([]);
  expect(final).not.toBe(statusAt);
});

test("a view that has become shorter than its saved position comes back clamped to its new bottom, and stays there", async ({
  page,
  context,
}) => {
  await prepare(page, context);
  await page.goto("/");
  await importRoutes(page, 12);
  await settle(page);
  const bottom = await scrollViewTo(page, 1);
  await mainNav(page, "Plan").click();
  await expect(page.locator(VIEW_MARKER.P)).toBeAttached();
  await settle(page);

  // A taller window while away leaves Routes less to scroll: its saved
  // position is now beyond its bottom.
  await page.setViewportSize({ width: 390, height: 1300 });
  await mainNav(page, "Routes").click();
  await expect(page.locator(VIEW_MARKER.L).first()).toBeVisible();
  const settledAt = await settle(page, 400);
  const newBottom = await maxScrollOf(page);

  expect(newBottom).toBeLessThan(bottom);
  expect(Math.abs(settledAt - newBottom)).toBeLessThanOrEqual(1);
});

test("a carried-over switch prompt that takes focus on arrival wins over the restore, on Plan and on Routes", async ({
  page,
  context,
}) => {
  await prepare(page, context);
  await page.goto("/");
  await importRoutes(page, 12);
  // Plan, with a position of its own to come back to.
  await mainNav(page, "Plan").click();
  await expect(page.locator(VIEW_MARKER.P)).toBeAttached();
  await settle(page);
  const planAt = await scrollViewTo(page, 0.8);
  await mainNav(page, "Routes").click();
  await expect(page.locator(VIEW_MARKER.L).first()).toBeVisible();
  await settle(page);

  // A paused ride on the oldest route, at the bottom of the list.
  const routes = await page.evaluate(
    (dbName) =>
      new Promise<{ id: string; name: string }[]>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => {
          reject(new Error("open failed"));
        };
        open.onsuccess = () => {
          const request = open.result
            .transaction("routes")
            .objectStore("routes")
            .getAll();
          request.onsuccess = () => {
            open.result.close();
            resolve(
              (request.result as { id: string; name: string }[]).map(({ id, name }) => ({
                id,
                name,
              })),
            );
          };
        };
      }),
    DB_NAME,
  );
  const paused = routes.find((route) => route.name === "Route 00");
  if (!paused) throw new Error("expected Route 00");
  await writeActiveRideStateRow(page, {
    id: "active",
    kind: "route",
    routeId: paused.id,
    startedAt: "2026-01-01T08:00:00.000Z",
    sessionId: "seeded-route-session",
    lastFix: null,
    lastMatchedPointIndex: 0,
    matchedDistanceFromStartMetres: 0,
    offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
  });

  // The newest route's card is at the top: its switch prompt opens there.
  await settleFrames(page);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await settle(page);
  await page.getByRole("button", { name: "Route 11", exact: true }).click();
  const inline = page.locator("li").filter({ hasText: "Route 11" }).getByRole("dialog");
  await expect(inline).toBeVisible();
  const routesAt = await scrollViewTo(page, 1); // Routes left at its bottom
  expect(routesAt).toBeGreaterThan(400);

  // Plan: the page-level dialog takes focus as Plan arrives.
  await mainNav(page, "Plan").click();
  const pageLevel = page.locator(".app-shell > [role='dialog']");
  await expect(pageLevel).toBeVisible();
  await settle(page, 300);
  await expect(pageLevel.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(pageLevel).toBeInViewport();
  expect(await scrollYOf(page), "Plan's own position yields to the dialog").not.toBe(
    planAt,
  );

  // Routes: the card's prompt takes focus again as Routes arrives.
  await mainNav(page, "Routes").click();
  await expect(inline).toBeVisible();
  await settle(page, 300);
  await expect(inline.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(inline).toBeInViewport();
  expect(await scrollYOf(page), "Routes' own position yields to the prompt").not.toBe(
    routesAt,
  );
});

test("the deliberate starts at the top: Edit copy opens Plan at the top, and Plan's Open Settings opens Settings at the top", async ({
  page,
  context,
}) => {
  await prepare(page, context);
  await page.goto("/");
  await importRoutes(page, 1);
  await mainNav(page, "Settings").click();
  await expect(page.locator(VIEW_MARKER.S)).toBeAttached();
  await settle(page);
  const settingsAt = await scrollViewTo(page, 0.7);
  await mainNav(page, "Plan").click();
  await expect(page.locator(VIEW_MARKER.P)).toBeAttached();
  await settle(page);
  const planAt = await scrollViewTo(page, 0.6);
  expect(planAt).toBeGreaterThan(40);

  await page.getByRole("button", { name: "Open Settings" }).click();
  await expect(page.locator(VIEW_MARKER.S)).toBeAttached();
  await expect.poll(() => scrollYOf(page)).toBe(0);
  expect(settingsAt).toBeGreaterThan(40);

  await mainNav(page, "Routes").click();
  await openRouteFromRoutes(page, "Route 00");
  await settle(page);
  await scrollViewTo(page, 0.6);
  await page.getByRole("button", { name: "Edit copy" }).click();
  await expect(page.locator(VIEW_MARKER.P)).toBeAttached();
  await expect(page.getByRole("button", { name: /Editing a copy/ })).toBeVisible();
  await expect.poll(() => scrollYOf(page)).toBe(0);
  expect(await settle(page)).toBe(0);
});

test("a reload remembers nothing: Routes and then Plan start at the top", async ({
  page,
  context,
}) => {
  await prepare(page, context);
  await page.goto("/");
  await importRoutes(page, 12);
  await mainNav(page, "Plan").click();
  await expect(page.locator(VIEW_MARKER.P)).toBeAttached();
  await settle(page);
  expect(await scrollViewTo(page, 0.6)).toBeGreaterThan(40);
  await mainNav(page, "Routes").click();
  await expect(page.locator(VIEW_MARKER.L).first()).toBeVisible();
  await settle(page);
  expect(await scrollViewTo(page, 0.7)).toBeGreaterThan(400);

  await page.reload();
  await expect(page.locator(VIEW_MARKER.L).first()).toBeVisible();
  expect(await settle(page, 400), "Routes after the reload").toBe(0);
  await mainNav(page, "Plan").click();
  await expect(page.locator(VIEW_MARKER.P)).toBeAttached();
  expect(await settle(page, 300), "Plan after the reload").toBe(0);
});
