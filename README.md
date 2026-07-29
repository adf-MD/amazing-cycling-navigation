# Amazing Cycling Navigation

A private-use, iPhone-first progressive web app for planning and riding road-bike
routes. See [`CLAUDE.md`](./CLAUDE.md) for the full product and engineering
specification, which governs any future work on this repository.

## Status

**Milestone 1 (Foundation)**, **Milestone 2 (GPX Riding core)** and the first
slice of **Milestone 3 (Planning)** are implemented: importing a GPX file,
viewing it on a map with an elevation profile, saving it locally, riding it
with live GPS projection, off-route detection and suspend/resume recovery, and
planning a new road-bike route by placing waypoints, routing them via a
user-supplied OpenRouteService key, inspecting distance/ascent/surface
warnings, saving the result locally, and exporting it as GPX. See
[Planning a road-bike route](#planning-a-road-bike-route) below for how to set
up your own key.

Planning's and Riding's maps also carry two small, restrained route-orientation
overlays layered onto the routed line: direction arrows repeating along the
remaining route to show its direction of travel, and kilometre distance badges
giving each point's absolute cumulative distance from the route's original
start — never renumbered as the rider progresses, zooms, or changes camera
mode. Badges use an adaptive interval (1/5/10/20 km, chosen from the map's
settled zoom and the route's length) and, in active Riding, omit a badge once
the rider's reliable matched progress has passed it while keeping every
remaining label absolute. Both overlays are plain project-owned rendering (a
locally generated icon for arrows, plain DOM markers for badges) with no
external glyph, sprite or network dependency, so they remain visible under the
local fallback background too.

Route calculation is split into consecutive two-waypoint sections ("legs"),
each requested and cached independently. The first calculation costs one
routing request per section; after that, most edits — moving, inserting,
deleting or reordering a waypoint, undo/redo, "return to start" — only
request the sections that actually changed, reusing every other section
from an in-memory, session-only cache. Changing the road-cycling profile or
the ferry-avoidance setting invalidates every section, since that changes
what a request means. Route calculation requests OpenRouteService's
`surface`, `waytype` and `waycategory` extras, so `steps`, `ford`, `ferry`
and `other` (construction-designated way) warnings can now appear alongside
the surface-based ones, whenever ORS actually returns matching metadata for
a route. `access` warnings remain unavailable: ORS does not expose a
`roadaccessrestrictions` extra for the `cycling-road` profile, so legal
access restrictions are never represented. A selected questionable or
unsuitable surface warning now shows the specific ORS surface category
(e.g. "Gravel / fine gravel", "Paving stones / cobblestone") rather than
only the broad paved/questionable/unsuitable bucket — see "Surface
classification" under
[Documented algorithms and thresholds](#documented-algorithms-and-thresholds)
below. Planning's map now frames a genuinely fresh session in an
approximately 50 × 50 km box around the rider's approximate location
(replacing an earlier fixed zoom-6 point jump), offers an explicit
"Locate me" control with loading/failure/retry states, and a north-up/top-down
control mirroring Riding's own. Still deferred within Milestone 3: the
road-speed-appropriate next-manoeuvre display planned for Milestone 4.

A first slice of **Milestone 4 (Riding enhancements)** is also implemented:
Riding's elevation chart now offers a **Full / 2 km / 5 km / 10 km** selector.
The rolling 2/5/10 km windows are rebased so the rider's matched position is
always the exact left edge of the chart, with the window's actual end
(clamped near the finish) filling the rest of the width — previously a
rolling window late in a route was compressed into a sliver near the right
edge. Full mode shows the whole route with a vertical progress marker
(dashed and labelled "Last known position" when restored/stale, solid and
labelled "Current route position" once fresh), splitting the profile into a
dashed completed portion and a solid remaining portion. The marker freezes
at the last reliable position while strongly off-route rather than jumping
to an unrelated nearby section, and the selected view persists across
suspension and reload. Still deferred: trusted next-manoeuvre display,
gradient colouring, elevation/climb segments and the optional wake-lock —
see "Future backlog" in [`CLAUDE.md`](./CLAUDE.md).

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
- `routing/` — the `RoutingProvider` interface and the OpenRouteService/HeiGIT
  `cycling-road` adapter, kept behind that interface so no other code depends
  on the provider's response shape.
- `navigation/` — distance, elevation smoothing, GPS-to-route projection,
  off-route classification, upcoming-elevation window selection.
- `storage/` — the versioned Dexie schema, repositories (routes, ride state,
  the provider key and its verification status, and Planning drafts), and the
  mapping between persisted and in-memory ride-navigation state.
- `pwa/` — service-worker update lifecycle.
- `map/` — MapLibre presentation (route, progress, position, tile source, and
  Planning's waypoint/preview overlay).
- `platform/` — small DI wrappers around geolocation, the clock, online
  status, service-worker status, geolocation permission, and the local
  redacted error log, so core logic is testable without a browser.
- `ui/` — the five screens (route library, riding, planning, settings,
  diagnostics) and shared components.

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
attribute escaping is always correct. A route's manoeuvres and, for a
planner-calculated route, its provider/profile provenance are written as
optional namespaced `<acn:manoeuvre>`/`<acn:source>` extensions, sharing one
`<extensions>` element, that other GPX readers can safely ignore. Warnings
(including the surface detail below) are not currently exported — only
manoeuvres and route/provider provenance are.

### Surface classification (`src/routing/surfaceCodes.ts`)

OpenRouteService's numeric `surface` extra_info codes are decoded into a
specific surface category (e.g. "Compacted gravel", "Gravel / fine gravel",
"Paving stones / cobblestone") alongside this project's own paved/
questionable/unsuitable/unknown road-bike classification. Verified against
ORS's live documentation
(<https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/extra-info/surface>,
page's own "Updated at" metadata: 2024-05-23). Codes 5 (Cobblestone), 9
(Fine Gravel) and 16 (Woodchips), which ORS's documentation marks as
recently removed, are deliberately not mapped to their old meanings — they
resolve to "unknown" like any other unrecognised code, rather than risk
mis-classifying a surface the provider no longer describes that way.

A surface category is a grouped provider/OSM-data category, not a
guarantee of the exact raw OSM `surface=*` tag, current condition,
smoothness or maintenance — several OSM values can fold into one ORS
category (e.g. ORS's "Gravel" covers both `gravel` and `fine_gravel`).
ORS's way type (e.g. track/cycleway/footway) is a separate extra and is
not displayed as part of this surface detail.

## Planning a road-bike route

Road-bike route calculation uses [OpenRouteService](https://openrouteservice.org)
(hosted by [HeiGIT](https://heigit.org)) with the `cycling-road` profile. This
needs your own free key — the app never ships or proxies one.

1. Open **Plan → Settings** (or the Settings tab) in the app and follow the
   link to [sign up for a HeiGIT account](https://account.heigit.org/signup).
2. Copy the API key from your HeiGIT account dashboard.
3. Paste it into the key field in Settings and save.

What this means in practice:

- The key is stored only in this browser's IndexedDB (`src/storage/db.ts`),
  never bundled into the app's source or sent anywhere except directly to
  HeiGIT when you calculate a route. It is **not encrypted** — that storage
  only keeps it out of the repository and away from accidental publication,
  not secret from other JavaScript running on the same site.
- Clearing Safari's (or your browser's) site data for this app removes the
  key, and you'll need to enter it again. Settings has "Replace key" and
  "Delete key" actions for the same purpose.
- When you calculate a route in Planning, your key and the waypoints you've
  placed are sent directly to HeiGIT. Your live riding GPS location is never
  sent to HeiGIT, or to any other server.
- Planning (placing, moving, reordering and deleting waypoints, undo/redo,
  and an unsaved draft) works fully without a key — only the "Calculate
  route" step needs one.
- A route you've already saved or exported needs no key to reopen, ride, or
  re-export — the key is only used at calculation time.
- The current endpoint is `https://api.heigit.org/openrouteservice/v2`; the
  older `api.openrouteservice.org` host is deprecated and never used here.

## Known limitations

- Distances are Haversine-based, a small approximation of the true WGS84
  ellipsoid geodesic.
- Off-route thresholds and the projection search window are reasoned
  placeholder constants, not yet tuned against real ride data.
- The elevation chart plots raw imported points; a sparse `<rte>`-style import
  with few, far-apart points will look closer to straight-line interpolation
  than a smooth profile.
- Moving a waypoint is select-then-relocate (tap/click, or the crosshair
  "Move selected waypoint here" button) rather than a draggable map marker.
- Steps, ford, ferry and construction (`other`) warnings come from ORS's
  `waytype`/`waycategory` extras and only appear when the provider actually
  returns matching metadata for a route — their absence is not proof a
  hazard doesn't exist. Legal access restrictions are not represented at
  all: ORS does not expose a `roadaccessrestrictions` extra for the
  `cycling-road` profile, so an `access` warning is never produced.
- Route warnings are highlighted and framed on the map, and selection is
  two-way — selecting a warning in the list or tapping its rendered segment
  on the map does the same thing.
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

### Confirming the deployed build

The app's current version is `0.2.1` (`package.json`). Independently of that
version number, the **Diagnostics** screen also shows a **Build** field: the
first 7 characters of the Git commit SHA the running app was built from
(e.g. `4b825dc`). The deploy workflow sets this via `APP_BUILD_SHA:
${{ github.sha }}` on its `Build` step; a local build (`npm run dev` or
`npm run build` without that variable set) always shows `dev` instead.

To confirm an installed PWA has actually picked up a given deployment,
compare its Diagnostics "Build" value against the commit SHA of the
corresponding successful workflow run in the Actions tab — useful since a
service worker update can otherwise lag behind what's actually live.

## Privacy

- No accounts, analytics, telemetry, or external error reporting.
- Imported and planned routes, active-ride state, and your OpenRouteService
  key (if you add one) stay in IndexedDB on the device unless explicitly
  exported.
- Riding-mode GPS coordinates are never sent to any server. Planning
  waypoint coordinates and your OpenRouteService key are sent directly to
  HeiGIT only when you explicitly calculate a route — see
  [Planning a road-bike route](#planning-a-road-bike-route).
- No licence is included — this repository is intentionally unlicensed for
  now.
