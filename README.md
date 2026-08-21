# Amazing Cycling Navigation

Amazing Cycling Navigation (ACN) is a personal, non-commercial progressive web app for planning
and riding road-bike routes. It's built iPhone-first, with Android Chrome supported through the
same capability-detected codebase, and ships as a static client-side app deployed to GitHub Pages.
See [`CLAUDE.md`](./CLAUDE.md) for the full product and engineering specification that governs
this repository.

## Current capabilities

ACN has two modes — Planning and Riding — sharing one local route library.

### Planning

- Place, insert, move, reorder and delete waypoints on a map, with undo/redo and an explicit
  "return to start" action for closing a loop.
- Route via OpenRouteService, choosing between **Road bike** (`cycling-road`) and
  **General cycling** (`cycling-regular`) profiles. Only the route legs that actually changed are
  recalculated, and results are cached per profile.
- A locally configured ferry-avoidance default, set in Settings and shown as read-only per plan.
- Distance, ascent, descent, elevation profile, surface classification and route warnings (steps,
  fords, ferries, construction, questionable/unsuitable/unknown surface) before saving.
- Recognised climb and descent features, categorised in a Garmin-ClimbPro-inspired style, shown on
  both the map and the elevation chart.
- The in-progress draft is recovered automatically after a reload, and Save/Export are disabled
  whenever the routed result is stale relative to the current waypoints, profile or ferry setting.
- Local save and GPX export. An existing saved or imported route can be opened as an **editable
  copy**, or a **reversed copy**, seeding a fresh Planning draft without touching the original.

### Route Library and GPX

- Local GPX import and export, parsed with `DOMParser` and validated before use; tracks are
  preferred over routes when a file has both.
- Saved and imported routes work fully offline once stored — no routing provider or network access
  is needed to reopen or ride them.
- Rename, delete, search (by name) and pin routes in the library; sort by most recent or name.
- An optional, namespaced ACN GPX extension round-trips trusted manoeuvres and exact Planning
  waypoint provenance for routes exported and reimported through ACN itself. The file otherwise
  stays a plain, standards-compatible GPX 1.1 track that any other reader can open, ignoring the
  extension.

### Riding

- Live GPS projection onto the route while the page is visible, with progress continuity through
  self-intersections and out-and-back sections, stale-fix handling, and off-route classification.
- Completed/remaining route rendering, direction arrows, and kilometre distance badges.
- An elevation chart with **Full / 2 km / 5 km / 10 km** windows, plus a **Climb** view that opens
  automatically while riding through a recognised climb.
- A trusted next-manoeuvre panel (distance, instruction, direction icon) wherever manoeuvre
  provenance actually permits it — never inferred from geometry alone.
- Follow-location and North-up camera controls, and an optional Screen Wake Lock where the browser
  supports it.
- Ride state — route, GPS fix, progress, camera and view preferences — persists locally and
  recovers after the PWA is suspended, backgrounded or reloaded.
- An explicit **End ride** action, and a conservatively-detected, rider-confirmed **Finish ride**
  action; both clear only navigation progress, never the saved route itself.
- A neutral fallback background keeps the route, position and elevation usable if map tiles are
  unavailable.
- A route-less **Free roam** mode from the idle Ride launcher: live position and camera follow with
  no selected route, no route line, and no OpenRouteService dependency. An unfinished route session
  and an unfinished free-roam session can't silently replace one another.

Automatic rerouting, spoken directions, background location tracking, ride recording/history,
Bluetooth sensors, accounts, cloud sync, full offline map downloads, and weather are deliberately
out of scope for now — see "Future backlog" and "Explicit non-goals" in
[`CLAUDE.md`](./CLAUDE.md).

## Platform, privacy and limitations

- The iPhone Home Screen PWA is the primary target. Android 10+ running current stable Chrome for
  Android is also a supported target, through the same capability-detected code — there is no
  user-agent branching and no separate Android build.
- ACN is a static client-side app with no backend of its own, deployed to GitHub Pages over HTTPS.
- No accounts, analytics, telemetry or external error reporting. Imported/planned routes, ride
  state and your OpenRouteService key stay in this browser's IndexedDB unless you explicitly
  export them.
- Riding-mode GPS coordinates are never sent anywhere. Planning waypoints and your OpenRouteService
  key are sent only to HeiGIT, and only when you explicitly calculate a route — see
  [OpenRouteService setup](#openrouteservice-setup) below.
- No licence is included; this repository is intentionally unlicensed.

**Automated evidence vs. real-device acceptance.** The Playwright suite drives a real production
build under two projects: desktop Chromium, and Chromium's Pixel 7 device emulation for Android.
The Android project proves mobile viewport/UA/touch behaviour under a real Chromium engine — it is
**not** a real Android phone or WebView, and does not substitute for one. iOS-specific behaviour
(installation, background suspension, on-bike GPS) and genuine Android-hardware behaviour both
still need manual, real-device acceptance.
[`docs/project/current-status.md`](./docs/project/current-status.md)'s "Manual acceptance status"
ledger (summarised in `CLAUDE.md`) is the authoritative record of what has actually been confirmed
that way, including bicycle field tests that remain outstanding — do not treat automated coverage
alone as field verification.

**Known limitations:**

- Distances use the Haversine formula on a sphere, a small approximation of the true WGS84
  ellipsoid geodesic.
- Moving a waypoint is select-then-relocate (tap, then place), not a draggable map marker.
- Route warnings and surface detail are not exported to GPX — only trusted manoeuvres and
  routing/profile/waypoint provenance travel through the ACN GPX extension.
- OpenRouteService does not expose a road-access-restriction extra for the `cycling-road` profile,
  so `access` warnings are never produced.
- The default tile source is [OpenFreeMap](https://openfreemap.org) Liberty; swap it via
  `src/map/tileSource.ts` if needed.
- Ride state is persisted to IndexedDB on every accepted GPS fix rather than being time-throttled
  — a deliberate, cheap-write simplification.
- A number of thresholds (off-route classification, low-zoom route/marker legibility, climb and
  route-completion detection) are reasoned starting points rather than values tuned against real
  ride data; see the relevant completed items in
  [`docs/project/history/`](./docs/project/history/README.md) for their rationale and status.

## OpenRouteService setup

Road-bike route calculation uses [OpenRouteService](https://openrouteservice.org) (hosted by
[HeiGIT](https://heigit.org)). This needs your own free key — the app never ships or proxies one.

1. Open **Settings** in the app and follow the link to
   [sign up for a HeiGIT account](https://account.heigit.org/signup).
2. Copy the API key from your HeiGIT account dashboard and paste it into Settings.

What this means in practice:

- The key is stored only in this browser's IndexedDB, never bundled into the app's source. It is
  **not encrypted** — that keeps it out of the repository, not secret from other JavaScript
  running on the same site. Clearing your browser's site data removes it; Settings also has
  "Replace key" and "Delete key" actions.
- Your key and placed waypoints are sent directly to HeiGIT only when you calculate a route.
  Riding GPS is never sent to HeiGIT or any other server.
- Placing, moving, reordering and deleting waypoints, undo/redo, and an unsaved draft all work
  without a key — only the "Calculate route" step needs one. A route you've already saved or
  exported needs no key to reopen, ride, or re-export.
- The current endpoint is `https://api.heigit.org/openrouteservice/v2`; the older
  `api.openrouteservice.org` host is deprecated and never used here.

## Local development

Requires Node.js and npm at the exact versions pinned in [`.nvmrc`](./.nvmrc) and `package.json`'s
`packageManager` field — CI fails immediately if the resolved versions don't match.

```bash
npm install
npm run dev
```

The dev server serves the app under its GitHub Pages base path even locally
(`http://localhost:5173/amazing-cycling-navigation/`), so the base-path configuration is exercised
the same way in development as in production — visiting the bare `http://localhost:5173/` will
redirect there.

## Verification

| Script                 | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `npm run dev`          | Start the Vite dev server.                                 |
| `npm run build`        | Type-check and produce a production build in `dist/`.      |
| `npm run preview`      | Serve the production build locally (matches GitHub Pages). |
| `npm run lint`         | ESLint over the whole project.                             |
| `npm run format`       | Prettier, writing changes.                                 |
| `npm run format:check` | Prettier, check only (used in CI).                         |
| `npm run typecheck`    | `tsc -b --noEmit` across the app and tooling configs.      |
| `npm test`             | Vitest unit/component tests (single run).                  |
| `npm run test:watch`   | Vitest in watch mode.                                      |
| `npm run e2e`          | Playwright end-to-end tests against a production build.    |

**Unit and component tests** (Vitest + Testing Library + `fake-indexeddb`) cover GPX parsing,
validation and export; distance, elevation and gradient calculations; GPS-to-route projection,
off-route and route-completion classification; IndexedDB repositories; and every UI screen.

**End-to-end tests** (Playwright) drive a real browser against the production build across two
projects — desktop Chromium, and Chromium's Pixel 7 emulation for Android (see
[Platform, privacy and limitations](#platform-privacy-and-limitations) above for what that does
and doesn't prove). Together they cover GPX import/export, Planning under both cycling profiles
plus the edit-copy/reverse-route flows, the route library (search/sort/pin), active Riding (camera
controls, next-manoeuvre, climb view, wake lock, finish/end ride), free roam, sticky navigation, the
PWA manifest and service-worker scope, and Android-emulated layout/persistence/offline behaviour. See
[`docs/android-chrome-acceptance.md`](./docs/android-chrome-acceptance.md) for the Android-specific
acceptance checklist.

```bash
npm run build                    # e2e tests run against dist/, not the dev server
npx playwright install chromium  # first time only — covers both Playwright projects
npm run e2e
```

## Architecture

Source is organised by concern under `src/`, matching `CLAUDE.md`'s architecture list:

- `domain/` — provider-independent route, elevation, manoeuvre, waypoint and provenance types.
- `gpx/` — parsing, validation, normalisation and export, including the ACN GPX extension.
- `routing/` — the `RoutingProvider` interface and the OpenRouteService/HeiGIT adapter, offering
  both the `cycling-road` and `cycling-regular` profiles behind one provider-independent interface.
- `navigation/` — distance, elevation smoothing and gradient analysis, GPS-to-route projection,
  off-route and route-completion classification, and upcoming-elevation window selection.
- `storage/` — the versioned Dexie schema and repositories for routes, ride state, the provider
  key, Planning drafts, and library/planning preferences.
- `pwa/` — service-worker update lifecycle.
- `map/` — MapLibre presentation: route, progress, position, tile source, waypoint markers, and
  the direction-arrow/distance-badge overlays.
- `platform/` — small DI wrappers around geolocation, the clock, online status, service-worker
  status, geolocation permission and the local redacted error log, so core logic is testable
  without a browser.
- `ui/` — the five screens (route library, riding, planning, settings, diagnostics) and shared
  components.

The UI depends only on the domain model in `domain/types.ts`, never directly on a provider
response shape.

## Project documentation

This README is a snapshot of current capabilities. [`CLAUDE.md`](./CLAUDE.md) is the authoritative
specification governing all future work on this repository — durable product requirements,
architecture rationale, and documented algorithms and thresholds. The complete slice-by-slice
implementation and decision record, the full manual acceptance ledger, and the future backlog now
live in [`docs/project/`](./docs/project/README.md), split into bounded files linked from
`CLAUDE.md` itself; start at [`docs/project/README.md`](./docs/project/README.md) for the map.
[`docs/android-chrome-acceptance.md`](./docs/android-chrome-acceptance.md) holds the Android-
specific acceptance checklist and its automated/real-device tagging.

## Deploying to GitHub Pages

The included workflow ([`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml))
runs on every push to `main` (or manually via the Actions tab): install, format/lint/typecheck,
unit tests, build, end-to-end tests, then deploy — a failing check or test blocks deployment.

One-time setup: push this repository to GitHub, then under **Settings → Pages → Build and
deployment → Source**, select **GitHub Actions**. The workflow already targets the correct base
path (`/amazing-cycling-navigation/`).

To confirm an installed PWA has picked up a given deployment, compare its Diagnostics screen's
**Build** field (the deployed commit's short SHA) against the corresponding successful workflow
run in the Actions tab — useful since a service worker update can otherwise lag behind what's
actually live.
