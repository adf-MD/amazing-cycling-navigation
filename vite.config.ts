/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

// GitHub Pages project site: https://<user>.github.io/amazing-cycling-navigation/
// Kept as a single literal so dev, build, manifest and service-worker scope
// can never disagree about where the app is served from.
export const BASE_PATH = "/amazing-cycling-navigation/";

export default defineConfig({
  base: BASE_PATH,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
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
      workbox: {
        // Application shell only: no personal data, no routed API/tile
        // responses are ever precached.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
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
  },
});
