# Amazing Cycling Navigation

## Purpose

Build a private-use, iPhone-first progressive web app for exercise and leisure rides on a road bike, with two modes:

1. **Planning**: place waypoints on a map, route them along road-bike-suitable roads, inspect distance, elevation and surface suitability, save the route locally, and export a GPX containing elevation.
2. **Riding**: import or open a saved GPX, see the route and current location, stay on track, and inspect the upcoming elevation profile.

Reliability and a simple interface matter more than feature breadth. This is a visual route follower, not a replacement for a native turn-by-turn navigation app.

## Product priorities

In order of importance:

1. A saved or imported route must remain usable without the routing provider.
2. Riding mode must make it immediately clear whether the rider is on the route.
3. The active route and UI state must recover cleanly after iOS suspends or reloads the PWA.
4. Planning must produce a self-contained GPX with dense track geometry and elevation.
5. Distance to the next planner-generated manoeuvre and elevation segmentation are enhancements, not prerequisites for the first usable release.
6. Planning must strongly prefer reliably paved road-bike-suitable routes while treating missing OpenStreetMap surface data as uncertainty to expose, not proof that a road is unsuitable.

## Explicit non-goals

Do not add these unless the user changes the scope:

- spoken instructions
- automatic rerouting
- ride recording or location history
- Bluetooth sensors
- haptic alerts
- background location tracking
- accounts, cloud synchronisation, analytics, advertising, or telemetry
- automatic loop generation by target distance
- full offline map downloads
- weather, traffic, social, sharing, or route-popularity features

## Platform facts and lifecycle

- The primary device is an iPhone Home Screen PWA.
- Web geolocation updates are not reliable while the document is hidden or the phone is locked. Never imply otherwise.
- Persist the active route and navigation state locally before suspension.
- On `visibilitychange` and `pageshow`, restore state immediately, display any old location as stale, restart the location watch, and replace it with a fresh fix.
- Request high-accuracy geolocation only while Riding mode is visible and active.
- An optional screen wake-lock may be added later, off by default.
- The essential route line, current position, progress, off-route state, and elevation data must not depend on the routing service during a ride.

## Hosting and privacy constraints

- The frontend is a static GitHub Pages site served over HTTPS.
- The repository is public and intentionally has no licence for now. Do not add a `LICENSE` file or claim an open-source licence.
- Never commit secrets, personal GPX files, real home coordinates, generated route histories, or API keys.
- Do not add analytics or external error reporting.
- Imported and planned routes stay in IndexedDB unless the user explicitly exports them.
- A routing-provider API key must be entered by the user and stored locally. Never bake it into the JavaScript bundle, source, examples, tests, or GitHub Actions configuration.
- Planning coordinates may be sent to the configured routing provider. Riding locations must not be sent to it.

## Preferred technical stack

Respect an established stack if the repository already has one. If it is empty, use:

- Vite
- React and TypeScript with strict type checking
- MapLibre GL JS for map rendering
- IndexedDB through Dexie for local persistence
- a service worker generated with `vite-plugin-pwa`
- Vitest for unit and component tests
- ESLint and Prettier

Use small focused packages rather than broad frameworks. Add a dependency only when it materially reduces risk or complexity. Keep geospatial and GPX logic behind project-owned typed interfaces.

## Architecture

Keep these concerns separate:

- `domain`: provider-independent route, elevation, manoeuvre, waypoint, and navigation types
- `gpx`: secure GPX parsing, validation, normalisation, and export
- `routing`: a `RoutingProvider` interface and provider adapters
- `navigation`: distance arrays, GPS-to-route projection, progress continuity, off-route classification, and upcoming-elevation selection
- `storage`: versioned IndexedDB schema and migrations
- `pwa`: manifest, service-worker policy, update lifecycle, visibility recovery, and install behaviour
- `map`: presentation of route, progress, current position, accuracy, and waypoints
- `ui`: Planning, Riding, route library, settings, and diagnostics

The UI must depend on the project's canonical domain model, never directly on a provider response.

Suggested core types:

```ts
type Coordinate = readonly [longitude: number, latitude: number];

interface RoutePoint {
  coordinate: Coordinate;
  elevationMetres: number | null;
  distanceFromStartMetres: number;
}

interface Manoeuvre {
  distanceFromStartMetres: number;
  type: string;
  instruction?: string;
}

interface RouteWarning {
  kind:
    | "unknown-surface"
    | "questionable-surface"
    | "unsuitable-surface"
    | "access"
    | "steps"
    | "ford"
    | "ferry"
    | "other";
  startDistanceMetres: number;
  endDistanceMetres: number;
  message: string;
}

interface SurfaceSummary {
  pavedMetres: number;
  questionableMetres: number;
  unsuitableMetres: number;
  unknownMetres: number;
}

interface PlannedRoute {
  id: string;
  name: string;
  createdAt: string;
  points: RoutePoint[];
  manoeuvres: Manoeuvre[];
  distanceMetres: number;
  ascentMetres: number | null;
  descentMetres: number | null;
  surfaceSummary?: SurfaceSummary;
  warnings: RouteWarning[];
  source: {
    kind: "gpx-import" | "planner";
    provider?: string;
    profile?: string;
  };
}

interface RoutingProvider {
  calculateRoute(
    waypoints: Coordinate[],
    options: RoutingOptions,
    signal?: AbortSignal,
  ): Promise<PlannedRoute>;
}
```

Improve these types as implementation knowledge grows, but preserve provider independence.

## GPX behaviour

- Accept GPX tracks and routes, with tracks preferred when both exist.
- Parse locally with `DOMParser`; never upload imported files.
- Validate file type, XML parsing errors, coordinate ranges, finite numeric values, and reasonable input size.
- Handle missing elevation explicitly. Do not invent elevation silently.
- Preserve dense geometry and elevation when exporting.
- Export standards-compatible GPX. Project-specific manoeuvre metadata may use an optional namespaced extension that other readers can ignore.
- Document and test the chosen distance, smoothing, ascent, and descent calculations.
- Do not sum raw positive elevation noise. Resample or smooth before ascent calculation and retain the raw imported elevations separately if useful.

## Riding behaviour

- Design for road-bike speeds and brief glances: show a high-contrast route, current location, GPS accuracy, completed portion, remaining portion, distance remaining, off-route state, and upcoming elevation with minimal interaction.
- Offer upcoming-elevation windows of 2 km, 5 km and 10 km, defaulting to 5 km.
- Always distinguish a stale fix from a fresh one and show fix age when relevant.
- After a location error, Try again must reactivate or replace the location watch and request camera follow. Once a fresh fix is accepted, the error clears, geolocation status returns to watching, and the Follow-location and north-up controls reappear automatically, without reopening or restarting the route. A location error preserves the last known fix as stale rather than discarding route progress or resetting the camera to overview.
- Project each accepted GPS fix onto plausible route segments.
- Preserve progress continuity at self-intersections and out-and-back sections. Do not simply choose the globally nearest segment when that would jump implausibly along the route.
- Base off-route classification on both lateral distance and reported GPS accuracy. Require repeated evidence before showing a strong off-route warning.
- A saved route must work without map tiles; use a neutral fallback background when necessary.
- Imported GPX files generally do not contain reliable manoeuvres. Do not infer or promise turns from geometry alone. Show next-turn information only when trusted manoeuvre metadata exists.
- When trusted manoeuvres are added, show them early enough for road-bike speeds and make the remaining distance increasingly prominent inside 500 m.
- Current GPS speed may inform plausibility or presentation, but do not retain speed history or turn the feature into ride recording.

## Planning behaviour

- Add, insert, drag, reorder, and delete waypoints with undo/redo.
- Include an explicit “return to start” action for closing a loop. Do not generate a loop automatically.
- Recalculate only changed route legs and debounce drag completion.
- Retain the last successful route when a provider request fails.
- Never silently substitute straight lines for failed routed legs.
- Show distance, ascent, descent, and elevation profile before export.
- Begin with one road-cycling profile. For openrouteservice, use `cycling-road` with the provider's recommended routing preference rather than merely the shortest route.
- Strongly prefer asphalt and other reliably paved surfaces, including suitable paved cycleways.
- Strongly discourage or avoid steps, fords, foot-only paths, dismount sections, sand, grass, ground and rough tracks.
- Treat fine gravel, compacted surfaces, paving stones and similar surfaces as configurable or questionable rather than universally suitable.
- Do not hard-reject an otherwise valid road solely because its surface tag is missing. Record and display the unknown distance instead.
- Request provider surface, way-type and access metadata where available, normalise it into provider-independent warnings and retain provenance.
- Show route distance, ascent, descent, paved distance or proportion, questionable distance, and unknown-surface distance before export. Estimated duration is secondary for exercise and leisure rides.
- Make questionable, unsuitable and unknown segments inspectable on the map. Never present incomplete map data as a guarantee that a route is paved or legally accessible.
- Keep ferry avoidance configurable instead of silently rejecting all ferries.
- A genuinely fresh Planning session (no restored draft, no waypoints yet) frames an approximately 50 × 50 km area around the rider's approximate location. A restored draft or any existing waypoint always takes precedence, and this automatic framing is skipped entirely in that case. An explicit "Locate me" control re-centres the same way on demand, with its own visible locating/failure/retry state, and never overrides in-progress waypoint editing. A north-up/top-down control mirrors Riding's semantics (resets bearing and pitch to 0° without recentring, changing zoom, or introducing following mode or camera tilt).

The first provider adapter should target openrouteservice with `cycling-road`, but provider-specific code must remain isolated. The API key is user-supplied and local. Handle `401`, `403`, `429`, network failures, cancellation, malformed responses, and quota headers where available. Do not call the provider continuously while a waypoint is being dragged.

## Maps and data attribution

- MapLibre is only the renderer; keep the tile source configurable.
- Display visible attribution required by OpenStreetMap and the selected tile provider.
- Do not bulk-download or prefetch from OpenStreetMap community tile servers.
- Do not store regional map tiles or routing graphs in the GitHub Pages deployment.
- The core ride display must degrade usefully if tiles or connectivity fail.

## GitHub Pages and PWA requirements

- Support deployment beneath `https://<user>.github.io/<repository>/`, not only at `/`.
- Derive or configure Vite's `base` correctly and keep manifest `start_url`, `scope`, icons, service-worker URLs, and asset URLs within that base.
- Prefer no URL router. If routes become necessary, use hash routing so direct loads do not return a GitHub Pages 404.
- Supply a GitHub Actions Pages workflow that runs install, checks, tests, build, and deployment.
- Pin the Node.js major version and use `npm ci` in CI.
- Cache the application shell, not personal data or arbitrary routing responses.
- Never force a service-worker update or page reload during an active ride. Surface a deferred update prompt.
- Keep IndexedDB data compatible across ordinary application updates through explicit schema versions and migrations.

## Interface and accessibility

- Optimise Riding mode for a small phone mounted on a bicycle, bright daylight, gloves, vibration, and brief glances.
- Assume road-bike speeds: prioritise advance visibility, low interaction and rapid comprehension over dense information.
- Use large touch targets, high contrast, restrained motion, and few controls.
- Do not rely on colour alone for route or warning status.
- Use metric units throughout.
- Use British spelling in user-facing text and documentation.
- Make empty, loading, stale, offline, permission-denied, and provider-failure states explicit.

## Engineering standards

- Keep TypeScript strict; do not suppress errors with broad `any`, `@ts-ignore`, or unchecked casts.
- Use deterministic pure functions for distance, elevation, projection, and off-route calculations, with fixture-based tests.
- Ordinary e2e tests must not depend on a live map tile provider: tests expecting the map's normal ready state serve a locally fulfilled minimal style (`e2e/support/localMapStyle.ts`'s `installLocalMapStyle`), and tests exercising the fallback style deliberately fail that request instead (`forceMapStyleFailure`). Live-provider reachability is a separate manual/optional check, not a required automated test.
- Treat GPS, GPX, provider, IndexedDB, service-worker, and map failures as expected conditions.
- Abort obsolete network requests.
- Avoid logging coordinates or API keys. Redact sensitive values in diagnostics.
- Include a local diagnostics screen showing app version, online state, service-worker state, storage health, geolocation status, fix accuracy/age, active route ID, and recent redacted errors.
- Prefer incremental, reviewable commits when asked to commit. Never commit generated personal data.
- Before finishing a task, run the relevant formatter, type checker, tests, and production build. Report anything not run.

## Change discipline

- Work in the smallest coherent vertical slices that leave the application runnable and easier to verify.
- An initial scaffold is acceptable in an empty repository. After that, prefer targeted edits over broad rewrites.
- Before editing, inspect the relevant files, tests, configuration, Git status, and nearby conventions. Do not assume the repository is clean.
- Preserve user changes and unrelated work. Never discard, reset, overwrite, or reformat unrelated files.
- Do not refactor unrelated code, rename broad APIs, upgrade dependencies, or change tooling merely while passing through an area.
- Avoid repository-wide mechanical changes unless they are explicitly required. Keep formatting churn out of behavioural changes.
- For each slice: define the observable outcome, implement it, add or update focused tests, run the narrowest useful checks, and only then continue.
- Keep temporary compatibility shims small and documented. Do not leave two competing architectures behind.
- Treat changes to domain types, IndexedDB schemas, GPX output, service-worker caching, manifest scope, and provider interfaces as compatibility-sensitive. Add migrations or compatibility tests where required.
- Justify new production dependencies. Prefer an existing dependency or a small project-owned implementation when the maintenance and security trade-off is better.
- Do not hide incomplete behaviour behind successful-looking UI. Use an explicit disabled, unavailable, or not-yet-supported state.
- If a request is too large for one safe pass, complete the highest-priority end-to-end slice, keep the repository green, and report the precise remaining slices. Do not leave a half-migrated codebase.
- Do not create commits, amend history, push, force-push, open pull requests, or modify remote state unless explicitly asked.
- Never use destructive Git commands to resolve local problems. Report conflicts or ambiguous user changes instead.

## Delivery order

Implement in milestones and keep each milestone deployable:

1. **Foundation**: static GitHub Pages deployment, installable PWA shell, IndexedDB, route domain model, diagnostics.
2. **GPX Riding core**: import, validation, map route, elevation profile, live visible-page location, projection, progress, off-route state, persistence, suspension recovery.
3. **Planning**: waypoint editing, `cycling-road` provider adapter, paved/unknown-surface analysis, route statistics, elevation, local save, GPX export. A first slice of Planning-map usability is implemented: a genuinely fresh session frames an approximately 50 × 50 km area around the rider's approximate location instead of the earlier fixed zoom-6 point jump, an explicit "Locate me" control re-centres on demand with its own loading/failure/retry state, and a north-up/top-down control mirrors Riding's own semantics. A second slice fixes the crosshair placement point and adds identifiable waypoint markers: the visual crosshair ring now shares exactly one centring mechanism with the coordinate placement actually uses (a previous redundant CSS offset made the two disagree by a few pixels); the "Add waypoint here"/"Move waypoint here"/"Insert waypoint here" action is disabled while a genuine pan/pinch/rotate gesture (including momentum) is still in flight, rather than risking a stale pre-gesture centre; completing a debounced route recalculation after an edit (append/move/insert/delete/reorder/undo/redo) no longer re-fits the camera to the whole route — a route is only fitted once per draft, on the first successful calculation (tracked explicitly via `usePlanningRoute`'s `isFirstRouteForDraft`, not by comparing coordinate-array references), and every later recalculation preserves whatever camera the rider already has; the placement callout's bottom-centre position is unchanged; and Planning waypoints render as numbered DOM markers (ordinal, start/finish/combined-loop-"`1/n`"/selected treatment, all shape/border-based, never colour alone) that have no glyph/sprite dependency and so remain visible under the local fallback style, with the generic routed-line start/finish markers suppressed whenever Planning's own waypoint markers are present. A third slice adds small, restrained direction arrows along routed geometry in both Planning and Riding: a project-owned RGBA icon, baked directly as pixel data with no external glyph, sprite or network request, is registered once per map instance and repeated along the existing remaining-route line via a single MapLibre symbol layer — so it needs no new GeoJSON source, remains available under the local fallback style, covers Planning's routed geometry but never its dashed unrouted preview (a separate source), and automatically prioritises Riding's remaining portion as the rider's live progress updates the same source the route line itself already uses. A fourth slice adds small, restrained kilometre distance-badge markers along routed geometry, in Planning, in Riding's pre-start/full-route overview, and in active Riding: each badge's label is the absolute cumulative distance from the route's original start (`RoutePoint.distanceFromStartMetres`), which never resets or renumbers as the rider progresses, zooms, or switches camera mode. A pure placement algorithm (`src/map/distanceBadgeLayer.ts`) walks the route's points once, forward only, interpolating the exact coordinate at each positive multiple of an adaptively-chosen interval (1/5/10/20 km, chosen from the map's own settled zoom — quantised to the nearest whole level and only re-read once the camera stops moving, never per animation frame — and the route's total length, escalating to a coarser interval to respect a conservative marker cap and de-escalating so a short route still gets at least one useful marker), stopping short of the finish by a small named clearance so a badge never sits on top of the finish marker. Badges are plain DOM markers, mirroring Planning's own waypoint markers via an entirely independent `setDistanceBadges`/`badgeMarkersById` collection on the map adapter, so the two marker groups can never delete each other; they need no glyph/sprite/network dependency and stay upright under rotation and tilt for free via MapLibre's default marker alignment. In active Riding, a badge is omitted once the rider's frozen/reliable matched progress — `presentationDistanceFromStartMetres`, the same value the elevation marker already uses, deliberately not the live value driving the route line/arrows — has passed it, so only the next absolute marker(s) ahead remain visible, never renumbered. Two badges that would land on the same or near-identical coordinate (a loop or an out-and-back) combine into one truthful multi-value label (e.g. "10 / 30 km") rather than overlapping unreadably. This completes the route-orientation overlay area: both direction arrows and distance markers are now implemented.
4. **Riding enhancements**: trusted next manoeuvre with road-speed-appropriate advance display, distance to turn, gradient colouring, simple elevation/climb segments, optional wake-lock. A first slice of this milestone is implemented: a selectable Full/2 km/5 km/10 km elevation view, with the rolling 2/5/10 km windows correctly rebased so the rider's position is the exact left edge of the chart (previously compressed towards the right edge late in a route), a Full-profile view showing the whole route with a route-progress marker that distinguishes fresh from stale (restored) fixes and freezes at the last reliable position while strongly off-route, and persistence of the selected view across suspension/reload. A second slice fixes a location-watch lifecycle bug where, after an initial geolocation error, tapping Try again could leave the Follow-location and north-up controls permanently hidden even once a valid GPS fix arrived: the watch lifecycle now uses an explicit generation token, a retry reliably disposes any obsolete watch and creates a working one, a fresh accepted fix always restores geolocation status to watching and clears the error, and callbacks from a superseded watch are structurally ignored. A third slice adds noise-resistant gradient (uphill/downhill) colouring, shared by one provider-independent analysis module (`src/navigation/gradient.ts`): known-elevation points are split into runs separated by gaps over 500 m (left `unknown`), each run is resampled at the existing 20 m step and lightly smoothed, grade is measured over a centred ~100 m baseline window (clamped to whatever's actually available, never shifted away from the target distance, near a run's edges), classified into seven bands from steep descent to very steep climb plus `unknown`, and short (<80 m) flicker segments are absorbed into whichever neighbour is closer in severity across repeated reassign-then-merge passes until stable. One authoritative palette (`src/navigation/gradientPalette.ts`, colour-distance-tested against every existing warning/route colour and the fallback map background) drives both the elevation chart — now shown in Planning too, not just Riding — and the map: `ElevationChart` plots the shared smoothed elevation series (never the raw imported samples) and colours it per class, a shared `GradientLegend` lists only the classes actually present with a text label, exact grade range and non-colour glyph, and Full/2/5/10 km views all clip the same whole-route analysis (`clipGradientSegments`) rather than re-analysing a window, so classification always agrees at a shared distance. On the map, `src/map/gradientRouteLayer.ts` slices the route into one GeoJSON feature per gradient-class range and a new data-driven `match`-expression line layer (`mapAdapter.ts`'s `DataDrivenLineColor`, MapLibre's categorical expression support, no `lineMetrics`) colours it; gradient and surface/access/ferry warnings stay independent visual dimensions by nesting three nested-ring layers — the selected-warning halo (widened to 13 px), the six warning-category casings (widened to 8–10 px), then the narrower gradient centre (5 px, matching the existing route-line width) — with direction arrows repainted above the whole stack so they stay visible regardless of what colours the line beneath them. Active Riding clips the gradient overlay using the same live `matchedDistanceFromStartMetres` that already drives the completed/remaining route split and the arrows (not the frozen `presentationDistanceFromStartMetres` badges/the Full marker use — a known, already-documented three-way progress-value divergence, not unified here). A fourth slice unifies the elevation-chart line and the gradient classification into one shared pass, `analyzeRouteElevationProfile` (`src/navigation/gradient.ts`), so the same underlying smoothed values drive both, rather than two independently-tuned smoothing stages: the ~100 m smoothing window reuses `elevation.ts`'s own `SMOOTHING_WINDOW_SAMPLES` constant directly (not a second, separately-tuned window as before), and every gradient produced this way is fitted by least-squares linear regression over each baseline window's _raw_ resampled elevations, deliberately not the smoothed display series — using the smoothed series' own already edge-shrunk values as grade endpoints was found to bias the measured slope for roughly the first/last baseline window's worth of a run, which regression avoids since it's unbiased for a linear signal regardless of window symmetry. `ElevationChart` (Riding and Planning both) now renders this smoothed series — never the raw imported samples — as its prominent line, with raw `RoutePoint.elevationMetres` left completely untouched for storage, GPX export and diagnostics; the chart's vertical scale additionally adds ~10% padding and enforces an ~20 m minimum displayed range so a near-flat route no longer reads as an exaggerated series of hills, while the figcaption continues to report the true (unpadded) elevation range. A fifth slice replaces the continuous local-gradient "rainbow" with a two-level, Garmin-ClimbPro-inspired presentation, completing Future-backlog item 9. **Macro**: `src/navigation/routeFeatures.ts`'s `detectRouteFeatures(profile)` derives recognised complete climbs and descents from the exact same shared `RouteElevationProfile` — extended with a new `runs: ElevationRun[]` field exposing each run's already-computed resampled distances/smoothed elevations/per-point local-gradient percentages (`gradesPercent`, the same regression-fitted values gradient classification already used, previously discarded), so feature detection is never a second resample/smooth pass. Boundaries are found by a reversal/hysteresis walk per run (never bridging the existing >500 m gap-based run split): a confirmed boundary requires either the elevation to reverse by `REVERSAL_BRIDGE_ELEVATION_METRES` (10 m) or the distance since the tracked running extremum to reach `REVERSAL_BRIDGE_DISTANCE_METRES` (200 m); a point within `FLAT_EPSILON_METRES` (0.01 m) of the current extremum is treated as neither extending nor reversing — discovered, during this slice's own verification, to be essential: without it, a flat lead-in or trailing plateau adjacent to a climb (common on real routes, and never itself a "reversal") was silently absorbed into the climb's own boundary, pulling its reported start/end all the way to the run's own edge. A candidate climb is recognised at length ≥ 500 m, average gradient ≥ 3%, and Garmin's own published `climbScore = lengthMetres × averageGradientPercent` ≥ 1,500 (mathematically implied by the other two thresholds together, but kept explicit and independently tested), classified by Garmin's own published score bands (Uncategorised/Cat 4/Cat 3/Cat 2/Cat 1/HC at 8,000/16,000/32,000/64,000/80,000) — the score formula and category thresholds are Garmin's; only the boundary-detection heuristic above is an app-specific approximation, since Garmin's own boundary algorithm is proprietary and undisclosed. A candidate descent (length ≥ 500 m, average gradient ≤ −3%) has no Garmin equivalent at all, so its three severity bands (gentle/steep/very steep at −6%/−9%) and colours are entirely app-specific, and its details panel heading always reads "Recognised descent", never "Category N". One authoritative palette, `src/navigation/routeFeaturePalette.ts` (colour-distance-tested the same way as `gradientPalette.ts`, against every warning/route/marker colour — deliberately not required to be distinguishable from local-gradient colours, since macro and micro are never shown at the same route point simultaneously), drives both a new sparse macro map layer (`src/map/routeFeatureLayer.ts`, one GeoJSON feature per recognised climb/descent, clipped to the remaining portion exactly like the existing gradient layer) and a new `RouteFeatureLegend`. **Micro**: the existing local-gradient layer, legend and chart overlay are unchanged in their own analysis, but are now fed only the selected-or-currently-active feature's own clipped range (via the existing `clipGradientSegments`, reused unchanged) — empty otherwise — so an ordinary (non-feature) route section now shows only its plain base colour, never a rainbow. **Layering**: the whole climb/descent group (a new selected-feature halo, the macro layer, then the micro layer, each narrower than the last, mirroring the existing nested-ring technique) is added, as a group, before the whole warning group, so a wider, later-added warning always visually wins wherever it overlaps a climb/descent, per this file's own surface-data priority; tap-hit-testing is unaffected by paint order (a new `queryTopRouteFeatureAt`, mirroring `queryTopWarningFeatureAt` exactly, is queried only after warnings miss). **Selection**: `RouteFeatureDetailsPanel` (feature-level: category or "Recognised descent" heading, position, length, gain/loss, average and maximum/steepest gradient, climb score, explanatory sentence) and `GradientSegmentDetailsPanel` (a finer-grained drill-down into one local-gradient segment within the shown detail feature, with elevation at each end interpolated from the shared smoothed series via the existing `interpolateRoutePointAt`) are shared by Riding and Planning; a route-feature selection and a warning selection are mutually exclusive (selecting one clears the other, mirroring the existing "editing a waypoint clears warning selection" precedent); in Riding, the feature shown in detail is `selectedFeature ?? activeFeature`, where `activeFeature` is looked up via a new `findFeatureAtDistance` against the existing frozen-while-off-route `presentationDistanceFromStartMetres` — never live/raw progress — and no camera auto-fit is triggered by a route-feature selection, deliberately, since an unexpected camera jump while actively riding would be unsafe. **Chart interaction**: `ElevationChart` gained a single `onTapDistance` prop, converting a tap's pixel position to a route distance via a new `xPixelToDistanceMetres` (the exact inverse of the chart's existing `distanceToX`) rather than SVG element hit-testing — every coloured path and the marker are explicitly `pointerEvents="none"` so one transparent, full-chart `<rect>` is always what actually receives the tap (a stroked SVG path's default `pointer-events: visiblePainted` was found, during this slice's own e2e verification, to otherwise intercept clicks meant for an element beneath it). A shared, pure `resolveElevationChartTap` then resolves the tapped distance to whichever boundary the route analysis already produced — the containing local-gradient segment if the tap falls inside the currently-shown detail feature, otherwise the containing macro feature — never inventing a new boundary from the tap coordinate itself; map-tap selection remains macro-feature-only (chart interaction is where micro-segment selection lives). A single, first-of-its-kind `<details>` disclosure in this codebase, `GradientColoursDisclosure` (collapsed by default, not persisted), replaces the previously always-visible `GradientLegend` call site in both Riding and Planning, with two sections — "Recognised route features" (the new `RouteFeatureLegend`) and "Detailed local gradient" (the existing, unmodified `GradientLegend`) — each with its own required explanatory sentence. Performance: `detectRouteFeatures` is memoised alongside the existing `analyzeRouteElevationProfile` call, both keyed on route identity and computed once per route change, never per GPS fix; a fix only changes which feature is "active" via a plain distance lookup. A sixth slice fixes a real legend bug and adds a pre-ride climb selector. **Legend visibility fix**: every legend swatch (`GradientLegend.tsx`, `RouteFeatureLegend.tsx`) was an empty inline `<span>` with `backgroundColor` set correctly but no width or height anywhere — not in a CSS rule (none existed) and not inline — so it painted onto a 0×0 box and was invisible despite the colour being "correct" in the DOM; no test caught this because Vitest's jsdom environment never loads `index.css` (`test: { css: false }` in `vite.config.ts`). Fixed by a new shared `GradientColourSwatch` (`src/ui/shared/GradientColourSwatch.tsx`) whose width, height, background and border are all set via **inline style**, not a CSS class, so correctness never depends on a stylesheet being loaded — reused by both legends and by `RouteFeatureDetailsPanel`'s heading; a border is applied to every swatch unconditionally rather than only to visually light ones, avoiding per-colour luminance detection. **One authoritative metadata source**: `gradientPalette.ts`'s previous single `GRADIENT_CLASS_LABELS` (combining name and range into one string, e.g. `"Moderate climb (4% to 7%)"`) is split into three separate maps — `GRADIENT_CLASS_NAMES`, `GRADIENT_CLASS_RANGE_LABELS`, `GRADIENT_CLASS_COLOUR_NAMES` — so a legend row can show name, exact range and human colour name as three distinct pieces; range wording was also rewritten to remove a real ambiguity where adjacent bands both stated the same boundary number with no inequality cue (e.g. "Descent (−6% to −2%)" beside "Steep descent (< −6%)" never told a reader which band owned −6%) — every boundary is now phrased so exactly one entry owns it (e.g. "−6% to just below −2%"), and the same fix was applied to the three descent-severity entries in `routeFeaturePalette.ts`'s `ROUTE_FEATURE_LABELS` (described by steepness magnitude, not signed value, since a "just below" reading against negative numbers that grow more negative as they steepen was confusing). `RouteFeatureLegend` also gained one always-present, UI-only "ordinary route" row (a route section that is neither a recognised climb nor descent, including one with missing or insufficient elevation data — today genuinely indistinguishable, since there is no separate macro "unknown" treatment) using a local colour constant that deliberately mirrors, but is not part of, `ROUTE_FEATURE_COLOURS` — that map feeds `MapView.tsx`'s real MapLibre paint expression, so adding a fake feature key there would both fail the colour-distance test (identical to the base route colour) and pollute the map's real lookup table. **Pre-ride climb selector**: in Riding, before `Start riding` (`nav.geolocationStatus === "idle"`), a new `RidingClimbSelector` (`src/ui/riding/RidingClimbSelector.tsx`) shows a native `<select>` listing the route's recognised climbs in order (`listClimbsInRouteOrder`, a thin filter over `detectRouteFeatures`'s own already-ascending, non-overlapping result), numbered "Climb 1", "Climb 2", …, each option reading e.g. "Climb 2 · Category 3 · starts at 18.4 km", plus an "All route" option; a route with none shows an explanatory empty state instead of an empty dropdown. It drives the exact same `selectedRouteFeatureId`/`routeFeatureOverlay`/chart-`selectedRangeMetres` machinery already used by map- and chart-tap selection — no `MapView.tsx` changes were needed, and the existing "no camera auto-fit on feature selection" decision already satisfies "must not unexpectedly zoom or pan." The shared `RouteFeatureDetailsPanel` gained an optional `climbNumber` prop (numbering the heading "Climb 2 · Category 3" instead of "Category 3 climb", and a category-colour swatch) passed only from this pre-ride context, so there remains exactly one climb-information card rendered at any time rather than a second, competing panel. The route's first climb is selected by default: rather than resetting stored selection state imperatively (an effect trips this project's `react-hooks/set-state-in-effect` lint rule; a during-render ref-comparison, React's documented alternative and already used by `PlanningScreen.tsx`'s own routed-route-change invalidation, unexpectedly tripped `react-hooks/refs` for this specific component and wasn't worth chasing further), the displayed selection is a pure derivation: an explicit choice is stored tagged with the route id it was made for, and only counts while that id still matches the current route, otherwise falling back to the first climb — needing no effect, no ref, and correctly resetting even if this screen were ever not remounted on a route change (today it always is, since `App.tsx` never swaps `selectedRoute` while Riding is shown). Starting the ride (`handleStart`, guarded on `nav.geolocationStatus === "idle"` specifically, since the same handler also backs the mid-ride "Try again" retry button and CLAUDE.md requires that retry to preserve ride progress) explicitly records "no selection" for the route, so a climb merely previewed pre-ride never continues to override the rider's actual active climb once riding begins. A seventh slice retires the whole-route seven-class `GradientClass` scheme (`classifyGrade`, `gradientPalette.ts`, `GradientLegend.tsx`, and their dedicated tests) entirely — confirmed unused elsewhere by a repo-wide search before deletion — and replaces it with two purpose-built detail schemes, both reusing the exact same smoothed ~100 m regression grades (`ElevationRun.gradesPercent`) already computed for the fifth slice's macro/micro split, with no second gradient calculation. **Climbs** get a genuine Garmin-ClimbPro-style five-band local scale, `classifyClimbGradientBand` (`src/navigation/routeFeatures.ts`): `< 3%` green ("Gentle, flat or brief descent"), `3–6%` yellow/gold ("Moderate climb"), `6–9%` orange ("Hard climb"), `9–12%` red ("Very hard climb"), `>= 12%` dark red ("Extremely steep climb") — deliberately worded to describe only the local gradient at one point, never "Category N", since a climb's overall category depends on length and average gradient while a local band does not. Where practical the five local bands share the exact same colour token as their corresponding macro category (`routeFeaturePalette.ts`'s `CLIMB_CATEGORY_TIER`/`CLIMB_GRADIENT_BAND_TIER`), which also means Uncategorised and Category 4 climbs — the two least-severe of six categories mapped onto five bands — now render with one identical shared green, collapsing what were previously two distinct shades; the underlying six-value `ClimbCategory` data and its separate text labels are unaffected, only the colour merges, and the legend shows one combined "Uncategorised or Category 4 climb" row rather than two identically-coloured ones. Detailed climb bands render only within the climb selected via the pre-ride dropdown, a map/chart tap selection, or (during active Riding) the climb currently occupied — exactly the same selection precedence the fifth slice already established — never across the whole route. **Descents** keep three blues rather than collapsing to one: a renamed `DescentBand` (`"moderate" | "steep" | "very-steep"`, thresholds unchanged at −6%/−9% from the retired `DescentSeverity`) is now used identically at both the macro level (the complete descent's own average gradient) and, newly, at the local level (`classifyDescentLocalKey`, the same smoothed local gradient a selected/active descent is drawn from) — unlike climbs, a descent's macro and local classification are literally the same scheme, so the legend shows the three descent rows only once, in the macro section, with the "Detailed local gradient" section explaining that a selected descent reuses those same three colours locally. A local stretch shallower than the −3% descent-eligibility threshold (a flat or brief rise inside an otherwise-recognised descent) resolves to `"neutral"` and renders as the plain ordinary-route colour rather than any blue — a deliberate asymmetry from climbs, whose shallow/flat/descending local sections still render green. `RouteFeatureDetailsPanel` gained one fixed disclaimer for descents: "Blue intensity reflects gradient steepness only, not surface, bends, traffic or other conditions." A new `src/navigation/routeFeatureDetail.ts` (`buildFeatureDetailSegments`) builds these detail segments per selected/active feature by generalising `gradient.ts`'s own classify→merge-adjacent→suppress-flicker pipeline (`ClassifiedSegment<Class>`, `classifyRunGrades`, `clipClassifiedSegments`, `findClassifiedSegmentAtDistance`) over an arbitrary classification, so climbs and descents share one tested algorithm rather than two copies; because this does real work over one run (unlike the cheap clip-only approach it replaces), both screens memoise the call, keyed on the selected/active feature and the route's analysed runs. This slice also fixes a real, narrow defect found in the code it was rewriting: `elevationChartGradient.ts`'s local-gradient chart overlay coerced any run outside the currently-narrowed detail range to a synthetic grey "unknown" colour instead of falling through to plain `currentColor` like its sibling macro-feature overlay already did, which — since both screens have narrowed this range to the selected/active feature ever since the fifth slice — painted a solid grey stroke over every other climb/descent's own macro colour; the replacement `buildFeatureDetailChartRuns` preserves `visualKey: null` for an out-of-range run, and `ElevationChart.tsx`'s overlay now omits `null` runs entirely rather than rendering a coercion. `MicroDetailVisualKey` (`routeFeaturePalette.ts`) is the shared nine-value key space (five climb bands, three descent bands, `neutral`) driving one authoritative `MICRO_DETAIL_COLOURS`/`MICRO_DETAIL_LABELS` pair consumed identically by the map's micro layer, the chart's detail overlay, the new `ClimbGradientBandLegend` (replacing `GradientLegend`), and `GradientSegmentDetailsPanel` — no second copy of thresholds or colours anywhere. An eighth slice completes Future-backlog item 8: the openrouteservice adapter already requested `instructions: true` and `normalizeOpenRouteServiceRoute.ts`'s `buildManoeuvres` already built `PlannedRoute.manoeuvres` from ORS's `segments[].steps[]`, but nothing consumed that data anywhere in Riding, and the `type` field was a bare stringified ORS numeric code, not a canonical value. `Manoeuvre.type` (`src/domain/types.ts`) is now the canonical, provider-independent `ManoeuvreType` union (`start`/`continue`/six directional variants/`u-turn`/`roundabout`/`waypoint`/`finish`/`unknown`); `src/routing/manoeuvreTypes.ts`'s `decodeOrsManoeuvreType` decodes ORS's raw codes into it, mirroring `surfaceCodes.ts`'s own never-throws decode style, and `buildManoeuvres` now also drops a step whose `way_points[0]` is not a genuinely valid in-bounds index (rather than defaulting it to distance 0), caps instruction length, and sorts the result by distance. This surfaced and fixed a real, previously-latent bug in `stitchPlannedRouteLegs.ts`: its leg-boundary manoeuvre dedup only ever matched an exact type-and-instruction equality, so it could never recognise ORS's own real per-leg Arrive/Depart step pair (distinct types, distinct instruction text) — every internal waypoint of a multi-leg Planning route was silently getting both a spurious "arrived" and a spurious "departed" manoeuvre. Since every leg's own trailing step now decodes context-free to canonical `finish` and its own leading step to `start`, the dedup rule was replaced with a narrower, correct one: a leg boundary's `finish`+`start` pair (within the existing seam tolerance) now collapses into one `waypoint` manoeuvre, dropping its instruction (neither leg's own arrive/depart text is correct mid-route); the very first leg's `start` and the very last leg's `finish` are never touched. A route's `manoeuvres.length > 0` is already sufficient, existing proof of trusted (openrouteservice-derived) data — GPX import (`normalizeGpx.ts`) always sets it to `[]` and no other code path writes to it — so no new provenance flag was added anywhere (superseded by the ninth slice below, which adds an explicit `ManoeuvreProvenance` field once GPX import can legitimately carry manoeuvres too). A new pure `src/navigation/nextManoeuvre.ts` selects the next manoeuvre from the existing frozen/reliable `presentationDistanceFromStartMetres` (never the live matched distance), giving the off-route-freeze and stale-restore behaviour for free; a named `MANOEUVRE_REACHED_TOLERANCE_METRES` (15 m, order-of-magnitude comparable to `offRoute.ts`'s own thresholds) must be passed by at least this much, not merely approached within it, before a manoeuvre counts as reliably passed, and advancement is monotonic against a caller-held `previousReachedIndex` so GPS jitter can never regress the shown manoeuvre. `RidingNextManoeuvrePanel` (Riding-only, shown once riding is active, mirroring `RidingClimbSelector`'s own idle-only visibility inverted) shows a small project-owned SVG `ManoeuvreIcon` (no external asset, inline-styled like `GradientColourSwatch`), the provider's own instruction text (or a generic per-type label when absent), and a distance whose rounding tier and font-size/weight band (this slice's own judgement calls, not literal CLAUDE.md figures) become more prominent inside 500 m and again inside 100 m — driven by inline style, not a CSS class, for the same "Vitest never loads index.css" reason `GradientColourSwatch` already documents. Only the instruction text carries `role="status"`, so it announces a genuine manoeuvre or urgency-band change but never the continuously-updating numeric distance beside it. A planner route with no usable manoeuvres shows an explanatory "Turn information is unavailable for this route" message; an ordinary imported GPX shows its own explanatory message and never an inferred turn, since `normalizeGpx.ts` never produces manoeuvres from geometry. No IndexedDB schema/migration was needed: `manoeuvres` already round-trips through `routesRepository.ts`'s raw Dexie `put`/`get` untouched. A ninth slice closes the GPX round-trip gap this left behind: exporting a planned route already wrote a flat, unbound `<acn:manoeuvre>`/`<acn:source>` extension, but nothing on import ever read it back, so a planned-then-exported-then-reimported route silently lost its turns. The exporter's existing namespace (`https://adf-md.github.io/amazing-cycling-navigation/gpx-extensions/v1`, unchanged — never yet consumed by anything, so restructuring its contents cost nothing) now writes a geometry-bound envelope, `<acn:navigation version="1" pointCount="N" geometrySha256="<64-char lower-case hex>">`, nested (as before) inside the track's own shared `<extensions>` alongside the unrelated `<acn:source>` provenance element; each `<acn:manoeuvre trackPointIndex="N" distanceMetres="X" type="...">` inside it carries an `<acn:instruction>` child (previously an attribute). `trackPointIndex` is the nearest of the route's own exported track points to that manoeuvre's distance (`navigation/distance.ts`'s new `nearestPointIndexForDistance`, a binary search — needed because a stitched multi-leg route's manoeuvre distance can legitimately fall between two points, not exactly on one) and is the round trip's primary anchor; `distanceMetres` is the canonical route distance, kept as a secondary validation/forward-compatibility value. `geometrySha256` binds the envelope to the exact exported track: `src/gpx/geometryDigest.ts`'s `canonicalizeTrackGeometry` joins each point's `lon,lat` (via the exact same bare `String(x)` the exporter already writes into `<trkpt>`, so export-time and import-time canonicalisation provably agree; elevation excluded, since anchoring is index/distance-based) with `\n`, and `computeGeometryDigestHex` hashes it with `crypto.subtle.digest("SHA-256", …)` — an integrity/binding check, not a digital signature. This makes `exportRouteToGpx` genuinely `async` for the first time (both UI export call sites and every test call site updated accordingly); if trusted manoeuvres exist but Web Crypto is unavailable, export throws a typed `GpxExportError` rather than silently dropping the turn data, while a route with no trusted manoeuvres is unaffected either way. Trust is now an explicit, provider-independent `ManoeuvreProvenance` field on `PlannedRoute` (`{ kind: "routing-provider"; provider: string }` or `{ kind: "acn-gpx-extension"; version: 1 }`, `src/domain/types.ts`), read by one shared predicate, `src/domain/manoeuvreTrust.ts`'s `hasTrustedManoeuvres` — replacing the old `sourceKind === "gpx-import"` short-circuit `RidingNextManoeuvrePanel` and `RidingScreen` used to gate on. A route saved before this field existed (or an ordinary GPX import that never carried a validated ACN extension) has no `manoeuvreProvenance` at all and falls back to exactly the previous implicit rule (`source.kind === "planner" && manoeuvres.length > 0`), so every pre-existing stored route and every ordinary GPX import behaves identically to before, with no IndexedDB migration (a plain new optional field on the already-blob-stored `PlannedRoute`). `RidingScreen` gates both `selectNextManoeuvre`'s own input (an empty list when untrusted) and the panel's messaging on `hasTrustedManoeuvres`, restoring the invariant "a non-null selection is always trustworthy" even though a `gpx-import`-sourced route can now legitimately carry manoeuvres. Import-side reading (`src/gpx/parseAcnExtension.ts`'s `readAcnNavigationExtension`) is namespace-aware throughout (the `acn:` prefix itself is never trusted, only the namespace URI) and scoped to exactly the track `parseGpx.ts`'s `extractRoutePoints` actually selected (a new `selectedTrackElement` result field) — never a second, non-selected `<trk>`, and never an extension nested inside a per-point `<extensions>`, since only the track's own direct-child `<extensions>` is ever consulted. Validation is strictly all-or-nothing: an unsupported `version`, a `pointCount`/digest mismatch, an out-of-range or non-integer `trackPointIndex`, a non-finite/negative/out-of-order `distanceMetres`, or a manoeuvre count above the defensive `MAX_ACN_MANOEUVRES` (10,000 — a sanity cap, not this file's primary size defence, which remains `validateGpxFile`'s whole-file `MAX_GPX_FILE_SIZE_BYTES`) discards the entire envelope, never a partial manoeuvre list, while the ordinary track/elevation import always still succeeds; a rejected-but-present extension surfaces one non-blocking `GpxImportNotice` ("This GPX contained turn information, but it did not match the route geometry and was ignored."), reusing the same notice mechanism as the existing multiple-track/-route warnings. An unrecognised `type` string coerces to `"unknown"` rather than rejecting the envelope (matching `decodeOrsManoeuvreType`'s existing never-throws policy), and each manoeuvre's `distanceMetres` is sanity-checked against its `trackPointIndex`'s own recomputed distance using a tolerance that adapts to the local point spacing at that index (never a flat constant, which would either be too tight for sparse provider geometry or too loose for dense geometry) — a structural guard layered on top of the digest, not a replacement for it. Re-exporting a re-imported ACN route reproduces the same manoeuvres losslessly, since the reader stores each manoeuvre's canonical, recomputed point-distance rather than the raw attribute text, making the next export's own nearest-point lookup exact. Interoperability is unchanged from what the namespace mechanism always implied: this remains a standards-compatible GPX 1.1 track that any reader can open, ignoring the unknown `acn:` extension; another application may strip unknown extensions entirely when rewriting the file; round-trip turn preservation is guaranteed only for direct export-then-import through this app; and none of this implies Garmin or FIT course-point compatibility, which remains a distinct, unimplemented feature. Still outstanding: optional wake-lock — see "Future backlog" below.

Do not start a later milestone by weakening or bypassing earlier reliability requirements.

## Future backlog

The following items are approved directions or confirmed bugs for future work. They are recorded here for continuity across sessions and must not be implemented until a future slice explicitly scopes them in.

### Navigation and library interface

6. **Header hierarchy**
   - The persistent product name currently consumes space while screen/route titles are more relevant.
   - Preferred direction: screen or route title becomes the single visible h1; product name remains in document title, manifest and Home Screen name.
   - Mark this as requiring a final design discussion before implementation, not as a settled UI requirement.

7. **Inline route-deletion confirmation**
   - Show Cancel/Delete confirmation directly beneath the affected route.
   - Only one route pending deletion at a time.
   - Preserve keyboard/focus behaviour and explicit irreversible-action wording.

### Remaining Milestone 4 features

8. **Trusted next manoeuvre and distance — done**
   - Milestone 4's eighth slice completes this item: `PlannedRoute.manoeuvres`, originally populated only from openrouteservice-planned routes, drives a Riding-only "next manoeuvre" panel with a road-bike-speed-appropriate advance display and a distance that becomes increasingly prominent inside 500 m. The ninth slice extends trusted manoeuvres to a validated ACN GPX re-import too, via the explicit `ManoeuvreProvenance` field and `hasTrustedManoeuvres` predicate described there. See Milestone 4's own eighth- and ninth-slice paragraphs above for full detail.

9. **Climb detection and summary segments — done**
   - Gradient colouring itself was implemented in Milestone 4's third slice (`src/navigation/gradient.ts`, `gradientPalette.ts`, `src/map/gradientRouteLayer.ts`) — noise-resistant analysis, accessible non-colour legend cues, and shared classification between the elevation chart and the map.
   - Milestone 4's fifth slice completes this item: `src/navigation/routeFeatures.ts`'s `detectRouteFeatures` groups the same shared analysis into named, Garmin-scored climbs and app-specific-severity descents; `RouteFeatureDetailsPanel` is the climb/descent "summary card", showing position, length, gain/loss, average and maximum gradient, and climb score, reusing the shared analysis rather than re-analysing. See Milestone 4's own fifth-slice paragraph above for full detail.

10. **Optional wake lock**
    - Off by default.
    - Riding mode only.
    - Safe visibility/suspension recovery and unsupported-browser behaviour.

### Optional external-data feature

11. **Weather**
    - Candidate provider: Open-Meteo free non-commercial API, no API key.
    - Current conditions plus approximately the next three hours.
    - Temperature, precipitation, wind speed, gusts and direction.
    - Manual or restrained refresh, never a dependency of Planning/Riding.
    - Required attribution and privacy disclosure because location is sent to a weather provider.
    - Must fail independently and gracefully.

### Separate feasibility project

12. **Offline map storage**
    - Do not implement until the active tile provider explicitly permits deliberate offline prefetching.
    - Investigate route-corridor/selected-area storage, style/sprite/glyph dependencies, iOS eviction, size estimates and available-storage checks.
    - Preferred eventual architecture: global tile cache keyed by URL, per-route references, deduplication across routes, deletion only when no route references a tile.
    - Offer bounded detail presets and estimate storage before download.
    - Never bulk-prefetch from an OSMF community tile endpoint that prohibits offline download.
