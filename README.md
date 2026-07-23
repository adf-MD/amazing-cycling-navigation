# Amazing Cycling Navigation

A private-use, iPhone-first progressive web app for planning and riding road-bike
routes. See [`CLAUDE.md`](./CLAUDE.md) for the full product and engineering
specification, which governs any future work on this repository.

## Status

**Milestone 1 (Foundation)** and **Milestone 2 (GPX Riding core)** are implemented:
importing a GPX file, viewing it on a map with an elevation profile, saving it
locally, and riding it with live GPS projection, off-route detection, and
suspend/resume recovery. Planning mode (waypoint editing, route calculation via an
openrouteservice adapter) is **not** implemented yet — that's Milestone 3. The
provider-independent `RoutingProvider` interface and surface/warning domain types
already exist so Planning mode can slot in later without reworking the domain
model.

## Requirements

- Node.js 24.x (pinned in [`.nvmrc`](./.nvmrc)) and npm.

## Getting started

```bash
npm install
npm run dev
```

The dev server serves the app under its GitHub Pages base path even locally
(`http://localhost:5173/amazing-cycling-navigation/`), so the base-path
configuration is exercised the same way in development as in production —
visiting the bare `http://localhost:5173/` will redirect there.

## Available scripts

| Script                 | Purpose                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `npm run dev`          | Start the Vite dev server.                                    |
| `npm run build`        | Type-check and produce a production build in `dist/`.         |
| `npm run preview`      | Serve the production build locally (matches GitHub Pages).    |
| `npm run lint`         | ESLint over the whole project.                                |
| `npm run format`       | Prettier, writing changes.                                    |
| `npm run format:check` | Prettier, check only (used in CI).                            |
| `npm run typecheck`    | `tsc -b --noEmit` across the app and tooling configs.         |
| `npm test`             | Vitest unit/component tests (single run).                     |
| `npm run test:watch`   | Vitest in watch mode.                                         |
| `npm run e2e`          | Playwright smoke test against a production build (see below). |

## Testing

**Unit and component tests** (Vitest + Testing Library + `fake-indexeddb`) cover
GPX parsing/validation/export, distance and elevation calculations, GPS
projection and off-route classification, IndexedDB repositories, and all major
UI screens. Run with `npm test`.

**End-to-end smoke test** (Playwright, Chromium only) drives the app through a
real browser against the production build: the shell loads with no console
errors, and a GPX file can be imported, opened into Riding mode, and shows
either the rendered map or the explicit tile-unavailable state. It intentionally
does not test iOS Safari-specific behaviour (PWA install, background
suspension) — that can't be automated and must be checked manually on a real
iPhone.

```bash
npm run build              # the e2e test runs against dist/, not the dev server
npx playwright install chromium   # first time only
npm run e2e
```

## Architecture

Source is organised by concern under `src/`, matching `CLAUDE.md`'s
architecture list:

- `domain/` — provider-independent route, elevation, and waypoint types.
- `gpx/` — parsing, validation, normalisation and export.
- `routing/` — the `RoutingProvider` interface (no adapter yet — Milestone 3).
- `navigation/` — distance, elevation smoothing, GPS-to-route projection,
  off-route classification, upcoming-elevation window selection.
- `storage/` — the versioned Dexie schema, repositories, and the mapping
  between persisted and in-memory ride-navigation state.
- `pwa/` — service-worker update lifecycle.
- `map/` — MapLibre presentation (route, progress, position, tile source).
- `platform/` — small DI wrappers around geolocation, the clock, online
  status, service-worker status, geolocation permission, and the local
  redacted error log, so core logic is testable without a browser.
- `ui/` — the three screens (route library, riding, diagnostics) and shared
  components.

The UI depends only on the domain model in `domain/types.ts`, never directly
on a provider response shape.

## Documented algorithms and thresholds

### Distance

Haversine formula on a sphere of the IUGG mean Earth radius (6,371,008.8 m),
used consistently for point-to-point deltas, cumulative/total route distance,
and distance remaining (`src/navigation/distance.ts`). This is a small,
accepted approximation of the true WGS84 ellipsoid geodesic distance — within
a fraction of a percent for recreational route lengths.

### Elevation smoothing and ascent/descent (`src/navigation/elevation.ts`)

1. Raw imported elevations are never modified — the elevation chart always
   plots them as-is, with gaps shown explicitly where a point has no
   elevation.
2. For ascent/descent only: resample onto a fixed 20 m distance step by
   linear interpolation between known elevation points. A run of missing
   elevation at the very start or end of the route is flat-extrapolated from
   the nearest known value, since there's no bracketing pair to interpolate
   between there.
3. Apply a centred 5-sample (~100 m) moving average.
4. Ascent/descent is computed with a reversal-detection algorithm: track the
   running extremum since the last confirmed direction change, and only bank
   an ascent or descent once the smoothed elevation has moved back from that
   extremum by at least 1 m. This is what lets a long, gentle climb whose
   individual 20 m steps are each smaller than 1 m still accumulate
   correctly — a naive per-sample delta filter would discard every step and
   undercount the climb to zero — while short GPS/barometric jitter below
   the threshold never registers at all.

### GPS-to-route projection (`src/navigation/projection.ts`)

Uses `@turf/nearest-point-on-line` against a windowed slice of the route,
selected by **route distance** (not geographic distance) within ±400 m of the
last matched position. If that windowed match is untrustworthy (lateral
distance beyond 300 m, or sitting right at a window edge that was genuinely
clipped), a whole-route search is used instead and the result is flagged
`reacquired`. Searching in route-distance space is what keeps self-intersecting
routes and out-and-back sections from snapping to the wrong pass: a
geographically close point on a different part of the route usually has a very
different distance-from-start, so it falls outside the window.

### Off-route classification (`src/navigation/offRoute.ts`)

Lateral-distance thresholds inflate with reported GPS accuracy
(possibly-off-route at 20 m + accuracy, off-route at 50 m + accuracy). Fixes
reported with worse than 100 m accuracy are treated as untrusted and never
move the state, as is the one fix immediately following a projection
"reacquire" (e.g. resuming after the app was backgrounded) — this stops
resuming a ride from itself triggering a false off-route warning. Escalating
(on-route → possibly-off-route → off-route) requires 3 consecutive
corroborating fixes; de-escalating requires only 2, so a direct
off-route → on-route jump is possible with no forced intermediate step.

### Multi-track / multi-route GPX handling (`src/gpx/parseGpx.ts`)

Tracks are preferred over routes when a file has both. When multiple `<trk>`
(or `<rte>`) elements exist, only the first is imported and a visible,
non-blocking notice reports how many were skipped, so nothing is silently
dropped. All `<trkseg>` segments within the chosen track are concatenated in
document order.

### File size limit

Imported GPX files are capped at 20 MB (`src/gpx/constants.ts`).

### GPX export (`src/gpx/exportGpx.ts`)

Built via the DOM and `XMLSerializer`, not string templating, so text and
attribute escaping is always correct. A future Planning-mode route's
manoeuvres, when present, are written as an optional namespaced
`<acn:manoeuvre>` extension that other GPX readers can safely ignore.

## Known limitations

- Distances are Haversine-based, a small approximation of the true WGS84
  ellipsoid geodesic.
- Off-route thresholds and the projection search window are reasoned
  placeholder constants, not yet tuned against real ride data.
- The elevation chart plots raw imported points; a sparse `<rte>`-style import
  with few, far-apart points will look closer to straight-line interpolation
  than a smooth profile.
- No Planning mode or routing-provider adapter yet (Milestone 3).
- The default map style is [OpenFreeMap](https://openfreemap.org) Liberty —
  no API key required, and explicitly intended for third-party app use
  (unlike `tile.openstreetmap.org`'s community endpoint). Swap it via
  `src/map/tileSource.ts` if needed.
- Active-ride state is persisted to IndexedDB on every accepted GPS fix
  rather than being time-throttled. Each write is a cheap single-row upsert,
  so this was a deliberate simplification rather than an oversight.
- Only Chromium is exercised by the Playwright smoke test; iOS-specific PWA
  behaviour (install, background suspension) must be checked manually on a
  real iPhone.

## Deploying to GitHub Pages

The included workflow (`.github/workflows/deploy-pages.yml`) installs with
`npm ci`, checks formatting, lints, type-checks, runs the unit and end-to-end
test suites, builds, and deploys — in that order, so a failing check or test
blocks deployment.

### One-time repository settings

1. Push this repository to GitHub.
2. In the repository, go to **Settings → Pages**.
3. Under "Build and deployment" → "Source", select **GitHub Actions**.

No further configuration is needed: the workflow already targets the correct
base path (`/amazing-cycling-navigation/`) and requests only the `pages` and
`id-token` permissions it needs.

### Triggering a deployment

- **Automatic**: push to `main`.
- **Manual**: Actions tab → "Deploy to GitHub Pages" → "Run workflow".

### Inspecting failures

Actions tab → select the run → expand the failing step's log. A failure in
any check, test, or the build stops the workflow before anything is deployed.

### Finding the published URL

Once the first deployment succeeds, the live URL appears on **Settings →
Pages**, and on the completed workflow run's `deploy` job (as the job's
environment URL) — typically
`https://<username>.github.io/amazing-cycling-navigation/`.

## Privacy

- No accounts, analytics, telemetry, or external error reporting.
- Imported and planned routes, and active-ride state, stay in IndexedDB on
  the device unless explicitly exported.
- Riding-mode GPS coordinates are never sent to any server. (A future
  Planning mode may send waypoint coordinates to a user-configured routing
  provider; live riding locations never will.)
- No licence is included — this repository is intentionally unlicensed for
  now.
