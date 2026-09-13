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

// Backlog item 118. Never a real key — a fixed dummy string, exactly as
// planning.spec.ts does.
const DUMMY_KEY = "dummy-e2e-key";

async function saveKey(page: Page) {
  await page.getByLabel("OpenRouteService API key").fill(DUMMY_KEY);
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();
}

function openRouteServiceCard(page: Page) {
  return page.getByRole("region", { name: "OpenRouteService" });
}

/** Document coordinates, deliberately: the confirmation's Cancel button
 * carries autoFocus, so the viewport can move between measurements and
 * viewport-relative rects would not be comparable across them. */
function documentBox(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top + window.scrollY,
      bottom: rect.bottom + window.scrollY,
      left: rect.left + window.scrollX,
      right: rect.right + window.scrollX,
      width: rect.width,
      height: rect.height,
    };
  });
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

// ---------------------------------------------------------------------
// Backlog item 118 — the key-deletion confirmation is contained by the
// OpenRouteService card. Before this item <ConfirmDialog> was the last
// child of <section className="screen">, a peer of both group sections,
// so it painted below every panel.
// ---------------------------------------------------------------------

test("the delete confirmation opens inside the OpenRouteService card and grows it, rather than appearing as another card", async ({
  page,
}) => {
  await openSettings(page);
  await saveKey(page);

  const card = openRouteServiceCard(page);
  const disclosure = card.getByText("How the key and route data are used");
  const regionsBefore = await page.getByRole("region").count();
  const panelsBefore = await page.locator("section.panel").count();
  const cardBefore = await documentBox(card);
  const disclosureBefore = await documentBox(disclosure);

  await page.getByRole("button", { name: "Delete key" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await expect(card.getByRole("alertdialog")).toHaveCount(1);

  // The nearest owning section is this very card — a relationship, so a
  // peer rendered elsewhere fails regardless of how it is classed.
  expect(
    await dialog.evaluate((element) =>
      element.closest("section[aria-labelledby]")?.getAttribute("aria-labelledby"),
    ),
  ).toBe("ors-settings-heading");

  const cardAfter = await documentBox(card);
  const dialogBox = await documentBox(dialog);
  const disclosureAfter = await documentBox(disclosure);
  const deleteBox = await documentBox(page.getByRole("button", { name: "Delete key" }));

  // Contained on all four edges by the card's own border box.
  expect(dialogBox.top).toBeGreaterThanOrEqual(cardAfter.top);
  expect(dialogBox.bottom).toBeLessThanOrEqual(cardAfter.bottom);
  expect(dialogBox.left).toBeGreaterThanOrEqual(cardAfter.left);
  expect(dialogBox.right).toBeLessThanOrEqual(cardAfter.right);

  // Directly beneath the action that opened it. The gap is .stack's 16px
  // plus .route-delete-confirm's own 0.5rem margin — 24px at ordinary
  // text. Before this item the same gap spanned the rest of the card, the
  // whole Explanations group and both of its panels.
  expect(dialogBox.top).toBeGreaterThan(deleteBox.bottom);
  expect(dialogBox.top - deleteBox.bottom).toBeLessThanOrEqual(48);

  // The card grew in ordinary flow to hold it, and the content below it
  // moved down by at least as much. Absolute positioning or an overlap
  // hack would leave both unchanged.
  expect(cardAfter.height - cardBefore.height).toBeGreaterThanOrEqual(dialogBox.height);
  expect(disclosureAfter.top - disclosureBefore.top).toBeGreaterThanOrEqual(
    dialogBox.height,
  );

  // No new card, by role first. The class count is supporting evidence
  // only — a peer rendered as a bare <div> would not move it either way.
  await expect(page.getByRole("region")).toHaveCount(regionsBefore);
  await expect(page.locator("section.panel")).toHaveCount(panelsBefore);

  // ...and it does not read as a second surface: identical background to
  // the card, no elevation of its own, and in normal flow.
  const surface = await dialog.evaluate((element) => {
    const card = element.closest("section.panel");
    if (!card) throw new Error("expected the dialog to sit inside a panel card");
    const dialogStyle = getComputedStyle(element);
    return {
      dialogBackground: dialogStyle.backgroundColor,
      cardBackground: getComputedStyle(card).backgroundColor,
      position: dialogStyle.position,
      shadowed: [...card.querySelectorAll("*")].filter(
        (node) => getComputedStyle(node).boxShadow !== "none",
      ).length,
    };
  });
  expect(surface.dialogBackground).toBe(surface.cardBackground);
  expect(surface.position).toBe("static");
  expect(surface.shadowed).toBe(0);
});

test("Cancel keeps the key and returns focus to Delete key; Confirm removes it and the same card shows the no-key state", async ({
  page,
}) => {
  await openSettings(page);
  await saveKey(page);

  const card = openRouteServiceCard(page);
  await page.getByRole("button", { name: "Delete key" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();

  // Clicking rather than dispatching is itself the proof that the sticky
  // header does not cover the action: Playwright's actionability check
  // fails on pointer interception.
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete key" })).toBeFocused();

  await page.getByRole("button", { name: "Delete key" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();

  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(card.getByText("No key configured")).toBeVisible();
  await expect(card.getByLabel("OpenRouteService API key")).toBeVisible();
});

test("the confirmation keeps item 112's heading outline while it is open", async ({
  page,
}) => {
  await openSettings(page);
  await saveKey(page);
  await page.getByRole("button", { name: "Delete key" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 3 })).toHaveCount(4);
  await expect(page.getByRole("heading", { level: 4 })).toHaveCount(1);
  await expect(page.getByRole("alertdialog")).toHaveAccessibleName(
    "Delete OpenRouteService key",
  );
});

test("the open confirmation stays contained and operable at ordinary and 200% text", async ({
  page,
}) => {
  await openSettings(page);
  await saveKey(page);

  for (const rootSize of ["100%", "200%"]) {
    await setRootTextSize(page, rootSize);
    await page.getByRole("button", { name: "Delete key" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    expect(await documentOverflow(page), rootSize).toBeLessThanOrEqual(0);

    const card = await documentBox(openRouteServiceCard(page));
    const dialogBox = await documentBox(dialog);
    expect(dialogBox.left, rootSize).toBeGreaterThanOrEqual(card.left);
    expect(dialogBox.right, rootSize).toBeLessThanOrEqual(card.right);
    expect(dialogBox.bottom, rootSize).toBeLessThanOrEqual(card.bottom);

    // Nothing overflows the confirmation's own padding box either.
    const selfOverflow = await dialog.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(selfOverflow, rootSize).toBeLessThanOrEqual(1);

    // The complete wording is present and its painted extent — not its
    // box — stays inside the viewport, so nothing is clipped.
    for (const part of [
      dialog.getByRole("heading", { level: 4 }),
      dialog.getByText(/This removes your saved key from this device/),
    ]) {
      await expect(part).toBeVisible();
      const textRight = await part.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect().right;
      });
      expect(textRight, rootSize).toBeLessThanOrEqual(VIEWPORT_WIDTH + 1);
    }

    // Both actions stay full, tappable and non-overlapping. Deliberately
    // no assertion that they share a row: at 200% the pair measures close
    // enough to the available width that either outcome is legitimate,
    // and .route-delete-confirm-actions wraps.
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    const confirm = dialog.getByRole("button", { name: "Delete" });
    const cancelBox = await documentBox(cancel);
    const confirmBox = await documentBox(confirm);
    for (const box of [cancelBox, confirmBox]) {
      expect(box.height, rootSize).toBeGreaterThanOrEqual(44);
      expect(box.width, rootSize).toBeGreaterThanOrEqual(44);
      expect(box.left, rootSize).toBeGreaterThanOrEqual(-1);
      expect(box.right, rootSize).toBeLessThanOrEqual(VIEWPORT_WIDTH + 1);
    }
    const overlaps =
      cancelBox.right > confirmBox.left &&
      confirmBox.right > cancelBox.left &&
      cancelBox.bottom > confirmBox.top &&
      confirmBox.bottom > cancelBox.top;
    expect(overlaps, rootSize).toBe(false);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  }
});
