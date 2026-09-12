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
  // Backlog item 116. Item 32's investigation had to build its own
  // instrumentation from scratch because a failed run left nothing behind
  // but the list reporter's error text. These two settings are the whole
  // remedy, and they are deliberately the only ones.
  //
  // Why the trace is scoped to CI rather than enabled everywhere — measured,
  // not assumed. `retain-on-failure` records a trace for EVERY run and keeps
  // it only for the failures, so recording is paid on every passing test
  // too: the full suite in the pinned container went 58.7/59.4/58.9s to
  // 72.5/72.4s at this machine's default 36 workers (+23%), and 240.9s to
  // 308.3s at --workers=4 (+28%). Consistent at both concurrencies, so it is
  // a genuine per-test cost, not contention. Screenshot capture on its own
  // costs about 4% (61.1/61.4s) because `only-on-failure` captures nothing
  // while a test is passing.
  //
  // The asymmetry that settles it: a local failure leaves test-results/ on
  // disk and can simply be re-run with
  //   npm run e2e -- --trace retain-on-failure
  // whereas CI's container is discarded when the job ends, so a CI-only
  // failure has no second chance. CI therefore pays the recording cost and
  // ordinary local runs do not. The E2E job's own timeout is deliberately
  // NOT raised for this: if that job later approaches the limit it should be
  // optimised or sharded, not given a bigger budget.
  //
  // Two details worth keeping: `on-first-retry` would capture nothing at all
  // here, because this repository runs at `retries: 0` — and adding retries
  // purely to make a trace mode work would hide the very flakiness a trace
  // exists to explain. And the two mode unions are NOT interchangeable:
  // `only-on-failure` is a ScreenshotMode and is invalid for `trace`;
  // `retain-on-failure` is a TraceMode and is invalid for `screenshot`. Both
  // values were checked against the installed 1.61.1 types.
  //
  // Deliberately NOT enabled: `video`, which costs far more storage and
  // processing than a trace plus a screenshot and was not needed to diagnose
  // anything item 32 turned up; and an HTML reporter, since `npx playwright
  // show-trace <trace.zip>` opens a trace directly. Artefacts land in the
  // default outputDir (`test-results/`, already gitignored); a passing run
  // leaves 12K there, a single captured failure about 1.5MB.
  use: {
    baseURL: BASE_URL,
    trace: process.env.CI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
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
    {
      // A deliberately small WebKit smoke, not full parity with the
      // chromium project — see item 89's history entry for the
      // feasibility evidence and why this scope was chosen. This is a
      // desktop WebKit engine check, not installed-iPhone/Safari-PWA
      // acceptance: it cannot reproduce Home Screen PWA lifecycle,
      // suspension/reload recovery or touch-specific gesture behaviour.
      name: "webkit-smoke",
      use: { ...devices["Desktop Safari"] },
      testMatch: /smoke\.spec\.ts$/,
    },
  ],
});
