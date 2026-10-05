import { expect, test, type Locator, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import {
  EDIT_COPY_NOTICE,
  editCopyAnnouncement,
  editCopyIndicator,
  expectEditCopyNotice,
  expectNoEditCopyNotice,
  type EditCopyLanguage,
  type EditCopyVariant,
} from "./support/editCopyNotice.ts";

// Backlog item 141 — Planning's compact Edit copy notice — in both engines
// (this file runs under the "chromium" and "webkit-smoke" projects), at
// 390x844 portrait unless stated, from edit-copy draft rows seeded directly
// in IndexedDB. Seeding is what reaches the legacy reversed variants, which
// no current interface path can create; the real Edit copy → Planning
// arrival is covered by editRouteAsPlanningCopy.spec.ts and
// editCopyBusyState.smoke.spec.ts.
//
// The cases are split by purpose rather than run as a full cross-product:
// - wording and wrapping: every variant in English and German, at ordinary
//   and 200% root text, closed and open, plus one 320 px case;
// - interaction: pointer, Enter and Space on representative cases, from
//   the top and from a slightly scrolled start;
// - the announcement: present and empty before its message, then the same
//   node, untouched by toggling and an ordinary edit;
// - persistence: toggling writes nothing, and the panel is closed again
//   after leaving Planning and after a reload;
// - the two layout risks the change creates: synthetic safe-area insets,
//   and the heading wrapper every ordinary draft now renders.
//
// Limits: the root font size is browser text scaling, not iOS Larger Text;
// the 47/34 insets are assumed iPhone values, not read from the installed
// PWA; and a screen reader's behaviour — what VoiceOver announces, and
// whether it reads the full text twice while the panel is open — is not
// observable here.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const DB_NAME = "amazing-cycling-navigation";
const DRAFT_NAME = "Edit copy notice";
const LANGUAGES = ["en", "de"] as const;
const TEXT_SIZES = ["ordinary", "200%"] as const;
type TextSize = (typeof TEXT_SIZES)[number];
const VARIANTS: readonly EditCopyVariant[] = [
  "exact",
  "estimated",
  "reversedExact",
  "reversedEstimated",
];

/** The stored provenance each variant is seeded with. */
const PROVENANCE: Record<
  EditCopyVariant,
  { origin: "exact" | "derived"; operation: "forward" | "reverse" }
> = {
  exact: { origin: "exact", operation: "forward" },
  estimated: { origin: "derived", operation: "forward" },
  reversedExact: { origin: "exact", operation: "reverse" },
  reversedEstimated: { origin: "derived", operation: "reverse" },
};

const COPY = {
  en: { plan: "Plan", routes: "Routes", routeName: "Route name" },
  de: { plan: "Planen", routes: "Routen", routeName: "Routenname" },
} as const;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** One announcement region as the in-page tracker saw it. */
interface RegionRecord {
  firstSeenText: string | null;
  filledAfterSeen: boolean;
  mutationsAfterFill: number;
  connected: boolean;
  current: boolean;
  text: string | null;
}

interface NoticeFixture {
  puts: number;
  regions: {
    node: Element;
    firstSeenText: string | null;
    filledAfterSeen: boolean;
    mutationsAfterFill: number;
  }[];
}
type FixtureWindow = Window & { __acnNotice: NoticeFixture };

/** Installed before any of the app's scripts run: counts the app's
 * planningDrafts writes, and tracks every announcement region from the
 * moment it is inserted — whether it held text then, whether text arrived
 * later, and every mutation after that. */
async function installFixtures(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fixture: NoticeFixture = { puts: 0, regions: [] };
    (window as unknown as FixtureWindow).__acnNotice = fixture;

    // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: the original is re-invoked with its own receiver.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "planningDrafts") fixture.puts += 1;
      return put.apply(this, args);
    };

    const SELECTOR = ".planning-heading [role='status'][aria-atomic='true']";
    const track = (node: Element) => {
      const record = {
        node,
        firstSeenText: node.textContent,
        filledAfterSeen: false,
        mutationsAfterFill: 0,
      };
      fixture.regions.push(record);
      new MutationObserver((list) => {
        if (record.filledAfterSeen) {
          record.mutationsAfterFill += list.length;
        } else if (node.textContent !== "") {
          record.filledAfterSeen = true;
        }
      }).observe(node, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    };
    new MutationObserver(() => {
      for (const node of document.querySelectorAll(SELECTOR)) {
        if (!fixture.regions.some((record) => record.node === node)) track(node);
      }
    }).observe(document, { subtree: true, childList: true });
  });
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

/** A three-waypoint draft; an edit copy of the given variant, or an
 * ordinary draft when the variant is null. */
function draftRow(variant: EditCopyVariant | null): object {
  return {
    id: "draft",
    waypoints: [
      { id: "wp-a", coordinate: [-0.1, 51.5] },
      { id: "wp-b", coordinate: [-0.09, 51.51] },
      { id: "wp-c", coordinate: [-0.08, 51.5] },
    ],
    routeName: DRAFT_NAME,
    avoidFerries: true,
    profile: "cycling-road",
    updatedAt: "2026-10-05T08:00:00.000Z",
    ...(variant === null
      ? {}
      : {
          editCopySourceRouteId: "route-notice",
          editCopyWaypointsOrigin: PROVENANCE[variant].origin,
          editCopyOperation: PROVENANCE[variant].operation,
        }),
  };
}

const puts = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as FixtureWindow).__acnNotice.puts);

const navButton = (page: Page, label: string): Locator =>
  page.getByRole("navigation").getByRole("button", { name: label, exact: true });

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

/** Waits until the app has made no draft write for a little over the
 * autosave debounce. */
async function waitForQuietDrafts(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await puts(page);
        await page.waitForTimeout(1_200);
        return (await puts(page)) - before;
      },
      { timeout: 15_000 },
    )
    .toBe(0);
}

/** Loads the app once, with the fixtures and, for German, the stored
 * language preference. */
async function prepare(page: Page, language: EditCopyLanguage): Promise<void> {
  await installLocalMapStyle(page);
  await installFixtures(page);
  await page.goto("/");
  await expect(navButton(page, COPY.en.plan)).toBeVisible();
  if (language !== "en") await writeRow(page, "appPreferences", { id: "app", language });
}

/** Stores the draft, reloads, opens Planning, waits for the draft to be
 * restored and its first autosave to land, and applies the root text size
 * (read back). */
async function openPlanning(
  page: Page,
  language: EditCopyLanguage,
  variant: EditCopyVariant | null,
  textSize: TextSize,
): Promise<void> {
  await writeRow(page, "planningDrafts", draftRow(variant));
  await page.reload();
  await navButton(page, COPY[language].plan).click();
  await expect(page.getByLabel(COPY[language].routeName, { exact: true })).toHaveValue(
    DRAFT_NAME,
  );
  await expect.poll(() => puts(page), { timeout: 10_000 }).toBeGreaterThan(0);
  if (textSize === "200%") {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
    ).toBe("32px");
  }
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await settle(page);
}

/** A real mouse click at the element's centre, after proving that point is
 * inside the viewport and hits the element itself — never through
 * Playwright's own scroll-into-view. */
async function pointerClick(page: Page, locator: Locator): Promise<void> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("pointerClick: element is not laid out");
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  const viewport = page.viewportSize();
  expect(y, "the click point is inside the viewport").toBeGreaterThan(0);
  expect(y, "the click point is inside the viewport").toBeLessThan(viewport?.height ?? 0);
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

/** The panel the indicator names while open. */
async function openPanel(page: Page, indicator: Locator): Promise<Locator> {
  const id = await indicator.getAttribute("aria-controls");
  expect(id, "an open indicator names its panel").toBeTruthy();
  return page.locator(`[id="${id ?? ""}"]`);
}

/** Asserts the open state: the panel visible with the full text, not a live
 * region, the qualifier hidden, and the full text in the announcement too. */
async function expectOpen(
  page: Page,
  indicator: Locator,
  variant: EditCopyVariant,
  language: EditCopyLanguage,
): Promise<void> {
  const { full } = EDIT_COPY_NOTICE[language][variant];
  await expect(indicator).toHaveAttribute("aria-expanded", "true");
  const panel = await openPanel(page, indicator);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveText(full);
  await expect(panel).not.toHaveAttribute("role");
  await expect(panel).not.toHaveAttribute("aria-live");
  await expect(page.locator(".planning-copy-qualifier")).toHaveCount(0);
  await expect(editCopyAnnouncement(page)).toHaveText(full);
}

/** Measures the notice against the screen's content box: nothing overflows
 * the page, the indicator, qualifier and panel sit inside the content box,
 * their text is not clipped by its own box, the indicator keeps its 44 px
 * and never overlaps the heading, and the announcement stays a 1x1 clip. */
async function expectContained(page: Page, what: string): Promise<void> {
  const m = await page.evaluate(() => {
    const box = (element: Element | null): Box | null => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const textBox = (element: Element | null): Box | null => {
      if (!element) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      if (rects.length === 0) return null;
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return { left, right, top, bottom, width: right - left, height: bottom - top };
    };
    const section = document.querySelector(".planning-screen");
    if (!section) throw new Error("no Planning screen");
    const style = getComputedStyle(section);
    const sectionBox = section.getBoundingClientRect();
    const indicator = document.querySelector(".planning-copy-toggle");
    const controls = indicator?.getAttribute("aria-controls") ?? null;
    const panel = controls === null ? null : document.getElementById(controls);
    const qualifier = document.querySelector(".planning-copy-qualifier");
    return {
      overflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      content: {
        left: sectionBox.left + parseFloat(style.paddingLeft),
        right: sectionBox.right - parseFloat(style.paddingRight),
      },
      h1: box(document.querySelector(".planning-title-row h1")),
      indicator: box(indicator),
      indicatorInHeading: indicator?.closest("h1") != null,
      label: textBox(document.querySelector(".planning-copy-toggle-label")),
      qualifier: box(qualifier),
      qualifierText: textBox(qualifier),
      panel: box(panel),
      panelText: textBox(panel),
      announcement: box(document.querySelector(".planning-heading [role='status']")),
    };
  });
  const inside = (
    inner: Box | null,
    outer: { left: number; right: number },
    name: string,
  ) => {
    if (inner === null) return;
    expect(inner.left, `${what}: ${name} starts inside`).toBeGreaterThanOrEqual(
      outer.left - 0.5,
    );
    expect(inner.right, `${what}: ${name} ends inside`).toBeLessThanOrEqual(
      outer.right + 0.5,
    );
  };
  const within = (inner: Box | null, outer: Box | null, name: string) => {
    if (inner === null || outer === null) return;
    inside(inner, outer, name);
    expect(inner.top, `${what}: ${name} top inside`).toBeGreaterThanOrEqual(
      outer.top - 0.5,
    );
    expect(inner.bottom, `${what}: ${name} bottom inside`).toBeLessThanOrEqual(
      outer.bottom + 0.5,
    );
  };

  expect(m.overflow, `${what}: no horizontal page overflow`).toBeLessThanOrEqual(0);
  expect(m.indicator, `${what}: the indicator is laid out`).not.toBeNull();
  expect(m.indicatorInHeading, `${what}: the indicator is outside the h1`).toBe(false);
  expect(m.indicator?.height ?? 0, `${what}: 44 px touch target`).toBeGreaterThanOrEqual(
    44,
  );
  inside(m.h1, m.content, "the heading");
  inside(m.indicator, m.content, "the indicator");
  within(m.label, m.indicator, "the indicator's label");
  inside(m.qualifier, m.content, "the qualifier");
  within(m.qualifierText, m.qualifier, "the qualifier's text");
  inside(m.panel, m.content, "the panel");
  within(m.panelText, m.panel, "the panel's text");
  if (m.h1 !== null && m.indicator !== null) {
    const overlapX =
      Math.min(m.h1.right, m.indicator.right) - Math.max(m.h1.left, m.indicator.left);
    const overlapY =
      Math.min(m.h1.bottom, m.indicator.bottom) - Math.max(m.h1.top, m.indicator.top);
    expect(
      overlapX > 0.5 && overlapY > 0.5,
      `${what}: the heading and the indicator do not overlap`,
    ).toBe(false);
  }
  expect(
    m.announcement?.width ?? 0,
    `${what}: the announcement is clipped`,
  ).toBeLessThanOrEqual(1);
  expect(
    m.announcement?.height ?? 0,
    `${what}: the announcement is clipped`,
  ).toBeLessThanOrEqual(1);
}

async function readRegions(page: Page): Promise<RegionRecord[]> {
  return page.evaluate(() => {
    const current = document.querySelector(
      ".planning-heading [role='status'][aria-atomic='true']",
    );
    return (window as unknown as FixtureWindow).__acnNotice.regions.map((record) => ({
      firstSeenText: record.firstSeenText,
      filledAfterSeen: record.filledAfterSeen,
      mutationsAfterFill: record.mutationsAfterFill,
      connected: record.node.isConnected,
      current: record.node === current,
      text: record.node.textContent,
    }));
  });
}

/** What the pointer and keyboard checks compare across a toggle. */
async function snapshot(
  page: Page,
): Promise<{ scrollY: number; top: number; focus: string }> {
  return page.evaluate(() => {
    const indicator = document.querySelector(".planning-copy-toggle");
    if (!indicator) throw new Error("no indicator");
    const active = document.activeElement;
    return {
      scrollY: window.scrollY,
      top: indicator.getBoundingClientRect().top,
      focus:
        active === indicator
          ? "indicator"
          : `${active?.tagName ?? "none"}.${active?.className ?? ""}`,
    };
  });
}

for (const language of LANGUAGES) {
  for (const textSize of TEXT_SIZES) {
    test(`wording and wrapping (${language}, ${textSize} text): every variant's label, qualifier and announcement, closed and open, contained and unclipped`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      await prepare(page, language);
      for (const variant of VARIANTS) {
        await openPlanning(page, language, variant, textSize);
        const indicator = await expectEditCopyNotice(page, variant, language);
        await expectContained(page, `${variant}, closed`);

        // Opened by script: this check is about layout, not input.
        await indicator.evaluate((element) => {
          (element as HTMLElement).click();
        });
        await expectOpen(page, indicator, variant, language);
        await expectContained(page, `${variant}, open`);
      }
    });
  }
}

test("wording and wrapping at 320x568: the German reversed label and caution at 200% text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await prepare(page, "de");
  await openPlanning(page, "de", "reversedEstimated", "200%");
  const indicator = await expectEditCopyNotice(page, "reversedEstimated", "de");
  await expectContained(page, "320 px, closed");
  await indicator.evaluate((element) => {
    (element as HTMLElement).click();
  });
  await expectOpen(page, indicator, "reversedEstimated", "de");
  await expectContained(page, "320 px, open");
});

const INTERACTION_CASES = [
  { language: "en", textSize: "ordinary" },
  { language: "de", textSize: "200%" },
] as const;

for (const { language, textSize } of INTERACTION_CASES) {
  test(`interaction (${language}, ${textSize} text): pointer, Enter and Space open and close the explanation without moving the page or the indicator`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await prepare(page, language);
    await openPlanning(page, language, "estimated", textSize);
    const indicator = await expectEditCopyNotice(page, "estimated", language);

    for (const start of ["top", "scrolled"] as const) {
      if (start === "scrolled") {
        const by = await page.evaluate(() => {
          const header = document.querySelector("header.app-header--sticky");
          const toggle = document.querySelector(".planning-copy-toggle");
          if (!header || !toggle) throw new Error("no header or indicator");
          const room =
            toggle.getBoundingClientRect().top -
            header.getBoundingClientRect().bottom -
            2;
          const amount = Math.min(12, Math.floor(room));
          window.scrollTo(0, amount);
          return amount;
        });
        expect(by, "a scrolled start that keeps the indicator in view").toBeGreaterThan(
          0,
        );
        await settle(page);
        expect(await page.evaluate(() => window.scrollY)).toBe(by);
      }

      // Pointer: open, then close. Linux WebKit focuses a clicked button and
      // iOS Safari does not, so focus must be on the indicator or unchanged —
      // never anywhere else.
      for (const expanded of [true, false]) {
        const before = await snapshot(page);
        await pointerClick(page, indicator);
        await expect(indicator).toHaveAttribute("aria-expanded", String(expanded));
        await settle(page, 200);
        const after = await snapshot(page);
        expect(after.scrollY, `${start}: pointer leaves the page still`).toBe(
          before.scrollY,
        );
        expect(
          Math.abs(after.top - before.top),
          `${start}: the indicator stays put`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          after.focus === "indicator" || after.focus === before.focus,
          `${start}: focus is on the indicator or unchanged (${before.focus} → ${after.focus})`,
        ).toBe(true);
        if (expanded) await expectOpen(page, indicator, "estimated", language);
        else await expectEditCopyNotice(page, "estimated", language);
      }

      // Keyboard: Enter and Space each open and close; focus stays on the
      // indicator, and Space never scrolls the page.
      await indicator.evaluate((element) => {
        (element as HTMLElement).focus({ preventScroll: true });
      });
      await expect(indicator).toBeFocused();
      for (const [key, expanded] of [
        ["Enter", true],
        ["Enter", false],
        ["Space", true],
        ["Space", false],
      ] as const) {
        const before = await snapshot(page);
        await page.keyboard.press(key);
        await expect(indicator).toHaveAttribute("aria-expanded", String(expanded));
        await settle(page, 200);
        const after = await snapshot(page);
        expect(after.scrollY, `${start}: ${key} leaves the page still`).toBe(
          before.scrollY,
        );
        expect(
          Math.abs(after.top - before.top),
          `${start}: the indicator stays put`,
        ).toBeLessThanOrEqual(0.5);
        await expect(indicator).toBeFocused();
        if (expanded) await expectOpen(page, indicator, "estimated", language);
        else await expectEditCopyNotice(page, "estimated", language);
      }
    }
  });
}

test("the announcement exists, empty, before its message; toggling and Reverse route leave the same node and its text untouched", async ({
  page,
}) => {
  await prepare(page, "en");
  await openPlanning(page, "en", "exact", "ordinary");
  const indicator = await expectEditCopyNotice(page, "exact", "en");
  const { full } = EDIT_COPY_NOTICE.en.exact;

  expect(await readRegions(page)).toEqual([
    {
      firstSeenText: "",
      filledAfterSeen: true,
      mutationsAfterFill: 0,
      connected: true,
      current: true,
      text: full,
    },
  ]);

  for (let i = 0; i < 4; i += 1) await pointerClick(page, indicator);
  await indicator.evaluate((element) => {
    (element as HTMLElement).focus({ preventScroll: true });
  });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect(indicator).toHaveAttribute("aria-expanded", "false");

  const writesBefore = await puts(page);
  await page.getByRole("button", { name: "Reverse route", exact: true }).click();
  await expect.poll(() => puts(page), { timeout: 10_000 }).toBeGreaterThan(writesBefore);
  await settle(page);

  // Reverse route narrates nothing: the forward notice stays as it was.
  await expectEditCopyNotice(page, "exact", "en");
  expect(await readRegions(page)).toEqual([
    {
      firstSeenText: "",
      filledAfterSeen: true,
      mutationsAfterFill: 0,
      connected: true,
      current: true,
      text: full,
    },
  ]);
});

test("opening and closing the explanation writes no draft, and it is closed again after leaving Planning and after a reload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await prepare(page, "en");
  await openPlanning(page, "en", "estimated", "ordinary");
  let indicator = await expectEditCopyNotice(page, "estimated", "en");
  await waitForQuietDrafts(page);

  const writesBefore = await puts(page);
  await pointerClick(page, indicator);
  await page.waitForTimeout(1_000);
  await pointerClick(page, indicator);
  await pointerClick(page, indicator);
  await page.waitForTimeout(1_000);
  expect(await puts(page), "toggling never writes the draft").toBe(writesBefore);
  await expectOpen(page, indicator, "estimated", "en");

  await navButton(page, COPY.en.routes).click();
  await expect(editCopyIndicator(page, "estimated")).toHaveCount(0);
  await navButton(page, COPY.en.plan).click();
  indicator = await expectEditCopyNotice(page, "estimated", "en");

  await pointerClick(page, indicator);
  await expectOpen(page, indicator, "estimated", "en");
  await page.reload();
  await navButton(page, COPY.en.plan).click();
  await expect(page.getByLabel(COPY.en.routeName, { exact: true })).toHaveValue(
    DRAFT_NAME,
  );
  await expectEditCopyNotice(page, "estimated", "en");
});

test("with synthetic 47/34 safe-area insets, the indicator and qualifier sit below the sticky navigation and above the bottom inset", async ({
  page,
}) => {
  await prepare(page, "de");
  await openPlanning(page, "de", "estimated", "ordinary");
  const insets = await page.evaluate(() => {
    const style = document.documentElement.style;
    style.setProperty("--safe-area-inset-top", "47px");
    style.setProperty("--safe-area-inset-bottom", "34px");
    const computed = getComputedStyle(document.documentElement);
    return [
      computed.getPropertyValue("--safe-area-inset-top").trim(),
      computed.getPropertyValue("--safe-area-inset-bottom").trim(),
    ];
  });
  expect(insets).toEqual(["47px", "34px"]);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await settle(page);

  const indicator = await expectEditCopyNotice(page, "estimated", "de");
  const m = await page.evaluate(() => {
    const header = document.querySelector("header.app-header--sticky");
    const toggle = document.querySelector(".planning-copy-toggle");
    const qualifier = document.querySelector(".planning-copy-qualifier");
    if (!header || !toggle || !qualifier) throw new Error("missing element");
    return {
      headerBottom: header.getBoundingClientRect().bottom,
      indicatorTop: toggle.getBoundingClientRect().top,
      qualifierBottom: qualifier.getBoundingClientRect().bottom,
      innerHeight,
    };
  });
  expect(
    m.headerBottom,
    "the top inset reaches the sticky navigation",
  ).toBeGreaterThanOrEqual(47);
  expect(m.indicatorTop).toBeGreaterThanOrEqual(m.headerBottom);
  expect(m.qualifierBottom).toBeLessThanOrEqual(m.innerHeight - 34 - 8);
  await expectContained(page, "insets, closed");

  await pointerClick(page, indicator);
  await expectOpen(page, indicator, "estimated", "de");
  await expectContained(page, "insets, open");
});

test("an ordinary draft's heading block is exactly its h1, followed by the screen's usual 16 px gap", async ({
  page,
}) => {
  await prepare(page, "en");
  await openPlanning(page, "en", null, "ordinary");
  await expectNoEditCopyNotice(page);
  await expect(editCopyAnnouncement(page)).toHaveCount(1);
  await expect(editCopyAnnouncement(page)).toHaveText("");

  const m = await page.evaluate(() => {
    const heading = document.querySelector(".planning-heading");
    const row = document.querySelector(".planning-title-row");
    const h1 = document.querySelector(".planning-title-row h1");
    const next = heading?.nextElementSibling ?? null;
    if (!heading || !row || !h1 || !next) throw new Error("missing element");
    return {
      heading: heading.getBoundingClientRect().toJSON() as Box,
      row: row.getBoundingClientRect().toJSON() as Box,
      h1: h1.getBoundingClientRect().toJSON() as Box,
      nextTop: next.getBoundingClientRect().top,
    };
  });
  expect(Math.abs(m.heading.height - m.h1.height)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(m.row.height - m.h1.height)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(m.heading.top - m.h1.top)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(m.nextTop - m.heading.bottom - 16)).toBeLessThanOrEqual(0.5);
});
