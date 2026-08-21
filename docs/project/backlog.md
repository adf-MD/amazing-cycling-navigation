# Planning backlog — full pending item specifications

This file holds the complete, byte-preserved specification for every backlog item that is **approved future work but not yet implemented**, plus the two items that are explicitly monitored/investigated-but-unconfirmed (see [current-status.md](current-status.md) instead for those two — items 32 and 66).

Item numbers are stable identifiers across this project's entire documentation set — they never change regardless of which file an item's text lives in. See [README.md](README.md) for the full map of where everything lives, and the root [`CLAUDE.md`](../../CLAUDE.md) for durable product/engineering rules and the required reading order before implementing any item here.

**Item 68 is next.** Read it in full before starting.

Entries below are ordered by item number (not by their original position in the source document, since categories repeated non-contiguously there). Each entry reproduces its original text verbatim, with only the minimal bracketed pointers needed to keep cross-references navigable after this document was split out of a single monolithic `CLAUDE.md` (see that root file's own note on this).

---

<a id="item-11"></a>

## Item 11 — Weather

_Category: Optional external-data feature_

11. **Weather**
    - Candidate provider: Open-Meteo free non-commercial API, no API key.
    - Current conditions plus approximately the next three hours.
    - Temperature, precipitation, wind speed, gusts and direction.
    - Manual or restrained refresh, never a dependency of Planning/Riding.
    - Required attribution and privacy disclosure because location is sent to a weather provider.
    - Must fail independently and gracefully.

---

<a id="item-12"></a>

## Item 12 — Offline map storage

_Category: Separate feasibility project_

12. **Offline map storage**
    - Do not implement until the active tile provider explicitly permits deliberate offline prefetching.
    - Investigate route-corridor/selected-area storage, style/sprite/glyph dependencies, iOS eviction, size estimates and available-storage checks.
    - Preferred eventual architecture: global tile cache keyed by URL, per-route references, deduplication across routes, deletion only when no route references a tile.
    - Offer bounded detail presets and estimate storage before download.
    - Never bulk-prefetch from an OSMF community tile endpoint that prohibits offline download.

---

<a id="item-16"></a>

## Item 16 — Desktop two-column Planning layout

_Category: Planning visual-organisation follow-ups_

16. **Desktop two-column Planning layout**
    - The fourth visual-migration slice (Interface and accessibility section, [now in `docs/project/history/interface-accessibility-migration.md`]) deliberately kept Planning as a single, width-constrained column (`.planning-section`, max-width 720px) rather than a two-column grid, since the brief explicitly permitted either and a single column carries no DOM/tab-order risk.
    - If pursued later, use CSS Grid with explicit `grid-template-areas` placement while keeping JSX/DOM order linear (Waypoints → Route options → Route overview → Save/export) — never reorder the markup itself to achieve a visual pairing, so keyboard and reading order stay sequential regardless of visual column position.

---

<a id="item-28"></a>

## Item 28 — Optional adaptive compact navigation while scrolling

_Category: Navigation and library interface_

28. **Optional adaptive compact navigation while scrolling**
    - A possible later visual refinement to the always-sticky primary navigation delivered in item 24 above [docs/project/history/items-06-29.md]. The user is currently unsure whether they want this at all — it is a candidate direction only, not approved or scheduled work, and must not be started without explicit confirmation.
    - Motivation: the full sticky icon-and-label row occupies noticeable vertical space on long screens such as Planning.
    - Candidate behaviour, all subject to later confirmation and none of it settled: at the top of a sticky screen, show the current full icons-and-labels navigation; after a meaningful downward scroll, collapse it into a shorter icon-only sticky row; after a meaningful upward scroll, expand it again before the user reaches the top; at the top of the page, always use the expanded presentation; retain accessible names for every destination while text labels are visually hidden; preserve the current non-sticky behaviour during active Riding rather than adding any compact/sticky scroll handling there.
    - Any implementation would need scroll-direction state plus hysteresis/thresholds so small touch movements and scroll bounce do not cause rapid toggling; would need to expand when keyboard focus enters the navigation; would need to respect `prefers-reduced-motion` if a size transition is used; and must not create a second navigation element, change current-page semantics, or reduce effective touch targets below the existing minimum.
    - Decisions that remain open and must be settled with the user before any implementation prompt is written, not invented here: whether to build this at all; which sticky screens should use it, or whether all sticky screens should behave consistently; the downward-collapse and upward-expand thresholds; whether any upward movement expands it immediately or a separate upward hysteresis distance is required; the compact bar's exact height, icon size, padding and visual separation from scrolling content; whether expansion should also occur on navigation focus, destination change or orientation change; whether the compact-to-expanded transition should animate, and its reduced-motion behaviour; and real iOS Safari and Android Chrome acceptance criteria.
    - Keep this item outside the immediate ordered implementation sequence. It must not displace Android compatibility acceptance (item 25), editable GPX conversion (item 26), route reversal (item 27), weather (item 11), offline-map feasibility (item 12), the optional desktop Planning layout (item 16), or the still-pending bicycle field acceptance items recorded under "Manual acceptance status" above (now in `docs/project/current-status.md`). It must not be merged into active Riding's navigation work — active Riding's non-sticky contract (item 24 above [docs/project/history/items-06-29.md]) is settled and unaffected by this idea. Implementing this item does not reopen or mark incomplete the already-delivered item 24.

---

<a id="item-59"></a>

## Item 59 — Elevation and recognised-climb discrepancy investigation

_Category: Riding elevation enhancement_

59. **Elevation and recognised-climb discrepancy investigation**
    - Field observation (unverified against ground truth, not yet a confirmed defect): on one ride, ACN's planned figure was approximately 640 m ascent versus approximately 540 m recorded by a Garmin watch and approximately 510 m reported by Google for a comparable route. Some recognised climb sections subjectively felt like they started later than the physical climb on the road.
    - Confirmed current implementation (recorded here as ground truth for any future analysis, not as an admission of a defect): ascent/descent totals (`src/navigation/elevation.ts`) resample raw route-point elevation at `RESAMPLE_STEP_METRES = 20` m (flat-extrapolating), apply a centred moving-average smoothing window of `SMOOTHING_WINDOW_SAMPLES = 5` samples (~100 m at that spacing), and accumulate with a `MIN_ASCENT_DELTA_METRES = 1` m reversal threshold — this pipeline runs independently of, though sharing constants/helpers with, the gradient/climb-detection pipeline below. Local gradient and climb/descent detection (`src/navigation/gradient.ts`, `src/navigation/routeFeatures.ts`) share the same 20 m resample step and reuse the elevation module's smoothing window; local gradient is fitted by least-squares regression over a `GRADE_BASELINE_WINDOW_METRES = 100` m centred window (minimum usable window `MIN_GRADE_WINDOW_METRES = 40` m near a run's edges), with runs split apart by gaps over `MAX_ELEVATION_GAP_METRES = 500` m and short (`MIN_SEGMENT_LENGTH_METRES = 80` m) classification flicker suppressed. Climb recognition requires length ≥ `MIN_FEATURE_LENGTH_METRES = 500` m, average gradient ≥ `MIN_CLIMB_AVERAGE_GRADIENT_PERCENT = 3` %, and Garmin's own published `climbScore ≥ MIN_CLIMB_SCORE = 1500`; a boundary only confirms once a reversal exceeds `REVERSAL_BRIDGE_ELEVATION_METRES = 10` m or persists past `REVERSAL_BRIDGE_DISTANCE_METRES = 200` m of distance since the tracked extremum (a flat lead-in/plateau within `FLAT_EPSILON_METRES = 0.01` m of the current extremum is treated as neither extending nor reversing). None of the above trusts a provider-supplied ascent/descent summary — ACN always recomputes from route-point elevation itself, per this project's long-standing "do not sum raw positive elevation noise" GPX rule.
    - Treat this strictly as an evidence-gathering investigation, not a confirmed provider-data defect, and not a request to retune any constant above yet.
    - Required investigation before any tuning proposal: compare the exact ACN-exported planned GPX for the ride in question against the corresponding Garmin-recorded GPX/FIT activity, aligned by distance and geography — ask the user to supply both files explicitly for a dedicated future analysis task; keep them local, never commit or retain them, and allow the user to trim privacy-sensitive sections first, per this project's "never commit personal GPX files" rule. Report, from that comparison: route-point spacing in each file, ACN's raw-vs-smoothed elevation profile, ACN's cumulative ascent under the current algorithm above, and exactly where recognised climb boundaries differ from where the rider judged the physical climb to start/end. Treat Garmin and Google's own figures as comparison data points, not ground truth — they may use different elevation sources (barometric vs. digital-elevation-model), their own smoothing, and their own ascent thresholds, none of which ACN can inspect. Get the user to clarify, with a concrete reproducible case, what "later" means for the climb-boundary complaint: the coloured map boundary (`routeFeatureLayer.ts`), the highlighted elevation-chart section, or the automatic active-Climb view's own entry point (`climbElevationView.ts`) — three distinct presentation layers over the same underlying boundary that could diverge from each other even if the boundary itself is correct.
    - Only after that analysis should a separate, later-numbered implementation slice propose any change to smoothing, the reversal threshold, climb-boundary hysteresis, or elevation-source handling — any such proposal must quantify its effect across several representative routes (not just the one ride that prompted this), and add deterministic regression fixtures rather than tuning purely to match one ride's Garmin/Google numbers.

---

<a id="item-60"></a>

## Item 60 — Battery consumption investigation and possible battery-saving mode

_Category: Battery and performance investigation_

60. **Battery consumption investigation and possible battery-saving mode**
    - Field observation (hypothesis-level, not a confirmed cause): an approximately two-hour installed iPhone PWA route ride saw battery fall from roughly 90% to below 20%. A separate, approximately ten-minute walking free-roam test (already recorded under item 42's own manual-acceptance entry) showed no obvious heat or battery drain, but was too short to validate representative endurance.
    - Record contributing factors as hypotheses only, not conclusions: high screen brightness/keeping the display awake; the app's current light presentation, particularly on an OLED device; continuous high-accuracy `watchPosition` use; MapLibre rendering and camera-update/easing frequency; cellular tile downloads, weak signal, or other device/environmental conditions; device model, battery health, and ambient temperature. A PWA cannot directly control hardware screen brightness; browser geolocation has no dependable application-controlled update interval; and the project must not trade away navigation reliability merely to claim better battery life.
    - Stage the work, and do not conflate the stages:
      1. **Measurement and diagnosis:** define a repeatable 60–120 minute real-device test procedure recording phone model, iOS version, battery health, system appearance, approximate brightness, wake-lock use, active screen, signal conditions, start/end battery percentage, perceived heat, and route/free-roam mode. Any opt-in developer diagnostics added for this must not retain location/speed history and must not become analytics/telemetry, per this project's explicit non-goals.
      2. **Low-risk rendering audit:** inspect for unnecessary React rerenders, MapLibre repaint/camera-easing frequency, hidden/off-screen chart or map work, and network tile churn. Require a measured, reproducible issue before changing anything found here.
      3. **Possible battery-saving presentation, gated on evidence from stages 1–2:** consider a manually selectable dark/OLED-friendly active-Riding theme and a compatible dark/dim map style, preserving outdoor contrast, route/warning colours, attribution/licensing requirements, and accessibility. A dark UI alone does not address GPS/rendering cost or a bright map style, and must not be described as a proven fix by itself.
      4. **Higher-risk power changes, gated on comparative field evidence only:** do not lower GPS accuracy, weaken manoeuvre timing, degrade Follow reliability, or silently disable wake lock. Any such option must be explicit, reversible, off by default, and tested against navigation accuracy as well as battery use before being offered.
    - Keep the investigation (stages 1–2) and any eventual feature (stages 3–4) as clearly separate future slices, each with its own acceptance evidence — do not implement stage 3/4 work on the strength of the single two-hour ride reported here.

---

<a id="item-61"></a>

## Item 61 — Android GPX share-sheet import feasibility

_Category: Platform compatibility_

61. **Android GPX share-sheet import feasibility**
    - Field observation: on Android, opening a GPX file received through WhatsApp currently offers only `Open with` choices (no ability to save to Files first), and the installed ACN PWA is not offered as an option there.
    - Platform distinction (re-verify against current official documentation before acting on it, since browser capability support changes over time): the web File Handling API (which can register a PWA as a file's default handler for an `Open with` chooser) is documented by Chrome as desktop-only today — it is not expected to make an installed Android PWA appear in an `Open with .gpx` chooser. The Web Share Target API is a distinct mechanism that can let an installed Android PWA appear as a target in a genuine Android Share/Send sheet — this depends on WhatsApp/Android actually exposing a Share/Send action for the received file, which is unconfirmed for this exact flow. A static GitHub Pages PWA can potentially implement a Web Share Target through its manifest plus service-worker/Workbox request handling, without an application server — this remains to be prototyped, not assumed to already work. This cannot make ACN appear in an `Open with`-only chooser under any of the above; it only helps if a genuine Share/Send path exists for this file. Useful, but not yet re-verified, official starting points: <https://developer.chrome.com/docs/capabilities/web-apis/file-handling>, <https://web.dev/web-share-target>, <https://web.dev/articles/workbox-share-targets> — check current status before relying on any detail from them.
    - Confirmed repository state: no Web Share Target, File Handling API, `share_target`/`file_handlers` manifest field, or related service-worker route exists anywhere in the current codebase (confirmed by an exhaustive case-insensitive grep). This is a fresh feasibility item, not a partially-built feature.
    - Stage the work, gated at each step:
      1. **Real-device flow capture and feasibility:** obtain screenshots or a screen recording of the exact WhatsApp menu/chooser on the user's real Android device, plus Android/Chrome/WhatsApp version numbers, to determine whether a genuine Share/Send path exists at all. Record the result as real-device evidence, distinct from any later Chromium-emulated Playwright coverage.
      2. **Static prototype, only if step 1 finds a Share path:** prove an installed Android PWA can register as a file share target under the project's current Vite PWA/Workbox configuration and GitHub Pages base-path deployment, covering both app-closed and app-already-open invocation.
      3. **Local GPX import integration, only if step 2 succeeds:** accept `.gpx` and realistic MIME types via the share target, validate through the existing file-size/XML/coordinate/import pipeline unchanged, never upload the file anywhere, and show a clear foreground review/confirmation or error state. Any service-worker handoff buffering the shared file must be short-lived and must not retain personal GPX data indefinitely.
      4. **Conflict and recovery coverage:** an inbound share must respect the existing unfinished route/free-roam conflict guard (item 42's fail-closed `checkFreeRoamConflict`-style pattern) and must never silently replace an active session or Planning draft; it must work after a fresh install/relaunch. Add Playwright coverage where meaningful, then require real Android Chrome acceptance — Chromium/Playwright emulation cannot prove real OS share-sheet registration, matching this project's existing, repeatedly-stated distinction between the `android-chrome` Playwright project and genuine physical-device verification (item 25).
    - If step 1 finds only an `Open with` path and no Share/Send path, document that conclusively and record that no pure static-PWA solution is currently available for this exact flow — do not propose a native wrapper, Trusted Web Activity, APK, or other Android-specific packaging as a workaround; that would be a major architecture departure and is explicitly not approved by this backlog item.
    - Requires the "## Explicit non-goals" edit recorded above (item 61's own cross-reference) — that section stays in the root `CLAUDE.md` and already carries this cross-reference.

---

<a id="item-68"></a>

## Item 68 — Robust immersive header and compact shared wake-lock placement

_Category: Immersive active-Riding redesign_

68. **Robust immersive header and compact shared wake-lock placement**
    - One presentation/accessibility slice for the shared active shell (route Riding and free roam alike, per items 55/56), not a rewrite of wake-lock lifecycle logic.
    - Field evidence: a long route title ellipsised correctly, but the `Pause` button itself visibly shrank and its text escaped the button. The standalone `Keep screen awake` row — a checkbox, an information button, and (while active) a permanent status line — consumes scarce vertical space directly above the route status.
    - Confirmed current implementation (source-verified), correcting the naive field impression rather than merely restating it. `RidingImmersiveHeader.tsx` renders three flex children directly: a bare Pause `<button className="btn-secondary">` with no wrapping element and no dedicated CSS class; `<h1 className="screen-title riding-immersive-header-title">`, styled `flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis` and correctly truncating; and `<div className="riding-immersive-header-end">{endAction}</div>`, styled `flex: 0 0 auto` and correctly protected from shrinking. The bare Pause button has no equivalent protection — no wrapper, no dedicated rule, no `white-space`/`text-overflow` handling — so as an ordinary flex child it inherits the browser default `flex-shrink: 1`, a confirmed, distinct gap versus the already-correct title and End. `RidingWakeLockControl.tsx` (rendered identically in `RidingScreen.tsx` and `FreeRoamScreen.tsx`, directly after the header block since item 56's placement fix, gated on `isWakeLockSupported() && geolocationStatus !== "idle"`) is already a single compact flex-wrap row (`.ride-wake-lock-control`) — a `<label>` with a checkbox plus the visible text "Keep screen awake"; an information button (`ⓘ`) toggling an anchored popover; a conditional `role="status"` span reading "Screen staying awake." while active; a conditional retry-alert row when unavailable — and is therefore not, at the control level, the "large checkbox and separate dominant information button" the field description implies at face value. What is not yet true is that it is integrated into the compact shared status stack — it remains its own standalone row, positioned between the header and the rest of the status content, consuming its own vertical slot.
    - Settled contract:
      - `Pause`, its longer pending label (whatever that exact current text is — not independently confirmed here, so this requirement is stated generically rather than against an invented quote), and `End ride` are non-shrinking, single-line, real ≥44×44 px touch targets. Only the title consumes the remaining width and ellipsises; its full accessible text remains available. Keep text labels rather than replacing Pause/End with ambiguous symbols.
      - Move the wake-lock control into the compact active status area for both route Riding and free roam, using the concise visible label `Keep screen on` (renamed from `Keep screen awake`).
      - The visible checkbox may stay small, but its complete label remains a ≥44×44 px target. Keep the information disclosure keyboard/touch accessible without giving it a visually dominant button.
      - Do not show a permanent extra `Screen staying awake` line after success — remove that permanent line so success adds no extra line. A genuine failure and retry may still expand the compact status area clearly.
      - Preserve `useScreenWakeLock`, desired-state persistence, visibility release/reacquisition, unsupported-browser omission, storage-first Pause/End behaviour (item 55) and all current failure/retry semantics untouched. Compose the existing control into the status presentation rather than making a presentational status component own wake-lock business logic.
    - Require narrow-phone, long-title, pending-Pause-label, safe-area, portrait/landscape and enlarged-text coverage for both route Riding and free roam. Prove the actions neither overlap nor overflow, and that moving the control does not resize the map when only its transient popover opens.

---

<a id="item-69"></a>

## Item 69 — Remaining positive ascent in the active route summary

_Category: Riding elevation enhancement_

69. **Remaining positive ascent in the active route summary**
    - A route-Riding information enhancement, distinct from the layout-only slice immediately above (item 68) because it introduces a new derived navigation metric rather than a presentation change to an existing one.
    - Confirmed (exhaustive grep of `src/navigation/` and `src/ui/riding/`): no "remaining ascent"/whole-route "ascent remaining" metric exists anywhere today. The only ascent-adjacent values that exist are the static, pre-ride `route.ascentMetres` total shown via `formatAscent()` in the idle route header and in `RidingLauncher.tsx` — a total, not live/remaining — and `ClimbProgressMetrics.elevationRemainingMetres` (`climbElevationView.ts`), explicitly scoped, per its own doc comment, to only the currently active climb ("not the same value as elevationGainMetres... not a new cumulative-ascent calculation") and shown only inside `RidingClimbProgressPanel` — never a whole-route figure.
    - Resolved architectural decision (settled here, not left to a future implementer to choose): use the frozen/reliable `presentationDistanceFromStartMetres`/`lastReliableMatch` progress source for remaining ascent, matching every other presentation value in this app — climb progress, next-manoeuvre selection, the elevation marker, route completion. `RidingStatusStrip.tsx`'s existing "Remaining: X km" figure, currently computed from the live, raw `matchedDistanceFromStartMetres` (`coreState.lastMatch?.distanceFromStartMetres`, per `useRideNavigation.ts`) rather than that frozen/reliable value, must be harmonised onto the same frozen/reliable progress source as an explicit, in-scope part of this same slice — not merely matched in wording, and not an optional follow-up — so the two figures on the compact status line can never disagree or jump independently under GPS jitter or off-route evidence.
    - Existing whole-route ascent/descent calculation to reuse, not reimplement: `src/navigation/elevation.ts`'s `analyzeElevation` pipeline — filter known-elevation points, resample onto a fixed `RESAMPLE_STEP_METRES = 20` m grid, apply a centred `SMOOTHING_WINDOW_SAMPLES = 5`-sample moving average (~100 m window), then `computeAscentDescent`, a running-extremum/reversal-confirmation walk that only banks ascent once the series has reversed by at least `MIN_ASCENT_DELTA_METRES = 1` m from the tracked extremum.
    - Desired compact presentation, verbatim:
      ```
      On route
      61.5 km · 993 m ascent
      GPS ±9 m · Live
      ```
      Both the distance and the ascent figure in that line are remaining values, not route totals. Provide an unambiguous accessible label distinguishing this from the route's original total ascent, since the compact visible wording alone could be misread as a total.
    - Remaining ascent means the total future positive elevation gain from the rider's progress point onward — every future climb's gain summed, not merely the net elevation difference between the rider's position and the finish. Must handle missing/gapped elevation honestly, never inventing 0 m when unknown. No ascent metric for route-less free roam, which has no route/elevation data at all.
    - Require deterministic unit coverage of the remaining-ascent calculation against `elevation.ts`'s existing constants/fixtures (a multi-climb route, a route with a gap in known elevation, a route with no remaining ascent near the finish), a `useRideNavigation`/status-strip test proving the figure advances/decreases correctly as progress advances, and real-device confirmation that the live figure is legible and updates sensibly while actually moving.

---

<a id="item-70"></a>

## Item 70 — Simplify 2 km/10 km elevation distance guides

_Category: Riding elevation enhancement_

70. **Simplify 2 km/10 km elevation distance guides**
    - Refines and simplifies item 54's already-shipped distance-guide feature; item 54's own text is left untouched, but this item supersedes several of its presentation details once implemented.
    - Confirmed current implementation (source-verified). Caption text, to be removed entirely: `` `Distance guides ahead: ${...}.` `` — e.g. "Distance guides ahead: +1 km." (2 km view, one guide) or "Distance guides ahead: +2 km, +4 km, +6 km, +8 km." (10 km view, four guides) — rendered in `ElevationChart.tsx` as a `<p className="elevation-chart-distance-guides-caption">` below the SVG. Label format, to lose its leading "+": `` `+${aheadMetres/1000} km` `` via `distanceGuideLabel`. Guide-line geometry, to become full-height: currently a short, deliberately restrained `DISTANCE_GUIDE_TICK_HEIGHT = 14` px tick from `y=0` (chart top) downward only, with the label at `DISTANCE_GUIDE_LABEL_Y = 24`, inside the SVG plot area near the top — in contrast to the existing position marker, which already spans the full chart height (`y1={0} y2={height}`), the precedent to mirror. `viewBox="0 0 width height"` (default 320×96); `distanceToX`/`elevationToY` (`elevationChartGeometry.ts`) map the full `[0,height]` range directly to elevation, with no existing reserved header/footer gutter inside the SVG — the profile line, guide ticks and marker all currently share the same plot box. The only existing "gutter" text is the HTML `<figcaption>` (elevation min/max) and the guide/marker captions, rendered as ordinary HTML below the `<svg>`, outside its coordinate system.
    - Settled visual change:
      - Extend guide lines through the full chart plotting height, mirroring the existing position marker's own full-height precedent.
      - Place labels at the bottom, in a reserved/readable gutter, rather than inside the plot area near the top. Achieving this requires either growing the SVG's own height/viewBox to add a bottom gutter, or moving the guide labels out of the SVG into HTML — this architectural choice is left to implementation time, not prescribed here.
      - Use "1 km"/"2 km"/"4 km" etc., never "+1 km"/"+2 km" — drop the leading "+" from every guide label.
      - Remove the visible prose caption (`elevation-chart-distance-guides-caption`) entirely.
      - The 2 km view retains its single 1 km guide; the 10 km view retains its four 2/4/6/8 km guides — no change to which offsets are shown, only to how they are drawn and labelled.
    - Confirmed structurally, from item 54's own already-shipped design: the `distanceGuides` prop is only ever passed by `RidingScreen.tsx`'s plain "upcoming rolling window" (2 km/10 km) branch — Full view, Climb view, the pre-ride whole-route chart, the pre-ride selected-climb preview, and Planning's chart never receive it. "Full/Climb/Planning must not gain guides" is therefore already true by construction and must be preserved/re-proven by this item's own tests, not newly built.
    - Preserve accessible chart meaning without reintroducing redundant visible explanatory text — the guides' accessible description must not regress merely because the visible caption is removed.
    - Require coverage of route-end-truncated windows and labels near either edge, so lines/text neither clip nor collide with the profile line or baseline, alongside the existing item 54 chart tests updated for the new geometry/label format.

---

<a id="item-71"></a>

## Item 71 — Preview the next recognised climb during active Riding and improve climb-card hierarchy

_Category: Riding elevation enhancement_

71. **Preview the next recognised climb during active Riding and improve climb-card hierarchy**
    - Applies only to the active route-Riding Profile view (items 55/56), following the same active-Riding information-proximity principles item 40 established. The pre-ride briefing (item 13's later slices, `RidingClimbSelector`) already shows the full route profile and offers individual recognised-climb previews via a dropdown; do not add 2 km/10 km/Climb cards there or duplicate that existing pre-ride functionality.
    - Confirmed current implementation (source-verified): the `Climb` view button in `RidingScreen.tsx` is currently gated only on `activeClimb !== null` — the rider's frozen/reliable route distance is physically inside a recognised climb's range, via `findFeatureAtDistance(routeFeatures, presentationDistanceFromStartMetres)`, an inclusive-both-ends containment check in `routeFeatures.ts`. There is no "climbs ahead"/upcoming-climb preview capability anywhere today (exhaustive grep confirmed); the button simply does not exist before a climb has actually begun. Item 57's `RidingClimbCue` (Map-view-only "Climb active"/"View climb" cue) is likewise gated on `effectiveElevationView.kind === "climb"`, which itself only ever fires while `activeClimb !== null` — so it too only appears once a climb has genuinely begun, never in advance. This item must not make item 57's cue appear for a merely-upcoming, not-yet-begun climb.
    - Settled active-Riding behaviour:
      - Show the `Climb` view button whenever there is an active recognised climb or another recognised climb ahead; hide it when no recognised climb remains.
      - Before a climb begins, selecting `Climb` manually previews the next recognised climb. Do not automatically switch away from Map or a standard Profile view merely because a future climb exists.
      - The upcoming preview should identify the climb/category, distance until its start, length, total ascent, average gradient, and its climb profile, reusing existing recognised-climb data (`routeFeatures.ts`, `climbElevationView.ts`) rather than a second detection/measurement path.
      - When the climb actually begins, retain today's automatic active-Climb behaviour (item 13) unchanged. Item 57's cue remains active-climb-only and must never be shown for a merely upcoming preview.
      - Leaving an upcoming preview via Full/2 km/10 km must not write the active-climb dismissal state (`nav.dismissedClimbFeatureId`) or suppress the future item-57 cue. During an active climb, the existing dismissal-for-this-climb and re-offer-on-a-later-climb semantics remain unchanged.
    - Restructure the active progress card (`RidingClimbProgressPanel.tsx`, currently one combined "completed · remaining" paragraph followed by several uniformly-styled, equally-weighted `<p>` elements — current elevation, summit elevation, elevation remaining, current gradient, with no visual hierarchy between them, per its own doc comment "No percentage-complete value anywhere, per product requirements," which must remain true) for glanceability without removing useful information or adding percentage complete. Give the two primary values the strongest hierarchy: distance to summit; positive elevation remaining. Move current gradient, current elevation, summit elevation and distance completed into a quieter secondary row/area. The upcoming preview and active-progress states must be visibly and semantically distinct, never displaying fake live values before the climb actually begins.
    - Require deterministic zero/one/two-climb tests covering before, during, after and between climbs; preview selection/deselection; automatic entry; active dismissal; later-climb re-offer; suspension/recovery where relevant; no extra GPS/camera commands issued merely by previewing or switching views; and a fixed Profile pane that remains usable at phone width and enlarged text.

---

<a id="item-72"></a>

## Item 72 — One-tap route Pause/resume flow

_Category: Ride lifecycle_

72. **One-tap route Pause/resume flow**
    - Confirmed current two-step flow (source-verified): `RidingLauncher.tsx`'s `Resume route` button calls `onResumeRoute(route)`, and `App.tsx`'s `handleResumeRoute` does only `setRidingContent({kind:"route", route}); setScreen("riding"); notifyNewRideContent();` — explicitly documented in its own doc comment as "Never starts geolocation itself." This mounts `RidingScreen` with `nav.geolocationStatus` still `"idle"`, landing the rider on the pre-ride/idle panel, which shows a separate `Resume riding` button (since `nav.currentFix` is non-null) whose `onClick={handleStart}` is what actually calls `nav.start()` and `camera.requestFollow()`. So today this is genuinely a two-tap flow: the launcher's `Resume route` (opens the screen, no GPS), then the pre-ride panel's own `Resume riding` (starts GPS). `RidingLauncher.tsx` has no import of any geolocation API anywhere — merely hydrating/rendering it makes zero geolocation calls, confirmed both structurally and by the component's own doc comment.
    - Confirmed (source-verified): item 55's existing `App.tsx` `handleRidePaused` currently calls `resetRidingContentToLauncher()` — after a successful Pause, `ridingContent` resets to `{kind:"none"}`, bouncing the rider back to the empty/hydrating Ride launcher, which re-hydrates from storage and shows the now-resumable route via `Resume route`, restarting the same two-tap flow above. This item proposes to change that specific piece of `App.tsx` wiring; item 55's own text correctly records what Pause currently does and is left untouched — this item explicitly proposes to supersede that one piece of wiring once implemented, cross-referencing item 55 by number rather than rewriting it.
    - Settled future flow: keep `ridingContent` pointing at the same route after Pause (do not reset it to the launcher), so `RidingScreen` stays mounted and its own idle/pre-ride branch renders directly — since `nav.geolocationStatus` is now idle — with the global navigation restored (`isRidingActive`, driven by `RidingScreen`'s existing `onRidingActiveChange` callback, already correctly becomes `false` the instant `geolocationStatus` leaves `"watching"`, existing, unmodified machinery). An ordinary in-session Pause becomes: press Pause, the screen shows the route's own paused pre-ride panel directly (global nav visible, immersive header gone), press one `Resume ride` action, GPS restarts and Follow is requested — no separate launcher round-trip for this case. `Back to Ride options`/Edit copy/`End ride` remain available from that panel exactly as today.
    - The other remaining two-tap case is genuine cold recovery — a reload/relaunch where `App.tsx`'s in-memory `ridingContent` has reset to none and only the persisted storage row remembers the session; only `RidingLauncher`'s own hydration knows about it in that case. This item proposes collapsing this case too, so the launcher's own resume action (a renamed/consolidated `Resume ride`, not merely `Resume route`) both opens the route and immediately starts GPS/requests Follow in one tap, entering the immersive Map view directly. A genuinely fresh, never-started route keeps the ordinary `Start riding` flow unchanged.
    - Confirmed asymmetry worth preserving, not reproducing for routes as a workaround: free roam is already effectively one-tap today — `RidingLauncher`'s `Resume free roam` button calls `onOpenFreeRoam` → `App.tsx`'s `handleOpenFreeRoam` (`setRidingContent({kind:"free-roam"}); notifyNewRideContent();`), and `FreeRoamScreen.tsx` auto-starts its GPS watch on mount (item 42) — there is no separate second button. This item closes the two-tap gap for route sessions only (item 41's launcher, item 42's free roam); free roam's existing one-tap behaviour must be preserved unchanged, not forced into a route-briefing shape.
    - Preserve, without re-doing: `useRideNavigation.ts`'s `pause()` (item 55) already fully preserves progress, camera state, elevation-view selection, wake-lock preference, dismissed-climb id and completion-armed state — it never resets any of these (unlike `finish()`, which does). This existing preservation is exactly what this item needs and should be cited as already-proven, not re-specified. Storage-first failure safety must hold throughout: a failed Pause leaves the ride live and unmodified with a retryable error, exactly as item 55 already established; a failed one-tap resume reports a retryable error without clearing the persisted row.
    - Require component coverage of both collapsed flows (in-session Pause→Resume, cold-recovery launcher Resume) proving exactly one geolocation watch starts per resume, progress/elevation-window/camera/wake-lock/completion/climb state survive unchanged, a failed Pause/resume leaves the row intact with a working retry, and free roam's existing direct-resume behaviour is unaffected — plus real-browser coverage of the same, following this file's established storage-polling discipline rather than fixed waits.

---

<a id="item-73"></a>

## Item 73 — Guard every unfinished-session switch against silent replacement

_Category: Ride lifecycle_

73. **Guard every unfinished-session switch against silent replacement**
    - Confirmed asymmetry (source-verified, a genuine gap, not a hypothesis): `App.tsx`'s `checkFreeRoamConflict()` checks only whether the persisted singleton `active` row is an unfinished free-roam session (via `isStoredFreeRoamRideState`); it returns `null` for any other case, including when the row is a different unfinished route session. Both `handleOpenRoute` and `handleRouteSaved` (Planning save, which then opens Riding) call this same guard identically. If a rider has an unfinished/paused route session persisted and opens or attempts to resume a different route, `checkFreeRoamConflict` returns `null` and the app proceeds silently — no confirmation dialog, no warning whatsoever — straight into `setRidingContent({kind:"route", route})` for the newly opened route, replacing the in-memory pointer to the previous unfinished route with no user-facing signal; the previous route's own persisted storage row is then itself silently overwritten once any new persistence write occurs for the new session, since it is the same singleton `id: "active"` row.
    - Confirmed: `handleOpenFreeRoam` performs no conflict check at all — it is not gated by `checkFreeRoamConflict` or any equivalent function. It is currently safe only structurally: it is only ever reachable via `RidingLauncher`'s own `Start free roam`/`Resume free roam` buttons, which themselves only render once the launcher's own storage hydration has already resolved to a `"none"` or `"resumable-free-roam"` session state — a conflicting unfinished route session resolves to `"resumable-route"` state instead, rendering a different launcher panel, so neither free-roam button is reachable through the launcher's own UI today. This direction (free-roam vs. an existing unfinished route) is currently prevented only by the launcher's own mutually-exclusive UI branching, not by an explicit runtime guard function — unlike the route-vs-free-roam direction, which does have one (`checkFreeRoamConflict`, item 42).
    - `StoredRideState` is a discriminated union, `StoredRouteRideState | StoredFreeRoamRideState`, sharing one singleton row (`id: "active"`) in the `rideState` IndexedDB table (`src/storage/db.ts`) — there is structurally only ever one persisted unfinished session at a time.
    - Settled contract: one unfinished route or free-roam session must never be silently overwritten by starting/opening a different route, a Planning save that opens Riding, or starting the other session kind. Opening the SAME resumable route should follow item 72's one-tap resume contract rather than present a destructive-switch prompt. A genuine different-session attempt must show an explicit confirmation that ending the current unfinished session is required before switching, reusing the authoritative storage-clear/finalisation path already established (item 29's single-authoritative-clear-path convention) — clear storage first, only then open/start the replacement. Cancel and a storage-clear failure must preserve the original session exactly, with a retry path, never inferring success from in-memory selection alone. Preserve the existing orphaned/missing-route "Discard unfinished ride" handling (item 41), and keep all launcher recovery local/offline.
    - Require a small transition-matrix coverage set: route → different route, route → free roam, free roam → route, same-route recovery (item 72), Planning-save entry, and storage failure, each with component and real-browser evidence. Do not introduce multiple simultaneous ride rows or a ride-history feature.
