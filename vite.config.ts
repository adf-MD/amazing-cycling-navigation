/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };
import { workboxOptions } from "./vite.pwa.workbox.ts";
import { resolveBuildId } from "./vite.buildId.ts";
import { cspPlugin } from "./vite.csp.ts";

// GitHub Pages project site: https://<user>.github.io/amazing-cycling-navigation/
// Kept as a single literal so dev, build, manifest and service-worker scope
// can never disagree about where the app is served from.
export const BASE_PATH = "/amazing-cycling-navigation/";

// Set by the deploy workflow's Build step (APP_BUILD_SHA: ${{ github.sha }});
// absent locally and in every other CI step, so local/dev builds and
// `npm test` both see "dev" — see vite.buildId.ts for the exact SHA and
// whitespace validation policy.
const BUILD_ID = resolveBuildId(process.env.APP_BUILD_SHA);

export default defineConfig({
  base: BASE_PATH,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    cspPlugin(),
    react(),
    VitePWA({
      // Never auto-activate a new service worker; the UI shows an
      // explicit, user-controlled update prompt instead (see src/pwa).
      registerType: "prompt",
      includeAssets: ["favicon.ico", "logo.svg", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "Amazing Cycling Navigation",
        short_name: "ACN",
        description: "Private-use route planning and riding for road cyclists.",
        start_url: BASE_PATH,
        scope: BASE_PATH,
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#0a5f38",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: workboxOptions,
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    restoreMocks: true,
    // e2e/ holds Playwright specs, run separately via `npm run e2e`, not
    // Vitest's own test collection (its default glob also matches
    // *.spec.ts). Repeats Vitest's own defaults alongside it, since
    // supplying `exclude` replaces rather than extends them.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{vite,vitest}.config.*.timestamp-*",
      "e2e/**",
    ],
    coverage: {
      provider: "v8",
      // By default coverage.include only counts files a test actually
      // imports; an explicit include also counts untested production
      // files as 0%, so this is deliberately wider than the ordinary
      // test.exclude above and isn't reused from it.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/test/**",
        // Pure Vite entry glue (DOM root mount): no branch logic worth
        // unit testing; exercised instead by the e2e app-shell smoke.
        "src/main.tsx",
      ],
      // Risk-based aggregate floors for the highest-consequence
      // directories only (untrusted-input parsing, persistence,
      // navigation/off-route logic) — deliberately no global threshold
      // and no perFile, so this can't silently become a blanket gate.
      // See docs/project/history/items-89-NN.md for how these figures
      // were measured.
      thresholds: {
        "src/gpx/**": { statements: 99, branches: 90, functions: 100, lines: 99 },
        "src/storage/**": { statements: 96, branches: 93, functions: 97, lines: 96 },
        "src/navigation/**": { statements: 93, branches: 86, functions: 99, lines: 96 },
      },
    },
  },
});
