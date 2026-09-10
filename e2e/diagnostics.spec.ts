import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Diagnostics is intentionally allowed to scroll vertically (unlike the
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
  await page.getByRole("button", { name: "Diagnostics" }).click();

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
  await page.getByRole("button", { name: "Diagnostics" }).click();

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
  await page.getByRole("button", { name: "Diagnostics" }).click();

  const storageValue = storageDetailValue(page);
  await expect(storageValue).toContainText("OK (schema version");
  await expect(storageValue).toContainText("Estimated app storage: unavailable");

  const hasNoHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(hasNoHorizontalScroll).toBe(true);
});

test("Diagnostics renders its four sections without horizontal scrolling, with the fetch-failure explanation collapsed by default", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(
    page.getByRole("heading", { name: "Diagnostics", level: 1 }),
  ).toBeVisible();

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
test("explains HTTP statuses in a second, independently operable disclosure", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Diagnostics" }).click();

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

  const guidance = statusDisclosure.getByRole("listitem");
  await expect(guidance).toHaveCount(6);
  await expect(guidance.nth(0)).toContainText("400, or another 4xx not listed below");
  await expect(guidance.nth(1)).toContainText("401 or 403");
  await expect(guidance.nth(2)).toContainText(
    "an HTTP server or intermediary returned a timeout response",
  );
  await expect(guidance.nth(3)).toContainText("request-rate or quota limiting");
  await expect(guidance.nth(4)).toContainText("a failure on the service side");
  await expect(guidance.nth(5)).toContainText("No status shown");

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
   * Backlog item 101's enlarged-text evidence. Scoped rather than
   * whole-document: this app shell has a known, unrelated
   * primary-navigation overflow at 200% text (see
   * routeLibraryTagFiltering.spec.ts's identical note), so a
   * document-level assertion here would claim something this item does
   * not govern. What is asserted instead is that the Routing diagnostics
   * region has no horizontal overflow of its own, and that both
   * disclosures and every guidance row stay horizontally within the
   * viewport. Only <summary> is interactive, so only <summary> carries
   * the 44px minimum — a <details> wrapper and a non-interactive <li>
   * are not touch targets.
   */
  test("keeps both routing disclosures readable and horizontally contained at 200% text", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Diagnostics" }).click();

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

    const guidance = routingRegion.getByRole("listitem");
    await expect(guidance).toHaveCount(6);
    for (const row of await guidance.all()) {
      const box = await row.boundingBox();
      if (!box) throw new Error("expected a bounding box for a guidance row");
      expect(isHorizontallyWithin(box, viewportBox)).toBe(true);
      // Wrapped rather than clipped to a single line: at this width and
      // text size every row is genuinely taller than one line.
      expect(box.height).toBeGreaterThan(30);
    }

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
