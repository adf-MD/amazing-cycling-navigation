import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readSavedRouteId, writeActiveRideStateRow } from "./support/rideStateDb.ts";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Status is intentionally allowed to scroll vertically (unlike the
// short Routes screen visualFoundation.spec.ts's own isFullyWithin check
// was written for) — so only horizontal containment is checked here, per
// this slice's own "no horizontal overflow" requirement.
function isHorizontallyWithin(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x && inner.x + inner.width <= outer.x + outer.width;
}

// Narrow iPhone-width portrait viewport — the project's primary target
// device (see CLAUDE.md), matching visualFoundation.spec.ts's own
// convention. This file deliberately never runs "Test routing connection"
// for real: App.tsx gives end-to-end rendering no routingProvider
// injection point, so the no-key state alone (button visibly disabled,
// no network request possible) proves the migrated layout.
test.use({ viewport: { width: 390, height: 844 } });

/**
 * A browser-level stub for navigator.storage.estimate — Chromium/WebKit
 * already implement the real API, so "unsupported" must be produced by
 * explicitly overriding navigator.storage to undefined, not by doing
 * nothing. Defined via Object.defineProperty on the navigator instance so
 * it reliably shadows the real implementation, mirroring
 * ridingWakeLock.spec.ts's installStubWakeLock.
 */
async function stubStorageEstimate(
  page: Page,
  outcome:
    | { kind: "unsupported" }
    | { kind: "rejects" }
    | { kind: "resolves"; usage: number; quota: number },
) {
  await page.addInitScript((outcome) => {
    if (outcome.kind === "unsupported") {
      Object.defineProperty(navigator, "storage", {
        value: undefined,
        configurable: true,
      });
      return;
    }
    const estimate =
      outcome.kind === "rejects"
        ? () => Promise.reject(new Error("simulated quota-check failure"))
        : () => Promise.resolve({ usage: outcome.usage, quota: outcome.quota });
    Object.defineProperty(navigator, "storage", {
      value: { estimate },
      configurable: true,
    });
  }, outcome);
}

function storageDetailValue(page: Page) {
  return page
    .getByText("Storage", { exact: true })
    .locator("xpath=following-sibling::dd[1]");
}

test("shows a non-blank storage estimate reaching an OK state, without horizontal scrolling", async ({
  page,
}) => {
  await stubStorageEstimate(page, {
    kind: "resolves",
    usage: 1_048_576,
    quota: 500 * 1024 * 1024,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Status", exact: true }).click();

  const storageValue = storageDetailValue(page);
  await expect(storageValue).toContainText("OK (schema version");
  await expect(storageValue).toContainText("Estimated app storage");

  const hasNoHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(hasNoHorizontalScroll).toBe(true);
});

test("flags exactly-90%-usage as an explicit storage pressure warning", async ({
  page,
}) => {
  await stubStorageEstimate(page, { kind: "resolves", usage: 900, quota: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Status", exact: true }).click();

  const storageValue = storageDetailValue(page);
  await expect(storageValue).toContainText("(90%)");
  await expect(storageValue).toContainText(
    "Storage pressure warning: estimated app storage usage is high.",
  );
});

test("falls back to an unavailable estimate without breaking the OK status when estimate() rejects, without horizontal scrolling", async ({
  page,
}) => {
  await stubStorageEstimate(page, { kind: "rejects" });
  await page.goto("/");
  await page.getByRole("button", { name: "Status", exact: true }).click();

  const storageValue = storageDetailValue(page);
  await expect(storageValue).toContainText("OK (schema version");
  await expect(storageValue).toContainText("Estimated app storage: unavailable");

  const hasNoHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(hasNoHorizontalScroll).toBe(true);
});

test("Status renders its four sections without horizontal scrolling, with the fetch-failure explanation collapsed by default", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Status", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Status", level: 1 })).toBeVisible();

  const hasNoHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(hasNoHorizontalScroll).toBe(true);

  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "System status",
    "Recent errors",
    "Routing diagnostics",
    "Recent map imagery attempts",
  ]);

  const routingRegion = page.getByRole("region", { name: "Routing diagnostics" });
  await expect(
    routingRegion.getByRole("heading", { name: "Recent routing attempts", level: 3 }),
  ).toBeVisible();
  await expect(
    routingRegion.getByRole("heading", { name: "Test routing connection", level: 3 }),
  ).toBeVisible();

  const explanation = routingRegion.getByText(/missing CORS headers/i);
  await expect(explanation).toBeHidden();
  // exact: true because item 101's "No status shown" guidance row quotes
  // this disclosure's title verbatim to cross-reference it, and
  // Playwright's getByText matches substrings by default. A stricter
  // locator, not a weaker one.
  await routingRegion
    .getByText("Why a fetch can fail before an HTTP response", { exact: true })
    .click();
  await expect(explanation).toBeVisible();

  await expect(
    routingRegion.getByText("No OpenRouteService key configured."),
  ).toBeVisible();
  const testButton = routingRegion.getByRole("button", {
    name: "Test routing connection",
  });
  await expect(testButton).toBeVisible();
  await expect(testButton).toBeDisabled();

  const viewportBox: Box = { x: 0, y: 0, width: 390, height: 844 };
  for (const button of await page.getByRole("button").all()) {
    const box = await button.boundingBox();
    if (!box) throw new Error("expected a bounding box for a visible button");
    expect(isHorizontallyWithin(box, viewportBox)).toBe(true);
  }
});

/**
 * Backlog item 101. The two Routing disclosures are independent native
 * <details>, so this exercises them the way a real reader does: pointer
 * and keyboard, checking each element's own `open` state rather than a
 * derived role. Deliberately no routing request — see this file's own
 * header note on why one cannot be made here at all.
 */
// Backlog item 112's two copy corrections on this screen. "Active route" was
// a documented misnomer — the row already rendered "Free roam" for a
// free-roam session — and the missing-key hint was a dead end at exactly the
// moment the screen matters, disabling the test without saying where a key is
// entered. Copy only: no navigation is wired from here, so the button must
// still be disabled.
test("labels the session row Active session and points a missing key at Settings", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Status", exact: true }).click();

  const sessionValue = page
    .getByText("Active session", { exact: true })
    .locator("xpath=following-sibling::dd[1]");
  await expect(sessionValue).toHaveText("None");
  await expect(page.getByText("Active route", { exact: true })).toHaveCount(0);

  const noKeyHint = page.getByText(/No OpenRouteService key configured/);
  await expect(noKeyHint).toContainText("Settings");
  await expect(
    page.getByRole("button", { name: "Test routing connection" }),
  ).toBeDisabled();
});

test("explains HTTP statuses in a second, independently operable disclosure", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Status", exact: true }).click();

  const routingRegion = page.getByRole("region", { name: "Routing diagnostics" });
  // exact: true throughout — the "No status shown" guidance row quotes
  // the other disclosure's title verbatim, so Playwright's default
  // substring matching would resolve two elements.
  const fetchSummary = routingRegion.getByText(
    "Why a fetch can fail before an HTTP response",
    { exact: true },
  );
  const statusSummary = routingRegion.getByText("What HTTP statuses mean", {
    exact: true,
  });
  // `has:` re-roots its inner locator at each candidate <details>, so it
  // must be page-rooted rather than the region-scoped locators above.
  const fetchDisclosure = routingRegion.locator("details", {
    has: page.getByText("Why a fetch can fail before an HTTP response", {
      exact: true,
    }),
  });
  const statusDisclosure = routingRegion.locator("details", {
    has: page.getByText("What HTTP statuses mean", { exact: true }),
  });

  const isOpen = (locator: ReturnType<Page["locator"]>) =>
    locator.evaluate((element) => (element as HTMLDetailsElement).open);

  expect(await isOpen(fetchDisclosure)).toBe(false);
  expect(await isOpen(statusDisclosure)).toBe(false);

  // Pointer: opening one leaves the other closed.
  await statusSummary.click();
  expect(await isOpen(statusDisclosure)).toBe(true);
  expect(await isOpen(fetchDisclosure)).toBe(false);

  // Item 101 follow-up: the guidance is grouped by status class as
  // nested native lists. Five group rows, each owning its own inner list.
  const groups = statusDisclosure.locator(":scope > ul > li");
  await expect(groups).toHaveCount(5);
  await expect(groups.locator(":scope > strong")).toHaveText([
    "Success (2xx)",
    "Redirects (3xx)",
    "Request or access problems (4xx)",
    "Service problems (5xx)",
    "No HTTP status",
  ]);

  const rowsOf = (index: number) => groups.nth(index).locator(":scope > ul > li");
  await expect(rowsOf(0)).toHaveCount(1);
  await expect(rowsOf(0)).toContainText("the normal successful response");
  await expect(rowsOf(1)).toHaveCount(1);
  await expect(rowsOf(1)).toContainText("normally follows redirects automatically");
  await expect(rowsOf(2)).toHaveCount(8);
  await expect(rowsOf(2).nth(1)).toContainText("exhausted daily allowance");
  await expect(rowsOf(2).nth(3)).toContainText("the request method was not accepted");
  await expect(rowsOf(2).nth(5)).toContainText("a size or capacity limit");
  await expect(rowsOf(3)).toHaveCount(3);
  await expect(rowsOf(3).nth(1)).toContainText("does not support functionality");
  await expect(rowsOf(4)).toHaveCount(1);
  await expect(rowsOf(4)).toContainText("No HTTP response was exposed to the browser");

  // Keyboard: the native summary is focusable and toggles on Enter, then
  // on Space — the browser is where that belongs, not jsdom.
  await fetchSummary.focus();
  await page.keyboard.press("Enter");
  expect(await isOpen(fetchDisclosure)).toBe(true);
  expect(await isOpen(statusDisclosure)).toBe(true);
  await page.keyboard.press(" ");
  expect(await isOpen(fetchDisclosure)).toBe(false);
  expect(await isOpen(statusDisclosure)).toBe(true);

  // The no-response explanation still resolves uniquely and now quotes
  // the entry the application really produces.
  await expect(routingRegion.getByText(/missing CORS headers/i)).toHaveCount(1);
  await fetchSummary.click();
  await expect(
    routingRegion.getByText(/Fetch promise rejected before an HTTP response was exposed/),
  ).toBeVisible();

  // With both open at default text size, the document still must not
  // scroll horizontally.
  const hasNoHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(hasNoHorizontalScroll).toBe(true);
});

test.describe("200% text at ordinary phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * Backlog item 101's enlarged-text evidence, scoped to the Routing diagnostics region
   * rather than the whole document because that region is what item 101 governs. This note
   * used to say a primary-navigation overflow made a document-level assertion impossible;
   * that attribution was wrong — item 112 measured the navigation's own contribution to
   * document scrollWidth at 200% text as zero, in Chromium, WebKit and the Pixel-7 preset.
   * What is asserted is that the region has no horizontal overflow of its own, and that
   * both disclosures and every guidance row stay horizontally within the viewport. Only
   * <summary> is interactive, so only <summary> carries the 44px minimum — a <details>
   * wrapper and a non-interactive <li> are not touch targets.
   */
  test("keeps both routing disclosures readable and horizontally contained at 200% text", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Status", exact: true }).click();

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    const routingRegion = page.getByRole("region", { name: "Routing diagnostics" });
    await routingRegion
      .getByText("Why a fetch can fail before an HTTP response", { exact: true })
      .click();
    await routingRegion.getByText("What HTTP statuses mean", { exact: true }).click();

    const viewportBox: Box = { x: 0, y: 0, width: 390, height: 844 };

    for (const disclosure of await routingRegion.locator("details").all()) {
      const box = await disclosure.boundingBox();
      if (!box) throw new Error("expected a bounding box for a disclosure");
      expect(isHorizontallyWithin(box, viewportBox)).toBe(true);
    }

    // Every list item — the five group rows and every nested code row.
    const guidance = routingRegion.getByRole("listitem");
    await expect(guidance).toHaveCount(19);
    for (const row of await guidance.all()) {
      const box = await row.boundingBox();
      if (!box) throw new Error("expected a bounding box for a guidance row");
      expect(isHorizontallyWithin(box, viewportBox)).toBe(true);

      // Nothing is clipped: no row overflows its own box in either
      // direction. A short row legitimately occupies a single line, so
      // asserting a minimum height would prove nothing about wrapping —
      // this checks the requirement itself instead.
      const overflow = await row.evaluate((element) => ({
        horizontal: element.scrollWidth - element.clientWidth,
        vertical: element.scrollHeight - element.clientHeight,
      }));
      expect(overflow.horizontal).toBeLessThanOrEqual(1);
      expect(overflow.vertical).toBeLessThanOrEqual(1);
    }

    // And a genuinely long row really does wrap onto several lines
    // rather than being cut off — measured against its own computed font
    // size, not a hard-coded pixel figure.
    // Scoped to the nested code rows: a plain listitem filter would also
    // match the enclosing group <li>, which contains this text too.
    const longRow = routingRegion
      .locator("li > ul > li")
      .filter({ hasText: "exhausted daily allowance" });
    await expect(longRow).toHaveCount(1);
    const wrapping = await longRow.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      fontSize: Number.parseFloat(window.getComputedStyle(element).fontSize),
    }));
    expect(wrapping.fontSize).toBeGreaterThan(20);
    expect(wrapping.height).toBeGreaterThan(wrapping.fontSize * 3);

    for (const summary of await routingRegion.locator("summary").all()) {
      const box = await summary.boundingBox();
      if (!box) throw new Error("expected a bounding box for a summary");
      expect(isHorizontallyWithin(box, viewportBox)).toBe(true);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    const regionOverflow = await routingRegion.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(regionOverflow).toBeLessThanOrEqual(1);
  });
});

/**
 * Backlog item 117. The Status screen's `Active session` row used to render
 * the stored route's raw identifier; it now shows the route's own name.
 *
 * Seeded through the repository's real seams rather than by mocking the
 * storage boundary that caused the problem: the route is imported through
 * the ordinary GPX flow, its id is read back from IndexedDB, and a
 * route-backed session row is written to the same real database. Starting
 * an actual ride would work too, but it needs a map and it hides the
 * navigation behind the immersive shell — neither of which this file's
 * setup has, or needs.
 */
const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

async function importRouteNamed(page: Page, routeName: string): Promise<string> {
  const gpx = await readFile(FIXTURE_GPX_PATH, "utf-8");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${routeName}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(gpx),
  });
  await expect(page.getByRole("button", { name: routeName, exact: true })).toBeVisible();
  const routeId = await readSavedRouteId(page, routeName);
  expect(routeId).not.toBeNull();
  if (routeId === null) throw new Error("expected the imported route to have an id");
  return routeId;
}

async function seedRouteSession(page: Page, routeName: string): Promise<string> {
  const routeId = await importRouteNamed(page, routeName);
  await writeActiveRideStateRow(page, {
    id: "active",
    routeId,
    startedAt: "2026-01-01T08:00:00.000Z",
    lastFix: null,
    lastMatchedPointIndex: 0,
    matchedDistanceFromStartMetres: 0,
    offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
  });
  return routeId;
}

function activeSessionValue(page: Page) {
  return page
    .getByText("Active session", { exact: true })
    .locator("xpath=following-sibling::dd[1]");
}

async function openStatus(page: Page) {
  await page.getByRole("button", { name: "Status", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Status", level: 1 })).toBeVisible();
}

test("shows an active route-backed session by name, never by its identifier", async ({
  page,
}) => {
  await page.goto("/");
  const routeId = await seedRouteSession(page, "Evening loop");

  await openStatus(page);

  await expect(activeSessionValue(page)).toHaveText("Evening loop");
  // The identifier must not appear anywhere on the screen, not merely in
  // this row — and not transiently while the name resolves either.
  expect(await page.locator("body").innerText()).not.toContain(routeId);
});

test("falls back honestly when the session's route has been deleted", async ({
  page,
}) => {
  await page.goto("/");
  const routeId = await seedRouteSession(page, "Evening loop");
  // Through the real delete flow, which deliberately does not clear the
  // active ride state — so the dangling reference this asserts against is
  // the one a rider can actually produce.
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete route" })
    .click();
  await expect(
    page.getByRole("button", { name: "Evening loop", exact: true }),
  ).toHaveCount(0);

  await openStatus(page);

  await expect(activeSessionValue(page)).toHaveText("Route unavailable");
  expect(await page.locator("body").innerText()).not.toContain(routeId);
});

test.describe("long route names in the Active session row (backlog item 117)", () => {
  // Removing the monospace treatment must not remove the wrapping a long
  // name needs. Both an ordinary multi-word name and an unbroken compound
  // of the kind German produces, at ordinary and 200% root text.
  const LONG_WORDS = "A very long multi word route name that has to wrap somewhere";
  const LONG_COMPOUND = "Donaudampfschiffahrtsgesellschaftskapitaensmuetzenhalterstrasse";

  for (const [label, routeName] of [
    ["an ordinary long name", LONG_WORDS],
    ["an unbroken compound", LONG_COMPOUND],
  ] as const) {
    for (const rootTextSize of ["100%", "200%"] as const) {
      test(`${label} stays contained and unclipped at ${rootTextSize} text`, async ({
        page,
      }) => {
        await page.goto("/");
        await seedRouteSession(page, routeName);
        await openStatus(page);
        await expect(activeSessionValue(page)).toHaveText(routeName);

        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, rootTextSize);

        const measured = await activeSessionValue(page).evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(element);
          return {
            right: rect.right,
            textRight: range.getBoundingClientRect().right,
            selfOverflow: element.scrollWidth - element.clientWidth,
            documentOverflow:
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
            text: element.textContent,
          };
        });

        // The whole name is present — wrapped, never truncated or ellipsised.
        expect(measured.text).toBe(routeName);
        expect(measured.selfOverflow).toBeLessThanOrEqual(1);
        expect(measured.textRight).toBeLessThanOrEqual(measured.right + 1);
        expect(measured.documentOverflow).toBeLessThanOrEqual(0);
      });
    }
  }
});
