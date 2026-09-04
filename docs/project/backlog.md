# Planning backlog — full pending item specifications

This file holds the complete, byte-preserved specification for every backlog item that is **approved future work but not yet implemented**, plus the two items that are explicitly monitored/investigated-but-unconfirmed (see [current-status.md](current-status.md) instead for those two — items 32 and 66).

Item numbers are stable identifiers across this project's entire documentation set — they never change regardless of which file an item's text lives in. See [README.md](README.md) for the full map of where everything lives, and the root [`CLAUDE.md`](../../CLAUDE.md) for durable product/engineering rules and the required reading order before implementing any item here.

Items 11, 12, 16, 28, 59, 60 and 61 below remain approved future work, not yet scheduled into the sequence. Items 87–92 were added by the [release-readiness audit](release-readiness-audit.md) (item 86); items 87–92 have since been completed.

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

<a id="item-98"></a>

## Item 98 — Direction-aware active-Riding route-segment layering

_Category: Riding map presentation_

98. **Direction-aware active-Riding route-segment layering**
    - On route sections whose geometries overlap in opposite directions (for example an out-and-back climb/descent sharing the same road), the whole-route paint order can put a later descent above the segment the rider is currently climbing, making the colour at the rider's current direction misleading.
    - Confirmed current implementation: route layers (`src/map/gradientRouteLayer.ts`, `routeFeatureLayer.ts`, `routeLayer.ts`, `warningLayer.ts`, composed in `MapView.tsx`) clip and order by distance-along-route, not by geographic overlap. No existing "current segment" or "near-ahead" geographic-overlay concept exists to reuse or extend — this is new work.
    - Preserve the existing whole-route/latest-route-order presentation in Planning and the pre-ride overview unchanged. It remains the least surprising static overview when no single active direction should dominate.
    - In active Riding only, retain the complete route underneath, then paint a short current/near-ahead segment last so the colour representing the rider's current direction wins locally at overlaps.
    - Derive the overlay from matched canonical route progress and route order, not GPS bearing alone — bearing can be stale, noisy or ambiguous on overlapping/out-and-back geometry.
    - Do not globally hide all descents while climbing or all climbs while descending; only the local current/near-ahead emphasis changes.
    - Specify, before implementation, how the overlay behaves near feature boundaries, route completion, stale/unreliable fixes and off-route states. The rider marker and safety/recovery overlays must retain their established visual priority over this new overlay.
    - Require deterministic synthetic fixtures containing an overlapping out-and-back climb/descent, layer-order unit tests, and real-browser visual evidence. Do not change gradient thresholds, climb detection, or overview colouring as part of this item.
    - Direction arrows or laterally offset parallel lines may be investigated as alternatives, but must not be introduced without user-reviewed evidence, since they add clutter and can misrepresent the physical road. The current-segment overlay described above is the preferred starting design.

---

<a id="item-99"></a>

## Item 99 — Route Library sorting by distance and total ascent

_Category: Route Library organisation_

99. **Route Library sorting by distance and total ascent**
    - Confirmed current sort support: `RouteLibrarySortOrder = "most-recent" | "name-asc"` (`src/storage/mapping.ts`, default `"most-recent"`), implemented in `sortRoutesForLibrary` (`src/ui/library/routeLibraryView.ts`) and persisted via `routeLibraryPreferencesRepository` (Dexie-backed).
    - Extend the existing sort choices with route distance and **total ascent** — use "total ascent" in user-facing copy, not ambiguous "elevation". Support ascending and descending order for both new fields while preserving the existing `"most-recent"`/`"name-asc"` choices unchanged.
    - Sorting is presentation-only: never mutate stored route data or route arrays, and use deterministic tie-breakers, matching the existing `compareIds` convention.
    - Preserve the existing pinned/unpinned grouping, search/filter behaviour, focus restoration and deletion/rename semantics. Verify, rather than assume, whether each new sort applies within the pinned and unpinned groups separately by following the current library contract — do not let a new sort silently erase pin priority.
    - Use existing canonical route summary values (distance, ascent) and existing metric formatting. Do not recalculate or reinterpret ascent merely for sorting.
    - Preserve the existing sort-preference persistence behaviour confirmed above — extend it to the two new fields rather than replacing the mechanism.
    - Require pure-function coverage for ordering, ties, and missing/legacy values (for example a route with no recorded ascent), plus component/browser coverage for accessible selection and stable focus.
    - Keep this as a small independent slice — it does not require route tags (item 100) or a storage-schema redesign.

---

<a id="item-100"></a>

## Item 100 — Reusable route tags and tag-based organisation

_Category: Route Library organisation_

100. **Reusable route tags and tag-based organisation**
     - Confirmed current state: no tag or folder concept exists anywhere in the codebase (`src/domain`, `src/storage`, `src/ui`) — this is genuinely new work, not an extension of a partially-built feature.
     - Use user-facing **tags**, not exclusive folders. A saved route may naturally belong to several concepts, such as `commute`, `gravel` and `weekend`.
     - When editing a route's tags, offer existing tags as suggestions and allow a new tag to be created without leaving the editor.
     - Specify deterministic normalisation for whitespace, empty values, duplicates and case. Preserve one stable display spelling while preventing accidental case-only duplicates.
     - Existing routes migrate safely to an empty tag collection. No route becomes hidden or inaccessible after the migration.
     - Initial tags are local ACN library metadata. Do not silently alter GPX import/export or place tags inside the geometry-digest-bound `<acn:navigation>` GPX extension without a separately reviewed format/version decision.
     - This is approved staged implementation work, not a feasibility study — stage the delivery so each slice ships independently, rather than an unreviewable vertical expansion in one commit. Later stages depend on the tag foundation earlier stages build, not on a feasibility gate:
       1. **Data model and storage:** inspect migration implications and the compact phone editor's interaction pattern, then add the backward-compatible storage schema/migration for an empty-by-default tag collection per route.
       2. **Tag editing:** add reusable-tag suggestions and new-tag creation in the route editor, built on stage 1's storage.
       3. **Filtering and organisation:** add tag filtering and a useful organisation view without duplicating a multi-tag route confusingly across many sections, built on stage 2's tag data.
       4. **Full lifecycle and acceptance:** add tag editing, deletion/rename and empty-state coverage plus real-device acceptance for the complete feature.
     - Prefer filtering and tag chips before inventing nested folders. If a later grouped presentation is proposed, mock up how multi-tag routes appear before implementation.
     - Preserve search, pinning, sorting (including item 99's new fields once delivered), import/export privacy, storage migrations and route-switch behaviour. Adding a third-party taxonomy or cloud synchronisation is out of scope.

---

<a id="item-101"></a>

## Item 101 — Plain-language HTTP-status guidance in Routing diagnostics

_Category: Routing diagnostics clarity_

101. **Plain-language HTTP-status guidance in Routing diagnostics**
     - Confirmed current state: Diagnostics already explains why a browser fetch can fail before an HTTP response is exposed, in a disclosure titled "Why a fetch can fail before an HTTP response" (`DiagnosticsScreen.tsx`), covering only the no-response-received ambiguity (a provider outage, a missing CORS header, a DNS/TLS failure, or a local network restriction — indistinguishable from each other). Where a response is received, `describeRoutingAttempt()` (`src/routing/routingDiagnostics.ts`) currently renders only the bare numeric status with no further explanation. This item complements that existing disclosure; it must not duplicate or contradict it.
     - Add a concise disclosure such as "What HTTP statuses mean", or integrate an equally clear structure after inspecting the existing screen's layout.
     - Keep the exact observed HTTP code visible, and explain broad, actionable categories in plain language:
       - 400-class invalid/rejected request;
       - 401/403 key, authorisation or access rejection;
       - 408/timeout where actually exposed;
       - 429 rate/quota limiting;
       - 500-class provider-side failure;
       - no exposed status as the existing transport/CORS/DNS/TLS/local-network ambiguity described above.
     - Do not state a provider-specific cause as certain when a status only supports a likely category. Avoid turning Diagnostics into a general HTTP tutorial.
     - Preserve API-key redaction and the existing distinction between request construction, fetch invocation, exposed HTTP response and transport failure.
     - Require copy/accessibility tests and narrow-phone/enlarged-text layout evidence. No routing behaviour or retry policy changes belong here.

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
