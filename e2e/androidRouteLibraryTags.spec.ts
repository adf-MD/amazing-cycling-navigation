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

// Backlog item 100 follow-up: the reveal-after-save mechanism's own
// geometry/no-scroll/Cancel contract is already exhaustively proven under
// Chromium (routeLibraryTags.spec.ts, including landscape and 200% text)
// and at the unit level — this narrow addition proves the same reveal
// still lands the card's title below the sticky header under Android
// emulation, mirroring this file's own stated scope.
test("a successful Save tags reveals the card's title below the sticky header under Android emulation", async ({
  page,
}) => {
  await page.goto("/");
  await importRoute(page, "Reveal Target Route");
  for (let i = 1; i <= 10; i++) {
    await importRoute(page, `Reveal Filler ${String(i)}`);
  }

  await getListItemForName(page, "Reveal Target Route")
    .getByRole("button", { name: "Add tags", exact: true })
    .click();
  const tagInput = page.getByLabel("Add a tag");
  for (let i = 1; i <= 100; i++) {
    await tagInput.fill(`tag-${String(i).padStart(3, "0")}`);
    await tagInput.press("Enter");
  }

  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(
    getListItemForName(page, "Reveal Target Route").getByRole("button", {
      name: "Edit tags",
    }),
  ).toBeVisible();

  // Poll (never a fixed sleep) until the reveal's own smooth-scroll
  // animation has genuinely settled — mirrors routeLibraryTags.spec.ts's
  // own waitForScrollToSettle convention.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              let stableFrames = 0;
              let lastY: number | null = null;
              const check = () => {
                const y = window.scrollY;
                stableFrames = lastY !== null && y === lastY ? stableFrames + 1 : 0;
                lastY = y;
                if (stableFrames >= 10) {
                  resolve(true);
                  return;
                }
                requestAnimationFrame(check);
              };
              requestAnimationFrame(check);
            }),
        ),
      { timeout: 5000 },
    )
    .toBe(true);

  const geometry = await page.evaluate((name) => {
    const header = document.querySelector("header.app-header--sticky");
    const items = Array.from(document.querySelectorAll("li[data-route-id]"));
    const li = items.find(
      (el) => el.querySelector(".route-card-title, h2")?.textContent.trim() === name,
    );
    const title = li?.querySelector(".route-card-title");
    const vv = window.visualViewport;
    const toBox = (el: Element | null | undefined) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };
    return {
      header: toBox(header),
      title: toBox(title),
      visibleBottom: vv ? vv.offsetTop + vv.height : window.innerHeight,
    };
  }, "Reveal Target Route");

  if (!geometry.header || !geometry.title) {
    throw new Error("expected the header and title to both be measurable");
  }
  expect(geometry.title.top).toBeGreaterThanOrEqual(geometry.header.bottom - 2);
  expect(geometry.title.bottom).toBeLessThanOrEqual(geometry.visibleBottom + 2);
  await expect(
    getListItemForName(page, "Reveal Target Route").getByRole("button", {
      name: "Edit tags",
    }),
  ).toBeFocused();
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

// Backlog item 100 stage 4A, kept to this file's own deliberately narrower
// charter: the global tag lifecycle's full contract (merge deduplication,
// identity handling, filter reconciliation orderings, failure paths) is
// proven in routeLibraryTagManagement.spec.ts and the unit/integration
// suites — what is proven here is that the same journey still works, and
// the panel stays touch-usable, under mobile viewport/touch/UA emulation.
async function tagRouteFor(page: Page, routeName: string, tag: string) {
  const card = getListItemForName(page, routeName);
  const addTags = card.getByRole("button", { name: "Add tags", exact: true });
  const editTags = card.getByRole("button", { name: "Edit tags", exact: true });
  if (await addTags.count()) {
    await addTags.click();
  } else {
    await editTags.click();
  }
  const tagInput = page.getByLabel("Add a tag");
  await tagInput.fill(tag);
  await tagInput.press("Enter");
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(editTags).toBeVisible();
}

test("globally renaming a tag updates every card and the filter chip, with the manager touch-usable", async ({
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
  await tagRouteFor(page, "Alpine Climb", "Gravel");
  await tagRouteFor(page, "Zebra Loop", "Gravel");

  await page.getByRole("button", { name: "Manage tags", exact: true }).click();
  const manager = page.getByRole("group", { name: "Manage tags" });
  await expect(manager).toBeVisible();

  const tagSelect = manager.getByLabel("Tag to manage");
  await tagSelect.selectOption({ label: "Gravel (2 routes)" });
  await manager.getByLabel("New name").fill("Trail");

  // Real bounding boxes, never screenshots, matching this file's own
  // established touch-target convention.
  for (const control of [
    tagSelect,
    manager.getByLabel("New name"),
    manager.getByRole("button", { name: "Rename tag", exact: true }),
    manager.getByRole("button", { name: "Delete tag", exact: true }),
    manager.getByRole("button", { name: "Close", exact: true }),
  ]) {
    const box = await control.boundingBox();
    if (!box) throw new Error("expected element to have a bounding box");
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  await manager.getByRole("button", { name: "Rename tag", exact: true }).click();

  await expect(page.getByText("Renamed “Gravel” to “Trail” on 2 routes.")).toBeVisible();
  await expect(getListItemForName(page, "Alpine Climb").getByText("Trail")).toBeVisible();
  await expect(getListItemForName(page, "Zebra Loop").getByText("Trail")).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Filter by tags" })
      .getByRole("button", { name: "Trail", exact: true }),
  ).toBeVisible();

  const viewport = page.viewportSize();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(viewport).not.toBeNull();

  expect(consoleErrors).toEqual([]);
});
