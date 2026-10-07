# Planning backlog — full pending item specifications

This file holds the complete, byte-preserved specification for every backlog item that is **approved future work but not yet implemented**, plus the two items that are explicitly monitored/investigated-but-unconfirmed (see [current-status.md](current-status.md) instead for those two — items 32 and 66).

Item numbers are stable identifiers across this project's entire documentation set — they never change regardless of which file an item's text lives in. See [README.md](README.md) for the full map of where everything lives, and the root [`CLAUDE.md`](../../CLAUDE.md) for durable product/engineering rules and the required reading order before implementing any item here.

Items 11, 12, 16, 28, 59, 60 and 61 below remain approved future work, not yet scheduled into the sequence. Items 87–92 were added by the [release-readiness audit](release-readiness-audit.md) (item 86); items 87–92 have since been completed. Items 107–113 were added by the installed-iPhone field test of 10 September 2026 (see [current-status.md](current-status.md) for the dated evidence) and were all scheduled ahead of items 102 and 103, which keep their numbers; the authoritative execution order lives in the root [`CLAUDE.md`](../../CLAUDE.md)'s queue index and is deliberately not duplicated here. All seven items of that group, 107–113, have since been completed and their full specifications have moved to [`history/`](history/README.md). Item 114 was added on 11 September 2026 from item 109's own Chromium verification work rather than from that field test, and has since been completed (`0.4.45`) and moved to [`history/`](history/README.md). Item 117 was added on 13 September 2026 from the installed-iPhone session that accepted item 112, which rejected the opaque route identifier that session's `Active session` row exposed, and has since been completed and moved to [`history/`](history/README.md). Item 118 was added on 13 September 2026 from a second installed-iPhone report the same day and has since been completed and moved to [`history/`](history/README.md); item 119 was added from the repository investigation that established item 118's ownership, and has since been completed (`0.4.47`) and moved to [`history/`](history/README.md). Item 121 was recorded on 25 September 2026, placed first in the execution order, and has since been completed (`0.4.44`) and moved to [`history/`](history/README.md). Item 128 was recorded on 29 September 2026 from item 114's own measurements; it and item 124 were unscheduled until 30 September 2026, when the rider placed both in the approved execution order ahead of items 103 and 120. Item 128 has since been completed (`0.4.50`, the rider's C6 layout) and moved to [`history/`](history/items-118-131.md#item-128). Item 122 was scheduled on 1 October 2026, after item 124 and before items 103 and 120, for its investigation and design stage only. Item 123 was promoted to the front of the approved execution order on 29 September 2026 and has since been completed (`0.4.46`) and moved to [`history/`](history/README.md); item 129 was recorded that day from the installed-iPhone check of `0.4.45` and is unscheduled. Item 130 was recorded on 30 September 2026 from an end-to-end test flake measured during item 119's `0.4.48` follow-up, and is unscheduled. Item 102 was completed on 30 September 2026 (`0.4.49`) and moved to [`history/`](history/README.md). Item 132 was recorded on 2 October 2026, from the rider's approval of one paused-route screen after a cold start, and placed first in the approved execution order, ahead of item 124's remaining approved slices. Later the same day, the rider approved policies for item 124's inventory cases D-06, D-02, D-01 and C-12 and placed item 124's D-06 repair ahead of item 132, which was then second. That repair shipped in `0.4.54`, returning item 132 to first, and its ordinary flow was accepted on the installed iPhone the same day. Item 133 was then recorded on 2 October 2026, a bounded CI-infrastructure change from two end-to-end shards to four, and placed first, ahead of item 132. It has since been configured for four shards, verified in CI run 37055399688, and moved to [`history/`](history/items-132-NN.md#item-133). Item 132 then shipped in `0.4.55`, also on 2 October 2026, and moved to [`history/`](history/items-132-NN.md#item-132); it was accepted on the installed iPhone in English and German, reported the same day, and item 124's remaining approved slices are first in the order, starting with slice 5, D-01. Slice 5 shipped in `0.4.56` on 3 October 2026, and its ordinary flow was accepted on the installed iPhone in English and German, reported the same day; D-02's investigation and planning stage is next. D-02 was investigated and planned the same day, with nothing implemented ([report](../design/reveal-inventory/d-02-delete-lifecycle.md)); its implementation, with the rider's option A for a failure hidden by a filter, shipped in `0.4.57` as item 124's slice 6, also on 3 October 2026, and its ordinary flow was accepted on the installed iPhone in English and German, reported the same day. The rider also approved the common opening and cancellation policy for item 124's C-07, C-08, C-10, C-11 and C-13 that day and reported C-09's missing-route variant on the device; C-12's opening reveal, slice 7, is next. Items 134–138 were recorded on 4 October 2026 from the reconciliation of item 124's remaining inventory, as explicit destinations for concerns found during item 124; all five are unscheduled. Item 124 was then completed in eleven slices and closed on 4 October 2026, after slice 11's installed-iPhone acceptance, and its record moved to [`history/item-124.md`](history/item-124.md#item-124) and its continuation; items 139 and 140 were filed from its close-out the same day, and both are unscheduled. Item 141 was filed on 5 October 2026 from a rider observation about the size of Planning's Edit copy notice, as design work coordinated with item 122's layout decision. The same day the rider took the final design decisions for both items ([record](../design/planning-map-area/copy-notice-and-map-size.md#final-design-decisions-5-october-2026)) and placed item 141's implementation first, with item 122's implementation after item 141's installed-iPhone acceptance. Item 141 was then implemented in `0.4.63` the same day and moved to [`history/`](history/items-132-NN.md#item-141), and its visual and functional checks were accepted on the installed iPhone the same day (VoiceOver not checked); item 122 was then implemented in `0.4.64`, also on 5 October 2026, and moved to [`history/`](history/item-122.md#item-122), and its visual and functional checks were accepted on the installed iPhone in English and German, reported the same day. Later on 5 October 2026 the rider scheduled items 140, 134, 139 and 125, in that order, ahead of items 103 and 120, so that session correctness, pending-action behaviour, failure-message layout and screen restoration settle before the visual audit; scheduling approves no implementation design, each entry below records its own gate, and every other unscheduled item stays unscheduled. Item 140's launcher slice was then implemented in `0.4.65` on 6 October 2026, and its ordinary flows were accepted on the installed iPhone the same day; item 140 stays here, its remaining scope open. Item 142 was filed on 6 October 2026 from a rider observation reported with that acceptance; it is unscheduled, pending investigation and prioritisation, and the execution order is unchanged. Later the same day the rider kept End and switch and the riding screens' End ride and Finish ride inside item 140, as its slice 2 — implemented in `0.4.66`, device acceptance pending — and filed stale-window writes and older-version windows as unscheduled items 143 and 144. Slice 2's ordinary flows were then accepted on the installed iPhone in English and German, reported 6 October 2026 (`0.4.66`, build `c2cb9e6`), completing item 140 within its approved scope; its record moved to [`history/`](history/items-132-NN.md#item-140), and the execution order is now items 134, 139, 125, 103 and 120. Items 142, 143 and 144 stay unscheduled. Item 134 was then investigated on `c2cb9e6` and implemented in `0.4.67`, also on 6 October 2026, and moved to [`history/`](history/items-132-NN.md#item-134). Its ordinary flows were then accepted on the installed iPhone in German and English, reported 6 October 2026 (`0.4.67`, build `9f73242`), completing it within its approved scope, and the execution order is now items 139, 125, 103 and 120. Items 135, 142, 143 and 144 stay unscheduled. Item 139 was then implemented in `0.4.68`, also on 6 October 2026, by the rider's approval of its candidate, and moved to [`history/`](history/items-132-NN.md#item-139); its installed-iPhone acceptance is pending, and it stays first in the order. Its ordinary flows were then accepted on the installed iPhone in English and German, reported 7 October 2026 (`0.4.68`, build `9334b25`), completing it within its approved scope, and the execution order is now items 125, 103 and 120. Item 145 was filed the same day from item 139's enlarged-text measurements; it is unscheduled, with a review checkpoint before item 103's audit, and the order is unchanged by it. Item 125's slice 1 was then implemented in `0.4.69`, also on 7 October 2026, with its installed-iPhone acceptance pending; its record stays in this file, since persistence across fully closing the app remains undecided. Its ordinary flows were then accepted on the installed iPhone in German and English, reported 7 October 2026, on build `677a03e`; there is no approved next slice, and persistence across fully closing the app is deferred and undecided, outside the execution order. The same day the rider filed item 146, the E2E coverage and runtime audit, and placed it first, so the order is now items 146, 103 and 120; and promoted two WebKit test observations to unscheduled items 147 and 148, linked to item 146. Item 145 stays unscheduled, with its review checkpoint before item 103's audit.

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
     - **Execution order revised on 30 September 2026, and again on 1 October 2026:** now after items 124 and 122 (item 128 having shipped in `0.4.50`), by the rider's decision — the two usability corrections, then Planning's map-area design, precede this broader visual refinement. It remains a bounded audit followed by focused mock-ups and small implementation slices, not a whole-app redesign. Item 102, named in the coordination clause above, has since shipped (`0.4.49`) and been accepted; its record is [`history/items-100-103.md`](history/items-100-103.md#item-102).
     - **Execution order revised again on 5 October 2026:** now after items 140, 134, 139 and 125 (item 122 having shipped in `0.4.64` and been accepted on the installed iPhone), by the rider's decision, so that session correctness, pending-action behaviour, failure-message layout and screen restoration settle before the visual audit ([order](../../CLAUDE.md)). Its gate is unchanged: a bounded audit, then focused mock-ups before any production change, then small slices. [Item 135](#item-135) is a coordination item, not a requirement to complete its whole scope before this audit.
     - **Input from item 124's inventory, 4 October 2026** (the [reconciliation](../design/reveal-inventory/closure-reconciliation.md)). The page-level switch dialog (C-14) uses `ConfirmDialog`, whose confirm action is always `btn-danger`. So it styles **Retry**, **Check again** and **Try again** as destructive, where item 95's inline prompt styles them as secondary. This is from source, still present at `e2ba7cf`, and adds no scope beyond this audit's button review.
     - **Update, 7 October 2026:** with items 140, 134 and 139 completed, it is second in the order, after item 125. **Before its audit begins, the rider is to review unscheduled [item 145](#item-145)** — route riding's map space while a failed End ride's error shows at enlarged text — and decide whether to schedule it. That review is a checkpoint, not a place in the order, and it imports none of item 145's scope here. Its gate is unchanged.
     - **Update, 7 October 2026, later:** with item 125's slice 1 accepted on the installed iPhone, the rider filed [item 146](#item-146), the E2E coverage and runtime audit, and placed it first; the order is now 146 → 103 → 120 ([order](../../CLAUDE.md)), and this item stays second. The review of [item 145](#item-145) before this audit begins is unchanged, and so is the gate.

---

<a id="item-120"></a>

## Item 120 — Pending-state treatment for the Follow-location control

_Category: Map controls_

120. **Pending-state treatment for the Follow-location control**
     - Origin: the stage 6a linguistic review of item 113, which approved the German wording `Warten…` for `ride.map.waiting` **for the current interface** while noting that a visible word inside a 48 px circular control may be less clear and less robust than an icon-based pending state. Allocated as its own item so it could neither expand nor block item 113.
     - **Nothing about the design is approved by this entry.** In particular, removing the visible word is not approved, and no replacement icon, animation or colour is approved.
     - The item should consider: retaining the crosshair in a muted pending treatment with a **non-colour-only** activity cue; distinguishing _awaiting a fresh fix_ from _paused Follow_, which are different states a rider acts on differently; exposing appropriate accessible pending semantics rather than relying on the visible glyph; and preserving stable button geometry so the control does not resize or shift while pending.
     - If a resulting design removes the visible copy, `ride.map.waiting` should at that point be removed or redefined as accessibility-only in **both** catalogues, with the catalogue parity suites updated in the same change.
     - Note the transient state has **never been observed on the installed iPhone** in either language, in any session to date. It is not a confirmed field problem, and the item must not be written up as though it were.
     - Evidence required: measurement at 390 px portrait at ordinary **and** 200 % root text in the pinned container, in both languages, covering the touch-target floor, the accessible name in each state, and that the control's box does not change size between states. Physical acceptance on the installed iPhone Home Screen PWA is required for whatever ships. Physical Android verification is separately outstanding, as for most recent items.
     - **Execution order revised on 30 September 2026, and again on 1 October 2026:** it stays last, after items 124, 122 and 103 (item 128 having shipped in `0.4.50`), because it is a possible refinement of a transient state never observed on the installed iPhone, not a confirmed field defect. The design and evidence gates above are unchanged.
     - **Execution order revised again on 5 October 2026:** it stays last, after items 140, 134, 139, 125 and 103 ([order](../../CLAUDE.md)). The design and evidence gates above are unchanged.
     - **Update, 7 October 2026:** with items 140, 134 and 139 completed, the order is 125 → 103 → 120, and it stays last. The design and evidence gates above are unchanged.
     - **Update, 7 October 2026, later:** the order is now 146 → 103 → 120, with [item 146](#item-146), the E2E coverage and runtime audit, first ([order](../../CLAUDE.md)); it stays last. The design and evidence gates above are unchanged.

---

<a id="item-125"></a>

## Item 125 — Per-screen scroll restoration — slice 1 accepted (`0.4.69`); persistence across app closure deferred

_Category: Navigation and information architecture_

**Status, 7 October 2026: slice 1 — each primary view's own position for the current app session, implemented in `0.4.69` — had its ordinary flows accepted on the installed iPhone in German and English, reported the same day, on build `677a03e`** ([dated record](current-status.md#installed-iphone-acceptance-of-0469-build-677a03e-item-125-slice-1-reported-7-october-2026); [slice 1](#item-125-slice-1)). **There is no approved next slice.** Persistence across fully closing the app is deferred and undecided, outside the active execution order; it is not a confirmed defect, and nothing about it is approved. The entry stays here, not in history, for that reason. The specification as filed follows, unchanged apart from its dated updates.

125. **Per-screen scroll restoration**
     - Origin: the rider's observation, reported 28 September 2026: switching between screens should neither discard nor share their scroll positions.
     - **Scheduled on 5 October 2026**, fourth in the approved execution order, after items 140, 134 and 139 and before items 103 and 120, by the rider's decision ([order](../../CLAUDE.md)); it was unscheduled until then. **Scheduling approves no implementation design.** The design must distinguish **retaining each screen's position during the current app session** from **persistence across fully closing the app**, which remains undecided. Before implementation it must assess the existing resets (item 121's Settings-section reset, Ride's new-content reset, Routes' one-shot restoration), what happens when a screen's content changes substantially, and item 124's confirmation reveals and restored focus, with [item 135](#item-135) as coordination.
     - **Present facts, from source:**
       - `src/App.tsx` keeps a single `screen` state, and a switch unmounts one screen and mounts the next.
       - `window.scrollY` is carried over and clamped by the new page's height. Nothing resets or restores it on an ordinary switch between Routes, Plan, Settings and Status.
       - The two existing exceptions:
         - Ride's reset to the top when new ride content is requested (`src/ui/shared/useResetScrollForNewRideContent.ts`);
         - Routes' one-shot restoration after a route opens. `routesScrollYRef` is captured in `openRideTarget`, restored by `RouteLibrary.tsx` once its data has loaded, held in memory only, and covered by `e2e/routeLibraryScroll.spec.ts`.
     - **An unverified source observation, not a confirmed defect:** `openRideTarget` records the current `window.scrollY` for any route target, not only when leaving Routes — a Planning save and a launcher resume included. Routes may therefore later restore another screen's offset. It needs a browser reproduction before it is treated as a defect.
     - **Coordination with item 121**, which is first in the approved order: the design discussion includes item 121's planned Settings/Status sibling views and whether they share or keep separate positions. **This entry adds no scope to item 121.** If item 121 ships first, this item accounts for the sibling views; if not, it must not presume their final structure.
     - **Update, 28 September 2026 — item 121 shipped first (`0.4.44`), with an interim rule this item is to replace.** By the rider's decision during item 121's planning, the Settings section starts at the top whenever navigation changes the rendered view: on entry from another tab, on a Settings ↔ Status switch, and when the Settings tab is tapped while Status is showing. Nothing else resets it, and no other screen's behaviour changed. That rule was approved explicitly as **interim**: this item should replace those top resets with a separately restored position for each of the two views. The mechanism is `SettingsSection.tsx`'s `useLayoutEffect` keyed on the rendered view, reusing the scroll-to-top reassertion loop extracted to `src/ui/shared/scrollToTopAndSettle.ts`; the sticky switcher and a constant `scroll-margin-top` on the view's content are recorded in [`history/items-118-131.md`](history/items-118-131.md#item-121). Any restoration must keep the switcher's position still across a switch and must not reintroduce a root `scroll-padding`, which item 121 measured to scroll the page when a sticky control takes focus and, in WebKit, to move a press on Save out from under the pointer.
     - **Update, 29 September 2026 — observed on the installed iPhone during item 121's acceptance (`0.4.44`).** Arriving at Ride or Plan keeps the scroll offset of the screen just left, Routes included, while arriving at Routes shows the top. Item 121's interim top reset applies to the Settings section alone (Settings and Status), not to any other primary screen. Source has no deliberate reset for an ordinary switch to Routes — its one-shot restoration runs only after a route has been opened — so **no cause is claimed** for Routes arriving at the top. This is the outstanding behaviour this item addresses; it adds no scope and does not change the execution order. The dated record is in [`current-status.md`](current-status.md).
     - **Update, 7 October 2026:** with item 139 accepted on the installed iPhone, this item is first in the approved order, ahead of items 103 and 120 ([order](../../CLAUDE.md)). The design questions above are unchanged by that.
     - **Update, 7 October 2026, later:** slice 1 was accepted on the installed iPhone ([dated record](current-status.md#installed-iphone-acceptance-of-0469-build-677a03e-item-125-slice-1-reported-7-october-2026)), and this item leaves the approved execution order, which is now 146 → 103 → 120 ([order](../../CLAUDE.md)). The first design question below — persistence across closing and reopening the PWA — stays open, deferred and undecided; no slice for it is approved.
     - **Explicit design questions, deliberately open:**
       - persistence across closing and reopening the PWA (memory only, or stored);
       - resetting after substantial content changes (a filter or search change, an import, a delete, a new calculation);
       - whether Planning and the riding screens take part;
       - interaction with item 124's reveals and with restored focus.
     - **Evidence required when implemented:** browser tests for each screen pair, both directions, including a screen shorter than the stored offset, plus the installed-iPhone recheck.

<a id="item-125-slice-1"></a>

### Slice 1 — each view's own position for the current app session (`0.4.69`, 7 October 2026)

**Approved with the combined plan of 7 October 2026**, together with item 139's acceptance. The rider's amendments to that plan are folded in below: a late Edit copy never moves Planning; a fresh App mount remembers nothing; the live-query and clean-up guarantees; no unmeasured timing claims; a measured budget for the long browser walk.

**Findings, from source at `9334b25` and measured where stated:**

- **The document is the only scroller.** Nothing sets `overflow` on `html`, `body`, `#root` or `main`, and nothing set `history.scrollRestoration`, `scroll-behavior` or `scroll-padding`. Immersive riding is a fixed `100dvh` shell with nothing to scroll.
- **The carried-over offset was the browser's, not the app's.** `App.tsx` renders one screen at a time, and the browser kept `scrollY`, clamped to the new page. Routes' first render is the short "Loading routes…" placeholder, which is the likely reason it arrived at the top. That is read from source; it was not measured.
- **The `openRideTarget` observation is confirmed as a defect.** A scratch probe on a build source-equivalent to `0.4.68` (`index-DLFr4bV6.js`, the deployed bundle's name) ran in the CI image by digest, in Chromium and WebKit. Planning was scrolled to 734 px, Open saved route was used with nothing unfinished, and Routes was then opened. **In both engines, Routes came back at 734 px, Planning's offset** (its bottom was 1,984 px in Chromium and 2,061 px in WebKit). In the control, Plan straight to Routes, Routes arrived at 0. The probe was not committed.
- **Only two things focus or scroll as a screen mounts:** the page-level switch dialog (`autoFocus`), and item 95's route-card prompt when a route-card switch is pending as the rider returns to Routes. Every item 124 reveal and focus return, and item 118's reveal, runs only after an action in a screen already shown.
- **React 19.2.8's commit order**, checked in `react-dom`: layout effects run children first, with siblings in tree order; `autoFocus` happens in the same pass; every DOM mutation is finished before any layout-effect body runs. So a screen's own layout effect sees its subtree's focus and reveals from the same commit.

**The decisions (7 October 2026):**

1. **Memory only, for the current app session.** A fresh App mount — a reload, or a relaunch that loads the page afresh — remembers no offsets, and every view's first visit, the initial one included, starts at the top. `history.scrollRestoration` is set to `manual` before the first render, so the browser's own reload restoration no longer applies either. iOS suspending and resuming the same running app keeps the in-memory positions. Persistence across fully closing the app stays undecided, for any later slice.
2. **Five separate positions:** Routes, Plan, Ride, Settings and Status.
3. **First visits start at the top.** Before this, Ride and Plan carried the previous screen's offset over.
4. **New ride content starts Ride at the top**, as before. That is a route opened, a launcher resume, the cold-start auto-open, End or Finish, Back to Ride options, free roam's Pause, or a session gone or missing.
5. **Edit copy starts Planning at the top** when it opens Planning with its draft. A copy that completes after the rider has left Ride never scrolls anything — even if they are using Planning by then — and only stops Planning's old position being restored on a later arrival.
6. **Planning's Open Settings starts Settings at the top**, as before, and discards Settings' position.
7. **A carried-over prompt or dialog that takes focus as the rider arrives wins over the restore**: Routes' inline switch prompt and the page-level switch dialog.
8. **Pixel offsets, not content anchors.** Content inserted above the saved position shifts what the rider sees.
9. **No early approximate scroll** while a view is still loading. The browser clamps the previous offset meanwhile, as it did before.
10. **Item 95's shared input list is unchanged.** The restore loop has its own stop check, through item 124's interaction guard.

**The behaviour:**

| Situation                                                                                                                 | Result                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| First visit to a view in this app session, the initial one included                                                       | Top                                                                                                |
| Ordinary tab switch away and back                                                                                         | The view's own last position                                                                       |
| Settings ↔ Status (switcher, or the Settings tab from Status)                                                             | Each view's own position; the switcher stays put                                                   |
| A tab tapped on its own screen                                                                                            | Nothing                                                                                            |
| Returning to Routes after opening a route, or from anywhere else                                                          | Routes' own position; never another view's                                                         |
| New ride content (decision 4)                                                                                             | Ride from the top, its position discarded                                                          |
| A plain return to Ride with the same content                                                                              | Ride's own position, once the launcher's check or the paused screen's session restore has finished |
| Immersive riding                                                                                                          | Nothing to restore                                                                                 |
| Edit copy opening Planning with its draft                                                                                 | Planning from the top                                                                              |
| Edit copy completing after the rider has left Ride                                                                        | No scroll; Planning's next arrival starts at the top                                               |
| Planning's Open Settings                                                                                                  | Settings from the top                                                                              |
| Changes within a view: Clear draft, Reverse route, a recalculation; Routes search, filter, sort, import, rename or delete | No reset. The browser clamps; the position at departure is what comes back                         |
| A view shorter than its saved position on return                                                                          | Clamped to its new bottom, with no later jump                                                      |
| A view's first reads still loading                                                                                        | The restore waits; leaving meanwhile keeps the saved position                                      |
| A tap, key, wheel or touch scroll, or a new focus, before the restore is applied or settles                               | Abandoned for good                                                                                 |
| Reveals and focus returns after arrival (item 124, item 118, P-15, P-18)                                                  | Unaffected                                                                                         |

**Implementation:**

- **`src/ui/shared/screenScrollMemory.ts`** (new) — App's memory, created once and free of side effects when created.
  - `leave(to)` runs synchronously before every change of screen, through App's `changeScreen`. It records `scrollY` under the view App last rendered, unless that view's saved position has not yet been applied. It also notes the focused element and arms item 124's `armOperationInteractionGuard`.
  - `useScreenScrollRestoration(ready)` — each screen calls it last among its hooks — decides once, in that screen's layout effect: a top request leaves the scroll to App; a disarmed guard or a new focus means no restore; a first visit goes to the top; otherwise the restore runs once the screen reports `ready`.
  - `useScreenTopRequests` replaces `useResetScrollForNewRideContent`, with the same token semantics, now for any view.
  - Guards are detached and loops stopped on completion, cancellation, departure and disposal. Disposal is reversible, for Strict Mode.
- **`scrollToTopAndSettle.ts`** gains `scrollToAndSettle(top, { shouldStop, onEnd })`, item 95's loop with the target clamped to the page in each frame. `scrollToTopAndSettle()` is unchanged in behaviour, as the top case.
- **`useLiveQuery.ts`** gains `useLiveQueryState` → `{ value, settled }`. `settled` is derived in render for the current querier and ignores an obsolete subscription's answer; it stays true through live updates. `useLiveQuery`'s value, error and subscription behaviour are unchanged.
- **Readiness, one boolean per screen:**
  - Routes: its list, its preferences and the restored tag filters.
  - Planning: the draft read settled, plus the key and verification reads.
  - The Ride launcher: its session check.
  - The route riding screen: no "Restoring/Resuming…" line, with a failed read's alert counting as content.
  - Settings: the key and verification reads.
  - Status: the storage check and estimate, plus the ride-state, active-route and key reads.
- **App:**
  - Planning's Open Settings and Edit copy's navigation request the top.
  - RidingScreen reports a written Edit copy draft through a new `onEditCopyDraftSaved`, which only invalidates Planning's position.
  - `routesScrollYRef` is removed.
- **Removed:** item 121's interim reset in `SettingsSection.tsx`, Routes' one-shot `restoreScrollYRef` restore, and `useResetScrollForNewRideContent.ts`, whose tests were ported.
- **`main.tsx`** turns off the browser's scroll restoration before its first `await`.
- **Version** `0.4.69`. No dependency, router, root `scroll-padding` or persistence.

**Evidence — automated only:**

- **Unit tests:**
  - `screenScrollMemory.test.tsx` (36): saving and restoring in both directions, Settings/Status apart, first visits, waiting and never re-applying, leaving while pending, clamping, following growth, yielding to pointerdown, keydown, wheel, touchmove and a new focus, loop stops, top requests with the ported cases, invalidation, disposal and Strict Mode.
  - `useLiveQuery.test.ts` (5).
  - Four new `scrollToAndSettle` cases, beside `scrollToTopAndSettle`'s three existing ones.
  - Readiness tests for Routes, Planning, the launcher, the riding screen, and Settings and Status through `SettingsSection`.
  - The App tests: Settings ↔ Status, the last-viewed view, a fresh mount, and at Planning's boundary (`App.planningSavedRoute.test.tsx`, with its stub reporting readiness as the real screen does) — Open saved route not handing Routes Planning's offset, Edit copy at the top, a late Edit copy with Planning in use, a page-level dialog winning, leaving Routes before it has loaded, and Open Settings.
- **Browser, in the CI image by digest:**
  - `e2e/screenScrollRestoration.spec.ts` (Chromium, 8):
    - one walk through all 20 ordered pairs of the five views, each restore exact to 1 px;
    - the paused screen after its session restore, and End ride's top;
    - Status with a held storage estimate, including leaving while it waits, and a wheel cancelling its restore;
    - clamping;
    - the route-card prompt and the page-level dialog winning;
    - Edit copy and Open Settings at the top;
    - a reload.
  - `e2e/screenScrollRestoration.smoke.spec.ts` (Chromium and WebKit, 5 per engine):
    - Settings ↔ Status in English and German, with the switcher's box unchanged;
    - Routes ↔ Settings;
    - clamping;
    - item 118's Delete-key reveal after a restored arrival, with Cancel's focus return not pulled back.
  - **Added to existing specs:** a plain tab round trip in `routeLibraryScroll.spec.ts`; Routes keeping its own position after Open saved route in `planningSavedRoute.smoke.spec.ts`; a late Edit copy with Planning in use in `editCopyBusyState.smoke.spec.ts`.
  - **Rewritten:** `settingsStatusSwitcher.spec.ts`'s interim-reset tests, under the new rules. Its U1 gate now measures each view at its top explicitly.
- **Measured arrivals:**
  - From the click to the view's own content at its restored position, sampled in the page every 4 ms, desktop Chromium in the container, one run: **23–189 ms, median about 45 ms**. The slowest were arrivals at Plan.
  - The 20-pair walk took 12.9 s, and its test 14.6 s — within Playwright's default 30 s, so it was not split.
  - These are not iPhone figures.
- **Negative controls:**
  - **Unit:** each of these failed exactly its intended tests:
    - recording a placeholder's offset;
    - ignoring focus;
    - a late Edit copy requesting the top;
    - Routes and Planning reporting ready too early;
    - ignoring the input guard;
    - reintroducing the old capture.
  - **Browser:** a build with a late Edit copy requesting the top, and Routes ready against its placeholder, failed the late-Edit-copy test with three app scroll calls in both engines; it also failed the round trip (0 instead of 2,750 px) and the walk at Routes.
  - **The baseline:** source-equivalent to `0.4.68`, it failed the new Open-saved-route check in both engines with Routes at 734 px. One limit on that comparison: on the baseline the late-Edit-copy test stops earlier, at its own click-point check, so it is no control for that mechanism. The control build is.
  - **One App-level control did not discriminate:** in jsdom, Routes ready against its placeholder still passes the "leave before loaded" App test, since jsdom has no layout. The browser control covers it.
- **Also run, once:**
  - the affected existing specs: 116 Chromium tests, and 229 tests in both engines;
  - the directly affected unit files: 39 files, 1,420 tests;
  - lint, type-check, the build, the catalogue tests, links, whitespace and formatting.

  Two WebKit failures came up in those runs, in specs this slice does not change; they are recorded in `current-status.md`'s observations.

- **A test-harness finding:** headless WebKit defers animation frames until pointer activity. An arrival's settle loop can therefore run at a test's next click and undo the test's own programmatic scroll — as item 121 found — so the new specs run frames before such a scroll. A rider's own scroll begins with touch or wheel input, which ends the loop.

**Limitations and exclusions:**

- **Out of scope:**
  - persistence across fully closing the app;
  - restoring `<details>` state or Planning's route summary, which needs recalculating after a return and so can make Planning shorter;
  - focus restoration ([item 135](#item-135));
  - anchor-based restoration;
  - landscape;
  - routing, draft autosave, ride persistence, tracking and map gestures.
- **Not measured on a device:**
  - iOS's visual-viewport and keyboard offsets;
  - whether the frames before a restore read as a jump.
- **Restores skipped by design:**
  - trackpad inertia continuing after a tab click cancels the restore;
  - a first read that never answers means no restore, with no time cap.
- **The Settings/Status switcher stays put** because the section is the first thing in `<main>`. The update prompt, rendered above `<main>`, shifts every offset while it shows.
- **Installed-iPhone acceptance:** the ordinary flows were accepted in German and English, reported 7 October 2026, on build `677a03e`, which stays the accepted build ([dated record](current-status.md#installed-iphone-acceptance-of-0469-build-677a03e-item-125-slice-1-reported-7-october-2026)). VoiceOver, Larger Text, landscape, physical Android, the keyboard and visual-viewport offsets, and behaviour across a suspension and resumption as distinct from a fresh launch are not covered.

<a id="item-125-slice-1-ci"></a>

#### CI and deployment — run 37602138083 (7 October 2026)

Run [37602138083](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37602138083), "Deploy to GitHub Pages" for `677a03e`:

- **Directly inspected:** the run's metadata showed it **completed with success**.
  - Verify and build took 253 s, its unit-test step 141 s.
  - The four End-to-end shard jobs took 714, 806, 520 and 742 s (shards 1 to 4), their test steps 647, 739, 451 and 686 s. The longest, 806 s (shard 2), was 394 s under the E2E job's 1,200 s limit.
  - Deploy took 10 s.
- **Deployment-derived:** the live site served `0.4.69` with build `677a03e`, and the waiter that observed it exited. Deploy runs only after Verify and build and all four End-to-end shards succeed, so the live build establishes the same success independently of the metadata.
- **No trend or cause is claimed.** It is one run, and its duration is not attributed to this slice. The figures are also noted under "Monitored, corroborating only" in [`current-status.md`](current-status.md); the E2E audit, [item 146](#item-146), examines the suite's cost.

---

<a id="item-126"></a>

## Item 126 — Climb distances at their boundaries (unscheduled investigation)

_Category: Riding elevation enhancement_

126. **Climb distances at their boundaries — unscheduled investigation**
     - Origin: the rider's observation, reported 28 September 2026. The climb view can show `0.0 km` while "Starts in" or "remaining" still refers to a positive distance.
     - **Unscheduled, and not part of the approved execution order.**
     - **Present facts, from source:**
       - Every climb distance goes through `formatDistanceKm` (`src/ui/shared/routeSummary.ts`), one decimal of a kilometre, so anything under 50 m prints `0.0 km` / `0,0 km`. The keys concerned are `climb.startsIn`, `climb.distanceToSummit` with its value, `climb.distanceCompleted`, `climb.cueRemaining`, `climb.remaining` and `climb.passedAgo`.
       - **The state transition:**
         - `findNextClimbAfterDistance` (`src/navigation/routeFeatures.ts`) treats a climb as upcoming only while its start is strictly ahead, so the preview's "Starts in" is always positive but can be below 50 m;
         - `findFeatureAtDistance` treats both ends as inside the climb;
         - `computeClimbProgressMetrics` (`src/navigation/climbElevationView.ts`) clamps to the climb, so "remaining" is 0–50 m just before the summit.
       - **Existing tests:** none covers the 0–50 m range. `RidingClimbProgressPanel.test.tsx` pins `0.0 km` at exactly zero remaining.
     - **A candidate, not a decision:** metres below 100 m at an appropriate precision. `formatManoeuvreDistance` already renders metres below 1 km with 5/10/50 m rounding, which could be reused or adapted. **Rounding the whole climb distance upwards is not approved.**
     - **Open:** the threshold and precision; whether "Starts in" and "remaining" should hand over at a small distance rather than at exactly zero; and consistency with the manoeuvre panel's own distance display.
     - **Evidence required when implemented:** unit tests at 0, 1, 49, 50, 99 and 100 m and at the transition, in both languages, plus the ride recheck.

---

<a id="item-127"></a>

## Item 127 — Discovering "Insert after" in Planning (unscheduled design candidate)

_Category: Planning interaction_

127. **Discovering "Insert after" in Planning — unscheduled design candidate**
     - Origin: the rider's observation, reported 28 September 2026. It is easy to miss that a waypoint can be inserted after an existing one.
     - **Unscheduled, and not part of the approved execution order.** No general "How to use this app" section is committed to.
     - **Present facts, from source (`src/ui/planning/WaypointList.tsx`, `PlanningScreen.tsx`, `planningInteractionMode.ts`):**
       - **Where the action lives:** `Insert after` / `Danach einfügen` appears only on the **selected** row of the waypoint list, beside `Move` / `Verschieben`. A waypoint is selected only from the list, never by tapping its marker, and the list sits below the map, typically below the fold on a phone.
       - **The disabled placement control:** while a waypoint is selected and no action is armed, the map's placement control still reads `Add waypoint here` / `Wegpunkt hier setzen` but is disabled, and nothing explains why.
       - **Confirming the insert:** after `Insert after` is armed, the control that confirms it (`Insert after waypoint N` / `Nach Wegpunkt N einfügen`) is back on the map, above the list, and not brought into view.
       - **No hint:** nothing explains insertion. The only hint is the empty-list one (`planning.waypoints.empty`).
     - **The candidate:** a short cue at the point of use, for example at the disabled placement control or beside the selected row's actions. Its wording, placement and whether it persists are open.
     - **Coordinate with:** items 122 (the map area) and 123 (touch-pan placement), item 114 (the placement control and the attribution at 200% text), and the placement-control width change in item 113's follow-up. A cue must not reintroduce item 114's overlap (resolved at enlarged text in `0.4.45`) or worsen item 123's gesture question.
     - **Evidence required when implemented:** both languages at 390 px portrait at ordinary and 200% root text, with the cue and the placement control contained and readable, plus the installed-iPhone recheck.
     - **Assigned here, 4 October 2026:** item 124's inventory entry P-17 — after **Move** or **Insert after**, the map's placement control may be scrolled out of view. This follows the rider's direction for item 124's [reconciliation](../design/reveal-inventory/closure-reconciliation.md). The "Confirming the insert" fact above already covers it, so no scope is added.

---

<a id="item-129"></a>

## Item 129 — Recovering from a denied location permission in the installed iPhone PWA (unscheduled investigation)

_Category: Platform and permissions_

129. **Recovering from a denied location permission in the installed iPhone PWA — unscheduled investigation**
     - Origin: the installed-iPhone check of `0.4.45` (build `bac3553`), reported 29 September 2026 — see [`current-status.md`](current-status.md) for the dated record. To exercise item 114's `Locate me` failure message, the rider denied location permission in the installed Home Screen PWA. The message appeared correctly. The rider then **did not find a way to grant permission again during that PWA session**; after fully closing and reopening the PWA, another permission prompt appeared.
     - **Unscheduled, and not part of the approved execution order.** No interface change is approved by this entry.
     - **Not asserted:** that a denial is permanent; that no in-session way to grant permission exists; that ACN can make iOS show the permission prompt again; or that changing a Safari website setting necessarily changes the installed PWA's permission.
     - Present fact, from source: Planning's `Locate me` uses `getApproximateLocationOnce` (`src/platform/geolocation.ts`), which resolves `null` for any geolocation error, so Planning's message ("Your location could not be determined.") does not distinguish a denied permission from an unavailable position. Riding's location watch has its own error and `Try again` handling.
     - **Establish first, on the device, before proposing any interface change:** exactly when iOS offers the prompt again — within one session, after backgrounding, after a full close and reopen, and after changing the relevant iOS or Safari settings — for both Planning's `Locate me` and Riding's location watch; and an accurate, tested recovery instruction for the rider. Automated browsers cannot reproduce iOS's permission handling, so the evidence must come from the installed iPhone; physical Android is separate and outstanding.

---

<a id="item-130"></a>

## Item 130 — Intermittent failure of the route-riding reconnection test in `mapImageryRecovery.spec.ts` (unscheduled test-reliability investigation)

_Category: End-to-end test reliability_

130. **Intermittent failure of the route-riding reconnection test in `mapImageryRecovery.spec.ts` — unscheduled test-reliability investigation**
     - Origin: item 119's `0.4.48` follow-up, 30 September 2026, where it was measured and recorded without being attributed to that change ([`history/items-118-131.md`](history/items-118-131.md#item-119)). **Automated evidence only**, from the pinned Playwright container; not an installed-iPhone observation.
     - **Unscheduled, and not part of the approved execution order**; it does not precede item 102. No change to the test, its tolerance or production code is approved by this entry.
     - **The test:** `route Riding: genuine reconnection recovery — … preserving the followed camera`. It failed on its follow-anchor tolerance, `anchorWithinTolerance(after, baseline)`, a 2 px bound. Present fact, from source: that helper also returns `false` when an anchor reads as `null`, so an unresolved read presents as a tolerance failure rather than as a timeout.
     - **What was measured:**
       - one failure in an ordinary full-suite run during that follow-up's verification;
       - the whole spec repeated ten times at 36 workers, in eight interleaved rounds: **16 of 80 on `0.4.47`** (the baseline) and **20 of 80 on `0.4.48`** (the changed build). These runs do not establish a regression attributable to `0.4.48`, and no route changes in that test.
     - **Earlier sightings, corroboration only**, both recorded in [`current-status.md`](current-status.md): the spec's reconnection-recovery camera-anchor test — its only use of `anchorWithinTolerance` — among the one-per-run failures on item 113 stage 1's parent commit (14 September 2026); and a one-off failure somewhere in the same spec during item 104's full run (4 September 2026), the test not recorded.
     - **Not claimed:** a root cause, or a production defect.
     - **First task:** capture the failing assertion and the artefacts item 116 retains — the failure screenshot, the CI trace and `error-context.md`, uploaded per shard — under **ordinary CI conditions**, not 36-worker stress. If ordinary CI does not reproduce it, record that and how many runs were observed.
     - **Then:** distinguish test timing — when the baseline and later camera readings are taken, and what they read — from a real camera-follow problem after reconnection.
     - **Evidence required when resolved:** the captured artefact, a check that discriminates between those two explanations, and negative controls. Any change to the test follows the diagnosis.

---

<a id="item-135"></a>

## Item 135 — Focus continuity when a control disappears or an operation ends (unscheduled accessibility investigation)

_Category: Interface and accessibility consistency_

135. **Focus continuity when a control disappears or an operation ends — unscheduled accessibility investigation**
     - Origin: item 124's reveal inventory (D-05) and its 3 October review (group 4). Under the rider's direction of 4 October 2026, focus questions found during item 124 come here rather than extending item 124. The [reconciliation](../design/reveal-inventory/closure-reconciliation.md) lists each case and its evidence.
     - **Unscheduled, and not part of the approved execution order.** No change is approved by this entry. **Update, 5 October 2026:** it stays unscheduled under the order the rider revised that day. It is a **coordination item** for the scheduled items 134, 139 and 125, not a requirement to complete its whole scope before item 103's audit.
     - **Scope:** where keyboard and assistive-technology focus goes when the control that had it disappears, is disabled or is replaced, or when an operation ends. That includes any page scrolling or software-keyboard opening that a chosen focus target would cause.
     - **Measured, 1 October 2026** (desktop Chromium and WebKit in the pinned container, 390×844 portrait, ordinary text, English): focus falls to `<body>` after **Deselect waypoint**, after **Pause**, and when **Replace key** opens its form or its **Cancel** closes it. In each case the page did not jump. A route card's **Rename** returns focus to Rename. Item 124's slice 9 browser tests (3 October 2026, the same engines) likewise found focus on the page body after **Pause**, **Resume ride** and **Start riding**.
     - **Read from source, not measured:**
       - focus is left on `<body>` after **Clear selection** (Planning's feature details and the ride's selected-feature summary), after **Clear warning selection**, after the paused screen's restore-failure **Retry**, and after a successful **Save** of a replaced key;
       - **Test routing connection** is disabled while it runs, so it loses focus;
       - a Planning switch prompt that has fallen back to the page-level dialog restores no focus on **Cancel**;
       - a route deleted in another tab while its unconfirmed Delete confirmation has focus leaves focus on `<body>` (item 124 slice 6's limitations);
       - a failed End ride returns focus to End ride with a plain `focus()`, which could leave it under the navigation if the rider had scrolled. The failure itself is synthetic, and this was not measured.
     - **Untested:** what VoiceOver announces, and where its reading position goes, in each case, including focus parked on a confirmation's title while a write runs (D-01, D-02, D-06); what iOS Safari does with the same focus loss; and whether any candidate target would open the software keyboard or scroll the page on the installed iPhone. **None of these is established as a defect.**
     - **P-01, deferred here by the rider on 4 October 2026** ([decisions 10 and 11](history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)). Two distinct findings, **neither accepted nor fixed**:
       - **The last route card's focused Rename field out of view**, observed on the installed iPhone ([dated record](current-status-archive.md#installed-iphone-observation-of-p-01-rename-on-the-last-route-card-item-124-inventory-reported-4-october-2026)): the field did not come into view automatically, scrolling brought it into view, and Save and Cancel stayed reachable. Desktop Chromium and WebKit did not reproduce it: there the field is on screen, and the last card leaves 0 px of scroll room below, against a middle card's 990 px ([reconciliation](../design/reveal-inventory/closure-reconciliation.md#p-01--rename-on-the-last-route-card)). Whether the software keyboard covered the field, and whether iOS tried to scroll, is unknown.
       - **A middle card's Save and Cancel row partly clipped**, in desktop engines only, with no software keyboard: the opened editor's action row ends 21 px below the usable band, about 13 px beyond the viewport's edge (measured 1 October, reproduced 4 October).

       This item assesses the visibility of the field and the actions together, keyboard and visual-viewport behaviour included, without assuming that the two share a cause. Resolving either needs installed-iPhone evidence of the keyboard path.

     - **Constraints:** focusing the key field on opening Replace key would open the keyboard and could meet the open key-field zoom finding in [`current-status.md`](current-status.md); item 121's sticky-switcher release while the key form has focus; item 119's non-modal confirmations; and item 124's established pattern, under which focus moves with `preventScroll` and any reveal is the minimum, only while the rider is still at the operation. Coordinate with [item 125](#item-125)'s open question on restored focus.
     - **Evidence required when implemented:** desktop keyboard measurements of focus and scroll in Chromium and WebKit, in English and German; VoiceOver on the installed iPhone; and a negative control for each change.

---

<a id="item-136"></a>

## Item 136 — Showing where map- and chart-selected details appear (unscheduled design candidate)

_Category: Planning and Riding presentation_

136. **Showing where map- and chart-selected details appear — unscheduled design candidate**
     - Origin: item 124's inventory entries P-21 and P-26, with the 3 October review's recommendation that the page should not scroll to them by itself. The rider's direction of 4 October 2026 gives distant-detail presentation its own destination; the [reconciliation](../design/reveal-inventory/closure-reconciliation.md) records the retention.
     - **Unscheduled, and not part of the approved execution order.** No change is approved by this entry.
     - **Present facts, from source:**
       - **Planning (P-21):** tapping the elevation chart, or a climb on the map, shows "Route feature details" or the gradient-segment panel inside the route overview, below the map, with no reveal.
       - **Ride, before riding (P-26):** choosing a climb under **Recognised climbs** shows its details panel, which is tall; focus stays on the select.
       - Where these panels land on a phone has **not been measured**.
     - **Kept by item 124:** no automatic scroll for either, which would take the map or the selector away while the rider is still using it. During a ride (P-29) nothing should move on its own, so P-29 is not part of this item.
     - **The candidate:** a cue that does not move the page, telling the rider that details have appeared and where. Its form, wording, placement and persistence are open.
     - **Coordinate with:** item 122 (Planning's map area, shipped in `0.4.64` and accepted on the installed iPhone), item 128's messages below the map, item 114's enlarged-text layout, and item 124's P-18 outcome for warnings selected on the map.
     - **Evidence required when implemented:** measured positions before and after a selection, at 390 px portrait at ordinary and 200% root text, in English and German, in Chromium and WebKit; and the installed-iPhone recheck.

---

<a id="item-137"></a>

## Item 137 — A route's export failure shown beside its card (unscheduled design candidate)

_Category: Route Library_

137. **A route's export failure shown beside its card — unscheduled design candidate**
     - Origin: item 124's inventory entry P-06. The rider's direction of 4 October 2026 gives export-failure placement its own destination.
     - **Unscheduled, and not part of the approved execution order.** No change is approved by this entry.
     - **Present facts, from source (`src/ui/library/RouteLibrary.tsx`, at `e2ba7cf`):** a failed export shows "That route could not be exported." / "Diese Route konnte nicht exportiert werden.", or the longer message used when the browser's cryptography is unavailable. It appears as an alert under the Routes heading, at the top of the screen, while the **Export** that failed may be in a card far below. Nothing is focused or revealed. The alert is announced, but a sighted rider scrolled down to that card is not shown it.
     - **Not reproducible on demand, and never measured**: no ordinary step makes an export fail.
     - **The candidate:** show the failure beside its route, as item 124's slice 6 does for a failed deletion. A decision is also needed on what happens when a filter hides that route.
     - **Evidence required when implemented:** a synthetic export failure in Chromium and WebKit, in English and German, at ordinary and 200% root text; a negative control; and the installed-iPhone recheck of an ordinary export.

---

<a id="item-138"></a>

## Item 138 — Copy and comment corrections recorded during item 124 (unscheduled maintenance)

_Category: Maintenance_

138. **Copy and comment corrections recorded during item 124 — unscheduled maintenance**
     - Origin: findings that item 124's inventory recorded and deliberately left unchanged ([inventory](../design/reveal-inventory/README.md#other-findings-outside-item-124)). All of them were re-checked as still present at `e2ba7cf`.
     - **Unscheduled, and not part of the approved execution order.**
     - **German wording, user-facing through assistive technology:** `routes.wouldRemain.other` in `src/i18n/messages.de.ts` reads "Es würden {count} Routen übrig blieben". It should end "übrig bleiben". It is item 111's visually hidden count description, read aloud for a tag-filter chip.
     - **Stale comments:** `src/ui/riding/RidingScreen.tsx` still describes Riding rendering `GradientColoursDisclosure`, which item 85 removed. `src/index.css` still mentions the Riding wake-lock information popover, which item 82 removed.
     - **A committed test comment:** `e2e/confirmationReveal.smoke.spec.ts` (about lines 716–719) repeats slice 1's incorrect claim that a button above the viewport is "reachable by neither tap nor Tab" (corrected in the inventory's D-04).
     - **Not included:** C-14's always-red confirm action, a styling question that goes to [item 103](#item-103).
     - **Evidence required when done:** the catalogue parity tests, the formatter, and a review that each comment now matches the source it describes. No behaviour change.

---

<a id="item-142"></a>

## Item 142 — Paused-route behaviour after deletion and Back to Ride options (unscheduled investigation)

_Category: Riding lifecycle_

142. **Paused-route behaviour after deletion and Back to Ride options — unscheduled investigation**
     - Origin: the rider's observation, reported on 6 October 2026 together with item 140's launcher-slice acceptance on `0.4.65` (build `1d59d95`) ([dated record](current-status.md#installed-iphone-acceptance-of-0465-build-1d59d95-item-140-launcher-slice-reported-6-october-2026)). **Filing it here does not establish a defect, a cause or a fix.**
     - **Unscheduled, and not part of the approved execution order** ([order](../../CLAUDE.md)), which is unchanged. It awaits investigation and the rider's prioritisation. No change is approved by this entry.
     - **The observation, as reported:** after deletion, the full paused-route screen still permits resumption if the rider has not taken **Back to Ride options**.
     - **Not established — for the investigation to settle:**
       - the exact deletion operation the rider used, and how the paused route screen was then reached;
       - which stored records remain after the deletion — the route, the stored ride session — and what keeps the paused screen showing;
       - whether resuming after the deletion starts tracking, what it then stores, and what survives fully closing and reopening the app;
       - whether, in item 140's Session 5 Discard check, returning to Ride showed the paused route screen or the Ride screen's summary: the report does not say;
       - the cause. **No cause or connection to item 140 has been established.**
     - **Starting points from source — places to inspect, not findings:**
       - `deleteRoute` in `src/storage/routesRepository.ts`, and the Route Library's deletion lifecycle ([item 124](history/item-124.md#item-124)'s D-02);
       - `ridingContent` in `src/App.tsx`, which decides whether Ride shows a route's own screen or the launcher;
       - `src/ui/riding/RidingScreen.tsx`: the paused and pre-ride panel (Resume ride, End ride, Edit copy, Back to Ride options) and the restore-failure alert, which also offers Back to Ride options;
       - `src/ui/riding/RidingLauncher.tsx`: the missing-route branch, which offers only **Discard unfinished ride**.
     - **The investigation must:**
       1. reproduce the full paused-screen path after a route's deletion, reading the stored records before and after each step, and compare it with the launcher's handling of the same session (item 124's C-09 missing-route variant);
       2. determine what should happen to an unfinished ride when its saved route is deleted — while the app stays open, and after it is fully closed and reopened (item 132's first Ride entry);
       3. assess whether showing Resume ride and End ride both on the paused route screen and in the launcher's summary is useful or a duplicate presentation;
       4. consider removing **Back to Ride options** from the ordinary paused-route screen while keeping it before a ride starts;
       5. keep an appropriate escape during restoration failures — item 132's restore-failure alert, with Retry and Back to Ride options — and access to the missing-route recovery, the launcher's **Discard unfinished ride**.
     - **Output: a bounded proposal, with its measured findings, before any implementation.** **Hiding Back to Ride options alone does not resolve the deletion-policy question.**
     - **Coordinate with:**
       - [item 132](history/items-132-NN.md#item-132), the paused route screen after a cold start, its restore intent and its held-back controls;
       - item 124's D-02 deletion lifecycle and C-09's accepted missing-route flow, which is to be preserved or deliberately revised;
       - [item 140](history/items-132-NN.md#item-140), session identity, its launcher slice and its open remaining scope;
       - [item 134](history/items-132-NN.md#item-134), an End ride still finishing; [item 135](#item-135), focus when a control disappears;
       - [item 119](history/items-118-131.md#item-119)'s switch guard.
     - **Evidence required when implemented:**
       - a reproduction in Chromium and WebKit, in English and German, with the stored records read before and after;
       - a negative control for any guard;
       - an installed-iPhone check of the ordinary flows.

---

<a id="item-143"></a>

## Item 143 — Stale-window persistence writes (unscheduled investigation)

_Category: Riding lifecycle_

143. **Stale-window persistence writes — unscheduled investigation**
     - Origin: [item 140](history/items-132-NN.md#item-140)'s caller inventory, filed by the rider's [scope decision of 6 October 2026](history/items-132-NN.md#item-140-scope-decision). **Filing it here does not mean a defect is confirmed on a device, a cause beyond the source facts below is claimed, or a fix is approved.**
     - **Unscheduled, and not part of the approved execution order** ([order](../../CLAUDE.md)), which is unchanged. It awaits investigation and the rider's prioritisation.
     - **Present facts, from source at `0.4.66`:**
       - both riding screens' per-fix and Pause writes put the session the window holds over whatever is stored — a newer session from another window included;
       - route riding opened without a known session can, after a failed restore read, start a session over whatever another window has stored since App's read;
       - the direct, no-conflict **Start free roam** write, and its retry after a fresh check, write unconditionally;
       - since item 140's slice 2, End ride, Finish ride and End and switch never delete or overwrite another session themselves, and a write still waiting when an End begins is cancelled — but a write issued before the End can already have overwritten a newer session, which no End can then recover.
     - **Not established — for the investigation:**
       - how often two windows of the site are open at once in ordinary use, given that the installed iPhone PWA has a single window;
       - whether a window can learn that another has taken over the session (Dexie's live queries, a broadcast channel, or a check inside each write), and at what cost to the per-fix write path;
       - what the stale window should then do: stop and hand back, as a refused End does, or something else.
     - **Output: a bounded proposal before any implementation**, with measured findings. It must keep ride persistence intact for the ordinary single window.
     - **Coordinate with:** [item 140](history/items-132-NN.md#item-140) (session identity, its slices); [item 144](#item-144) (older versions); [item 132](history/items-132-NN.md#item-132) (restoring a stored ride); item 119's switch guard.
     - **Evidence required when implemented:** two-window browser tests in Chromium and WebKit in which the stale window does receive fixes, with the stored rows read before and after; negative controls; an installed-iPhone check that ordinary riding still persists and recovers.

---

<a id="item-144"></a>

## Item 144 — Older-version windows and ride sessions (unscheduled investigation)

_Category: Riding lifecycle_

144. **Older-version windows and ride sessions — unscheduled investigation**
     - Origin: [item 140](history/items-132-NN.md#item-140)'s caller inventory, filed by the rider's [scope decision of 6 October 2026](history/items-132-NN.md#item-140-scope-decision). **Filing it here does not mean a defect is confirmed on a device or a fix is approved.**
     - **Unscheduled, and not part of the approved execution order** ([order](../../CLAUDE.md)), which is unchanged. It awaits investigation and the rider's prioritisation.
     - **Present facts, from source:**
       - a window still running a version before `0.4.65` clears whatever is stored from the launcher, End and switch and the riding screens, and writes rows without an identity;
       - a window running `0.4.65` does the same from End and switch and the riding screens;
       - while such a window rides a session without an identity, each of its writes removes the identity the current version assigned, so the current window's End ride, Discard or End and switch is refused, with the notice, until that ride ends — the repeated refusal recorded under item 140. Since `0.4.66` a current-version window's own restore gives such a session an identity that its writes carry, so only an older window still rides one without.
     - **Not established — for the investigation:**
       - how long an older window can realistically stay open beside a newer one, given the existing deferred update prompt, which never forces a reload during a ride;
       - whether anything beyond that update path is needed, or proportionate;
       - whether a current window should recognise older-format writes, and say so.
     - **Output: a bounded proposal before any implementation.** Never force a service-worker update or reload during an active ride.
     - **Coordinate with:** [item 140](history/items-132-NN.md#item-140); [item 143](#item-143); the PWA update lifecycle.
     - **Evidence required when implemented:** depends on the proposal; any test needs a build of the older version beside the current one.

---

<a id="item-145"></a>

## Item 145 — Route-riding map space while a failed End ride's error shows at enlarged text (unscheduled investigation)

_Category: Riding presentation_

145. **Route-riding map space while a failed End ride's error shows at enlarged text — unscheduled investigation**
     - Origin: [item 139](history/items-132-NN.md#item-139)'s own evidence, filed by the rider with item 139's acceptance on 7 October 2026. Item 139 put a failed End ride's error on its own wrapping row below the immersive header; the map gives up that row's height while the error shows. **Filing it here does not mean a defect is confirmed on a device or a remedy is approved.**
     - **What was measured** (6 October 2026, item 139's diagnostic): desktop Chromium and WebKit in the CI image, at 390×844 portrait with **200% browser root text**. The failure is synthetic, through the existing seam `window.__acnE2eRideStateClearFailure`. The figure is the visible map region, the content area holding the map, during a failed End in **route riding**:
       - **English: 174 → 86 px;**
       - **German: 134 → 10 px.**

       The error was fully readable and the header held still, but the German map became impractically small. For comparison only, free roam went from 543 to 455 px (English) and 419 px (German), and at ordinary text the row costs route riding 34 px (English) and 52 px (German).

     - **Not established:**
       - anything on the installed iPhone. These are browser text-scaling measurements, **not** physical iOS Larger Text results, and a clear cannot be made to fail through the installed PWA's interface;
       - how often an End fails on a phone.
     - **Scope:** the error's readability, useful map space and access to the recovery controls — End ride again, Pause, the Map/Profile switcher and the status card — investigated together, not one at the expense of another.
     - **Output: a bounded proposal before any implementation**, with measured findings. **Nothing is approved:** no minimum map height, overlay, disclosure, truncation or other remedy. Item 139's approved behaviour — the whole sentence visible, Pause, the title and End ride unmoved — is the starting point.
     - **Unscheduled, and not part of the approved execution order** ([order](../../CLAUDE.md)), which is unchanged. **Review checkpoint, by the rider's decision of 7 October 2026:** before [item 103](#item-103)'s visual audit begins, the rider reviews this item and decides whether to schedule it. That is a review, not a place in the order.
     - **Coordinate with**, without importing any item's whole scope:
       - [item 139](history/items-132-NN.md#item-139)'s evidence and limitations;
       - the enlarged-text precedents: [item 114](history/items-114-117.md#item-114)'s enlarged-text layout and [item 115](history/items-114-117.md#item-115)'s height-gated climb cue, with its 44 px floor measured in the CI container;
       - [item 103](#item-103), for error and control styling;
       - [item 135](#item-135), for focus after a failure, still a plain `focus()` on End ride.
     - **Evidence required when implemented:** depends on the proposal; at least the synthetic failure in Chromium and WebKit in the CI image, in English and German, at ordinary and 200% root text, in route riding and free roam, with the map region, the error's lines and the recovery controls measured, and a negative control; then an installed-iPhone check of whatever is reachable there.

---

<a id="item-146"></a>

## Item 146 — E2E coverage and runtime audit (investigation; first in the approved order)

_Category: End-to-end test suite_

146. **E2E coverage and runtime audit**
     - **Filed and scheduled on 7 October 2026**, by the rider's decision, first in the approved execution order, ahead of items 103 and 120 ([order](../../CLAUDE.md)).
     - **Purpose:** to assess the end-to-end suite's distinct regression coverage, execution cost and maintainability **before** any further optimisation or sharding is chosen.
     - **It is an investigation, not approval to delete tests or weaken CI.** There is no test-count reduction target. The E2E job's 20-minute limit, the required CI gate — Deploy needs Verify and build and every shard — the failure evidence [item 116](history/items-114-117.md#item-116) retains, and meaningful assertions are all preserved.
     - **While investigating:** no retries, no change to global timeouts, no additional shards, no test removal, no production-code change and no new reporting dependency. A reporter or workflow change, if proposed, belongs in the proposal, before any implementation.
     - **The first investigation slice:**
       - an inventory of the spec files and the expanded executable cases by project, parameterised cases and browser duplication included; for each spec or coherent group, the behaviour or regression protected, why it needs browser execution, its language, text-size, viewport and engine combinations, potential overlap, and its runtime evidence where available;
       - an assessment of genuine duplication that does not treat similar-looking tests as interchangeable: browser layout, focus, gestures, real IndexedDB transactions and multi-window races can need browser coverage;
       - candidates to retain, consolidate, move exhaustive logic to component or unit tests, repair, or investigate further, each with a concrete rationale and an account of the coverage that would remain;
       - runtime from existing CI logs, reports and metadata first, compared across several runs, separating test execution from installation, build and other job overhead, test counts from duration, repeatable expensive work from runner variability, and waits genuinely needed to prove behaviour from unnecessary settling;
       - the worker and sharding configuration, without assuming that more workers help software-rendered map tests;
       - fixed waits reviewed individually — autosave observation windows, debounce guards and genuine-touch pacing keep their evidential purpose — and matrix expansion reviewed selectively: German wrapping, enlarged text and WebKit focus behaviour may justify separate cases, pure logic may not need every combination;
       - focused diagnostics in the pinned CI image where necessary, prioritising [item 147](#item-147) and [item 148](#item-148) without implementing their fixes, reusing the existing repetition evidence and preserving failure artefacts in separate output directories before any rerun.
     - **Output:** a linked audit report — the coverage inventory, the available runtime measurements and their limits, prioritised findings, a small proposed first implementation slice with the coverage and CI guarantees it preserves, and whether additional shards are warranted. **The item stays open** while further evidence or approved implementation is needed, and completed investigation is kept distinct from proposed change.
     - **Context:** [item 133](history/items-132-NN.md#item-133)'s four shards; the shard durations under "Monitored, corroborating only" in [`current-status.md`](current-status.md). [Item 130](#item-130), [item 147](#item-147) and [item 148](#item-148) are separate investigations: the audit may prioritise diagnostics for 147 and 148, but neither absorbs nor fixes them.
     - **Related standard, from the same decision:** a new browser test states briefly its distinct purpose, why it needs browser execution and any relevant overlap with existing coverage (the root [`CLAUDE.md`](../../CLAUDE.md)'s Engineering standards).
     - **First investigation slice, 7 October 2026 — reported; nothing implemented** ([report](e2e-coverage-runtime-audit.md)). Measured from per-test durations in the rider-supplied logs of CI runs 37602138083 and 37499907118, cross-checked row by row against the raw logs, and from focused diagnostics in the CI image by digest. Its findings, each a candidate rather than a decision:
       - **No shard change is warranted now.** The longest shard job at head took 806 s, 394 s under the limit; the longest recorded took 967 s (shard 4 of run 37614828755). Each shard spends about 50–60 s before its tests start. Count-based sharding leaves the mixed shard 3 shorter than the others.
       - **Cost is concentrated in the two-engine smoke specs**, about 59 % of summed durations. Their geometry needs the language × size combinations; their state and storage assertions repeat per combination.
       - **Items 147 and 148 now have characterised failure patterns**, still without a cause; see each entry.
       - **Smaller items:** five specs omit the `serviceWorkers: "block"` their map-style helper requires; landscape assertions remain in 12 specs, one holding the only 200 % compaction check; a few Android duplicates; fixed waits mostly evidential; some stale comments.
     - **Proposed first implementation slice, awaiting the rider's review:** keep per-test durations from every CI run, using Playwright's built-in JSON reporter beside `list` and an always-run upload per shard with 7-day retention. Test, timeout, retry, worker, shard, failure-evidence and gate behaviour are all unchanged. Later candidates are listed in the report. **The item stays open and first in the order.**
     - **Follow-up, 7 October 2026 — CI run 37614828755's failure repaired, test-only** ([report](e2e-coverage-runtime-audit.md#13-follow-up-ci-run-37614828755-and-its-repair)).
       - **The failure:** the run on the documentation commit `892a59a` failed one Chromium case, `gradientColouring.spec.ts:1026`, and deployed nothing.
       - **The cause, from its CI trace:** the test helper treated `map-loading` being hidden as readiness while Routes was still showing.
       - **The repair:** the helper now waits for the opened route's `h1` first, with every assertion unchanged.
       - **Its shard 4 took 967 s,** 233 s under the limit, the longest shard job recorded.
       - The JSON timing proposal stays separate and unapproved.

---

<a id="item-147"></a>

## Item 147 — Status connection-result Enter/focus check (unscheduled test-reliability investigation)

_Category: End-to-end test reliability_

147. **Status connection-result Enter/focus check — unscheduled test-reliability investigation**
     - **Origin:** recorded on 7 October 2026, during item 125's verification, as an unnumbered observation in [`current-status.md`](current-status.md), and promoted to this number the same day by the rider's decision. **Automated evidence only**, from local runs in the pinned Playwright container; not an installed-iPhone observation.
     - **Unscheduled, and not part of the approved execution order.** It is linked to [item 146](#item-146), the E2E audit, which may prioritise diagnostics for it but does not fix it. No change to the test, its assertion or production code is approved by this entry.
     - **The test, exactly:** project `webkit-smoke`, `e2e/statusConnectionResultReveal.smoke.spec.ts:953`, "the result line revealed while the rider waits › Enter on the focused button: revealed, with focus left where it was".
     - **The rates:** repeated 60 times on its own in the CI image, it failed **20 of 60 on item 125's build** and **18 of 60 on a build source-equivalent to `0.4.68`**.
     - **What the assertion compares:** the focused element's _text_. Its snapshot records `body`, or the focused element's tag with its `aria-label` or the first 30 characters of its text, and the button's label changes from "Testing…" while it runs to "Test routing connection" afterwards. **A mismatch does not by itself show that focus moved**, and this entry does not infer actual focus loss from that text comparison.
     - **Not established:** the cause. The spec's own comment records Linux WebKit's deferred focus fixup after the button is disabled; that is recorded browser behaviour, not a demonstrated cause.
     - **CI:** no CI failure of this case is recorded.
     - **Not [item 130](#item-130)**, which concerns a different spec and assertion.
     - **Related:** [item 135](#item-135) records the product question — **Test routing connection** is disabled while it runs, so it loses focus. This item concerns what the test's assertion measures and imports nothing from item 135.
     - **Diagnostics from item 146's first slice, 7 October 2026** ([report](e2e-coverage-runtime-audit.md#8-focused-diagnostics-items-147-and-148)). The 60-repeat rates were reused, not re-measured. An instrumented copy, outside the repository, recorded the focused element's node identity, focus events and the button's disabled and text changes:
       - **30 repeats (30 tests on 30 workers): 3 failed.** In all three, the focused element at both snapshots was the same button node, no `focusout` was logged, and the button had been re-enabled and relabelled — so the text comparison failed while focus stayed where it was. In passes, a `focusout` from the disabled button, Linux WebKit's deferred fix-up, landed before the re-enable, or focus was already on `body`.
       - **A controlled comparison, not CI-equivalent (2 workers, `--cpus=4`, trace off): 0 of 30 failed.**
       - **The case passed in both supplied CI runs.** Not established: that the uninstrumented 60-repeat failures had the same form, or why the fix-up sometimes lands after the re-enable. No change is approved.

**The observation as recorded in `current-status.md`, moved here unchanged on 7 October 2026:**

- **A WebKit focus check in `statusConnectionResultReveal.smoke.spec.ts` fails often under repetition, on the baseline too (7 October 2026).**
  - **The case:** "Enter on the focused button: revealed, with focus left where it was" compares the focused element by its text. Twice it failed in combined local runs on item 125's build: the button was still focused once re-enabled, reading "Test routing connection", while the earlier snapshot had it focused as "Testing…".
  - **The rates:** repeated 60 times on its own in the CI image, it failed **20 of 60 on item 125's build and 18 of 60 on a build source-equivalent to `0.4.68`**, in the identical way. The spec's own comment records Linux WebKit's deferred focus fix-up after the button is disabled.
  - **What follows from that:** the failure is not attributed to item 125, and it is not changed here. No CI failure of it is recorded. No item number is allocated; whether it warrants one is the rider's decision.

---

<a id="item-148"></a>

## Item 148 — Paused-End confirmation scroll preconditions (unscheduled test-reliability investigation)

_Category: End-to-end test reliability_

148. **Paused-End confirmation scroll preconditions — unscheduled test-reliability investigation**
     - **Origin:** recorded on 6 October 2026, during item 139's verification, and again on 7 October 2026, during item 125's, as an unnumbered observation in [`current-status.md`](current-status.md), and promoted to this number on 7 October 2026 by the rider's decision. **Automated evidence only**, from local runs in the pinned Playwright container; not an installed-iPhone observation.
     - **Unscheduled, and not part of the approved execution order.** It is linked to [item 146](#item-146), the E2E audit, which may prioritise diagnostics for it but does not fix it. No change to the test or production code is approved by this entry.
     - **The spec:** `e2e/endRidePausedConfirmationReveal.smoke.spec.ts`, whose "scrolled" cases are generated at line 1041 from its `SCROLLED_CASES` table. Each asserts its own precondition — that wheel input put End ride's slot where the case requires — before the behaviour it tests.
     - **First occurrence, 6 October 2026, on item 139's build:** project `webkit-smoke`, "(en, 100%) scrolled with End ride's slot under the navigation, then Cancel: only the movement that reveals End ride" and "(de, 100%) scrolled with End ride's slot under the navigation, then Cancel: only the movement that reveals End ride", in a combined local run of 164 tests. **Its artefacts were overwritten and not inspected.**
     - **Second occurrence, 7 October 2026, on item 125's build (`index-Df45j2uq.js`):** project `webkit-smoke`, "(en, 100%) scrolled with End ride's slot partly above the viewport, then Cancel: only the movement that reveals End ride", in a combined local run of 229 tests. **Its artefacts were kept:** the failure screenshot shows the paused screen at its top with End ride's confirmation open.
     - **Reruns and baselines, kept on record and not treated as resolution:** after the first, an identical combined run passed 164 of 164, the case passed 12 of 12 in isolation on that build and on the baseline, and a combined baseline run showed no such failure; after the second, the next identical combined run passed that case, as did a combined run of the same specs on a build source-equivalent to `0.4.68`.
     - **Not assumed:** that the two occurrences — different cases, on different builds, in different runs — share a cause, or that either is attributable to item 125 or item 139. **No cause is established.**
     - **Not [item 130](#item-130)**, which concerns a different spec and assertion.
     - **Diagnostics from item 146's first slice, 7 October 2026** ([report](e2e-coverage-runtime-audit.md#8-focused-diagnostics-items-147-and-148)). They started with the eight WebKit scrolled cases and the kept artefacts; the broader 230-case selection was not reconstructed.
       - **The unmodified cases × 5, with a JSON reporter (40 tests on 36 workers): 3 failed**, in three different cases. The spec's own placement note shows every pass exactly on target and every failure exactly where the confirmation was before the wheel.
       - **An instrumented copy × 5, recording wheel and scroll events without requesting frames (40 tests on 36 workers): 2 failed.** In both, the document received one cancelable, not default-prevented `wheel` and the page could scroll, but no `scroll` event followed and `scrollY` never changed within the settle window, at least 300 ms. In passes the first scroll followed within 5–107 ms.
       - **The same at 2 workers with `--cpus=4`, a controlled comparison, not CI-equivalent: 6 of 40 failed, all in that pattern** — so high concurrency is not required for reproduction; a load contribution remains unestablished.
       - **All eight cases passed in both supplied CI runs.**
       - **Not established:** a cause; whether WebKit would have scrolled after the settle window; whether the first occurrence had the same form. Nothing is attributed to item 125 or 139, and no change is approved.

**The observation as recorded in `current-status.md`, moved here unchanged on 7 October 2026:**

- **Two WebKit cases of `endRidePausedConfirmationReveal.smoke.spec.ts` failed once, on 6 October 2026, and their cause is not established.** "(en, 100%)" and "(de, 100%) scrolled with End ride's slot under the navigation, then Cancel" failed at the test's own precondition, "wheel input put End ride's slot under the navigation", in a combined local run of 164 tests in the CI image on item 139's build. A second identical run passed 164 of 164, the case passed 12 of 12 in isolation on that build and on the baseline, and a combined baseline run showed no such failure. The case concerns the paused panel, whose markup item 139 does not change. The failure's artefacts were overwritten and not inspected. It is not called unrelated or a flake; details are in [item 139's record](history/items-132-NN.md#item-139). **No item number is allocated**; whether it warrants one is the rider's decision. **Update, 7 October 2026:** it stays unnumbered and its cause unknown. Neither the unchanged markup nor the passing reruns make it unrelated or resolved. **A future diagnostic rerun must preserve the existing failure artefacts first** — a separate output directory, or archiving them before rerunning — so that a failure can still be inspected after it has been rerun.

  **A second occurrence, 7 October 2026, with its artefacts kept.** It happened in a combined local run of 229 tests in the CI image, on item 125's build (`index-Df45j2uq.js`), in another case of the same spec: WebKit's "(en, 100%) scrolled with End ride's slot partly above the viewport, then Cancel". It failed at its own precondition, "wheel input put End ride's slot partly above the viewport".
  - **What the artefacts show:** they were kept in a separate output directory and inspected. The failure screenshot shows the paused screen **at its top, with End ride's confirmation open** — when the snapshot was taken, the wheel had not moved the page, or the page had been moved back.
  - **Reruns:** the next identical combined run passed that case, and so did a combined run of the same specs on a build source-equivalent to `0.4.68`.
  - **Against item 125:** that slice adds no scroll loop to this flow, which reaches the paused screen through a route opened from Routes, Start riding and Pause, just as before.
  - **No cause is established.** Nothing here attributes it to item 125 or calls it unrelated.
