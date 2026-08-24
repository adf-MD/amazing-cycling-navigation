# Planning backlog — full pending item specifications

This file holds the complete, byte-preserved specification for every backlog item that is **approved future work but not yet implemented**, plus the two items that are explicitly monitored/investigated-but-unconfirmed (see [current-status.md](current-status.md) instead for those two — items 32 and 66).

Item numbers are stable identifiers across this project's entire documentation set — they never change regardless of which file an item's text lives in. See [README.md](README.md) for the full map of where everything lives, and the root [`CLAUDE.md`](../../CLAUDE.md) for durable product/engineering rules and the required reading order before implementing any item here.

Item 74 is the next selected implementation slice — an evidence-gated investigation into an intermittent free-roam initial Follow zoom observation (see item 74 below). Items 75–78 follow it in order as subsequent approved slices. Items 11, 12, 16, 28, 59, 60 and 61 below remain approved future work, not yet scheduled into the sequence.

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

<a id="item-74"></a>

## Item 74 — Investigate intermittent free-roam initial Follow zoom

_Category: Riding camera reliability investigation_

74. **Investigate intermittent free-roam initial Follow zoom**
    - Field evidence, recorded precisely and without overstating it:
      - This has occurred once in free roam and is not deterministic.
      - The rider believes it was probably a fresh free-roam Start, but that detail is recalled rather than proven.
      - The rider did not intentionally zoom out beforehand.
      - The screen showed a live GPS fix and Follow visibly selected while the map remained at an approximately whole-world zoom.
      - Pressing Follow did not reset the zoom. That behaviour is correct in principle because Follow is required to preserve the rider's selected zoom.
      - Both direct map zooming and the `+` control could restore a normal close navigation view.
      - The abnormal zoom was then preserved when the session was paused/resumed, suggesting that the application may have accepted and persisted the unintended zoom as the Follow zoom.
      - Do not describe free roam as always starting at world zoom, or the problem as reproducible on demand.
    - Kept separate from item 66:
      - Item 66 concerns a previous, intermittent fresh route-Start symptom that remained at a wide whole-route-like view.
      - The free-roam occurrence shares the broad invariant that an active Follow camera did not reach a sensible navigation presentation, but there is no proof of a shared root cause.
      - Item 65's anchored zoom correction must not be credited as causing or fixing this occurrence.
    - Specify an evidence-gated investigation:
      - Inspect the complete free-roam camera lifecycle and exact event ordering among:
        - the fresh-session seed and asynchronous stored-state read;
        - `FreeRoamScreen`'s initial `requestFollow()`;
        - MapLibre instance/style readiness;
        - the raw/default initial camera settle;
        - the first fresh GPS fix;
        - creation and application of the first actionable Follow camera command;
        - `camera-settled` and `follow-zoom-settled` reconciliation;
        - persistence after the first fix and restoration on Resume.
      - Determine which camera move produced every settled zoom before changing behaviour. A plausible race is not a confirmed diagnosis.
      - Construct deterministic component and real-browser orderings where possible. Use controllable events, deferred promises and existing map/geolocation test seams. Do not rely on arbitrary sleeps.
      - Explicitly test a fresh free-roam Start, a deliberate user-selected Follow zoom, Pause/Resume, and map readiness occurring before and after the first GPS fix.
      - Preserve the settled product contract:
        - deliberate zoom choices persist;
        - pressing Follow preserves the selected zoom;
        - `+`/`-` while genuinely following keep the GPS anchor and Follow mode;
        - a genuine gesture still pauses Follow;
        - route Riding is not changed merely because it shares camera machinery.
      - Do not mask the symptom with an arbitrary zoom clamp, an unconditional reset to `NAVIGATION_ZOOM`, retries, longer timeouts or a Follow re-press that silently discards the rider's zoom.
      - If a failing ordering and causal production defect are demonstrated, implement the smallest invariant-based correction and a deterministic regression test within item 74.
      - If the production defect cannot be reproduced, do not invent a fix. Record the tested orderings and outcome honestly. Add narrowly scoped, local Diagnostics-visible camera lifecycle evidence only if it is demonstrably useful for capturing a future recurrence. It must not become telemetry, retain location history or expose private coordinates unnecessarily.
      - Keep real-device re-acceptance explicit because automated Chromium cannot prove the original intermittent iPhone PWA timing.

---

<a id="item-75"></a>

## Item 75 — Compact active-Riding status and recovery presentation

_Category: Immersive Riding interface and resilience_

75. **Compact active-Riding status and recovery presentation**
    - Apply the agreed design to both route Riding and free roam:
      - Move the wake-lock control inside the existing bordered route/GPS status card, not merely into a separate stacked wrapper near it.
      - Use the compact visible label `Screen on` with its checkbox and information control. Retain an accessible name that explains the control fully.
      - Preserve the proven wake-lock acquisition, release, retry, suspension and persistence lifecycle. This is a presentation/composition change, not a wake-lock rewrite.
      - Preserve comfortable touch targets and the existing information popover without allowing it to resize the map or fixed shell.
    - For route Riding, target this glance hierarchy:
      1. top row: route status on the left and `[checkbox] Screen on` plus information on the right;
      2. remaining distance and remaining ascent;
      3. compact GPS freshness/accuracy and connectivity/recovery state.
    - Use an analogous compact composition in free roam without inventing route-specific information.
    - Consolidate active error/status presentation:
      - Replace the large standalone offline paragraph with a compact `Offline` indication in the status card.
      - Only show a map-specific failure overlay when imagery has actually failed. Being offline by itself must not claim that already-cached imagery is unavailable.
      - Make the actual map-imagery overlay substantially smaller. Use concise non-technical wording such as `Map imagery unavailable` and retain an immediately reachable compact Retry action.
      - Preserve item 67's automatic single retry on reconnection, manual retry, no-loop guarantee, camera preservation and technical Diagnostics logging.
      - Replace the large standalone GPS error card with a compact, clearly urgent status row and an inline `Try again` action. Preserve the last known fix as stale and keep the existing recovery semantics.
      - Avoid duplicated offline/map-failure messages.
      - The simultaneous offline plus GPS-error case must leave a useful amount of map visible rather than allowing normal-flow cards to consume most of the screen.
    - Do not cover the Map/Profile switcher, elevation-window controls, map camera controls, climb cue or required attribution.
    - Preserve screen-reader announcements, focus recovery and visible error distinction. Compact must not mean silent.
    - Prove phone portrait, landscape, enlarged text and the simultaneous failure combinations in route Riding and free roam. Real-device acceptance remains required.

---

<a id="item-76"></a>

## Item 76 — Riding profile-selector and primary-navigation edge polish

_Category: Small interface correction_

76. **Riding profile-selector and primary-navigation edge polish**
    - Keep this deliberately narrow:
      - The selected `Full` profile button's outer focus/selection ring is currently clipped at the left screen/pane edge.
      - Give the complete elevation-window selector row a small, symmetric horizontal inner inset so no selected outline is clipped at either edge.
      - Cover the three-button and four-button (`Climb` available) states, plus portrait, landscape and enlarged text.
      - Do not special-case only `Full`, shift individual buttons with ad hoc margins or change the selector's meaning/order.
    - Correct the primary sticky navigation's bottom divider so it touches the navigation row in the same deliberate way as the top divider. Remove the visible strip of unused space between buttons and the bottom line.
    - Do not alter active Riding's non-sticky immersive header, navigation destinations, touch-target sizes, focus order or adaptive-navigation item 28.
    - Prefer a small CSS/layout correction with focused regression coverage, not a broader navigation redesign.

---

<a id="item-77"></a>

## Item 77 — Climb-only colouring and legend for the pre-ride full profile

_Category: Pre-ride elevation-profile presentation_

77. **Climb-only colouring and legend for the pre-ride full profile**
    - Scope this to the pre-ride full-route elevation overview:
      - Keep the ordinary elevation profile line black.
      - Colour recognised climbs using their overall climb-category colours.
      - Stop colouring recognised descents blue in this full elevation overview. The profile shape already communicates that the route descends.
      - Do not change the pre-ride map overview. Its route-feature colouring for recognised climbs and descents remains useful because the map does not itself show elevation.
      - Do not remove recognised-descent analysis, selection or detailed inspection.
      - Do not silently change active Riding's `Full`, `2 km`, `10 km` or `Climb` presentations in this slice unless current shared architecture makes an isolated pre-ride change impossible. If so, stop and document the conflict instead of broadening scope without approval.
    - Replace the full-profile legend with an overview-specific disclosure:
      - Use a concise title such as `Climb categories`.
      - List only climb categories that actually occur on the current route, once per category, in a stable severity/order.
      - Do not include an `Ordinary route` row, since the profile's ordinary line is black rather than the map's green route colour.
      - Do not include recognised-descent rows.
      - Hide the disclosure entirely when the route has no recognised climbs.
      - Remove the overview prose beginning `Overall climb colours depend on...` and do not include the selected-feature local-gradient explanation in the overview disclosure.
      - Keep the legend collapsed by default and accessible.
    - Cover no-climb, climb-only, mixed climb/descent, repeated-category and multiple-category fixtures. Explicitly prove that the map-layer presentation remains unchanged.

---

<a id="item-78"></a>

## Item 78 — Selected-feature local legends and climb-score explanation

_Category: Pre-ride recognised-feature detail and Settings help_

78. **Selected-feature local legends and climb-score explanation**
    - Split selected-feature explanation from the overview legend:
      - A selected recognised climb receives its own collapsed disclosure titled along the lines of `Gradient colours on this climb`.
      - Place it immediately below the selected climb's detailed chart, before the statistics, so the explanation is visually associated with the colours it describes.
      - Keep the detailed local-gradient colouring within the selected climb.
      - Preserve selected recognised-descents and their detailed blue presentation. Give a selected descent its own corresponding local-colour disclosure rather than reintroducing descent rows into the overview legend.
      - Keep the disclosures collapsed by default and accessible by keyboard and screen reader.
      - Remove the long prose beginning `Detailed colours show local gradient...` from the shared overview area.
      - Remove `Values are derived from available route elevation data.` from selected feature details.
      - Do not change climb/descent detection, smoothing, boundaries, scores, category assignment or chart data.
    - Add an in-app Settings explanation:
      - Add an expandable/focusable section such as `How climbs are classified`.
      - Explain the current implementation accurately, deriving wording and thresholds from current source rather than treating this prompt as a substitute for inspection:
        - climb score is climb length in metres multiplied by average gradient percentage;
        - recognition requires at least 500 m length, at least 3% average gradient and a minimum score of 1,500;
        - uncategorised: below 8,000;
        - Category 4: 8,000 to 15,999;
        - Category 3: 16,000 to 31,999;
        - Category 2: 32,000 to 63,999;
        - Category 1: 64,000 to 79,999;
        - HC: 80,000 or more.
      - Present thresholds clearly using existing project-owned names/formatters where practical, avoiding a second drifting source of classification logic.
      - Add `How is this calculated?` beside or immediately after a selected climb's score. It should navigate to Settings, focus and open the explanation in one action.
      - Preserve the active route/route selection so returning from Settings does not lose the user's context.
      - A selected descent has no climb score and therefore no climb-score link.
      - Test navigation/focus, repeated activation, browser back/application return behaviour where relevant, and enlarged phone text.
