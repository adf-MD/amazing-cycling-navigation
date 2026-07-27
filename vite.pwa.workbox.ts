// Kept in its own tiny, side-effect-free module (rather than inline in
// vite.config.ts) so it can be imported directly by a unit test without
// that test needing to evaluate defineConfig()/VitePWA() themselves — see
// src/routing/serviceWorkerExclusion.test.ts.
export const workboxOptions = {
  // Application shell only: no personal data, no routed API/tile
  // responses are ever precached. No runtimeCaching rules exist either —
  // OpenRouteService requests must never be served from, written to, or
  // replaced by this service worker's caches.
  globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
};
