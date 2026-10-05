import { expect, test, type Locator, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

// Backlog item 122: item 114's enlarged-text switch reads a size reference
// with the map's width. Since item 122 the enlarged layout also shortens
// the map, by up to 100px, so on a desktop browser with classic scrollbars
// engaging can make the page stop scrolling, remove the scrollbar and widen
// the reference by about 15px — more than the switch's 0.25rem hysteresis.
// That made the layout flip continuously near that height, so the switch
// now adds back whatever width the scrollbar takes (useEnlargedTextLayout).
// This checks, in Chromium with its classic scrollbars shown, that the
// layout settles without repeated switching while the window height
// crosses the point where the page stops scrolling.
//
// The case is deliberately narrow: a width-governed window (400px), a root
// font at the engage boundary (21px: 353px with a scrollbar engages, 368px
// without one releases), and window heights around the page's own height.
// It is desktop evidence only; iPhone overlay scrollbars take no width.

test.use({
  serviceWorkers: "block",
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
});

const DB_NAME = "amazing-cycling-navigation";
const ROOT_FONT = "21px";
const WIDTH = 400;

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

interface State {
  enlarged: boolean;
  scrollbarWidth: number;
  scrollHeight: number;
  /** The width item 114's switch reads: the size reference's. */
  referenceWidth: number;
  flips: number;
}

async function read(page: Page): Promise<State> {
  return page.evaluate(() => {
    const map = document.querySelector(".planning-map-container");
    if (!map) throw new Error("no map");
    return {
      enlarged: map.classList.contains("planning-map-container--enlarged-text"),
      scrollbarWidth: window.innerWidth - document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      referenceWidth:
        document.querySelector(".planning-map-size-reference")?.getBoundingClientRect()
          .width ?? Number.NaN,
      flips: (window as unknown as { __flips: number }).__flips,
    };
  });
}

test("with a classic scrollbar, item 114's switch settles without repeated switching while the window height crosses the point where the page stops scrolling", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: WIDTH, height: 1200 });
  await installLocalMapStyle(page);
  await page.goto("/");
  await expect(navButton(page, "Plan")).toBeVisible();
  await writeRows(page, [
    {
      store: "planningDrafts",
      row: {
        id: "draft",
        waypoints: [
          { id: "wp-a", coordinate: [-0.1, 51.5] },
          { id: "wp-b", coordinate: [-0.09, 51.51] },
          { id: "wp-c", coordinate: [-0.08, 51.5] },
        ],
        routeName: "Scrollbar check",
        avoidFerries: true,
        profile: "cycling-road",
        updatedAt: "2026-10-05T08:00:00.000Z",
      },
    },
  ]);
  await page.reload();
  await navButton(page, "Plan").click();
  await expect(page.getByLabel("Route name", { exact: true })).toHaveValue(
    "Scrollbar check",
  );
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await page.evaluate((root) => {
    document.documentElement.style.fontSize = root;
    const w = window as unknown as { __flips: number };
    w.__flips = 0;
    const map = document.querySelector(".planning-map-container");
    if (!map) throw new Error("no map");
    new MutationObserver(() => {
      w.__flips += 1;
    }).observe(map, { attributes: true, attributeFilter: ["class"] });
  }, ROOT_FONT);
  await page.waitForTimeout(800);

  // Precondition: at 1200px the page scrolls, and the scrollbar takes width.
  const overflowing = await read(page);
  expect(overflowing.scrollHeight).toBeGreaterThan(1200);
  expect(
    overflowing.scrollbarWidth,
    "classic scrollbars take width in this browser",
  ).toBeGreaterThanOrEqual(10);

  // While the page scrolls, its scrollHeight is its content height. Sweep
  // the window height across both layouts' heights (the ordinary one is up
  // to 100px taller), so the page goes from scrolling to fitting in either.
  // Before the fix, the layout flipped continuously at 2003-2023px here
  // (21-25 class changes in 800ms), from about 2003px of content.
  const contentHeight = overflowing.scrollHeight;
  const results: (State & { height: number; ongoing: number })[] = [];
  for (let height = contentHeight - 150; height <= contentHeight + 150; height += 10) {
    await page.setViewportSize({ width: WIDTH, height });
    await page.waitForTimeout(500);
    const settled = await read(page);
    await page.waitForTimeout(800);
    const later = await read(page);
    results.push({ ...later, height, ongoing: later.flips - settled.flips });
  }
  console.log(`SCROLLBAR ${JSON.stringify({ contentHeight, results })}`);
  test.info().annotations.push({
    type: "measurement",
    description: JSON.stringify({ contentHeight, results }),
  });

  // The sweep crossed the point where the page stops scrolling.
  expect(results.some((r) => r.scrollHeight > r.height)).toBe(true);
  expect(results.some((r) => r.scrollHeight <= r.height)).toBe(true);
  // Every height settled: no class changes once the layout had had time.
  expect(results.filter((r) => r.ongoing > 0)).toEqual([]);
  // The switch's width input — the reference's width plus whatever width
  // the scrollbar takes — is the same whether or not the page scrolls.
  expect(new Set(results.map((r) => r.referenceWidth + r.scrollbarWidth)).size).toBe(1);
});
