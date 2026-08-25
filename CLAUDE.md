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

Sharing, above, currently means: no inbound file-association or universal route-link work. An Android Web Share Target for inbound GPX import is a deferred, evidence-gated feasibility item (see Future backlog item 61), not flatly excluded — do not begin implementing it outside that item's own staged, real-device-gated plan. Sharing a GPX through Messages, Mail or another application, followed by manual GPX import, remains sufficient for the current product; iOS cannot currently provide the cross-platform installed-PWA "Open with GPX" experience that would be desired here, so do not promise it, and this note does not change that iOS limitation. This can be reconsidered later without blocking ordinary GPX export/import — do not remove the existing outward GPX export functionality, or any already-supported use of the Web Share API, on the strength of this note.

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
- Offer upcoming-elevation windows of 2 km and 10 km, defaulting to 2 km.
- Always distinguish a stale fix from a fresh one and show fix age when relevant.
- After a location error, Try again must reactivate or replace the location watch and request camera follow. Once a fresh fix is accepted, the error clears, geolocation status returns to watching, and the Follow-location and north-up controls reappear automatically, without reopening or restarting the route. A location error preserves the last known fix as stale rather than discarding route progress or resetting the camera to overview.
- A second Northwards press after an intervening manual rotation, and a second Follow-location press with an unchanged GPS fix after an intervening manual gesture, must both genuinely re-apply the camera rather than being silently swallowed. This was a confirmed field bug for Northwards (real-device testing showed a repeat press could do nothing after a manual rotation/tilt) and, on investigation, an equally reproducible defect for Follow-location: both explicit commands previously shared MapView's single value-based `cameraTarget` deduplication with automatic GPS-driven updates, so a second press producing byte-identical target values as the first (the north-up reset is always the same fixed values; a stationary rider's resumed-follow bearing resolves identically once a manual gesture clears the rotation dead band) was indistinguishable from an unrelated rerender and discarded. Fixed by giving `CameraTarget`/`RideCameraCommand` an optional `requestId`, generated by a plain monotonically-increasing counter in `useRideCamera.ts` (never a timestamp or `crypto.randomUUID()`) for these two explicit commands only: when present and different from the last-applied one, MapView reapplies the camera even though the values are unchanged; when absent — every automatic fresh-fix follow update and the one-time restore jump — deduplication stays exactly as value-based as before, so unrelated rerenders and repeated stationary fixes still never restart the camera or jitter.
- Restoring a suspended ride into `following` camera mode with only a stale fix (before Resume riding is pressed, or while it's still awaiting the first fresh fix afterwards) must show the pre-ride full-route overview, never MapLibre's raw default world view. `useRideCamera` tracks a sticky, monotonic `hasActionableCameraTarget` latch (true only once a real camera command — a live follow ease or a restore jump — has actually been produced this route-open session; reset only when the camera genuinely returns to `overview`, via a new route or an overview-mode restore) and `RidingScreen` passes that, not a raw `camera.mode !== "overview"` check, as `MapView`'s `suppressInitialOverviewFit`. This makes the pre-ride framing independent of whether restoration or the map's own style-readiness wins the startup race, and the latch's monotonicity also stops a later mid-ride manual pan (following → free) from spuriously re-triggering the overview fit.
- Project each accepted GPS fix onto plausible route segments.
- Preserve progress continuity at self-intersections and out-and-back sections. Do not simply choose the globally nearest segment when that would jump implausibly along the route.
- Base off-route classification on both lateral distance and reported GPS accuracy. Require repeated evidence before showing a strong off-route warning.
- A saved route must work without map tiles; use a neutral fallback background when necessary.
- Imported GPX files generally do not contain reliable manoeuvres. Do not infer or promise turns from geometry alone. Show next-turn information only when trusted manoeuvre metadata exists.
- When trusted manoeuvres are added, show them early enough for road-bike speeds and make the remaining distance increasingly prominent inside 500 m.
- Current GPS speed may inform plausibility or presentation, but do not retain speed history or turn the feature into ride recording.

## Planning behaviour

- Add, insert, drag, reorder, and delete waypoints with undo/redo.
- Tapping the currently selected waypoint again deselects it, leaving its coordinate, order and the routed result unchanged and triggering no recalculation or undo/redo entry; tapping a different waypoint transfers selection instead. While an explicit Move or Insert-after relocation is active for that waypoint, re-tapping it leaves the relocation active — only the existing Move/Insert-after toggle-off or the placement/confirmation action ends it.
- Include an explicit “return to start” action for closing a loop. Do not generate a loop automatically.
- Recalculate only changed route legs and debounce drag completion.
- Retain the last successful route when a provider request fails.
- Never silently substitute straight lines for failed routed legs.
- Show distance, ascent, descent, and elevation profile before export.
- Offer two road-cycling profiles, selectable in Planning: `cycling-road` (Road bike, default for every new draft) and `cycling-regular` (General cycling, may use more cycling infrastructure but is not a guarantee of paved surfaces or road-bike suitability). One profile drives every leg of a given route; no automatic fallback between profiles. For openrouteservice, use each profile's own recommended routing preference rather than merely the shortest route.
- Strongly prefer asphalt and other reliably paved surfaces, including suitable paved cycleways.
- Strongly discourage or avoid steps, fords, foot-only paths, dismount sections, sand, grass, ground and rough tracks.
- Treat fine gravel, compacted surfaces, paving stones and similar surfaces as configurable or questionable rather than universally suitable.
- Do not hard-reject an otherwise valid road solely because its surface tag is missing. Record and display the unknown distance instead.
- Request provider surface, way-type and access metadata where available, normalise it into provider-independent warnings and retain provenance.
- Show route distance, ascent, descent, paved distance or proportion, questionable distance, and unknown-surface distance before export. Estimated duration is secondary for exercise and leisure rides.
- Make questionable, unsuitable and unknown segments inspectable on the map. Never present incomplete map data as a guarantee that a route is paved or legally accessible.
- Keep ferry avoidance configurable instead of silently rejecting all ferries.
- A genuinely fresh Planning session (no restored draft, no waypoints yet) frames an approximately 50 × 50 km area around the rider's approximate location. A restored draft or any existing waypoint always takes precedence, and this automatic framing is skipped entirely in that case. On the first successful Planning geolocation in a fresh session, the map performs this existing one-time regional framing around the position, approximately a 50 × 50 km box. Subsequent Locate-me actions only recentre on the latest valid position, preserving the current zoom, bearing and pitch. They do not repeat the regional box fit or enable follow mode. If Locate me/Retry produces the session's first successful location before the user has established another camera view, it may use the initial regional framing; once initial framing has occurred, Locate me always uses recentre-only behaviour. Updating the location marker never retriggers the box fit. The control has its own visible locating/failure/retry state and never overrides in-progress waypoint editing; once resolved, the rider's approximate current location is also shown on the map as a plain dot, preserved across a failed retry rather than cleared. A north-up/top-down control mirrors Riding's semantics (resets bearing and pitch to 0° without recentring, changing zoom, or introducing following mode or camera tilt).

The first provider adapter should target openrouteservice, offering its `cycling-road` and `cycling-regular` profiles, but provider-specific code must remain isolated. The API key is user-supplied and local. Handle `401`, `403`, `429`, network failures, cancellation, malformed responses, and quota headers where available. Do not call the provider continuously while a waypoint is being dragged.

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
- Pin the exact Node.js version (via `.nvmrc`, read by CI through `actions/setup-node`'s `node-version-file`) and its bundled npm version; fail CI immediately if the resolved versions don't match, and use `npm ci`.
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

- `src/index.css` carries a small shared visual foundation: spacing tokens (`--space-4` through `--space-32`), two radius tokens, one restrained shadow token, colour roles including `--colour-info`/`--colour-info-soft`, a button vocabulary (`.btn-primary`/`.btn-secondary`/`.btn-danger`), and layout classes (`.screen`, `.stack`, `.row`). This foundation was rolled out across all five screens (Routes, Settings, Riding, Planning, Diagnostics) in seven documented slices, including a real CI-driven MapLibre drag-rotate/pitch gesture bug found and fixed during the fifth slice (a fractional map-container height left the handler permanently "active" with no `moveend`/`rotateend`; fixed with a `round()`-snapped 20px grid behind an `@supports` fallback chain). Full slice-by-slice detail, including the exact classes, component-by-component migration order, and every real regression found along the way: [`docs/project/history/interface-accessibility-migration.md`](docs/project/history/interface-accessibility-migration.md).

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
- When repairing a broken lockfile or toolchain pin, reconstruct the smallest deterministic diff against the last known-good commit (e.g. a literal version-string patch) rather than regenerating via `npm install`; a full re-resolution can silently add, drop, or re-nest transitive or optional dependencies well beyond the intended fix.
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
3. **Planning**: waypoint editing, `cycling-road` provider adapter, paved/unknown-surface analysis, route statistics, elevation, local save, GPX export. Delivered across six slices: initial ~50×50 km map framing and a Locate-me control; crosshair-placement and identifiable waypoint-marker fixes; direction arrows along routed geometry; kilometre distance-badge markers; the selectable `cycling-regular` ("General cycling") routing profile alongside the default `cycling-road`; and current-location-dot/profile-selector visual polish.
4. **Riding enhancements**: trusted next manoeuvre with road-speed-appropriate advance display, distance to turn, gradient colouring, simple elevation/climb segments, optional wake-lock. Delivered across fourteen slices: the selectable Full/2/5/10 km elevation view; a location-watch lifecycle fix restoring Follow-location/north-up controls after a retry; noise-resistant gradient (uphill/downhill) colouring (`src/navigation/gradient.ts`); a unified elevation/gradient analysis pass; a two-level, Garmin-ClimbPro-inspired climb/descent presentation (macro climb/descent recognition plus micro local-gradient bands) with Garmin's own published scoring; a legend-visibility bug fix and a pre-ride climb selector; retirement of the old seven-class whole-route gradient scheme; the trusted next-manoeuvre panel driven by `PlannedRoute.manoeuvres`; its GPX round-trip via a geometry-digest-bound `<acn:navigation>` extension; an optional off-by-default wake lock; the current-climb elevation view with automatic entry/dismissal; a compacted wake-lock presentation; a detailed pre-ride climb-profile preview; and, after real-device feedback showed it was surprising, reverting automatic first-climb selection so the pre-ride dropdown starts on "All route".

Full slice-by-slice detail for Milestones 3 and 4, including every component/file touched, real regressions found, and rejected alternatives: [`docs/project/history/delivery-milestones.md`](docs/project/history/delivery-milestones.md).

Do not start a later milestone by weakening or bypassing earlier reliability requirements.

## Manual acceptance status

This is a concise summary; the full ledger — including exact dates, commit/version identifiers, and device limitations — is the single authoritative record and lives in [`docs/project/current-status.md`](docs/project/current-status.md).

Broadly confirmed on the installed iPhone Home Screen PWA: Routes (rename/export/delete/pinning/search/sort), Planning (waypoint editing, both routing profiles, warnings, save/export), the pre-ride briefing and camera framing, active road-bicycle Riding (position/progress, Follow/North-up, trusted manoeuvres, elevation views, wake lock), current-climb interaction and live climb progress, closed-loop route completion, the Ride launcher and Finish/End-ride flows, Diagnostics/Settings layout, and PWA suspension/reload recovery. Still outstanding: free roam has only a walking-speed field test (bicycle-speed direction-following, stationary-bearing stability, and battery/thermal behaviour remain unverified), several recent map-camera/immersive-shell/wake-lock slices have no real-device confirmation yet, and physical Android verification (distinct from Playwright's Chromium-emulated `android-chrome` project) is outstanding almost everywhere. Do not describe any of these as verified beyond what `current-status.md` itself records.

## Future backlog

This section is a short, always-loaded index only. The complete, authoritative record — every approved future item's full specification, every monitored reliability observation, and the entire shipped implementation history — lives in [`docs/project/`](docs/project/README.md), split into bounded files so it stays within Claude's automatic project-memory allowance. Read the map and protocol below before touching any of it.

### Project documentation map

- **Root `CLAUDE.md`** (this file) — durable product and engineering rules that apply to every task, plus this short index. Always loaded.
- **[`docs/project/README.md`](docs/project/README.md)** — the full documentation index: what lives where, the stable item-number convention, and how to add new work without rebuilding a monolithic file.
- **[`docs/project/backlog.md`](docs/project/backlog.md)** — full, byte-preserved specifications for every approved-but-not-yet-implemented item. This is where a pending item's complete contract lives.
- **[`docs/project/current-status.md`](docs/project/current-status.md)** — the full manual acceptance ledger and monitored reliability observations (items neither approved future work nor fully resolved).
- **[`docs/project/history/`](docs/project/history/README.md)** — the complete shipped implementation record: every completed item's full text, plus the Delivery-order milestone narrative and the Interface-and-accessibility visual-migration narrative.

### Required reading for a slice

1. Read this root file for durable constraints.
2. Read the complete active item in [`docs/project/backlog.md`](docs/project/backlog.md) in full before implementing it.
3. Inspect current source and tests for present implementation facts.
4. Use the history index ([`docs/project/history/README.md`](docs/project/history/README.md)) and any completed items it references for rationale or precedent.
5. Use [`docs/project/current-status.md`](docs/project/current-status.md) for acceptance evidence and known field-test limitations.

Archived implementation accounts in `docs/project/history/` describe the system **at the time each was recorded**. Current source and tests are authoritative whenever later work has superseded an old implementation detail — but the archived rationale, rejected alternatives, and real regressions they document must not be discarded; they remain valuable precedent.

### Queue index

Stable item numbers never change regardless of which file an item's text lives in. Item 81 is selected as the next implementation item, followed by items 82, 83 and 84 in order.

| Item | Title                                                                                         | Status                                           | Full entry                                                            |
| ---- | --------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| 11   | Weather                                                                                       | Pending                                          | [`backlog.md#item-11`](docs/project/backlog.md#item-11)               |
| 12   | Offline map storage                                                                           | Pending                                          | [`backlog.md#item-12`](docs/project/backlog.md#item-12)               |
| 16   | Desktop two-column Planning layout                                                            | Pending                                          | [`backlog.md#item-16`](docs/project/backlog.md#item-16)               |
| 28   | Optional adaptive compact navigation while scrolling                                          | Pending, not approved/scheduled — candidate only | [`backlog.md#item-28`](docs/project/backlog.md#item-28)               |
| 59   | Elevation and recognised-climb discrepancy investigation                                      | Pending investigation                            | [`backlog.md#item-59`](docs/project/backlog.md#item-59)               |
| 60   | Battery consumption investigation and possible battery-saving mode                            | Pending investigation                            | [`backlog.md#item-60`](docs/project/backlog.md#item-60)               |
| 61   | Android GPX share-sheet import feasibility                                                    | Pending feasibility study                        | [`backlog.md#item-61`](docs/project/backlog.md#item-61)               |
| 81   | Preserve Riding zoom through stale-GPS and imagery-retry recovery                             | Selected as the next implementation item         | [`backlog.md#item-81`](docs/project/backlog.md#item-81)               |
| 82   | Unify the active status control and make the climb cue fully readable                         | Pending, approved — queued behind item 81        | [`backlog.md#item-82`](docs/project/backlog.md#item-82)               |
| 83   | Make offline and map-imagery recovery unobstructive                                           | Pending, approved — queued behind item 82        | [`backlog.md#item-83`](docs/project/backlog.md#item-83)               |
| 84   | Restore visibly rendered, zoom-adaptive route-distance badges                                 | Pending, approved — queued behind item 83        | [`backlog.md#item-84`](docs/project/backlog.md#item-84)               |
| 32   | `ridingFinishAndEnd.spec.ts`'s completion-detection test: an unconfirmed CPU-contention flake | Monitored, unconfirmed                           | [`current-status.md#item-32`](docs/project/current-status.md#item-32) |
| 66   | Investigate intermittent fresh-Start Follow remaining at route overview                       | Accepted for now, monitored                      | [`current-status.md#item-66`](docs/project/current-status.md#item-66) |

Items 6–10, 13–15, 17–27, 29–31, 33–42, 44–58, 62–65 and 67–80 are completed (`— done`) and live in [`docs/project/history/`](docs/project/history/README.md). Item 43 is a follow-up acceptance checklist and lives in [`docs/project/current-status.md`](docs/project/current-status.md).
