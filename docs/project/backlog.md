# Planning backlog — full pending item specifications

This file holds the complete, byte-preserved specification for every backlog item that is **approved future work but not yet implemented**, plus the two items that are explicitly monitored/investigated-but-unconfirmed (see [current-status.md](current-status.md) instead for those two — items 32 and 66).

Item numbers are stable identifiers across this project's entire documentation set — they never change regardless of which file an item's text lives in. See [README.md](README.md) for the full map of where everything lives, and the root [`CLAUDE.md`](../../CLAUDE.md) for durable product/engineering rules and the required reading order before implementing any item here.

Items 11, 12, 16, 28, 59, 60, 61 and 88–92 below remain approved future work, not yet scheduled into the sequence. Items 87–92 were added by the [release-readiness audit](release-readiness-audit.md) (item 86); item 88 is that audit's own next selected implementation item.

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

<a id="item-90"></a>

## Item 90 — Content-Security-Policy compatibility investigation

_Category: Browser security-policy feasibility (from the release-readiness audit, item 86)_

90. **Content-Security-Policy compatibility investigation**
    - **Outcome.** A written compatibility matrix and a recorded decision — implement a specific CSP now, or explicitly defer with a stated reason — never an unproven policy shipped speculatively. This item's own deliverable is the investigation and its evidence, not a shipped policy, unless that evidence turns out to make implementation both safe and clearly worthwhile.
    - **Evidence/justification.** Item 86 ([`release-readiness-audit.md`](release-readiness-audit.md) §9) confirmed no DOM-injection sink currently exists in `src/` (so this is a defence-in-depth investigation, not a response to a found vulnerability) and confirmed no CSP or related browser policy is present today. It also surfaced the specific compatibility questions any future policy must answer: MapLibre GL JS's documented `worker-src`/`blob:` requirements (which depend on whether the worker is same-origin, as ACN's bundled build should be, versus loaded cross-origin from a CDN); the tile/style/sprite/glyph and OpenRouteService hosts a working `connect-src`/`img-src` would need to allow; `vite-plugin-pwa`'s generated service-worker's own requirements; and that GitHub Pages' static hosting means any policy would most plausibly ship via a `<meta http-equiv="Content-Security-Policy">` element, which cannot deliver `frame-ancestors` or some other directives at all — a documented platform limitation, not an implementation gap to work around.
    - **Scope.** Enumerate every script, style, worker, blob, network endpoint, map style/tile/sprite/glyph host, and routing-provider host ACN's current build actually requires (derived from the real built output and network behaviour, not assumed from generic library documentation); draft the specific directive set a working meta-tag CSP would need; identify which desired protections (if any) are meta-tag-undeliverable and must be explicitly accepted as out of reach on GitHub Pages; define how the policy would be exercised under normal maps, fallback-style, routing-failure, offline, and PWA-update flows before it ships; define what reporting/diagnostic approach is possible without introducing analytics/telemetry (explicitly excluded by this project's non-goals) — most plausibly nothing beyond manual browser-console inspection during development.
    - **Non-goals.** No Permissions-Policy, Referrer-Policy, or other browser-policy header/meta addition beyond CSP itself unless the same investigation naturally surfaces one with equally clear justification. No implementation without first completing and recording the compatibility matrix. No change to routing/map/service-worker code merely to make a hypothetical policy simpler to satisfy.
    - **Likely files.** `index.html` (a candidate `<meta http-equiv>` addition, if implemented), no production TS/TSX changes expected unless the investigation finds a genuine current need (e.g. an inline style/script that would need hashing).
    - **Fail-first/characterisation evidence.** Any implementation step must be preceded by real-browser evidence that the drafted policy does not break maps/routing/offline/PWA-update — e.g. a throwaway Playwright run against a build with the candidate policy applied, checking for CSP-violation console errors across Planning, Riding, offline fallback, and a forced map-style failure, before it's considered safe to ship even provisionally.
    - **Update strategy.** Not applicable — no dependency changes.
    - **Narrow verification during development.** Manual browser-console CSP-violation inspection during the investigation phase; if implemented, the fail-first Playwright evidence above.
    - **Complete repository gate required (only if implemented):** the full standard gate, plus the CSP-specific real-browser check above.
    - **Documentation/version rules.** No version bump for the investigation phase itself. If a policy is later implemented, that implementation is its own, separately-reviewed follow-up slice with its own version-bump decision — this item does not pre-authorise that follow-up's scope, only the investigation.
    - **Rollback/compatibility.** A meta-tag CSP is trivially removable (delete the tag) if it breaks something in production despite pre-implementation testing — low rollback risk if implementation is ever attempted.
    - **Automated vs. real-device acceptance.** Automated (Playwright) evidence can prove no CSP-violation console errors under tested flows; it cannot prove the policy behaves identically on installed-iPhone Safari or physical Android Chrome, which would need separate real-device confirmation before being relied upon there.
    - **Prerequisites/ordering.** None; independent of every other item in this roadmap.
    - **Abandon/revise if:** the compatibility investigation finds that a workable policy would need to allow directives broad enough (e.g. wide `unsafe-inline`/`unsafe-eval` allowances) that the resulting policy would provide negligible real protection — in that case, document that conclusion explicitly and defer indefinitely rather than shipping a policy that exists mainly to be present.

---

<a id="item-91"></a>

## Item 91 — `App.tsx` route-switch coordinator characterization tests

_Category: Verification / maintainability precondition (from the release-readiness audit, item 86)_

91. **`App.tsx` route-switch coordinator characterization tests**
    - **Outcome.** Statement/branch coverage of `src/App.tsx`'s route-switch/unfinished-session coordinator (`checkRideTransition`, `requestRouteTransition`, `confirmPendingSwitch`, `retryPendingSwitchCheck`, `retryFreeRoamWriteForPendingSwitch`, `returnToPausedRide`, `handlePendingSwitchConfirm`/`handlePendingSwitchReturn`/`handlePendingSwitchCancel`, `handleSwitchTargetMissing`) materially improved from its current 79.78%/74.15%, with the specific currently-uncovered branches this item was written to close: `confirmPendingSwitch`'s `"clear-failed"` catch path (the `clearActiveRideState()` rejection branch) and its `"start-free-roam-failed"` path (`writeFreshFreeRoamState()` returning falsy), plus the retry-handler branches around them. This is explicitly a test-only item: **no production behaviour change is proposed or expected.**
    - **Evidence/justification.** Item 86 ([`release-readiness-audit.md`](release-readiness-audit.md) §5 F-3, §11, §12, §14) found `App.tsx` to be simultaneously the most recently hot-churned production file in the repository (15 of 19 all-time commit touches in roughly the last 90 commits, following the item-73 route-switch work) and the lowest-covered one in the entire codebase (79.78% statements against a 93.53% project average), with the specific uncovered statement lines (via `coverage-final.json`, cross-checked against source) sitting almost exactly inside the coordinator's own failure/retry branches rather than being spread evenly across the file. Per this project's own change-discipline rule, a refactor of this coordinator is not justified until its behaviour is characterised first — this item is exactly that precondition, not the refactor itself, and no refactor is proposed here or implied by completing it.
    - **Scope.** Add unit/component tests (most plausibly in `App.test.tsx`, which already exists at 1,760 lines) exercising: a `clearActiveRideState()` rejection during a pending switch (asserts the `"clear-failed"` status, the exact user-visible retry copy, and that `retryPendingSwitchCheck` genuinely re-runs the same guard rather than a different code path); a `writeFreshFreeRoamState()` failure during a pending free-roam switch (asserts `"start-free-roam-failed"` and its retry path); the already-passing-but-uncharacterised happy paths for both a route-target and a free-roam-target switch, if not already fully covered; and `handleSwitchTargetMissing`'s behaviour when a pending switch's target route becomes invisible in a filtered Routes list (the item-73-follow-up behaviour the audited commit itself shipped). Include at least one test asserting the specific data-integrity characteristic item 86 §10 identified: a "crash" (simulated by never resolving/rejecting the second write) between `clearActiveRideState()` and `writeFreshFreeRoamState()` leaves the `rideState` table empty rather than partially written — proving the existing two-step write's failure mode is benign, not silently proving it's fine by omission.
    - **Non-goals.** No extraction of this coordinator into a separate module/hook. No change to `confirmPendingSwitch`'s two-step (non-transactional) write itself — item 86 judged its current failure mode bounded and already reasonably handled via explicit retry states; wrapping it in a Dexie transaction is not in scope here and would need its own justification if ever proposed. No coverage work on any other file (item 89 covers `mapAdapter.ts` and the import cycles separately).
    - **Likely files.** `src/App.test.tsx` (primary), `src/App.tsx` (read-only reference, not edited), possibly `src/ui/riding/rideSessionTransition.ts`'s own test file if a genuinely uncovered classification branch is found there too while investigating.
    - **Fail-first/characterisation evidence.** Each new test must first be confirmed to actually exercise the intended uncovered branch (via a scoped `npx vitest run --coverage src/App.test.tsx` or equivalent before/after diff on `App.tsx`'s own coverage line), not merely added and assumed to help — this item's entire value is precise coverage of specific named branches, not test-count growth.
    - **Update strategy.** Not applicable — no dependency changes.
    - **Narrow verification during development.** Scoped `npm test -- App.test.tsx` reruns after each new test; a targeted coverage diff on `src/App.tsx` specifically to confirm the named lines move from uncovered to covered.
    - **Complete repository gate required:** `npm run format`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run e2e`, `npm run format:check` (last) — all must stay green, and the full suite's total test count should only grow, never shrink or change behaviour of an existing test beyond what's newly described above.
    - **Documentation/version rules.** No version bump — test-only change, zero production behaviour difference. Record the coordinator's before/after coverage figures in this item's completed-history entry as the evidence of what was actually closed.
    - **Rollback/compatibility.** Zero production risk — this item cannot itself introduce a regression, since it changes no production code.
    - **Automated vs. real-device acceptance.** Fully automated; no real-device acceptance applies, since no user-visible behaviour changes.
    - **Prerequisites/ordering.** None; independent, and recommended (not required) before any future extraction of this coordinator, per the `0.4.0`/`1.0.0` release-decision model in [`release-readiness-audit.md`](release-readiness-audit.md) §17.
    - **Abandon/revise if:** while writing these tests, the coordinator's actual behaviour in the failure branches turns out to differ materially from what item 86's static reading inferred (i.e. the code doesn't do what the comments/audit assumed) — in that case, stop, report the discrepancy, and treat _that_ as a new, separately-triaged finding rather than writing a test that encodes an incorrect assumption as if it were confirmed behaviour.

---

<a id="item-92"></a>

## Item 92 — Storage-health quota/estimate signal

_Category: Data-integrity / diagnostics enhancement (from the release-readiness audit, item 86)_

92. **Storage-health quota/estimate signal**
    - **Outcome.** The Diagnostics screen's storage-health display can distinguish three states instead of today's two: the database genuinely failing to open (today's "error"/"Unavailable"), the database open and comfortably within quota (today's "ok", unchanged), and the database open but under meaningful quota pressure (new) — using `navigator.storage.estimate()` where the browser supports it, with an explicit, honest "not available in this browser" fallback where it doesn't (this API is not universally available, notably has known gaps in some in-app/private-browsing contexts), never a fabricated number.
    - **Evidence/justification.** Item 86 ([`release-readiness-audit.md`](release-readiness-audit.md) §5 F-6, §10) read `src/storage/storageHealth.ts` directly and confirmed `useStorageHealth` reports health purely from whether `db.open()` resolves or rejects — no `navigator.storage.estimate()`/`persisted()` call exists anywhere in the codebase (confirmed by exhaustive grep) and no live write probe exists either. This means "opened successfully but now failing writes under quota pressure" is currently indistinguishable from full health in Diagnostics, which is exactly the situation a rider would most want surfaced before it causes a lost route or ride.
    - **Scope.** Add an `estimate()` call (feature-detected via `"storage" in navigator && "estimate" in navigator.storage`) to `useStorageHealth`, surfacing used/quota figures (or a fraction) alongside the existing `status`/`schemaVersion`; render this in `DiagnosticsScreen.tsx` alongside the existing "OK (schema version N)" text, with a distinct, honest "Storage estimate unavailable in this browser" state when the API is absent, and a warning-but-not-error presentation (never colour-only, per this project's accessibility rule) when used/quota crosses a reasonable, documented threshold (e.g. 90%). Do not add a live read/write probe beyond the existing `db.open()` check — `estimate()` is the specific, low-risk gap item 86 identified; a full write-probe is a larger design decision left for a future item if ever justified by real evidence of the `estimate()` signal itself being insufficient.
    - **Non-goals.** No change to storage _behaviour_ — this is a read-only diagnostic addition, not a quota-management or eviction-handling feature. No change to the `rideState`/`routes`/other table schemas. No bulk-export/backup feature (item 86 §4/§13/§20 explicitly declined to create one from this audit's findings) — do not fold one in here.
    - **Likely files.** `src/storage/storageHealth.ts`, `src/ui/diagnostics/DiagnosticsScreen.tsx`, their respective test files.
    - **Fail-first/characterisation evidence.** Add a test asserting the current behaviour first (feature-undetected browsers show the new explicit "unavailable" state, not a silent absence of any quota row) before adding the happy-path estimate-rendering test, so the fallback path is provably exercised, not merely assumed to work because the API-present path does.
    - **Update strategy.** Not applicable — no dependency changes; `navigator.storage.estimate()` is a native Web API already usable without a new package.
    - **Narrow verification during development.** `npm test -- storageHealth` and `DiagnosticsScreen` scoped reruns; manual check in a real browser's devtools (Chromium supports `navigator.storage.estimate()` and its devtools can simulate quota pressure) that the warning threshold actually renders under a simulated low-quota condition.
    - **Complete repository gate required:** `npm run format`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run e2e`, `npm run format:check` (last).
    - **Documentation/version rules.** A small, genuinely user-visible Diagnostics addition — follow this project's existing precedent for whether a patch version bump is warranted for a Diagnostics-only, non-breaking addition; record the decision in this item's completed-history entry.
    - **Rollback/compatibility.** Low risk and easily revertible — purely additive to `StorageHealth`'s return shape and Diagnostics' rendering; no schema or repository change, so no migration/compatibility concern.
    - **Automated vs. real-device acceptance.** Automated coverage can prove both the feature-detected and fallback rendering paths render correctly; confirming the warning threshold's real-world usefulness (whether 90% is the right number, whether iOS Safari's own `estimate()` behaviour matches Chromium's) needs real-device observation over time, not a one-off check, and should be tracked as an open observation rather than claimed as verified from automated evidence alone.
    - **Prerequisites/ordering.** None; fully independent of every other item in this roadmap.
    - **Abandon/revise if:** real-browser investigation finds `navigator.storage.estimate()`'s figures are too coarse, too rarely updated, or too inconsistent across the browsers ACN actually targets (Safari iOS, Chrome Android) to produce a trustworthy warning threshold — in that case, ship only the honest availability/unavailability distinction without a numeric threshold-based warning, and record why the threshold itself was dropped.
