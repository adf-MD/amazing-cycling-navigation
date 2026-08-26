# Planning backlog — full pending item specifications

This file holds the complete, byte-preserved specification for every backlog item that is **approved future work but not yet implemented**, plus the two items that are explicitly monitored/investigated-but-unconfirmed (see [current-status.md](current-status.md) instead for those two — items 32 and 66).

Item numbers are stable identifiers across this project's entire documentation set — they never change regardless of which file an item's text lives in. See [README.md](README.md) for the full map of where everything lives, and the root [`CLAUDE.md`](../../CLAUDE.md) for durable product/engineering rules and the required reading order before implementing any item here.

Item 81 is the next selected implementation item, followed by items 85, 82, 83 and 84 in that order. Items 11, 12, 16, 28, 59, 60 and 61 below remain approved future work, not yet scheduled into the sequence.

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

<a id="item-81"></a>

## Item 81 — Preserve Riding zoom through stale-GPS and imagery-retry recovery

_Category: Riding camera reliability investigation_

81. **Preserve Riding zoom through stale-GPS and imagery-retry recovery**
    - Field evidence: during an active route ride (the PWA remained active throughout — never paused, backgrounded or suspended), the camera intermittently ended at approximately whole-world zoom after a combination believed to involve stale GPS and pressing `Retry map imagery`. Follow was already active; pressing Follow again did not restore a normal zoom, which is correct, since Follow preserves the rider's selected zoom rather than resetting it. Pressing North-up also did not change zoom, which is likewise correct, since North-up only changes bearing/pitch. Manual pinch/`+` zoom restored a normal useful view. The observation is intermittent and its precise ordering is not yet deterministic.
    - Distinct from item 66 (an unreproduced, accepted-for-now-monitored route-Riding fresh-Start overview-zoom symptom with no confirmed cause) and item 74 (a confirmed and shipped fix for a free-roam fresh-Start zoom-corruption bug, via the `hasAppliedCameraCommand` settle-provenance latch added to the shared `rideCameraReducer`). This item's evidence is mid-ride, tied specifically to a stale-GPS-plus-imagery-retry combination, not a fresh Start — investigate it as its own scenario. Do not assume, and do not rule out without evidence, that it shares a cause with either item 66 or item 74; neither item's status is reopened or reinterpreted by filing this one.
    - Reproduce the complete active-session transition: a useful user-selected Follow zoom, GPS becoming stale, a genuine imagery failure, manual imagery retry/map recreation (item 67's retry/recreate mechanism), then connectivity and a fresh fix returning.
    - Trace camera state and provenance across the retry generation, including the existing snapshot/restore path (`liveCameraSnapshotRef`/`cameraSnapshotToRestore`, item 67), style readiness, applied-command generation/latch (`appliedCameraCommandGenerationRef`/`hasAppliedCameraCommand`, item 74), camera-settle reporting, and the persisted Follow zoom held in `rideCameraReducer`.
    - Prove the cause with a failing deterministic test against the unmodified implementation before choosing a production fix.
    - Required outcome: retry/recovery must never replace a valid Riding zoom with MapLibre's raw/default world zoom. The selected zoom, active Follow state and below-centre look-ahead GPS framing must survive recovery.
    - Do not make Follow or North-up reset zoom, clamp every low zoom to a default navigation zoom, add sleeps/retries, or weaken deliberate user zoom persistence.
    - Start with the route-Riding path, where the new evidence was observed. Change or extend free roam only if source inspection proves the same shared defect (`rideCameraReducer` is shared between `useRideCamera.ts` and `useFreeRoamCamera.ts`, per item 74's precedent) and the shared fix is the smallest safe correction.
    - Keep separate from item 83 (offline/imagery-recovery presentation), even though both were noticed during the same recovery episode — item 83 is presentation-only and is explicitly not authorised to touch camera recovery.

---

<a id="item-82"></a>

## Item 82 — Unify the active status control and make the climb cue fully readable

_Category: Immersive Riding interface_

82. **Unify the active status control and make the climb cue fully readable**
    - One bounded active-Riding presentation slice covering route Riding and free roam. Must not change session, GPS, wake-lock or climb state machines.
    - Replace the current checkbox-plus-information-button wake-lock presentation (item 68's `.wake-lock-row`/`.wake-lock-info-button`, carried into item 75's status card) with one compact, large-target `Screen on` action integrated into the right-hand portion of the existing status card (item 75's `.ride-status-card-top-row`), adding no separate vertical row.
    - The action must be comfortably tappable while riding, use the existing restrained green treatment when active and a neutral/grey treatment when inactive, retain a non-colour state indication, and keep correct pressed/checked semantics and accessible naming.
    - Use the same control in route Riding (`RidingStatusCard`) and free roam (`FreeRoamStatusCard`).
    - Move the explanatory wake-lock information, including the honest battery-consumption warning, to Settings. Remove the active-card information popover only when implementing this slice; do not change wake-lock acquisition, release, persistence, retry, or unsupported-browser behaviour (`RidingWakeLockControl`'s existing lifecycle logic).
    - Replace free roam's `Tracking` heading with `Location` (and suitable existing-state variants) — free roam does not record a track, progress or location history.
    - Reuse route Riding's compact GPS terminology and freshness/age formatting rules in free roam rather than maintaining a second wording convention. Share formatting logic where that is the smallest safe implementation, but do not merge `RidingStatusCard` and `FreeRoamStatusCard` merely for cosmetic reuse — they remain semantically distinct components.
    - In the active-climb Map cue (`RidingClimbCue`, items 57/71), keep the large one-tap `View climb` action, but ensure `Climb active` and the remaining-distance text are fully readable without ellipses at ordinary phone portrait sizes. Adjust the cue's internal allocation, padding and text sizing as needed without changing cue timing, dismissal, or Profile-transition behaviour (items 71/80).
    - Preserve large touch targets, enlarged-text fallback, portrait/short-landscape support and the fixed, non-scrolling immersive layout (item 68's immersive shell).

---

<a id="item-83"></a>

## Item 83 — Make offline and map-imagery recovery unobstructive

_Category: Map imagery and tile reliability_

83. **Make offline and map-imagery recovery unobstructive**
    - A presentation/composition slice around the already-shipped item 67 recovery state machine (`.map-status-overlay`, retry/episode tracking, camera preservation across recreation) and item 75's compact status card. Not authorised to rewrite networking or camera recovery — see item 81 for the separate camera-reliability investigation.
    - Field evidence: the map-imagery-unavailable overlay and `Retry map imagery` button (item 67, shrunk presentation-only by item 75) can still cover the upcoming route, including while an active-climb cue is present. The separate `Offline` text row in the status card (item 75's `.ride-status-card-offline`) consumes unnecessary vertical space.
    - Required outcome: route, position, progress, elevation, controls and attribution remain useful without tiles and must stay visible and reachable.
    - Represent connectivity compactly within the existing status-card top row (item 75's `.ride-status-card-top-row`) using a recognisable online/offline status symbol with an accessible textual name. Do not rely on colour alone and do not add another full-width status row.
    - Move the imagery-failure explanation and retry action out of the central route-viewing area. Choose the smallest existing component boundary that keeps a concise explanation and a glove-usable retry target reachable without overlaying the route, GPS marker, climb cue, map controls, or Map/Profile switcher. Prefer integrating a compact recovery action with existing status chrome over adding another large card.
    - Preserve the distinction between browser connectivity and actual tile/style failure: being offline alone must not claim already-rendered imagery is unavailable, while a genuine imagery failure must remain explicit and retryable.
    - Preserve item 67's retry semantics, fallback map, automatic recovery and error classification in full.
    - On successful imagery recovery, the recovery affordance must clear automatically without requiring the rider to pan or zoom merely to provoke a new tile request.

---

<a id="item-84"></a>

## Item 84 — Restore visibly rendered, zoom-adaptive route-distance badges

_Category: Map presentation reliability_

84. **Restore visibly rendered, zoom-adaptive route-distance badges**
    - A focused visibility/reliability correction to an already-implemented feature (commit `7ca6b85`, still present and wired into Planning and route Riding), not a request to invent moving distance markers.
    - Real-device route maps have shown the small white route-direction arrows but no visibly readable numbered distance badges. Existing automated coverage (`distanceBadgeLayer.test.ts`, `distanceBadgeMarkerElement.test.ts`, `MapView.test.tsx`'s distance-badge-overlay suite, `e2e/distanceBadges.spec.ts`) proves marker specifications/DOM elements, text, counts, layout boxes, rotation behaviour and retry deduplication, but nothing in that coverage checks real paint/occlusion above the MapLibre canvas. Treat `.distance-badge-marker`'s current `z-index: -1` (`src/index.css`) as a concrete hypothesis to investigate — not a diagnosed root cause — until proved by real-browser evidence in this slice.
    - No route-distance badges in free roam; there is no route (already true of current source — `FreeRoamScreen` passes an empty `points` array).
    - Badges are fixed landmarks at absolute distances measured along the route from its start. They must never slide along the route as a moving `1 km ahead` marker.
    - Density adapts to zoom while badge coordinates stay fixed: approximately every 1 km close in, every 5 km at ordinary Riding zoom, every 10 km at a wider overview, and every 20 km at a very wide overview. Preserve deterministic thresholds, collision/merged-distance handling, and a bounded visible count so the map remains restrained.
    - During active Riding, passed badges remain hidden (already implemented via `filterActiveRidingCandidates`/`distanceBadgeProgressMetres`). Planning may show the applicable whole-route set.
    - Use explicit compact labels such as `5 km` and `20 km`, including an unambiguous compact form for merged loop/out-and-back coincidences.
    - Zooming changes only the displayed subset, never badge locations or route progress.
    - Fix the proven paint/stacking/visibility cause. Do not alter the separate white route-direction arrows.
    - Add real-browser regression evidence that proves a badge is actually visible and unobscured above the map, not merely present in the DOM or assigned a non-null bounding box. Cover normal imagery and the local fallback background, zoom-band transitions, Riding's passed-badge filtering, map rotation, retry without duplication, and explicit absence in free roam.

---

<a id="item-85"></a>

## Item 85 — Simplify active Full/2 km/10 km feature inspection

_Category: Active-Riding elevation/profile presentation_

85. **Simplify active Full/2 km/10 km feature inspection**
    - Field observation: item 80 correctly moved the live active-Climb view and the manually opened upcoming-climb preview to the compact `Local gradient colours on this climb` disclosure. It did not change active Full, 2 km or 10 km, which still fall through to the older, combined `GradientColoursDisclosure` explaining both macro recognised-climb/descent colours and detailed local-gradient colours. Selecting, or merely occupying, a recognised feature there can also drive local-gradient micro-segment colouring and the shared feature/segment detail panels — duplicating analytical detail that is useful before a ride or in Settings but too verbose for the fixed, glanceable active-Riding Profile pane. The rider wants Full/2 km/10 km to answer "what terrain lies ahead?" without a long legend or analytical drill-down; the dedicated Climb presentation remains the place for local-gradient detail while riding.
    - Separate visual defect, recorded without a diagnosed cause: the shared `Clear selection` button's lower 1 px border appears trimmed or incompletely painted on a real device. Current source gives it only the generic global `button {}` rule in `src/index.css` (no dedicated class); the supplied real-device screenshot does not prove whether this is subpixel rasterisation, stacking, overflow clipping or another paint issue.
    - Settled information hierarchy to preserve across contexts:
      - Pre-ride full-route overview and pre-ride selected feature: Profile colouring stays the existing climb-category/full selected-feature presentation; explanatory/detail content stays the existing pre-ride disclosures, selected climb/descent detail charts and analytical facts.
      - Active Full/2 km/10 km: Profile colouring limited to macro recognised-climb category and recognised-descent colours only, with no colour legend; an explicit recognised-feature tap shows only a compact Riding summary.
      - Active Climb/current-climb preview: unchanged — local gradient colours, the existing compact `Local gradient colours on this climb` disclosure and current progress/preview information.
      - Settings: unchanged — remains the complete, always-available category, local-gradient and climb-score reference, independent of any open route.
    - Active Full/2 km/10 km behaviour:
      - Remove the combined `Gradient colours` disclosure entirely from active Full, 2 km and 10 km. Do not replace it with another route-wide legend there.
      - Keep the chart's macro feature colouring unchanged: recognised climbs retain category colours, recognised descents retain their existing blue bands.
      - Tapping a recognised climb or descent in these views selects and visually emphasises that feature's macro range without replacing it with local-gradient micro bands.
      - Do not show local-gradient recolouring, a local-gradient disclosure, a `GradientSegmentDetailsPanel`, a second detailed feature chart, maximum/steepest local gradient or climb score in these active views.
      - A recognised feature merely being the rider's current feature must not automatically open a summary card in Full/2 km/10 km — the summary is an explicit inspection result from a rider tap. The dedicated Climb state continues to handle an actually active climb automatically under its existing (item 80) rules.
      - Tapping ordinary, unrecognised route geometry must not fabricate a feature summary.
      - Clearing the explicit selection removes the summary and selection emphasis and returns the chart to its ordinary macro presentation, without changing the selected Full/2 km/10 km window.
    - Compact selected-feature summary contains only:
      - a heading: the recognised climb category, or `Recognised descent`;
      - relative position as the primary spatial fact, using only the existing frozen/reliable presentation distance: `Starts in …` when ahead, `… remaining` when inside it, and an honest passed state if an explicitly selected feature becomes passed before it is cleared;
      - compact absolute route position as a quieter secondary fact;
      - length;
      - elevation gain for a climb or elevation loss for a descent;
      - average gradient.

      Prefer a compact one- or two-row presentation such as `Starts in 2.4 km · 5.1 km · 373 m ascent · 7.3% average`, wrapping at enlarged text rather than truncating. No new navigation/projection logic: relative wording must use the existing frozen/reliable presentation distance and existing feature boundaries.

    - Retain an explicit, fully named, glove-usable `Clear selection` action — integration into the summary card is fine, but it must not rely solely on re-tapping a chart feature or an unexplained icon. Preserve an effective touch target of at least 44 × 44 px, keyboard focus visibility and correct accessible naming.
    - `Clear selection` border correction:
      - investigate the incomplete lower-border paint in a real browser before choosing a CSS fix;
      - correct it in every context that renders the shared action, including the pre-ride selected-climb/descent panel (`RouteFeatureDetailsPanel`) and the new compact active summary;
      - ensure every border edge and the full focus indication remain visibly intact at ordinary and enlarged text, light/dark system appearance if supported, iPhone portrait and short landscape, and Chromium-emulated Android;
      - do not add arbitrary bottom margin, thicken all global button borders, or change the global `button {}` rule in `src/index.css` unless evidence proves the defect is genuinely global;
      - preserve the enclosing card's border, radius, padding and scroll behaviour unless the diagnosed cause requires the smallest targeted adjustment.
    - Strict preservation boundaries — do not change:
      - pre-ride selected-climb or selected-descent behaviour, including their detailed charts, local-gradient disclosures and full analytical facts;
      - Planning's feature selection or legends;
      - Settings' `Elevation and climbs` reference content;
      - active Climb/current-climb-preview colouring, compact disclosure, progress metrics, automatic entry, dismissal or return-to-Profile behaviour;
      - climb/descent recognition, category scoring, local-gradient classification, route-feature boundaries, elevation calculations, GPS matching, window selection or the fixed four-slot Profile selector from item 80.
      - Do not merge the pre-ride and active summary components if a small explicit presentation variant or wrapper preserves clearer semantics and lower regression risk.
      - Keep the fixed active Profile pane non-scrolling at ordinary phone portrait sizes; its existing bounded internal-scroll fallback may remain for enlarged text or genuinely short landscape viewports.
    - Required future implementation evidence — focused deterministic tests proving at least:
      - active Full, 2 km and 10 km show no combined `Gradient colours` disclosure;
      - their charts retain macro climb/descent colouring before and after selection;
      - selecting a recognised climb or descent keeps macro colouring, adds selection emphasis and shows the compact permitted fact set only;
      - no local-gradient band overlay/disclosure, segment detail, extra feature chart, maximum local gradient or climb score appears in those active views;
      - merely entering a recognised feature does not auto-open the Full/2 km/10 km summary;
      - relative `Starts in`/inside-remaining/passed wording uses the frozen/reliable presentation distance and behaves correctly through stale/off-route freezing;
      - clearing selection preserves the selected elevation window and removes only selection state;
      - active Climb and climb-preview retain item 80's local-gradient presentation unchanged;
      - pre-ride climb/descent selection and detailed presentation remain unchanged;
      - the `Clear selection` border and focus indicator are perceptibly complete in a real browser, not merely assigned a computed `border-width` — use paint/occlusion evidence or an equivalently strong visual regression rather than a DOM-presence assertion;
      - phone portrait, short landscape, enlarged text and the existing Chromium-emulated Android project remain free of horizontal document scrolling, clipped actions and inaccessible controls.
    - Do not prescribe sleeps, retries, arbitrary timeout increases or broad screenshot churn. The future implementation slice must run its normal complete verification gate and bump the application version only if it makes a genuine production change, following repository precedent.
