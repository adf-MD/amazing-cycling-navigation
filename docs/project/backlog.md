# Planning backlog — full pending item specifications

This file holds the complete, byte-preserved specification for every backlog item that is **approved future work but not yet implemented**, plus the two items that are explicitly monitored/investigated-but-unconfirmed (see [current-status.md](current-status.md) instead for those two — items 32 and 66).

Item numbers are stable identifiers across this project's entire documentation set — they never change regardless of which file an item's text lives in. See [README.md](README.md) for the full map of where everything lives, and the root [`CLAUDE.md`](../../CLAUDE.md) for durable product/engineering rules and the required reading order before implementing any item here.

Items 11, 12, 16, 28, 59, 60 and 61 below remain approved future work, not yet scheduled into the sequence. Items 87–92 were added by the [release-readiness audit](release-readiness-audit.md) (item 86); items 87–92 have since been completed. Items 107–113 were added by the installed-iPhone field test of 10 September 2026 (see [current-status.md](current-status.md) for the dated evidence) and are all scheduled ahead of items 102 and 103, which keep their numbers; the authoritative execution order lives in the root [`CLAUDE.md`](../../CLAUDE.md)'s queue index and is deliberately not duplicated here. Items 107, 108, 109, 110, 111 and 112 of that group have since been completed and their full specifications have moved to [`history/`](history/README.md), so only item 113 remains below. Item 114 was added on 11 September 2026 from item 109's own Chromium verification work rather than from that field test, and has since been completed (`0.4.45`) and moved to [`history/`](history/README.md). Item 117 was added on 13 September 2026 from the installed-iPhone session that accepted item 112, which rejected the opaque route identifier that session's `Active session` row exposed, and has since been completed and moved to [`history/`](history/README.md). Item 118 was added on 13 September 2026 from a second installed-iPhone report the same day and has since been completed and moved to [`history/`](history/README.md); item 119 was added from the repository investigation that established item 118's ownership, and is scheduled ahead of items 102 and 103. Item 121 was recorded on 25 September 2026, placed first in the execution order, and has since been completed (`0.4.44`) and moved to [`history/`](history/README.md). Item 128 was recorded on 29 September 2026 from item 114's own measurements and is unscheduled. Item 123 was promoted to the front of the approved execution order on 29 September 2026, and item 129 was recorded that day from the installed-iPhone check of `0.4.45` and is unscheduled.

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

<a id="item-119"></a>

## Item 119 — Unique confirmation-dialog titles and truthful overlapping-dialog semantics

_Category: Interface and accessibility consistency_

119. **Unique confirmation-dialog titles and truthful overlapping-dialog semantics**
     - Origin: the repository investigation that established item 118's ownership, 13 September 2026 — **not** an installed-iPhone observation, and **not** field evidence. See [`current-status.md`](current-status.md) for the dated record.
     - **This is a confirmed accessibility defect, reproduced in this repository, not a monitored reliability observation.** `ui/shared/ConfirmDialog.tsx` hardcodes `aria-labelledby="confirm-dialog-title"` on a fixed element id. `App.tsx` renders the page-level ride-switch `ConfirmDialog` above and outside the screen switch, and navigating away from Routes deliberately does not clear `pendingRideSwitch` — the documented fallback so a mid-prompt navigation does not make the prompt vanish silently. Arming a switch from a route card, navigating to Settings and opening **Delete key** therefore puts **two** elements carrying that id in one document. Measured in a real render: two `alertdialog`s, two nodes with that id reading `Switch to "Route B"?` and `Delete OpenRouteService key`, and **both dialogs resolving their accessible name to `Switch to "Route B"?`** — so the key-deletion confirmation is announced as the ride-switch prompt.
     - **It is not an item 118 regression, and item 118 is not reopened.** The same hardcoded id and the same reachable path exist before item 118; item 118 changes where the Settings confirmation renders, not how it is named.
     - Scope approved for the eventual implementation:
       - **unique dialog-title ids**, so no two simultaneously rendered confirmations can share one, and each dialog resolves to its own accessible name;
       - **truthful modal semantics** — `ConfirmDialog` asserts `aria-modal="true"` while nothing behind it is inert and the primary navigation stays live, which the two in-card precedents (`RouteListItem.tsx`, `RouteTagManager.tsx`) deliberately omit;
       - the **overlapping-dialog lifecycle** — whether two confirmations should ever be open at once, and if not, which one yields.
     - **The implementation must survey every `ConfirmDialog` call site before choosing a correction**, since a change here reaches riding-critical dialogs: `App.tsx`, `PlanningScreen.tsx`, `RidingScreen.tsx` (two), `FreeRoamScreen.tsx` and `RidingLauncher.tsx`, plus Settings. No particular mechanism — `useId()`, a required prop, a focus trap, or a single-dialog policy — is prescribed here, deliberately.
     - Explicitly rejected directions: removing the documented page-level fallback that keeps a mid-navigation prompt visible; suppressing one dialog merely to make the duplicate id unreachable without addressing naming; and asserting modality that the implementation does not actually enforce.
     - Evidence required when this is implemented: a **fail-first test rendering the real overlapping path** and asserting each dialog's own accessible name, plus compatibility guards proving the six existing call sites are unchanged.
     - Physical acceptance on the installed iPhone Home Screen PWA is required for whatever ships, including a VoiceOver check that each confirmation announces its own title. Physical Android verification is separately outstanding, as for most recent items.

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

---

<a id="item-122"></a>

## Item 122 — Planning map area on a phone (unscheduled design candidate)

_Category: Planning layout_

122. **Planning map area on a phone — unscheduled design candidate**
     - Origin: item 113's first installed-iPhone pass, 25 September 2026. The Planning map felt too small for planning compared with free roam's map.
     - **Unscheduled, and not part of the approved execution order.** Nothing about a new size is approved by this entry.
     - Present fact: `.planning-map-container` is `clamp(280px, round(nearest, 44dvh, 20px), 460px)` behind an `@supports` fallback chain. The 20 px rounding is load-bearing: a fractional map-container height once left MapLibre's drag-rotate/pitch handler permanently active with no end event. That was found in CI during the interface migration's fifth slice, and it recurred in Planning ([`history/interface-accessibility-migration.md`](history/interface-accessibility-migration.md)).
     - Any change must be **measured and tested as its own alternative**. That covers the gesture end events at the new heights; the waypoint list, profile, warnings and save controls remaining reachable; item 114's attribution/placement-control relationship; and the ordinary 390 px presentation. It must not be folded into item 103 or any other styling work.

---

<a id="item-123"></a>

## Item 123 — A small touch pan can place a Planning waypoint (scheduled next)

_Category: Planning interaction_

123. **A small touch pan can place a Planning waypoint — scheduled next**
     - Origin: item 113's first installed-iPhone pass, 25 September 2026. A pan on the phone sometimes placed a waypoint.
     - **Promoted on 29 September 2026** to the front of the approved execution order (root [`CLAUDE.md`](../../CLAUDE.md)), immediately before item 119, by the rider's decision. It was unscheduled until then. The motivation is accidental waypoint placement during touch panning or zooming in Planning.
     - **The rider's preferred design direction — to investigate and implement carefully, not a finished specification and not yet implemented:** touch interaction should place waypoints only through the deliberate crosshair placement control, while a desktop mouse keeps direct map-click placement. The work must settle, with evidence:
       - how the pointer type is decided **per interaction** (for example pointer events' `pointerType`), never by device class or by installed PWA versus browser;
       - hybrid devices: a touch-screen laptop, a tablet with a mouse or trackpad, and pen input;
       - that two-finger pinch-zoom and panning never place a waypoint on touch;
       - the empty-list hint `planning.waypoints.empty` ("No waypoints yet. Tap the map or use the crosshair to add one.") in both catalogues, which would no longer be true for touch.
     - Present fact: Planning places a map-tap waypoint from MapLibre's `click` event (`src/map/mapAdapter.ts`'s `onMapTap`), which MapLibre suppresses once a pointer has moved past its click tolerance. A small attempted pan can therefore still register as a tap.
     - **Investigate on the device before changing anything.** Distinguish touch from mouse by pointer type, never by installed PWA versus browser, and keep useful desktop mouse clicks. The crosshair placement control is unaffected by pan jitter. Removing direct map-tap placement for **touch only** is the rider's preferred direction above; direct placement by desktop mouse stays.
     - Evidence required when it is worked on: a device reproduction first, then a real touch-gesture test (item 94's precedent used real two-finger touch gestures) that fails before any change and passes after it, plus a mouse-click control proving desktop placement is unchanged.

---

<a id="item-124"></a>

## Item 124 — One reveal rule for confirmations and expanding panels (unscheduled)

_Category: Interface and accessibility consistency_

124. **One reveal rule for confirmations and expanding panels — unscheduled**
     - Origin: the rider's installed-iPhone observations, reported 28 September 2026. Opening Planning's **Clear draft** confirmation, or a Routes card's **Delete route** confirmation, left the expanded confirmation out of view.
     - **Unscheduled, and not part of the approved execution order.** No implementation or cancellation behaviour is approved by this entry.
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
     - **Update, 28 September 2026 — item 121 shipped first (`0.4.44`), with an interim rule this item is to replace.** By the rider's decision during item 121's planning, the Settings section starts at the top whenever navigation changes the rendered view: on entry from another tab, on a Settings ↔ Status switch, and when the Settings tab is tapped while Status is showing. Nothing else resets it, and no other screen's behaviour changed. That rule was approved explicitly as **interim**: this item should replace those top resets with a separately restored position for each of the two views. The mechanism is `SettingsSection.tsx`'s `useLayoutEffect` keyed on the rendered view, reusing the scroll-to-top reassertion loop extracted to `src/ui/shared/scrollToTopAndSettle.ts`; the sticky switcher and a constant `scroll-margin-top` on the view's content are recorded in [`history/items-118-NN.md`](history/items-118-NN.md#item-121). Any restoration must keep the switcher's position still across a switch and must not reintroduce a root `scroll-padding`, which item 121 measured to scroll the page when a sticky control takes focus and, in WebKit, to move a press on Save out from under the pointer.
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

<a id="item-128"></a>

## Item 128 — The imagery banner covers the Planning crosshair at ordinary text (unscheduled)

_Category: Planning presentation_

128. **The imagery banner covers the Planning crosshair at ordinary text — unscheduled**
     - Origin: item 114's Stage 1 onset sweep, 29 September 2026, measured in the pinned Playwright container in Chromium and WebKit, which agreed. **An automated measurement, not an installed-iPhone observation.**
     - **Unscheduled, and not part of the approved execution order. It is neither resolved nor accepted, and no fix is approved by this entry.**
     - **What was measured.** At ordinary 100% text, Planning's in-map imagery banner (`.map-status-overlay` at `top: 72px`, `left/right: 64px`, here the fallback message with its `Retry map imagery` button) overlaps the red placement crosshair ring:
       - **375×667** (map 343×300, ring 142–158px below the map's top): English, a banner 88px tall reaching 160px; German, 105px reaching 177px.
       - **320×844** (map 288×380, ring 182–198px): German, 139px reaching 211px. English (105px, reaching 177px) clears it.
       - **390×844 and 430×932** are clear at 100%; the overlap begins at 110% text (German) and 145% (English) respectively.
     - The banner is `pointer-events: none` apart from its Retry button, so it hides the crosshair without blocking taps on the map beneath it. It appears only when map imagery is unavailable.
     - **Item 114 does not reach it.** Item 114 changed only the enlarged-text layout, which engages from about 106–132% text depending on the size, and deliberately left the ordinary layout unchanged; below that threshold the banner stays in the map.
     - Any change must keep item 108's product decision in view — Planning keeps its imagery explanation in the map at ordinary text, and item 114 made an enlarged-text-only exception — and must be measured at 375×667, 320×844 and 390×844 in both languages against the crosshair, the placement control and the attribution.

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
