// Item 128 — Planning's imagery banner and the placement crosshair: the
// measurement probe behind README.md.
//
// Design-stage tooling only: nothing here is imported by the app, linted or
// type-checked, and it changes no application code. Candidate corrections
// are disposable browser overrides applied to the unchanged production
// build (CSSOM rules inserted into the app's own stylesheet, and for C1/C3
// a move of the real overlay node), each read back and restored.
//
// Run it inside the Playwright container the E2E workflow pins, by digest,
// against a fresh `npm run build` of the tested commit:
//
//   IMG=mcr.microsoft.com/playwright@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48
//   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp --ipc=host \
//     --network host -v "$PWD":/work -v /tmp/item128:/scratch -w /work "$IMG" \
//     bash -c 'npx vite preview --port 4273 --strictPort >/tmp/preview.log 2>&1 &
//       node docs/design/planning-imagery-banner/capture.mjs /scratch <stage>'
//
// Stages, in the order they were run: baseline, candidates, cooccurrence,
// wider, textsize, transitions, sequence, sheets. Each writes
// <scratch>/results/<stage>.json and screenshots under <scratch>/shots/;
// `sheets` composes the labelled review images into ./images/.
//
// Re-run on a later build (item 128's implemented C6 in 0.4.50): use a
// separate scratch directory and ITEM128_CANDIDATES=C0, where C0 then means
// "no prototype override" — the implementation itself, not the old
// baseline. ITEM128_LABEL replaces the sheets' build caption, and
// ITEM128_SHEETS=implemented composes only images/implemented-<version>.png,
// leaving the design-stage sheets untouched.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const IMAGES = path.join(HERE, "images");
const SCRATCH = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "acn-item128"));
const STAGE = process.argv[3] ?? "baseline";
const ONLY = process.env.ITEM128_ONLY ?? null; // optional case-id substring filter
const BASE_URL =
  process.env.ITEM128_BASE_URL ?? "http://localhost:4273/amazing-cycling-navigation/";
const RESULTS = path.join(SCRATCH, "results");
const SHOTS = path.join(SCRATCH, "shots");
fs.mkdirSync(RESULTS, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const importRepo = (relative) => import(pathToFileURL(path.join(REPO, relative)).href);
const { chromium, webkit } = await importRepo("node_modules/playwright/index.mjs");
// The E2E suite's own fixtures and the app's own catalogues, imported
// directly (Node type stripping) rather than copied.
const {
  forceMapStyleFailure,
  installLocalMapStyle,
  installLocalMapStyleWithTileSource,
  installLocalMapStyleWithFailureControl,
} = await importRepo("e2e/support/localMapStyle.ts");
const { en } = await importRepo("src/i18n/messages.en.ts");
const { de } = await importRepo("src/i18n/messages.de.ts");
const CATALOGUES = { en, de };

const DB_NAME = "amazing-cycling-navigation";
const ORS_URL_GLOB = "https://api.heigit.org/**";
const ENGINES = { chromium, webkit };
const SIZES = {
  "375x667": { width: 375, height: 667 },
  "320x844": { width: 320, height: 844 },
  "390x844": { width: 390, height: 844 },
  "430x932": { width: 430, height: 932 },
  // Informative corners only (never used to downgrade a required result).
  "375x812": { width: 375, height: 812 },
  "320x568": { width: 320, height: 568 },
};
const REQUIRED_SIZES = ["375x667", "320x844", "390x844"];
const CONTROL_SIZES = ["430x932"];
const LANGUAGES = ["en", "de"];
const CANDIDATES = ["C0", "C1a", "C1b", "C2", "C3", "C4", "C5", "C6", "C7"];
const CONCURRENCY = Number(process.env.ITEM128_CONCURRENCY ?? 4);
const SHEET_LABEL =
  process.env.ITEM128_LABEL ??
  "Real screenshots of the unchanged 0.4.49 build; candidates are disposable overrides.";

// Two questionable surface stretches then paved — the same fixture shape as
// e2e/planningWarningRows.spec.ts, duplicated per the repo's per-spec
// convention, so a warning can be selected without a real routing key.
const MOCK_ORS_RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        summary: { distance: 950, duration: 200, ascent: 999, descent: 999 },
        segments: [
          {
            distance: 950,
            duration: 200,
            steps: [
              {
                distance: 950,
                duration: 200,
                type: 0,
                instruction: "Head north",
                way_points: [0, 9],
              },
            ],
          },
        ],
        extras: {
          surface: {
            values: [
              [0, 2, 8],
              [2, 4, 10],
              [4, 9, 1],
            ],
          },
        },
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-0.1, 51.5, 10],
          [-0.099, 51.5005, 12],
          [-0.098, 51.501, 15],
          [-0.097, 51.5015, 20],
          [-0.096, 51.502, 25],
          [-0.095, 51.5025, 22],
          [-0.094, 51.503, 18],
          [-0.093, 51.5035, 14],
          [-0.092, 51.504, 11],
          [-0.091, 51.5045, 9],
        ],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  fn,
  { timeout = 15_000, interval = 100, what = "condition" } = {},
) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what} (last: ${String(last)})`);
    }
    await sleep(interval);
  }
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Signed separation of two boxes: > 0 is the clear distance along the
 * best axis, <= 0 means they overlap (its magnitude is the smaller
 * penetration depth). */
function separation(a, b) {
  if (!a || !b) return null;
  return round(Math.max(a.y - b.b, b.y - a.b, a.x - b.r, b.x - a.r));
}

const round = (value) => (value === null ? null : Math.round(value * 100) / 100);

function writeResults(stage, data) {
  fs.writeFileSync(path.join(RESULTS, `${stage}.json`), JSON.stringify(data, null, 2));
}

function readResults(stage) {
  const file = path.join(RESULTS, `${stage}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

// ---------------------------------------------------------------------------
// Opening Planning in one imagery state (state-aware settling)
// ---------------------------------------------------------------------------

async function seedPreferences(page, language, withKey) {
  await page.evaluate(
    async ({ dbName, language, withKey }) => {
      await new Promise((resolve, reject) => {
        // Dexie stores schema version N as IndexedDB version N*10.
        const request = indexedDB.open(dbName, 50);
        request.onsuccess = () => {
          const db = request.result;
          const stores = withKey
            ? ["appPreferences", "providerKeys"]
            : ["appPreferences"];
          const tx = db.transaction(stores, "readwrite");
          tx.objectStore("appPreferences").put({ id: "app", language });
          if (withKey) {
            tx.objectStore("providerKeys").put({
              id: "openrouteservice",
              apiKey: "dummy-e2e-key",
              savedAt: new Date().toISOString(),
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(new Error(String(tx.error)));
        };
        request.onerror = () => reject(new Error(String(request.error)));
      });
    },
    { dbName: DB_NAME, language, withKey },
  );
}

async function setRootFont(page, fontSize) {
  await page.evaluate((value) => {
    document.documentElement.style.fontSize = value;
  }, fontSize);
  await nextFrames(page);
}

async function nextFrames(page, count = 2) {
  await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        const step = (n) =>
          n <= 0 ? resolve() : requestAnimationFrame(() => step(n - 1));
        step(count);
      }),
    count,
  );
}

async function readRootFontPx(page) {
  return page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
}

const mapContainer = (page) => page.getByTestId("map-container");

/**
 * Opens Planning with the given imagery state and waits for that state's
 * own settling condition — never a blanket data-map-ready="true", which
 * the loading and delayed states deliberately keep false.
 */
async function openPlanning(browser, spec) {
  const { size, language, state, rootFontSize = null, withRoute = false } = spec;
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: SIZES[size],
    deviceScaleFactor: 2,
    serviceWorkers: "block",
    geolocation: { latitude: 51.5, longitude: -0.1 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  let controller = null;
  if (state === "fallback") {
    await forceMapStyleFailure(page);
  } else if (state === "fallback-recoverable") {
    controller = await installLocalMapStyleWithFailureControl(page);
    controller.failStyle();
  } else if (state === "tile-error" || state === "delayed" || state === "sequence") {
    controller = await installLocalMapStyleWithTileSource(page);
    if (state === "delayed") controller.holdTiles();
  } else if (state === "loading") {
    await installLocalMapStyle(page, { styleDelayMs: 12_000 });
  } else {
    await installLocalMapStyle(page);
  }
  if (withRoute) {
    await page.route(ORS_URL_GLOB, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(MOCK_ORS_RESPONSE),
      }),
    );
  }
  await page.goto(BASE_URL);
  await page.locator(".main-nav").waitFor({ state: "visible", timeout: 20_000 });
  await seedPreferences(page, language, withRoute);
  await page.reload();
  const plan = CATALOGUES[language]["nav.plan"];
  await page
    .getByRole("button", { name: plan, exact: true })
    .waitFor({ timeout: 20_000 });
  if (rootFontSize) await setRootFont(page, rootFontSize);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.getByRole("button", { name: plan, exact: true }).click();
  const control = page.locator(".planning-crosshair-callout");
  await control.waitFor({ state: "attached", timeout: 20_000 });
  await settleState(page, state, controller);
  return { context, page, controller };
}

async function controlEnabled(page) {
  return page.locator(".planning-crosshair-callout").isEnabled();
}

async function settleState(page, state, controller) {
  const map = mapContainer(page);
  if (state === "loading") {
    await page.getByTestId("map-loading").waitFor({ state: "visible", timeout: 10_000 });
    const ready = await map.getAttribute("data-map-ready");
    if (ready !== "false") throw new Error(`loading: data-map-ready was ${ready}`);
    return;
  }
  if (state === "delayed") {
    await waitFor(() => controller.heldTileRequestCount() > 0, {
      what: "a held tile request",
    });
    await page
      .getByTestId("map-imagery-delayed-banner")
      .waitFor({ state: "visible", timeout: 10_000 });
    const ready = await map.getAttribute("data-map-ready");
    if (ready !== "false") throw new Error(`delayed: data-map-ready was ${ready}`);
    return;
  }
  await waitFor(() => controlEnabled(page), {
    timeout: 20_000,
    what: "placement control",
  });
  await waitFor(async () => (await map.getAttribute("data-map-ready")) === "true", {
    timeout: 25_000,
    what: "data-map-ready",
  });
  if (state === "fallback" || state === "fallback-recoverable") {
    await page
      .getByTestId("map-fallback-banner")
      .waitFor({ state: "visible", timeout: 15_000 });
    return;
  }
  if (state === "tile-error") {
    await triggerTileError(page, controller);
    return;
  }
  // "none" and "sequence" (which drives its own states) stop here.
}

/** Fails tiles, then proves a genuinely new tile request failed (the E2E
 * suite's triggerFreshTileFailure, reduced), using Zoom in as the trigger. */
async function triggerTileError(page, controller) {
  const failedBefore = controller.failedTileRequestCount();
  controller.failTiles();
  const zoomIn = page.locator(".planning-map-zoom-controls button").nth(0);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await zoomIn.click();
    try {
      await waitFor(() => controller.failedTileRequestCount() > failedBefore, {
        timeout: 3_000,
        what: "a failed tile request",
      });
      break;
    } catch {
      // try again
    }
  }
  await page
    .getByTestId("tiles-unavailable-banner")
    .waitFor({ state: "visible", timeout: 15_000 });
}

async function failLocate(page) {
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (_success, error) => {
      error?.({
        code: 1,
        message: "denied",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
    };
  });
  await page.locator(".planning-map-controls button").nth(1).click();
  await waitFor(
    async () => (await page.locator(".planning-map-status-message").count()) === 1,
    { what: "the locate-failed message" },
  );
}

async function succeedLocate(page) {
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (success) => {
      success({
        coords: {
          latitude: 51.5,
          longitude: -0.1,
          accuracy: 20,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      });
    };
  });
  await page.locator(".planning-map-controls button").nth(1).click();
  await waitFor(
    async () => (await page.locator(".planning-map-status-message").count()) === 0,
    { what: "the locate-failed message to clear" },
  );
}

/** Places two waypoints by mouse (item 123: mouse clicks place), calculates
 * against the mocked provider, and selects the first warning. */
async function selectWarning(page, language) {
  const t = CATALOGUES[language];
  const map = mapContainer(page);
  await map.scrollIntoViewIfNeeded();
  // Beside the banner (x 64..w-64), below the clusters, above the control:
  // at the banner's own position its Retry intercepts the click.
  const { width } = await map.boundingBox();
  await map.click({ position: { x: 40, y: 170 } });
  await map.click({ position: { x: width - 40, y: 170 } });
  const calculate = page.getByRole("button", { name: t["planning.calculate"] });
  await waitFor(() => calculate.isEnabled(), { what: "Calculate enabled" });
  await calculate.click();
  const list = page.locator("ul.route-warning-list");
  await list.waitFor({ state: "visible", timeout: 20_000 });
  await list.locator(".route-warning-button").first().click();
  await waitFor(
    async () => (await page.locator(".planning-map-status-message").count()) === 1,
    { what: "the warning-selected message" },
  );
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function placeTwelveWaypoints(page) {
  const control = page.locator(".planning-crosshair-callout");
  for (let index = 0; index < 12; index += 1) {
    await waitFor(() => control.isEnabled(), { what: "control enabled" });
    await control.click();
  }
  await waitFor(async () => (await page.locator(".waypoint-list li").count()) === 12, {
    what: "12 waypoints",
  });
}

async function chooseRelocation(page, mode) {
  const row = page.locator(".waypoint-list li").nth(11);
  if (!((await row.getAttribute("class")) ?? "").includes("is-selected")) {
    await row.locator(".waypoint-row-select").click();
  }
  const button = row
    .locator(".waypoint-row-relocate button")
    .nth(mode === "move" ? 0 : 1);
  await button.click();
  await waitFor(async () => (await button.getAttribute("aria-pressed")) === "true", {
    what: `${mode} armed`,
  });
  await waitFor(() => controlEnabled(page), { what: "control enabled" });
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Layout proxy only: the settled fallback banner's text replaced by the
 * exact load-error string, with the alert modifier. It demonstrates neither
 * the production load-error state nor its recovery. */
async function applyLoadErrorProxy(page, language) {
  const text = CATALOGUES[language]["map.imagery.loadError"];
  return page.evaluate((text) => {
    const message = document.querySelector('[data-testid="map-fallback-banner"]');
    const node = [...message.childNodes].find((n) => n.nodeType === 3);
    const original = node.data;
    node.data = text;
    message.classList.add("map-status-message--alert");
    window.__item128LoadErrorProxy = { node, original, message };
    return getComputedStyle(message).borderLeftWidth;
  }, text);
}

async function restoreLoadErrorProxy(page) {
  await page.evaluate(() => {
    const proxy = window.__item128LoadErrorProxy;
    if (!proxy) return;
    proxy.node.data = proxy.original;
    proxy.message.classList.remove("map-status-message--alert");
    window.__item128LoadErrorProxy = undefined;
  });
}

// ---------------------------------------------------------------------------
// Candidates: disposable CSSOM rules and node moves, read back and restored
// ---------------------------------------------------------------------------

const CANDIDATE_RULES = {
  C0: [],
  // One in-map column at the top: MapView's overlay moves into Planning's.
  // The imagery text stays click-through (the overlay's own
  // pointer-events:none is untouched); Retry keeps its own `auto`; the
  // column box itself is made pass-through so no invisible area blocks the
  // map; Planning's own messages keep today's `auto`.
  C1a: [
    ".planning-map-status-overlay { pointer-events: none; }",
    ".planning-map-status-overlay > .planning-map-status-message { pointer-events: auto; }",
    ".planning-map-status-overlay > .map-status-overlay { position: static; }",
    ".planning-map-status-overlay > .map-status-overlay:empty { display: none; }",
  ],
  C1b: [
    ".planning-map-status-overlay { pointer-events: none; }",
    ".planning-map-status-overlay > .planning-map-status-message { pointer-events: auto; }",
    ".planning-map-status-overlay > .map-status-overlay { position: static; order: 1; }",
    ".planning-map-status-overlay > .map-status-overlay:empty { display: none; }",
  ],
  // CSS only: the imagery overlay takes the top slot while Planning has no
  // message of its own, and keeps 72px otherwise.
  C2: [
    ".planning-map-container:not(:has(.planning-map-status-message)) .map-status-overlay { top: 8px; }",
  ],
  // The imagery message in flow below the map at ordinary text, reusing
  // item 114's `.planning-map-messages` styling (a node move, below).
  C3: [],
  // The ring painted above the banner.
  C4: [".planning-crosshair { z-index: 6; }"],
  // Padding and gap only: type size and the 44x112 Retry target unchanged.
  C5: [
    ".planning-map-container .map-status-message { padding: 2px 4px; }",
    ".planning-map-container .map-status-retry-button { margin-top: 2px; }",
  ],
  // The imagery message stays in the map, at the top; Planning's own
  // messages move below the map (a node move, below).
  C6: [
    ".planning-map-container .map-status-overlay { top: 8px; }",
    ".planning-map-messages > .planning-map-status-overlay { position: static; display: block; }",
  ],
  // Every map message below the map, imagery first: item 114's enlarged
  // message block, at ordinary text (node moves, below).
  C7: [
    ".planning-map-messages > .planning-map-status-overlay { position: static; display: block; }",
  ],
};

async function applyCandidate(page, id) {
  const report = await page.evaluate(
    ({ id, rules }) => {
      const sheet = [...document.styleSheets].find((candidate) => {
        try {
          return candidate.href && candidate.cssRules.length > 0;
        } catch {
          return false;
        }
      });
      if (!sheet) throw new Error("no same-origin stylesheet");
      const inserted = rules.map((rule) => {
        const index = sheet.insertRule(rule, sheet.cssRules.length);
        return sheet.cssRules[index];
      });
      const state = { id, sheet, inserted, moves: [] };
      const overlay = document.querySelector(
        ".planning-map-container .map-status-overlay",
      );
      const column = document.querySelector(".planning-map-status-overlay");
      const move = (node, target, before = null) => {
        state.moves.push({ node, parent: node.parentNode, next: node.nextSibling });
        target.insertBefore(node, before);
      };
      if (id === "C1a" || id === "C1b") {
        if (!overlay || !column) throw new Error(`${id}: overlay or column missing`);
        move(overlay, column, column.firstChild);
      }
      if (id === "C3" || id === "C6" || id === "C7") {
        const map = document.querySelector(".planning-map-container");
        if (!overlay || !column || !map)
          throw new Error(`${id}: overlay, column or map missing`);
        const below = document.createElement("div");
        below.className = "planning-map-below";
        below.dataset.item128Proto = "true";
        const messages = document.createElement("div");
        messages.className = "planning-map-messages";
        below.append(messages);
        map.after(below);
        state.created = below;
        if (id !== "C6") move(overlay, messages);
        if (id !== "C3") move(column, messages);
      }
      window.__item128Candidate = state;
      // Read back: every inserted rule must actually be in force.
      const check = {};
      const probe = (selector, property) => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el)[property] : null;
      };
      check.overlayPosition = probe(".map-status-overlay", "position");
      check.overlayTop = probe(".map-status-overlay", "top");
      check.overlayPointerEvents = probe(".map-status-overlay", "pointerEvents");
      check.columnPointerEvents = probe(".planning-map-status-overlay", "pointerEvents");
      check.retryPointerEvents = probe(".map-status-retry-button", "pointerEvents");
      check.messagePadding = probe(".map-status-message", "padding");
      check.ringZIndex = probe(".planning-crosshair", "zIndex");
      check.overlayOrder = probe(".map-status-overlay", "order");
      check.overlayParent = overlay?.parentElement?.className ?? null;
      check.columnParent = column?.parentElement?.className ?? null;
      return check;
    },
    { id, rules: CANDIDATE_RULES[id] },
  );
  const expectations = {
    C1a: (c) => c.overlayPosition === "static" && c.columnPointerEvents === "none",
    C1b: (c) => c.overlayPosition === "static" && c.overlayOrder === "1",
    C2: (c) => c.overlayTop === "8px" || c.overlayTop === "72px",
    C3: (c) =>
      c.overlayPosition === "static" && c.overlayParent === "planning-map-messages",
    C6: (c) => c.overlayTop === "8px" && c.columnParent === "planning-map-messages",
    C7: (c) =>
      c.overlayParent === "planning-map-messages" &&
      c.columnParent === "planning-map-messages",
    C4: (c) => c.ringZIndex === "6",
    C5: (c) => c.messagePadding === null || c.messagePadding === "2px 4px",
  };
  if (expectations[id] && !expectations[id](report)) {
    throw new Error(`${id} did not take effect: ${JSON.stringify(report)}`);
  }
  await nextFrames(page);
  return report;
}

async function restoreCandidate(page) {
  await page.evaluate(() => {
    const state = window.__item128Candidate;
    if (!state) return;
    for (const rule of state.inserted) {
      const index = [...state.sheet.cssRules].indexOf(rule);
      if (index >= 0) state.sheet.deleteRule(index);
    }
    for (const { node, parent, next } of state.moves.reverse()) {
      if (next && next.parentNode === parent) parent.insertBefore(node, next);
      else parent.append(node);
    }
    state.created?.remove();
    window.__item128Candidate = undefined;
  });
  await nextFrames(page);
}

// ---------------------------------------------------------------------------
// The in-page measurement
// ---------------------------------------------------------------------------

function pageMeasure({ paint }) {
  const q = (selector) => document.querySelector(selector);
  const map = q(".planning-map-container");
  if (!map) throw new Error("no .planning-map-container");
  // Discoverability at the page's own top, before any scrolling: is the
  // whole map in view, and is every message?
  const scrollBefore = scrollY;
  window.scrollTo(0, 0);
  const visibleAtTop = (el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  };
  const arrival = {
    mapFullyInView: visibleAtTop(map),
    messagesInView: [
      ...document.querySelectorAll(".map-status-message, .planning-map-status-message"),
    ].map((el) => visibleAtTop(el)),
    mapTop: map.getBoundingClientRect().top,
  };
  window.scrollTo(0, scrollBefore);
  map.scrollIntoView({ block: "center", inline: "nearest" });
  const mr = map.getBoundingClientRect();
  const relRect = (r) => ({
    x: r.left - mr.left,
    y: r.top - mr.top,
    r: r.right - mr.left,
    b: r.bottom - mr.top,
    w: r.width,
    h: r.height,
  });
  const rel = (el) => (el ? relRect(el.getBoundingClientRect()) : null);
  const describe = (el) => {
    if (!el) return null;
    if (el.dataset?.testid) return el.dataset.testid;
    const cls =
      typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    return cls ? `.${cls}` : el.tagName.toLowerCase();
  };
  const reachesMap = (el) =>
    !!el && (!!el.closest?.(".maplibregl-canvas-container") || el.tagName === "CANVAS");
  const hitAt = (x, y) => document.elementFromPoint(x + mr.left, y + mr.top);
  const textRectsOf = (el) => {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.data.trim());
    if (!node) return { text: el.textContent, rects: [] };
    const range = document.createRange();
    range.selectNodeContents(node);
    return { text: node.data, rects: [...range.getClientRects()].map(relRect) };
  };

  const ringEl = q(".planning-crosshair");
  const controlEl = q(".planning-crosshair-callout");
  const overlayEl = q(".map-status-overlay");
  const columnEl = q(".planning-map-status-overlay");
  const imageryEls = [...document.querySelectorAll(".map-status-message")];
  const planningEls = [...document.querySelectorAll(".planning-map-status-message")];
  const attributionEl = q(".map-attribution");
  const shadow = getComputedStyle(controlEl).boxShadow;
  const shadowNumbers = [...shadow.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) =>
    Number(m[1]),
  );
  const spread = shadowNumbers.length >= 4 ? shadowNumbers[3] : 0;
  const control = rel(controlEl);
  const controlLines = (() => {
    const range = document.createRange();
    range.selectNodeContents(controlEl);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  })();

  const imagery = imageryEls.map((el) => {
    const { text, rects } = textRectsOf(el);
    const retryEl = el.querySelector(".map-status-retry-button");
    const lineHeights = rects.map((r) => r.h);
    return {
      testid: el.dataset.testid ?? null,
      role: el.getAttribute("role"),
      text,
      box: rel(el),
      lines: new Set(rects.map((r) => Math.round(r.y))).size,
      lineHeightPx: lineHeights.length ? Math.max(...lineHeights) : null,
      textRects: rects,
      retry: retryEl
        ? {
            box: rel(retryEl),
            label: retryEl.textContent,
            pointerEvents: getComputedStyle(retryEl).pointerEvents,
          }
        : null,
      pointerEvents: getComputedStyle(el).pointerEvents,
      inMap: map.contains(el),
      inViewport: (() => {
        const r = el.getBoundingClientRect();
        return (
          r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth
        );
      })(),
    };
  });
  const planning = planningEls.map((el) => {
    const { text, rects } = textRectsOf(el);
    return {
      text,
      box: rel(el),
      lines: new Set(rects.map((r) => Math.round(r.y))).size,
      textRects: rects,
      pointerEvents: getComputedStyle(el).pointerEvents,
      inMap: map.contains(el),
      inViewport: (() => {
        const r = el.getBoundingClientRect();
        return (
          r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth
        );
      })(),
    };
  });

  const ring = rel(ringEl);
  const ringCx = (ring.x + ring.r) / 2;
  const ringCy = (ring.y + ring.b) / 2;

  // Pointer pass-through: what a real tap at these points reaches today.
  const hits = {
    ringCentre: describe(hitAt(ringCx, ringCy)),
    ringCentreReachesMap: reachesMap(hitAt(ringCx, ringCy)),
    imageryText: imagery.flatMap((m) =>
      m.textRects.map((r) => {
        const el = hitAt((r.x + r.r) / 2, (r.y + r.b) / 2);
        return { el: describe(el), reachesMap: reachesMap(el) };
      }),
    ),
    planningText: planning.flatMap((m) =>
      m.textRects.map((r) => {
        const el = hitAt((r.x + r.r) / 2, (r.y + r.b) / 2);
        return { el: describe(el), reachesMap: reachesMap(el) };
      }),
    ),
    retry: imagery
      .filter((m) => m.retry)
      .map((m) => {
        const b = m.retry.box;
        const el = hitAt((b.x + b.r) / 2, (b.y + b.b) / 2);
        return { el: describe(el), onRetry: !!el?.closest?.(".map-status-retry-button") };
      }),
    // A hit on the empty part of Planning's column, beside a message, if the
    // column is wider than its content: must reach the map.
    columnGap: null,
  };

  // Paint order over the ring's annulus: temporarily make every candidate
  // painter hit-testable, ask which is topmost, then restore and read back.
  let paintOrder = null;
  if (paint) {
    const targets = [ringEl, overlayEl, columnEl, ...imageryEls, ...planningEls].filter(
      Boolean,
    );
    const before = targets.map((el) => [
      el,
      el.style.pointerEvents,
      getComputedStyle(el).pointerEvents,
    ]);
    targets.forEach((el) => {
      el.style.pointerEvents = "auto";
    });
    const samples = [];
    for (let k = 0; k < 12; k += 1) {
      const angle = (k / 12) * 2 * Math.PI;
      const radius = ring.w / 2 - 1;
      const el = hitAt(
        ringCx + radius * Math.cos(angle),
        ringCy + radius * Math.sin(angle),
      );
      const kind =
        el === ringEl
          ? "ring"
          : el?.closest?.(".map-status-message")
            ? "imagery-message"
            : el?.closest?.(".planning-map-status-message")
              ? "planning-message"
              : describe(el);
      samples.push(kind);
    }
    before.forEach(([el, inline]) => {
      el.style.pointerEvents = inline;
    });
    const restored = before.every(
      ([el, , computed]) => getComputedStyle(el).pointerEvents === computed,
    );
    paintOrder = { samples, restored };
  }

  // Text under the ring (for C4, where the ring paints above the text).
  const ringOverText = imagery
    .flatMap((m) => m.textRects)
    .concat(planning.flatMap((m) => m.textRects))
    .reduce((area, r) => {
      const w = Math.min(r.r, ring.r) - Math.max(r.x, ring.x);
      const h = Math.min(r.b, ring.b) - Math.max(r.y, ring.y);
      return area + (w > 0 && h > 0 ? w * h : 0);
    }, 0);

  const stackingContexts = (el) => {
    const out = [];
    for (
      let node = el.parentElement;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      const s = getComputedStyle(node);
      const reasons = [];
      if (s.position !== "static" && s.zIndex !== "auto")
        reasons.push(`z-index ${s.zIndex}`);
      if (s.opacity !== "1") reasons.push("opacity");
      if (s.transform !== "none") reasons.push("transform");
      if (s.filter !== "none") reasons.push("filter");
      if (s.isolation === "isolate") reasons.push("isolation");
      if (s.contain !== "none" && /layout|paint|strict|content/.test(s.contain))
        reasons.push(`contain ${s.contain}`);
      if (reasons.length) out.push(`${describe(node)} (${reasons.join(", ")})`);
    }
    return out;
  };

  const nodes = [
    map,
    ringEl,
    controlEl,
    overlayEl,
    attributionEl,
    ...imageryEls,
    ...planningEls,
  ];
  return {
    arrival,
    enlarged: map.classList.contains("planning-map-container--enlarged-text"),
    rootFontPx: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    fontFamily: getComputedStyle(document.body).fontFamily,
    usedFont: (() => {
      const probe = imageryEls[0] ?? controlEl;
      return getComputedStyle(probe).fontFamily;
    })(),
    viewport: { w: innerWidth, h: innerHeight },
    mapViewport: { x: mr.left, y: mr.top, w: mr.width, h: mr.height },
    mapPageY: mr.top + scrollY,
    ring,
    control,
    controlFootprint: {
      x: control.x - spread,
      y: control.y - spread,
      r: control.r + spread,
      b: control.b + spread,
      w: control.w + 2 * spread,
      h: control.h + 2 * spread,
    },
    controlLabel: controlEl.textContent,
    controlLines,
    controlDisabled: controlEl.disabled,
    attribution: rel(attributionEl),
    attributionInMap: map.contains(attributionEl),
    zoomCluster: rel(q(".planning-map-zoom-controls")),
    cameraCluster: rel(q(".planning-map-controls")),
    overlay: {
      parent: describe(overlayEl?.parentElement),
      inMap: map.contains(overlayEl),
      top: overlayEl ? getComputedStyle(overlayEl).top : null,
      box: rel(overlayEl),
    },
    column: columnEl
      ? { box: rel(columnEl), pointerEvents: getComputedStyle(columnEl).pointerEvents }
      : null,
    imagery,
    planning,
    hits,
    paintOrder,
    ringOverTextPx2: Math.round(ringOverText * 100) / 100,
    ringOverRetryPx2: imagery
      .filter((m) => m.retry)
      .reduce((area, m) => {
        const r = m.retry.box;
        const w = Math.min(r.r, ring.r) - Math.max(r.x, ring.x);
        const h = Math.min(r.b, ring.b) - Math.max(r.y, ring.y);
        return area + (w > 0 && h > 0 ? w * h : 0);
      }, 0),
    stacking: {
      ring: ringEl ? stackingContexts(ringEl) : [],
      imagery: imageryEls[0] ? stackingContexts(imageryEls[0]) : [],
      ringZIndex: getComputedStyle(ringEl).zIndex,
      overlayZIndex: overlayEl ? getComputedStyle(overlayEl).zIndex : null,
    },
    overflowX:
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    canvasId: (() => {
      const canvas = map.querySelector("canvas.maplibregl-canvas");
      if (!canvas) return null;
      if (!canvas.dataset.item128Id)
        canvas.dataset.item128Id = String(Math.random()).slice(2, 10);
      return canvas.dataset.item128Id;
    })(),
    nodeCounts: {
      overlay: document.querySelectorAll(".map-status-overlay").length,
      attribution: document.querySelectorAll(".map-attribution").length,
      canvas: document.querySelectorAll("canvas.maplibregl-canvas").length,
    },
    connected: nodes.filter(Boolean).every((node) => node.isConnected),
  };
}

/** The geometry that must not change between two samples 300ms apart. */
function signature(m) {
  return JSON.stringify({
    enlarged: m.enlarged,
    ring: m.ring,
    control: m.control,
    imagery: m.imagery.map((i) => [i.testid, i.text, i.box, i.retry?.box]),
    planning: m.planning.map((p) => [p.text, p.box]),
    map: [m.mapViewport.w, m.mapViewport.h],
  });
}

async function settledMeasure(page, { expectTestId = null, paint = true } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const first = await page.evaluate(pageMeasure, { paint: false });
    await sleep(300);
    const second = await page.evaluate(pageMeasure, { paint });
    const testIds = second.imagery.map((i) => i.testid);
    const problems = [];
    if (!first.connected || !second.connected) problems.push("a node detached");
    if (signature(first) !== signature(second))
      problems.push("geometry changed between samples");
    if (expectTestId && !testIds.includes(expectTestId)) {
      problems.push(`expected ${expectTestId}, found ${testIds.join(",") || "none"}`);
    }
    if (problems.length === 0) return { ...second, attempts: attempt };
    lastError = problems.join("; ");
    await sleep(500);
  }
  throw new Error(`unsettled measurement: ${lastError}`);
}

/** Derived clearances: every message against the ring, the control, the
 * attribution, both clusters and each other. Negative = overlap. */
function analyse(m) {
  const messages = [
    ...m.imagery.map((i) => ({
      kind: `imagery:${i.testid}`,
      box: i.box,
      inMap: i.inMap,
    })),
    ...m.planning.map((p) => ({ kind: "planning", box: p.box, inMap: p.inMap })),
  ];
  const inMap = messages.filter((msg) => msg.inMap);
  const min = (values) => {
    const list = values.filter((v) => v !== null);
    return list.length ? Math.min(...list) : null;
  };
  const ringSep = min(inMap.map((msg) => separation(m.ring, msg.box)));
  const lineHeight = m.imagery[0]?.lineHeightPx ?? null;
  const imagery = m.imagery[0] ?? null;
  const result = {
    ringSep,
    ringSepLines: ringSep !== null && lineHeight ? round(ringSep / lineHeight) : null,
    imageryBottom: imagery ? round(imagery.box.b) : null,
    ringTop: round(m.ring.y),
    ringBottom: round(m.ring.b),
    controlSep: min(inMap.map((msg) => separation(m.controlFootprint, msg.box))),
    attributionSep: m.attributionInMap
      ? min(inMap.map((msg) => separation(m.attribution, msg.box)))
      : null,
    zoomSep: min(inMap.map((msg) => separation(m.zoomCluster, msg.box))),
    cameraSep: min(inMap.map((msg) => separation(m.cameraCluster, msg.box))),
    messageMessageSep:
      m.imagery.length && m.planning.length
        ? min(m.imagery.flatMap((i) => m.planning.map((p) => separation(i.box, p.box))))
        : null,
    messagesInsideMap: inMap.every(
      (msg) =>
        msg.box.x >= 0 &&
        msg.box.y >= 0 &&
        msg.box.r <= m.mapViewport.w &&
        msg.box.b <= m.mapViewport.h,
    ),
    messagesInViewport: [...m.imagery, ...m.planning].every((i) => i.inViewport),
    arrival: m.arrival,
    retryOk: m.imagery
      .filter((i) => i.retry)
      .every((i) => i.retry.box.w >= 112 - 0.01 && i.retry.box.h >= 44 - 0.01),
    retryHit: m.hits.retry.every((h) => h.onRetry),
    // Only meaningful for a message inside the map (C3 puts it in the page).
    imageryTextClickThrough: m.imagery.some((i) => i.inMap)
      ? m.hits.imageryText.every((h) => h.reachesMap)
      : null,
    ringCentreReachesMap: m.hits.ringCentreReachesMap,
    ringPaintedOver: m.paintOrder
      ? m.paintOrder.samples.filter((s) => s !== "ring").length
      : null,
    ringOverTextPx2: m.ringOverTextPx2,
    ringOverRetryPx2: round(m.ringOverRetryPx2),
    controlRingSep: separation(m.controlFootprint, m.ring),
    overflowX: m.overflowX,
    imageryLines: imagery?.lines ?? null,
    imageryHeight: imagery ? round(imagery.box.h) : null,
  };
  result.passes =
    (ringSep === null || ringSep > 0) &&
    (result.controlSep === null || result.controlSep > 0) &&
    (result.attributionSep === null || result.attributionSep > 0) &&
    (result.zoomSep === null || result.zoomSep > 0) &&
    (result.cameraSep === null || result.cameraSep > 0) &&
    (result.messageMessageSep === null || result.messageMessageSep > 0) &&
    result.messagesInsideMap &&
    result.messagesInViewport &&
    result.retryOk &&
    result.retryHit &&
    result.imageryTextClickThrough !== false &&
    result.ringCentreReachesMap &&
    result.overflowX <= 0;
  return result;
}

async function shoot(page, m, name) {
  const pad = 6;
  const clip = {
    x: Math.max(0, m.mapViewport.x - pad),
    y: Math.max(0, m.mapViewport.y - pad),
    width: Math.min(m.viewport.w, m.mapViewport.w + 2 * pad),
    height: m.mapViewport.h + 2 * pad,
  };
  // Include messages placed below the map (C3, C6, C7).
  const below = [...m.imagery, ...m.planning]
    .filter((i) => !i.inMap)
    .reduce((b, i) => Math.max(b, i.box.b), m.mapViewport.h);
  clip.height = Math.min(m.viewport.h - clip.y, below + 2 * pad);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), clip });
  await page.screenshot({ path: path.join(SHOTS, `${name}--viewport.png`) });
  return { clip, pad };
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

function caseMatrix({ sizes, engines = ["chromium", "webkit"], languages = LANGUAGES }) {
  const cases = [];
  for (const engine of engines)
    for (const size of sizes)
      for (const language of languages) cases.push({ engine, size, language });
  return cases;
}

async function withBrowsers(fn) {
  const browsers = {};
  try {
    for (const [name, type] of Object.entries(ENGINES))
      browsers[name] = await type.launch();
    return await fn(browsers);
  } finally {
    await Promise.all(Object.values(browsers).map((b) => b.close()));
  }
}

async function runCase(browsers, spec, body) {
  const id = [spec.engine, spec.size, spec.language, spec.state, spec.tag]
    .filter(Boolean)
    .join("-");
  if (ONLY && !id.includes(ONLY)) return null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const opened = await openPlanning(browsers[spec.engine], spec).catch((error) => ({
      error,
    }));
    if (opened.error) {
      if (attempt === 2) return { id, ...spec, error: String(opened.error) };
      continue;
    }
    try {
      const out = await body(opened, id);
      return { id, ...spec, ...out };
    } catch (error) {
      if (attempt === 2) return { id, ...spec, error: String(error?.stack ?? error) };
    } finally {
      await opened.context.close();
    }
  }
  return null;
}

async function measureCandidates(
  page,
  id,
  candidates,
  expectTestId,
  { shots = true, paint = true } = {},
) {
  const out = {};
  const baseline = await settledMeasure(page, { expectTestId, paint });
  for (const candidate of candidates) {
    let m = baseline;
    let applied = null;
    if (candidate !== "C0") {
      applied = await applyCandidate(page, candidate);
      m = await settledMeasure(page, { expectTestId, paint });
    }
    const shot = shots ? await shoot(page, m, `${id}-${candidate}`) : null;
    out[candidate] = {
      applied,
      analysis: analyse(m),
      mapUnchanged:
        m.mapViewport.w === baseline.mapViewport.w &&
        m.mapViewport.h === baseline.mapViewport.h &&
        Math.abs(m.mapPageY - baseline.mapPageY) < 0.01,
      canvasUnchanged: m.canvasId === baseline.canvasId,
      measurement: m,
      shot,
    };
    if (candidate !== "C0") {
      await restoreCandidate(page);
      const back = await settledMeasure(page, { expectTestId, paint: false });
      out[candidate].restoredExactly = signature(back) === signature(baseline);
    }
  }
  return out;
}

const STAGES = {
  /** Stage 2: reproduce the recorded fallback overlaps, unchanged build. */
  async baseline(browsers) {
    const cases = caseMatrix({ sizes: [...REQUIRED_SIZES, ...CONTROL_SIZES] }).map(
      (c) => ({
        ...c,
        state: "fallback",
      }),
    );
    const results = await pool(cases, CONCURRENCY, (spec) =>
      runCase(browsers, spec, async ({ page }, id) => {
        const rootFontPx = await readRootFontPx(page);
        const candidates = await measureCandidates(
          page,
          id,
          ["C0"],
          "map-fallback-banner",
        );
        return { rootFontPx, candidates };
      }),
    );
    // Riding's pre-ride overview: the same overlay, computed top.
    const riding = await readRidingOverlayTop(browsers.chromium);
    return { results, riding };
  },

  /** Stage 3: every candidate against the fallback banner.
   * ITEM128_SIZES=corners measures the informative corners instead. */
  async candidates(browsers) {
    const sizes =
      process.env.ITEM128_SIZES === "corners"
        ? ["375x812", "320x568"]
        : [...REQUIRED_SIZES, ...CONTROL_SIZES];
    const cases = caseMatrix({ sizes }).map((c) => ({
      ...c,
      state: "fallback",
    }));
    return pool(cases, CONCURRENCY, (spec) =>
      runCase(browsers, spec, async ({ page }, id) => ({
        candidates: await measureCandidates(
          page,
          id,
          process.env.ITEM128_CANDIDATES ? chosenCandidates() : CANDIDATES,
          "map-fallback-banner",
        ),
      })),
    );
  },

  /** Stage 3: Planning's own messages together with the fallback banner.
   * ITEM128_TEXT=below repeats it just below item 114's switch (Stage 4). */
  async cooccurrence(browsers) {
    const cases = [];
    const below = process.env.ITEM128_TEXT === "below";
    for (const c of caseMatrix({ sizes: [...REQUIRED_SIZES, ...CONTROL_SIZES] })) {
      const { width, height } = SIZES[c.size];
      const rootFontSize = below
        ? `${(Math.min(width - 32, mapHeightFor(height)) / 17 - 0.02).toFixed(3)}px`
        : null;
      const suffix = below ? "-below" : "";
      cases.push({ ...c, state: "fallback", tag: `locate${suffix}`, rootFontSize });
      cases.push({
        ...c,
        state: "fallback",
        tag: `warning${suffix}`,
        withRoute: true,
        rootFontSize,
      });
    }
    return pool(cases, CONCURRENCY, (spec) =>
      runCase(browsers, spec, async ({ page }, id) => {
        if (spec.tag.startsWith("locate")) await failLocate(page);
        else await selectWarning(page, spec.language);
        return {
          candidates: await measureCandidates(
            page,
            id,
            process.env.ITEM128_CANDIDATES ? chosenCandidates() : CANDIDATES,
            "map-fallback-banner",
          ),
        };
      }),
    );
  },

  /** Stage 4: the other imagery states and the longest labels, for the
   * candidates named in ITEM128_CANDIDATES (default: C0 plus C1a, C1b). */
  async wider(browsers) {
    const chosen = chosenCandidates();
    const cases = [];
    for (const c of caseMatrix({ sizes: [...REQUIRED_SIZES, ...CONTROL_SIZES] })) {
      cases.push({ ...c, state: "loading" });
      cases.push({ ...c, state: "delayed" });
      cases.push({ ...c, state: "tile-error" });
      cases.push({ ...c, state: "fallback", tag: "load-error-proxy" });
      cases.push({ ...c, state: "fallback", tag: "labels" });
    }
    return pool(cases, CONCURRENCY, (spec) =>
      runCase(browsers, spec, async (opened, id) => {
        const { page, controller } = opened;
        try {
          if (spec.state === "loading") {
            return {
              candidates: await measureCandidates(page, id, chosen, "map-loading"),
            };
          }
          if (spec.state === "delayed") {
            return {
              candidates: await measureCandidates(
                page,
                id,
                chosen,
                "map-imagery-delayed-banner",
              ),
            };
          }
          if (spec.state === "tile-error") {
            return {
              candidates: await measureCandidates(
                page,
                id,
                chosen,
                "tiles-unavailable-banner",
              ),
            };
          }
          if (spec.tag === "load-error-proxy") {
            const border = await applyLoadErrorProxy(page, spec.language);
            const candidates = await measureCandidates(
              page,
              id,
              chosen,
              "map-fallback-banner",
            );
            await restoreLoadErrorProxy(page);
            return { proxy: { borderLeftWidth: border }, candidates };
          }
          // Labels: the longest Move and Insert-after after 12 waypoints.
          await placeTwelveWaypoints(page);
          const labels = {};
          for (const mode of ["move", "insert"]) {
            await chooseRelocation(page, mode);
            labels[mode] = await measureCandidates(
              page,
              `${id}-${mode}`,
              chosen,
              "map-fallback-banner",
              {
                paint: false,
              },
            );
          }
          return { labels };
        } finally {
          if (controller?.releaseTiles) await controller.releaseTiles();
        }
      }),
    );
  },

  /** Stage 4: text sizes — 100%, just below and just above item 114's
   * engage point (fresh loads), and 200%. */
  async textsize(browsers) {
    const chosen = chosenCandidates();
    const cases = [];
    for (const c of caseMatrix({ sizes: [...REQUIRED_SIZES, ...CONTROL_SIZES] })) {
      const { width, height } = SIZES[c.size];
      const mapWidth = width - 32;
      const mapHeight = mapHeightFor(height);
      const star = Math.min(mapWidth, mapHeight) / 17;
      for (const [tag, px] of [
        ["below", star - 0.02],
        ["above", star + 0.02],
        ["200", 32],
      ]) {
        cases.push({ ...c, state: "fallback", tag, rootFontSize: `${px.toFixed(3)}px` });
      }
    }
    return pool(cases, CONCURRENCY, (spec) =>
      runCase(browsers, spec, async ({ page }, id) => {
        const rootFontPx = await readRootFontPx(page);
        const probe = await page.evaluate(pageMeasure, { paint: false });
        const expectEnlarged = spec.tag !== "below";
        const candidates = probe.enlarged
          ? { C0: { measurement: probe, shot: await shoot(page, probe, `${id}-C0`) } }
          : await measureCandidates(page, id, chosen, "map-fallback-banner");
        return { rootFontPx, enlarged: probe.enlarged, expectEnlarged, candidates };
      }),
    );
  },

  /** Stage 4: live transitions across the engage (17) and release (17.25)
   * ratios with the banner showing. Any DOM move is restored first. */
  async transitions(browsers) {
    const cases = caseMatrix({ sizes: [...REQUIRED_SIZES, ...CONTROL_SIZES] }).map(
      (c) => ({
        ...c,
        state: "fallback",
      }),
    );
    return pool(cases, CONCURRENCY, (spec) =>
      runCase(browsers, spec, async ({ page }, id) => {
        const m0 = await settledMeasure(page, {
          expectTestId: "map-fallback-banner",
          paint: false,
        });
        const min = Math.min(m0.mapViewport.w, m0.mapViewport.h);
        const steps = [
          ["engage", min / 17 + 0.02, true],
          ["hold", min / 17.1, true],
          ["release", min / 17.3, false],
          ["re-engage", min / 16.9, true],
          ["back-to-100", 16, false],
        ];
        const log = [];
        for (const candidate of chosenCandidates()) {
          await setRootFont(page, "");
          await waitFor(
            async () => !(await page.evaluate(pageMeasure, { paint: false })).enlarged,
            {
              what: "ordinary layout",
            },
          );
          if (candidate !== "C0") await applyCandidate(page, candidate);
          const start = await settledMeasure(page, {
            expectTestId: "map-fallback-banner",
            paint: false,
          });
          for (const [name, px, expected] of steps) {
            // The rider's rule: restore a DOM move before any React update
            // that could re-parent the moved node (a layout switch is one).
            if (MOVES_NODES.has(candidate)) await restoreCandidate(page);
            await setRootFont(page, `${px.toFixed(3)}px`);
            await sleep(150);
            const m = await settledMeasure(page, {
              expectTestId: "map-fallback-banner",
              paint: false,
            });
            let reapplied = null;
            if (MOVES_NODES.has(candidate) && !m.enlarged) {
              reapplied = await applyCandidate(page, candidate);
            }
            const after = reapplied
              ? await settledMeasure(page, {
                  expectTestId: "map-fallback-banner",
                  paint: false,
                })
              : m;
            log.push({
              candidate,
              step: name,
              rootFontPx: m.rootFontPx,
              enlarged: m.enlarged,
              expectedEnlarged: expected,
              nodeCounts: m.nodeCounts,
              canvasUnchanged: m.canvasId === start.canvasId,
              mapUnchanged:
                m.mapViewport.w === start.mapViewport.w &&
                m.mapViewport.h === start.mapViewport.h,
              overlayInMap: after.overlay.inMap,
              overlayTop: after.overlay.top,
              analysis: analyse(after),
            });
          }
          await restoreCandidate(page);
        }
        // Retry still operates after the transitions (a map recreate, by
        // design): the banner detaches and a new one settles.
        await setRootFont(page, "");
        const banner = page.getByTestId("map-fallback-banner");
        const before = await banner.elementHandle();
        await page.getByTestId("retry-map-imagery-button").click();
        await waitFor(() => before.evaluate((el) => !el.isConnected), {
          what: "old banner detached",
        });
        await banner.waitFor({ state: "visible", timeout: 20_000 });
        return { log, retryAfterTransitions: "banner detached and re-settled" };
      }),
    );
  },

  /** Stage 4: appear, change and clear on one page, with a per-frame
   * recorder installed before anything changes. */
  async sequence(browsers) {
    const chosen = chosenCandidates();
    const cases = [];
    for (const c of caseMatrix({ sizes: REQUIRED_SIZES })) {
      for (const candidate of chosen)
        cases.push({ ...c, state: "sequence", tag: candidate });
    }
    return pool(cases, CONCURRENCY, (spec) =>
      runCase(browsers, spec, async ({ page, controller }, id) => {
        const candidate = spec.tag;
        try {
          if (candidate !== "C0") await applyCandidate(page, candidate);
          await installRecorder(page);
          const events = [];
          const mark = async (label) => {
            events.push({ label, t: await page.evaluate(() => performance.now()) });
          };
          // 1. tile-error appears
          await mark("tile-error:start");
          await triggerTileError(page, controller);
          await sleep(400);
          // 2. a Planning message appears, then clears, beside it
          await mark("locate-failed:start");
          await failLocate(page);
          await sleep(400);
          await mark("locate-failed:clear");
          await succeedLocate(page);
          await sleep(400);
          // 3. the kind changes: Retry with tiles held -> loading -> delayed
          await mark("retry-to-delayed:start");
          controller.holdTiles();
          await page.getByTestId("retry-map-imagery-button").click();
          await page
            .getByTestId("map-imagery-delayed-banner")
            .waitFor({ state: "visible", timeout: 15_000 });
          await sleep(400);
          // 4. and clears on recovery
          await mark("recover:start");
          controller.succeedTiles();
          await controller.releaseTiles();
          await waitFor(
            async () => (await page.locator(".map-status-message").count()) === 0,
            {
              timeout: 20_000,
              what: "imagery message cleared",
            },
          );
          await sleep(400);
          await mark("end");
          const frames = await page.evaluate(() => window.__item128Frames);
          if (candidate !== "C0") await restoreCandidate(page);
          return { candidate, events, summary: summariseFrames(frames, events) };
        } finally {
          await controller.releaseTiles();
        }
      }),
    );
  },
};

/** Stage 4 runs only on the candidates that passed Stage 3. */
function chosenCandidates() {
  return (process.env.ITEM128_CANDIDATES ?? "C0,C3,C6,C7").split(",");
}

const MOVES_NODES = new Set(["C1a", "C1b", "C3", "C6", "C7"]);

function mapHeightFor(viewportHeight) {
  // Source-derived (index.css .planning-map-container); verified against
  // the measured map in every case.
  const dvh = viewportHeight * 0.44;
  return Math.min(460, Math.max(280, Math.round(dvh / 20) * 20));
}

async function readRidingOverlayTop(browser) {
  // Source reference only: Riding's pre-ride overview renders the same
  // unhosted overlay; its computed `top` must stay 72px.
  const context = await browser.newContext({
    baseURL: BASE_URL,
    serviceWorkers: "block",
    viewport: SIZES["390x844"],
  });
  const page = await context.newPage();
  try {
    await forceMapStyleFailure(page);
    await page.goto(BASE_URL);
    await page
      .getByLabel("Import GPX file")
      .setInputFiles(path.join(REPO, "e2e/fixtures/smoke-route.gpx"));
    await page.getByRole("button", { name: "smoke-route", exact: true }).click();
    const banner = page.getByTestId("map-fallback-banner");
    await banner.waitFor({ state: "visible", timeout: 20_000 });
    return await banner.evaluate((el) => {
      const overlay = el.closest(".map-status-overlay");
      return {
        context: "Riding pre-ride overview (smoke-route fixture)",
        top: getComputedStyle(overlay).top,
        inPlanningMap: !!el.closest(".planning-map-container"),
      };
    });
  } catch (error) {
    return { error: String(error) };
  } finally {
    await context.close();
  }
}

async function installRecorder(page) {
  await page.evaluate(() => {
    const frames = [];
    window.__item128Frames = frames;
    const map = document.querySelector(".planning-map-container");
    const ring = document.querySelector(".planning-crosshair");
    const tick = () => {
      const mr = map.getBoundingClientRect();
      const rr = ring.getBoundingClientRect();
      const rel = (r) => ({
        y: r.top - mr.top,
        b: r.bottom - mr.top,
        x: r.left - mr.left,
        r: r.right - mr.left,
      });
      const boxes = [
        ...[...document.querySelectorAll(".map-status-message")].map((el) => ({
          kind: el.dataset.testid,
          ...rel(el.getBoundingClientRect()),
          inMap: map.contains(el),
        })),
        ...[...document.querySelectorAll(".planning-map-status-message")].map((el) => ({
          kind: "planning",
          ...rel(el.getBoundingClientRect()),
          inMap: true,
        })),
      ];
      const ringBox = rel(rr);
      const overlap = boxes
        .filter((b) => b.inMap)
        .some(
          (b) => b.y < ringBox.b && b.b > ringBox.y && b.x < ringBox.r && b.r > ringBox.x,
        );
      frames.push({ t: performance.now(), boxes, overlap });
      if (frames.length < 20_000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function summariseFrames(frames, events) {
  const phases = [];
  for (let index = 0; index < events.length - 1; index += 1) {
    const from = events[index];
    const to = events[index + 1];
    const slice = frames.filter((f) => f.t >= from.t && f.t < to.t);
    const imageryTops = slice.flatMap((f) =>
      f.boxes.filter((b) => b.kind !== "planning").map((b) => Math.round(b.y)),
    );
    phases.push({
      phase: from.label,
      frames: slice.length,
      framesWithRingOverlap: slice.filter((f) => f.overlap).length,
      imageryTopValues: [...new Set(imageryTops)],
      kinds: [...new Set(slice.flatMap((f) => f.boxes.map((b) => b.kind)))],
    });
  }
  return phases;
}

// ---------------------------------------------------------------------------
// Sheets: labelled review images composed from the screenshots
// ---------------------------------------------------------------------------

async function composeSheets() {
  const baseline = readResults("baseline");
  const candidates = readResults("candidates");
  const cooccurrence = readResults("cooccurrence");
  const textsize = readResults("textsize");
  const wider = readResults("wider");
  const corners = readResults("candidates-corners");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const sheets = buildSheetSpecs({
      baseline,
      candidates,
      cooccurrence,
      textsize,
      wider,
      corners,
    });
    for (const sheet of sheets) {
      await page.setContent(sheetHtml(sheet));
      await page.evaluate(() =>
        Promise.all([...document.images].map((img) => img.decode())),
      );
      const body = page.locator("body > main");
      await body.screenshot({ path: path.join(IMAGES, `${sheet.file}.png`) });
      console.log(`wrote images/${sheet.file}.png`);
    }
  } finally {
    await browser.close();
  }
}

function findCase(results, predicate) {
  return (results?.results ?? results ?? []).find((r) => r && !r.error && predicate(r));
}

function cellFor(entry, candidate, label) {
  const data = entry?.candidates?.[candidate];
  if (!data?.shot) return null;
  const a = data.analysis ?? analyse(data.measurement);
  const file = path.join(SHOTS, `${entry.id}-${candidate}.png`);
  if (!fs.existsSync(file)) return null;
  return {
    img: `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`,
    m: data.measurement,
    pad: data.shot.pad,
    label,
    verdict: a.passes ? "pass" : "fail",
    notes: describeAnalysis(a, data.measurement),
  };
}

function describeAnalysis(a, m) {
  const parts = [];
  if (a.ringSep !== null) {
    parts.push(
      a.ringSep > 0 ? `ring clear by ${a.ringSep}px` : `covers ring by ${-a.ringSep}px`,
    );
  } else {
    parts.push("nothing over the map");
  }
  const below = [...m.imagery, ...m.planning].filter((i) => !i.inMap).length;
  if (below) parts.push(`${below} message${below > 1 ? "s" : ""} below the map`);
  if (!a.ringCentreReachesMap) parts.push(`crosshair point hits ${m.hits.ringCentre}`);
  if (a.messageMessageSep !== null && a.messageMessageSep <= 0)
    parts.push(`messages overlap ${-a.messageMessageSep}px`);
  if (m.stacking.ringZIndex === "6") {
    const area = Math.round((a.ringOverTextPx2 ?? 0) + (a.ringOverRetryPx2 ?? 0));
    if (area > 0) parts.push(`raised ring paints over ${area}px² of the message`);
  }
  if (a.imageryTextClickThrough === false) parts.push("in-map text blocks taps");
  if (!a.messagesInViewport) parts.push("message off-screen");
  return parts.join("; ");
}

function buildSheetSpecs({
  baseline,
  candidates,
  cooccurrence,
  textsize,
  wider,
  corners,
}) {
  const sheets = [];
  const pick = (results, engine, size, language, extra = () => true) =>
    findCase(
      results,
      (r) =>
        r.engine === engine && r.size === size && r.language === language && extra(r),
    );
  if (process.env.ITEM128_SHEETS === "implemented") {
    // Item 128's implemented C6: "C0" here is the build itself, with no
    // prototype override applied.
    const version = process.env.ITEM128_VERSION ?? "implemented";
    const own = (results, size, tag, label) =>
      cellFor(
        pick(results, "chromium", size, "de", (r) => (tag ? r.tag === tag : true)),
        "C0",
        label,
      );
    sheets.push({
      file: `implemented-${version}`,
      title: `Implemented C6, ${version}: German, 100% text, Chromium (WebKit measured identical)`,
      rows: ["375x667", "320x844"].map((size) => ({
        title: size,
        cells: [
          own(baseline, size, null, "imagery message alone"),
          own(cooccurrence, size, "locate", "with Locate failed"),
          own(cooccurrence, size, "warning", "with a selected warning"),
        ],
      })),
    });
    return sheets;
  }
  if (baseline) {
    sheets.push({
      file: "baseline",
      title: "Baseline 0.4.49 — fallback banner, 100% text (Chromium | WebKit)",
      rows: [...REQUIRED_SIZES, ...CONTROL_SIZES].map((size) => ({
        title: size + (CONTROL_SIZES.includes(size) ? " control" : ""),
        cells: ["chromium", "webkit"].flatMap((engine) =>
          LANGUAGES.map((language) =>
            cellFor(
              pick(baseline, engine, size, language),
              "C0",
              `${engine} ${language.toUpperCase()}`,
            ),
          ),
        ),
      })),
    });
  }
  if (candidates) {
    for (const size of ["375x667", "320x844"]) {
      sheets.push({
        file: `candidates-${size}`,
        title: `Candidates at ${size}, fallback banner alone, 100% text, Chromium (WebKit identical)`,
        rows: ["C0", "C1a", "C2", "C4", "C5", "C3", "C6", "C7"].map((candidate) => ({
          title: candidate,
          cells: LANGUAGES.map((language) =>
            cellFor(
              pick(candidates, "chromium", size, language),
              candidate,
              `${candidate} ${language.toUpperCase()}`,
            ),
          ),
        })),
      });
    }
  }
  if (cooccurrence) {
    sheets.push({
      file: "cooccurrence",
      title:
        "Fallback banner plus Planning's Locate-failed message, German, 100% text, Chromium",
      rows: ["C0", "C1a", "C3", "C6", "C7"].map((candidate) => ({
        title: candidate,
        cells: REQUIRED_SIZES.map((size) =>
          cellFor(
            pick(cooccurrence, "chromium", size, "de", (r) => r.tag === "locate"),
            candidate,
            `${candidate} ${size}`,
          ),
        ),
      })),
    });
  }
  if (textsize) {
    sheets.push({
      file: "text-sizes",
      title:
        "German, fallback banner, just below item 114's switch (largest ordinary text), Chromium",
      rows: ["C0", "C3", "C6"].map((candidate) => ({
        title: candidate,
        cells: [...REQUIRED_SIZES, ...CONTROL_SIZES].map((size) => {
          const entry = pick(textsize, "chromium", size, "de", (r) => r.tag === "below");
          const pct = entry ? `${((entry.rootFontPx / 16) * 100).toFixed(1)}%` : "";
          return cellFor(entry, candidate, `${candidate} ${size} at ${pct}`);
        }),
      })),
    });
  }
  if (wider) {
    sheets.push({
      file: "imagery-states",
      title:
        "Every imagery state at 375×667, German, 100% text, Chromium (load-error is a layout proxy)",
      rows: ["C0", "C6"].map((candidate) => ({
        title: candidate,
        cells: ["loading", "delayed", "tile-error", "load-error-proxy"].map((kind) =>
          cellFor(
            pick(
              wider,
              "chromium",
              "375x667",
              "de",
              (r) => r.state === kind || r.tag === kind,
            ),
            candidate,
            `${candidate} ${kind}`,
          ),
        ),
      })),
    });
  }
  if (corners) {
    sheets.push({
      file: "corners",
      title:
        "Informative corners (not gating): 375×812 and the 280px map floor at 320×568, German, Chromium",
      rows: ["C0", "C3", "C6"].map((candidate) => ({
        title: candidate,
        cells: ["375x812", "320x568"].map((size) =>
          cellFor(
            pick(corners, "chromium", size, "de"),
            candidate,
            `${candidate} ${size}`,
          ),
        ),
      })),
    });
  }
  return sheets;
}

function sheetHtml(sheet) {
  const esc = (s) =>
    String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const cell = (c) => {
    if (!c)
      return `<figure class="cell empty"><figcaption>not measured</figcaption></figure>`;
    const { m, pad } = c;
    const offX = Math.min(pad, m.mapViewport.x);
    const offY = pad;
    const outline = (box, cls) =>
      box
        ? `<rect class="${cls}" x="${box.x + offX}" y="${box.y + offY}" width="${box.w}" height="${box.h}"/>`
        : "";
    const rects = [
      outline(m.ring, "ring"),
      ...m.imagery.map((i) => outline(i.box, "msg")),
      ...m.planning.map((p) => outline(p.box, "pmsg")),
      outline(m.controlFootprint, "ctl"),
    ].join("");
    const width = m.mapViewport.w + 2 * pad;
    return `<figure class="cell ${c.verdict}">
      <div class="shot" style="width:${width}px"><img src="${c.img}" style="width:${width}px"/>
      <svg width="${width}" height="2000">${rects}</svg></div>
      <figcaption><b>${esc(c.label)}</b> <span class="v">${c.verdict.toUpperCase()}</span><br/>${esc(c.notes)}</figcaption>
    </figure>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; font: 14px/1.35 system-ui, sans-serif; background: #fff; color: #111; }
    main { display: inline-block; padding: 16px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    p.key { margin: 0 0 12px; color: #444; }
    .row { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 14px; }
    .row > h2 { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 14px; margin: 0; }
    .cell { margin: 0; }
    .shot { position: relative; }
    .shot img { display: block; }
    .shot svg { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; }
    rect { fill: none; stroke-width: 1.5; }
    rect.ring { stroke: #00c853; stroke-dasharray: 3 2; }
    rect.msg { stroke: #ff00d4; }
    rect.pmsg { stroke: #ff9100; }
    rect.ctl { stroke: #2979ff; stroke-dasharray: 4 3; }
    figcaption { max-width: 360px; margin-top: 4px; }
    .fail .v { color: #b00020; font-weight: 700; }
    .pass .v { color: #1b5e20; font-weight: 700; }
    .empty { width: 120px; color: #888; }
  </style></head><body><main>
    <h1>${esc(sheet.title)}</h1>
    <p class="key">Outlines: green dashed = crosshair ring box, magenta = imagery message, orange = Planning's own message, blue dashed = placement control incl. its 4px band. ${esc(SHEET_LABEL)}</p>
    ${sheet.rows.map((row) => `<div class="row"><h2>${esc(row.title)}</h2>${row.cells.map(cell).join("")}</div>`).join("")}
  </main></body></html>`;
}

// ---------------------------------------------------------------------------

if (STAGE === "sheets") {
  fs.mkdirSync(IMAGES, { recursive: true });
  await composeSheets();
} else if (STAGES[STAGE]) {
  const started = Date.now();
  const data = await withBrowsers(async (browsers) => {
    const versions = {
      chromium: browsers.chromium.version(),
      webkit: browsers.webkit.version(),
      node: process.version,
    };
    const results = await STAGES[STAGE](browsers);
    return { stage: STAGE, versions, baseUrl: BASE_URL, results };
  });
  data.seconds = Math.round((Date.now() - started) / 1000);
  // Flatten a nested { results, riding } from the baseline stage.
  if (data.results && !Array.isArray(data.results) && data.results.results) {
    data.riding = data.results.riding;
    data.results = data.results.results;
  }
  const suffix = process.env.ITEM128_TEXT ?? process.env.ITEM128_SIZES ?? null;
  writeResults(suffix ? `${STAGE}-${suffix}` : STAGE, data);
  const failures = (data.results ?? []).filter((r) => r?.error);
  console.log(
    `${STAGE}: ${data.results?.filter(Boolean).length ?? 0} cases, ${failures.length} errors, ${data.seconds}s`,
  );
  for (const f of failures) console.log(`  ERROR ${f.id}: ${f.error.split("\n")[0]}`);
} else {
  throw new Error(`unknown stage ${STAGE}`);
}
