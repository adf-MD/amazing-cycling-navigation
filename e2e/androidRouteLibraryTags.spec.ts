import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Proves the item 100 stage 2 tag editor under Android device emulation
// (this file's own "android-chrome" Playwright project, devices["Pixel
// 7"] — Chromium-emulated, not real Android Chrome; see
// docs/android-chrome-acceptance.md). No existing Route Library e2e spec
// runs on this project today, so this is a new file rather than an
// extension of routeLibraryPinning.spec.ts/routeLibrarySearchSort.spec.ts
// (both chromium-only). Deliberately narrower than
// routeLibraryTags.spec.ts: the tag-identity/suggestion/search/pin/sort
// contract is already exhaustively proven there and in the unit/
// integration suites — this file's purpose is proving the same core
// journey still works, and the editor remains touch-usable, under
// mobile viewport/touch/UA emulation, not re-proving the full contract a
// second time.

const FIXTURE_GPX_PATH = fileURLToPath(
  new URL("./fixtures/smoke-route.gpx", import.meta.url),
);

test.use({ serviceWorkers: "block" });

async function importRoute(page: Page, name: string) {
  const gpxContents = await readFile(FIXTURE_GPX_PATH, "utf-8");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${name}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(gpxContents),
  });
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
}

// Matches a route's own <li> whether it's showing its ordinary card
// (title as a .route-card-title button) or its own open tag editor
// (title as a bare, class-less <h2>, per RouteListItem.tsx) — item 100
// stage 3's own "Filter by tags" chips share suggestion names, so a
// suggestion click must stay scoped to the specific editor it's open in.
function getListItemForName(page: Page, name: string) {
  return page.locator(
    `li:has(.route-card-title:text-is("${name}")), li:has(h2:text-is("${name}"))`,
  );
}

test("tagging one route, reusing the tag as a suggestion on another, and reload persist correctly, with the editor remaining touch-usable", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto("/");
  await importRoute(page, "Alpine Climb");
  await importRoute(page, "Zebra Loop");

  await getListItemForName(page, "Alpine Climb")
    .getByRole("button", { name: "Add tags", exact: true })
    .click();
  const tagInput = page.getByLabel("Add a tag");
  await tagInput.fill("Gravel");
  await tagInput.press("Enter");

  const inputBox = await tagInput.boundingBox();
  if (!inputBox) throw new Error("expected the tag input to have a bounding box");
  const saveButton = page.getByRole("button", { name: "Save tags", exact: true });
  const saveBox = await saveButton.boundingBox();
  if (!saveBox) throw new Error("expected the Save tags button to have a bounding box");
  expect(saveBox.width).toBeGreaterThanOrEqual(44);
  expect(saveBox.height).toBeGreaterThanOrEqual(44);

  await saveButton.click();
  await expect(
    getListItemForName(page, "Alpine Climb").getByRole("button", { name: "Edit tags" }),
  ).toBeVisible();

  await getListItemForName(page, "Zebra Loop")
    .getByRole("button", { name: "Add tags", exact: true })
    .click();
  // Scoped to Zebra Loop's own editor: item 100 stage 3 adds a "Filter by
  // tags" chip of the same name once any route carries "Gravel".
  const zebraLoopItem = getListItemForName(page, "Zebra Loop");
  await expect(
    zebraLoopItem.getByRole("button", { name: "Gravel", exact: true }),
  ).toBeVisible();
  await zebraLoopItem.getByRole("button", { name: "Gravel", exact: true }).click();
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(
    getListItemForName(page, "Zebra Loop").getByRole("button", { name: "Edit tags" }),
  ).toBeVisible();

  await page.reload();
  await expect(
    getListItemForName(page, "Alpine Climb").getByText("Gravel"),
  ).toBeVisible();
  await expect(getListItemForName(page, "Zebra Loop").getByText("Gravel")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  expect(consoleErrors).toEqual([]);
});

// Backlog item 100 stage 3: the tag-filter chip's own identity/AND/
// touch-target contract is already exhaustively proven in
// routeLibraryTagFiltering.spec.ts and the unit/integration suites —
// this narrow addition proves the same core capability (select a chip,
// see the single-list result narrow) still works under Android
// emulation, with the chip meeting the shared touch-target minimum,
// mirroring this file's own stated scope.
test("selecting a tag filter chip narrows the visible list, with the chip meeting the touch-target minimum", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto("/");
  await importRoute(page, "Alpine Climb");
  await importRoute(page, "Zebra Loop");

  await getListItemForName(page, "Alpine Climb")
    .getByRole("button", { name: "Add tags", exact: true })
    .click();
  const tagInput = page.getByLabel("Add a tag");
  await tagInput.fill("Gravel");
  await tagInput.press("Enter");
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(
    getListItemForName(page, "Alpine Climb").getByRole("button", { name: "Edit tags" }),
  ).toBeVisible();

  const chip = page
    .getByRole("group", { name: "Filter by tags" })
    .getByRole("button", { name: "Gravel", exact: true });
  const chipBox = await chip.boundingBox();
  if (!chipBox) throw new Error("expected the filter chip to have a bounding box");
  expect(chipBox.width).toBeGreaterThanOrEqual(44);
  expect(chipBox.height).toBeGreaterThanOrEqual(44);

  await chip.click();
  await expect(getListItemForName(page, "Zebra Loop")).toHaveCount(0);
  await expect(getListItemForName(page, "Alpine Climb")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  expect(consoleErrors).toEqual([]);
});
