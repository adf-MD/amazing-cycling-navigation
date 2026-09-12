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
- **Phone portrait is the only supported and acceptance-tested orientation** (decided 9 September 2026): it is the orientation a bike computer is used in, and it is what the mounted-phone Riding case above already assumes. Short-landscape usability is therefore not a requirement, and landscape acceptance checks are retired wherever they appear — `docs/project/current-status.md` records which open entries this closed. This is a scope decision, not a technical lock: do **not** deliberately break landscape, add a rotation-blocking overlay, or state anywhere that orientation is locked. Whether to _request_ portrait through the web-app manifest is a separate implementation decision that would need its own installed-iPhone verification, and is not approved by this rule.

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
- Dependency/supply-chain advisory triage: a confirmed production-reachable advisory (present in `npm audit --omit=dev`, or shown to run in the shipped bundle) blocks the next release candidate until fixed, contained, or explicitly accepted with rationale. A confirmed development-only advisory (absent from `--omit=dev`, demonstrated unreachable via `npm explain`/lockfile-path inspection) is tracked and prioritised by realistic build/contributor exposure, but does not itself block deployment. Dependabot/CodeQL findings are investigation inputs, not auto-merge instructions or proof of ACN-specific exploitability. Never use `npm audit fix --force` or a blind dependency re-resolution merely to make a count go to zero. Action-SHA/container-digest pin updates require provenance re-verification and a full green CI run before merging. Dependabot's `github-actions` ecosystem does not track the Playwright container image (`jobs.<job>.container.image`): every `@playwright/test` version bump must, in the same change, update the container's tag, its digest, and the workflow's `expected_playwright` value together by hand, plus a modest periodic (roughly six-monthly) manual check that the pinned digest still resolves.

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

Broadly confirmed on the installed iPhone Home Screen PWA: Routes (rename/export/delete/pinning/search/sort, plus route tagging, tag filtering, the global rename/merge/delete tag lifecycle and the item 106 tag-control rework, whose acceptance closed item 100 stage 4B), Planning (waypoint editing, both routing profiles, warnings, save/export), the pre-ride briefing and camera framing, active road-bicycle Riding (position/progress, Follow/North-up, trusted manoeuvres, elevation views, wake lock), current-climb interaction and live climb progress, closed-loop route completion, the Ride launcher and Finish/End-ride flows, Diagnostics/Settings layout, and PWA suspension/reload recovery. A bicycle field test on 12 September 2026, on deployed `0.4.29`, added free roam (item 42), direction-aware route layering (item 98), overlapping-turnaround progress (item 104), route reacquisition (item 107) and the relocated riding imagery status with its compacted climb cue (item 108) — as **broad product-level acceptance** that each item's intended behaviour worked during actual bicycle use, never as separate verification of individual clauses, failure modes or recovery variants — plus full acceptance of item 110's north indicator and revised map controls. Still outstanding: several riding-presentation, status-card, recovery and offline slices have no real-device confirmation yet — including item 115's lower-right climb cue and compact imagery-recovery row, which carry automated evidence only — and physical Android verification (distinct from Playwright's Chromium-emulated `android-chrome` project) is outstanding everywhere. `current-status.md` now carries **one** consolidated installed-iPhone checklist, organised by test session, plus an opportunistic-monitoring list for conditions that must not be manufactured; do not describe anything as verified beyond what that ledger itself records, and do not reintroduce per-item outstanding checklists.

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

Stable item numbers never change regardless of which file an item's text lives in. **Item 100 is complete**: stages 1–3 (data model and storage; tag editing and reusable suggestions; tag filtering and organisation) and stage 4A (the global rename/merge/delete tag lifecycle plus empty-state coverage) all shipped, and **stage 4B's installed-iPhone acceptance closed on 10 September 2026**. Its full record lives in [`docs/project/history/items-100-103.md`](docs/project/history/items-100-103.md#item-100), and what that closure does and does not assert — iOS Dynamic Type never established, the induced write-error case non-blocking, landscape retired, physical Android still outstanding — is set out in [`docs/project/current-status.md`](docs/project/current-status.md). Stage 4B's field test duly turned up two reveal-scrolling observations, and they became their own evidence-led follow-up, **item 105**, rather than reopening item 100. Item 105 was then deliberately reprioritised ahead of item 101 so that item 100 could be concluded, shipped in `0.4.20`, and **failed its installed-iPhone acceptance**; its three resulting observations became **item 106**, implemented in `0.4.21` and **accepted on the installed iPhone on 10 September 2026**, which is what closed stage 4B. Both records live in [`docs/project/history/items-104-109.md`](docs/project/history/items-104-109.md#item-106). Two cautions worth carrying forward: item 105's second behaviour was corrected before implementation (the field report's "reveal the Merge/Delete confirmation" wording mis-recorded the request), and item 106's root cause turned out **not** to be the hypothesis it started from — a focused control unmounted mid-event, proved in a browser, rather than the visual viewport. **Item 101 has since shipped in `0.4.22`, completed by a `0.4.23` follow-up** — plain-language HTTP-status guidance in Routing diagnostics, a concise closed-by-default disclosure beside the existing no-response explanation, with no routing, redaction or behaviour change; the follow-up groups it by status class as nested lists (Success 2xx, Redirects 3xx, Request or access problems 4xx, Service problems 5xx, No HTTP status), names OpenRouteService's documented codes including the `200` a successful connection test produces, and corrects the lead-in — an exposed status is recorded in Recent routing attempts, a failed connection test also shows it, and a successful one cannot, since `RoutingProvider` returns a `PlannedRoute` carrying no status; its record is [`docs/project/history/items-100-103.md`](docs/project/history/items-100-103.md#item-101). An installed-iPhone field test on **10 September 2026** then produced seven further pieces of work, filed as **items 107–113** — see [`docs/project/current-status.md`](docs/project/current-status.md) for the dated evidence and [`docs/project/backlog.md`](docs/project/backlog.md) for each full specification. By product decision all seven precede items 102 and 103, which keep their numbers and are **not** renumbered. Items 112 and 113 open with investigation or decision stages, so their eventual implementation designs are deliberately not described anywhere yet: item 112 is **not** approval to merge Diagnostics and Settings or to adopt any particular name for them, and item 113 approves no German wording, no automatic language selection and no internationalisation library. **Item 107 has since shipped in `0.4.24`.** Its investigation confirmed a reachable defect at a boundary item 104 had already documented and deliberately left: `projection.ts`'s whole-route reacquire fallback discarded the still-valid `lastMatch` anchor, so a suspension gap on repeated geometry let Turf's array-order tie-break lock progress onto a distant identical occurrence — measured as a 2519 m backwards jump on an exact out-and-back, and a collapse to `+0` at a closed loop's shared start/finish. The reacquire branch now applies the same continuity rule the windowed branch already used, with no new constant and no storage change. It selects the **continuity-consistent** occurrence, which is not a claim of ground truth, and the observation's "closely adjacent" (non-coincident) half remains unaddressed and unproved; its record is [`docs/project/history/items-104-109.md`](docs/project/history/items-104-109.md#item-107), and it was **accepted on the bicycle on 12 September 2026** at product level — which does not verify backgrounding versus flight mode, automatic recovery versus pressing Try again, or the closely-adjacent half. **Item 108 has since shipped in `0.4.25`**, moving all active Route-riding and free-roam map-imagery status into the existing top status card — the in-map initial-loading and delayed-imagery messages are now suppressed too, so an active riding map shows no imagery message at all, while Planning and every other unhosted context keep theirs unchanged. Its two findings are worth carrying forward. First, free roam's route-claiming copy turned out to be reachable in the **unhosted** map as well, not only in the status card: Pause is enabled before the first fix, and pausing then hides the card while `MapView` stays mounted — so the shared copy table moved into `src/map/` and gained a context argument, keeping exactly one state-to-copy mapping for both surfaces. Second, the climb cue's mechanism was **not** what the field report's "three lines" implied: at 390x844 the text block was 206px wide holding at most ~120px of content, and item 82's `flex-wrap` safety net was pushing the View climb action onto its own line on every render at phone width. Removing the wasted width took the cue from 230x91 to 144x91 at an unchanged height, with no truncation and no smaller type; placing the action beside the text at that width was measured to be impossible within the item's own constraints. Its record is [`docs/project/history/items-104-109.md`](docs/project/history/items-104-109.md#item-108), and its installed-iPhone acceptance is now complete at product level: the Route-riding no-connection, free-roam, Planning-stays-in-the-map and map-to-status-card hand-off checks were reported positive on 11 September 2026, and the 12 September 2026 bicycle ride accepted the item itself, retiring the separate combined climb-cue plus imagery-status check. No claim is made that the transient slow-loading state was ever physically reproduced. **Item 109 has since shipped in `0.4.26`.** Its cause was a single omission rather than the coupled-stacking hazard the item had warned about: `.planning-crosshair-callout` was the only piece of Planning map chrome with no `z-index` of its own, so — already a stacking context via its own `transform`, but at level 0 — it painted at CSS 2.1 Appendix E's step 6 while `.planning-waypoint-marker` (`z-index: 2`) and `.distance-badge-marker` (`z-index: 1`) both reach step 7, with no intervening stacking context anywhere between them. The correction is entirely callout-side and touches neither half of item 84's coupled pair: `z-index: 3` — strictly above both marker values and strictly below the existing `5` overlay tier, so every other pairwise relationship is preserved exactly — plus a 4px opaque isolation band, because stacking alone still let a marker centred on the button's edge protrude and butt against its border. Two findings are worth carrying forward. First, the defect was **paint-only**: markers are `pointer-events: none`, so every hit-target assertion already passed at the parent and is a regression guard, not evidence. Second, nothing in the repository asserted that a waypoint marker renders at its own waypoint's coordinate — a negative control that moved the marker was initially caught only by a fixture guard throwing, and the gap is now closed by this item's own tests. Its record is [`docs/project/history/items-104-109.md`](docs/project/history/items-104-109.md#item-109), and its **installed-iPhone acceptance passed in full on 11 September 2026** against deployed `0.4.26`: the whole stationary portrait checklist was reported positive. That acceptance claims nothing about landscape, iOS Larger Text or physical Android. Item 109's own 200%-browser-text verification separately measured a pre-existing overlap between `.map-attribution` and the placement control, on the item-109 **parent**, which item 109 neither introduced nor changed; it is now **item 114**, approved and unimplemented, scheduled after item 113 and before items 102 and 103. **Item 110 has since shipped in `0.4.27`**, replacing the static `N` on all three north-up controls (route Riding, free roam, Planning) with a shared, code-native arrow that points at geographic north relative to the rotated map, derived solely from the map camera's own settled bearing — no compass, device-orientation or heading sensor, no permission prompt, no per-frame listener, and no rider-heading arrow on the position marker. The control's action, `aria-label="North-up, top-down view"`, `aria-pressed` and 48px touch target are unchanged. Three findings are worth carrying forward. First, MapLibre's `getBearing()` returns a **signed** `[-180, 180)` value (its `setBearing` wraps before storing radians) while a `RideCameraCommand` reports `[0, 360)` for the same orientation, and **105 of the 360 whole degrees** do not survive that radian round trip exactly — so the bearing is normalised to whole degrees at the reducer boundary, where it enters hook state, and the icon's own guard is only a final defensive boundary. Second, route Riding and free roam retained **no** map bearing at all while `following` (`freeCameraPosition` is cleared outside `free` mode, and `persistableCameraState.bearingDegrees` is hard-coded to `0`), which is precisely the rotated travel-up case the arrow exists for; a new presentation-only `liveCameraBearingDegrees` fixes that without touching persistence. Third, the transform's sign was fixed **empirically** rather than from a table: two Planning waypoints, proved north/south from their stored coordinates, were measured on screen after a real rotation. Its record is [`docs/project/history/items-110-NN.md`](docs/project/history/items-110-NN.md#item-110) — the entry that closed the 104– history range at item 109 and opened a new one — and its installed-iPhone acceptance is **complete**: rotating the map, the indicator updating once the gesture is released, and tapping the control were reported positive on 11 September 2026, and the 12 September 2026 ride then accepted the revised symbols, the `0.4.29` presentation and the pointer's behaviour while actively following a route. Physical Android remains outstanding. A presentation follow-up then shipped in `0.4.28`, drawing all four circular map-control symbols instead of setting them as platform-dependent text characters: the pointer keeps its exact silhouette at a 38px box with an upright `N` at its centre, and the crosshair and zoom glyphs became project-owned SVG. Its own finding is worth carrying forward — because the letter is upright and centred it is invariant under the pointer's rotation, so it must fit the largest **disc** inside the dart (radius 3.3425 units), not the box a 0-degree measurement suggests; 26px and 32px both clip at some bearings, which is why the box is 38px. Those revised symbols were then **exercised on the installed iPhone on 11 September 2026 against deployed `0.4.28`, and every check actually performed passed** — in Planning, in free roam, and in route riding **stationary on a test route**. Two caveats travelled with that: `Waiting…` was **not observed** (transient, and it did not fail — it was still not observed on 12 September, and no acceptance of it is claimed in either direction), and route riding was never **actively followed** in that session, a gap the 12 September ride has since closed. The session also produced two refinements, which became a second follow-up shipped in `0.4.29`: the north artwork grew from 38px to 42px (one constant, with both paths byte-for-byte unchanged so the whole icon scales together — measured clearances 2.730px from the button border and +0.840px for the letter, both invariant across bearings), and the right-hand control order was standardised as **North-up first, Location/Follow second** on every map, with Planning's buttons swapped in the DOM rather than with CSS so keyboard order matches the screen. Both `0.4.29` changes were accepted on the installed iPhone on 12 September 2026. That same 12 September ride produced two further presentation observations, approved as **item 115** and **shipped in `0.4.30`** — a follow-up to item 108, which remains accepted and is not reopened. The active-climb cue moved from the top centre of the riding map to its lower right, out of the route-ahead corridor and nearer the Profile control, and a retryable map-imagery message in the status card now reads as one row (explanation left, `Retry map imagery` right) instead of wrapping the action onto a line of its own — measured 332x84 to 332x64, taking the card from 162px to 142px, with no change to imagery-state derivation, retry semantics, the shared copy table, or any message, role or `data-testid`. Four findings are worth carrying forward. First, the lower-right placement is deliberately an **enhancement gated on available height**, not an unconditional move: at 200% root text the immersive map compresses to 358x206 while the cue reaches 230x206, the attribution wraps to 62px and the paused-Follow toast to 54px, so no arrangement clears both — the base rule stays item 57's top placement and a `@container` size query enables the lower-right one only above a derived 14rem threshold (measured flip: bottom-anchored at a 230px map, top-anchored at 210px). Shrinking `.map-attribution` to make room was rejected outright; it must stay legible and compliant. Second, the size container is a new `.ride-climb-cue-slot` wrapper rather than `.ride-map-container` itself, because `container-type: size` implies `contain: layout` and would have made that element a stacking context, which `e2e/distanceBadges.spec.ts`'s marker/overlay ancestry check depends on it not being; the slot was already a stacking context via `z-index: 5`, so containment adds nothing new there. Third, a "middle third of the map" route-ahead corridor would have been the wrong proof — at a 358px map width a 144px lower-right cue can intersect it while clearing the real route entirely — so the corridor is derived from the **painted** route ahead of a paint-located rider marker, with the marker probe localised to the follow anchor rather than accepting any blue pixel. Fourth, a negative control that let the Retry button shrink **passed at first**: at 390px the row is not tight enough for a shrinkable button to break anything visible, so nothing pinned the action to its own intrinsic width; the test now clones the button at `max-content` and compares, and the rebuilt control fails. Its record is [`docs/project/history/items-110-NN.md`](docs/project/history/items-110-NN.md#item-115). Item 115 carries **automated evidence only** until it is checked on the installed iPhone — and local WebKit could not be launched in the development environment at all, so every browser measurement behind it is Chromium. A fifth finding came out of CI and is worth carrying forward: the pinned Playwright container measures the same build differently from the development host (at 200% root text the immersive map is 358x174 there against 358x206 here), which left only 42px of the `View climb` action inside the map against the project's 44px floor. The first corrective commit changed the test to accept that and **`0.4.30` deployed with the shortfall**; that was the wrong call, because ACN has no iOS Dynamic Type opt-in and the automated 200% root-text coverage is therefore the project's enlarged-text evidence rather than an optional extra. **`0.4.31` restores the contract** with one further `@container` rule that returns the cue's 8px top inset (`top: 0`) only at map heights that cannot afford it — measured 42px to 50px visible in the container, 56px on the host, with nothing shrunk and the ordinary lower-right placement untouched. Item 115's installed-iPhone presentation checklist should be run against `0.4.31`. **Item 116 has since shipped as test infrastructure only, with no version bump** — `0.4.31` stands. It came straight out of item 32's investigation, which had to build its own instrumentation because a failed run retained nothing but reporter text: Playwright now keeps a screenshot for failed tests everywhere, keeps a trace for failed tests **in CI only**, and the E2E job uploads `test-results/` for seven days when that step itself fails. Three findings are worth carrying forward. First, the CI scoping is measured, not preference: `retain-on-failure` records on every run and discards the passes, costing **+23% at 36 workers and +28% at `--workers=4`** — consistent at both, so a per-test cost rather than contention — against **+4%** for screenshots alone; a local failure can always be re-run with `npm run e2e -- --trace retain-on-failure`, whereas CI's container is discarded and has no second chance. Second, the E2E job's `timeout-minutes: 20` was deliberately **not** raised (its last runs took 668 s and 678 s); if it later approaches the limit it should be optimised or sharded. Third, an apparent "tracing destabilises the suite" signal at 36 workers **did not survive** the `--workers=4` comparison, where baseline and tracing lost exactly one test each, so no such attribution is made. A security inspection of a real captured failure found **zero real environment-secret values** across all 81 artefact files; only the synthetic `dummy-e2e-key` appears, and the screenshot shows no key field — though note a trace DOM snapshot does serialise input values, which is why local traces stay gitignored and only CI artefacts are uploaded. Its record is [`docs/project/history/items-110-NN.md`](docs/project/history/items-110-NN.md#item-116). Item 116 needs no physical-device acceptance. **Item 111 has since shipped in `0.4.32`**, adding a contextual prospective route count to every **unselected** tag-filter chip in the Route Library's expanded chooser — how many routes would remain if that tag were added to the current selection. The backlog entry had deliberately left two semantics open, and both are now settled: the count **respects the active name search** (the chooser sits above a list the search has already narrowed, so a count ignoring it would describe a list the rider cannot see), and "where semantically safe" disabling means **`aria-disabled` plus an explicit handler no-op, never the native `disabled` attribute** — a chip can become unavailable while it holds focus, and a browser refuses `.focus()` on a disabled element while jsdom never reproduces the resulting blur, so the chip stays focusable, in the tab order and focused, with no focus hand-off introduced. Five findings are worth carrying forward. First, the derivation is a single pass and that is a **property of AND rather than an optimisation**: because AND-narrowing is monotone, a candidate's route tally _within_ the already-selected-and-searched result set IS the number of routes that would remain if it were added, so `selectProspectiveTagFilterCounts` just composes `filterRoutesByName`, `filterRoutesByTags` and `countRoutesByTagIdentity` and strips the selected keys; `selectRouteLibraryGroups` is deliberately unused, since partitioning and sorting cannot change membership. Second, a candidate absent from the returned map means **zero**, not missing data — the chips come from the full unfiltered corpus while the counts come from the narrowed subset — resolved with one explicit `?? 0` at the point of use. Third, the count slot is reserved **symmetrically on every chip**, the exact mirror of `.tag-filter-check`, because item 106's shipped contract (label optically centred, chip width unchanged when toggled so wrapped rows never reflow under the finger that just tapped one) is asserted in an existing e2e test that an in-flow or unselected-only count would break; its slot width is sized from the **corpus** digit count, a genuine upper bound that is also stable across every search and filter change, with **no 999-route cap assumed**, and its per-digit figure measured in a browser (a 0.75rem `tabular-nums` digit advances 7.640625px at a 16px root) after a first estimate would have run out of slack at six digits. Fourth, **Playwright's own actionability check honours `aria-disabled`** and refuses an ordinary `click()` or `press()` outright — good evidence the semantics reach tooling, but it means the no-op itself can only be proved with `click({ force: true })` and `page.keyboard.press`. Fifth, `scrollWidth` **cannot** measure text width or slack on a fixed-width element: it is an integer and never smaller than the element's own box, so a first attempt measured 4-digit slack as −0.09px and wrote a clipping check that could never fail; real extent comes from a `Range` over the element's contents. One behaviour change is worth stating plainly: an empty tag-filter result can no longer be reached by _tapping_, since any chip that would empty the list is exactly the chip this item makes inoperable — the state still arises from a live retag, a restored session or a search the selection cannot satisfy, and selected chips stay operable throughout so the rider can always recover. Reuse also falsified two existing comments, both corrected rather than left standing: `countRoutesByTagIdentity` now documents **the supplied route collection** rather than "the whole corpus", and `formatRouteCount` moved out of `tagLifecycleMessages.ts` — whose header claims every count in it is the repository's own authoritative value, never a pre-submit UI count — into a neutral leaf `routeCountCopy.ts` both modules import. Its record is [`docs/project/history/items-110-NN.md`](docs/project/history/items-110-NN.md#item-111), and it carries **automated evidence only** until its stationary portrait checks are run on the installed iPhone; physical Android is outstanding as ever, and the `android-chrome` coverage is Chromium emulation recorded separately from it. **Item 112 is now the next implementation slice.**

**Approved execution order** (the 10 September 2026 field-test decision, extended on 11 September 2026). This list is the authoritative sequence — it is deliberately not duplicated in `backlog.md` or `current-status.md`, which say only that those items precede items 102 and 103. Items 107, 108, 109, 110 and 111, the first five of the seven, have shipped and have been removed from the list; the remaining two still precede items 102 and 103. Item 115 is not part of this sequence either — it came out of the 12 September 2026 ride and shipped immediately, ahead of item 111, without changing the order below. Item 116 is likewise outside it — a test-infrastructure follow-up to item 32's investigation, shipped ahead of item 111 without renumbering or displacing anything below. **Item 114 is not one of the field-test seven** — it was added on 11 September 2026 out of item 109's own 200%-browser-text measurement, and is inserted after item 113 and before items 102 and 103:

1. Item 112 — Diagnostics and Settings information-architecture review
2. Item 113 — German localisation
3. Item 114 — Prevent Planning attribution and placement-control overlap at 200% browser text
4. Item 102 — Primary-navigation symbol redesign with mock-ups
5. Item 103 — Visual-consistency audit and staged control-style refinement

The table below keeps its ordinary pending rows in numeric order, with the monitored rows (items 32 and 66) retained in their existing final section; read the list above, not the table's row order, for priority. **Item 32's own investigation gate fired and was carried out on 12 September 2026.** Its long-standing "CPU-contention" framing turned out to be wrong: with no artificial contention the named test reproduced 8 of 40 repeats in the pinned container, and three-boundary instrumentation showed every `watchPosition` callback being delivered while one of them — the second arming fix — was **never committed to a render**, React having coalesced two callbacks ~17 ms apart so the superseded `currentFix` object was never evaluated. Losing the second arming fix leaves the ride unarmed, the finish fix is then evaluated while unarmed and resets the arming streak, and `Route complete` never appears. **No production defect and no version bump**: coalescing can only make completion require more evidence, never less. The correction is test-only — every deliberate fix is now acknowledged via the persisted `rideState` row before the next is issued, in both named specs, which took the named test from 8/40 failures to 40/40 and then 80/80, with the full container suite at 345/345. Two cautions worth carrying forward: `On route` is **already visible** from a ride's first fix and `toBeHidden()` passes instantly, so neither was ever the barrier both specs' comments claimed; and adding the `serviceWorkers: "block"` that `installLocalMapStyle` documents as required halved the rate but did **not** remove the flake, so it is a harness-contract correction rather than the cause. The item is qualified as **primary mechanism diagnosed and corrected; residual sub-case monitored**: the mechanism held in 11 of 12 captured failures, and in the twelfth all five fixes were committed, so a second sub-case is unexplained. That residual is not a confirmed production defect and needs no further work absent a new recurrence — which should then be investigated from the failure artefacts item 116 retains, starting with reliable-distance freezing and the off-route state machine.

| Item | Title                                                                                 | Status                                                                 | Full entry                                                            |
| ---- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 11   | Weather                                                                               | Pending                                                                | [`backlog.md#item-11`](docs/project/backlog.md#item-11)               |
| 12   | Offline map storage                                                                   | Pending                                                                | [`backlog.md#item-12`](docs/project/backlog.md#item-12)               |
| 16   | Desktop two-column Planning layout                                                    | Pending                                                                | [`backlog.md#item-16`](docs/project/backlog.md#item-16)               |
| 28   | Optional adaptive compact navigation while scrolling                                  | Pending, not approved/scheduled — candidate only                       | [`backlog.md#item-28`](docs/project/backlog.md#item-28)               |
| 59   | Elevation and recognised-climb discrepancy investigation                              | Pending investigation                                                  | [`backlog.md#item-59`](docs/project/backlog.md#item-59)               |
| 60   | Battery consumption investigation and possible battery-saving mode                    | Pending investigation                                                  | [`backlog.md#item-60`](docs/project/backlog.md#item-60)               |
| 61   | Android GPX share-sheet import feasibility                                            | Pending feasibility study                                              | [`backlog.md#item-61`](docs/project/backlog.md#item-61)               |
| 102  | Primary-navigation symbol redesign with mock-ups                                      | Pending                                                                | [`backlog.md#item-102`](docs/project/backlog.md#item-102)             |
| 103  | Visual-consistency audit and staged control-style refinement                          | Pending                                                                | [`backlog.md#item-103`](docs/project/backlog.md#item-103)             |
| 112  | Diagnostics and Settings information-architecture review                              | Pending — selected next, staged and decision-gated                     | [`backlog.md#item-112`](docs/project/backlog.md#item-112)             |
| 113  | German localisation                                                                   | Pending — staged feature                                               | [`backlog.md#item-113`](docs/project/backlog.md#item-113)             |
| 114  | Prevent Planning attribution and placement-control overlap at 200% browser text       | Pending                                                                | [`backlog.md#item-114`](docs/project/backlog.md#item-114)             |
| 32   | `ridingFinishAndEnd.spec.ts`'s completion-detection test: primary mechanism corrected | Primary mechanism diagnosed and corrected; residual sub-case monitored | [`current-status.md#item-32`](docs/project/current-status.md#item-32) |
| 66   | Investigate intermittent fresh-Start Follow remaining at route overview               | Accepted for now, monitored                                            | [`current-status.md#item-66`](docs/project/current-status.md#item-66) |

Items 6–10, 13–15, 17–27, 29–31, 33–42, 44–58, 62–65, 67–99, 100, 101, 105, 106, 107, 108, 109, 110, 111, 115 and 116 are completed (`— done`) and live in [`docs/project/history/`](docs/project/history/README.md). Item 100 is fully complete, its stage 4B physical acceptance having closed on 10 September 2026 via item 106 — see [`docs/project/current-status.md`](docs/project/current-status.md) for the precise scope of that closure. Item 43 is a follow-up acceptance checklist and lives in [`docs/project/current-status.md`](docs/project/current-status.md). Item 86 is the release-readiness audit that produced items 87–92; its full report is [`docs/project/release-readiness-audit.md`](docs/project/release-readiness-audit.md). Item 104 is also completed (`— done`, in [`docs/project/history/items-104-109.md`](docs/project/history/items-104-109.md#item-104)) — a route-progress correctness prerequisite implemented ahead of item 98, whose own higher number does not renumber or complete items 98–103, of which 102 and 103 remain pending and now sit last in the order above, behind items 107–114. The 100– history range is split across [`items-100-103.md`](docs/project/history/items-100-103.md) (items 100 and 101, with 102 and 103 reserved), [`items-104-109.md`](docs/project/history/items-104-109.md) (items 104 through 109, closed at 109) and [`items-110-NN.md`](docs/project/history/items-110-NN.md) (opened by item 110, once adding it would have taken the previous file to 163,015 characters, and now also holding items 111, 115 and 116 — filed in numeric order even though 111 was completed after both of the others). Items 105 and 106 are newer than item 104 and, like it, were completed ahead of items 102 and 103, which remain pending: a completed item's number never implies that lower-numbered work is finished, nor the reverse. Item 105 is code-complete but **failed** its installed-iPhone acceptance; item 106 — the follow-up its three observations produced — superseded it and is accepted, which closed item 100 stage 4B. Item 104 comprises two changes: the original `0.4.8` correction and a dated follow-up in the same entry, which fixed a walking-cadence regression the first attempt missed and which failed its first physical acceptance; read both before relying on route progress. The principal installed-iPhone walking-cadence scenario was accepted on deployed `0.4.9`, and the item was then **accepted on the bicycle on 12 September 2026** at product level; its former subchecks (a deliberate beyond-turn overshoot and its warning clearing, and pause/reload/resume near the turnaround) were never separately induced and are retired as blockers rather than recorded as passes, while physical Android stays open in [`docs/project/current-status.md`](docs/project/current-status.md), which remains the only acceptance ledger. **Items 112, 113 and 114 are pending and entirely unimplemented** — and items 115 and 116, which hold higher numbers than all three, have already shipped, while every one of them still comes _ahead_ of items 102 and 103 in the execution order above, which is the same point in the opposite direction: a number is an identifier, never a schedule. Their specifications live in [`docs/project/backlog.md`](docs/project/backlog.md); nothing about them has been implemented, shipped or accepted, and none of them reopens or weakens any previously accepted item. Items 107, 108, 109, 110 and 111, the first five of that field-test group, are the exceptions: they shipped in `0.4.24`, `0.4.25`, `0.4.26`, `0.4.27` and `0.4.32`, and their records have moved to [`docs/project/history/items-104-109.md`](docs/project/history/items-104-109.md#item-107) and, for items 110 and 111, [`docs/project/history/items-110-NN.md`](docs/project/history/items-110-NN.md#item-110). Item 110 holding the project's highest number while being completed before items 102 and 103 is the clearest illustration of that same point. Items 107 and 108 were **accepted on the bicycle on 12 September 2026**, as broad product-level acceptance of their intended behaviour rather than of any individual clause; item 109's acceptance **passed in full on 11 September 2026**, for its stationary portrait scope only; and item 110's is now **complete**, the 12 September ride having added the revised symbols, the `0.4.29` presentation and behaviour while actively following a route. [`docs/project/current-status.md`](docs/project/current-status.md) is the authoritative ledger for all four, and for item 114, and now carries one consolidated checklist rather than per-item outstanding blocks.
