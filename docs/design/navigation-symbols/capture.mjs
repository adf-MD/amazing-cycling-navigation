// Item 102 — renders the navigation-symbol mock-ups and measures them.
//
// Design-stage tooling only: nothing here is imported by the app, linted or
// type-checked. Run it inside the pinned Playwright container, whose fonts
// match CI (they do not match iOS — see README.md):
//
//   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
//     -v "$PWD":/work -v /tmp/item102:/scratch -w /work --ipc=host \
//     mcr.microsoft.com/playwright:v1.61.1-noble \
//     node docs/design/navigation-symbols/capture.mjs /scratch
//
// The optional argument is a scratch directory for the intermediate cell
// images and measurements.json (default: a directory under os.tmpdir()).
// Only the final sheets are written into this directory's images/.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const IMAGES = path.join(HERE, "images");
const SCRATCH = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "acn-item102"));
const CELLS = path.join(SCRATCH, "cells");
fs.mkdirSync(CELLS, { recursive: true });
fs.mkdirSync(IMAGES, { recursive: true });

const { chromium, webkit } = await import(
  pathToFileURL(path.join(REPO, "node_modules/playwright/index.mjs")).href
);

// ---------------------------------------------------------------- server
// Same-origin HTTP rather than file://, so both engines load the linked
// stylesheet, blob images and cell images identically.
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const [rootDir, relative] = pathname.startsWith("/__cells/")
    ? [CELLS, pathname.slice("/__cells/".length)]
    : [REPO, pathname.slice(1)];
  const file = path.resolve(rootDir, relative);
  if (
    !file.startsWith(rootDir) ||
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  ) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
  });
  fs.createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const MOCKUP = `${ORIGIN}/docs/design/navigation-symbols/mockup.html`;

// ---------------------------------------------------------------- matrix
const DIRECTIONS = [
  { key: "current", name: "Current (0.4.48)" },
  { key: "a", name: "A · Line" },
  { key: "b", name: "B · Solid" },
  { key: "c", name: "C · ACN mark" },
];
const STATES = [
  { key: "library", label: "Routes selected", query: "selected=library" },
  { key: "riding", label: "Ride selected", query: "selected=riding" },
  { key: "planning", label: "Plan selected", query: "selected=planning" },
  { key: "settings", label: "Settings selected", query: "selected=settings" },
  { key: "status", label: "Settings → Status view", query: "selected=settings&status=1" },
];
const CONDITIONS = [
  { key: "390-en", width: 390, lang: "en", text: 100, scheme: "light" },
  { key: "390-de", width: 390, lang: "de", text: 100, scheme: "light" },
  { key: "320-en", width: 320, lang: "en", text: 100, scheme: "light" },
  { key: "320-de", width: 320, lang: "de", text: 100, scheme: "light" },
  { key: "390-en-dark", width: 390, lang: "en", text: 100, scheme: "dark" },
  { key: "320-de-dark", width: 320, lang: "de", text: 100, scheme: "dark" },
  { key: "390-en-200", width: 390, lang: "en", text: 200, scheme: "light" },
  { key: "390-de-200", width: 390, lang: "de", text: 200, scheme: "light" },
  { key: "320-en-200", width: 320, lang: "en", text: 200, scheme: "light" },
  { key: "320-de-200", width: 320, lang: "de", text: 200, scheme: "light" },
];
// The Planen refinement: A's Routes, Ride and Settings, fixed, with three
// Planen options, judged in the 390 px navigation in light and dark.
const PLAN_OPTIONS = [
  { key: "a-p1", name: "1 · Current dotted path" },
  { key: "a-p2", name: "2 · Revised route" },
  { key: "a", name: "3 · A's original (reference)" },
];
const PLAN_SKETCHES = [
  { key: "a-p2", name: "2 · Revised route (the option shown)" },
  { key: "sketch-smooth", name: "Smoothed bends" },
  { key: "sketch-deep", name: "Deeper dip" },
  { key: "sketch-rings", name: "Ring ends" },
  { key: "sketch-flat", name: "Flatter logo curve" },
  { key: "sketch-serpentine", name: "Switchback" },
  { key: "sketch-heavy-dots", name: "Current path, dotted at A's 2 px" },
];
const PLAN_CONDITIONS = [
  { key: "390-de", width: 390, lang: "de", text: 100, scheme: "light" },
  { key: "390-de-dark", width: 390, lang: "de", text: 100, scheme: "dark" },
  { key: "390-en", width: 390, lang: "en", text: 100, scheme: "light" },
];
const PLAN_STATES = [
  { ...STATES[2], label: "Planen selected" },
  { ...STATES[0], label: "Planen unselected (Routen selected)" },
];
const STRESS_FACTOR = 1.12;
const describe = (c) =>
  `${c.width} px · ${c.lang === "de" ? "German" : "English"}` +
  `${c.text === 200 ? " · 200% text" : ""}${c.scheme === "dark" ? " · dark" : ""}`;
const url = (direction, state, condition, extra = "") =>
  `${MOCKUP}?dir=${direction}&${state.query}&lang=${condition.lang}&text=${condition.text}${extra}`;

// ---------------------------------------------------------------- helpers
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

/** The sticky header plus, when present, the switcher: rounded outward and
 * one pixel deeper, so the bottom border is never cut. */
async function stripClip(page) {
  return page.evaluate(() => {
    const header = document.querySelector(".app-header--sticky").getBoundingClientRect();
    const switcher = document.querySelector(".settings-status-switcher");
    const bottom = switcher ? switcher.getBoundingClientRect().bottom : header.bottom;
    return { x: 0, y: 0, width: window.innerWidth, height: Math.ceil(bottom) + 1 };
  });
}

const SHOT = { animations: "disabled", caret: "hide" };

/** Item 113's width stress (e2e/language.spec.ts's applyNavWidthStress):
 * widens each label by `factor` of its own natural width through a
 * per-element letter-spacing, read back so a no-op cannot pass. */
async function applyWidthStress(page, factor) {
  const applied = await page.evaluate((factor) => {
    const spacings = [];
    for (const element of document.querySelectorAll(".main-nav-button > span")) {
      element.style.letterSpacing = "";
      if (factor === 1) continue;
      const text = element.textContent;
      const characters = [...new Intl.Segmenter().segment(text)].length;
      const style = getComputedStyle(element);
      const probe = document.createElement("span");
      probe.textContent = text;
      for (const property of [
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStyle",
        "fontStretch",
      ]) {
        probe.style[property] = style[property];
      }
      probe.style.whiteSpace = "nowrap";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      document.body.appendChild(probe);
      const natural = probe.getBoundingClientRect().width;
      probe.remove();
      element.style.letterSpacing = `${((factor - 1) * natural) / characters}px`;
      spacings.push(Number.parseFloat(getComputedStyle(element).letterSpacing));
    }
    return spacings;
  }, factor);
  if (
    factor !== 1 &&
    (applied.length !== 4 || applied.some((spacing) => !(spacing > 0)))
  ) {
    throw new Error(`width stress did not apply: ${JSON.stringify(applied)}`);
  }
}

/** Geometry of the navigation and switcher, in CSS px. Label extents come
 * from a Range over the text, never scrollWidth (an integer that is never
 * smaller than the element's own box). */
async function measure(page) {
  return page.evaluate(() => {
    const round = (value) => Math.round(value * 100) / 100;
    const box = (rect) => [rect.left, rect.top, rect.width, rect.height].map(round);
    const inside = (inner, outer) =>
      inner.left >= outer.left - 0.5 &&
      inner.right <= outer.right + 0.5 &&
      inner.top >= outer.top - 0.5 &&
      inner.bottom <= outer.bottom + 0.5;
    const lineCount = (range) => {
      const tops = [];
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && !tops.some((top) => Math.abs(top - rect.top) < 1))
          tops.push(rect.top);
      }
      return tops.length;
    };
    const describeButton = (button) => {
      const rect = button.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(button.querySelector("span") ?? button);
      const text = range.getBoundingClientRect();
      const icon = button.querySelector("svg")?.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        label: button.textContent.trim(),
        rect: box(rect),
        text: box(text),
        icon: icon ? box(icon) : null,
        lines: lineCount(range),
        labelInside: inside(text, rect),
        iconInside: icon ? inside(icon, rect) : true,
        current: button.getAttribute("aria-current"),
        ring: style.boxShadow,
        background: style.backgroundColor,
      };
    };
    const root = document.documentElement;
    let maxRight = 0;
    for (const element of document.querySelectorAll(
      ".app-header--sticky, .app-header--sticky *, .settings-status-switcher, .settings-status-switcher *",
    )) {
      maxRight = Math.max(maxRight, element.getBoundingClientRect().right);
    }
    return {
      documentOverflow: root.scrollWidth - root.clientWidth,
      chromeOverflow: round(Math.max(0, maxRight - root.clientWidth)),
      tabs: [...document.querySelectorAll(".main-nav-button")].map(describeButton),
      switcher: [...document.querySelectorAll(".settings-status-switcher-button")].map(
        describeButton,
      ),
    };
  });
}

/** Ink per icon and state, drawn by Chromium from a standalone serialised
 * SVG at 3 px per unit (66 px for the 24-unit box, the iPhone's 3×). The
 * viewBox is widened by 3 units on every side so ink outside the box is
 * seen rather than clipped. */
async function measureInk(page) {
  return page.evaluate(async () => {
    const SCALE = 3;
    const PAD = 3;
    const SIZE = (24 + 2 * PAD) * SCALE;
    const results = {};
    for (const [direction, { icons }] of Object.entries(DIRECTIONS)) {
      results[direction] = {};
      const masks = {};
      for (const [destination, icon] of Object.entries(icons)) {
        for (const state of ["base", "selected"]) {
          const markup = state === "selected" ? (icon.selected ?? icon.base) : icon.base;
          const source =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" ` +
            `viewBox="${-PAD} ${-PAD} ${24 + 2 * PAD} ${24 + 2 * PAD}" fill="currentColor" color="#000">${markup}</svg>`;
          const blobUrl = URL.createObjectURL(
            new Blob([source], { type: "image/svg+xml" }),
          );
          const image = new Image();
          image.src = blobUrl;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = SIZE;
          canvas.height = SIZE;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          URL.revokeObjectURL(blobUrl);
          const { data } = context.getImageData(0, 0, SIZE, SIZE); // throws if tainted
          let sum = 0;
          let minX = SIZE;
          let minY = SIZE;
          let maxX = -1;
          let maxY = -1;
          for (let y = 0; y < SIZE; y += 1) {
            for (let x = 0; x < SIZE; x += 1) {
              const alpha = data[(y * SIZE + x) * 4 + 3];
              sum += alpha;
              if (alpha > 8) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
              }
            }
          }
          const unit = (px) => Math.round((px / SCALE - PAD) * 100) / 100;
          results[direction][`${destination}:${state}`] = {
            coverage: Math.round((sum / 255 / (24 * SCALE) ** 2) * 1000) / 10,
            bbox: [unit(minX), unit(minY), unit(maxX + 1), unit(maxY + 1)],
          };
          masks[`${destination}:${state}`] = data
            .filter((_, i) => i % 4 === 3)
            .map((a) => (a > 64 ? 1 : 0));
        }
      }
      // A coarse shape-distinctness figure: the intersection over union of
      // the unselected Routes and Plan ink masks (0 = no shared ink).
      const routes = masks["library:base"];
      const plan = masks["planning:base"];
      let intersection = 0;
      let union = 0;
      for (let i = 0; i < routes.length; i += 1) {
        intersection += routes[i] & plan[i];
        union += routes[i] | plan[i];
      }
      results[direction].routesPlanOverlap =
        Math.round((intersection / union) * 1000) / 1000;
    }
    return results;
  });
}

/** Colour tokens, read from the live stylesheet in each scheme. */
async function readTokens(page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const names = [
      "--colour-bg",
      "--colour-text",
      "--colour-accent",
      "--colour-accent-soft",
      "--colour-border",
    ];
    return Object.fromEntries(
      names.map((name) => [name, style.getPropertyValue(name).trim()]),
    );
  });
}

function contrast(foreground, background) {
  const luminance = (hex) => {
    const channels = hex
      .replace("#", "")
      .match(/../g)
      .map((part) => Number.parseInt(part, 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
}

// ---------------------------------------------------------------- capture
const results = {
  measurements: [],
  planMeasurements: [],
  ink: null,
  tokens: {},
  sizes: {},
};
const cell = (name) => path.join(CELLS, `${name}.png`);

async function captureCells(browser) {
  for (const scheme of ["light", "dark"]) {
    for (const dsf of [1, 2]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: dsf,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      for (const condition of CONDITIONS.filter((c) => c.scheme === scheme)) {
        // 2× only where comparison.png uses it: ordinary 390 px English and
        // German, and the 320 px German 200% glimpse.
        if (dsf === 2 && !["390-en", "390-de", "320-de-200"].includes(condition.key))
          continue;
        await page.setViewportSize({ width: condition.width, height: 844 });
        for (const direction of DIRECTIONS) {
          for (const state of STATES) {
            await page.goto(url(direction.key, state, condition));
            await settle(page);
            await page.screenshot({
              ...SHOT,
              path: cell(`${direction.key}-${condition.key}-${state.key}@${dsf}`),
              clip: await stripClip(page),
            });
          }
        }
      }
      if (scheme === "light") {
        // Keyboard focus: Tab from the top of the page onto the Plan tab
        // while Routes is selected, so :focus-visible is the browser's own.
        await page.setViewportSize({ width: 390, height: 844 });
        for (const direction of DIRECTIONS) {
          await page.goto(url(direction.key, STATES[0], CONDITIONS[0]));
          await settle(page);
          for (let i = 0; i < 3; i += 1) await page.keyboard.press("Tab");
          const focused = await page.evaluate(
            () => document.activeElement?.dataset.destination,
          );
          if (focused !== "planning") throw new Error(`focus landed on ${focused}`);
          const clip = await stripClip(page);
          await page.screenshot({
            ...SHOT,
            path: cell(`${direction.key}-focus@${dsf}`),
            clip,
          });
        }
        // Specimens: 22 px and 66 px, unselected and selected.
        await page.setViewportSize({ width: 640, height: 844 });
        for (const direction of DIRECTIONS) {
          await page.goto(`${MOCKUP}?dir=${direction.key}&view=specimen`);
          await settle(page);
          await page
            .locator(".specimen")
            .screenshot({ ...SHOT, path: cell(`${direction.key}-specimen@${dsf}`) });
        }
        if (dsf === 1) {
          await page.goto(`${MOCKUP}?dir=a&view=specimen`);
          results.ink = await measureInk(page);
        }
      }
      if (dsf === 2) {
        // Sticky-header context: a 47 px simulated top inset, scrolled so
        // content passes beneath the sticky rows.
        await page.setViewportSize({ width: 390, height: 844 });
        const contextView =
          scheme === "light"
            ? { name: "settings-en", query: "selected=settings&lang=en", scroll: 300 }
            : { name: "routes-de", query: "selected=library&lang=de", scroll: 260 };
        for (const direction of DIRECTIONS) {
          await page.goto(
            `${MOCKUP}?dir=${direction.key}&${contextView.query}&view=context&inset=47&scroll=${contextView.scroll}`,
          );
          await settle(page);
          const scrolled = await page.evaluate(() => window.scrollY);
          if (scrolled < 100)
            throw new Error(`context view did not scroll (${scrolled})`);
          await page.screenshot({
            ...SHOT,
            path: cell(`${direction.key}-context-${contextView.name}@2`),
            clip: { x: 0, y: 0, width: 390, height: 460 },
          });
        }
      }
      await page.goto(`${MOCKUP}?dir=current`);
      results.tokens[scheme] = await readTokens(page);
      await context.close();
    }
  }
}

async function measureEngine(browser, engine) {
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      colorScheme: scheme,
    });
    const page = await context.newPage();
    for (const condition of CONDITIONS.filter((c) => c.scheme === scheme)) {
      await page.setViewportSize({ width: condition.width, height: 844 });
      for (const direction of DIRECTIONS) {
        for (const state of STATES) {
          await page.goto(url(direction.key, state, condition));
          await settle(page);
          for (const stress of [1, STRESS_FACTOR]) {
            await applyWidthStress(page, stress);
            results.measurements.push({
              engine,
              condition: condition.key,
              direction: direction.key,
              state: state.key,
              stress,
              ...(await measure(page)),
            });
          }
        }
      }
    }
    await context.close();
  }
}

/** The Planen refinement's cells: the options (and, at 2× in German, the
 * rejected sketches) with Planen selected and unselected, at 2× for the
 * review sheet and 3× for the phone-sized image. */
async function capturePlanOptions(browser) {
  for (const scheme of ["light", "dark"]) {
    for (const dsf of [2, 3]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: dsf,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      for (const condition of PLAN_CONDITIONS.filter((c) => c.scheme === scheme)) {
        const keys = [
          ...PLAN_OPTIONS.map((o) => o.key),
          ...(dsf === 2 && condition.lang === "de"
            ? PLAN_SKETCHES.map((k) => k.key)
            : []),
        ];
        for (const key of new Set(keys)) {
          for (const state of PLAN_STATES) {
            await page.goto(url(key, state, condition));
            await settle(page);
            await page.screenshot({
              ...SHOT,
              path: cell(`plan-${key}-${condition.key}-${state.key}@${dsf}`),
              clip: await stripClip(page),
            });
          }
        }
      }
      if (scheme === "light" && dsf === 2) {
        await page.setViewportSize({ width: 640, height: 844 });
        for (const option of PLAN_OPTIONS) {
          await page.goto(`${MOCKUP}?dir=${option.key}&view=specimen&lang=de`);
          await settle(page);
          await page
            .locator(".specimen")
            .screenshot({ ...SHOT, path: cell(`plan-${option.key}-specimen@2`) });
        }
      }
      await context.close();
    }
  }
}

/** Geometry for the options, with Current as the baseline, in one engine. */
async function measurePlanOptions(browser, engine) {
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      colorScheme: scheme,
    });
    const page = await context.newPage();
    for (const condition of PLAN_CONDITIONS.filter((c) => c.scheme === scheme)) {
      for (const key of ["current", ...PLAN_OPTIONS.map((o) => o.key)]) {
        for (const state of PLAN_STATES) {
          await page.goto(url(key, state, condition));
          await settle(page);
          for (const stress of [1, STRESS_FACTOR]) {
            await applyWidthStress(page, stress);
            results.planMeasurements.push({
              engine,
              condition: condition.key,
              direction: key,
              state: state.key,
              stress,
              ...(await measure(page)),
            });
          }
        }
      }
    }
    await context.close();
  }
}

// ---------------------------------------------------------------- sheets
const cellSrc = (name) => `/__cells/${name}.png`;
const SHEET_STYLE = `
  body { margin: 0; padding: 24px; background: #fff; color: #101010;
         font: 14px/1.4 system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.note { margin: 0 0 16px; color: #55575a; max-width: 1100px; }
  table { border-collapse: separate; border-spacing: 12px 10px; margin-left: -12px; }
  th { text-align: left; font-weight: 600; vertical-align: bottom; font-size: 13px; }
  th.row { vertical-align: top; width: 150px; padding-top: 2px; }
  td { vertical-align: top; padding: 0; }
  td img { display: block; outline: 1px solid #c8c8c8; }
  .grey img { filter: grayscale(1); }
  .ink { font-size: 12px; color: #55575a; margin-top: 4px; }
  .caption { font-size: 12px; color: #55575a; margin: 2px 0 6px; }
`;

async function imageSize(page, name) {
  return page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, cellSrc(name));
}

async function renderSheet(browser, html, file, dsf, width, style = SHEET_STYLE) {
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    deviceScaleFactor: dsf,
    colorScheme: "light",
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/__cells/`); // same origin as the cells (404 is fine)
  await page.setContent(
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">` +
      `<style>${style}</style></head><body>${html}</body></html>`,
  );
  await page.evaluate(() =>
    Promise.all([...document.images].map((image) => image.decode())),
  );
  await page.screenshot({ ...SHOT, path: file, fullPage: true });
  await context.close();
  results.sizes[path.basename(file)] = fs.statSync(file).size;
}

async function img(page, name, dsf, extra = "") {
  const [w, h] = await imageSize(page, `${name}@${dsf}`);
  return `<img src="${cellSrc(`${name}@${dsf}`)}" width="${w / dsf}" height="${h / dsf}" alt=""${extra}>`;
}

const inkLine = (direction, state) =>
  ["library", "riding", "planning", "settings"]
    .map((destination) => {
      const labels = {
        library: "Routes",
        riding: "Ride",
        planning: "Plan",
        settings: "Settings",
      };
      return `${labels[destination]} ${results.ink[direction][`${destination}:${state}`].coverage}%`;
    })
    .join(" · ");

const PROVENANCE =
  "Design mock-up for backlog item 102 — not production. Rendered by Chromium in the pinned " +
  "Playwright container (mcr.microsoft.com/playwright:v1.61.1-noble) with the app's own stylesheet " +
  "at 0.4.48; container fonts are not iOS fonts, so this is not evidence of fit on an iPhone.";

async function buildSheets(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/__cells/`);
  const provenance = PROVENANCE;

  // One matrix per direction: conditions as rows, the five states as columns.
  for (const direction of DIRECTIONS.filter((d) => d.key !== "current")) {
    let rows = "";
    for (const condition of CONDITIONS) {
      let cells = "";
      for (const state of STATES)
        cells += `<td>${await img(page, `${direction.key}-${condition.key}-${state.key}`, 1)}</td>`;
      rows += `<tr><th class="row">${describe(condition)}</th>${cells}</tr>`;
    }
    for (const [key, label] of [
      ["390-en", "Greyscale · 390 px · English"],
      ["390-en-dark", "Greyscale · 390 px · English · dark"],
    ]) {
      let cells = "";
      for (const state of STATES)
        cells += `<td>${await img(page, `${direction.key}-${key}-${state.key}`, 1)}</td>`;
      rows += `<tr class="grey"><th class="row">${label}</th>${cells}</tr>`;
    }
    rows +=
      `<tr><th class="row">Keyboard focus · Tab onto Plan (Routes selected)</th>` +
      `<td colspan="5">${await img(page, `${direction.key}-focus`, 1)}</td></tr>`;
    const head = `<tr><th></th>${STATES.map((s) => `<th>${s.label}</th>`).join("")}</tr>`;
    const html =
      `<h1>${direction.name} — every destination selected and unselected</h1>` +
      `<p class="note">${provenance} Shown at 1×; icon detail is in comparison.png at 2×. ` +
      `Greyscale rows remove colour to show the selected tab is still identifiable.</p>` +
      `<table>${head}${rows}</table>`;
    await renderSheet(
      browser,
      html,
      path.join(IMAGES, `direction-${direction.key}.png`),
      1,
      2240,
    );
  }

  // The compact comparison: directions as columns.
  let head = "<tr><th></th>";
  let specimens = `<tr><th class="row">Specimens: 22 px and 66 px, unselected and selected</th>`;
  for (const direction of DIRECTIONS) {
    head += `<th>${direction.name}</th>`;
    specimens +=
      `<td>${await img(page, `${direction.key}-specimen`, 2)}` +
      `<div class="ink">Ink at 3×, unselected: ${inkLine(direction.key, "base")}</div></td>`;
  }
  head += "</tr>";
  specimens += "</tr>";
  let strips = "";
  for (const [conditionKey, label] of [
    ["390-en", "390 px · English"],
    ["390-de", "390 px · German"],
  ]) {
    for (const state of STATES.slice(0, 4)) {
      strips += `<tr><th class="row">${label}<div class="caption">${state.label}</div></th>`;
      for (const direction of DIRECTIONS)
        strips += `<td>${await img(page, `${direction.key}-${conditionKey}-${state.key}`, 2)}</td>`;
      strips += "</tr>";
    }
  }
  strips += `<tr><th class="row">320 px · German · 200% text<div class="caption">Settings selected</div></th>`;
  for (const direction of DIRECTIONS)
    strips += `<td>${await img(page, `${direction.key}-320-de-200-settings`, 2)}</td>`;
  strips += "</tr>";
  await renderSheet(
    browser,
    `<h1>Item 102 — navigation symbols: Current and three directions</h1>` +
      `<p class="note">${provenance} Shown at 2×; the navigation strips show the icons at their actual 22 px size.</p>` +
      `<table>${head}${specimens}${strips}</table>`,
    path.join(IMAGES, "comparison.png"),
    2,
    1920,
  );

  // Sticky-header context: a simulated 47 px top inset, content scrolled beneath.
  let contextRows = "";
  for (const [name, label] of [
    [
      "settings-en",
      "Settings · English · light — the switcher stays stuck beneath the header",
    ],
    ["routes-de", "Routes · German · dark"],
  ]) {
    contextRows += `<tr><th class="row">${label}</th>`;
    for (const direction of DIRECTIONS)
      contextRows += `<td>${await img(page, `${direction.key}-context-${name}`, 2)}</td>`;
    contextRows += "</tr>";
  }
  await renderSheet(
    browser,
    `<h1>Item 102 — sticky-header context</h1>` +
      `<p class="note">${provenance} 390 × 844 viewport cropped to its top 460 px, with a 47 px simulated ` +
      `top safe-area inset (the black pill stands in for the status bar) and the page scrolled.</p>` +
      `<table><tr><th></th>${DIRECTIONS.map((d) => `<th>${d.name}</th>`).join("")}</tr>${contextRows}</table>`,
    path.join(IMAGES, "context.png"),
    2,
    1860,
  );
  await context.close();
}

const PHONE_STYLE = `
  body { margin: 0; background: #fff; color: #101010; font: 12px/1.35 system-ui, sans-serif; }
  .intro { padding: 10px 8px 4px; color: #55575a; }
  .group { padding: 14px 8px 2px; font-weight: 700; font-size: 13px; }
  .cap { padding: 6px 8px 3px; color: #55575a; font-weight: 600; }
  img { display: block; }
`;

async function buildPlanSheets(browser, provenance) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/__cells/`);
  const inkNote = (key) => {
    const ink = results.ink[key];
    return (
      `Ink at 3×, unselected: Plan ${ink["planning:base"].coverage}% beside ` +
      `Routes ${ink["library:base"].coverage}%, Ride ${ink["riding:base"].coverage}%, ` +
      `Settings ${ink["settings:base"].coverage}% · Routes–Plan overlap ${ink.routesPlanOverlap}`
    );
  };

  // The review sheet: options as columns, the 22 px navigation first.
  let rows = "";
  for (const [conditionKey, label] of [
    ["390-de", "390 px · German · light"],
    ["390-de-dark", "390 px · German · dark"],
    ["390-en", "390 px · English · light"],
  ]) {
    for (const state of PLAN_STATES) {
      rows += `<tr><th class="row">${label}<div class="caption">${state.label}</div></th>`;
      for (const option of PLAN_OPTIONS)
        rows += `<td>${await img(page, `plan-${option.key}-${conditionKey}-${state.key}`, 2)}</td>`;
      rows += "</tr>";
    }
  }
  rows += `<tr><th class="row">Specimens, enlarged for inspection only: 22 px and 66 px</th>`;
  for (const option of PLAN_OPTIONS)
    rows += `<td>${await img(page, `plan-${option.key}-specimen`, 2)}<div class="ink">${inkNote(option.key)}</div></td>`;
  rows += "</tr>";
  await renderSheet(
    browser,
    `<h1>Item 102 — Planen options beside A's Routen, Fahren and Einstellungen</h1>` +
      `<p class="note">${provenance} Shown at 2×. Judge the choice on the 22 px navigation strips; ` +
      `planen-options-phone.png shows them at true size on a 390-pt iPhone.</p>` +
      `<table><tr><th></th>${PLAN_OPTIONS.map((o) => `<th>${o.name}</th>`).join("")}</tr>${rows}</table>`,
    path.join(IMAGES, "planen-options.png"),
    2,
    1760,
  );

  // The phone-sized image: exactly 390 CSS px wide at 3× (1170 px), so on a
  // 390-pt iPhone, fitted to the screen width, the icons are at true size.
  let phone =
    `<div class="intro">Item 102 · Planen options (design mock-up, not the app). ` +
    `Fit to the width of a 390-pt iPhone to see true size.</div>`;
  for (const [conditionKey, label] of [
    ["390-de", "Light"],
    ["390-de-dark", "Dark"],
  ]) {
    for (const state of PLAN_STATES) {
      phone += `<div class="group">${label} · ${state.label}</div>`;
      for (const option of PLAN_OPTIONS)
        phone +=
          `<div class="cap">${option.name}</div>` +
          (await img(page, `plan-${option.key}-${conditionKey}-${state.key}`, 3));
    }
  }
  await renderSheet(
    browser,
    phone,
    path.join(IMAGES, "planen-options-phone.png"),
    3,
    390,
    PHONE_STYLE,
  );

  // The rejected sketches for option 2, so the reasoning can be checked.
  let sketches = "";
  for (const { key, name } of PLAN_SKETCHES) {
    const ink = results.ink[key];
    sketches +=
      `<tr><th class="row">${name}<div class="caption">Plan ink ${ink["planning:base"].coverage}% · ` +
      `Routes–Plan overlap ${ink.routesPlanOverlap}</div></th>`;
    for (const [conditionKey, stateIndex] of [
      ["390-de", 1],
      ["390-de", 0],
      ["390-de-dark", 1],
    ])
      sketches += `<td>${await img(page, `plan-${key}-${conditionKey}-${PLAN_STATES[stateIndex].key}`, 2)}</td>`;
    sketches += "</tr>";
  }
  await renderSheet(
    browser,
    `<h1>Item 102 — continuous-line Planen sketches</h1>` +
      `<p class="note">${provenance} Every continuous 2 px line through the current path's course read ` +
      `as a chart, a connector or a letter at 22 px; the last row keeps the current dotted trail at A's weight.</p>` +
      `<table><tr><th></th><th>German · light · Planen unselected</th><th>German · light · Planen selected</th>` +
      `<th>German · dark · Planen unselected</th></tr>${sketches}</table>`,
    path.join(IMAGES, "planen-sketches.png"),
    2,
    1440,
  );
  await context.close();
}

// ---------------------------------------------------------------- report
function report() {
  const lines = [];
  const byKey = (m) => `${m.engine}|${m.condition}|${m.state}|${m.stress}`;
  const baseline = new Map(
    results.measurements
      .filter((m) => m.direction === "current")
      .map((m) => [byKey(m), m]),
  );
  const deviation = (m, against = baseline) => {
    const b = against.get(byKey(m));
    let max = 0;
    [...m.tabs, ...m.switcher].forEach((button, i) => {
      const other = [...b.tabs, ...b.switcher][i];
      for (const field of ["rect", "text", "icon"]) {
        if (!button[field]) continue;
        button[field].forEach(
          (v, j) => (max = Math.max(max, Math.abs(v - other[field][j]))),
        );
      }
    });
    return max;
  };
  lines.push(
    "| Engine | Condition | Stress | Page overflow | Header + switcher overflow | Labels or icons outside their button | Max label lines (tabs) | Min tab w × h | Min switcher h | Max deviation from Current |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const engine of ["chromium", "webkit"]) {
    for (const condition of CONDITIONS) {
      for (const stress of [1, STRESS_FACTOR]) {
        const rows = results.measurements.filter(
          (m) =>
            m.engine === engine && m.condition === condition.key && m.stress === stress,
        );
        const tabs = rows.flatMap((m) => m.tabs);
        const switchers = rows.flatMap((m) => m.switcher);
        lines.push(
          `| ${engine} | ${describe(condition)} | ${stress} | ${Math.max(...rows.map((m) => m.documentOverflow))} | ` +
            `${Math.max(...rows.map((m) => m.chromeOverflow))} | ` +
            `${[...tabs, ...switchers].filter((t) => !t.labelInside || !t.iconInside).length} | ` +
            `${Math.max(...tabs.map((t) => t.lines))} | ` +
            `${Math.min(...tabs.map((t) => t.rect[2])).toFixed(1)} × ${Math.min(...tabs.map((t) => t.rect[3])).toFixed(1)} | ` +
            `${switchers.length ? Math.min(...switchers.map((t) => t.rect[3])).toFixed(1) : "—"} | ` +
            `${Math.max(...rows.map((m) => deviation(m))).toFixed(2)} |`,
        );
      }
    }
  }
  lines.push("");
  lines.push(
    "| Direction | State | Routes | Ride | Plan | Settings | Max / min | Ink bbox inside 0–24 |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const direction of DIRECTIONS) {
    for (const state of ["base", "selected"]) {
      const values = ["library", "riding", "planning", "settings"].map(
        (d) => results.ink[direction.key][`${d}:${state}`],
      );
      const coverages = values.map((v) => v.coverage);
      const inside = values.every(
        (v) => v.bbox[0] >= 0 && v.bbox[1] >= 0 && v.bbox[2] <= 24 && v.bbox[3] <= 24,
      );
      lines.push(
        `| ${direction.name} | ${state === "base" ? "unselected" : "selected"} | ${coverages.map((c) => `${c}%`).join(" | ")} | ` +
          `${(Math.max(...coverages) / Math.min(...coverages)).toFixed(2)} | ${inside ? "yes" : "NO"} |`,
      );
    }
  }
  lines.push("");
  lines.push(
    "| Scheme | Unselected icon on page | Selected icon on selected surface | Ring on page | Selected surface on page |",
  );
  lines.push("| --- | --- | --- | --- | --- |");
  for (const scheme of ["light", "dark"]) {
    const t = results.tokens[scheme];
    lines.push(
      `| ${scheme} | ${contrast(t["--colour-text"], t["--colour-bg"])}:1 | ` +
        `${contrast(t["--colour-accent"], t["--colour-accent-soft"])}:1 | ` +
        `${contrast(t["--colour-accent"], t["--colour-bg"])}:1 | ` +
        `${contrast(t["--colour-accent-soft"], t["--colour-bg"])}:1 |`,
    );
  }
  lines.push("");
  const planBaseline = new Map(
    results.planMeasurements
      .filter((m) => m.direction === "current")
      .map((m) => [byKey(m), m]),
  );
  lines.push(
    "| Planen option | Engine | Max deviation from Current | Header + switcher overflow | Labels or icons outside their button | Narrowest tab w × h |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const option of PLAN_OPTIONS) {
    for (const engine of ["chromium", "webkit"]) {
      const rows = results.planMeasurements.filter(
        (m) => m.engine === engine && m.direction === option.key,
      );
      const tabs = rows.flatMap((m) => m.tabs);
      lines.push(
        `| ${option.name} | ${engine} | ${Math.max(...rows.map((m) => deviation(m, planBaseline))).toFixed(2)} | ` +
          `${Math.max(...rows.map((m) => m.chromeOverflow))} | ` +
          `${tabs.filter((t) => !t.labelInside || !t.iconInside).length} | ` +
          `${Math.min(...tabs.map((t) => t.rect[2])).toFixed(1)} × ${Math.min(...tabs.map((t) => t.rect[3])).toFixed(1)} |`,
      );
    }
  }
  lines.push("");
  lines.push(
    "| Planen set | Routes | Ride | Plan | Settings | Max / min | Plan ink bbox | Routes–Plan overlap |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  const planSets = [
    ...PLAN_OPTIONS,
    ...PLAN_SKETCHES.filter((sketch) => sketch.key !== "a-p2"),
  ];
  for (const { key, name } of planSets) {
    const ink = results.ink[key];
    const coverages = ["library", "riding", "planning", "settings"].map(
      (d) => ink[`${d}:base`].coverage,
    );
    lines.push(
      `| ${name} | ${coverages.map((c) => `${c}%`).join(" | ")} | ` +
        `${(Math.max(...coverages) / Math.min(...coverages)).toFixed(2)} | ` +
        `${ink["planning:base"].bbox.join(", ")} | ${ink.routesPlanOverlap} |`,
    );
  }
  lines.push("");
  lines.push("| Image | Bytes |");
  lines.push("| --- | --- |");
  for (const [name, bytes] of Object.entries(results.sizes))
    lines.push(`| ${name} | ${bytes} |`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- run
try {
  const chromiumBrowser = await chromium.launch();
  await captureCells(chromiumBrowser);
  await measureEngine(chromiumBrowser, "chromium");
  await capturePlanOptions(chromiumBrowser);
  await measurePlanOptions(chromiumBrowser, "chromium");
  const webkitBrowser = await webkit.launch();
  await measureEngine(webkitBrowser, "webkit");
  await measurePlanOptions(webkitBrowser, "webkit");
  await webkitBrowser.close();
  await buildSheets(chromiumBrowser);
  await buildPlanSheets(chromiumBrowser, PROVENANCE);
  await chromiumBrowser.close();
  fs.writeFileSync(
    path.join(SCRATCH, "measurements.json"),
    JSON.stringify(results, null, 1),
  );
  const markdown = report();
  fs.writeFileSync(path.join(SCRATCH, "report.md"), `${markdown}\n`);
  console.log(markdown);
} finally {
  server.close();
}
