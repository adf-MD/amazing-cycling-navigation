import { expect, test } from "@playwright/test";

// Proves the actual *built* PWA artefacts (CLAUDE.md backlog item 25) —
// deliberately a build-output check against the real running preview
// server, not a config-level unit test: only the served output can prove
// Vite's base-path rewriting, and that the two independently maintained
// BASE_PATH literals (vite.config.ts, playwright.config.ts — kept
// separate on purpose, so Playwright's config loader never has to
// resolve Vite/PWA-plugin config as a side effect) haven't drifted from
// what's actually served. Runs under the default "chromium" project —
// this content doesn't depend on device emulation.

const BASE_PATH = "/amazing-cycling-navigation/";

test("the built manifest, served HTML and service-worker registration are all correctly scoped under the GitHub Pages base path", async ({
  page,
  baseURL,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  if (!baseURL) throw new Error("expected playwright.config.ts's baseURL to be set");
  const origin = new URL(baseURL).origin;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();

  const manifestResponse = await page.request.get(
    `${origin}${BASE_PATH}manifest.webmanifest`,
  );
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as {
    start_url: string;
    scope: string;
    display: string;
    icons: { src: string }[];
  };
  expect(manifest.start_url).toBe(BASE_PATH);
  expect(manifest.scope).toBe(BASE_PATH);
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBeGreaterThan(0);

  for (const icon of manifest.icons) {
    const iconUrl = new URL(icon.src, `${origin}${BASE_PATH}`).toString();
    const iconResponse = await page.request.get(iconUrl);
    expect(iconResponse.ok()).toBe(true);
  }

  // The served HTML never references a root-relative URL that escapes
  // the GitHub Pages sub-path — every href/src naming a local resource
  // must be prefixed with BASE_PATH, not a bare "/".
  const html = await page.content();
  const escapingUrls = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)]
    .map((match) => match[1])
    .filter((url) => !url.startsWith(BASE_PATH));
  expect(escapingUrls).toEqual([]);

  const manifestLinkHref = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  expect(manifestLinkHref).toBe(`${BASE_PATH}manifest.webmanifest`);

  // The installed service worker's own registration scope. Registration
  // happens automatically on mount (src/pwa/registerSW.ts), so poll for
  // it rather than assume it has already resolved.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.scope ?? null;
        }),
      { timeout: 10_000 },
    )
    .toBe(`${origin}${BASE_PATH}`);

  expect(consoleErrors).toEqual([]);
});
