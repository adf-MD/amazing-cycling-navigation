import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
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
// Neither test in this file constructs a map, so unlike layout.spec.ts
// there's no need to install a local map style or block service workers.
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
  await expect(page.getByRole("button", { name: "smoke-route" })).toBeVisible();

  const longName =
    "The full loop around the reservoir via the old railway path and back " +
    "through the woods and the village and the church and the bridge and the mill";

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Route name").fill(longName);
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("button", { name: longName })).toBeVisible();

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
