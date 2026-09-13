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

// ---------------------------------------------------------------------
// Backlog item 118's conditional-reveal follow-up. Baseline, measured on
// 37f6895 in this same container across Chromium, WebKit and the Pixel-7
// preset: the application issued ZERO window.scrollBy calls, and the
// browser's own autoFocus scroll either did nothing (when the inset
// already fitted) or over-shot badly — 619px of native movement where
// ~240px was the minimum, leaving the inset 379px above where the
// contract puts it; at 200% it left the inset's top 270px above the
// viewport with 366px of unused space below the actions.
// ---------------------------------------------------------------------

/** Counts the application's OWN deliberate scrolls. The reveal goes
 * through window.scrollBy; the browser's native focus scroll does not —
 * so this separates "the app decided to scroll" from "the view moved
 * because focus moved", which a raw scrollY comparison cannot. Mirrors
 * routeLibraryTagManagement.spec.ts's instrument of the same name. */
async function instrumentDeliberateScrolls(page: Page) {
  await page.evaluate(() => {
    const holder = window as unknown as {
      __acnScrollBy?: number[];
      __acnPatched?: boolean;
    };
    holder.__acnScrollBy = [];
    if (holder.__acnPatched === true) return;
    holder.__acnPatched = true;
    const original: (options?: ScrollToOptions) => void = window.scrollBy.bind(window);
    window.scrollBy = (options?: ScrollToOptions) => {
      holder.__acnScrollBy?.push(options?.top ?? 0);
      original(options);
    };
  });
}

/** The vertical deltas the application itself requested, in order. An
 * empty array means every visible movement came from the browser. */
function deliberateScrolls(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __acnScrollBy?: number[] }).__acnScrollBy ?? [],
  );
}

/** Header, inset, both actions and the usable band, read atomically in one
 * evaluate so nothing can shift between reads. The band's bottom cushion
 * is the safe-area inset plus the same 8px framing gap production uses. */
function measureReveal(page: Page) {
  return page.evaluate(() => {
    const GAP = 8;
    const dialog = document.querySelector('[role="alertdialog"]');
    const header = document.querySelector("header.app-header--sticky");
    const box = (n: Element | null | undefined) => {
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    };
    const vv = window.visualViewport;
    const visibleTop = vv?.offsetTop ?? 0;
    const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const safeArea =
      Number.parseFloat(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--safe-area-inset-bottom")
          .trim(),
      ) || 0;
    const headerBottom = box(header)?.bottom ?? 0;
    const actions = dialog
      ? [...dialog.querySelectorAll("button")].map((b) => {
          const r = b.getBoundingClientRect();
          return { label: b.textContent.trim(), top: r.top, bottom: r.bottom };
        })
      : [];
    return {
      scrollY: window.scrollY,
      bandTop: Math.max(headerBottom, visibleTop) + GAP,
      bandBottom: visibleBottom - (safeArea + GAP),
      inset: box(dialog),
      actions,
      documentScrollTop: document.scrollingElement?.scrollTop ?? -1,
      scrollingAncestors: dialog
        ? (() => {
            let node = dialog.parentElement;
            let count = 0;
            while (node) {
              if (node.scrollHeight > node.clientHeight + 1) count += 1;
              node = node.parentElement;
            }
            return count;
          })()
        : 0,
    };
  });
}

async function settleScroll(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              let stable = 0;
              let last: number | null = null;
              const check = () => {
                const y = window.scrollY;
                stable = last !== null && y === last ? stable + 1 : 0;
                last = y;
                if (stable >= 10) {
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
}

/** Puts Delete key `margin` px above the viewport bottom, then opens the
 * confirmation with a real DOM click so Playwright's own actionability
 * scroll can never contaminate the measurement. */
async function openAt(page: Page, margin: number) {
  await page.evaluate((m) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Delete key",
    );
    if (!btn) throw new Error("expected a Delete key button");
    const r = btn.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.bottom - (window.innerHeight - m));
  }, margin);
  await settleScroll(page);
  await instrumentDeliberateScrolls(page);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Delete key",
    );
    if (!btn) throw new Error("expected a Delete key button");
    btn.click();
  });
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await settleScroll(page);
}

/** The constrained fixture: 200% root text plus a deliberately large
 * synthetic safe-area inset, which index.css documents as overridable for
 * exactly this purpose. Takes the band well below the inset's height, so
 * the overflow branch is entered with a wide margin rather than the ~20px
 * that 200% text alone would leave. */
async function constrainViewport(page: Page) {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    document.documentElement.style.setProperty("--safe-area-inset-bottom", "120px");
  });
}

test("does not scroll at all when the whole confirmation already fits", async ({
  page,
}) => {
  await openSettings(page);
  await saveKey(page);

  // Two-pass: open once to learn the inset's height, close, then seed a
  // position that leaves it comfortably inside the band.
  await openAt(page, 600);
  const first = await measureReveal(page);
  if (!first.inset) throw new Error("expected the confirmation to be measurable");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await openAt(page, first.inset.height + 80);
  const after = await measureReveal(page);
  if (!after.inset) throw new Error("expected the confirmation to be measurable");

  expect(await deliberateScrolls(page)).toEqual([]);
  expect(after.inset.top).toBeGreaterThanOrEqual(after.bandTop - 1);
  expect(after.inset.bottom).toBeLessThanOrEqual(after.bandBottom + 1);
});

test("leaves the browser's own autofocus reveal alone when it has already exposed the whole confirmation", async ({
  page,
}) => {
  await openSettings(page);
  await saveKey(page);

  // Measured baseline, all three engines: opening a clipped confirmation
  // makes the browser scroll 619px to reveal the autofocused Cancel
  // button, which overshoots so far that the entire inset ends up inside
  // the usable band. The contract's own words for this case are "avoid a
  // redundant second adjustment when native focus has already made the
  // target visible", so the correct application behaviour here is to do
  // nothing at all.
  await openAt(page, 20);
  const after = await measureReveal(page);
  if (!after.inset) throw new Error("expected the confirmation to be measurable");

  expect(await deliberateScrolls(page)).toEqual([]);
  expect(after.inset.top).toBeGreaterThanOrEqual(after.bandTop - 1);
  expect(after.inset.bottom).toBeLessThanOrEqual(after.bandBottom + 1);
  for (const action of after.actions) {
    expect(action.top, action.label).toBeGreaterThanOrEqual(after.bandTop - 1);
    expect(action.bottom, action.label).toBeLessThanOrEqual(after.bandBottom + 1);
  }

  // The document is the scroller, and nothing between the dialog and it
  // scrolls independently.
  expect(after.documentScrollTop).toBe(after.scrollY);
});

test("moves the minimum needed when the confirmation clears the layout viewport but not the safe-area cushion", async ({
  page,
}) => {
  await openSettings(page);
  await saveKey(page);
  // A real iPhone-sized home-indicator inset. The browser's own focus
  // scroll knows nothing about it, so this is a gap only the application
  // can close — and it is the same seam index.css documents for tests.
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--safe-area-inset-bottom", "34px");
  });

  // Two-pass: learn the inset's height, then seed a position that leaves
  // its bottom just inside the layout viewport — so Cancel is visible and
  // the browser does nothing — but below the cushioned band.
  await openAt(page, 600);
  const first = await measureReveal(page);
  if (!first.inset) throw new Error("expected the confirmation to be measurable");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await openAt(page, 30 + first.inset.height);
  const after = await measureReveal(page);
  if (!after.inset) throw new Error("expected the confirmation to be measurable");

  expect(await deliberateScrolls(page)).toHaveLength(1);
  // Landing exactly on the band's bottom IS the minimum-movement proof:
  // any larger scroll would put the bottom strictly above it.
  expect(after.inset.bottom).toBeGreaterThan(after.bandBottom - 1.5);
  expect(after.inset.bottom).toBeLessThan(after.bandBottom + 1.5);
  expect(after.inset.top).toBeGreaterThanOrEqual(after.bandTop - 1);
  for (const action of after.actions) {
    expect(action.bottom, action.label).toBeLessThanOrEqual(after.bandBottom + 1);
    expect(action.top, action.label).toBeGreaterThanOrEqual(after.bandTop - 1);
  }
  expect(after.documentScrollTop).toBe(after.scrollY);
});

test("scrolls back up to restore the action row when the rider has scrolled past an oversized confirmation", async ({
  page,
}) => {
  await openSettings(page);
  await saveKey(page);
  await constrainViewport(page);

  await openAt(page, 20);
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // The rider scrolls well past where the confirmation will appear, so the
  // reopened inset's bottom — and its actions — start above the band.
  await page.evaluate(() => {
    window.scrollBy(0, 500);
  });
  await settleScroll(page);
  const seeded = await measureReveal(page);
  await instrumentDeliberateScrolls(page);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Delete key",
    );
    if (!btn) throw new Error("expected a Delete key button");
    btn.click();
  });
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await settleScroll(page);
  const after = await measureReveal(page);
  if (!after.inset) throw new Error("expected the confirmation to be measurable");

  // The application's own movement is upwards — a negative delta — which
  // is what brings the action row back down into the band. Asserted on the
  // requested delta rather than on net scrollY, since the browser's own
  // focus scroll contributes to the latter.
  const applied = await deliberateScrolls(page);
  expect(applied).toHaveLength(1);
  expect(applied[0]).toBeLessThan(0);
  expect(seeded.scrollY).toBeGreaterThan(0);
  expect(after.inset.bottom).toBeGreaterThan(after.bandBottom - 1.5);
  expect(after.inset.bottom).toBeLessThan(after.bandBottom + 1.5);
  for (const action of after.actions) {
    expect(action.top, action.label).toBeGreaterThanOrEqual(after.bandTop - 1);
    expect(action.bottom, action.label).toBeLessThanOrEqual(after.bandBottom + 1);
  }
});

test("prioritises the action row when the confirmation cannot fit, keeping both buttons operable", async ({
  page,
}) => {
  await openSettings(page);
  await saveKey(page);
  await constrainViewport(page);

  await openAt(page, 20);
  const after = await measureReveal(page);
  if (!after.inset) throw new Error("expected the confirmation to be measurable");

  // The branch was genuinely taken: the inset is taller than the band and
  // its top is above it, so this is the overflow case and not a fit.
  expect(after.inset.height).toBeGreaterThan(after.bandBottom - after.bandTop);
  expect(after.inset.top).toBeLessThan(after.bandTop);
  expect(await deliberateScrolls(page)).toHaveLength(1);

  // Both actions are complete and inside the usable band — the whole point
  // of anchoring the inset's bottom rather than its top.
  expect(after.actions).toHaveLength(2);
  for (const action of after.actions) {
    expect(action.top, action.label).toBeGreaterThanOrEqual(after.bandTop - 1);
    expect(action.bottom, action.label).toBeLessThanOrEqual(after.bandBottom + 1);
  }
  // ...and the warning above them is still readable context, not clipped
  // away entirely.
  await expect(
    page.getByText(/This removes your saved key from this device/),
  ).toBeVisible();

  // Playwright's actionability check is the hit-test proof: a clipped or
  // covered button cannot be clicked.
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  // Cancel preserved the key and returned focus to a trigger the rider can
  // actually see — the consequence of revealing an oversized inset.
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete key" })).toBeFocused();
  const restored = await measureReveal(page);
  const deleteBox = await page.getByRole("button", { name: "Delete key" }).boundingBox();
  if (!deleteBox) throw new Error("expected Delete key to be measurable");
  expect(deleteBox.y).toBeGreaterThanOrEqual(restored.bandTop - 1);
  expect(deleteBox.y + deleteBox.height).toBeLessThanOrEqual(restored.bandBottom + 1);
});

/**
 * Item 95's interaction-safety invariant, re-measured for this dialog:
 * once the confirmation's actions are available to activate, they must not
 * still be moving because of the reveal. `Delete` is destructive, so a
 * control that drifts under a finger already travelling towards it is the
 * hazard itself.
 *
 * Installed BEFORE the confirmation is opened, deliberately. A recorder
 * started after `toBeVisible()` — let alone after Playwright's own
 * actionability wait, which waits for movement to stop — would miss
 * exactly the frames that matter. Re-implemented here rather than imported
 * from rideSessionSwitchGuard.spec.ts, per this repository's documented
 * no-shared-e2e-helpers convention, and scoped to the OpenRouteService
 * card because item 119's finding means a page-level ride-switch dialog
 * can legitimately coexist with this one.
 */
async function installActionGeometryRecorder(page: Page, limitMs: number) {
  await page.evaluate((ms) => {
    const w = window as unknown as { __acnActions?: unknown };
    const start = performance.now();
    const recorder = {
      frames: [] as { t: number; actions: { label: string; top: number }[] }[],
      clickAt: null as number | null,
      activatedLabel: null as string | null,
    };
    w.__acnActions = recorder;
    const findDialog = () =>
      document.querySelector(
        'section[aria-labelledby="ors-settings-heading"] [role="alertdialog"]',
      );
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      const button = target instanceof Element ? target.closest("button") : null;
      if (recorder.activatedLabel === null && button && findDialog()?.contains(button)) {
        recorder.activatedLabel = button.textContent.trim();
        recorder.clickAt = performance.now() - start;
      }
    };
    document.addEventListener("click", onClick, { capture: true });
    const tick = () => {
      const now = performance.now() - start;
      const dialog = findDialog();
      if (dialog) {
        recorder.frames.push({
          t: now,
          actions: [...dialog.querySelectorAll("button")].map((button) => ({
            label: button.textContent.trim(),
            top: button.getBoundingClientRect().top,
          })),
        });
      }
      if (now < ms && recorder.clickAt === null) {
        requestAnimationFrame(tick);
      } else {
        document.removeEventListener("click", onClick, { capture: true });
      }
    };
    requestAnimationFrame(tick);
  }, limitMs);
}

interface ActionGeometryRecording {
  frames: { t: number; actions: { label: string; top: number }[] }[];
  clickAt: number | null;
  activatedLabel: string | null;
}

function readActionGeometry(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __acnActions: ActionGeometryRecording }).__acnActions,
  );
}

const ACTION_RECORD_MS = 4000;
/** Sub-pixel drift is not a hazard; a whole pixel between the frame a rider
 * sees and the frame their tap lands in already is. */
const ACTION_STABLE_TOLERANCE_PX = 1;
/** Guards against a vacuous pass: an empty or single-frame recording would
 * satisfy any stability check trivially. */
const MIN_ACTIONABLE_FRAMES = 3;

function expectStableActionGeometry(
  recorded: ActionGeometryRecording,
  expectedLabel: string,
) {
  expect(recorded.clickAt).not.toBeNull();
  const clickAt = recorded.clickAt ?? 0;
  const actionable = recorded.frames.filter(
    (frame) => frame.actions.length > 0 && frame.t <= clickAt,
  );
  expect(actionable.length).toBeGreaterThanOrEqual(MIN_ACTIONABLE_FRAMES);

  const firstByLabel = new Map<string, number>();
  const drift: string[] = [];
  for (const frame of actionable) {
    for (const action of frame.actions) {
      const first = firstByLabel.get(action.label);
      if (first === undefined) {
        firstByLabel.set(action.label, action.top);
        continue;
      }
      const moved = Math.abs(action.top - first);
      if (moved > ACTION_STABLE_TOLERANCE_PX) {
        drift.push(
          `${action.label} moved ${moved.toFixed(1)}px by t=${frame.t.toFixed(0)}ms`,
        );
      }
    }
  }
  expect(drift).toEqual([]);
  expect(recorded.activatedLabel).toBe(expectedLabel);
}

test("the confirmation's actions are already settled in the first frame a rider can touch", async ({
  page,
}) => {
  await openSettings(page);
  await saveKey(page);
  await constrainViewport(page);

  await page.evaluate((m) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Delete key",
    );
    if (!btn) throw new Error("expected a Delete key button");
    const r = btn.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.bottom - (window.innerHeight - m));
  }, 20);
  await settleScroll(page);

  await installActionGeometryRecorder(page, ACTION_RECORD_MS);
  await page.getByRole("button", { name: "Delete key" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeVisible();

  await cancel.click();

  expectStableActionGeometry(await readActionGeometry(page), "Cancel");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();
});

test("the actions stay settled even on a heavily throttled device, because the reveal is pre-paint", async ({
  page,
  context,
}) => {
  await openSettings(page);
  await saveKey(page);
  await constrainViewport(page);

  await page.evaluate((m) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Delete key",
    );
    if (!btn) throw new Error("expected a Delete key button");
    const r = btn.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.bottom - (window.innerHeight - m));
  }, 20);
  await settleScroll(page);

  // At ordinary speed React's passive effects already land before the next
  // paint in this flow, so useEffect and useLayoutEffect are
  // indistinguishable — item 95 measured exactly that. A 20x throttle, a
  // fair model of a mid-range phone under load, is what separates them.
  const cpu = await context.newCDPSession(page);
  await cpu.send("Emulation.setCPUThrottlingRate", { rate: 20 });
  await installActionGeometryRecorder(page, ACTION_RECORD_MS);

  await page.getByRole("button", { name: "Delete key" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeVisible();
  await cancel.click();

  expectStableActionGeometry(await readActionGeometry(page), "Cancel");
  await cpu.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});
