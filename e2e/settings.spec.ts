import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Backlog item 112 gave Settings a two-level hierarchy: a Preferences group
// over the two panels that carry controls, and an Explanations group over
// the two that carry none. Before it, all four were peer h2s with nothing
// signalling which was which.
//
// Settings had no Playwright spec of its own until this item — its only e2e
// coverage was incidental key entry from a dozen Planning specs, plus
// androidMobileLayout's nav sweep. A wholly independent file per this repo's
// documented no-shared-e2e-helpers convention. No map is ever constructed
// here, so (like diagnostics.spec.ts) it needs neither installLocalMapStyle
// nor a service-worker block.

test.use({ viewport: { width: 390, height: 844 } });

const VIEWPORT_WIDTH = 390;

async function openSettings(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

async function headingTexts(scope: Locator | Page, level: number) {
  return scope.getByRole("heading", { level }).allTextContents();
}

function documentOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function setRootTextSize(page: Page, size: string) {
  await page.evaluate((value) => {
    document.documentElement.style.fontSize = value;
  }, size);
}

test("groups the four panels under Preferences and Explanations, in that order", async ({
  page,
}) => {
  await openSettings(page);

  expect(await headingTexts(page, 2)).toEqual(["Preferences", "Explanations"]);

  const preferences = page.getByRole("region", { name: "Preferences" });
  expect(await headingTexts(preferences, 3)).toEqual([
    "Route planning",
    "OpenRouteService",
  ]);

  const explanations = page.getByRole("region", { name: "Explanations" });
  expect(await headingTexts(explanations, 3)).toEqual(["Elevation and climbs", "Riding"]);

  // Preferences precedes Explanations in the DOM, so keyboard and reading
  // order both reach the configurable content first.
  const order = await page.evaluate(() => {
    const groups = [
      ...document.querySelectorAll("section[aria-labelledby^='settings-']"),
    ];
    return groups.map((group) => group.querySelector("h2")?.textContent ?? null);
  });
  expect(order).toEqual(["Preferences", "Explanations"]);
});

test("keeps every panel card and puts all three configurable properties under Preferences", async ({
  page,
}) => {
  await openSettings(page);

  for (const name of [
    "Route planning",
    "OpenRouteService",
    "Elevation and climbs",
    "Riding",
  ]) {
    const panel = page
      .getByRole("heading", { name, level: 3 })
      .locator("xpath=ancestor::section[1]");
    await expect(panel).toHaveClass(/panel/);
  }

  const preferences = page.getByRole("region", { name: "Preferences" });
  await expect(
    preferences.getByRole("group", { name: "Default cycling profile" }),
  ).toBeVisible();
  await expect(
    preferences.getByRole("button", { name: "Road bike", exact: true }),
  ).toBeVisible();
  await expect(
    preferences.getByRole("checkbox", { name: "Avoid ferries by default" }),
  ).toBeVisible();
  await expect(preferences.getByLabel("OpenRouteService API key")).toBeVisible();

  // Explanations is exactly that — the disclosures, and no control that
  // changes anything. <summary> elements are not exposed as buttons.
  const explanations = page.getByRole("region", { name: "Explanations" });
  await expect(explanations.getByRole("button")).toHaveCount(0);
  await expect(explanations.getByRole("checkbox")).toHaveCount(0);
  await expect(explanations.getByRole("textbox")).toHaveCount(0);
  await expect(explanations.getByText("Screen on")).toBeVisible();
  await expect(explanations.getByText("Local gradient colours")).toBeVisible();
});

test("the reorganised hierarchy stays contained and legible at ordinary and 200% text", async ({
  page,
}) => {
  await openSettings(page);

  expect(await documentOverflow(page)).toBeLessThanOrEqual(0);

  // Item 112 measured the parent build overflowing by 27px here at 200%:
  // <h2>OpenRouteService</h2>, one unbreakable word at 1.5em of a 32px root,
  // was 384px wide inside a 324px content box. Demoting the panel headings to
  // h3 beneath the new group h2s removed it. This is the regression guard for
  // that, and it is why the demotion is load-bearing rather than cosmetic.
  await setRootTextSize(page, "200%");
  expect(await documentOverflow(page)).toBeLessThanOrEqual(0);

  const panels = page.locator("section.panel");
  await expect(panels).toHaveCount(4);
  for (const panel of await panels.all()) {
    const box = await panel.boundingBox();
    if (!box) throw new Error("expected every Settings panel to have a bounding box");
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT_WIDTH + 1);
  }

  // Group headings and panel headings alike stay inside the viewport and are
  // never clipped by their own box.
  for (const heading of await page.getByRole("heading").all()) {
    const measured = await heading.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        right: rect.right,
        textRight: range.getBoundingClientRect().right,
        text: element.textContent,
      };
    });
    expect(measured.textRight, measured.text).toBeLessThanOrEqual(VIEWPORT_WIDTH + 1);
  }

  // Only <summary> is interactive in the Explanations group, so only
  // <summary> carries the touch-target minimum.
  for (const summary of await page.locator("summary").all()) {
    const box = await summary.boundingBox();
    if (!box) throw new Error("expected every disclosure summary to have a bounding box");
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT_WIDTH + 1);
  }
});

test("the group headings read as a level above their panels, not the same level", async ({
  page,
}) => {
  await openSettings(page);

  // The hierarchy is the whole point of the item, so it is asserted by level
  // rather than by styling: one h1, two h2 groups, four h3 panels, and no
  // panel heading left at h2.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 3 })).toHaveCount(4);
  await expect(
    page.getByRole("heading", { level: 2, name: "Route planning", exact: true }),
  ).toHaveCount(0);
});
