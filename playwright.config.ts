import { defineConfig, devices } from "@playwright/test";

// Must match vite.config.ts's BASE_PATH — kept as a separate literal
// rather than importing vite.config.ts, so Playwright's config loader
// never has to resolve Vite/PWA-plugin config as a side effect.
const BASE_PATH = "/amazing-cycling-navigation/";
const PORT = 4173;
const BASE_URL = `http://localhost:${String(PORT)}${BASE_PATH}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: {
    baseURL: BASE_URL,
  },
  webServer: {
    command: `npm run preview -- --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // Android-emulated specs (see the "android-chrome" project below)
      // run once each, not twice — excluded here so this project and
      // that one never both execute the same file.
      testIgnore: /android.*\.spec\.ts$/,
    },
    {
      name: "android-chrome",
      // Chromium-based mobile viewport/UA/touch/device-scale-factor
      // emulation of a current mainstream Android phone (Android 10+,
      // per this preset) — this is still Chromium, not real Android
      // Chrome or WebView, and needs no separate browser download
      // (devices["Pixel 7"].defaultBrowserType is "chromium", already
      // installed by `playwright install chromium`). See
      // docs/android-chrome-acceptance.md for what this can and cannot
      // prove versus a real installed Android device.
      use: { ...devices["Pixel 7"] },
      testMatch: /android.*\.spec\.ts$/,
    },
  ],
});
