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
3. **Planning**: waypoint editing, `cycling-road` provider adapter, paved/unknown-surface analysis, route statistics, elevation, local save, GPX export.
4. **Riding enhancements**: trusted next manoeuvre with road-speed-appropriate advance display, distance to turn, gradient colouring, simple elevation/climb segments, optional wake-lock.

Do not start a later milestone by weakening or bypassing earlier reliability requirements.
