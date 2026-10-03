# Planning backlog — full pending item specifications

This file holds the complete, byte-preserved specification for every backlog item that is **approved future work but not yet implemented**, plus the two items that are explicitly monitored/investigated-but-unconfirmed (see [current-status.md](current-status.md) instead for those two — items 32 and 66).

Item numbers are stable identifiers across this project's entire documentation set — they never change regardless of which file an item's text lives in. See [README.md](README.md) for the full map of where everything lives, and the root [`CLAUDE.md`](../../CLAUDE.md) for durable product/engineering rules and the required reading order before implementing any item here.

Items 11, 12, 16, 28, 59, 60 and 61 below remain approved future work, not yet scheduled into the sequence. Items 87–92 were added by the [release-readiness audit](release-readiness-audit.md) (item 86); items 87–92 have since been completed. Items 107–113 were added by the installed-iPhone field test of 10 September 2026 (see [current-status.md](current-status.md) for the dated evidence) and were all scheduled ahead of items 102 and 103, which keep their numbers; the authoritative execution order lives in the root [`CLAUDE.md`](../../CLAUDE.md)'s queue index and is deliberately not duplicated here. All seven items of that group, 107–113, have since been completed and their full specifications have moved to [`history/`](history/README.md). Item 114 was added on 11 September 2026 from item 109's own Chromium verification work rather than from that field test, and has since been completed (`0.4.45`) and moved to [`history/`](history/README.md). Item 117 was added on 13 September 2026 from the installed-iPhone session that accepted item 112, which rejected the opaque route identifier that session's `Active session` row exposed, and has since been completed and moved to [`history/`](history/README.md). Item 118 was added on 13 September 2026 from a second installed-iPhone report the same day and has since been completed and moved to [`history/`](history/README.md); item 119 was added from the repository investigation that established item 118's ownership, and has since been completed (`0.4.47`) and moved to [`history/`](history/README.md). Item 121 was recorded on 25 September 2026, placed first in the execution order, and has since been completed (`0.4.44`) and moved to [`history/`](history/README.md). Item 128 was recorded on 29 September 2026 from item 114's own measurements; it and item 124 were unscheduled until 30 September 2026, when the rider placed both in the approved execution order ahead of items 103 and 120. Item 128 has since been completed (`0.4.50`, the rider's C6 layout) and moved to [`history/`](history/items-118-131.md#item-128). Item 122 was scheduled on 1 October 2026, after item 124 and before items 103 and 120, for its investigation and design stage only. Item 123 was promoted to the front of the approved execution order on 29 September 2026 and has since been completed (`0.4.46`) and moved to [`history/`](history/README.md); item 129 was recorded that day from the installed-iPhone check of `0.4.45` and is unscheduled. Item 130 was recorded on 30 September 2026 from an end-to-end test flake measured during item 119's `0.4.48` follow-up, and is unscheduled. Item 102 was completed on 30 September 2026 (`0.4.49`) and moved to [`history/`](history/README.md). Item 132 was recorded on 2 October 2026, from the rider's approval of one paused-route screen after a cold start, and placed first in the approved execution order, ahead of item 124's remaining approved slices. Later the same day, the rider approved policies for item 124's inventory cases D-06, D-02, D-01 and C-12 and placed item 124's D-06 repair ahead of item 132, which was then second. That repair shipped in `0.4.54`, returning item 132 to first, and its ordinary flow was accepted on the installed iPhone the same day. Item 133 was then recorded on 2 October 2026, a bounded CI-infrastructure change from two end-to-end shards to four, and placed first, ahead of item 132. It has since been configured for four shards, verified in CI run 37055399688, and moved to [`history/`](history/items-132-NN.md#item-133). Item 132 then shipped in `0.4.55`, also on 2 October 2026, and moved to [`history/`](history/items-132-NN.md#item-132); it was accepted on the installed iPhone in English and German, reported the same day, and item 124's remaining approved slices are first in the order, starting with slice 5, D-01. Slice 5 shipped in `0.4.56` on 3 October 2026, and its ordinary flow was accepted on the installed iPhone in English and German, reported the same day; D-02's investigation and planning stage is next. D-02 was investigated and planned the same day, with nothing implemented ([report](../design/reveal-inventory/d-02-delete-lifecycle.md)); its implementation, with the rider's option A for a failure hidden by a filter, shipped in `0.4.57` as item 124's slice 6, also on 3 October 2026, and its ordinary flow was accepted on the installed iPhone in English and German, reported the same day. The rider also approved the common opening and cancellation policy for item 124's C-07, C-08, C-10, C-11 and C-13 that day and reported C-09's missing-route variant on the device; C-12's opening reveal, slice 7, is next.

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

---

<a id="item-124"></a>

## Item 124 — One reveal rule for confirmations and expanding panels

_Category: Interface and accessibility consistency_

> **Staged delivery — slice 1 shipped (`0.4.51`) and accepted on the installed iPhone; slice 2's inventory is complete; slice 3, the two inventory cases the rider approved, shipped in `0.4.52` and was accepted on the installed iPhone, reported 2 October 2026. A separate pause/resume repair, [item 131](history/items-118-131.md#item-131), was scheduled ahead of further item 124 work and shipped in `0.4.53` and was accepted on the installed iPhone, reported 2 October 2026.**
> **Item 132, filed on 2 October 2026, now precedes item 124's remaining approved slices.** The same day's C-12 device observation and the review preparation of D-01, D-02 and D-06 approve nothing further.
> **Later on 2 October 2026 the rider approved policies for D-06, D-02, D-01 and C-12, and placed the D-06 repair first, ahead of item 132** ([decisions below](#decisions-recorded-on-2-october-2026)). These are product decisions, not device acceptance; nothing about them is implemented yet.
> **Slice 4, the D-06 repair, shipped in `0.4.54` on 2 October 2026, and its ordinary flow was accepted on the installed iPhone in German and English, reported the same day; its pending-write and failure cases have automated evidence only.** Item 132 was first again until [item 133](history/items-132-NN.md#item-133), a CI-infrastructure change, was placed ahead of it later that day; with item 133 configured, item 132 was first again, and it shipped in `0.4.55` the same day ([history](history/items-132-NN.md#item-132)). This item's remaining approved slices — D-01, D-02 and C-12's opening reveal — are now first in the order.
> **Item 132 was accepted on the installed iPhone, reported 2 October 2026. The next slice is slice 5, D-01 only**; D-02 and C-12's opening reveal remain approved later work.
> **Slice 5, D-01, shipped in `0.4.56` on 3 October 2026**; its failure, delayed-completion and retry cases have synthetic, automated evidence only, and its ordinary-flow device check is pending. D-02 and C-12's opening reveal are next, approved and not started.
> **Slice 5's ordinary flow was accepted on the installed iPhone in English and German, reported 3 October 2026** (`0.4.56`, build `439e578`). **The next slice is D-02's investigation and planning stage, with no implementation**; C-12's opening reveal remains approved later work.
> **D-02 was investigated and planned on 3 October 2026, with nothing implemented** ([report](../design/reveal-inventory/d-02-delete-lifecycle.md); [summary below](#d-02--investigated-and-planned-3-october-2026-not-implemented)). Its implementation is the next slice, after the rider's review of the plan and one decision.
> **The rider approved D-02's implementation and chose option A, reported 3 October 2026, and slice 6, D-02, shipped in `0.4.57` the same day** ([record below](#slice-6--delete-route-pending-and-failing-d-02-shipped-0457-3-october-2026)); its pending, failure and enlarged-text cases have synthetic, automated evidence only, and its ordinary-flow device check is pending. C-12's opening reveal remains approved later work.
> **Slice 6's ordinary flow was accepted on the installed iPhone in English and German, reported 3 October 2026** (`0.4.57`, build `bd688d7`; CI run 37116791859 is recorded with it). **The same day the rider approved the common opening and cancellation policy for C-07, C-08, C-10, C-11 and C-13 and reported C-09's missing-route variant on the device** ([decisions below](#decisions-recorded-on-3-october-2026)). **The next slice is slice 7, C-12's opening reveal**, the only implementation selected.
> **Slice 7, C-12's opening reveal, shipped in `0.4.58` on 3 October 2026; its ordinary-flow device check is pending.** Its record is the first in [`backlog-item-124-continued.md`](backlog-item-124-continued.md), split from this file for size ([pointer below](#slice-7--edit-copys-replacement-confirmation-opening-c-12-shipped-0458-3-october-2026)). Its enlarged-text, oversized and reappearing-confirmation cases have automated evidence only.
> **Slice 7's ordinary flow was accepted on the installed iPhone in English and German, reported 3 October 2026** (`0.4.58`, build `7e46daf`; CI run 37133035503 is recorded with it in the [continuation](backlog-item-124-continued.md)). Item 124 stays active for the five-surface review and the remaining inventory dispositions.
> This item ships in slices and stays **pending** here until its final
> slice. Nothing about it enters [`history/`](history/README.md) before
> then. The original specification, under its own heading below, is kept
> exactly as scheduled on 30 September 2026; everything above it records
> what has since been decided and shipped.
>
> | Slice     | Content                                                                                                                                                                                          | Status                                                                                                                                                            |
> | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 1         | Planning's **Clear draft** and a Routes card's **Delete route** confirmations: the reveal rule on opening and the approved cancellation rule                                                     | **Shipped — `0.4.51`** (1 October 2026); **accepted on the installed iPhone**, reported 1 October 2026 ([`current-status.md`](current-status.md))                 |
> | 2         | Inventory and review of every confirmation surface and every candidate expanding card or panel. **No behaviour change**; ends at the rider's own review                                          | **Completed inventory** ([inventory](../design/reveal-inventory/README.md)); C-14 and D-03 approved on 1 October 2026, every other case awaits the rider's review |
> | 3         | Planning's **Save** separated from **Open saved route**, whose switch confirmation follows the rule beneath it (C-14); an unconfirmed **Delete** dismissed when filtering hides its route (D-03) | **Shipped — `0.4.52`** (1 October 2026); **accepted on the installed iPhone**, reported 2 October 2026 ([`current-status.md`](current-status.md))                 |
> | 4         | **D-06**: Edit copy's working state, refused cancellation while the confirmed replacement runs, completion that respects the rider's navigation, and guarded failure focus                       | **Shipped — `0.4.54`** (2 October 2026); **ordinary flow accepted on the installed iPhone**, reported 2 October 2026 ([`current-status.md`](current-status.md))   |
> | 5         | **D-01**: a failing Clear draft — the message kept in its area, focus and a minimum reveal only while the rider is still waiting, and the rider's activity preserved once they have moved on     | **Shipped — `0.4.56`** (3 October 2026); **ordinary flow accepted on the installed iPhone**, reported 3 October 2026 ([`current-status.md`](current-status.md))   |
> | 6         | **D-02**: a confirmed Delete route kept as "Deleting…" until storage and the list agree, owned by App across navigation; the translated failure; focus and a minimum reveal only while waiting   | **Shipped — `0.4.57`** (3 October 2026); **ordinary flow accepted on the installed iPhone**, reported 3 October 2026 ([`current-status.md`](current-status.md))   |
> | 7         | **C-12**: Edit copy's replacement confirmation opening under the common rule (decision 7, 2 October 2026), its ordinary-text opening preserved                                                   | **Shipped — `0.4.58`** (3 October 2026); **ordinary flow accepted on the installed iPhone**, reported 3 October 2026 ([`current-status.md`](current-status.md))   |
> | Remaining | **Approved policies:** common opening and cancellation policy for C-07, C-08, C-10, C-11 and C-13 (3 October 2026). **Device observations:** C-09; unreachable lower positions on those five     | **Implementation still to be selected:** corrections only where measurements show a mismatch; other entries need review or disposition before closure             |

### Decisions recorded on 1 October 2026

- **Initial scope:** Planning → **Clear draft** and Routes → an individual route card's **Delete route** only. No other confirmation card, disclosure or expanding panel changes in slice 1, and "pop-up card" does not authorise making inline content modal or adding focus traps.
- **Opening rule**, as specified below: no movement when the newly opened confirmation fits the usable viewport — below the sticky navigation, above the visual viewport's bottom less the safe-area inset; otherwise only enough to reveal it; and when it cannot fit at all, only enough to show its complete Cancel/Confirm row, the explanation staying reachable by scrolling. Instant, once per opening, re-measured on reopening; initial focus on Cancel; item 119's named, described, non-modal dialog semantics unchanged.
- **Cancellation rule**, the rider's approval of the recommendation, for Cancel and Escape alike: **keep the resulting page position**, with only the minimum adjustment needed to reveal the opening control when focus returns to it, below the sticky header and above the bottom safe area. Scrolling the rider did while the confirmation was open is respected, and **the position saved before opening is never restored**. A document that shortens as the confirmation collapses is allowed for rather than an impossible unchanged position demanded.
- **Corrections required by the rider before implementation:** on cancelling, reveal the opening **button itself**, never its containing row, and keep any reveal policy for a failure message separate; guard the corrective scroll, not only a deferred focus, against focus having moved elsewhere; for an oversized confirmation, move **not at all** when its complete action row is already inside the usable band; treat opening while the software keyboard closes as unverified until checked on the iPhone, never as an accepted trade borrowed from item 118; and claim from the frame recorder only stability across the frames it sampled.
- **A separate inventory slice (slice 2) precedes any broader unification**, and the rider confirms its scope manually: automated checks do not replace that confirmation.
- **The outer execution order is unchanged:** item 124's agreed slices, then item 122's investigation and design stage, then items 103 and 120.

### Decisions recorded on 2 October 2026

- **The rider approved policies for four inventory cases** — D-06 (Edit copy), D-02 (Delete route fails), D-01 (Clear draft fails) and C-12's enlarged-text opening — answering the review preparation's nine questions. The decisions are recorded once, in detail, in the inventory's [decisions section](../design/reveal-inventory/README.md#decisions--d-06-d-02-d-01-and-c-12-2-october-2026). They are product decisions authorising later work, **not device acceptance** of any implementation.
- **Execution order:** the D-06 repair within this item first, then [item 132](history/items-132-NN.md#item-132), then this item's remaining approved slices (D-01, D-02 and C-12's opening reveal), then item 122's design stage, item 103 and item 120. The authoritative list is in the root [`CLAUDE.md`](../../CLAUDE.md).
- **Why D-06 goes first:** an available Cancel currently closes Edit copy's replacement confirmation while the confirmed draft replacement continues, and its completion can override the rider's subsequent navigation.
- **Not blanket approval:** every other inventory case still awaits the rider's review, and no other confirmation or expanding panel is approved for a behaviour change.

### Decisions recorded on 3 October 2026

- **D-02's implementation and option A**, for a failure the rider's own filter hides: recorded with [slice 6](#slice-6--delete-route-pending-and-failing-d-02-shipped-0457-3-october-2026) and as decision 8 in the inventory.
- **The common opening and cancellation policy for C-07, C-08, C-10, C-11 and C-13.** Their placements and existing ride semantics are kept under the common opening and cancellation behaviour, with targeted corrections only where current checks or enlarged-text measurements demonstrate a mismatch. The rider's exact words and the behaviour approved are recorded once, in the inventory's [decisions and observations](../design/reveal-inventory/README.md#decisions-and-observations--c-07-to-c-13-3-october-2026). This is a product decision, **not device acceptance**, and it selects no implementation: which corrections, if any, are needed is still to be measured and selected.
- **Device observations**, recorded in [`current-status.md`](current-status.md): for those five surfaces, a lower opening position could not be reached on the installed iPhone — not a report that every check passed, and with no version, build or language attached; and C-09's missing-route variant, checked on `0.4.57` (build `bd688d7`) in English and German, with no policy decision for C-09.
- **The next slice is slice 7, C-12's opening reveal**, the only implementation selected. Item 124 then stays active: implementation under the five-surface policy is still to be selected, and every inventory entry not yet reviewed needs an explicit review or disposition before the item closes.

### Slice 1 — Clear draft and Delete route (shipped `0.4.51`, 1 October 2026)

**Mechanism.**

- **Shared geometry, moved and opted into.** `confirmationRevealScroll.ts` moved from `src/ui/settings/` to `src/ui/shared/`, with its test; the path the original specification names below is its old location. Its fit branch is unchanged. It gained one opt-in argument, the action row: only for a confirmation that cannot fit, the page moves just far enough to make that row complete, and **not at all** when it already is. Settings passes no row, and keeps item 118's accepted native `autoFocus`, residual correction and bottom-anchoring exactly.
- **Opening.** Cancel takes focus with `preventScroll` — `ConfirmDialog`'s new opt-in `focusCancelWithoutScroll` for Clear draft, and directly in the route card for Delete route — and one deliberate, instant reveal follows, in a `useLayoutEffect` keyed on the primitive open boolean, so no other render repeats it, Planning's once-a-second `useNow` tick included. The browser's own focus scroll is not used, because in desktop Chromium and WebKit it centres Cancel and moves the page further than the rule allows. `ConfirmDialog` also gained an opt-in `actionsRef`; neither new prop changes any other caller's markup or behaviour.
- **Cancel and Escape.** Focus returns to the opening button without scrolling, and the page then moves only as far as reveals that button, measured after the collapse has committed, and **only while focus is still where the cancellation put it**. Delete stays mounted, so focus moves to it before the focused Cancel is destroyed. Clear draft's button is unmounted while its confirmation is open, so focus waits on the routing disclosure's `<summary>` — a park, after item 106's finding that a focused control destroyed mid-event drops focus to `<body>` — and the button is revealed in the very commit that remounts it, **once**, even when focus itself must wait for the button to be re-enabled after a Save in flight; a later render can never repeat it, and the deferred focus is dropped as soon as the rider moves focus. Clear draft's failure path keeps its plain focus once the button is re-enabled, with no park and no reveal; the one difference is that it now runs in the same layout effect, before paint rather than after it.
- **Planning** receives the sticky header's ref as one added prop in `App.tsx`, the same ref Routes and Settings already receive.
- **Files:** `src/ui/shared/confirmationRevealScroll.ts` (moved), `src/ui/shared/ConfirmDialog.tsx`, `src/ui/planning/PlanningScreen.tsx`, `src/ui/library/RouteListItem.tsx`, `src/ui/settings/SettingsScreen.tsx` (import path only), `src/App.tsx` (one prop), `src/index.css` (two comments that would otherwise have become false; no rule changes); tests listed below.

**Evidence — automated only.**

- **Unit and component:** 5 new cases for the shared geometry (the existing 11, which pin Settings' behaviour, unchanged), 2 for `ConfirmDialog`, 12 for Clear draft and 10 for Delete route — opening, no repeat on an unrelated render, re-measuring on reopening, Cancel and Escape, the guarded correction, the once-only correction while focus waits, and the unchanged failure path.
- **Browser, in the pinned container:** `e2e/confirmationReveal.smoke.spec.ts`, 14 tests in each of Chromium and WebKit, at 390×844 portrait: each surface in English and German at ordinary and 200% root text, with geometry before opening, while open and after closing; an oversized confirmation; scrolling by hand while open; and opening from the focused route-name field. `e2e/confirmationRevealSettled.spec.ts`, Chromium only: the frame recorder at ordinary speed and under a 20× CPU throttle, and a render caused by another tab renaming a different route. Every assertion is made against the band measured in the page, and no confirmation is opened through Playwright's actionability scroll. 99 of 99 passed across three repeats.
- **Which branch each combination took.** At ordinary text, in both languages, both confirmations fit where they open with no movement, and a reveal from the band's bottom is exactly one minimal scroll. At 200% text, English behaves the same. German at 200% does not: Delete route fits the band but never fits below its button, so the minimal reveal is the correct outcome (86 px in Chromium, 98 px in WebKit); and Clear draft is taller than the band at 390×844 even without any synthetic inset, so its action row is what is revealed — the oversized branch is reached naturally, not only under synthetic insets.
- **Baseline, `e244549`:** all 28 cross-engine tests fail in both engines. In every case where a confirmation did not fit where it opened, the browser's own focus scroll moved the page 484–921 px to centre Cancel where the rule allows only the minimum, and for Delete route in German at 200% it left the action row outside the band. Where a confirmation fitted where it opened, the baseline did not move. The five Chromium-only tests pass on the baseline: they are regression guards, not discriminating tests.
- **Negative controls**, each applied alone, run in both engines and restored byte-for-byte (checked with `cmp` and SHA-256):

| Control | What it disables                                            | Unit tests failed (of 165) | Browser tests failed (of 33)                                                                                                                                                      |
| ------- | ----------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a)     | the opening reveal, keeping `preventScroll`                 | 6                          | 30 — every opening that needs a reveal, in both engines; the two throttled recorder samples fail too, only because Playwright's own scroll to reach Cancel then moved the actions |
| (b)     | the button reveal on Cancel/Escape                          | 5                          | 12 — every case that would leave the button hidden, in both engines                                                                                                               |
| (c)     | `preventScroll`, replaced by plain focus                    | 10                         | 14 in Chromium (the page moved 484–998 px); **none in WebKit**, so it does not discriminate there                                                                                 |
| (d)     | Clear draft's focus park (guard relaxed to accept `<body>`) | 5                          | **none in either engine**: no focused-removal jump was measured, so the park is not shown load-bearing for geometry; it is kept because the cancellation guard keys on it         |
| (e)     | the action row, restoring item 118's bottom-anchoring       | 2                          | 6 — the three oversized cases in each engine, over-scrolling by the confirmation's own padding below the row                                                                      |
| (f)     | the focus-moved guard on the corrective scroll              | 2                          | **none**: the case cannot be reached by ordinary browser interaction, and is proved at unit level only                                                                            |

**Findings worth carrying forward.**

- **The rider's observation was not reproduced in desktop engines, and no cause is claimed.** On the unchanged build both desktop engines _did_ bring each confirmation into view — by over-shooting — which is a different failure from the iPhone's "stayed out of view".
- **Scroll anchoring can move the page with no scroll call.** With a button placed above the viewport — reachable by neither tap nor Tab — opening Clear draft moved the page 644 px in Chromium with no deliberate scroll: the browser's own scroll anchoring compensating for content that grew above its anchor. Every reachable position keeps the button inside the viewport, where this does not arise; no `overflow-anchor` change was made, and it is recorded for slice 2.
- **Correction, 1 October 2026 (slice 2).** The finding above is kept as recorded, but its "reachable by neither tap nor Tab" is wrong: a rider can focus the button — the app itself returns focus to it after Cancel or Escape — scroll it above the viewport and press Enter or Space. Slice 2 measured exactly that in both engines: the browser's scroll anchoring moves the page first, and the reveal then brings the confirmation, complete, to the band's top ([D-04](../design/reveal-inventory/README.md#d-04--activating-clear-draft-or-delete-while-the-button-is-above-the-viewport)).
- **For a route card, the "oversized but its whole action row already shows" case is narrow.** Delete sits 94 px above its confirmation at 200% text, so with the button still inside the viewport the case exists only when the confirmation exceeds the band by a few pixels. The test sizes a synthetic inset from the measured height so that it does, and there item 118's bottom-anchoring would have moved the page 24 px where the rule moves none; for Clear draft the same case differs by about 69 px.
- **The `preventScroll` control discriminates in Chromium but not in WebKit.** WebKit's own focus reveal appears to be satisfied by the deliberate reveal that has already happened, so replacing `preventScroll` changed nothing measurable there.

**Limitations, stated plainly.**

- **Opening while the software keyboard closes is unverified.** Desktop engines have no software keyboard; the browser tests prove only the hand-off from the focused route-name field (it blurs, Cancel takes focus, the reveal is minimal, the name is kept). The reveal measures the band as it is when the confirmation opens. On the installed iPhone this path **passed** (reported 1 October 2026; the dated record in [`current-status.md`](current-status.md)).
- **The frame recorder shows only that the actions did not move by more than 1 px across the frames it sampled.** It proves neither pre-paint ordering nor anything about layout versus passive effects: item 118's negative control for exactly that did not discriminate at 20× or 50×, and that finding stands.
- Browser root-text scaling is not iOS Larger Text, and the synthetic safe-area insets are not physical-device evidence. No VoiceOver, landscape or physical-Android result is claimed.
- **Not decided here, and listed for slice 2:** a reveal policy for Clear draft's failure message; Delete route's confirmation growing when a delete fails, which is not revealed again because only an opening reveals; and a route card remounting while its delete is pending — for example a search that hides it and then shows it again — which takes focus to Cancel and reveals it as on opening, much as the former `autoFocus` already took focus. Slice 2 inventories these as [D-01, D-02 and D-03](../design/reveal-inventory/README.md#conditional-and-failure-states-d-01-to-d-07), with their reachability established.

**Installed-iPhone acceptance, reported 1 October 2026.** All six device checks passed on `0.4.51` (build `04639cb`), in portrait at ordinary text size, the keyboard-open path included. This accepts slice 1 only; the dated record, with what it does not claim, is in [`current-status.md`](current-status.md).

### Slice 2 — inventory and review (completed 1 October 2026; awaiting the rider's review)

**The inventory:** [`docs/design/reveal-inventory/README.md`](../design/reveal-inventory/README.md) — 14 confirmations, 35 expanding cards, forms, editors and disclosures, and 7 conditional and failure states, each with a stable ID, its labels in English and German, reproduction steps, current behaviour, source and tests, measured evidence where needed, and a recommendation, ending in a numbered review checklist. No application behaviour changed, and no additional surfaces are approved for behaviour changes until the rider confirms them.

**Review preparation, 2 October 2026:** D-01, D-02 and D-06 were rechecked against `64bde8d` and measured with controlled synthetic fixtures, with C-12 as context. The findings, recommendations and the decisions they need are in the inventory's [review preparation](../design/reveal-inventory/README.md#review-preparation--d-01-d-02-and-d-06-2-october-2026). Nothing is approved by it; the C-12 device observation is in [`current-status.md`](current-status.md).

**Purpose:** establish, before any broader unification, every surface that could fall under "one reveal rule", so the rider can confirm which of them should adopt it. **Slice 2 changes no behaviour**, and it ends at the rider's explicit review: automated checks do not replace that confirmation, and only a later slice may extend the behaviour, to the surfaces the rider approves.

- **Find every confirmation surface**, including every `ConfirmDialog` caller and every hand-written confirmation — at least the route card's Delete route and item 95's route-switch prompt, the tag manager's Merge and Delete, Settings' Delete key, the Ride launcher's End/Discard confirmation, the paused Riding panel's End confirmation, Riding's Edit copy confirmation, free roam's own confirmation, and the page-level ride-switch dialog — and list **each distinct surface separately**, even where several share a component.
- **Catalogue, as separate candidates,** the expanding cards and panels that could reasonably fall under the rider's "pop-up cards" request — for example Settings' and Status's disclosures, Settings' Replace-key form, Planning's routing options, the route card's rename and tag editors, the tag manager panel — and anything else the search finds.
- **For each entry:** a stable review ID; the screen; the visible label, in English and German; exact reproduction steps; its purpose; its current opening, reveal, focus and cancellation behaviour, from source and, where it matters, a measurement; the relevant tests; and a proposed scope.
- **Identify accepted behaviour that must stay protected**, above all item 95's route-switch prompt and item 118's Settings confirmation, and items 105 and 106's tag-editor flows.
- **Mark conditional, difficult-to-reach or apparently unreachable branches** as such, without inventing reproduction steps for them — slice 1's own examples are listed under its limitations above.
- **Produce a numbered manual checklist** with which the rider confirms, surface by surface, which should adopt the common rule.
- **Output:** a review document in `docs/design/reveal-inventory/README.md`, following items 102 and 128's design-stage precedent, with one pointer line here.

### Slice 3 — Planning's Save and Open saved route (C-14), and a hidden Delete dismissed (D-03) (shipped `0.4.52`, 1 October 2026)

**Approved by the rider on 1 October 2026, from the slice 2 inventory — these two cases only.**

- **C-14, Planning's entry path.** **Save route** saves, shows a clear success message in the save area and stays in Planning; saving alone requests no ride transition. A separate **Open saved route** beside that message opens the saved route through the existing ride-transition guard. If another ride is unfinished, the switch confirmation appears directly beneath that action under item 124's rule — no movement when it fits; otherwise the instant minimum; when oversized, only its action row, and no movement when that row already shows; Cancel focused without the browser's own focus scroll — and Cancel and Escape keep the original ride and the page position, with only the minimum adjustment to reveal the opening control, respecting the rider's manual scrolling. Item 119's named, described, non-modal dialog semantics are kept. Saving must leave a stored unfinished ride unchanged; the action refers to the saved route, never to a later draft; opening is not an instruction to start tracking.
- **D-03.** When the search or a tag filter removes a route from the visible list, its **unconfirmed** Delete confirmation is dismissed and stays closed when the route returns. Searching continues with no focus taken, no keyboard closed and no deliberate scroll. A deletion already executing continues normally. Sorting or pinning a visible route does not dismiss it, and reopening Delete keeps slice 1's behaviour.
- **Corrections required by the rider before implementation:** prove the saved message actually on screen by geometry, in English and German at ordinary and 200% text, with a minimal reveal where needed; keep a failed **confirmed** deletion outside D-03, with its error preserved; when Planning has no anchor for a prompt, respect the request's identity and the actual in-flight guard, so a stale callback can never withdraw a newer request, even one for the same route; give Cancel a stable fallback in the save area when the saved message is about to disappear, with no keyboard activation and no unnecessary scrolling; keep the message's reveal guard attached until the reveal is consumed or abandoned, not merely until the save settles.
- **Not changed:** every other inventory case, including D-01 and D-02's failure presentation and D-06's Edit copy; item 95's inline route-card prompt; the other entry paths to C-14's page-level dialog.
- **The device evidence behind both cases** — Planning's switch confirmation found only by scrolling up, and the Delete confirmation reappearing with the keyboard gone — is the dated observation in [`current-status.md`](current-status.md), reported 1 October 2026 without a build or language.

**Mechanism.**

- **Save only saves.** `PlanningScreen`'s `handleSave` keeps its guards, its Save-versus-autosave protection and its provenance exactly; on success it now stores the saved route in **local, never-persisted** state instead of calling App. That state's lifecycle is deliberately narrow: set by a successful save and replaced by the next; cleared when a new draft begins (its first waypoint, or a name edited away from the reset default) or after a successful Clear draft; **never cleared while the switch prompt for that saved route is open**, so the anchor of a switch the rider may already have authorised cannot vanish under it — the clearing happens once the prompt closes; and gone when Planning is left.
- **The saved message is revealed once, by the minimum.** It appears beneath Save, which may have been near the bottom of the screen, so a layout effect brings it into the band once — none when it already fits. Save arms that reveal; any newer `wheel`, `touchstart`, `pointerdown` or `keydown` disarms it, through a listener that stays attached until the reveal is consumed or abandoned (a failed save, a newer save, or unmount).
- **Open saved route** passes App the exact saved route object. App sends it through `requestRouteTransition` with a new `"planning"` origin and no resume intent, so request identity, supersession, storage-mutation ordering, the busy and failure statuses and the riding-start withdrawal are all the existing guard's. With nothing unfinished it opens the route's pre-ride screen, from the top, with no location watch.
- **The confirmation beneath it.** While Planning is the current screen, App hands the pending prompt to Planning, which renders it with `ConfirmDialog` directly after the saved message — `headingLevel={3}`, Cancel focused with `preventScroll`, `confirmDisabled`/`cancelDisabled` while busy — and reveals it under slice 1's rule, in a layout effect keyed on whether it is shown. The copy is the existing generic switch copy, unchanged. Cancel and Escape, ignored while busy, move focus without scrolling **before** the prompt closes — to Open saved route, or, when a new draft began while it was open (so closing it also clears the message and its button), to the save area's own heading, focusable by script only (`tabIndex={-1}`, Settings' item 118 precedent) and never activated. After the collapse, the page moves only as far as reveals that target, and only while it still has focus. App returns no focus of its own for this origin.
- **Leaving Planning while it is open.** Off Planning, the pending prompt falls back to the existing page-level dialog above `<main>`, as a route card's has since item 73's follow-up. Back on Planning — remounted, with no saved message to sit beneath — Planning reports the missing anchor with the prompt's own request id, and App decides: a report for anything but the current request is ignored; while an action of it is in flight (clearing, a held Retry read, a free-roam write) the request is marked anchorless and stays represented by the page-level dialog, whose outcome — success opening the saved route, or failure with its copy and Try again — is the rider's authorised one; an idle prompt is withdrawn, its request id first advanced so that no late continuation can act for it.
- **D-03, in `RouteLibrary`.** One adjustment during rendering, beside the existing switch-prompt one, reads the actual search- and tag-filtered list: a pending Delete is dismissed only when it is unconfirmed (no deletion running, no failure recorded), the routes have loaded, and its route is absent from that list. React re-renders before committing, so no committed render ever shows a hidden card still pending, the card never sees a pending-to-closed transition, and nothing is focused or scrolled. Sorting and pinning only reorder that list, so they never dismiss.
- **Copy and styles.** Two new keys, `planning.save.saved` (`“{name}” is saved in Routes.` / `„{name}“ ist unter „Routen“ gespeichert.`) and `planning.save.openSaved` (`Open saved route` / `Gespeicherte Route öffnen`); two CSS rules, a wrapping message beside the button and the confirmation's heading margin inside Planning.
- **Files:** `src/ui/planning/PlanningScreen.tsx`, `src/App.tsx`, `src/ui/library/RouteLibrary.tsx`, `src/ui/library/RouteListItem.tsx` (comment only), `src/i18n/messages.en.ts`, `src/i18n/messages.de.ts`, `src/index.css`, four further comments that named the old Save path, and the tests below.

**Evidence — automated only.**

- **Unit and component (4,751 passing in 204 files):** `PlanningScreen.savedRoute.test.tsx` (new, 22) — Save only saving, the exact route opened, the message's lifecycle, the deferred clearing while a prompt is open, the anchor report, the message reveal and its guard and listener cleanup, the prompt's placement, focus, single reveal, oversized row, Cancel and Escape corrections, busy, and the heading fallback; `App.planningSavedRoute.test.tsx` (new, 11, with Planning stubbed) — inline, never page-level; the pre-ride path; free roam; the page-level fallback; idle and in-flight anchor loss, including a held clear succeeding and failing and a held Retry read; and a stale report for the same route ignored; `RouteLibrary.test.tsx` (6 new) — search and tag-filter dismissal keeping focus, sorting and pinning keeping it open, a held deletion continuing, and a confirmed deletion's failure kept, hidden or not. The existing Save assertions were converted to the saved message.
- **Browser, in the pinned container, at 390×844 portrait.** `e2e/planningSavedRoute.smoke.spec.ts` (new, 14 tests in each of Chromium and WebKit): the saved message and the switch confirmation in English and German at ordinary and 200% text, with geometry before, while open and after closing; nothing unfinished; free roam; oversized; a manual wheel scroll; a window tall enough for the whole page; and a new draft begun while open. `e2e/routeDeleteFiltering.smoke.spec.ts` (new, 4 in each engine). `e2e/confirmationRevealSettled.spec.ts` gained the saved-route confirmation's sampled-stability check, at ordinary speed and under a 20× CPU throttle (Chromium). Real input throughout: the mouse at measured centres proved inside the band and topmost, real key presses and a real wheel; the one synthetic step, a native `<select>`'s change, is labelled. Nine existing specs that relied on Save opening the route now open it explicitly, keeping their Save assertions. The full suite passed 735 of 736; the one failure was `mapImageryRecovery.spec.ts`'s route-riding reconnection test, item 130's recorded flake, which then passed 5 of 5 in isolation.
- **Which branch each combination took.** In the phone window, at ordinary text in both languages, the confirmation fits the band but never below the action, so it is revealed by the minimum (258 px in English, 331–335 px in German); at 200% it is taller than the band and only its action row is brought in (876 px in English, 1,052–1,061 px in German). The saved message needed a reveal in Chromium at 200% and in German at ordinary text (172–493 px), and in no combination in WebKit; no cause is claimed for that difference.
- **Baseline, `8d9af84`:** 37 of the 39 selected browser runs fail — every Planning case in both engines, the search and tag-filter dismissals (on the search, the last Backspace reached Cancel and left `V` in the field: the inventoried defect), and the reopen after a return. The two that pass, sorting and pinning in each engine, guard against over-dismissal and are not meant to discriminate.
- **Negative controls**, each applied alone and restored byte-for-byte (SHA-256):

| Control | What it disables                                                       | Unit tests failed | Browser tests failed (Chromium)                                                                                                |
| ------- | ---------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| (a)     | D-03's dismissal                                                       | 2 of 118          | the baseline above stands for it                                                                                               |
| (b)     | the inline prompt (always page-level)                                  | 10 of 11          | not run                                                                                                                        |
| (c)     | Save opening the route again, the old behaviour                        | 4 of 182          | not run; the baseline above stands for it                                                                                      |
| (d)     | App's skip of its own focus return for this origin                     | 1 of 11           | **none**: App would focus the same, already-focused Open saved route, or a disconnected one — so it does not discriminate here |
| (e)     | the confirmation's opening reveal                                      | 2 of 22           | 2 of 2 run                                                                                                                     |
| (f)     | the saved message's reveal                                             | 1 of 22           | 2 of 2 run                                                                                                                     |
| (g)     | D-03's failure term, so a failed confirmed deletion would be dismissed | 2 of 118          | not run: a deletion cannot be made to fail in a browser                                                                        |
| (h)     | anchor-loss handling that withdraws regardless of request and status   | 4 of 11           | not run                                                                                                                        |

**Findings worth carrying forward.**

- **The save area ends the page.** In a phone-sized window, before opening, Open saved route always sits within about one action's height of the window's bottom, so the confirmation always opens below it: "fits without moving" is reachable only in a window taller than the whole page (tested at 390×1800), and the oversized "row already shows" branch not at all in a browser — it is covered with stubbed geometry instead.
- **Chromium's scroll anchoring can do part of a reveal.** When the confirmation reopens straight after a Cancel whose collapse had clamped the page — with no scroll in between — Chromium first restores the earlier position (202 px after a manual wheel, 826 px in the oversized case), and the app's reveal, measuring afterwards, adds only the rest. With `overflow-anchor: none` as a control the app's reveal does the whole distance and the page ends at the **same** position, so the outcome is still the minimal reveal; WebKit showed no such contribution. The browser tests record the browser's share for exactly those openings and keep the strict "only the app moved the page" check everywhere else. No `overflow-anchor` change was made.
- **"Directly beneath" is measured, not assumed:** the save area's 16 px row gap plus the confirmation's own 0.5rem top margin (24 px at ordinary text, 32 px at 200%).

**Limitations, stated plainly.**

- **Desktop engines have no software keyboard**, so the iPhone keyboard staying open during D-03 is not reproduced: the evidence is that focus stays in the search field or on the chip and every keystroke reaches it.
- **A save write cannot be held open in a browser**, so a rider's input during the save (which must cancel the message's reveal) is covered at unit level only, as are a deletion still running when its route is hidden and a confirmed deletion that fails.
- **A failed confirmed deletion is never dismissed by filtering**: hidden, it keeps its confirmation and error, and when its route returns it remounts pending and slice 1's mount effect takes focus to Cancel — today's behaviour for that deferred D-02 state, kept by design. A hidden deletion that succeeds still runs the existing success-path focus move.
- **The saved message is not persisted:** leaving Planning loses it, and the route is then opened from Routes as before.
- **Sampled stability only:** the frame recorder shows the confirmation's actions did not move by more than 1 px across the frames it sampled; it proves nothing about paint ordering.
- Browser root-text scaling is not iOS Larger Text. No VoiceOver, landscape or physical-Android result is claimed.

**Installed-iPhone acceptance, reported 2 October 2026.** All five device checks passed on `0.4.52` (build `68e6697`), in German and English, the search and tag-filter paths both included. This accepts slice 3 only; the dated record, with what it does not claim, is in [`current-status.md`](current-status.md).

### Slice 4 — Edit copy while a copy is being made (D-06) (shipped `0.4.54`, 2 October 2026)

**Approved by the rider on 2 October 2026** — decisions 1 to 3 in the inventory's [decisions section](../design/reveal-inventory/README.md#decisions--d-06-d-02-d-01-and-c-12-2-october-2026) — and placed first in the execution order, ahead of item 132.

**The defect.** Once **Replace and edit** was pressed, Cancel and Escape still closed the confirmation while the draft replacement continued, and its completion then switched the app to Planning even after the rider had left Ride. After a failure, focus was sent to Edit copy while it was still disabled, so it was lost ([review preparation](../design/reveal-inventory/README.md#d-06--edit-copy-with-c-12-as-context)). Rechecking the source before implementation found a consequence the new navigation behaviour depends on, raised by the rider in plan review and reproduced below: a Planning opened while the write was still awaiting its preferences read hydrated the earlier draft, and Planning's 900 ms autosave then wrote it back over the copy.

**Mechanism** (`RidingScreen.tsx`, unless named).

- **Working state.** Replace and edit first moves focus, without scrolling, to the confirmation's own title, which `ConfirmDialog`'s new optional `titleRef` makes focusable by script only. Both actions are then disabled, and the confirm action reads the existing **Creating editable copy… / Kopie zum Bearbeiten wird erstellt…**. Cancel and Escape are refused until the write settles; before confirmation they cancel as before. The existing re-entrancy guard stays.
- **One attempt from the first press.** An attempt begins at the Edit copy press — covering its preliminary draft check and, when there is no meaningful draft, the write — or at Replace and edit. Each attempt owns one interaction guard (`src/ui/riding/editCopyInteractionGuard.ts`, new). A further Edit copy press is refused while an attempt exists, so repeated presses during the check leave no second check behind.
- **Navigation context.** One counter is bumped, in a layout effect's cleanup, whenever the pre-ride/paused panel stops or starts being shown and when the screen unmounts: another tab, Back to Ride options, End ride, a route switch, Start riding. Success navigates to Planning only if the attempt's value still matches. Returning to Ride mounts a new screen with its own counter, so no old permission is revived, and a late result from an old screen changes neither the screen nor focus. The direct path skips the confirmation only because no meaningful draft exists, so it drops its attempt — no confirmation, no write — if the rider has left by the time its check settles.
- **Coordination with Planning.** The preferences the copy needs are now read by the preliminary check, before the confirmation opens, so nothing is awaited between the rider's authorisation and `saveDraft`'s call.
  - Dexie 4.4.5 creates the readwrite transaction synchronously inside that call (`Table._trans` → `tempTransaction` → `trans.create()`).
  - A Planning hydration begun afterwards is a later read-only transaction on the same store, which IndexedDB starts only after the write. Planning's plain `get` is not served by Dexie's liveQuery cache.
  - So Planning shows the copy, or the earlier draft if the write fails — never a draft older than a confirmed replacement — and its autosave rewrites what it shows.
  - No change to Planning, to storage or to App's navigation handler.
- **Failure focus.** The `catch` no longer focuses. A layout effect decides once Edit copy is enabled again:
  - **dropped** if the rider has left the context, if the attempt's guard has seen them move on, or if focus is on anything but `<body>` or Edit copy. The guard is disarmed by a `pointerdown` outside the Edit copy group, any key except Escape inside it, and any `wheel` or `touchmove`;
  - **otherwise** Edit copy is focused with `preventScroll`, and it and its message are revealed by the minimum beneath the sticky navigation (`applyConfirmationReveal`, with Edit copy as the priority when both cannot fit).

  The group is a new `.stack` wrapper with the panel's own gap, so the layout is unchanged, and `RidingScreen` receives the sticky header's ref from `App.tsx`.

- **Discoverability after leaving Ride**, by existing conventions:
  - Plan shows the copy with its existing edit-copy notice.
  - A failure leaves the earlier draft in Plan and the error in Status's redacted log.
  - A failure while the panel was only hidden shows its message beside Edit copy when the panel returns.
- **Changed as a consequence.** A preferences-read failure now shows the existing `riding.editCopyFailed` message before any confirmation opens, rather than after Replace and edit; it is logged as `riding-edit-copy-load-preferences`. A confirmation keeps the preferences read when it opened, which can change only from another tab.
- **Files:**
  - **source:** `src/ui/riding/RidingScreen.tsx`, `src/ui/riding/editCopyInteractionGuard.ts` (new), `src/ui/shared/ConfirmDialog.tsx` (one optional prop), `src/App.tsx` (one prop);
  - **version:** `0.4.54`;
  - **tests:** below.

**Reproduction first, on the unchanged `0.4.53` build, in both engines.** In English and German, every variant leaves Planning on the earlier draft:

| Sequence                                                                                                                 | Stored afterwards                                          | What Planning shows                                |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------- |
| Open the confirmation, hold the preferences store, Replace and edit, open Plan; release before Planning's first autosave | the earlier draft — the copy was written, then overwritten | the earlier draft                                  |
| The same, released after that autosave                                                                                   | the copy                                                   | the earlier draft, so display and storage disagree |
| Released, the copy stored, then a waypoint added in Plan                                                                 | the earlier draft plus the waypoint                        | the earlier draft                                  |

With the write itself held instead — issued before Planning mounted — the unchanged build already ordered Planning's read after it in both engines, which is the guarantee the repair relies on.

**Evidence — automated only.**

- **Unit and component.** All 4,795 tests in 206 files pass. New: 20 in `RidingScreen.test.tsx` (D-06), 8 in `editCopyInteractionGuard.test.ts` and 2 in `ConfirmDialog.test.tsx`. They cover:
  - the busy state, the parked title and refused Cancel and Escape;
  - the write issued within the press;
  - navigation in context, under Strict Mode, after unmount, after Start riding and after a remount;
  - one check and one write for repeated presses, and no write when either read settles after unmount;
  - the preferences failure;
  - focus restored with `preventScroll` once Edit copy is enabled, with a reveal;
  - no focus and no reveal after each kind of moving on, including a wheel during the preliminary check;
  - focus still restored after a press on the disabled Cancel or a refused Escape;
  - every guard detached, however an attempt ends.
- **Browser, in the pinned container, at 390×844 portrait.** `e2e/editCopyBusyState.smoke.spec.ts` (new): 24 tests in each of Chromium and WebKit, in English and German where copy or layout matters, and at 200% root text for the working label's containment and the failure reveal.
  - **Controlled fixtures, all synthetic:** an IndexedDB hold on the draft or preferences store, an abort of the queued write, and an immediate `put` fault. They are always released, and a held store is never read.
  - **Input:** real pointer, key and wheel. The app's scroll calls and the focus moves made by script are recorded, so a kept position is asserted as "no app scroll call", never as a raw `scrollY`.
  - **Results:** 48 of 48, then 144 of 144 over three repeats, and 96 of 96 over two after the focus recorder was corrected (see the findings).
  - **Regression specs:** `editRouteAsPlanningCopy`, `reverseRoute`, `clearPlanningDraft`, `planning`, `confirmationReveal.smoke`, `ridingPauseAfterResume.smoke`, `rideSessionSwitchGuard`, `ridingLauncher` and `planningSavedRoute.smoke`: 126 of 126. The two Edit copy specs then passed 36 of 36 over three repeats.
  - **The full browser suite, once, at 8 workers:** 791 of 792. The failure was `ridingClimbView.spec.ts`'s item 115 cue-placement test, whose probe found no rider marker painted at the follow anchor during active riding, which this slice does not touch. It passed 10 of 10 alone. Under load, the whole file at three repeats lost 2 of 78 on this build, and also 2 of 78 in one of two runs on the unchanged `0.4.53` build, so it is pre-existing and not attributed here.
- **Baseline, `0.4.53`.** 36 of the 48 browser runs fail in the two engines. The failures are: the working state, in both languages; completion after leaving Ride, and after leaving and returning — the app switched to Planning; the direct path left during its check — the copy was written and the app switched; focus after a failure, left on `<body>`; the 200% failure reveal and working label; and the Planning reproduction above. Twelve pass, six in each engine:
  - the held write committing or failing, and the edit made while Planning is still loading — regression guards for behaviour the baseline already had;
  - the scrolled-away and moved-focus cases — the baseline's failure focus reached a disabled button and did nothing;
  - Chromium's direct-path wheel case, for the same reason;
  - WebKit's direct path with no other input, where focus never left Edit copy.
- **Negative controls**, each applied alone to `RidingScreen.tsx`, rebuilt, and restored byte-for-byte (SHA-256):

| Control | What it disables                                                            | Unit tests failed (of 262) | Browser tests failed (of 48)                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a)     | the context check before navigating                                         | 3                          | 6 — leaving for Routes (English and German) and leaving and returning, both engines                                                                                                                                         |
| (b)     | disabling the confirmation's actions                                        | 1                          | 10 — the working state and the 200% label containment in both languages, and the Tab case, whose focus then left with the confirmation; both engines                                                                        |
| (c)     | refusing Escape                                                             | 2                          | 4 — the working state, both languages and engines                                                                                                                                                                           |
| (d)     | the title park                                                              | 1                          | 4 — the working state: focus not on the title                                                                                                                                                                               |
| (e)     | the deferred failure focus (the synchronous focus reinstated)               | 8                          | 8 — a held failure with no input (English and German), the direct path's wheel case and German at 200%, both engines. The scrolled-away and Tab cases pass: the synchronous call reaches a disabled button and does nothing |
| (f)     | the reveal                                                                  | 3                          | 2 — German at 200% only, both engines; elsewhere Edit copy and its message were already in view                                                                                                                             |
| (g)     | the interaction guard (always armed)                                        | 4                          | 4 — the two wheel cases, both engines; the Tab case is still caught by the focus check                                                                                                                                      |
| (h)     | the focus check                                                             | 1                          | **none**: real input also fires the guard's events, so only a focus move by script, at unit level, discriminates                                                                                                            |
| (i)     | dropping the direct path when the rider has left                            | 2                          | 4 — leaving during the check, held on either store, both engines: a write lands after leaving                                                                                                                               |
| (j)     | the guard armed only when the write starts, as in the first plan            | 2                          | 2 — the wheel during the preliminary check, both engines                                                                                                                                                                    |
| (k)     | the original delayed preferences read before the write, held by the fixture | 1                          | 8 — every Planning case: opened during the held read (English and German), released after autosave, and an edit after the copy, both engines; the earlier draft is stored, or shown                                         |
| (l)     | refusing a further press during the check                                   | 1                          | 2 — three writes instead of one, both engines                                                                                                                                                                               |

**Findings worth carrying forward.**

- **React's own commit calls `focus()` on a button it has just disabled.** Chromium blurs a focused button that becomes disabled, and React's selection restore after the commit calls `focus()` on it again, which does nothing. A recorder that counted calls therefore credited focus moves that never happened. It first misread control (k), then the baseline. The spec now records only calls that leave focus on their target; the same caution applies to any future focus assertion.
- **An immediate storage fault never shows the working state.** A write that fails before React renders lands its busy and idle states in one commit, so the button is never disabled. Only a held write exercises the busy-then-enabled sequence in a browser. The direct path's version of it is covered at unit level.
- **The baseline mostly lost focus rather than taking it.** Its failure focus reached Edit copy while it was disabled, a no-op, leaving the rider on `<body>`. WebKit's direct path was the exception: its write could fail before the working state rendered, and the baseline then moved focus back to Edit copy after the rider had scrolled away.
- **The title park makes the engines agree.** Chromium blurs a disabled focused button and WebKit keeps it, so without the park a refused Escape in Chromium would land on `<body>` and count as moving on; with it, both engines keep focus inside the confirmation.
- **IndexedDB's ordering already held on the baseline for a write issued before Planning mounted**, in both engines. The repair issues every authorised write that way.

**Limitations, stated plainly.**

- **Synthetic only.** Holds, aborts and faults are synthetic. Nothing is established about real write latency, real failure modes or how often they occur on the iPhone, and no physical-device reproduction of D-06 exists.
- **Edits in a Planning still loading behind a held write.** If the rider edits Planning while it is still loading behind a held write, Planning's existing rule applies: edits made before hydration take precedence, and they supersede the copy in storage. A test characterises this; nothing changes it here. It is reachable only while a write is held.
- **Two buttons read the working label while busy** — Edit copy and the confirmation's action. Accurate, but it is announced twice.
- **The guard is deliberately coarse.** Any `wheel` or `touchmove`, and any key but Escape, counts as moving on — including a tap that drifts on the disabled actions. The failure then leaves focus where it is, and its message is still announced as an alert.
- **Reported separately, not fixed (pre-existing):**
  - an unconfirmed Edit copy confirmation left open survives Start riding, and when the ride is paused it is still open and its Cancel `autoFocus` fires again;
  - the draft-check failure message is not gated on the rider still being there.
- **Not claimed:** browser text scaling is not iOS Larger Text, and no VoiceOver, physical-keyboard, landscape or physical-Android result is claimed.

**Installed-iPhone acceptance, reported 2 October 2026.** All five ordinary-flow checks passed on `0.4.54` (build `041da6c`), in German and English. This accepts slice 4's ordinary reachable flow only: the pending-write, leave-while-writing and failure cases above keep their synthetic, automated evidence and were not induced on the phone. The dated record, with what it does not claim, is in [`current-status.md`](current-status.md).

### Slice 5 — Clear draft failing (D-01) (shipped `0.4.56`, 3 October 2026)

**Approved by the rider on 2 October 2026** — decision 6 in the inventory's [decisions section](../design/reveal-inventory/README.md#decisions--d-06-d-02-d-01-and-c-12-2-october-2026). It was made the next slice once item 132 had been accepted, D-01 only.

**The defect.** A failed Clear draft returned focus to the re-enabled button with a plain `.focus()`, whatever the rider had done meanwhile ([review preparation](../design/reveal-inventory/README.md#d-01--clear-draft-fails-1)):

- focus was taken back from Route name, from another control and from a rider who had scrolled away;
- at 200% text the browser's own focus scroll then pulled the page back, by up to 4,282 px in Chromium;
- while the rider was still waiting, that same focus scroll centred the button rather than revealing it by the minimum. Measured again on the unchanged build in German at 200%: 476 px where 207 px was the minimum.

**Mechanism** (`PlanningScreen.tsx`, unless named).

- **The guard, shared.** D-06's interaction guard moved from `src/ui/riding/editCopyInteractionGuard.ts` to `src/ui/shared/operationInteractionGuard.ts`, as `armOperationInteractionGuard` / `OperationInteractionGuard`. The slice 4 record above names it by its old path.
  - Its semantics are unchanged.
  - Its two callers are D-06 and D-01, and D-02 is approved to need it too.
  - `RidingScreen.tsx` and the spies in `RidingScreen.test.tsx` follow the rename, and nothing else in D-06 changes.
- **Pending.** Once the confirmation's **Clear draft** is pressed, focus waits on the confirmation's own title, which `ConfirmDialog`'s existing `titleRef` makes focusable by script only. Focus moves there with `preventScroll`, before the existing busy state disables both actions.
  - Chromium drops a focused button that becomes disabled to `<body>`. The park keeps focus inside the dialog in both engines.
  - A refused Escape therefore still reaches the dialog's own handler, and the guard counts it as waiting.
- **One guard per attempt.**
  - Each confirmed attempt arms its own guard, after the existing duplicate check, so a refused second press arms nothing.
  - The guard covers the Clear draft area: the confirmation while it shows, and the button's own row once a failure has swapped it back. Only one of the two is ever mounted.
  - It is disarmed by a tap or click outside that area, any key but Escape inside it, and any wheel or touch scroll.
  - The guard is detached when its decision is made, when its attempt ends and when Planning unmounts. An old attempt can therefore never act on a later one.
- **The decision.** A layout effect decides once the button is mounted and enabled again:
  - **still waiting** — the guard is armed, and focus is on `<body>` (where the disabled, then removed, confirmation leaves it) or on the button itself: focus Clear draft with `preventScroll`, then reveal the button and its message by the minimum below the sticky header with `applyConfirmationReveal`. Clear draft has priority when both cannot fit, so the retry control stays reachable and the message is available by scrolling;
  - **moved on** — no focus, no scroll. The message stays in Clear draft's row, with its existing `role="alert"`.
- **Unchanged:**
  - opening, Cancel and Escape;
  - the busy label and disabled actions;
  - the duplicate protection;
  - a successful clear and the retry;
  - draft persistence and clearing.
- **Files:**
  - **source:** `src/ui/planning/PlanningScreen.tsx`, `src/ui/shared/operationInteractionGuard.ts` (moved), `src/ui/riding/RidingScreen.tsx` (import only), `src/ui/shared/ConfirmDialog.tsx` (a comment);
  - **version:** `0.4.56`;
  - **tests:** below.

**Evidence — automated only.**

- **Unit and component.** The full suite passes, 4,842 tests in 206 files.
  - `PlanningScreen.clearDraft.test.tsx` has 15 new D-01 cases. They replace the test that pinned the old plain focus, and the file now has 40 tests. They cover:
    - the title park while the clear runs, and Escape refused there;
    - an immediate and a delayed failure while the rider waits: focus with `preventScroll`, then a minimal reveal, none when the row already shows, and only the button when the row cannot fit;
    - five kinds of moving on, with no focus and no scroll: a wheel, a touch scroll, a tap outside the area, a tap on blank space, and a key other than Escape;
    - focus moved to Route name, which keeps the rider's typing;
    - a tap on the disabled actions, which still counts as waiting;
    - the guard renewed for every attempt, in both directions, and a successful retry;
    - one guard per confirmed attempt, none for a refused second press, and each detached;
    - leaving Planning while the clear runs.
  - The moved guard's own 8 tests pass unchanged under the new name, and D-06's `RidingScreen.test.tsx` spies follow the rename.
- **Browser, in the pinned container, at 390×844 portrait.** `e2e/clearDraftFailure.smoke.spec.ts` (new): 23 tests in each of Chromium and WebKit.
  - **Controlled fixtures, all synthetic:** an immediate fault on the draft delete, and a hold on `planningDrafts` whose release aborts only the app's queued delete. The hold is always released, and the held store is never read.
  - **Input:** real pointer, wheel and key input. Each outcome is asserted twice, and labelled:
    - **[behaviour]:** where focus is, whether the page was scrolled back towards Clear draft, and whether a needed reveal moved the page exactly the minimum from where the failure left the row. That position is measured just before the focus call, in any build;
    - **[implementation]:** whether focus used `preventScroll`, and whether the app made at most one scroll call (none once the rider has moved on).
  - **Cases:**
    - **waiting:** an immediate and a delayed failure, in English and German at ordinary and 200% root text, plus a refused Escape and a tap on the disabled action;
    - **moved on:**
      - a wheel scroll down, in both languages at both text sizes;
      - a wheel scroll up, in English at both text sizes;
      - Route name tapped and typed into before and after the failure, in both languages at both sizes, with every keystroke kept and autosaved over the intact draft;
      - Shift+Tab to the routing disclosure, after which Enter opens it, not Clear draft;
      - a tap on blank space;
      - leaving for Routes while the clear is pending, with the draft intact on return;
    - **retry:** moved on, then a fresh attempt while waiting restores focus, then a successful clear removes the message.
  - **Results:** 46 of 46, twice.
  - **Regression specs:** with the new spec, on the final build: `clearPlanningDraft` (6), `confirmationReveal.smoke` (14 in each engine), `confirmationRevealSettled` (7), `editCopyBusyState.smoke` (24 in each engine, D-06 with the moved guard), `planningSavedRoute.smoke` (14 in each engine), `planning` (22), `editRouteAsPlanningCopy` (5) and `reverseRoute` (7). 197 of 197 passed.
  - **The full browser suite, once, at 8 workers:** 866 of 866, in both engines and the `android-chrome` project, with the new spec included.
- **Which branch each combination took.**
  - **No reveal needed:** at ordinary text in both languages, and in English at 200%, the button and its message were already inside the band when the failure arrived. Focus returned with no movement.
  - **The minimum reveal:** in German at 200% the confirmation is taller than the band, so its collapse left the row partly above it. The page moved 207 px in both engines, against a minimum of 207.3 px in Chromium and 206.3 px in WebKit.
  - **Moved on:** the collapse itself moved later content up by up to 732 px, and Chromium's scroll anchoring sometimes kept the rider's field where it was. In no moved-on case did the app make a scroll call.
- **Baseline, `b94ddc3`** (application code identical to `501e1d4`, `0.4.55`): 44 of the 46 browser runs fail. The failures are separated by kind:
  - **28 fail on behaviour:**
    - every moved-on case in both engines. Focus was taken back to Clear draft, and at 200% the browser's focus scroll also pulled the page back. A Route name keystroke after the failure went to Clear draft instead of the field;
    - German at 200% while waiting, in both engines. The page moved 476 px (Chromium) and 475 px (WebKit) where the minimum was 207 px.
  - **16 fail on the implementation assertion only:**
    - 14 waiting cases whose visible outcome was already right. Only the focus call lacked `preventScroll`, so they do not show a visible defect on the baseline;
    - the Shift+Tab case in both engines. Its precondition, focus parked on the title, does not exist on the baseline.
  - **2 pass:** leaving Planning, in both engines. The baseline already dropped a failure that settled after Planning unmounted, so this is a regression guard.
- **Negative controls**, each applied alone to `PlanningScreen.tsx`, rebuilt for the browser runs, and restored byte-for-byte (SHA-256):

| Control | What it disables                                             | Unit tests failed (of 40)                                                                | Browser tests failed (of 46)                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (a)     | the interaction guard, so a failure always counts as waiting | 6 — the five kinds of moving on that leave focus on `<body>` or the title, and the retry | 16 — every wheel, blank-space and retry case, both engines. Route name and Shift+Tab still pass: the focus check catches them                                                                                |
| (b)     | the reveal                                                   | 3 — the two minimal reveals and the fallback                                             | 4 — German at 200% while waiting, both engines: the row was left partly above the band                                                                                                                       |
| (c)     | `preventScroll`, replaced by plain focus                     | 5                                                                                        | 20 — every waiting case, on the implementation assertion. On behaviour, only German at 200% in Chromium, which moved 476 px. In WebKit the browser's own focus scroll ended within 1 px of the minimum there |
| (d)     | the title park                                               | 2                                                                                        | 4 — the refused Escape, whose focus was then not restored, and Shift+Tab, whose precondition is the park; both engines                                                                                       |
| (e)     | a new guard for each attempt (the first is reused)           | 2                                                                                        | 2 — the retry, both engines                                                                                                                                                                                  |
| (f)     | Clear draft's priority in the reveal                         | 1 — the fallback                                                                         | not run: the fallback cannot be reached in a browser                                                                                                                                                         |

**Findings worth carrying forward.**

- **The visible defect was mostly about moving on.** While the rider waited, the baseline already ended in the right place everywhere except German at 200%. What it got wrong was everyone who had moved on. The `preventScroll` assertion is an implementation check, and its baseline failures are reported separately for that reason.
- **"Not scrolled back" needs two kinds of evidence.** A collapsing confirmation moves later content up by itself, so an anchor that merely "did not move down" misses a scroll-back smaller than the collapse. Control (a) showed this at 200%, where only the app's recorded scroll call revealed the reveal it made. Both checks are kept.
- **The minimum is measured from the failure, not computed by the app.** The focus recorder captures the row and the scroll position immediately before the focus call, so the same assertion judges the baseline's browser focus scroll and the repair's deliberate one.
- **Opening the routing disclosure moves its own summary by 1 px in both engines.** The Shift+Tab test therefore measures the rider's position before their next key, not after it.

**Limitations, stated plainly.**

- **Synthetic only.** The faults, holds and aborts are synthetic. Nothing is established about how often a clear fails on the iPhone or how long it takes, and no physical-device reproduction of D-01 exists.
- **A failure that settles after Planning has been left is neither shown nor logged.** This is pre-existing: the attempt's generation check drops it. The draft remains, and Plan shows it on return.
- **A Route name edit while a clear is pending schedules an autosave that queues behind the delete.** This is pre-existing. After a failure it saves the edit over the kept draft, which is tested. After a success it can briefly rewrite the row until the next autosave clears it. Nothing changes this here.
- **The guard cannot see a scrollbar drag or an assistive-technology scroll gesture**, which fire no pointer, touch, wheel or key event. A failure after one of those is treated as waiting. The same is true of D-06.
- **Focus is parked on the confirmation's title while pending.** Whether VoiceOver announces it there is unverified.
- **Desktop keyboard only.** Escape, Tab, Shift+Tab and Enter were exercised with the desktop engines' keyboard, which is automated evidence. There is no physical-device keyboard result.
- **The oversized-row fallback cannot be reached in a browser.** At the supported widths, the button and its message always fit the band, so the fallback is unit-tested with stubbed geometry only.
- **Not claimed:** browser text scaling is not iOS Larger Text, and no VoiceOver, landscape or physical-Android result is claimed.

**CI and deployment.** Run [37076853209](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37076853209), for commit `439e578`: **Verify and build, all four End-to-end shards and Deploy succeeded, each on its first attempt.** The durations come from the run's own job and step start and completion times, read once after the run and kept locally. Verify and build's test step is its unit and component tests; each shard's is its end-to-end suite.

| Job              | Test step | Whole job |
| ---------------- | --------: | --------: |
| Verify and build |     175 s |     300 s |
| E2E shard 1/4    |     439 s |     499 s |
| E2E shard 2/4    |     424 s |     486 s |
| E2E shard 3/4    |     270 s |     340 s |
| E2E shard 4/4    |     661 s |     725 s |
| Deploy           |         — |      11 s |

The longest job, shard 4, left 475 s below the E2E jobs' 1,200-second timeout. The deployment served `0.4.56` / `439e578`. These are one run's timings, not an established growth trend, and no further sharding change is made or authorised here.

**Installed-iPhone acceptance, reported 3 October 2026.** The ordinary Clear draft flow passed on `0.4.56` (build `439e578`), in English and German: opening Clear draft, cancelling without losing the draft, confirming a successful clear, and repeating with a new draft, with no stale error or busy state. This accepts slice 5's ordinary-flow regression checks only: the failure, delayed-completion, failure-retry and enlarged-text cases above keep their synthetic, automated evidence and were not induced on the phone. The dated record, with what it does not claim, is in [`current-status.md`](current-status.md).

### D-02 — investigated and planned (3 October 2026; not implemented)

The investigation and planning stage the rider asked for after slice 5's acceptance. **No application source, test, dependency, configuration or version changed.** The full record — method, reproduction on `439e578`, the causal sequence, the recommended implementation, its test plan and limitations — is the [D-02 report](../design/reveal-inventory/d-02-delete-lifecycle.md); it is not repeated here.

- **Causes, measured.** Dexie 4.4.5's live-query cache removes a route optimistically while its deletion is pending, and does not re-run the index-ordered list after an aborted deletion, so a still-stored route stays hidden. `RouteLibrary` shows the raw `error.message`. The confirmation grows with no reveal and loses focus.
- **Recommended.** An explicit transaction for `deleteRoute`; the confirmed deletion owned by `App`, so it survives leaving Routes; "Deleting…" kept until the live list agrees; conflicting card actions refused; the translated message; focus restored only while the rider waits at the card, or repaired when the rider's own focus was inside the removed card.
- **Decision for the rider:** what a failure shows while the rider's own filter hides the route ([report](../design/reveal-inventory/d-02-delete-lifecycle.md#decision-for-the-rider)).
- **Evidence:** synthetic, desktop Chromium and WebKit in the pinned container, and Dexie in isolation; nothing on the device.

### Slice 6 — Delete route pending and failing (D-02) (shipped `0.4.57`, 3 October 2026)

**Approved by the rider on 3 October 2026**, after the [investigation](../design/reveal-inventory/d-02-delete-lifecycle.md): implementation of decisions 4 and 5 in the inventory's [decisions section](../design/reveal-inventory/README.md#decisions--d-06-d-02-d-01-and-c-12-2-october-2026), following the report's recommendation. This is implementation approval, not device acceptance.

**The rider's decision, option A** (reported 3 October 2026), for a failure that arrives while the rider's own search or tag filter hides the route: the route stays hidden according to the filter; the failure stays with that route's confirmation; when the route is visible again, its message and recovery actions are shown without taking focus or scrolling; no list-level message or notification is added.

**What the rider gets.**

- **While a confirmed deletion runs**, the route stays listed — whenever the search and filters include it — as "Deleting…", with Cancel and Delete route disabled. Its name, Rename, Add/Edit tags, Export and Delete are unavailable too. As before, every pin, every other card's Delete and Manage tags (with its hint) are refused; browsing, Search and the filters are not.
- **After the commit**, the card stays a disabled "Deleting…" until the list itself no longer contains the route — never an ordinary card in between. Filtering a route out of view is not taken as evidence of the commit.
- **A failure** shows "That route could not be deleted." / "Diese Route konnte nicht gelöscht werden.", never the storage error's own text, which goes only to Status's redacted log.
  - **Still waiting at the card:** Cancel takes focus without the browser's focus scroll, and the grown confirmation is revealed by the minimum — its complete action row first when it cannot fit.
  - **Moved on** (a scroll, a tap elsewhere, typing, another key): nothing takes focus and nothing moves.
  - **Hidden by a filter:** option A, above.
- **Leaving Routes** keeps the operation: returning shows "Deleting…" or the failure on its card, taking no focus.
- **A success** moves focus only when it was inside the removed card, to the neighbouring card's name without scrolling — revealed by the minimum only while the rider was still waiting. Focus the rider moved, or a tap on blank space, is left alone. This replaces the old unconditional focus move, a behaviour change of its own.
- **A card reappearing** with a running or failed deletion (a filter cleared, a return to Routes) takes no focus and scrolls nothing. D-03's quiet dismissal of an unconfirmed Delete is unchanged.

**Mechanism.**

- **Storage:** `deleteRoute` runs inside an explicit `db.transaction("rw", db.routes, …)`, so Dexie applies no optimistic removal; a commit re-reads the list, and an abort leaves it untouched.
- **Owner:** a pure `src/ui/library/routeDeletion.ts` holds the record `{ attempt, routeId, phase: "deleting" | "committed" | "failed" }` and its attempt-guarded transitions. `useRouteDeletion.ts` wraps it with a synchronous admission ref (a second press in the same batch starts nothing), always logs a failure as `route-delete`, and records the outcome whether or not Routes is mounted. `App` owns one instance and passes it to `RouteLibrary`.
- **`RouteLibrary`:** `pendingDeleteId` now means an unconfirmed confirmation only. A layout effect reconciles a committed or failed record once the loaded list lacks its route; no tombstone list is kept. A failed record is dismissed by Cancel or Escape, by Rename, the tag editor or the pin on its card, by a new Delete on any card and by opening Manage tags; App clears it when a route card's switch prompt appears, and never a running or committed one.
- **`RouteListItem`:** on an admitted confirm, focus is parked on the confirmation's title (script-focusable, `preventScroll`) and the card arms one `armOperationInteractionGuard` over itself for that attempt. A layout effect decides the failure once, on a genuine transition to failed: guard armed **and** focus inside the card means Cancel plus `applyConfirmationReveal`; `<body>` never counts. The message joins the dialog's `aria-describedby`. The opening effect runs only on a false-to-true transition, so a remount replays nothing. The card's layout-effect cleanup reports, while the card is still connected, whether focus was inside it and whether the guard was still armed; `RouteLibrary` repairs focus only for the last such report from a card that left because its route is no longer stored.
- **Files:** `src/storage/routesRepository.ts`, `src/ui/library/routeDeletion.ts` (new), `src/ui/library/useRouteDeletion.ts` (new), `src/App.tsx`, `src/ui/library/RouteLibrary.tsx`, `src/ui/library/RouteListItem.tsx`, `src/ui/shared/operationInteractionGuard.ts` (a comment); version `0.4.57`. No i18n, schema, CSS or dependency change.

**Differences from the investigation's recommendation, and why.**

1. **The guard and the failure decision live in `RouteListItem`**, not in `RouteLibrary` with per-route ref maps. The guard then lives exactly as long as the card that confirmed: filtering, navigation and success all detach it, and no ref map is needed. A filter change or a navigation is rider input that disarms the guard anyway; the remaining case, an external change filtering the card out and back mid-attempt, errs towards not taking focus.
2. **`routeDeletion` is optional on `RouteLibrary`**, which owns one through the same hook when rendered alone, following the `pendingRouteSwitch` precedent; this spares 169 standalone test renders a mechanical change. Production always passes App's.
3. **Focus repair also covers the route leaving storage while the record is still `deleting`** — a list emission before the commit's promise — so the repair does not depend on that ordering.
4. **App clears a failed record as it sets a route card's prompt**, since `RouteLibrary` cannot update App during render, and **refuses to open or prompt for a route whose deletion is busy** — closing a narrow tap-then-delete race the investigation did not list.
5. **A pending pin-focus marker yields** when focus is already inside an open confirmation, so it cannot take focus back from a failure decision's Cancel.
6. **The handler guards are defence in depth.** The `disabled` attribute is the working mechanism — React drops clicks on disabled buttons — so the browser tests assert behaviour, and the guards-only control does not discriminate (below).
7. **Not adopted:** the painted-frame recorder, since the DOM-commit recorder already covers every state that could be painted and headless WebKit defers frames; and the "`error.message` restored" control, since the unchanged baseline shows the raw text.

**Evidence — automated only.**

- **Unit and component:** the full suite passes, 4,896 tests in 208 files (54 more than `0.4.56`).
  - **New:** `routeDeletion.test.ts` (6), `useRouteDeletion.test.ts` (7), and `src/test/idbHold.ts`, a bounded real IndexedDB hold on fake-indexeddb that can abort the app's queued delete.
  - **`routesRepository.test.ts` (+2):** with a hold, a live `listRoutes` subscriber keeps the route while pending and after an abort, which rejects; a commit removes it.
  - **`RouteListItem.test.tsx` (+21):** the title park, refused Escape, unavailable actions, the failure decision while waiting and after each kind of moving on, `<body>` never counting, a failure batched straight from the open confirmation, a retry's fresh guard, no focus on a pending or failed mount, and the removal report.
  - **`RouteLibrary.test.tsx` (+14):** the four raw-message assertions now expect the translated message; real holds for pending, commit, abort and the D-03 running and failed cases; reconciliation with the list's re-read gated; focus repair, moved focus, a blank-space tap and the repair's reveal; a pin marker yielding; a failed record closed six ways; two presses in one batch.
  - **`App.test.tsx` (+4):** leaving and returning while pending, a failure while away (logged, shown on return without focus), a switch prompt never clearing a running deletion but superseding a failure, and a busy route never opened.
- **Browser, in the pinned container (the CI image, by digest), at 390×844 portrait:** `e2e/routeDeleteFailure.smoke.spec.ts` (new), 27 tests in each of Chromium and WebKit.
  - **Fixtures, all synthetic:** an immediate fault on the routes delete; a bounded hold on `routes`, whose release can abort only the app's queued delete; a read fault on the list. The hold is always released, and the test never reads the held store.
  - **Cases:** immediate failure while waiting, in English and German at ordinary and 200% root text; delayed failure while waiting (English ordinary, German 200%), with Escape refused on the parked title; a tap on the confirmation's own text; moved on by a wheel (English ordinary, German 200%), by typing in Search and by a blank-space tap; held and unheld success, and German 200%; success after focus moved to Search, after a wheel with focus on the title, and after a blank-space tap; Search hiding the route, then a commit or a failure; **a tag filter hiding the confirmed deletion, a failure, then the filter removed** (German); leaving Routes and returning within and after Dexie's 3-second cache window; a retry; refused actions; another page deleting the route while ours is pending or after ours failed; and the read-fault characterisation.
  - **Results:** 54 of 54. Measured: the waiting reveal moved exactly the minimum — 37 px (English) and 58 px (German) at ordinary text, and the action row's 95 px and 164 px at 200%; moved-on anchors moved 0 px; the success repair moved 0 px at ordinary text, and −456 px (Chromium) and −468 px (WebKit) at German 200%, where the waiting rider's neighbour had moved above the band.
  - **Regression specs**, with the new spec: `routeDeleteFiltering.smoke` (its claim that a Dexie write cannot be held in a browser corrected), `clearDraftFailure.smoke`, `confirmationDialogs.smoke`, `confirmationReveal.smoke`, `confirmationRevealSettled`, `editCopyBusyState.smoke`, `rideSessionSwitchGuard`, `ridingLauncher`, `diagnostics`, the five `routeLibrary*` specs and `androidRouteLibraryTags`: 284 of 284.
  - **The full browser suite, once, at 8 workers:** 920 of 920, in both engines and the `android-chrome` project.
- **Baseline, `23f9af4`** (application code identical to `439e578`, `0.4.56`): **all 54 browser runs fail, each on visible behaviour**, none on an implementation check alone.
  - **21 per engine** cannot reach "Deleting…": the route leaves the list while its deletion is pending — the storage defect itself.
  - **5 per engine** show the raw storage text instead of the translated message.
  - **The successes** commit the deleted route as an ordinary card, and at German 200% the page jumped −733 px (Chromium) and −745 px (WebKit) where the minimum was 116 px.
- **Negative controls**, each applied alone, rebuilt, and restored byte-for-byte (SHA-256); unit failures are of the 412 tests in the five affected files:

| Control | What it disables                                    | Unit failures | Browser failures (of 54)                                       |
| ------- | --------------------------------------------------- | ------------: | -------------------------------------------------------------- |
| (a)     | the explicit transaction (an implicit delete)       |            10 | 40 — every held case                                           |
| (b)     | App's ownership (RouteLibrary keeps its own)        |             4 | 4 — both navigation cases                                      |
| (c)     | reconciliation (cleared at the commit's promise)    |             9 | 10 — the ordinary-card flash and every repair                  |
| (d)     | the removal report (repair keyed on `<body>`)       |             1 | 2 — success after a blank-space tap                            |
| (e)     | the guard (always armed)                            |             7 | 6 — wheel scrolls and the retry                                |
| (f)     | the failure reveal                                  |             4 | 14 — every waiting case                                        |
| (g)     | the title park                                      |            10 | 17 — waiting in Chromium, delayed waiting and repairs in both  |
| (h)     | transition-only opening (the opening runs on mount) |             5 | 6 — failures returned by a filter or a navigation take focus   |
| (i)     | the card's disabled attributes and handler guards   |             5 | 8 — refused actions, navigation and the busy-state recorder    |
| (i2)    | the handler guards alone                            |             0 | 0 — not discriminating: React drops clicks on disabled buttons |
| (j)     | App's refusal to open a busy route                  |             1 | not run: unit only                                             |
| (k)     | the pin marker's yield                              |             1 | not run: unit only                                             |

**Findings worth carrying forward.**

- **An abort inside Dexie's own deferred signal hides the optimistic removal altogether.** The unit abort test passed against the implicit delete until the deletion stayed pending for 50 ms before failing; a failure that fast never shows the defect.
- **A failure grows its confirmation downwards** — by 37 px at ordinary text and 164 px at German 200% — moving later content by itself. A kept-position anchor below it measured that growth as movement; anchors are therefore taken from the top of the band, above the message.
- **React suppresses `onClick` on a disabled button**, even for a dispatched click, so the handler guards cannot be reached while the attribute is present; control (i2) shows it.

**Limitations, stated plainly.**

- **Synthetic only.** Holds, aborts, faults and the read fault are synthetic. Nothing is established about real failure modes, their frequency, or how long a deletion stays pending on an iPhone, and no physical-device reproduction of D-02 exists.
- **Committed but never reconciled.** If the deletion commits and the live query then fails, the card stays a disabled "Deleting…", and because the list-wide busy state is retained, every pin, any other Delete and Manage tags stay refused until a later successful re-read or a reload. Nothing is still writing to storage then — the deletion has committed, and it is the list that is stale. General live-query recovery is outside this slice; the characterisation test pins today's behaviour.
- **Returning to Routes after Dexie's three-second cache window while a deletion is still pending** shows "Loading routes…" until it settles, because the list's read waits behind the write.
- **The repair's fallback** — when no neighbouring name can take focus — is Clear tag filters, the filter disclosure, Search and the heading, in that order.
- **Two confirmations at once:** a failure arriving while another card's switch prompt is open leaves both open, as item 119 allows.
- **The guard cannot see a scrollbar drag or an assistive-technology scroll**, and treats a failure after one as waiting, as in D-01 and D-06.
- **Focus is parked on the confirmation's title while pending;** whether VoiceOver announces it there is unverified.
- **The removal report relies on React 19.2's commit order**, measured and held by the tests rather than documented by React.
- **Unchanged and pre-existing:** a route deleted in another tab while its unconfirmed confirmation has focus leaves focus on `<body>`.
- **Not claimed:** browser text scaling is not iOS Larger Text, and no VoiceOver, physical-keyboard, landscape or physical-Android result is claimed.

**CI and deployment.** Run [37116791859](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37116791859), for commit `bd688d7`: **Verify and build, all four End-to-end shards and Deploy succeeded, each on its first attempt.** The durations come from the run's own job and step start and completion times, read once after the run and kept locally. Verify and build's test step is its unit and component tests; each shard's is its end-to-end suite.

| Job              | Test step | Whole job |
| ---------------- | --------: | --------: |
| Verify and build |     170 s |     297 s |
| E2E shard 1/4    |     434 s |     498 s |
| E2E shard 2/4    |     444 s |     498 s |
| E2E shard 3/4    |     269 s |     331 s |
| E2E shard 4/4    |     719 s |     784 s |
| Deploy           |         — |       9 s |

The longest job, shard 4, left 416 s below the E2E jobs' 1,200-second timeout. The deployment served `0.4.57` / `bd688d7`. These are one run's timings, not an established growth trend, and no further sharding change is made or authorised here.

**Installed-iPhone acceptance, reported 3 October 2026.** The ordinary Delete route flow passed on `0.4.57` (build `bd688d7`), in English and German: cancelling Delete preserves the route; confirmed deletion and repeated use work without unexpected page jumps or stale states; and an unconfirmed Delete hidden by Search or a tag filter stays closed when the route returns, with Search typing uninterrupted. This accepts slice 6's ordinary-flow regression checks only: a pending deletion, the synthetic failures, failure recovery and the committed-but-unreconciled state above keep their synthetic, automated evidence and were not induced on the phone, and the Search result is an installed-iPhone typing result, not physical-keyboard evidence. The dated record, with what it does not claim, is in [`current-status.md`](current-status.md).

### Slice 7 — Edit copy's replacement confirmation, opening (C-12) (shipped `0.4.58`, 3 October 2026)

C-12's opening now follows the common rule: no movement when Edit copy's "Replace your current draft?" fits, the minimum when it can fit, and its action row first when it is taller than the band, with Cancel focused without the browser's own focus scroll. The ordinary-text opening is unchanged. Its full record — the re-measured baseline, the mechanism, the comparison of the confirmation that reappears on Pause, the evidence, the controls and the limitations — is in [`backlog-item-124-continued.md`](backlog-item-124-continued.md#slice-7--edit-copys-replacement-confirmation-opening-c-12-shipped-0458-3-october-2026), split from this file for size; it is not repeated here. Its ordinary flow was accepted on the installed iPhone in English and German, reported 3 October 2026 ([`current-status.md`](current-status.md)).

### Original specification (scheduled 30 September 2026)

124. **One reveal rule for confirmations and expanding panels**
     - Origin: the rider's installed-iPhone observations, reported 28 September 2026. Opening Planning's **Clear draft** confirmation, or a Routes card's **Delete route** confirmation, left the expanded confirmation out of view.
     - **Scheduled on 30 September 2026**, second in the approved execution order (root [`CLAUDE.md`](../../CLAUDE.md)), after item 128, by the rider's decision; it was unscheduled until then. Item 128 shipped in `0.4.50`, so this item is now first in the order revised on 1 October 2026. It addresses the two out-of-view confirmations the rider observed, and precedes item 103's broader visual refinement. **Scheduling approves no implementation or cancellation behaviour:** the work starts with the two confirmed cases, Clear draft and Delete route, and the broader panel scope and the interaction decisions listed under _Open, deliberately_ below must be settled separately before implementation.
     - **The mechanism in source is separate from what was observed.**
       - **Source:** neither confirmation has a reveal of its own. Clear draft morphs in place, swapping its trigger row for `ConfirmDialog` (`src/ui/planning/PlanningScreen.tsx`); Planning receives no sticky-header reference. Delete route is a hand-rolled confirmation appended below the card's actions row (`src/ui/library/RouteListItem.tsx`), and `src/index.css` states that a card's delete confirmation deliberately has no scroll-into-view. In both, the only thing that can move the viewport is the Cancel button's `autoFocus`, through the browser's own focus scrolling.
       - **Observed:** on the installed iPhone, the expanded confirmation **remained out of view**. Whatever the browser's focus scrolling did there, it did not reveal the confirmation. **No cause is claimed.**
     - **Existing mechanisms, which do not agree with one another:**
       - item 118's minimal-scroll helper, `src/ui/settings/confirmationRevealScroll.ts`: instant, aware of the sticky header and the safe-area inset, priority to the action row when the whole inset cannot fit. It runs in a `useLayoutEffect` and corrects only what the native focus scroll left;
       - item 95's route-switch prompt: `scrollIntoView({ block: "end", behavior: "auto" })` when the card is not already fully visible;
       - items 105 and 106's top-prioritising tag-editor reveal (`src/ui/library/routeCardTopReveal.ts`), after `runWhenViewportSettled`;
       - the tag manager's smooth reveal for its merge and delete confirmations.

       Only Routes and Settings receive the sticky header's reference (`stickyHeaderRef` in `src/App.tsx`).

     - **Other expanding content with no reveal today:** Settings' and Status's disclosures, Settings' Replace-key form, Planning's routing options, the route card's rename and tag editors on opening, the Ride launcher's End/Discard confirmation, the paused Riding panel's End confirmation, and the page-level ride-switch dialog, which renders above `<main>`.
     - **The rule to adopt:** keep the viewport still when the relevant new content fits; otherwise scroll only enough to reveal it, accounting for the sticky navigation and the bottom safe area.
     - **Open, deliberately:**
       - the implementation, including whether item 118's helper is generalised;
       - which panels are in scope, and what "the relevant new content" is for each (the whole panel, or its action row first);
       - motion, and reduced motion;
       - focus and scroll on Cancel, Escape and close;
       - how this interacts with item 119's dialog semantics and with item 125's per-screen scroll restoration.
     - **Not approved:** any change to item 95's or item 118's accepted behaviour, which a common rule should subsume rather than regress.
     - **Evidence required when implemented:** browser geometry before, while open and after cancelling, with the content both fitting and not fitting, at 390 px portrait at ordinary and 200% root text, with a sticky-header-aware assertion and a negative control; then the installed-iPhone recheck, since the observed failure is on iOS.

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
