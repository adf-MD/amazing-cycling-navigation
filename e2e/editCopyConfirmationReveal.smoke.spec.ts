import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import {
  readActiveRideStateRow,
  readPlanningDraftRow,
  readSavedRouteId,
} from "./support/rideStateDb.ts";
import {
  expectQuietTransition,
  measureTransition,
  type Transition,
} from "./support/rideTransitionProbe.ts";

// Backlog item 124's inventory case C-12, slice 7: the opening of Edit
// copy's "Replace your current draft?" confirmation, in both engines (this
// file runs under the "chromium" and "webkit-smoke" projects), at 390x844
// portrait, in English and German, at ordinary and 200% root text. Since
// backlog item 124's decision 4, it also holds the ride-transition case: an
// unconfirmed confirmation closes quietly when Start riding succeeds and
// does not reappear on Pause, judged against the same transitions made with
// nothing open (e2e/support/rideTransitionProbe.ts).
//
// The rule, approved on 2 October 2026 (decision 7): no movement when the
// confirmation fits the usable band where it opens; otherwise the minimum
// movement that shows all of it; and when it is taller than the band, only
// as far as completes its Cancel/Confirm row — none when that row already
// shows. Instant, once per opening, re-measured on reopening; Cancel takes
// focus without the browser's own focus scroll.
//
// The usable band is the one the app measures: from the sticky navigation's
// bottom (or the visual viewport's top) plus 8 px, to the visual viewport's
// bottom less the safe-area inset and 8 px.
//
// Input is real — pointer clicks at measured centres, key presses and wheel
// input — except where a step is labelled synthetic: a safe-area inset set on
// the root (the seam index.css documents). The app's own scroll calls are
// recorded, and so are focus calls made by script that actually moved focus,
// with their options and the page's geometry just before them. The minimum
// is computed by the rule from that pre-focus geometry, so the same
// assertion judges an unchanged build's browser focus scroll and the
// repair's deliberate reveal. Outcomes are asserted twice over, and labelled:
// - [behaviour] what the rider sees: Cancel focused, the confirmation or its
//   action row inside the band, and a movement of exactly the minimum;
// - [implementation] how: a focus call with preventScroll, and the app's one
//   scroll call accounting for all the movement.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const GAP = 8;
const TOLERANCE_PX = 1;

const ROUTE_NAME = "edit-copy-reveal-route";
const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
const ROUTE_LENGTH_METRES = 1000;
const ROUTE_SEGMENTS = 50;
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;

const OLD_DRAFT_NAME = "Unsaved plan";
const OLD_DRAFT = {
  id: "draft",
  waypoints: [
    { id: "wp-a", coordinate: [-0.1, 51.5] },
    { id: "wp-b", coordinate: [-0.09, 51.51] },
  ],
  routeName: OLD_DRAFT_NAME,
  avoidFerries: true,
  profile: "cycling-road",
  updatedAt: "2026-10-03T08:00:00.000Z",
};

const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];
const TEXT_SIZES = ["100%", "200%"] as const;
type TextSize = (typeof TEXT_SIZES)[number];

const COPY = {
  en: {
    editCopy: "Edit copy",
    confirmTitle: "Replace your current draft?",
    confirmLabel: "Replace and edit",
    cancel: "Cancel",
    startRiding: "Start riding",
    resumeRide: "Resume ride",
    pause: "Pause",
    endRide: "End ride",
    endTitle: "End this ride?",
    ride: "Ride",
    routes: "Routes",
    plan: "Plan",
  },
  de: {
    editCopy: "Kopie bearbeiten",
    confirmTitle: "Aktuellen Entwurf ersetzen?",
    confirmLabel: "Ersetzen und bearbeiten",
    cancel: "Abbrechen",
    startRiding: "Fahrt starten",
    resumeRide: "Fahrt fortsetzen",
    pause: "Pause",
    endRide: "Fahrt beenden",
    endTitle: "Diese Fahrt beenden?",
    ride: "Fahren",
    routes: "Routen",
    plan: "Planen",
  },
} as const;

interface Rect {
  top: number;
  bottom: number;
}

/** A focus call made by script that left focus on its target, with the
 * geometry of its confirmation and the band just before the call. */
interface FocusRecord {
  tag: string;
  text: string;
  dialogTitle: string | null;
  preventScroll: boolean;
  scrollYBefore: number;
  scrollYAfter: number;
  maxScrollYBefore: number;
  dialogBefore: Rect | null;
  actionsBefore: Rect | null;
  bandBefore: Rect;
}

/** The in-page fixture state; see installFixtures. */
interface AcnFixture {
  scrolls: string[];
  scrollByDeltas: number[];
  focusCalls: FocusRecord[];
}
type FixtureWindow = Window & { __acn: AcnFixture };

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

function buildStraightRouteGpx(): string {
  const points = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => {
    const distanceMetres = (ROUTE_LENGTH_METRES / ROUTE_SEGMENTS) * index;
    return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(distanceMetres))}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${ROUTE_NAME}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

/** Installed before any of the app's scripts run. */
async function installFixtures(page: Page): Promise<void> {
  await page.addInitScript((gap) => {
    const fixture: AcnFixture = { scrolls: [], scrollByDeltas: [], focusCalls: [] };
    (window as unknown as FixtureWindow).__acn = fixture;

    const rectOf = (node: Element | null | undefined) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    const bandNow = () => {
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
      return {
        top: Math.max(rectOf(header)?.bottom ?? 0, visibleTop) + gap,
        bottom: visibleBottom - (safeArea + gap),
      };
    };

    // The caller's own arguments are forwarded unchanged: scrollBy(options)
    // and scrollBy(x, y) are different overloads.
    const scrollBy = window.scrollBy.bind(window) as (...args: unknown[]) => void;
    window.scrollBy = (...args: unknown[]) => {
      fixture.scrolls.push(`scrollBy ${JSON.stringify(args)}`);
      const first = args[0];
      const delta =
        typeof first === "object" && first !== null
          ? ((first as ScrollToOptions).top ?? 0)
          : typeof args[1] === "number"
            ? args[1]
            : 0;
      fixture.scrollByDeltas.push(delta);
      scrollBy(...args);
    };
    const scrollTo = window.scrollTo.bind(window) as (...args: unknown[]) => void;
    window.scrollTo = (...args: unknown[]) => {
      fixture.scrolls.push(`scrollTo ${JSON.stringify(args)}`);
      scrollTo(...args);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (
      this: Element,
      arg?: boolean | ScrollIntoViewOptions,
    ) {
      fixture.scrolls.push(`scrollIntoView ${this.tagName}`);
      scrollIntoView.call(this, arg);
    };
    // Only calls that actually leave focus on their target are recorded: a
    // call on a disabled button does nothing, and React's own commit makes
    // one when a focused button it disables is blurred. React's own
    // autoFocus is a focus() call made during its commit, so an unchanged
    // build's opening is recorded here too.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      const dialog = this.closest('[role="dialog"]');
      const scroller = document.scrollingElement ?? document.documentElement;
      const before = {
        scrollYBefore: window.scrollY,
        maxScrollYBefore: scroller.scrollHeight - scroller.clientHeight,
        dialogBefore: rectOf(dialog),
        actionsBefore: rectOf(dialog?.querySelector(".route-delete-confirm-actions")),
        bandBefore: bandNow(),
      };
      focus.call(this, options);
      if (document.activeElement !== this) return;
      fixture.focusCalls.push({
        tag: this.tagName,
        text: this.textContent.trim(),
        dialogTitle: dialog?.querySelector("h2, h3, h4")?.textContent.trim() ?? null,
        preventScroll: options?.preventScroll === true,
        scrollYAfter: window.scrollY,
        ...before,
      });
    };
  }, GAP);
}

async function writeRow(page: Page, store: string, row: object): Promise<void> {
  await page.evaluate(
    ({ dbName, store, row }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put(row);
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
      }),
    { dbName: DB_NAME, store, row },
  );
}

async function seedLanguagePreference(page: Page, language: Language): Promise<void> {
  await writeRow(page, "appPreferences", { id: "app", language });
}

/** Waits for scrollY to hold still over timer-driven samples (never
 * animation frames: headless WebKit can defer them). */
async function settle(page: Page, quietMs = 300): Promise<void> {
  await page.evaluate(
    (quietMs) =>
      new Promise<void>((resolve) => {
        let last = scrollY;
        let since = performance.now();
        const start = performance.now();
        const tick = () => {
          if (scrollY !== last) {
            last = scrollY;
            since = performance.now();
          }
          if (performance.now() - since >= quietMs || performance.now() - start > 5_000) {
            resolve();
            return;
          }
          setTimeout(tick, 25);
        };
        setTimeout(tick, 25);
      }),
    quietMs,
  );
}

async function setRootText(page: Page, size: TextSize): Promise<void> {
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = size;
  }, size);
  await page.waitForTimeout(150);
  await settle(page);
}

/** Synthetic: a safe-area inset set on the root, the seam index.css
 * documents for these properties. */
async function setSyntheticSafeAreaBottom(page: Page, px: number): Promise<void> {
  await page.evaluate((px) => {
    document.documentElement.style.setProperty(
      "--safe-area-inset-bottom",
      `${String(px)}px`,
    );
  }, px);
  await settle(page);
}

async function resetRecords(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fixture = (window as unknown as FixtureWindow).__acn;
    fixture.scrolls = [];
    fixture.scrollByDeltas = [];
    fixture.focusCalls = [];
  });
}

const records = (page: Page): Promise<AcnFixture> =>
  page.evaluate(() => {
    const fixture = (window as unknown as FixtureWindow).__acn;
    return {
      scrolls: [...fixture.scrolls],
      scrollByDeltas: [...fixture.scrollByDeltas],
      focusCalls: [...fixture.focusCalls],
    };
  });

interface Snapshot {
  scrollY: number;
  scrollX: number;
  maxScrollY: number;
  headerPresent: boolean;
  band: Rect;
  editCopy: Rect | null;
  dialog: Rect | null;
  actions: Rect | null;
  title: Rect | null;
  cancelFocused: boolean;
  editCopyFocused: boolean;
}

/** One atomic in-page read, so nothing can move between measurements. */
function snapshot(page: Page, language: Language): Promise<Snapshot> {
  return page.evaluate(
    ({ gap, title, editCopy }) => {
      const rectOf = (node: Element | null | undefined) => {
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
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
      const dialog =
        [...document.querySelectorAll('[role="dialog"]')].find(
          (node) => node.querySelector("h2, h3, h4")?.textContent.trim() === title,
        ) ?? null;
      const actions = dialog?.querySelector(".route-delete-confirm-actions") ?? null;
      const cancel = actions?.querySelector("button") ?? null;
      const editCopyButton =
        [...document.querySelectorAll("button")].find(
          (node) =>
            node.textContent.trim() === editCopy && !node.closest('[role="dialog"]'),
        ) ?? null;
      const scroller = document.scrollingElement ?? document.documentElement;
      return {
        scrollY: window.scrollY,
        scrollX: window.scrollX,
        maxScrollY: scroller.scrollHeight - scroller.clientHeight,
        headerPresent: header !== null,
        band: {
          top: Math.max(rectOf(header)?.bottom ?? 0, visibleTop) + gap,
          bottom: visibleBottom - (safeArea + gap),
        },
        editCopy: rectOf(editCopyButton),
        dialog: rectOf(dialog),
        actions: rectOf(actions),
        title: rectOf(dialog?.querySelector("h2, h3, h4")),
        cancelFocused: cancel !== null && document.activeElement === cancel,
        editCopyFocused:
          editCopyButton !== null && document.activeElement === editCopyButton,
      };
    },
    { gap: GAP, title: COPY[language].confirmTitle, editCopy: COPY[language].editCopy },
  );
}

/** A real mouse click at the element's centre, after proving that point
 * lies inside the viewport and hits the element itself (or something inside
 * it) — never through Playwright's own scroll-into-view. */
async function pointerClick(page: Page, locator: Locator): Promise<void> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("pointerClick: element is not laid out");
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  expect(y, "the click point is inside the viewport").toBeGreaterThan(0);
  expect(y, "the click point is inside the viewport").toBeLessThan(844);
  const hits = await locator.evaluate(
    (element, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      return hit !== null && (hit === element || element.contains(hit));
    },
    { x, y },
  );
  expect(hits, "the click point hits the intended element").toBe(true);
  await page.mouse.click(x, y);
}

/** Wheel input over ordinary page content, never the map or the header. */
async function wheelBy(page: Page, dy: number): Promise<void> {
  const point = await page.evaluate(() => {
    for (let y = innerHeight - 30; y > 100; y -= 20) {
      const hit = document.elementFromPoint(6, y);
      if (hit && !hit.closest(".maplibregl-map, [data-testid='map-container'], header")) {
        return { x: 6, y };
      }
    }
    throw new Error("no wheel point outside the map");
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, dy);
  await settle(page);
}

const editCopyButton = (page: Page, language: Language): Locator =>
  page.getByRole("button", { name: COPY[language].editCopy, exact: true });
const confirmation = (page: Page, language: Language): Locator =>
  page.getByRole("dialog", { name: COPY[language].confirmTitle });
const cancelButton = (page: Page, language: Language): Locator =>
  confirmation(page, language).getByRole("button", {
    name: COPY[language].cancel,
    exact: true,
  });

function note(type: string, description: string): void {
  test.info().annotations.push({ type, description });
}

async function routeFileImport(page: Page): Promise<string> {
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${ROUTE_NAME}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildStraightRouteGpx()),
  });
  await expect(page.getByRole("button", { name: ROUTE_NAME, exact: true })).toBeVisible();
  const routeId = await readSavedRouteId(page, ROUTE_NAME);
  if (!routeId) throw new Error("expected the imported route's id");
  return routeId;
}

async function prepare(page: Page, context: BrowserContext): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  await installLocalMapStyle(page);
  await installFixtures(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: ROUTE_START_LON });
  return pageErrors;
}

/** Imports the route, stores a meaningful Planning draft, applies the
 * language and opens the route's pre-ride screen from Routes, at the top of
 * the page. Returns the route's id. */
async function openPreRide(
  page: Page,
  context: BrowserContext,
  language: Language,
  size: TextSize,
): Promise<{ routeId: string; pageErrors: string[] }> {
  const pageErrors = await prepare(page, context);
  await page.goto("/");
  const routeId = await routeFileImport(page);
  await writeRow(page, "planningDrafts", OLD_DRAFT);
  if (language !== "en") await seedLanguagePreference(page, language);
  await page.reload();
  await page.getByRole("button", { name: ROUTE_NAME, exact: true }).click();
  await expect(editCopyButton(page, language)).toBeEnabled();
  await setRootText(page, size);
  return { routeId, pageErrors };
}

/** The ride is tracking with a fix 400 m along the route. */
async function startRidingWithFix(
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<void> {
  await pointerClick(
    page,
    page.getByRole("button", { name: COPY[language].startRiding }),
  );
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });
  await context.setGeolocation({ latitude: ROUTE_LAT, longitude: lonAtMetres(400) });
  await expect
    .poll(() => readActiveRideStateRow(page), { timeout: 10_000 })
    .toMatchObject({ kind: "route", lastFix: expect.anything() });
}

interface Opening {
  before: Snapshot;
  after: Snapshot;
  fixture: AcnFixture;
}

/** Opens the replacement confirmation: a real click on Edit copy, or — where
 * Edit copy is partly under the sticky navigation — keyboard activation of
 * the focused button, which the browser counts as visible and so does not
 * scroll to. */
async function openReplacement(
  page: Page,
  language: Language,
  how: "pointer" | "keyboard" = "pointer",
): Promise<Opening> {
  const trigger = editCopyButton(page, language);
  if (how === "keyboard") {
    await trigger.evaluate((element) => {
      (element as HTMLElement).focus({ preventScroll: true });
    });
  }
  await resetRecords(page);
  const before = await snapshot(page, language);
  if (how === "pointer") await pointerClick(page, trigger);
  else await page.keyboard.press("Enter");
  await expect(confirmation(page, language)).toBeVisible();
  await settle(page);
  return { before, after: await snapshot(page, language), fixture: await records(page) };
}

type Branch =
  | "fits, no movement"
  | "minimum reveal"
  | "oversized, action row"
  | "oversized, row shows";

/** The rule, applied to the confirmation's geometry just before Cancel's
 * focus call: the movement that is warranted, clamped to the page's own
 * scrollable range as window.scrollBy clamps it. */
function warranted(record: FocusRecord): { delta: number; branch: Branch } {
  const dialog = record.dialogBefore;
  const actions = record.actionsBefore;
  if (!dialog || !actions) throw new Error("the focus call recorded no confirmation");
  const band = record.bandBefore;
  const fits = dialog.bottom - dialog.top <= band.bottom - band.top;
  let delta = 0;
  if (fits) {
    if (dialog.bottom > band.bottom) delta = dialog.bottom - band.bottom;
    else if (dialog.top < band.top) delta = dialog.top - band.top;
  } else if (actions.bottom > band.bottom) delta = actions.bottom - band.bottom;
  else if (actions.top < band.top) delta = actions.top - band.top;
  if (Math.abs(delta) < TOLERANCE_PX) delta = 0;
  const target = Math.min(
    Math.max(record.scrollYBefore + delta, 0),
    record.maxScrollYBefore,
  );
  const clamped = target - record.scrollYBefore;
  const branch: Branch = fits
    ? delta === 0
      ? "fits, no movement"
      : "minimum reveal"
    : delta === 0
      ? "oversized, row shows"
      : "oversized, action row";
  return { delta: clamped, branch };
}

/** Asserts one opening against the rule and returns the branch it took. */
function expectOpening(label: string, language: Language, opening: Opening): Branch {
  const { after, fixture } = opening;
  const calls = fixture.focusCalls.filter(
    (call) =>
      call.dialogTitle === COPY[language].confirmTitle &&
      call.text === COPY[language].cancel,
  );
  expect(calls, `${label}: one focus call landed on Cancel`).toHaveLength(1);
  const call = calls[0];
  const { delta, branch } = warranted(call);
  const moved = after.scrollY - call.scrollYBefore;
  const appMoved = fixture.scrollByDeltas.reduce((sum, d) => sum + d, 0);
  const height = (call.dialogBefore?.bottom ?? 0) - (call.dialogBefore?.top ?? 0);
  note(
    "opening",
    JSON.stringify({
      label,
      branch,
      editCopyBefore: opening.before.editCopy,
      scrollYBeforeOpening: opening.before.scrollY,
      band: call.bandBefore,
      dialogBefore: call.dialogBefore,
      actionsBefore: call.actionsBefore,
      height: Math.round(height * 10) / 10,
      warranted: Math.round(delta * 10) / 10,
      moved: Math.round(moved * 10) / 10,
      browserFocusScroll: Math.round((call.scrollYAfter - call.scrollYBefore) * 10) / 10,
      appScrolls: fixture.scrolls,
      preventScroll: call.preventScroll,
      dialogAfter: after.dialog,
      actionsAfter: after.actions,
      titleAfter: after.title,
    }),
  );
  expect.soft(after.cancelFocused, `[behaviour] ${label}: Cancel has focus`).toBe(true);
  expect
    .soft(
      Math.abs(moved - delta),
      `[behaviour] ${label}: moved ${moved.toFixed(1)} px; the rule warrants ${delta.toFixed(1)} px (${branch})`,
    )
    .toBeLessThanOrEqual(TOLERANCE_PX);
  const inBand = (rect: Rect | null) =>
    rect !== null &&
    rect.top >= after.band.top - TOLERANCE_PX &&
    rect.bottom <= after.band.bottom + TOLERANCE_PX;
  expect
    .soft(
      inBand(after.actions),
      `[behaviour] ${label}: the complete action row is in the band`,
    )
    .toBe(true);
  if (branch === "fits, no movement" || branch === "minimum reveal") {
    expect
      .soft(
        inBand(after.dialog),
        `[behaviour] ${label}: the whole confirmation is in the band`,
      )
      .toBe(true);
  }
  expect.soft(after.scrollX, `[behaviour] ${label}: no horizontal scroll`).toBe(0);
  expect
    .soft(call.preventScroll, `[implementation] ${label}: focus({ preventScroll: true })`)
    .toBe(true);
  expect
    .soft(
      fixture.scrolls.length,
      `[implementation] ${label}: at most one deliberate scroll: ${fixture.scrolls.join("; ")}`,
    )
    .toBeLessThanOrEqual(delta === 0 ? 0 : 1);
  expect
    .soft(
      Math.abs(appMoved - moved),
      `[implementation] ${label}: the app's own scroll (${appMoved.toFixed(1)} px) accounts for all the movement`,
    )
    .toBeLessThanOrEqual(TOLERANCE_PX);
  return branch;
}

/** Cancel by pointer or Escape: the confirmation closes, focus returns to
 * Edit copy as it always has, and the stored draft is untouched. */
async function cancelKeepsDraft(
  page: Page,
  language: Language,
  how: "pointer" | "escape",
): Promise<void> {
  if (how === "pointer") await pointerClick(page, cancelButton(page, language));
  else await page.keyboard.press("Escape");
  await expect(confirmation(page, language)).toHaveCount(0);
  await expect(editCopyButton(page, language)).toBeFocused();
  expect(await readPlanningDraftRow(page)).toMatchObject({
    routeName: OLD_DRAFT_NAME,
    waypoints: OLD_DRAFT.waypoints,
    updatedAt: OLD_DRAFT.updatedAt,
  });
  await settle(page);
}

// ---------------------------------------------------------------------------
// The pre-ride screen, Edit copy where it naturally sits (the page's top):
// the lowest position reachable at this viewport, since the panel starts at
// the top of the screen.

for (const language of LANGUAGES) {
  for (const size of TEXT_SIZES) {
    const escape = language === "de" && size === "100%";
    test(`(${language}, ${size}) pre-ride: the opening moves the page only as the rule warrants, Cancel focused without the browser's focus scroll; ${escape ? "Escape" : "Cancel"} keeps the draft`, async ({
      page,
      context,
    }) => {
      const { pageErrors } = await openPreRide(page, context, language, size);
      const opening = await openReplacement(page, language);
      const branch = expectOpening("opening", language, opening);
      note("branch", branch);
      await cancelKeepsDraft(page, language, escape ? "escape" : "pointer");
      expect(pageErrors).toEqual([]);
    });
  }
}

// ---------------------------------------------------------------------------
// Close and reopen: the second opening is measured afresh, from wherever the
// rider has since put the page.

test("(en, 200%) reopening after Cancel and a wheel scroll is measured afresh", async ({
  page,
  context,
}) => {
  await openPreRide(page, context, "en", "200%");
  const first = await openReplacement(page, "en");
  expectOpening("first opening", "en", first);
  await cancelKeepsDraft(page, "en", "pointer");
  // Put Edit copy in a clearly different place, by real wheel input, while
  // keeping it clickable inside the band.
  const placed = await snapshot(page, "en");
  if (!placed.editCopy) throw new Error("expected Edit copy to lay out");
  await wheelBy(page, placed.editCopy.top - (placed.band.top + 120));
  const second = await openReplacement(page, "en");
  expectOpening("second opening", "en", second);
  const firstMoved = first.after.scrollY - first.before.scrollY;
  const secondMoved = second.after.scrollY - second.before.scrollY;
  note(
    "reopen",
    `first moved ${firstMoved.toFixed(1)} px, second ${secondMoved.toFixed(1)} px`,
  );
  expect
    .soft(
      Math.abs(firstMoved - secondMoved),
      "[behaviour] the second opening did not replay the first one's movement",
    )
    .toBeGreaterThan(TOLERANCE_PX);
  await cancelKeepsDraft(page, "en", "pointer");
});

// ---------------------------------------------------------------------------
// Oversized, with the complete action row already in the band: no movement.
// Synthetic: a safe-area inset sized from the measured confirmation so the
// band is 2 px shorter than it, with Edit copy placed by wheel where the row
// shows; opened from the keyboard, since Edit copy is then partly under the
// sticky navigation.

const OVERSIZE_PX = 2;

test("(en, 200%) oversized with its action row already showing: no movement", async ({
  page,
  context,
}) => {
  await openPreRide(page, context, "en", "200%");
  // Probe the confirmation's height, its offset below Edit copy's top and
  // the padding below its action row, where it opens (before any reveal).
  const probe = await openReplacement(page, "en");
  const probeCall = probe.fixture.focusCalls.find(
    (call) => call.dialogTitle === COPY.en.confirmTitle,
  );
  const { editCopy } = probe.before;
  if (!probeCall?.dialogBefore || !probeCall.actionsBefore || !editCopy) {
    throw new Error("expected the confirmation and Edit copy to lay out");
  }
  const scrolledBeforeFocus = probeCall.scrollYBefore - probe.before.scrollY;
  const height = probeCall.dialogBefore.bottom - probeCall.dialogBefore.top;
  const offset = probeCall.dialogBefore.top + scrolledBeforeFocus - editCopy.top;
  const padding = probeCall.dialogBefore.bottom - probeCall.actionsBefore.bottom;
  await cancelKeepsDraft(page, "en", "pointer");

  const s = await snapshot(page, "en");
  const visibleBottom = s.band.bottom + GAP; // no synthetic inset yet
  const inset = Math.max(
    0,
    Math.ceil(visibleBottom - GAP - (s.band.top + height - OVERSIZE_PX)),
  );
  await setSyntheticSafeAreaBottom(page, inset);
  const withInset = await snapshot(page, "en");
  // Highest Edit copy top that still leaves the whole row inside the band:
  // the confirmation then overflows only by its own padding below the row.
  const editCopyTop = withInset.band.bottom + padding - height - offset - 1;
  note(
    "oversized geometry",
    JSON.stringify({ inset, height, offset, padding, band: withInset.band, editCopyTop }),
  );
  if (!withInset.editCopy) throw new Error("expected Edit copy to lay out");
  await wheelBy(page, withInset.editCopy.top - editCopyTop);
  const placed = await snapshot(page, "en");
  note("placed", JSON.stringify({ editCopy: placed.editCopy, scrollY: placed.scrollY }));
  const opening = await openReplacement(page, "en", "keyboard");
  const branch = expectOpening("row already showing", "en", opening);
  expect(branch, "the synthetic arrangement reached the oversized branch").toBe(
    "oversized, row shows",
  );
  await cancelKeepsDraft(page, "en", "escape");
});

// ---------------------------------------------------------------------------
// The confirmed replacement after a revealed opening: D-06's ordinary
// success path, unchanged.

test("(de, 200%) Replace and edit after the reveal opens Plan with the copy", async ({
  page,
  context,
}) => {
  const { routeId } = await openPreRide(page, context, "de", "200%");
  const opening = await openReplacement(page, "de");
  expectOpening("opening", "de", opening);
  await pointerClick(
    page,
    confirmation(page, "de").getByRole("button", {
      name: COPY.de.confirmLabel,
      exact: true,
    }),
  );
  await expect(
    page.getByRole("navigation").getByRole("button", { name: COPY.de.plan, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect
    .poll(() => readPlanningDraftRow(page), { timeout: 10_000 })
    .toMatchObject({ editCopySourceRouteId: routeId, routeName: ROUTE_NAME });
});

// ---------------------------------------------------------------------------
// The paused route screen: in session after Pause, and after a cold start
// (item 132). The paused panel adds its resume prompt and End ride row, so
// its geometry differs from the pre-ride screen's.

test("(en, 200%) the paused screen after Pause: the opening follows the rule", async ({
  page,
  context,
}) => {
  const pageErrors = await prepare(page, context);
  await page.goto("/");
  await routeFileImport(page);
  await page.getByRole("button", { name: ROUTE_NAME, exact: true }).click();
  await startRidingWithFix(page, context, "en");
  await pointerClick(
    page,
    page.getByRole("button", { name: COPY.en.pause, exact: true }),
  );
  await expect(page.getByRole("button", { name: COPY.en.resumeRide })).toBeVisible();
  await writeRow(page, "planningDrafts", OLD_DRAFT);
  await setRootText(page, "200%");
  const opening = await openReplacement(page, "en");
  note("branch", expectOpening("paused opening", "en", opening));
  await cancelKeepsDraft(page, "en", "pointer");
  expect(pageErrors).toEqual([]);
});

test("(de, 200%) the cold-start paused screen: the opening follows the rule", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const pageErrors = await prepare(page, context);
  await page.goto("/");
  await routeFileImport(page);
  await page.getByRole("button", { name: ROUTE_NAME, exact: true }).click();
  await startRidingWithFix(page, context, "en");
  await writeRow(page, "planningDrafts", OLD_DRAFT);
  await seedLanguagePreference(page, "de");
  // A real reload: the browser's stand-in for fully closing and reopening
  // the installed PWA, not device evidence.
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: COPY.de.routes }),
  ).toBeVisible();
  await page.getByRole("button", { name: COPY.de.ride, exact: true }).click();
  await expect(page.getByRole("button", { name: COPY.de.resumeRide })).toBeVisible();
  await expect(editCopyButton(page, "de")).toBeEnabled();
  await setRootText(page, "200%");
  const opening = await openReplacement(page, "de");
  note("branch", expectOpening("cold-start paused opening", "de", opening));
  await cancelKeepsDraft(page, "de", "pointer");
  expect(pageErrors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Backlog item 124, decision 4 of 3 October 2026: an unconfirmed confirmation
// closes quietly when Start riding succeeds and does not reappear on Pause.
// Each transition is judged against the same transition from the same
// starting state and position with nothing open: the route's pre-ride screen
// at its top, reached again for the control by ending the ride and reopening
// the route from Routes.

const pauseButton = (page: Page, language: Language): Locator =>
  page.getByRole("button", { name: COPY[language].pause, exact: true });
const resumeButton = (page: Page, language: Language): Locator =>
  page.getByRole("button", { name: COPY[language].resumeRide, exact: true });

/** Settled on the paused screen, under the returned navigation. */
async function pausedSettled(page: Page, language: Language): Promise<void> {
  await expect(resumeButton(page, language)).toBeVisible();
  await expect(page.locator("header.app-header--sticky")).toBeAttached();
  await settle(page);
}

/** Settled in the riding shell, the navigation gone. */
async function ridingSettled(page: Page, language: Language): Promise<void> {
  await expect(pauseButton(page, language)).toBeEnabled();
  await expect(page.locator("header.app-header--sticky")).toHaveCount(0);
  await settle(page);
}

/** Start riding, judged once the ride holds a fix 400 m along the route. */
const startTransition = (
  page: Page,
  context: BrowserContext,
  language: Language,
): Promise<Transition> =>
  measureTransition(
    page,
    () => startRidingWithFix(page, context, language),
    () => ridingSettled(page, language),
  );

const pauseTransition = (page: Page, language: Language): Promise<Transition> =>
  measureTransition(
    page,
    () => pointerClick(page, pauseButton(page, language)),
    () => pausedSettled(page, language),
  );

/** Ends the paused ride and opens the route's pre-ride screen again from
 * Routes, at its top. */
async function endAndReopenPreRide(page: Page, language: Language): Promise<void> {
  await pointerClick(page, page.locator(".ride-end-ride-panel-row > button"));
  const end = page.getByRole("dialog", { name: COPY[language].endTitle });
  await pointerClick(
    page,
    end.getByRole("button", { name: COPY[language].endRide, exact: true }),
  );
  await expect(end).toHaveCount(0);
  await expect.poll(() => readActiveRideStateRow(page)).toBeNull();
  await page.getByRole("button", { name: COPY[language].routes, exact: true }).click();
  await page.getByRole("button", { name: ROUTE_NAME, exact: true }).click();
  await expect(editCopyButton(page, language)).toBeEnabled();
  await expect(
    page.getByRole("button", { name: COPY[language].startRiding }),
  ).toBeVisible();
  await settle(page);
}

const editCopyTexts = (language: Language): string[] => [
  COPY[language].cancel,
  COPY[language].editCopy,
];

for (const language of LANGUAGES) {
  test(`(${language}, 100%) the confirmation closes quietly when Start riding succeeds and does not reappear on Pause, each as with nothing open; Edit copy opens it again as before`, async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const { pageErrors } = await openPreRide(page, context, language, "100%");
    await openReplacement(page, language);
    const affectedStart = await startTransition(page, context, language);
    const affectedPause = await pauseTransition(page, language);

    await pointerClick(page, resumeButton(page, language));
    await ridingSettled(page, language);
    await pointerClick(page, pauseButton(page, language));
    await pausedSettled(page, language);
    await expect(
      page.getByRole("dialog"),
      "[behaviour] still closed after Resume ride and Pause",
    ).toHaveCount(0);

    // Opened deliberately again, it follows the rule, and Cancel keeps the
    // draft.
    const opening = await openReplacement(page, language);
    note("reopened", expectOpening("reopened", language, opening));
    await cancelKeepsDraft(page, language, "pointer");

    // The control: the same pre-ride screen, nothing open.
    await endAndReopenPreRide(page, language);
    const controlStart = await startTransition(page, context, language);
    const controlPause = await pauseTransition(page, language);

    expectQuietTransition(
      "Start riding",
      controlStart,
      affectedStart,
      COPY[language].confirmTitle,
      editCopyTexts(language),
    );
    expectQuietTransition(
      "the Pause after it",
      controlPause,
      affectedPause,
      null,
      editCopyTexts(language),
    );
    expect(pageErrors).toEqual([]);
  });
}
