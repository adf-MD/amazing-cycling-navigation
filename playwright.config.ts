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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
