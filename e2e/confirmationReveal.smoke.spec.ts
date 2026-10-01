import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readPlanningDraftRow } from "./support/rideStateDb.ts";

// Backlog item 124, slice 1, in both engines (this file runs under the
// "chromium" and "webkit-smoke" projects): Planning's Clear-draft
// confirmation and a route card's Delete-route confirmation.
//
// Opening: no movement when the confirmation fits the usable band (below
// the sticky header plus an 8px gap, above the visual viewport's bottom
// less the safe-area inset plus 8px); otherwise only enough to reveal it;
// and when it cannot fit, only enough to show its complete Cancel/Confirm
// row. Cancel and Escape: focus returns to the opening button, the page
// keeps its current position (allowing for the document shortening as the
// confirmation collapses), and moves only as far as reveals that button.
//
// Every assertion is made against the band measured in the page — never
// `toBeVisible()` alone, which knows nothing of the sticky header — and
// nothing here opens a confirmation through Playwright's actionability
// scroll: positioning is a programmatic scroll the test makes BEFORE the
// app is asked to do anything, and opening is a DOM click, or a
// programmatic focus without scrolling followed by Enter.
//
// Browser root-text scaling is not iOS Larger Text, and the synthetic
// `--safe-area-inset-bottom` overrides (the seam index.css documents) are
// not physical-device evidence. Desktop engines have no software keyboard.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const GAP = 8;
const EDGE_TOLERANCE = 1.5;
const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];
const TEXT_SIZES = ["100%", "200%"] as const;

const COPY = {
  en: { plan: "Plan", clearDraft: "Clear draft", cancel: "Cancel", delete: "Delete" },
  de: {
    plan: "Planen",
    clearDraft: "Entwurf verwerfen",
    cancel: "Abbrechen",
    delete: "Löschen",
  },
} as const;

/** Where one confirmation and its opening button live in the DOM. */
interface Surface {
  dialog: string;
  trigger: string;
}

const PLANNING_DISCLOSURE = "details:has(.planning-routing-disclosure-action-label)";
const PLANNING: Surface = {
  // The confirmation replaces the button in place, in the slot directly
  // after the routing disclosure (backlog item 49).
  dialog: `${PLANNING_DISCLOSURE} + [role="dialog"]`,
  trigger: `${PLANNING_DISCLOSURE} + .row > button`,
};

function routeCard(routeId: string): Surface {
  const card = `li[data-route-id="${routeId}"]`;
  return {
    dialog: `${card} [role="dialog"]`,
    trigger: `${card} .route-list-item-actions > button.btn-danger`,
  };
}

interface Box {
  top: number;
  bottom: number;
  height: number;
}

interface Snapshot {
  scrollY: number;
  scrollX: number;
  maxScrollY: number;
  bandTop: number;
  bandBottom: number;
  inset: Box | null;
  actions: Box | null;
  message: Box | null;
  trigger: Box | null;
  cancelFocused: boolean;
  triggerFocused: boolean;
}

/** One atomic in-page read, so nothing can move between measurements. */
function snapshot(page: Page, surface: Surface): Promise<Snapshot> {
  return page.evaluate(
    ({ dialog, trigger, gap }) => {
      const box = (node: Element | null | undefined) => {
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      };
      const header = document.querySelector("header.app-header--sticky");
      const vv = window.visualViewport;
      const visibleTop = vv?.offsetTop ?? 0;
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const safeArea =
        Number.parseFloat(
          getComputedStyle(document.documentElement)
            .getPropertyValue("--safe-area-inset-bottom")
            .trim(),
        ) || 0;
      const dialogEl = document.querySelector(dialog);
      const triggerEl = document.querySelector(trigger);
      const actionsEl = dialogEl?.querySelector(".route-delete-confirm-actions") ?? null;
      const cancelEl = actionsEl?.querySelector("button") ?? null;
      const scroller = document.scrollingElement ?? document.documentElement;
      return {
        scrollY: window.scrollY,
        scrollX: window.scrollX,
        maxScrollY: scroller.scrollHeight - scroller.clientHeight,
        bandTop: Math.max(box(header)?.bottom ?? 0, visibleTop) + gap,
        bandBottom: visibleBottom - (safeArea + gap),
        inset: box(dialogEl),
        actions: box(actionsEl),
        message: box(dialogEl?.querySelector("p")),
        trigger: box(triggerEl),
        cancelFocused: cancelEl !== null && document.activeElement === cancelEl,
        triggerFocused: triggerEl !== null && document.activeElement === triggerEl,
      };
    },
    { ...surface, gap: GAP },
  );
}

/** Waits until scrollY has held still for a run of timer-driven samples.
 * Deliberately not requestAnimationFrame: headless WebKit can defer frames
 * until something triggers rendering. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = window.scrollY;
        let stable = 0;
        const tick = () => {
          const now = window.scrollY;
          stable = now === last ? stable + 1 : 0;
          last = now;
          if (stable >= 6) {
            resolve();
            return;
          }
          setTimeout(tick, 25);
        };
        setTimeout(tick, 25);
      }),
  );
}

/** Records the vertical deltas the application itself asks window.scrollBy
 * for; the browser's own focus scrolling never goes through it. Reset on
 * every call. */
async function recordDeliberateScrolls(page: Page): Promise<void> {
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

function deliberateScrolls(page: Page): Promise<number[]> {
  return page.evaluate(
    () => (window as unknown as { __acnScrollBy?: number[] }).__acnScrollBy ?? [],
  );
}

/** Scrolls the page itself (never through scrollBy, so it is not counted)
 * so that `selector`'s top lands at `targetTop`, and returns where it
 * actually landed — the document may be too short to reach the target. */
async function placeTop(
  page: Page,
  selector: string,
  targetTop: number,
): Promise<number> {
  await page.evaluate(
    ({ selector, targetTop }) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error(`expected ${selector}`);
      const top = node.getBoundingClientRect().top;
      window.scrollTo(0, window.scrollY + top - targetTop);
    },
    { selector, targetTop },
  );
  await settle(page);
  return page.evaluate((selector) => {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`expected ${selector}`);
    return node.getBoundingClientRect().top;
  }, selector);
}

async function scrollPageBy(page: Page, delta: number): Promise<void> {
  await page.evaluate((delta) => {
    window.scrollTo(0, window.scrollY + delta);
  }, delta);
  await settle(page);
}

async function domClick(page: Page, selector: string): Promise<void> {
  await page.evaluate((selector) => {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`expected ${selector}`);
    node.click();
  }, selector);
}

/** A keyboard rider's activation: focus without any scroll, then Enter. */
async function keyboardActivate(page: Page, selector: string): Promise<void> {
  await page.evaluate((selector) => {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`expected ${selector}`);
    node.focus({ preventScroll: true });
  }, selector);
  await page.keyboard.press("Enter");
}

async function openConfirmation(
  page: Page,
  surface: Surface,
  how: "click" | "keyboard" = "click",
): Promise<{ before: Snapshot; open: Snapshot; deltas: number[] }> {
  const before = await snapshot(page, surface);
  await recordDeliberateScrolls(page);
  if (how === "click") await domClick(page, surface.trigger);
  else await keyboardActivate(page, surface.trigger);
  await expect(page.locator(surface.dialog)).toHaveCount(1);
  await settle(page);
  return {
    before,
    open: await snapshot(page, surface),
    deltas: await deliberateScrolls(page),
  };
}

async function closeConfirmation(
  page: Page,
  surface: Surface,
  how: "cancel" | "escape" | "enter",
): Promise<{ open: Snapshot; after: Snapshot; deltas: number[] }> {
  const open = await snapshot(page, surface);
  await recordDeliberateScrolls(page);
  if (how === "cancel") {
    await domClick(page, `${surface.dialog} .route-delete-confirm-actions > button`);
  } else {
    await page.keyboard.press(how === "escape" ? "Escape" : "Enter");
  }
  await expect(page.locator(surface.dialog)).toHaveCount(0);
  await settle(page);
  return {
    open,
    after: await snapshot(page, surface),
    deltas: await deliberateScrolls(page),
  };
}

function isWithinBand(box: Box, s: Snapshot): boolean {
  return box.top >= s.bandTop - 1 && box.bottom <= s.bandBottom + 1;
}

function onBandEdge(box: Box, s: Snapshot): boolean {
  return (
    Math.abs(box.top - s.bandTop) <= EDGE_TOLERANCE ||
    Math.abs(box.bottom - s.bandBottom) <= EDGE_TOLERANCE
  );
}

function shifted(box: Box, by: number): Box {
  return { top: box.top + by, bottom: box.bottom + by, height: box.height };
}

/**
 * The opening rule, asserted from geometry alone so it holds whichever
 * branch a combination of language, text size and position takes. Returns
 * which branch it was, for the caller's own phase-specific expectation.
 */
function expectOpening(
  label: string,
  { before, open, deltas }: { before: Snapshot; open: Snapshot; deltas: number[] },
): "fits" | "oversized" {
  const { inset, actions } = open;
  if (!inset || !actions)
    throw new Error(`${label}: expected the confirmation to lay out`);
  const moved = open.scrollY - before.scrollY;
  // One deliberate scroll at most, and nothing else moved the page: the
  // browser's own focus scroll did not compete with it.
  expect(deltas.length, `${label}: deliberate scrolls`).toBeLessThanOrEqual(1);
  expect(
    Math.abs(moved - deltas.reduce((sum, delta) => sum + delta, 0)),
    `${label}: page moved only by the deliberate reveal`,
  ).toBeLessThanOrEqual(1);
  expect(open.scrollX, `${label}: horizontal position`).toBe(before.scrollX);
  expect(open.cancelFocused, `${label}: Cancel focused`).toBe(true);
  // The complete action row is always inside the usable band.
  expect(isWithinBand(actions, open), `${label}: actions inside the band`).toBe(true);

  const fits = inset.height <= open.bandBottom - open.bandTop;
  const target = fits ? inset : actions;
  // A confirmation that fits is wholly inside the band. One that cannot
  // fit is, by definition, partly outside it — at the top, or only by its
  // own padding below the action row — and what matters is the complete
  // row, asserted above.
  if (fits) {
    expect(
      isWithinBand(inset, open),
      `${label}: whole confirmation inside the band`,
    ).toBe(true);
  }
  if (moved !== 0) {
    // Minimal: it stopped exactly at the band's edge, and it was needed.
    expect(onBandEdge(target, open), `${label}: stopped at the band edge`).toBe(true);
    expect(
      isWithinBand(shifted(target, moved), open),
      `${label}: was outside the band before the reveal`,
    ).toBe(false);
  }
  return fits ? "fits" : "oversized";
}

/**
 * The cancellation rule. `open` is the state just before closing, so any
 * manual scrolling the rider did while it was open is already in it: it is
 * never compared with the position from before opening.
 */
function expectCancellation(
  label: string,
  { open, after, deltas }: { open: Snapshot; after: Snapshot; deltas: number[] },
): "kept" | "corrected" {
  const { trigger } = after;
  if (!trigger) throw new Error(`${label}: expected the opening button back`);
  expect(after.inset, `${label}: confirmation gone`).toBeNull();
  expect(after.triggerFocused, `${label}: opening button focused`).toBe(true);
  expect(isWithinBand(trigger, after), `${label}: opening button inside the band`).toBe(
    true,
  );
  expect(after.scrollX, `${label}: horizontal position`).toBe(open.scrollX);
  expect(deltas.length, `${label}: deliberate scrolls`).toBeLessThanOrEqual(1);
  // The collapse can shorten the document; the browser then clamps scrollY.
  const clamped = Math.min(open.scrollY, after.maxScrollY);
  const corrected = after.scrollY - clamped;
  if (deltas.length === 0) {
    expect(Math.abs(corrected), `${label}: position kept`).toBeLessThanOrEqual(1);
    return "kept";
  }
  expect(
    Math.abs(corrected - (deltas[0] ?? 0)),
    `${label}: only the deliberate move`,
  ).toBeLessThanOrEqual(1);
  expect(onBandEdge(trigger, after), `${label}: button stopped at the band edge`).toBe(
    true,
  );
  expect(
    isWithinBand(shifted(trigger, corrected), after),
    `${label}: button was outside the band before the correction`,
  ).toBe(false);
  return "corrected";
}

/**
 * The fit phase's own expectation. The button sits as high in the band as
 * a rider could tap it; if the confirmation then fits where it opens, the
 * page must not move at all. Where no position leaves enough room below
 * the button (a long German explanation at 200% text), the case does not
 * exist for that combination: the minimal reveal expectOpening has already
 * asserted is the correct outcome, and it is recorded rather than hidden.
 */
function expectFitPhase(opening: {
  before: Snapshot;
  open: Snapshot;
  deltas: number[];
}): void {
  const { before, open, deltas } = opening;
  if (!open.inset) throw new Error("expected the confirmation to lay out");
  const inPlace = shifted(open.inset, open.scrollY - before.scrollY);
  if (isWithinBand(inPlace, open)) {
    expect(deltas, "fit phase: no deliberate scroll").toEqual([]);
    expect(open.scrollY, "fit phase: page unmoved").toBe(before.scrollY);
    note("fit phase outcome", "fits in place: no movement");
  } else {
    expect(deltas, "fit phase: a single minimal reveal").toHaveLength(1);
    note(
      "fit phase outcome",
      `no button position leaves room below it: minimal reveal of ${String(deltas[0])}px`,
    );
  }
}

async function seedLanguagePreference(page: Page, language: Language): Promise<void> {
  await page.evaluate(
    async ({ dbName, language }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, 50);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("appPreferences")) {
            db.createObjectStore("appPreferences", { keyPath: "id" });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("appPreferences", "readwrite");
          tx.objectStore("appPreferences").put({ id: "app", language });
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
      });
    },
    { dbName: DB_NAME, language },
  );
}

async function setRootText(page: Page, size: string): Promise<void> {
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = size;
  }, size);
  await page.waitForTimeout(150);
  await settle(page);
}

async function setSyntheticSafeAreaBottom(page: Page, px: number): Promise<void> {
  await page.evaluate((px) => {
    document.documentElement.style.setProperty(
      "--safe-area-inset-bottom",
      `${String(px)}px`,
    );
  }, px);
  await settle(page);
}

// --------------------------------------------------------------------------
// Planning: a restored-quality draft of eight waypoints, so the page below
// the action card is long enough to place the button anywhere in the band.

const WAYPOINT_COUNT = 8;

async function openPlanningWithDraft(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await installLocalMapStyle(page);
  await page.goto("/");
  if (language !== "en") {
    await seedLanguagePreference(page, language);
    await page.reload();
  }
  await page.getByRole("button", { name: COPY[language].plan, exact: true }).click();
  await expect(page.getByTestId("map-container")).toHaveAttribute(
    "data-map-ready",
    "true",
    {
      timeout: 20_000,
    },
  );
  const control = page.locator(".planning-crosshair-callout");
  for (let index = 0; index < WAYPOINT_COUNT; index += 1) {
    await expect(control).toBeEnabled({ timeout: 15_000 });
    await control.click();
  }
  await expect(page.locator(".waypoint-list li")).toHaveCount(WAYPOINT_COUNT);
  await expect
    .poll(async () => readDraftSummary(page), { timeout: 10_000 })
    .toMatch(new RegExp(`^${String(WAYPOINT_COUNT)}:`));
}

/** The stored draft's own content, compared before and after cancelling. */
async function readDraftSummary(page: Page): Promise<string> {
  const row = await readPlanningDraftRow(page);
  const waypoints = Array.isArray(row?.waypoints) ? row.waypoints : [];
  return `${String(waypoints.length)}:${JSON.stringify(waypoints)}:${String(row?.routeName)}`;
}

/** Sampled across longer than the 900ms autosave debounce. */
async function expectDraftUnchanged(page: Page, expected: string): Promise<void> {
  for (let sample = 0; sample < 6; sample += 1) {
    expect(await readDraftSummary(page)).toBe(expected);
    await page.waitForTimeout(220);
  }
  await expect(page.locator(".waypoint-list li")).toHaveCount(WAYPOINT_COUNT);
}

// --------------------------------------------------------------------------
// Routes: eight imported routes; the target is the fourth card from the top
// (most recent first), with cards above and below it.

const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const ROUTE_NAMES = Array.from({ length: 8 }, (_, index) => `Route ${String(index + 1)}`);
const TARGET_ROUTE = "Route 5";

function buildRouteGpx(): string {
  const points = Array.from({ length: 11 }, (_, index) => {
    const lon = -0.1 + (100 * index) / METRES_PER_DEGREE_LON;
    return `      <trkpt lat="51.5" lon="${String(lon)}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Confirmation reveal test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

async function openRoutesWithLibrary(page: Page, language: Language): Promise<string> {
  await installLocalMapStyle(page);
  await page.goto("/");
  for (const name of ROUTE_NAMES) {
    await page.getByLabel("Import GPX file").setInputFiles({
      name: `${name}.gpx`,
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(buildRouteGpx()),
    });
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  if (language !== "en") {
    await seedLanguagePreference(page, language);
    await page.reload();
  }
  const card = page.locator("li.route-card", {
    has: page.getByRole("button", { name: TARGET_ROUTE, exact: true }),
  });
  await expect(card).toHaveCount(1);
  const id = await card.getAttribute("data-route-id");
  if (!id) throw new Error("expected the target card's route id");
  return id;
}

async function expectLibraryUnchanged(page: Page): Promise<void> {
  await page.reload();
  for (const name of ROUTE_NAMES) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(1);
  }
  await expect(page.locator("li.route-card")).toHaveCount(ROUTE_NAMES.length);
}

function note(label: string, description: string): void {
  test.info().annotations.push({ type: label, description });
}

// --------------------------------------------------------------------------
// The matrix: each surface in English and German, at ordinary and 200%
// root text. Each test runs a fit phase (button high in the band) and a
// reveal phase (button just inside the band's bottom), with geometry before
// opening, while open and after closing.

for (const language of LANGUAGES) {
  for (const textSize of TEXT_SIZES) {
    test(`Clear draft (${language}, ${textSize}): fits without moving; reveals by the minimum; Escape and Cancel keep the position`, async ({
      page,
      context,
    }) => {
      test.setTimeout(120_000);
      await openPlanningWithDraft(page, context, language);
      await setRootText(page, textSize);
      const draft = await readDraftSummary(page);

      // Fit phase: the button high in the band, so the confirmation that
      // replaces it has room below.
      let placed = await placeTop(
        page,
        PLANNING.trigger,
        (await snapshot(page, PLANNING)).bandTop + 16,
      );
      const fitOpen = await openConfirmation(page, PLANNING);
      const fitBranch = expectOpening("fit phase open", fitOpen);
      note("fit phase", `${fitBranch}; button top ${placed.toFixed(1)}`);
      expectFitPhase(fitOpen);
      const fitClose = await closeConfirmation(page, PLANNING, "escape");
      note("fit phase Escape", expectCancellation("fit phase Escape", fitClose));
      await expectDraftUnchanged(page, draft);

      // Reveal phase: the button just inside the band's bottom, so the
      // confirmation opening in its place runs below it.
      const s = await snapshot(page, PLANNING);
      const buttonHeight = s.trigger?.height ?? 0;
      placed = await placeTop(page, PLANNING.trigger, s.bandBottom - buttonHeight - 4);
      const revealOpen = await openConfirmation(page, PLANNING);
      const revealBranch = expectOpening("reveal phase open", revealOpen);
      note("reveal phase", `${revealBranch}; button top ${placed.toFixed(1)}`);
      expect(
        revealOpen.deltas,
        "reveal phase: exactly one deliberate scroll",
      ).toHaveLength(1);
      const revealClose = await closeConfirmation(page, PLANNING, "cancel");
      note("reveal phase Cancel", expectCancellation("reveal phase Cancel", revealClose));
      await expectDraftUnchanged(page, draft);
    });

    test(`Delete route (${language}, ${textSize}): fits without moving; reveals by the minimum; Escape and Cancel keep the position`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const routeId = await openRoutesWithLibrary(page, language);
      await setRootText(page, textSize);
      const surface = routeCard(routeId);

      let placed = await placeTop(
        page,
        surface.trigger,
        (await snapshot(page, surface)).bandTop + 16,
      );
      const fitOpen = await openConfirmation(page, surface);
      const fitBranch = expectOpening("fit phase open", fitOpen);
      note("fit phase", `${fitBranch}; button top ${placed.toFixed(1)}`);
      expectFitPhase(fitOpen);
      const fitClose = await closeConfirmation(page, surface, "escape");
      note("fit phase Escape", expectCancellation("fit phase Escape", fitClose));

      const s = await snapshot(page, surface);
      const buttonHeight = s.trigger?.height ?? 0;
      placed = await placeTop(page, surface.trigger, s.bandBottom - buttonHeight - 4);
      const revealOpen = await openConfirmation(page, surface);
      const revealBranch = expectOpening("reveal phase open", revealOpen);
      note("reveal phase", `${revealBranch}; button top ${placed.toFixed(1)}`);
      expect(
        revealOpen.deltas,
        "reveal phase: exactly one deliberate scroll",
      ).toHaveLength(1);
      const revealClose = await closeConfirmation(page, surface, "cancel");
      note("reveal phase Cancel", expectCancellation("reveal phase Cancel", revealClose));

      await expectLibraryUnchanged(page);
    });
  }
}

// --------------------------------------------------------------------------
// An oversized confirmation: 200% root text, plus a synthetic safe-area
// inset sized from the confirmation's own measured height so the band is
// OVERSIZE_PX shorter than it — oversized for certain, in either engine's
// fonts, yet only just, so that a route card's Delete (which sits above
// its confirmation, unlike Planning's button, which the confirmation
// replaces) can still be placed where its whole action row shows.

const OVERSIZE_PX = 2;

async function expectOversizedBehaviour(page: Page, surface: Surface): Promise<void> {
  // Measure the confirmation where it fits, and its offsets from the
  // button: `insetOffset` from the button's top to the confirmation's top
  // (as opened, before any reveal), `bottomPadding` below its action row.
  let s = await snapshot(page, surface);
  await placeTop(page, surface.trigger, s.bandTop + 16);
  const probe = await openConfirmation(page, surface);
  const probeMoved = probe.open.scrollY - probe.before.scrollY;
  const { inset: probeInset, actions: probeActions } = probe.open;
  const probeButton = probe.before.trigger;
  if (!probeInset || !probeActions || !probeButton) {
    throw new Error("expected the confirmation and its button to lay out");
  }
  const insetHeight = probeInset.height;
  const insetOffset = probeInset.top + probeMoved - probeButton.top;
  const bottomPadding = probeInset.bottom - probeActions.bottom;
  const actionsHeight = probeActions.height;
  await closeConfirmation(page, surface, "escape");

  s = await snapshot(page, surface);
  const visibleBottom = s.bandBottom + GAP; // with no synthetic inset yet
  const syntheticInset = Math.max(
    0,
    Math.ceil(visibleBottom - GAP - (s.bandTop + insetHeight - OVERSIZE_PX)),
  );
  await setSyntheticSafeAreaBottom(page, syntheticInset);
  note("synthetic safe-area inset", `${String(syntheticInset)}px`);

  // Actions below the band: exactly enough to bring the complete row to
  // the band's bottom, with the explanation reachable by scrolling up.
  s = await snapshot(page, surface);
  await placeTop(page, surface.trigger, s.bandBottom - (s.trigger?.height ?? 0) - 4);
  const below = await openConfirmation(page, surface);
  expect(expectOpening("actions below the band", below)).toBe("oversized");
  expect(below.deltas).toHaveLength(1);
  const { actions, message } = below.open;
  if (!actions || !message) throw new Error("expected the confirmation to lay out");
  expect(Math.abs(actions.bottom - below.open.bandBottom)).toBeLessThanOrEqual(
    EDGE_TOLERANCE,
  );
  expect(below.open.scrollY + message.top).toBeGreaterThanOrEqual(below.open.bandTop - 1);
  // Whether the button now needs correcting depends on how far the reveal
  // carried it; either way, only by the minimum (asserted inside).
  const belowClose = await closeConfirmation(page, surface, "cancel");
  note(
    "after actions below, Cancel",
    expectCancellation("after actions below", belowClose),
  );

  // Actions already inside the band, with the button still inside the
  // viewport — partly under the sticky header where possible, which a
  // keyboard rider can activate because the browser counts a header-covered
  // control as visible and does not scroll to it. (A button above the
  // viewport is reachable by neither tap nor Tab; there, the browser's own
  // scroll anchoring moves the page when the confirmation opens above its
  // anchor — measured as 644px in Chromium with no deliberate scroll.)
  // Of the button positions inside the viewport that keep the whole row
  // in the band, the one where item 118's bottom-anchoring would have
  // moved the page furthest — so the case discriminates. For Planning that
  // is the confirmation cut at its top; for a route card, whose Delete sits
  // well above its confirmation, it is the confirmation cut only by its
  // own padding below the row.
  s = await snapshot(page, surface);
  const highest = s.bandBottom + bottomPadding - insetHeight - insetOffset;
  const lowest = s.bandTop + actionsHeight + bottomPadding - insetHeight - insetOffset;
  const legacyAt = (top: number) => top + insetOffset + insetHeight - s.bandBottom;
  const buttonTop = [Math.max(0, lowest) + 4, highest - 1]
    .filter((top) => top >= 0 && top >= lowest && top <= highest - 1)
    .reduce(
      (best, top) => (Math.abs(legacyAt(top)) > Math.abs(legacyAt(best)) ? top : best),
      highest - 1,
    );
  note(
    "actions-inside geometry",
    `inset ${insetHeight.toFixed(1)}px, offset ${insetOffset.toFixed(1)}px, padding ${bottomPadding.toFixed(1)}px; button top ${buttonTop.toFixed(1)}; ${legacyAt(buttonTop) < 0 ? "top cut" : "padding cut"}`,
  );
  expect(buttonTop, "a position inside the viewport exists").toBeGreaterThanOrEqual(0);
  await placeTop(page, surface.trigger, buttonTop);
  const inside = await openConfirmation(page, surface, "keyboard");
  expect(expectOpening("actions already inside the band", inside)).toBe("oversized");
  expect(inside.deltas, "no movement when the complete row already shows").toEqual([]);
  expect(inside.open.scrollY).toBe(inside.before.scrollY);
  // Discriminating: item 118's bottom-anchoring would have moved the page
  // here, because the confirmation's own bottom is not on the band's edge.
  const legacyDelta = (inside.open.inset?.bottom ?? 0) - inside.open.bandBottom;
  note("actions-inside legacy delta", legacyDelta.toFixed(1));
  expect(Math.abs(legacyDelta)).toBeGreaterThanOrEqual(1);
  const insideClose = await closeConfirmation(page, surface, "escape");
  note(
    "after actions inside, Escape",
    expectCancellation("after actions inside", insideClose),
  );
}

test("Clear draft, oversized: only the action row is brought in, none when it already shows; closing corrects the button only by the minimum", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await openPlanningWithDraft(page, context, "en");
  const draft = await readDraftSummary(page);
  await setRootText(page, "200%");
  await expectOversizedBehaviour(page, PLANNING);
  await expectDraftUnchanged(page, draft);
});

test("Delete route, oversized: only the action row is brought in, none when it already shows; closing corrects the button only by the minimum", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const routeId = await openRoutesWithLibrary(page, "en");
  await setRootText(page, "200%");
  await expectOversizedBehaviour(page, routeCard(routeId));
  await expectLibraryUnchanged(page);
});

// --------------------------------------------------------------------------
// Scrolling by hand while the confirmation is open. The rider's position
// at the moment of cancelling is kept; the position from before opening is
// never restored.

test("Clear draft: a manual scroll while open is kept, renders do not reveal again, a reopen re-measures, and a hidden button is corrected by the minimum", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await openPlanningWithDraft(page, context, "en");
  const draft = await readDraftSummary(page);
  let s = await snapshot(page, PLANNING);
  await placeTop(page, PLANNING.trigger, s.bandTop + 120);
  const first = await openConfirmation(page, PLANNING);
  expect(expectOpening("first opening", first)).toBe("fits");
  expect(first.deltas).toEqual([]);

  // (i) The button is unmounted while open, so the arrangement is made
  // from the confirmation's own top edge — the slot it remounts into —
  // which stays inside the band after a small scroll.
  await scrollPageBy(page, 30);
  s = await snapshot(page, PLANNING);
  expect(s.inset && s.inset.top >= s.bandTop).toBe(true);
  // At least one useNow tick re-renders Planning while it is open.
  await recordDeliberateScrolls(page);
  await page.waitForTimeout(1_200);
  expect(await deliberateScrolls(page), "no reveal on an unrelated render").toEqual([]);
  expect((await snapshot(page, PLANNING)).cancelFocused).toBe(true);
  const kept = await closeConfirmation(page, PLANNING, "cancel");
  expect(expectCancellation("manual scroll, button visible", kept)).toBe("kept");
  expect(kept.after.scrollY).not.toBe(first.before.scrollY);
  expect(Math.abs(kept.after.scrollY - kept.open.scrollY)).toBeLessThanOrEqual(1);

  // Reopening measures afresh, from wherever the page now is.
  s = await snapshot(page, PLANNING);
  await placeTop(page, PLANNING.trigger, s.bandBottom - (s.trigger?.height ?? 0) - 4);
  const reopened = await openConfirmation(page, PLANNING);
  expectOpening("reopened", reopened);
  expect(reopened.deltas).toHaveLength(1);

  // (ii) The confirmation's top — and the routing summary above it — under
  // the sticky header; Cancel itself still in view. Enter on Cancel.
  s = await snapshot(page, PLANNING);
  await placeTop(page, PLANNING.dialog, s.bandTop - GAP - 40);
  s = await snapshot(page, PLANNING);
  expect(s.actions && isWithinBand(s.actions, s)).toBe(true);
  const corrected = await closeConfirmation(page, PLANNING, "enter");
  expect(expectCancellation("manual scroll, button under the header", corrected)).toBe(
    "corrected",
  );
  expect(
    Math.abs((corrected.after.trigger?.top ?? 0) - corrected.after.bandTop),
  ).toBeLessThanOrEqual(EDGE_TOLERANCE);
  await expectDraftUnchanged(page, draft);
});

test("Delete route: a manual scroll while open is kept, a reopen re-measures, a hidden button is corrected by the minimum, and the last card's collapse is allowed for", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const routeId = await openRoutesWithLibrary(page, "en");
  const surface = routeCard(routeId);
  let s = await snapshot(page, surface);
  await placeTop(page, surface.trigger, s.bandTop + 120);
  const first = await openConfirmation(page, surface);
  expect(expectOpening("first opening", first)).toBe("fits");
  expect(first.deltas).toEqual([]);

  // (i) Delete stays mounted, so it is measured directly: still visible.
  await scrollPageBy(page, 30);
  s = await snapshot(page, surface);
  expect(s.trigger && isWithinBand(s.trigger, s)).toBe(true);
  const kept = await closeConfirmation(page, surface, "cancel");
  expect(expectCancellation("manual scroll, button visible", kept)).toBe("kept");
  expect(kept.after.scrollY).not.toBe(first.before.scrollY);

  s = await snapshot(page, surface);
  await placeTop(page, surface.trigger, s.bandBottom - (s.trigger?.height ?? 0) - 4);
  const reopened = await openConfirmation(page, surface);
  expectOpening("reopened", reopened);
  expect(reopened.deltas).toHaveLength(1);

  // (ii) Delete under the sticky header, Cancel still in view.
  s = await snapshot(page, surface);
  await placeTop(page, surface.trigger, s.bandTop - GAP - 30);
  s = await snapshot(page, surface);
  expect(s.actions && isWithinBand(s.actions, s)).toBe(true);
  const corrected = await closeConfirmation(page, surface, "enter");
  expect(expectCancellation("manual scroll, button under the header", corrected)).toBe(
    "corrected",
  );

  // (iii) The last card at the very bottom: the confirmation lengthens the
  // document while open and its collapse shortens it again.
  const lastCard = page.locator("li.route-card").last();
  const lastId = await lastCard.getAttribute("data-route-id");
  if (!lastId) throw new Error("expected the last card's route id");
  const last = routeCard(lastId);
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await settle(page);
  const lastOpen = await openConfirmation(page, last);
  expectOpening("last card open", lastOpen);
  const lastClose = await closeConfirmation(page, last, "cancel");
  note("last card Cancel", expectCancellation("last card Cancel", lastClose));
  expect(lastClose.after.maxScrollY).toBeLessThan(lastClose.open.maxScrollY);

  await expectLibraryUnchanged(page);
});

// --------------------------------------------------------------------------
// Opening Clear draft while the route-name field has focus — the case an
// iPhone rider reaches with the software keyboard open. Desktop engines
// have no software keyboard, so the keyboard closing during the reveal is
// NOT reproduced here; this proves only the focus hand-off and the reveal
// geometry from that starting point.

for (const language of LANGUAGES) {
  test(`Clear draft (${language}) opened from the focused route-name field: the field blurs, Cancel takes focus, the reveal is minimal and the name is kept`, async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await openPlanningWithDraft(page, context, language);
    const field = page.locator("#planning-route-name");
    await field.fill("Name typed before clearing");
    await expect
      .poll(() => readDraftSummary(page), { timeout: 5_000 })
      .toMatch(/:Name typed before clearing$/);
    const draft = await readDraftSummary(page);
    await expect(field).toBeFocused();

    const s = await snapshot(page, PLANNING);
    await placeTop(page, PLANNING.trigger, s.bandBottom - (s.trigger?.height ?? 0) - 4);
    await expect(field).toBeFocused();
    const opened = await openConfirmation(page, PLANNING);
    expect(expectOpening("from the focused field", opened)).toBe("fits");
    expect(opened.deltas).toHaveLength(1);
    await expect(field).not.toBeFocused();

    const closed = await closeConfirmation(page, PLANNING, "cancel");
    expectCancellation("from the focused field, Cancel", closed);
    await expect(field).toHaveValue("Name typed before clearing");
    await expectDraftUnchanged(page, draft);
  });
}
