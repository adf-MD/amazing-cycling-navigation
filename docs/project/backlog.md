# Planning backlog — full pending item specifications

This file holds the complete, byte-preserved specification for every backlog item that is **approved future work but not yet implemented**, plus the two items that are explicitly monitored/investigated-but-unconfirmed (see [current-status.md](current-status.md) instead for those two — items 32 and 66).

Item numbers are stable identifiers across this project's entire documentation set — they never change regardless of which file an item's text lives in. See [README.md](README.md) for the full map of where everything lives, and the root [`CLAUDE.md`](../../CLAUDE.md) for durable product/engineering rules and the required reading order before implementing any item here.

Items 11, 12, 16, 28, 59, 60 and 61 below remain approved future work, not yet scheduled into the sequence. Items 87–92 were added by the [release-readiness audit](release-readiness-audit.md) (item 86); items 87–92 have since been completed. Items 107–113 were added by the installed-iPhone field test of 10 September 2026 (see [current-status.md](current-status.md) for the dated evidence) and are all scheduled ahead of items 102 and 103, which keep their numbers; the authoritative execution order lives in the root [`CLAUDE.md`](../../CLAUDE.md)'s queue index and is deliberately not duplicated here.

Entries below are ordered by item number (not by their original position in the source document, since categories repeated non-contiguously there). Entries through item 93 reproduce their original text verbatim, with only the minimal bracketed pointers needed to keep cross-references navigable after this document was split out of a single monolithic `CLAUDE.md` (see that root file's own note on this). Items 94 and later are new post-0.4.0 specifications authored directly into this file, following the same structure and conventions.

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

<a id="item-102"></a>

## Item 102 — Primary-navigation symbol redesign with mock-ups

_Category: Interface design_

102. **Primary-navigation symbol redesign with mock-ups**
     - Confirmed current implementation: `src/ui/shared/MainNavigation.tsx` (destinations/labels) rendering hand-drawn inline SVG glyphs per screen from `src/ui/shared/NavIcon.tsx`.
     - The current primary-navigation symbols should be reconsidered for semantic clarity and a more coherent visual language.
     - Before any production icon change, produce at least three concrete, phone-sized mock-up directions using the real navigation destinations and labels. Show selected/unselected states, normal and narrow widths, safe-area treatment and enlarged text.
     - Keep visible text labels. Do not propose icon-only navigation, and do not use colour as the sole selected-state signal.
     - Compare recognisability, visual weight, stroke/fill consistency, ambiguity, platform neutrality and fit with the ACN identity. Avoid emoji or symbols whose appearance depends on the operating-system font.
     - Preserve established touch-target sizes, accessible names, keyboard focus and current navigation behaviour.
     - Identify the provenance/licence of any external icon family. Prefer project-owned SVGs or a deliberately selected, compatible open-licence set rather than copying arbitrary artwork.
     - Present the alternatives for explicit user choice. Production implementation, screenshots and physical-device acceptance follow only after a direction is approved, in a separate bounded slice if appropriate.
     - Cross-reference item 28 ("Optional adaptive compact navigation while scrolling", pending, not approved/scheduled — candidate only): this item's symbol redesign does not approve, schedule or implement item 28's adaptive scroll-based compaction. The two are independent — one is visual language, the other is a still-unapproved behavioural change to the navigation itself.
     - Do not use this item as permission to redesign every screen or restructure navigation destinations.

---

<a id="item-103"></a>

## Item 103 — Visual-consistency audit and staged control-style refinement

_Category: Interface and accessibility consistency_

103. **Visual-consistency audit and staged control-style refinement**
     - The application has accumulated inconsistent typography and control presentations. Confirmed concrete example: the `Avoid ferries by default` setting (`src/ui/settings/SettingsScreen.tsx`) currently renders as a bare native `<input type="checkbox">` with only touch-target sizing applied (`.setting-row-checkbox`, `src/index.css`) — not built on the shared `.btn-primary`/`.btn-secondary` token vocabulary used elsewhere, and visually out of place beside the surrounding route-planning controls.
     - Begin with a bounded audit, not a blanket CSS rewrite. Inventory the typography hierarchy, labels/hints, buttons, checkbox/radio/toggle patterns, panels, disclosures, focus states, disabled states, errors and status treatments across the five screens.
     - Reconcile findings with the existing shared token/button/layout foundation (`src/index.css`'s spacing/radius/shadow tokens, colour roles, button vocabulary, `.screen`/`.stack`/`.row` layout classes) and the completed interface/accessibility migration (`docs/project/history/interface-accessibility-migration.md`). Reuse or extend that vocabulary deliberately instead of introducing a second design system or third-party component framework.
     - Produce focused mock-ups for materially different decisions, including the ferries control, before changing production presentation.
     - Preserve native/accessibility semantics even if the visual treatment becomes custom. Cover checked/unchecked, focus-visible, disabled, saving, error, narrow-phone and 200%-text states.
     - Split implementation into small component or pattern slices after the audit. Do not mechanically restyle every screen in one commit.
     - Coordinate with item 102 so the navigation choice and broader visual vocabulary converge, but do not make every item technically dependent on a complete application redesign.
     - No settings behaviour, routing preference semantics, persistence or navigation structure changes belong to this visual item.

---

<a id="item-107"></a>

## Item 107 — Investigate navigation recovery around overlapping route geometry after suspension

_Category: Ride navigation correctness_

107. **Investigate navigation recovery around overlapping route geometry after suspension**
     - Origin: the installed-iPhone field test of 10 September 2026 — see [`current-status.md`](current-status.md) for the dated report. During a route ride, after ACN had been suspended and connectivity had been absent for a substantial period, the resumed position appeared to be matched to the wrong part of overlapping or closely adjacent route geometry.
     - **What is deliberately not claimed, and must not become claimed by implication anywhere downstream of this entry.** ACN is **not** claimed to have failed to recover: the rider may subsequently have seen automatic recovery, or may have pressed the existing retry control, and which of those actually happened was not recorded at the time. The prolonged absence of connectivity is **not** classified as a defect — riding through it is exactly what this application is built to do, and a saved route's line, position, progress and elevation are all designed to work without the network. No root cause is claimed, and nothing recorded below is a diagnosis. What **is** recorded is the incorrect or ambiguous progress match itself, as a correctness observation requiring investigation.
     - Confirmed current implementation, recorded here as ground truth this investigation must reconcile with rather than extend past — and, as with item 59, recorded as fact rather than as an admission of a defect or a request to retune any constant:
       - `src/navigation/projection.ts`'s `projectFixOntoRoute(fixCoordinate, points, lastMatch)` searches a `±WINDOW_RADIUS_METRES` (400 m) window measured in **route-distance** space around the previous accepted match, not in geographic space — that choice is precisely what stops a self-intersection or an out-and-back from snapping to the wrong pass.
       - Within that window it recovers additional near-exact geometric ties (`LATERAL_TIE_TOLERANCE_METRES` = 0.01 m, with `OCCURRENCE_SEPARATION_METRES` = 1 m separating array-adjacent qualifying segments into distinct occurrences) and resolves them in `selectAmongOccurrences`: the continuity-nearest occurrence by `|candidate − lastMatch|` wins by default, and a forward override engages **only** when the continuity-nearest is a genuine regression beyond `PROGRESS_EPSILON_METRES` (5 m), and then only when the advancing candidate sits no more than `CONTINUITY_PREFERENCE_METRES` (30 m) farther than the nearest.
       - The windowed result is **discarded** — falling through to a whole-route search with no continuity protection at all, reported as `reacquired: true` — when the match's lateral distance exceeds `MAX_ACCEPTABLE_LATERAL_METRES` (300 m) or the window is clipped at a genuinely truncated edge.
       - `src/navigation/rideNavigationCore.ts`'s `processFix` anchors every fix on the previous accepted `lastMatch`, and on a `tied-sub-epsilon-regression` disposition holds **both** `lastMatch` and the presentation-only `lastReliableMatch` at their previous values; that hold is bounded by cumulative regression exceeding `PROGRESS_EPSILON_METRES`, not by elapsed time or fix count.
     - Confirmed current restoration path, likewise recorded as ground truth: `src/storage/mapping.ts`'s `fromStoredRideState` rebuilds the projection anchor from the persisted `lastMatchedPointIndex` and `matchedDistanceFromStartMetres` — but **only when `stored.lastFix` is non-null**; otherwise `lastMatch` is `null`, and the first fix after resume therefore takes the whole-route branch rather than the windowed one. The same is true when no stored row matches the open route at all, or when the restoration read throws. `src/ui/riding/useRideNavigation.ts` owns the surrounding lifecycle: the mount/retry restoration effect, the persistence effect that upserts after every accepted fix, and `resumeIfWatching`, which on `visibilitychange`/`pageshow` marks the fix stale and restarts the watch only when the status was already `watching`.
     - The investigation should inspect **how ride progress is restored** and **how candidate positions are selected when route geometry overlaps or revisits the same area**, treating those as two questions that may or may not share an answer. It must preserve valid progress continuity, must avoid an implausible jump to another occurrence of the same geometry, and must add discriminating automated evidence **before** any matching behaviour is changed — a test that passes equally with and without the change proves nothing, per this project's repeated negative-control discipline.
     - If the original failure cannot be reproduced, record that limit honestly and derive tests from the confirmed state transitions above rather than inventing certainty. A closure of the "investigated, not reproduced" kind is an acceptable outcome for this item, exactly as it was for item 66; a speculative fix on unreproduced evidence is not.
     - Cross-references, none of which is reopened or weakened by this item: item 104 ([`history/items-104-NN.md#item-104`](history/items-104-NN.md#item-104)) fixed a genuinely confirmed exact-overlap turnaround defect and carries the most directly relevant precedent — including its central lesson that the defect was **cadence-dependent, not short-route-specific**, and that two plausible competing hypotheses were refuted by direct measurement rather than by precedent. Item 98 ([`history/items-95-99.md#item-98`](history/items-95-99.md#item-98)) concerns how overlapping geometry is _presented_ rather than matched. Item 66 ([`current-status.md#item-66`](current-status.md#item-66)) is the standing example of a camera-correctness field symptom that closed without reproduction. Nothing here implies any of them regressed.
     - Physical acceptance on the installed iPhone Home Screen PWA is required for any behaviour change this item eventually makes, since the observation came from there. Physical Android verification is separately outstanding, as for most recent items.

---

<a id="item-108"></a>

## Item 108 — Relocate active-riding map-imagery status and compact the climb cue

_Category: Riding presentation_

108. **Relocate active-riding map-imagery status and compact the climb cue**
     - Origin: the installed-iPhone field test of 10 September 2026 — see [`current-status.md`](current-status.md) for the dated report. A screenshot showed the "Climb active" cue and the delayed-map-imagery explanation occupying the same top portion of the map and overlapping one another. **This is an approved implementation slice, not a design candidate.**
     - The missing base imagery itself was **expected** during the prolonged offline period and is explicitly **not** a separate map-loading defect. Nothing in this item is a report against the imagery pipeline's own correctness; it is about where imagery status is presented and how much of the map the climb cue occupies.
     - **Approved product behaviour — map-imagery status placement.**
       - During **both Route riding and Free roam**, all map-imagery status belongs in the existing top riding-status card rather than in an overlay over the map.
       - A transient slow load may add a compact status-card row explaining that imagery is loading slowly, and that the route and position remain visible.
       - A retryable or terminal imagery problem should transition that row to the appropriate unavailable state and retain the existing **Retry map imagery** action where retry is meaningful.
       - Avoid redundantly repeating that the device is offline when the same card already communicates connectivity.
       - The imagery row disappears when imagery recovers. **Do not add a fixed disappearance timeout** that could conceal a continuing imagery failure.
       - Suppress **both** the in-map delayed-imagery banner **and** the in-map initial-loading message during active Route riding and Free roam — that is, whenever the screen supplies the external status card. A brief initial load need not immediately create a status-card row at all; the existing grace period is the right mechanism for preventing a flicker, rather than a new timeout.
       - Planning and other contexts without the riding-status card retain their existing in-map imagery explanation, unchanged.
       - Route riding may retain the climb cue over the map. Free roam has no climb cue to add.
     - **Wording must fit its context, and the two contexts differ.** Route riding may say that the route and position remain visible. **Free roam must mention only the position, because no route is active there.** Do not force identical copy through the shared presentation helper when the two contexts genuinely need different wording. Confirmed by direct source inspection during the documentation of this item (a source finding, not a field report): `src/ui/riding/mapImageryRecoveryPresentation.ts`'s `describeMapImageryRecovery` is currently the single copy authority for both cards, and its `tile-error` message — "Map imagery unavailable. The route and your position are still shown." — is therefore already shown in Free roam, where there is no route. Correcting that is in scope for this item.
     - Confirmed current implementation, recorded as ground truth rather than as a prescribed design:
       - `src/map/MapView.tsx` renders `.map-status-overlay` inside the map with five mutually exclusive messages: initial loading, the delayed-imagery banner (`map-imagery-delayed-banner`, "Map imagery is taking longer than usual to load. Your route and position are still shown."), the load error, the tiles-unavailable banner and the fallback banner. Only the last three relocate today, gated on `hasExternalImageryPresentation` (which is simply `onImageryStatusChange !== undefined`); the initial-loading and delayed-imagery messages deliberately always stay in the map. That deliberate exclusion is precisely what this item changes, so the existing comments recording the old rationale must be updated rather than left contradicting the code.
       - `describeMapImageryRecovery` maps the three relocating kinds (`load-error`, `tile-error`, `fallback`) to message, ARIA role and test id, and is consumed by exactly two components — `src/ui/riding/RidingStatusCard.tsx` and `src/ui/riding/FreeRoamStatusCard.tsx` — which each render a `ride-status-card-imagery-row` plus the shared `map-status-retry-button`.
       - Both cards already carry a `ride-status-card-connectivity` Online/Offline indicator (`ConnectivityIcon` plus text), which is what makes a second "you are offline" statement redundant.
       - `MapImageryRecoveryStatus` deliberately carries only a `kind` and no message, and `ImageryRetryCommand` is deduplicated by `requestId`; the in-map and status-card retry paths already converge on the same handler.
       - CSS coupling to check before moving anything: `.map-status-overlay`'s `top: 72px` exists specifically to clear `.ride-climb-cue`'s worst-case height, and `src/index.css` records that reasoning inline. If the overlay no longer appears during riding, that reservation and its comment need revisiting together rather than either being left stale.
     - **Approved product behaviour — the climb cue's presentation.** The cue currently uses three lines and leaves excessive empty space, while the previous truncating treatment was also undesirable. Require the **outcome**, not one exact CSS arrangement:
       - preserve "Climb active", the remaining distance and the **View climb** action without truncating meaningful text;
       - make the cue materially more compact at ordinary supported portrait widths;
       - allow accessible reflow at enlarged browser text sizes;
       - avoid covering an unnecessary amount of the route ahead;
       - do not overlap map controls, attribution, other live notices or the imagery status;
       - retain usable touch targets and existing climb behaviour.
     - Confirmed current climb-cue implementation: `src/ui/riding/RidingClimbCue.tsx` renders `.ride-climb-cue` containing `.ride-climb-cue-text` (a `role="status"` `.ride-climb-cue-title` reading "Climb active", and a plain `.ride-climb-cue-detail` carrying the continuously-updating remaining distance) beside a `.ride-climb-cue-action` **View climb** button; it is a sibling of `MapView` inside Riding's own `.ride-map-container`, absolutely positioned `top: 8px` with `left`/`right: 64px` to clear the zoom and camera control clusters. `src/index.css` records that item 82 deliberately **removed** the earlier `overflow: hidden` / `white-space: nowrap` / `text-overflow: ellipsis` combination because it clipped both lines at ordinary phone widths — so reintroducing truncation is a known-rejected direction, not an untried option. Existing Playwright coverage already asserts non-overlap in `e2e/distanceBadges.spec.ts`, `e2e/mapImageryRecovery.spec.ts` and `e2e/ridingClimbView.spec.ts`; extend that evidence rather than replacing it.
     - Cross-references: item 82 ([`history/items-81-88.md#item-82`](history/items-81-88.md#item-82)) made the cue fully readable and unified the status control; item 83 ([`history/items-81-88.md#item-83`](history/items-81-88.md#item-83)) is what originally relocated the three terminal imagery states into the status card and is the direct precedent for extending that relocation; item 96 ([`history/items-95-99.md#item-96`](history/items-95-99.md#item-96)) owns the slow-imagery grace period referred to above; items 94 and 75 are adjacent. None of them is reopened or weakened by this item, and their outstanding real-device checks in [`current-status.md`](current-status.md) stand unchanged except where this item's own presentation supersedes them.
     - Physical acceptance on the installed iPhone Home Screen PWA is required, in both Route riding and Free roam, since the observation came from there. Physical Android verification is separately outstanding, as for most recent items.

---

<a id="item-109"></a>

## Item 109 — Prevent the Planning waypoint marker and placement control from colliding

_Category: Planning presentation_

109. **Prevent the Planning waypoint marker and placement control from colliding**
     - Origin: the installed-iPhone field test of 10 September 2026 — see [`current-status.md`](current-status.md) for the dated report. A screenshot shows the numbered waypoint marker or badge visually sitting on the upper edge of the "Add waypoint here" control. **This is a confirmed presentation defect**, not a suspicion.
     - The future slice should prevent the waypoint marker and the placement action from visually colliding, while preserving:
       - the actual waypoint coordinate;
       - waypoint numbering;
       - the map interaction and placement workflow;
       - accessible control labelling and touch-target size;
       - normal behaviour at supported portrait widths and enlarged browser text.
     - **Do not assert a particular z-index, offset or DOM fix before the implementation inspects the cause.** The values below are recorded as the current state to start from, not as a diagnosis and not as a prescription.
     - Confirmed current geometry, from direct source inspection:
       - The placement control is a plain `<button type="button" className="planning-crosshair-callout">` rendered inline in `src/ui/planning/PlanningScreen.tsx`, absolutely positioned inside `.planning-map-container` at `bottom: 44px; left: 50%; transform: translateX(-50%)` — the `44px` chosen to clear `.map-attribution`'s bottom-left corner. It sets **no** `z-index` of its own.
       - The numbered marker is a plain DOM element built by `src/map/waypointMarkerElement.ts` (`createWaypointMarkerElement` / `renderWaypointMarkerElement`) from specs produced by `src/map/planningLayer.ts`'s `buildWaypointMarkerSpecs`, styled by `.planning-waypoint-marker` with `z-index: 2`, `pointer-events: none`, and a 26 px base size that shrinks to 20 px and then 16 px through the `data-marker-zoom-band` `regional` and `overview` bands.
       - The surrounding overlay clusters — `.planning-map-controls`, `.planning-map-zoom-controls` and `.planning-map-status-overlay` — all sit at `z-index: 5`.
       - `src/index.css` records that `.planning-waypoint-marker`'s `z-index: 2` is deliberately paired with `.distance-badge-marker`'s own positive value, with an explicit instruction not to change either in isolation. That pairing came out of item 84's real, measured badge-visibility regression, so a naive stacking change here is not obviously safe and must be checked against the distance badges as well.
       - The control's label is dynamic — `src/ui/planning/planningInteractionMode.ts`'s `describeCrosshairAction` produces "Add waypoint here", "Move the start here" / "Move waypoint N here", or "Insert after …" — so any fix must hold for the longest label the control can render, not only the default one.
     - Cross-reference item 84 ([`history/items-81-88.md#item-84`](history/items-81-88.md#item-84)) for the paired stacking rationale and for this project's established visual paint-proof methodology (region-based pixel coverage plus ancestry checks), which is the appropriate standard of evidence for a change of this kind. Nothing here reopens item 84.
     - Physical acceptance on the installed iPhone Home Screen PWA is required, since the observation came from there. Physical Android verification is separately outstanding, as for most recent items.

---

<a id="item-110"></a>

## Item 110 — North-pointing orientation indicator on the north-up control

_Category: Map camera controls_

110. **North-pointing orientation indicator on the north-up control**
     - Origin: the installed-iPhone field test of 10 September 2026 — see [`current-status.md`](current-status.md) for the dated report. The rider wants to know **where north lies relative to the currently rotated map**. They explicitly do **not** need another indication of their direction of travel.
     - Proposed behaviour, approved as the item's contract:
       - replace or augment the static `N` presentation with a clear arrow that points towards geographic north relative to the screen;
       - derive it from the map's **existing bearing**, not from continuous compass or heading-sensor tracking;
       - retain the control's existing north-up/reset action;
       - when the map is north-up, the arrow points upwards;
       - provide an accessible name that describes the **action**, not merely the icon;
       - do **not** add a rider-heading arrow or any continuous travel-direction feature;
       - verify that the implementation does not introduce a new battery-intensive sensor subscription.
     - **The implementation slice must first inspect the current map-bearing and north-up contracts, then use the smallest change consistent with them.** The findings below are the starting point for that inspection, not a design.
     - Confirmed current implementation:
       - Three sites render a literal `N` character with `aria-label="North-up, top-down view"` and `aria-pressed={isNorthUpTopDown}` — `src/ui/riding/RidingScreen.tsx` (`.ride-map-control--north-up`, inside `.ride-map-camera-controls`), `src/ui/riding/FreeRoamScreen.tsx` (byte-identical structure), and `src/ui/planning/PlanningScreen.tsx` (`.planning-map-control`). There is no SVG, glyph or rotation transform anywhere in the control today.
       - Bearing availability **differs by screen** and is the crux of the inspection. Planning already holds a live `settledOrientation.bearingDegrees`, set from `MapView`'s `onCameraSettled` callback, and derives `isNorthUpTopDown` from it against a 0.5° tolerance. Riding and Free roam receive the same `settled.bearingDegrees` in their own `onCameraSettled` handlers but pass it straight into `useRideCamera` / `useFreeRoamCamera`, which expose only `isNorthUpTopDown` plus a `persistableCameraState.bearingDegrees` that is hard-coded to `0` outside `free` mode — so no continuous bearing currently reaches the Riding or Free roam control. `MapView`'s own `cameraOrientation` state and its `data-camera-bearing` attribute are documented as diagnostic only and are deliberately not passed up; the map adapter deliberately exposes no `getBearing()` on its interface.
       - **Open implementation question, to be decided deliberately rather than assumed:** `onCameraSettled` fires on settle, so whether the arrow tracks continuously through a rotate gesture or only updates once the camera settles is a real choice with different plumbing costs. Decide it explicitly and record the reasoning; do not silently pick one.
       - Baseline for the "no new sensor subscription" check: an exhaustive repository-wide search finds **no** `deviceorientation`, `DeviceOrientationEvent`, `AbsoluteOrientationSensor` or compass code anywhere in `src/`, `e2e/` or `docs/` today, and no orientation permission request. The only heading-like value in the system is `GeolocationFix.headingDegrees`, which `src/storage/mapping.ts` deliberately restores as `null`. Any new subscription would therefore be a genuinely new capability and is not approved by this item.
     - Cross-reference the durable Riding rule on repeat Northwards/Follow presses and the `requestId`-based camera deduplication described in the root [`CLAUDE.md`](../../CLAUDE.md): the reset action's existing semantics must survive intact, including a second press after an intervening manual rotation. Item 66 ([`current-status.md#item-66`](current-status.md#item-66)) remains a monitored camera observation and is neither reopened nor addressed by this item.
     - Physical acceptance on the installed iPhone Home Screen PWA is required, covering Riding, Free roam and Planning. Physical Android verification is separately outstanding, as for most recent items.

---

<a id="item-111"></a>

## Item 111 — Contextual tag-filter counts in the Route Library

_Category: Route Library organisation_

111. **Contextual tag-filter counts in the Route Library**
     - Origin: the installed-iPhone field test of 10 September 2026 — see [`current-status.md`](current-status.md) for the dated report. As the number of tags grows, the filter chooser should help the rider understand which additional filters would still produce routes. Approved as an enhancement.
     - Approved semantics:
       - for every **unselected** tag, show the prospective number of routes that would remain if that tag were added to the current selection;
       - use the Route Library's existing multi-tag combination semantics rather than silently changing them;
       - visually subdue and, where semantically safe, disable an unselected tag whose prospective result count is zero;
       - do not rely on colour alone to communicate zero availability;
       - keep selected tags operable so they can always be removed;
       - update counts immediately when filters, routes or route tags change;
       - preserve the existing collapsed chooser, active-filter summary, Clear action and tag-management behaviour;
       - test empty, single-filter, multiple-filter, zero-result and live-update cases;
       - consider both ordinary portrait use and long labels without making the filter area permanently overwhelming.
     - **The implementation plan must confirm the existing filter semantics and accessible disabled-state behaviour before choosing the precise markup.** The findings below are that confirmation's starting point, not the markup decision.
     - Confirmed current implementation:
       - `src/ui/library/routeLibraryView.ts`'s `filterRoutesByTags` implements **AND** — a route must carry every selected tag — matching by `tagIdentityKey` identity rather than display spelling, with an empty selection matching everything through a vacuous `.every()`. `selectRouteLibraryGroups(routes, query, sortOrder, tagKeys)` composes the whole view in the order name filter → tag filter → pinned/unpinned partition → sort.
       - Chips are native `<button type="button" aria-pressed>` elements with class `tag-filter-chip` (`is-selected` when pressed), containing an absolutely positioned `.tag-filter-check` tick and a `.tag-filter-label`. They are rendered **only while the chooser disclosure is open**, deliberately, so nothing unreachable stays in the tab order. The collapsed summary comes from `describeActiveTagFilterCount` ("1 filter active" / "N filters active") beside a Clear tag filters button, and exactly one Clear ever renders.
       - The available-tag list comes from `collectTagSuggestions` over the **full unfiltered** live-query result, never from the currently filtered view.
       - **A per-tag count already exists and is a genuine reuse candidate:** `src/domain/routeTags.ts`'s `countRoutesByTagIdentity` counts routes (not occurrences) by tag identity, and is computed in `RouteLibrary.tsx` against the whole corpus purely to label the Manage-tags `<option>` entries. A _prospective_ count under the current selection is a different question, so confirm deliberately whether that function extends cleanly or whether a sibling is the honest answer — do not assume either.
     - Two decisions the implementation plan must settle explicitly **before** choosing markup, recorded here as open rather than pre-decided:
       - whether the prospective count also respects the active name search, given that the existing pipeline applies both the name filter and the tag filter;
       - exactly what "where semantically safe" means for disabling an `aria-pressed` toggle, given that a disabled control cannot be operated at all.
     - Carry this project's own hard-won focus caution into the disabled-state decision above: a browser ignores `.focus()` on a disabled element, and jsdom never auto-blurs an element that becomes disabled, so a focused chip that becomes disabled by a live update would strand focus. Items 105 and 106 ([`history/items-104-NN.md#item-105`](history/items-104-NN.md#item-105), [`history/items-104-NN.md#item-106`](history/items-104-NN.md#item-106)) are the precedent, item 106's root cause having been a focused control unmounted mid-event.
     - Do not change tag identity or normalisation, the storage lifecycle transaction, filter reconciliation, or any other item 100 stage 1–4A behaviour. This is a presentation and derivation slice.
     - Cross-references: item 100 stages 3 and 4A ([`history/items-100-103.md#item-100`](history/items-100-103.md#item-100)) for the filter and lifecycle contracts; item 106 for the current control layout, which this item must preserve; item 99 ([`history/items-95-99.md#item-99`](history/items-95-99.md#item-99)) for the adjacent sorting control. Item 100 stage 4B is closed and is **not** reopened by this item.
     - Physical acceptance on the installed iPhone Home Screen PWA is required. Physical Android verification is separately outstanding, as for most recent items.

---

<a id="item-112"></a>

## Item 112 — Diagnostics and Settings information-architecture review

_Category: Information architecture_

112. **Diagnostics and Settings information-architecture review**
     - Origin: the installed-iPhone field test of 10 September 2026 — see [`current-status.md`](current-status.md) for the dated report. The current division between Diagnostics and Settings may mix explanatory material, status information and configurable properties in ways that are not always intuitive. Much of Diagnostics remains useful and **should not be discarded merely because the application matures**.
     - **This item is not approval to merge the tabs, and the name "Properties" is not approved.** Nothing in this entry pre-commits to a merger, to that name, or to removing diagnostics that remain useful. A staged, decision-gated review is what is approved.
     - Stages, in order, each completed before the next begins:
       1. **Inventory** the content and actions currently owned by Diagnostics and Settings.
       2. **Classify** each as configuration, live status, troubleshooting, technical explanation or recovery action.
       3. **Evaluate** whether the screens should remain separate, be regrouped, or share a clearer parent structure.
       4. **Recommend** plain-language terminology and navigation that remains understandable to non-technical riders.
       5. **Return the recommendation for product approval** before making any broad navigation or naming change.
       6. **After approval**, implement and verify the agreed structure — and do so before item 102.
     - Confirmed current contents, recorded to seed stage 1 rather than to pre-empt stage 2's classification:
       - **Diagnostics** (`src/ui/diagnostics/DiagnosticsScreen.tsx`): a _System status_ definition grid — app version, build id, network, service-worker state, storage health plus the item 92 estimate line and high-pressure warning, map-rendering support, geolocation permission, last known fix accuracy, last known fix age, active route; _Recent errors_; _Routing diagnostics_ — the "Why a fetch can fail before an HTTP response" disclosure, item 101's "What HTTP statuses mean" disclosure, the recent-attempts list, the "Test routing connection" action with its result definition grid (stage, error, safe reason code, HTTP status, construction/fetch/response flags, secure context, service-worker facts, installed/standalone display) and the "Copy diagnostic report" action with its manual-copy textarea fallback; and _Recent map imagery attempts_.
       - **Settings** (`src/ui/settings/SettingsScreen.tsx`): an offline banner; _Route planning_ — the default cycling profile button group, the "Avoid ferries by default" checkbox, saving/error status, and the "How recalculation works" disclosure; _OpenRouteService_ — the sign-up link, key status, the save/replace/delete key lifecycle with its confirmation dialogue, and the "How the key and route data are used" disclosure; _Elevation and climbs_ — the "How climbs are classified" and "Local gradient colours" disclosures, including the shared band legends; _Riding_ — a "Screen on" disclosure that is **explanatory text only**, the actual toggle having lived in the Riding status card since item 82.
       - A classification tension is already visible from that inventory and is worth stating plainly at stage 2: only three genuinely configurable properties exist in the whole application (default cycling profile, avoid ferries by default, and the OpenRouteService API key), while both screens carry substantial explanation and live status around them.
       - Primary navigation today offers five destinations in this order: Routes, Ride, Plan, Diagnostics, Settings (`src/ui/shared/MainNavigation.tsx`).
     - Constraints that survive any restructuring: the diagnostics screen's existing local-only, redacted character (no analytics, no external error reporting, no logged coordinates or keys); the API key remaining user-supplied and local; and British spelling in all user-facing text.
     - Cross-references: item 101 ([`history/items-100-103.md#item-101`](history/items-100-103.md#item-101)) for the newest Diagnostics content, item 92 ([`history/items-89-94.md#item-92`](history/items-89-94.md#item-92)) for the storage-health signal, item 82 for why the "Screen on" control and its explanation live in different places, and item 102 as adjacent but independent — a navigation-symbol redesign is not a navigation-structure decision, and neither item approves the other's scope.
     - Physical acceptance on the installed iPhone Home Screen PWA is required for whatever structure is eventually approved. Physical Android verification is separately outstanding, as for most recent items.

---

<a id="item-113"></a>

## Item 113 — German localisation

_Category: Internationalisation_

113. **German localisation**
     - Origin: the installed-iPhone field test of 10 September 2026 — see [`current-status.md`](current-status.md) for the dated report. German-language support is recorded as a **substantial staged feature, not a small copy-editing task**.
     - It is scheduled ahead of items 102 and 103, and preferably **after** item 112's Diagnostics and Settings information architecture is settled, so that strings are not migrated twice.
     - **Nothing about the eventual design is approved by this entry.** No German wording is approved; no automatic language selection is approved; no particular internationalisation library is approved.
     - The future item should cover at least:
       - auditing user-visible strings, and identifying strings that must remain technical or that originate externally — provider error text, HTTP status names, GPX and other technical identifiers, and raw diagnostic values among them;
       - introducing a maintainable internationalisation boundary rather than scattering language conditionals through components;
       - English as a **complete** fallback;
       - German translations for the supported user-facing interface;
       - language selection and persistence, with the device-language/default behaviour brought back for **explicit product approval** if it is not already defined;
       - pluralisation, interpolation, dates, times, distances and locale-sensitive formatting;
       - document language and accessibility announcements;
       - tests proving fallback behaviour and detecting missing keys;
       - a staged migration if converting every screen atomically would make the change unsafe.
     - Confirmed current state, recorded as the ground truth the audit starts from:
       - No internationalisation dependency or abstraction exists anywhere. Every user-facing string is a literal in its component.
       - `index.html` hard-codes `<html lang="en-GB">`, which is also what assistive technology announces from.
       - Three hard-coded `en-GB` locale objects exist and each would need a deliberate decision: `Intl.DateTimeFormat` in `src/ui/settings/providerKeyStatus.ts`, and `Intl.Collator` in both `src/domain/routeTags.ts` (tag display ordering) and `src/ui/library/routeLibraryView.ts` (route-name sorting).
       - `src/ui/shared/routeSummary.ts` deliberately performs **manual** digit grouping rather than using `toLocaleString`, and records that decision inline. German swaps the decimal and grouping separators, so this is a real conflict to reconcile explicitly rather than silently overturn.
       - `src/domain/routeTags.ts` deliberately uses plain `toLowerCase()` rather than `toLocaleLowerCase()`, for cross-machine and CI determinism, and documents that this is **not** full Unicode case folding — a German eszett spelling and its double-s expansion stay distinct tags, as do accented and unaccented spellings. That is a persisted tag-identity contract; localisation must not break it, and changing it would be a storage-compatibility change requiring its own migration reasoning.
       - British spelling remains this project's rule for the English strings, per the root [`CLAUDE.md`](../../CLAUDE.md)'s interface and accessibility requirements. Localisation does not relax that.
     - Treat the string audit and the internationalisation boundary as compatibility-sensitive work in the sense the root `CLAUDE.md` uses: user-facing copy is asserted directly by a large body of Vitest and Playwright tests, so a migration that changes how a string is produced will move test expectations across the suite and must be staged accordingly rather than attempted in one pass.
     - Physical acceptance on the installed iPhone Home Screen PWA is required for whatever ships, in both languages. Physical Android verification is separately outstanding, as for most recent items.
