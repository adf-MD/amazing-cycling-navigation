import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installLocalMapStyle } from "./support/localMapStyle.ts";

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);
const SECOND_FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/gradient-route.gpx", import.meta.url),
);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isFullyWithin(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

// Narrow iPhone-width portrait viewport — the project's primary target
// device (see CLAUDE.md), matching e2e/layout.spec.ts's own convention.
// The two top-level tests below never construct a map, so unlike
// layout.spec.ts there's no need to install a local map style or block
// service workers for them — only the rename-journey describe block below
// (which opens a route into Riding) needs that, scoped to itself.
test.use({ viewport: { width: 390, height: 844 } });

test("Routes screen and navigation render without horizontal scrolling and show the active destination", async ({
  page,
}) => {
  await page.goto("/");

  const hasNoHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(hasNoHorizontalScroll).toBe(true);

  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  const routesButton = page.getByRole("button", { name: "Routes" });
  await expect(routesButton).toBeVisible();
  await expect(routesButton).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
});

test("a long route name wraps inside its card without causing horizontal scroll, and all route actions stay within the viewport", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
  await expect(
    page.getByRole("button", { name: "smoke-route", exact: true }),
  ).toBeVisible();

  const longName =
    "The full loop around the reservoir via the old railway path and back " +
    "through the woods and the village and the church and the bridge and the mill";

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Route name").fill(longName);
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("button", { name: longName, exact: true })).toBeVisible();

  const hasNoHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(hasNoHorizontalScroll).toBe(true);

  const viewportBox: Box = { x: 0, y: 0, width: 390, height: 844 };
  for (const label of ["Rename", "Export", "Delete"]) {
    const actionButton = page.getByRole("button", { name: label });
    await expect(actionButton).toBeVisible();
    const box = await actionButton.boundingBox();
    if (!box) throw new Error(`expected a bounding box for the ${label} button`);
    expect(isFullyWithin(box, viewportBox)).toBe(true);
  }
});

test.describe("route rename keeps the card mounted in place", () => {
  // Opening the renamed route into Riding constructs a real map — see
  // smoke.spec.ts for the same requestServiceWorkers/installLocalMapStyle
  // pairing and why it's needed (service-worker-handled requests bypass
  // page.route() interception).
  test.use({ serviceWorkers: "block" });

  test("renaming the second of two routes leaves the list order and the other card untouched, and the renamed route opens normally", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
    await installLocalMapStyle(page);

    await page.goto("/");

    await page.getByLabel("Import GPX file").setInputFiles(FIXTURE_GPX_PATH);
    await expect(
      page.getByRole("button", { name: "smoke-route", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Import GPX file").setInputFiles(SECOND_FIXTURE_GPX_PATH);
    await expect(
      page.getByRole("button", { name: "gradient-route", exact: true }),
    ).toBeVisible();

    const cards = page.locator(".route-card");
    await expect(cards).toHaveCount(2);

    const firstCardIdBefore = await cards.nth(0).getAttribute("data-route-id");
    const secondCardIdBefore = await cards.nth(1).getAttribute("data-route-id");
    const firstCardTitleBefore = await cards
      .nth(0)
      .locator(".route-card-title")
      .textContent();

    const secondCard = cards.nth(1);
    await secondCard.getByRole("button", { name: "Rename" }).click();
    await secondCard.getByLabel("Route name").fill("Renamed second route");
    await secondCard.getByRole("button", { name: "Save" }).click();

    // Same two cards, in the same order — proves renaming never swapped in
    // a detached form above the list or remounted a card at a different
    // position.
    await expect(cards).toHaveCount(2);
    expect(await cards.nth(0).getAttribute("data-route-id")).toBe(firstCardIdBefore);
    expect(await cards.nth(1).getAttribute("data-route-id")).toBe(secondCardIdBefore);
    expect(await cards.nth(0).locator(".route-card-title").textContent()).toBe(
      firstCardTitleBefore,
    );
    await expect(page.locator("li:not(.route-card)")).toHaveCount(0);

    await cards
      .nth(1)
      .getByRole("button", { name: "Renamed second route", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Renamed second route" }),
    ).toBeVisible();
  });
});
