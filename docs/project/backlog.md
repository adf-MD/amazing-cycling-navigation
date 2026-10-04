# Planning backlog — full pending item specifications

This file holds the complete, byte-preserved specification for every backlog item that is **approved future work but not yet implemented**, plus the two items that are explicitly monitored/investigated-but-unconfirmed (see [current-status.md](current-status.md) instead for those two — items 32 and 66).

Item numbers are stable identifiers across this project's entire documentation set — they never change regardless of which file an item's text lives in. See [README.md](README.md) for the full map of where everything lives, and the root [`CLAUDE.md`](../../CLAUDE.md) for durable product/engineering rules and the required reading order before implementing any item here.

Items 11, 12, 16, 28, 59, 60 and 61 below remain approved future work, not yet scheduled into the sequence. Items 87–92 were added by the [release-readiness audit](release-readiness-audit.md) (item 86); items 87–92 have since been completed. Items 107–113 were added by the installed-iPhone field test of 10 September 2026 (see [current-status.md](current-status.md) for the dated evidence) and were all scheduled ahead of items 102 and 103, which keep their numbers; the authoritative execution order lives in the root [`CLAUDE.md`](../../CLAUDE.md)'s queue index and is deliberately not duplicated here. All seven items of that group, 107–113, have since been completed and their full specifications have moved to [`history/`](history/README.md). Item 114 was added on 11 September 2026 from item 109's own Chromium verification work rather than from that field test, and has since been completed (`0.4.45`) and moved to [`history/`](history/README.md). Item 117 was added on 13 September 2026 from the installed-iPhone session that accepted item 112, which rejected the opaque route identifier that session's `Active session` row exposed, and has since been completed and moved to [`history/`](history/README.md). Item 118 was added on 13 September 2026 from a second installed-iPhone report the same day and has since been completed and moved to [`history/`](history/README.md); item 119 was added from the repository investigation that established item 118's ownership, and has since been completed (`0.4.47`) and moved to [`history/`](history/README.md). Item 121 was recorded on 25 September 2026, placed first in the execution order, and has since been completed (`0.4.44`) and moved to [`history/`](history/README.md). Item 128 was recorded on 29 September 2026 from item 114's own measurements; it and item 124 were unscheduled until 30 September 2026, when the rider placed both in the approved execution order ahead of items 103 and 120. Item 128 has since been completed (`0.4.50`, the rider's C6 layout) and moved to [`history/`](history/items-118-131.md#item-128). Item 122 was scheduled on 1 October 2026, after item 124 and before items 103 and 120, for its investigation and design stage only. Item 123 was promoted to the front of the approved execution order on 29 September 2026 and has since been completed (`0.4.46`) and moved to [`history/`](history/README.md); item 129 was recorded that day from the installed-iPhone check of `0.4.45` and is unscheduled. Item 130 was recorded on 30 September 2026 from an end-to-end test flake measured during item 119's `0.4.48` follow-up, and is unscheduled. Item 102 was completed on 30 September 2026 (`0.4.49`) and moved to [`history/`](history/README.md). Item 132 was recorded on 2 October 2026, from the rider's approval of one paused-route screen after a cold start, and placed first in the approved execution order, ahead of item 124's remaining approved slices. Later the same day, the rider approved policies for item 124's inventory cases D-06, D-02, D-01 and C-12 and placed item 124's D-06 repair ahead of item 132, which was then second. That repair shipped in `0.4.54`, returning item 132 to first, and its ordinary flow was accepted on the installed iPhone the same day. Item 133 was then recorded on 2 October 2026, a bounded CI-infrastructure change from two end-to-end shards to four, and placed first, ahead of item 132. It has since been configured for four shards, verified in CI run 37055399688, and moved to [`history/`](history/items-132-NN.md#item-133). Item 132 then shipped in `0.4.55`, also on 2 October 2026, and moved to [`history/`](history/items-132-NN.md#item-132); it was accepted on the installed iPhone in English and German, reported the same day, and item 124's remaining approved slices are first in the order, starting with slice 5, D-01. Slice 5 shipped in `0.4.56` on 3 October 2026, and its ordinary flow was accepted on the installed iPhone in English and German, reported the same day; D-02's investigation and planning stage is next. D-02 was investigated and planned the same day, with nothing implemented ([report](../design/reveal-inventory/d-02-delete-lifecycle.md)); its implementation, with the rider's option A for a failure hidden by a filter, shipped in `0.4.57` as item 124's slice 6, also on 3 October 2026, and its ordinary flow was accepted on the installed iPhone in English and German, reported the same day. The rider also approved the common opening and cancellation policy for item 124's C-07, C-08, C-10, C-11 and C-13 that day and reported C-09's missing-route variant on the device; C-12's opening reveal, slice 7, is next. Items 134–138 were recorded on 4 October 2026 from the reconciliation of item 124's remaining inventory, as explicit destinations for concerns found during item 124; all five are unscheduled. Item 124 was then completed in eleven slices and closed on 4 October 2026, after slice 11's installed-iPhone acceptance, and its record moved to [`history/item-124.md`](history/item-124.md#item-124) and its continuation; items 139 and 140 were filed from its close-out the same day, and both are unscheduled.

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
     - **Input from item 124's inventory, 4 October 2026** (the [reconciliation](../design/reveal-inventory/closure-reconciliation.md)). The page-level switch dialog (C-14) uses `ConfirmDialog`, whose confirm action is always `btn-danger`. So it styles **Retry**, **Check again** and **Try again** as destructive, where item 95's inline prompt styles them as secondary. This is from source, still present at `e2ba7cf`, and adds no scope beyond this audit's button review.

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

---

<a id="item-122"></a>

## Item 122 — Planning map area on a phone (design stage first)

_Category: Planning layout_

122. **Planning map area on a phone — design stage first**
     - Origin: item 113's first installed-iPhone pass, 25 September 2026. The Planning map felt too small for planning compared with free roam's map.
     - **Scheduled on 1 October 2026**, second in the approved execution order (root [`CLAUDE.md`](../../CLAUDE.md)), after item 124 and before items 103 and 120, by the rider's decision; it was unscheduled until then. **Scheduling approves its investigation and design stage only** — no dimensions, expansion behaviour or implementation. Nothing about a new size is approved by this entry.
     - Present fact: `.planning-map-container` is `clamp(280px, round(nearest, 44dvh, 20px), 460px)` behind an `@supports` fallback chain. The 20 px rounding is load-bearing: a fractional map-container height once left MapLibre's drag-rotate/pitch handler permanently active with no end event. That was found in CI during the interface migration's fifth slice, and it recurred in Planning ([`history/interface-accessibility-migration.md`](history/interface-accessibility-migration.md)).
     - Any change must be **measured and tested as its own alternative**. That covers the gesture end events at the new heights; the waypoint list, profile, warnings and save controls remaining reachable; item 114's attribution/placement-control relationship; and the ordinary 390 px presentation. It must not be folded into item 103 or any other styling work.
     - **Coordinate with item 128** (shipped `0.4.50`, [`history/items-118-131.md`](history/items-118-131.md#item-128)): its C6 layout was verified at the current map dimensions. Every proposed map size must rerun item 128's crosshair, imagery-message, Retry, placement-control and attribution checks — `e2e/planningImageryBanner.smoke.spec.ts` and the probe in [`../design/planning-imagery-banner/`](../design/planning-imagery-banner/README.md) — and report the 280 px-floor case at 320×568, where German still overlaps the crosshair by 15 px.
     - **Investigation and design stage completed on 4 October 2026** ([report](../design/planning-map-area/README.md)). It recommends a larger default map at ordinary text (C1), compares an on-demand expanded mode (C2) and a map sized to the fold (C1L), and lists the decisions needed. Nothing is implemented; the rider's layout decision is awaited.

---

<a id="item-125"></a>

## Item 125 — Per-screen scroll restoration (unscheduled)

_Category: Navigation and information architecture_

125. **Per-screen scroll restoration — unscheduled**
     - Origin: the rider's observation, reported 28 September 2026: switching between screens should neither discard nor share their scroll positions.
     - **Unscheduled, and not part of the approved execution order.**
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
     - **Explicit design questions, deliberately open:**
       - persistence across closing and reopening the PWA (memory only, or stored);
       - resetting after substantial content changes (a filter or search change, an import, a delete, a new calculation);
       - whether Planning and the riding screens take part;
       - interaction with item 124's reveals and with restored focus.
     - **Evidence required when implemented:** browser tests for each screen pair, both directions, including a screen shorter than the stored offset, plus the installed-iPhone recheck.

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

<a id="item-134"></a>

## Item 134 — Resume ride offered while a confirmed End ride is still finishing (unscheduled defect investigation)

_Category: Riding lifecycle_

134. **Resume ride offered while a confirmed End ride is still finishing — unscheduled defect investigation**
     - Origin: observed while implementing item 124's slice 9 (`0.4.60`, 3 October 2026) and recorded in its [limitations](history/item-124-continued.md#slice-9--confirmations-closed-by-a-ride-transition-c-10-c-11-c-12-shipped-0460-3-october-2026). The rider's direction of 4 October 2026 asked that it get its own disposition; the [reconciliation](../design/reveal-inventory/closure-reconciliation.md) sends it here. **Recording it here does not mean it is fixed or accepted.**
     - **Unscheduled, and not part of the approved execution order.** No change is approved by this entry.
     - **Present facts, from source (`src/ui/riding/RidingScreen.tsx`, at `e2ba7cf`):** after End ride is confirmed on the paused screen, its confirmation reads "Ending ride…" with both actions disabled, and **Back to Ride options** is disabled while the ending runs (`activeFinalizeSource !== null`). The panel's **Resume ride** has no such condition and stays enabled.
     - **What a component test shows, with a synthetic hold:** `RidingScreen.finishEndRide.test.tsx` ("keeps a confirmed End ride's confirmation, still ending, when Resume ride is pressed while it runs") holds the stored session's clear open. Pressing **Resume ride** then starts riding: the riding header and **Pause** appear, with "Ending ride…" carried below it. Once the clear is released, the screen returns to the pre-ride state with **Start riding**. Slice 9 kept that behaviour and changed nothing else.
     - **Not established:** whether a rider can reach the window on a device, since how long the clear takes there is unknown; whether a fix accepted inside the window writes anything to storage after the clear; whether the location watch is always stopped; and how item 131's one-use resume instruction behaves there. It has not been reproduced in a browser or on the installed iPhone.
     - **A candidate, not a decision:** keep **Resume ride** unavailable while an End ride finishes, as **Back to Ride options** already is.
     - **Evidence required when resolved:** a component test and a browser test, in Chromium and WebKit, that each hold the clear; the stored session read after the release; a negative control; and the installed-iPhone End ride check.

---

<a id="item-135"></a>

## Item 135 — Focus continuity when a control disappears or an operation ends (unscheduled accessibility investigation)

_Category: Interface and accessibility consistency_

135. **Focus continuity when a control disappears or an operation ends — unscheduled accessibility investigation**
     - Origin: item 124's reveal inventory (D-05) and its 3 October review (group 4). Under the rider's direction of 4 October 2026, focus questions found during item 124 come here rather than extending item 124. The [reconciliation](../design/reveal-inventory/closure-reconciliation.md) lists each case and its evidence.
     - **Unscheduled, and not part of the approved execution order.** No change is approved by this entry.
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
       - **The last route card's focused Rename field out of view**, observed on the installed iPhone ([dated record](current-status.md#installed-iphone-observation-of-p-01-rename-on-the-last-route-card-item-124-inventory-reported-4-october-2026)): the field did not come into view automatically, scrolling brought it into view, and Save and Cancel stayed reachable. Desktop Chromium and WebKit did not reproduce it: there the field is on screen, and the last card leaves 0 px of scroll room below, against a middle card's 990 px ([reconciliation](../design/reveal-inventory/closure-reconciliation.md#p-01--rename-on-the-last-route-card)). Whether the software keyboard covered the field, and whether iOS tried to scroll, is unknown.
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
     - **Coordinate with:** item 122 (Planning's map area, design stage, not started), item 128's messages below the map, item 114's enlarged-text layout, and item 124's P-18 outcome for warnings selected on the map.
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

<a id="item-139"></a>

## Item 139 — A failed End ride's message clipped in the riding header (unscheduled presentation defect)

_Category: Riding presentation_

139. **A failed End ride's message clipped in the riding header — unscheduled presentation defect**
     - Origin: item 124's close-out investigation of 4 October 2026 ([findings](../design/reveal-inventory/closure-reconciliation.md#a-failed-end-rides-message)), filed by the rider's disposition the same day ([decision 13](history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)). **Filing it here does not mean it is fixed or accepted.**
     - **Unscheduled, and not part of the approved execution order.** No change is approved by this entry.
     - **What was measured**, in desktop Chromium and WebKit in the pinned container at 390×844 portrait, identically in both engines. The failure is **synthetic**: the existing test-only seam `window.__acnE2eRideStateClearFailure` fails the first clear of the stored session only.
       - **Route riding's header (C-10):** the message "The ride could not be ended on this device. Try again." sits on one line in the header's end slot, beside **End ride**. It is 318 px wide in English, from x = 216 to 534 on a 390 px screen, and 464 px wide in German, to x = 685. The fixed riding shell clips it at the screen's edge, so about 55% of the English sentence and 36% of the German one are visible. The page itself does not overflow.
       - **Free roam's header (C-13):** the same placement and clipping, measured in English only.
       - **Beside it:** the route's title collapses to 16 px, and **End ride** moves left, to x = 125–216, but stays visible and works. The retry ended the ride and cleared the stored session, and focus returned to **End ride** in every run.
     - **The comparison that reads well:** on the paused panel (C-11), the same message wraps under its button, 324 px wide, wholly on screen.
     - **Not established:**
       - how often a clear fails on a phone;
       - anything on the installed iPhone, where nothing was reproduced; a genuine failure is expected, not shown, to render the same way;
       - German free roam and enlarged text, which were not measured.
     - **A candidate, not a decision:** show the failure on its own wrapping line below the header row, leaving **Pause** and **End ride** where they are.
     - **Coordinate with:**
       - [item 134](#item-134), Resume while an End ride is finishing;
       - [item 135](#item-135), focus after a failure, including the plain `focus()` noted there;
       - [item 103](#item-103), control styling;
       - the riding header's existing layout decisions: items 68 and 76, and item 113's `0.4.42` and `0.4.43` header corrections.
     - **Evidence required when implemented:**
       - the synthetic failure in Chromium and WebKit, in English and German, at 100% and 200% root text, on route riding and free roam;
       - the message measured wholly visible, with **Pause** and **End ride** unmoved;
       - a negative control;
       - an installed-iPhone check of an ordinary End ride, since a failure cannot be induced on the phone.

---

<a id="item-140"></a>

## Item 140 — A stale Ride-launcher confirmation clearing a newer session (unscheduled correctness investigation)

_Category: Riding lifecycle_

140. **A stale Ride-launcher confirmation clearing a newer session — unscheduled correctness investigation**
     - Origin: item 124's close-out investigation of 4 October 2026 ([findings](../design/reveal-inventory/closure-reconciliation.md#the-launcher-confirmation-after-a-re-read)), filed by the rider's disposition the same day ([decision 14](history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)). **Filing it here does not mean it is fixed or accepted.**
     - **Unscheduled, and not part of the approved execution order.** This entry assigns no priority and approves no change.
     - **The demonstrated path: two pages in one desktop browser context**, sharing IndexedDB, with ordinary interface steps in each. Chromium and WebKit in the pinned container, English, 6 runs, identical in both engines.
       1. In page A, a route ride was started and paused, **Back to Ride options** taken, and the launcher's **End ride** opened, unconfirmed: "End this ride?", with **Cancel** focused.
       2. In page B, the same route's paused screen was ended and free roam started.
       3. Page A, which does not re-read, still showed "You have an unfinished ride on this route." with its confirmation open.
       4. **Confirming page A's stale confirmation deleted page B's newer free-roam session.** The clear carries no session identity, so it removed whatever was stored. Page B still showed free roam until it was reloaded; then nothing was stored.
     - **Not claimed:**
       - any reproduction in the installed iPhone PWA, which has a single window; this path needs two tabs or windows of the site in a browser;
       - the launcher's re-reads after **Retry** or a failed free-roam write, which need synthetic faults and were **not exercised**.
     - **Present facts, from source (at `ae76f98`):**
       - The launcher (`src/ui/riding/RidingLauncher.tsx`) reads its session once on mount, after **Retry**, and when `sessionRefreshToken` changes, which only a successful **End and switch** does.
       - Dexie's cross-tab broadcast reaches only live queries, which the launcher does not use.
       - The stored session is cleared through one function, `clearActiveRideState()` (`src/storage/rideStateRepository.ts`), which takes no session identity. Its callers are `src/App.tsx`, `src/ui/riding/RidingLauncher.tsx`, `src/ui/riding/useRideNavigation.ts` and `src/ui/riding/useFreeRoamNavigation.ts`.
     - **The safeguard to achieve:** a confirmation must never clear a session other than the one it refers to.
     - **The investigation must consider atomicity, not merely a potentially stale preliminary read.** A fresh read before an unconditional clear still leaves a window between the read and the delete. The candidate to evaluate is a clear conditioned on the session's identity, checked and applied within one IndexedDB read-write transaction, together with what the rider sees when the condition fails.
     - **It must also inventory every caller of the identity-less clear** — the launcher's **Discard** among them — and establish which share the hazard.
     - **Coordinate with:**
       - [item 119](history/items-118-131.md#item-119)'s switch guard, which protects **Resume** comparably; it is precedent, not a fix here;
       - [item 134](#item-134), an End ride still finishing;
       - [item 135](#item-135), focus after **End and switch**;
       - item 124's C-09, whose accepted flow is to be verified again if the launcher's shared code changes.
     - **Evidence required when resolved:**
       - a two-page browser test in Chromium and WebKit reproducing the path above, with the stored session read before and after;
       - a negative control showing that the identity check is what prevents the deletion;
       - a synthetic-fault test for any re-read path changed;
       - an installed-iPhone check of the launcher's ordinary End ride and Discard, since the two-window path itself cannot be reached there.
