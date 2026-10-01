# Current status — manual acceptance and monitored reliability

This is the authoritative record of what has actually been verified on real hardware, distinct from `backlog.md`'s approved-but-not-yet-built future work. It has three parts:

1. **The open installed-iPhone checklist** — the single authoritative list of presently actionable physical checks, organised by practical test session rather than by implementation order.
2. **The dated acceptance record** — what has been confirmed, when, on which build, and precisely what each report did and did not assert.
3. **Monitored reliability observations** — items that are neither approved future work nor fully resolved (items 66 and 32), plus the item 43 follow-up ledger.

This file records verification evidence only; the behaviour contracts themselves are defined in the root [`CLAUDE.md`](../../CLAUDE.md) and in `backlog.md`/`history/`, and are not restated here. See [README.md](README.md) for the full documentation map.

---

## How to read this ledger

- **Phone portrait is ACN's only supported and acceptance-tested orientation** (decided 9 September 2026) — the orientation a bike computer is used in. Every short-landscape acceptance requirement that previously appeared here has been **retired**. This is a product decision, not a technical lock: landscape is not deliberately broken, no rotation-blocking overlay exists, and nothing here claims orientation is locked. Whether to request portrait through the web-app manifest is a separate implementation decision requiring its own installed-iPhone verification, and is not approved by it. Landscape evidence already recorded in `history/` is left untouched as the account of what was tested at the time.
- **Automated evidence is not physical acceptance**, however deterministic it is. Playwright's `android-chrome` project is Chromium with a Pixel-7 viewport, user agent and device-pixel ratio — not Android Chrome or WebView.
- **iOS Larger Text is not an acceptance mechanism here.** ACN has no Dynamic Type opt-in, so the system setting does not resize this application at all; the automated 200% root-font-size Playwright coverage is the enlarged-text evidence. Do not re-add it as a manual check.
- **A broad product-level field report accepts intended user-facing behaviour, not every granular clause.** Where a ride confirms that an item works, that is what is recorded — never that each artificial failure mode, timing boundary or recovery variant was separately induced.
- **Nothing on the checklist is to be manufactured.** Conditions that cannot be induced safely or deterministically live under opportunistic monitoring and do not block acceptance.
- **The dated record is split across two files, for size only.** Its sessions from 25 September 2026 back to 10 September 2026 continue, unchanged, in [`current-status-archive.md`](current-status-archive.md) (moved on 1 October 2026). This file remains the only entry point and the only place new evidence is recorded.
- The clause-level per-item checklists this file carried until 12 September 2026 were consolidated into the one checklist below. Their earlier wording remains in this file's own git history (commit `7383ae0` and earlier), and each item's implementation detail, limitations and rejected alternatives remain in [`history/`](history/README.md).

---

## Open installed-iPhone acceptance checklist (12 September 2026)

**This is the only active list of presently actionable installed-iPhone checks.** Items 103, 120 and 122 are unimplemented and therefore out of scope — item 122 is scheduled for its design stage, under the execution order revised on 1 October 2026 and held in the root [`CLAUDE.md`](../../CLAUDE.md) — and items 125–127, 129 and 130 are unscheduled candidates. **Item 124's first slice (Clear draft and Delete route, `0.4.51`) was accepted on the installed iPhone, reported 1 October 2026, and no longer appears here.** Its third slice — Planning's Save separated from opening a ride, and an unconfirmed Delete dismissed when filtering hides its route — shipped in `0.4.52` and is checked in Session 5; item 124's other inventory cases await the rider's review. **Item 128 (`0.4.50`) was accepted on the installed iPhone in English and German, reported 1 October 2026, and no longer appears here.** **Item 102 (`0.4.49`) was accepted on the installed iPhone, reported 30 September 2026, and no longer appears here.** **Item 123 (`0.4.46`) was accepted on the installed iPhone, reported 30 September 2026, and no longer appears here. Item 119 was accepted on the installed iPhone on `0.4.48`, reported 30 September 2026, and no longer appears here either.** **Item 114's one device check, ordinary-text Planning on `0.4.45`, passed on the installed iPhone on 29 September 2026 and no longer appears here**; its enlarged-text layout has automated evidence only, because it cannot be reached on the iPhone through Larger Text. **Item 121 (`0.4.44`) was accepted on the installed iPhone, reported 29 September 2026, and no longer appears here**; one open device finding from that session awaits investigation, in its own subsection below. Item 113 shipped German in `0.4.41`. Its first physical pass (25 September 2026) produced the `0.4.42` follow-up. That recheck (reported 28 September 2026, recorded below) passed apart from three findings corrected in `0.4.43`. **The `0.4.43` Status-wording and End-confirmation rechecks passed on 28 September 2026**, and only the climb cue's recheck remains, in Session 2. **Item 118 is complete and no longer appears at all**: its shipped same-card containment was accepted on the iPhone on 13 September 2026, and its **conditional-reveal refinement** on 14 September 2026. Items 42, 93, 98, 104, 107, 108, 109, 110, 111, 112 and 117 are accepted on the iPhone and deliberately do not appear here, and so is item 95's `0.4.33` interaction-safety correction, accepted on 12 September 2026. **Item 112's acceptance completed on 13 September 2026**, when its missing-key hint was finally exercised, and **item 117 was accepted the same day**; neither has a check left here. Item 95's broader switch-prompt scope still appears in Session 1, and its own earlier acceptance is unchanged and is not reopened. Item 115 has shipped with automated evidence only and does appear, in Sessions 2 and 3. Bracketed item numbers are for traceability only — each item's own detail lives in [`history/`](history/README.md).

### Session 1 — stationary, on the installed Home Screen PWA

- [ ] A genuinely long route title leaves the `Pause`/`Pausing…`/`End ride` header actions full size on both route Riding and free roam, under real iOS safe-area insets, and the sticky navigation's bottom divider sits flush with no dead strip (items 68, 76).
- [ ] A real cold relaunch reaches the active immersive map from exactly one launcher `Resume ride` tap, with a single permission prompt and one GPS watch (item 72).
- [ ] Switching to a different route from a card well down the Routes list expands the prompt inside that card without the page jumping, and `End and switch`, `Return to paused ride` and `Cancel` each behave; route→free roam, free roam→route and same-session recovery behave correspondingly (items 73, 95). Planning's entry path changed in `0.4.52`: Save no longer opens anything, and Open saved route's guarded confirmation is checked in Session 5.
- [ ] Route Library sorting: pinned routes keep their position under every order, a chosen sort survives a genuine reload, and a route with no recorded ascent reads as "ascent not available" and sorts last (item 99).
- [ ] An imported untrusted GPX compacts its no-turn-cues warning after about ten seconds, keeps the compact control through a Map/Profile switch, and VoiceOver announces the warning once and describes the control's expanded/collapsed state (item 97).
- [ ] Settings reads correctly with no route open: the `Riding` wake-lock explanation and the `Local gradient colours` disclosure (items 79, 82).

### Session 2 — one representative ride on a route with a recognised climb and descent

- [ ] Remaining distance and remaining ascent stay sensible through genuine climbs and descents (items 69, 75). **The off-route excursion and recovery was accepted in the field on `0.4.42`**, at product level, together with route navigation. The climb and descent clause was not separately reported and stays open.
- [ ] The Profile pane reads at a glance and never needs to scroll at normal text size — distance guides and their gutter labels, the upcoming-climb preview handing over to live climb progress without the Map cue ever appearing for a merely upcoming climb, and the compact local-gradient and active-standard summaries (items 57, 70, 71, 79, 80, 85).
- [ ] Pre-ride, recognised climbs read in their category colours against plain black descents, and selected-feature inspection works from both a map tap and a chart tap (items 77, 79, 85).
- [ ] The status card stays legible while mounted and moving, on route Riding and free roam alike, and `Screen on` is usable one-handed with gloves, read by its `On`/`Off` cue rather than by colour (items 75, 82).
- [ ] The four-slot elevation-window selector is comfortable and equally sized with its selected ring uncut at both ends, and the recognised-climb picker is usable with gloves (items 76, 78, 79, 80).
- [ ] Distance badges stay restrained and readable while genuinely moving: density across real zoom levels, a naturally advancing rolling window, passed badges disappearing, and none at all in free roam (item 84).
- [ ] **The `0.4.43` climb-cue recheck (item 115, still open).** The `0.4.42` ride found the cue covering the blue position marker and the route next to it in a shorter map. The 28 September 2026 recheck of `0.4.43` did **not** exercise the cue, so it remains pending. On a ride with a recognised climb, check that:
  - the cue in the map's lower right shows `Ansehen` / `View`, and leaves the marker and the nearby route visible, including in a **shorter map** (a status card carrying an imagery message, plus the manoeuvre panel);
  - `Ansehen` / `View` still opens the climb;
  - a manual gesture's `Folgemodus pausiert.` / `Map follow paused.` toast appears below the cue without either being obscured;
  - the cue stays clear of the controls and the attribution.

### Session 3 — a deliberately controlled recovery and offline session

Stationary or walking. Induce only what is deliberate and reproducible; everything nondeterministic belongs to the monitoring list below.

- [ ] An in-session Pause and one-tap `Resume ride` restarts GPS and Follow with route progress, camera state, elevation-view selection, wake-lock preference, dismissed-climb identity and completion-armed state all intact (items 72, 73).
- [ ] A deliberate location-permission interruption and its recovery keeps the last fix visibly stale and then returns to a fresh fix, without losing the rider-chosen Follow zoom or the below-centre look-ahead anchor (items 75, 81).
- [ ] With imagery unavailable (flight mode, or an uncached area), the route, position, climb cue, controls, attribution and the Map/Profile switcher all stay usable, and the status card's `Retry map imagery` action and the Profile controls stay reachable together (items 81, 83).
- [ ] Pressing `Retry map imagery` while still offline, using the Zoom in/out buttons, and panning substantially by hand each preserve the established camera instead of collapsing to a world view (item 94).
- [ ] A camera established purely by manual gesture, with no prior geolocation framing, survives that same sequence (item 94).
- [ ] The imagery-recovery row reads as one row — explanation on the left, `Retry map imagery` on the right — on both route Riding and free roam, with the full button label intact, and the slow-imagery row still spanning the full width with no action (item 115).
- [ ] Online/Offline is comprehensible without relying on colour, and the recovery row clears itself once connectivity and imagery return, with no pan or zoom needed (item 83).

### Session 4 — item 113's German interface: what remains

**Item 113's `0.4.42` corrections passed on the installed iPhone** (reported 28 September 2026), apart from three findings corrected in `0.4.43`. **The `0.4.43` Status-wording and End-confirmation rechecks then passed** (also reported 28 September 2026). Both dated records are below; the climb cue's recheck is in Session 2. Portrait. **Read the version and build from Status first.**

- [ ] **Carried over, still unreported:** `Gerätesprache` on a German-configured phone gives German, and on an English-configured phone gives English.

**Deferred or optional, not blockers:**

- **VoiceOver**, including whether the climb selector's `Nicht kat.` / `uncat.` abbreviations read understandably. It was deliberately not tested and does not hold up item 113's follow-ups.
- **The End confirmation's focus behaviour** (Cancel focused, focus returning to End) **and its English half.** Both have automated evidence only and were not claimed in the 28 September recheck; they are optional device checks.

No iOS Larger Text result and no physical-Android result is claimed for item 113 in either language.

### Session 5 — item 124's third slice: saving, opening and filtering (`0.4.52`)

Stationary, portrait, on the installed Home Screen PWA. **Read the version and build from Status first.** For checks 2 and 3, first leave a ride paused on some other route.

- [ ] **Save route** in Planning stays in Planning: nothing moves away, a message beneath Save names the saved route, and nothing asks about the paused ride.
- [ ] With that other ride paused, **Open saved route** shows the switch confirmation directly beneath it, fully visible, with no scrolling up to find it.
- [ ] **Cancel** closes it where you are, with Open saved route still visible; the paused ride can still be resumed, and the saved route is in Routes.
- [ ] With nothing unfinished, **Open saved route** goes straight to that route's pre-ride screen.
- [ ] In Routes, open **Delete** on a route, then type in the search until that route disappears, and delete the text again: the keyboard stays open, every letter reaches the search field, the confirmation stays closed when the route reappears, and both routes are still saved. Then the same with a tag filter instead of the search.

Not part of these checks: VoiceOver, a physical Escape key, iOS Larger Text, landscape and physical Android.

### Open device findings — awaiting investigation (not checklist items)

- **Tapping the OpenRouteService key field zoomed the installed page in, and saving did not restore normal zoom**; the rider had to zoom out by hand. Seen during item 121's acceptance on `0.4.44` (the dated record below). **No cause is established and no investigation has been made**, and it is **not** attributed to item 121 as a regression. It is kept here for follow-up rather than as a check to repeat.
- **After denying location permission in the installed PWA, the rider did not find a way to grant it again during that session**; fully closing and reopening the PWA allowed another permission prompt. Seen during item 114's check on `0.4.45` (the dated record below) and filed as unscheduled [item 129](backlog.md#item-129). Nothing is established yet about how iOS handles a retry.

### Open observation from automated testing — not a checklist item, not a numbered item

- **A mouse double-click on the Planning map adds two waypoints and also zooms in.** Measured on `0.4.45` in the pinned Playwright container — desktop Chromium, Chromium with the Pixel-7 profile driven by a mouse, and desktop WebKit — during item 123's investigation: MapLibre fires a `click` for each press before its `dblclick` zoom, and Planning appends on each mouse click. **It is unchanged by item 123**, which keeps direct mouse placement exactly as it was, and it is recorded here so it does not disappear into item 123's history. No fix is approved and no item number is allocated; whether it matters is the rider's decision.

### Opportunistic monitoring — watched for, never manufactured

- Natural storage pressure and the Status screen's 90% warning appearing as designed, and whether the usage/quota figures stay plausible as ordinary use grows (item 92). Do not fill the phone's storage to produce either.
- A genuinely slow — not fast, not failed — imagery load: the notice waiting about two seconds, route and position content immediate regardless, and no false `initial-load-timeout` in Status (item 96).
- Connectivity returning while imagery itself stays unreachable, and a later genuine retry succeeding after such a recovery (item 94).
- Genuine wake-lock, routing-provider, storage-read or IndexedDB-write failures and their retry paths (items 72, 73, 82, 92, 100) — proved in tests, and not safely or deterministically inducible on the phone.
- Longer battery and thermal behaviour over a long ride (items 42, 60).
- German `Wird pausiert…` while a Pause is still being saved, which briefly narrows the riding header's title; and a `GPS ±N m` status line on the narrowest phones. Both are transient or width-dependent and are watched for rather than staged (item 113 follow-up).
- The transient `Waiting…` state on the Location/Follow control, which a fast first fix may simply skip (item 110). It has never been observed on the device in either language; item 120 covers a possible pending-state treatment and must not be written up as though a field problem had been confirmed.

None of these blocks acceptance of the item it came from. Record one if it occurs naturally; do not construct it.

### Physical Android — one umbrella

**No part of ACN has been verified on a physical Android phone.** Playwright's `android-chrome` project is Chromium emulation, not a substitute. Item 25's checklist is [`../android-chrome-acceptance.md`](../android-chrome-acceptance.md); extend it when a device is available rather than inventing a second acceptance document. This single statement covers everything in this file and in its continuation, [`current-status-archive.md`](current-status-archive.md) — including all items recorded in either as accepted on the iPhone — and is deliberately not repeated per item.

---

## Monitored, corroborating only

- **The contention-sensitive map/camera e2e class is confirmed present on the parent commit (14 September 2026, measured during item 113 stage 1).** Under 36-worker full-suite runs in the pinned container, the parent commit `df2e6c0` failed **exactly one test in each of three consecutive full runs** (380 passed, 1 failed, every time), with the failures landing in `e2e/mapImageryRecovery.spec.ts`'s reconnection-recovery camera-anchor test, `e2e/ridingActiveDirectionLayer.spec.ts`'s overlapping-return-leg test and `e2e/fetchInvocation.spec.ts`. The item 113 branch produced the **same tests** at a comparable rate across its own runs, and each passed **6/6 in isolation**. `anchorWithinTolerance` returns `false` when an anchor reads as `null`, so an unresolved read under contention presents as a tolerance failure rather than as a timeout.

  This upgrades the earlier "consistent with" note for this file to a **measured, reproduced-on-baseline** finding: the class is pre-existing and is **not** attributable to item 113's pre-render IndexedDB read, which was the specific hypothesis worth ruling out, since that change does add a blocking database open before the first paint. No production change was made for it, and it remains monitored rather than fixed — if it is ever worked on, start from the artefacts item 116 retains. The route-riding reconnection test in `mapImageryRecovery.spec.ts` now has its own unscheduled investigation, [item 130](backlog.md#item-130).

## Dated acceptance record

### Installed-iPhone observations of Planning's save-and-switch and a hidden Delete (item 124's C-14 and D-03, reported 1 October 2026)

**Device and build.** Installed Home Screen PWA. **The build and the language were not stated**, so neither is recorded. The behaviour observed is what slice 3 then changed.

- **C-14 — Planning's Save while another ride was unfinished.** Saving caused no automatic movement. The switch confirmation appeared at the top of Planning, and the rider had to scroll up to find it. Cancel removed it without moving the view; the route had been saved, and the original ride stayed resumable.
- **D-03 — a search hiding a route whose Delete confirmation was open.** Removing the search text made the software keyboard vanish and brought the Delete confirmation into the top third of the screen. After Cancel, both routes remained saved.

These are observations of existing behaviour, recorded as the device evidence behind the approved slice 3 changes ([`backlog.md`](backlog.md#item-124)); they accept nothing. The slice 2 inventory's measurements of the same two cases are desktop-browser evidence, recorded in [`docs/design/reveal-inventory/`](../design/reveal-inventory/README.md), and are not re-asserted by this report.

### Installed-iPhone acceptance of `0.4.51` (build `04639cb`, item 124 slice 1, reported 1 October 2026)

**Device and build.** Installed Home Screen PWA, portrait, at the phone's ordinary text size; version `0.4.51`, build `04639cb`, as reported. That build is the deployed `0.4.51` (Deploy run `36884939494`).

**The rider's report, verbatim:** "The checks 1-6 pass." — all six of item 124's Session 5 checks, so that session is complete for this device:

- Clear draft near the bottom of the screen opens fully visible, clear of the navigation and the home indicator, with no movement after it appears;
- Cancel preserves the draft, leaves Clear draft visible, and does not restore the page position from before opening;
- Clear draft high on the screen opens without moving the page;
- Delete route on the last card opens with its actions visible, and Cancel preserves the route and leaves Delete visible;
- scrolling by hand while either confirmation is open is respected on cancelling, with only the minimum correction needed to reveal its opening button;
- opening Clear draft from the route-name field with the software keyboard open works: once the keyboard has closed the confirmation is visible, and Cancel preserves the name.

This **accepts item 124's first slice on the installed iPhone**, at product level. It closes **slice 1 only**: item 124 stays active, and its slice 2 is an inventory and review ([`backlog.md`](backlog.md#item-124)).

**The keyboard-open path passed on this iPhone.** Desktop browsers have no software keyboard and did not reproduce that transition; the automated evidence for it remains only the focus hand-off from the focused route-name field.

**Separate from the automated evidence.** The browser geometry, baseline and negative controls, in Chromium and WebKit in the pinned container, are recorded in item 124's [slice 1 record](backlog.md#item-124). This report neither re-verifies nor replaces them, and they remain automated evidence.

**Not claimed:** the language the checks were made in — the report does not say, so no separate English or German acceptance is recorded; use of a physical Escape key; focus behaviour under assistive technology, including VoiceOver; iOS Larger Text; landscape; physical Android.

### Installed-iPhone acceptance of `0.4.50` (build `3ebf4ce`, item 128, reported 1 October 2026)

**Device and build.** Installed Home Screen PWA, portrait, at the phone's ordinary text size; version `0.4.50`, build `3ebf4ce`, as reported. That build is the deployed `0.4.50`: `3ebf4ce` is a test-only commit following `47f8c40`, whose own run did not deploy ([history](history/items-118-NN.md#item-128)).

**Passed in English and in German** — all three of item 128's Session 5 checks, so that session is complete for this device:

- with map imagery unavailable, the red placement crosshair stays fully visible below Planning's imagery message, and **Retry map imagery** still retries;
- a failed **Locate me**, a selected warning and a selected recognised climb each show their message below the map, readable and without overlapping the imagery message;
- when each of those messages clears, its space closes with no leftover gap, and the map frame does not move.

This **accepts item 128 on the installed iPhone in both languages**, at product level.

**Separate from the automated evidence.** The ring-clearance measurements, fail-first runs and negative controls, in Chromium and WebKit in the pinned container, are recorded in item 128's [history](history/items-118-NN.md#item-128) and its [design record](../design/planning-imagery-banner/README.md). This report neither re-verifies nor replaces them, and they remain automated evidence.

**Item 129 stays open.** The failed-Locate-me check passing does not resolve [item 129](backlog.md#item-129)'s finding about recovering from a denied location permission in the installed PWA.

**Not claimed:** VoiceOver, iOS Larger Text, landscape, physical Android, or a separately tested light or dark appearance. Nor does it resolve the informative 320×568 German case, which still overlaps the crosshair by 15 px in automated measurement and is carried into [item 122](backlog.md#item-122).

### Installed-iPhone acceptance of item 102's navigation icons (`0.4.49`, reported 30 September 2026)

**Device and build.** Installed Home Screen PWA, after item 102's icons shipped in `0.4.49`. The report stated no version, build or device model, so none is recorded as read from Status; the acceptance is associated with the shipped `0.4.49` work.

**The rider's report**, verbatim: "All the icons look good and feel natural, the checks pass!" The rider explicitly authorised recording it as item 102's acceptance.

**Accepted**, as broad product-level acceptance of the new navigation icons — the list, bicycle, dotted trail and gear — which **closes item 102's Session 5** and removes it from the checklist above. The report did not itemise that session's checks, so no individual result is recorded: not English or German separately, not light or dark appearance, and not selection behaviour.

**Separate from the automated evidence.** The pixel comparison against the chosen artwork, and the navigation geometry and accessibility tree measured identical to `0.4.48`, are container evidence recorded in the item 102 entry below and in its [history](history/items-100-103.md#item-102). This report neither re-verifies nor replaces them.

**Not claimed:** VoiceOver (the accessible names are unchanged and the icons stay hidden from assistive technology), iOS Larger Text, landscape and physical Android.

**Decision the same day.** The rider approved a revised execution order, led by [item 128](history/items-118-NN.md#item-128) and then [item 124](backlog.md#item-124); the root [`CLAUDE.md`](../../CLAUDE.md) holds the order and its rationale.

### Installed-iPhone acceptance of `0.4.48` (build `bf09776`, item 119, reported 30 September 2026)

**Device and build.** Installed Home Screen PWA, stationary and portrait as Session 5 specified; version `0.4.48`, build `bf09776`, as reported.

**Passed** — both remaining Session 5 paths, so that session is complete for this device:

- with a route ride paused and another route's switch prompt armed, **End and switch pressed from Ride** opened the new route fresh, with **Start riding** and none of the paused route's progress — the `0.4.47` finding below, corrected;
- with the same prompt armed, the Settings **Delete key** confirmation overlapped it, each Cancel closed only its own confirmation, and the switch prompt returned inside its route card on Routes;
- after each switch, closing and reopening the app offered nothing to resume.

Together with the `0.4.47` passes below — the stale-prompt check and the representative single confirmations, which stand and were not repeated — this **accepts item 119 on this iPhone**, at product level.

**Not claimed:** VoiceOver announcing each confirmation's own title and message, which stays deferred; physical Android.

### Installed-iPhone check of `0.4.47` (build `187b752`, item 119, reported 30 September 2026)

**Device and build.** Installed Home Screen PWA, portrait; version `0.4.47`, build `187b752`, as reported.

**Passed:**

- the stale-prompt check — with a switch pending, resuming the paused ride from the Ride launcher left no prompt behind;
- the representative single confirmations.

**Finding, fixed in `0.4.48`.** With route A paused, route B's switch prompt opened from Routes, and End and switch pressed from **Ride**, B opened showing **Resume ride** instead of **Start riding**. The same path in Chromium and WebKit also stored A's fix and progress under B's route id, and offered to resume B after a reload. The cause and fix are in [`history/items-118-NN.md`](history/items-118-NN.md#item-119).

**Not claimed:** the rest of the overlapping-switch check, which was not reported as passed and is rechecked in Session 5; VoiceOver; physical Android.

### Installed-iPhone acceptance of `0.4.46` (build `94a4488`, item 123, reported 30 September 2026)

**Device and build.** iPhone 13, installed Home Screen PWA, portrait; version `0.4.46`, build `94a4488`, as reported.

**Passed** — all four of item 123's Session 5 checks, so that session is complete for this device:

- the empty-draft hint in English and German;
- a tap, a small pan, a pinch, a double-tap zoom and a double-tap-and-drag zoom add no waypoint and no Undo entry, with an empty draft and with a calculated route;
- the crosshair control's Add, Move and Insert after act on the intended waypoint, and a map tap while Move or Insert after is pending neither completes it nor changes the label;
- a Planning warning and a recognised climb on the Riding map before the ride still select on a tap.

**Not claimed:** VoiceOver, landscape, enlarged text, physical Android, an Apple Pencil, or an external mouse or trackpad. The mouse double-click observation above is unchanged and remains separate.

### Installed-iPhone check of `0.4.45` (build `bac3553`, item 114, reported 29 September 2026)

**Device and build.** iPhone 13, installed Home Screen PWA, portrait, ordinary text size; version `0.4.45`, build `bac3553`, as reported.

**Passed** — item 114's ordinary-text Planning check, and only that:

- The OpenStreetMap attribution and the `Add waypoint here` placement button remain clear of each other.
- The red crosshair is visible.
- A failed `Locate me` shows its message inside the map.
- Add, Move and Insert after place waypoints correctly.
- The map pans when dragged beside and above the placement button.

**Not claimed:** any physical acceptance of item 114's enlarged-text layout, which cannot be reached on the iPhone through Larger Text; its 200% browser-text evidence stays automated (Chromium and WebKit in the pinned container) and is never iOS Dynamic Type; its informative 250% limitations are unchanged; [item 128](history/items-118-NN.md#item-128)'s ordinary-text imagery-banner collision with the crosshair was not rechecked and is neither resolved nor accepted; no VoiceOver audit; and no physical-Android result.

**Observation, filed as [item 129](backlog.md#item-129).** To exercise the `Locate me` failure message, the rider denied location permission in the installed PWA. The message appeared correctly — that is the check above — but the rider did not find a way to grant permission again during that PWA session; after fully closing and reopening the PWA, another permission prompt appeared. It is recorded as an unscheduled usability investigation; no claim is made that a denial is permanent or that no in-session way exists.

**Decision the same day.** [Item 123](history/items-118-NN.md#item-123) — accidental waypoint placement during touch panning or zooming in Planning — was promoted to the front of the approved execution order, with the rider's preferred design direction recorded in its entry.

### Installed-iPhone acceptance of `0.4.44` (build `8027c6a`, item 121, reported 29 September 2026)

**Device and build.** iPhone 13, installed Home Screen PWA, portrait; version `0.4.44`, build `8027c6a`, as reported. The checks came in two reports the same day; the second completed the three that the first left open.

**Passed**, recorded as broad product-level acceptance of item 121's intended behaviour:

- All four German primary tabs fit and remain tappable. This settles on the device the 25 September 2026 finding that `Einstellungen` wrapped its final `n` in the five-tab bar.
- The `Settings / Status` switcher stays visible beneath the primary navigation while scrolling and does not cover content. The visible headings make sense without the large page title.
- Returning to the Settings tab from another tab reopens the last-viewed Settings or Status view. Tapping the Settings tab while Status is shown opens Settings.
- With no OpenRouteService key configured — a condition the rider set up on the device — Planning's `Open Settings` appeared and opened Settings directly.
- Each newly selected Settings or Status view starts at the top. Re-tapping the Settings tab while Settings is already shown preserves its scroll position.
- An unsaved, non-secret placeholder in the key field survived Settings → Status → Settings and came back masked. Leaving for another primary tab discarded it.
- With the real keyboard open, the key field and its controls remained reachable; Show/Hide and dismissing the keyboard caused no page jump.
- The four tabs and the switcher passed an English spot check.
- _Second report:_ with the real keyboard open, saving a valid OpenRouteService key worked on the **first tap**, and the key remained saved after leaving Settings and returning.
- _Second report:_ while the key form had focus, the switcher scrolled away with the page; after leaving the form, it stuck beneath the primary navigation again.
- _Second report:_ `Schlüssel löschen` revealed its confirmation and actions as expected. The rider cancelled, and the key was not deleted.

**Language.** The tab-fit check and the `Schlüssel löschen` check were German. The English half was a spot check of the four tabs and the switcher only; the remaining checks are recorded without a language.

**Not separately reported, not claimed, not blockers:** whether the selected tab and switcher view are recognisable without colour, and whether opening a disclosure moves the page.

**Removed from item 121's device checklist: glove use.** Glove compatibility depends on the glove and the touchscreen, so it is not an acceptance criterion here. Ordinary tappability passed; a specific missed tap with gloves can be filed later as a usability finding.

**Not claimed:** confirmed key deletion; that nothing is saved before Save is pressed; `Gerätesprache` resolving from the device language (still in Session 4); 200% text or iOS Dynamic Type; the German key form on an SE-sized screen with enlarged text (automated only, and already short of room above the keyboard before item 121); VoiceOver, including whether the switcher's current view is announced; physical Android; the optional English End-confirmation checks; and the physical climb-cue check, which stays pending until a suitable ride (Session 2).

**Open device finding, kept for follow-up.** Tapping the key field zoomed the page in, and saving did not restore normal zoom; the rider had to zoom out manually. **No cause is claimed and none has been investigated**, and it is **not** recorded as an item 121 regression. It sits in the open-finding subsection above.

**Observation for [item 125](backlog.md#item-125), its outstanding behaviour.** Arriving at Ride or Plan keeps the scroll offset of the screen just left, Routes included, while arriving at Routes shows the top. Item 121's interim top reset applies to the Settings section alone — Settings and Status — and to no other primary screen. Source has no deliberate reset for an ordinary switch to Routes (its one-shot restoration runs only after a route has been opened), so **no cause is claimed** for Routes arriving at the top.

### Installed-iPhone recheck of `0.4.43` (build `aab58c0`, reported 28 September 2026)

**Device:** iPhone 13, installed Home Screen PWA, portrait.

**Passed:**

- **Build identification:** version `0.4.43`, build `aab58c0`.
- **The German Status wording:** the map-imagery heading `Probleme mit dem Kartenmaterial` and its empty state.
- **The End-confirmation checks on route riding and on free roam.**

**Not claimed:** this record does not claim VoiceOver (still deferred, not a blocker), any particular keyboard-focus state (Cancel focused, or focus returning to End), the optional English half of the End checks, or any check beyond those reported.

**Not exercised:** the climb cue. Its `0.4.43` recheck stays pending for a ride with a recognised climb (Session 2).

**A question resolved from source, with no wording change requested.** A freshly calculated route in the German interface showed a turn instruction in the formal address, `Biegen Sie links auf … ab`. A read-only trace of the source and fixtures shows that **ACN passes openrouteservice's own German instruction through**:

- The adapter asks for German with `language: "de"` (`src/routing/openRouteServiceAdapter.ts`).
- `step.instruction` becomes the manoeuvre's instruction unchanged, apart from a 200-character limit (`src/routing/normalizeOpenRouteServiceRoute.ts`).
- It is stored verbatim, in IndexedDB and in the GPX `acn:navigation` round trip.
- Riding shows it, trimmed, in preference to ACN's own label (`RidingNextManoeuvrePanel.tsx`, `RidingCompactManoeuvreCue.tsx`).

ACN's own German fallback labels are infinitives (`Links abbiegen`), and a manoeuvre has no road-name field, so ACN cannot have produced the text. This is item 113's rule that provider text is data, not copy. **Limit of the evidence:** no German openrouteservice response exists in the repository's fixtures, and no live request was made. **You have requested no wording change, so no backlog item is filed.**

**New observations filed as unscheduled backlog items**, all outside the approved execution order:

- [item 124](backlog.md#item-124): Clear draft and Delete route confirmations left out of view on the iPhone, and a common reveal rule;
- [item 125](backlog.md#item-125): per-screen scroll restoration;
- [item 126](backlog.md#item-126): `0.0 km` at climb boundaries;
- [item 127](backlog.md#item-127): discovering `Insert after` in Planning.

### Installed-iPhone recheck of `0.4.42` (reported 28 September 2026)

**Device and build.** iPhone 13, installed Home Screen PWA, portrait; build `0c489db`, version `0.4.42`. The individual sessions' dates were not reported separately. Screenshots: `IMG_8005` (a German outdoor ride), `IMG_8107` and `IMG_8108` (an English route ride, before and after opening the End confirmation).

**Completed**, recorded as broad product-level acceptance of the intended behaviour:

- Session 4's targeted checks of the `0.4.42` corrections:
  - Settings (`Gerätesprache` inside its button, `3 %`, the ORS introduction, the General-cycling description);
  - Planning (generated names, warning rows, the placement control);
  - route riding (the climb selector's closed option; the `Beenden` header label and its confirmation; the paused panel's `Fahrt beenden`);
  - free roam (the `Freies Fahren` title beside `Beenden`, and the end message).
- Status: the German connection-test result line and `Phase` row. **The copied diagnostic report stays English.**
- **The English spot check**, which included switching back to English.
- **In the field:** cycling route navigation, off-route behaviour and free roam were reported passing, and the climb functions worked.
  - `IMG_8005` shows the German status card, next-manoeuvre panel, delayed-imagery message and climb cue during an outdoor ride. The route's stored turn instruction (`Turn sharp right onto R759`) stays English, as designed. That is **observed in the screenshot**, consistent with the rule that a language change translates nothing already stored.

**Findings, corrected in `0.4.43` with automated evidence only:**

1. **German Status wording.** The map-imagery heading and empty state were to be plainer; your wording has been applied.
2. **The header jumped when the End confirmation opened** (`IMG_8107` → `IMG_8108`), in route riding and, by the report, in free roam. The End slot emptied and the centred title moved; the container measures 45.6–47.8 px.
   - **`Pause` is visible in `IMG_8108.PNG` as supplied**, so the reported "Pause absent" is not shown in the capture available. The source always renders it and keeps it enabled while the confirmation is merely open.
   - The behaviour predates item 113 (items 50 and 55).
3. **The climb cue covered the blue position marker and the route next to it** (`IMG_8005`). The German cue was about 169 px wide, in a map about 371 px tall. **This stays open until the `0.4.43` layout is checked on the iPhone** (Session 2).

**Not tested:** VoiceOver (deliberately; deferred, not a blocker), iOS Dynamic Type, and physical Android. **Still open:** `Gerätesprache` resolving from a German- or English-configured phone, and the three `0.4.43` rechecks (Sessions 2 and 4).

### Older dated records — continued in `current-status-archive.md`

The dated acceptance record continues, unchanged and in the same order, in [`current-status-archive.md`](current-status-archive.md): the sessions from **25 September 2026** (item 113's first German pass) back to the **10 September 2026** field test, including "Accepted on the installed iPhone, before 12 September 2026" and "Dated evidence, closures and limitations, by item". They were moved there on 1 October 2026 for size only. It is the same ledger, and that file's introduction says where its "above", "below", "checklist" and "Session N" references now point. The newer records above and the per-item entries below stay here.

### Item 114 — shipped `0.4.45`; ordinary-text device check passed; enlarged-text layout automated only; item 128 recorded

- **What shipped.** At enlarged browser text Planning uses its own layout:
  - the attribution is a permanently visible, linked strip directly below the map;
  - the placement control stays bottom-centre inside the map at its 8px inset;
  - Planning's imagery and status messages sit in normal flow below the strip, as ordinary page status content.

  It engages when the map is small relative to the text: under 17rem of width or height, which is about 106–132% text depending on the size, and never at 100%. At ordinary text Planning is exactly `0.4.44`. The full record, including the measured Stage 0 and Stage 1 comparisons that ruled out every in-map arrangement and chose this one with the rider, is [`history/items-114-117.md`](history/items-114-117.md#item-114).

- **The evidence is automated and precise about its own nature.**
  - It was measured in the pinned Playwright container, in Chromium and WebKit, at 390×844, 320×844 and 375×667, in both languages, for the longest placement labels, with no message, a status message and the imagery fallback banner.
  - At 200% root text, in every case:
    - the attribution, crosshair, placement control, map controls and messages are clear of one another, including the collisions already present on the parent;
    - there is exactly one attribution, with contrast of 7.25:1 in light mode and 9.58:1 in dark mode;
    - the messages and their Retry are visible with the map in view;
    - there is no horizontal overflow.
  - It also has fail-first evidence against the parent, and negative controls.
  - **None of this is iOS Dynamic Type or iOS Larger Text evidence.** The overlap was never observed on an iPhone.
- **Limitations, not passes.**
  - At 250% text (informative only) the enlarged layout covers the crosshair by 13px with some labels at 390×844 and 320×844, and its imagery message falls up to 38.8px below the screen.
  - WebKit here is desktop WebKit in a container.
  - Physical Android is outstanding under the umbrella above.
- **The ordinary-text device check passed on 29 September 2026** (iPhone 13, portrait, `0.4.45`, build `bac3553`; the dated record above). It covers the ordinary-text layout only and claims nothing for the enlarged-text layout.
- **Deployment.** The first push (`143da51`) was not deployed: its End-to-end test step succeeded after 1161 s, but the single CI job exceeded its 20-minute limit and was cancelled, so Deploy was skipped. `bac3553` (workflow only) split the suite into two parallel shards. In that commit's first run (attempt 1) shard 2 passed and shard 1 was cancelled after 630 s, well inside the limit; inspection of the original shard 1 job log showed test results still arriving immediately before the cancellation, and no cause is claimed. The rerun of shard 1 (attempt 2) passed and Deploy followed. The full record is in [`history/items-114-117.md`](history/items-114-117.md#item-116).
- **Item 128, recorded then, and neither resolved nor accepted at the time** — since shipped in `0.4.50` and accepted on the installed iPhone, reported 1 October 2026 (its own entry below). Stage 1 found that at **ordinary** 100% text the in-map imagery banner already covers the crosshair:
  - at 375×667 in English (an 88px banner) and German (105px);
  - at 320×844 in German (139px);
  - from 110% text at 390×844 and from 145% at 430×932.

  Item 114 deliberately leaves the ordinary layout unchanged, so it does not reach this. The measurements are in [`history/items-118-NN.md#item-128`](history/items-118-NN.md#item-128).

### Item 123 — shipped `0.4.46`; accepted on the installed iPhone (reported 30 September 2026)

- **What shipped.** On the Planning map only a mouse click places, moves or inserts a waypoint, decided per click from the pointer sequence that produced it. Touch and pen place through the crosshair control only; touch still selects warnings and climbs; keyboard is unchanged. The empty-list hint no longer says to tap the map. The full record, including the measured Stage 1 event sequences, is [`history/items-118-NN.md`](history/items-118-NN.md#item-123).
- **The evidence is automated.** Genuine CDP touch on Chromium with the Pixel-7 profile, and real touch taps on Playwright's Linux WebKit, in the pinned container; 14 of the 18 new end-to-end tests fail on `0.4.45` and all pass on `0.4.46`, with negative controls. **None of it is installed-iPhone evidence**, and the rider's 25 September 2026 report remains the only physical observation of the defect.
- **Not reproduced, stated plainly.** A pan that both moves the map and places a waypoint could not be reproduced in any engine here: Chromium withholds `touchmove` inside its tap slop, and Playwright's WebKit cannot pan by touch. The change removes it by construction, since no touch click places.
- **Accepted on the installed iPhone** (iPhone 13, portrait, `0.4.46`, build `94a4488`; the dated record above) — all four checks, at product level. The separate mouse double-click observation is recorded above, under automated observations.

### Item 119 — shipped `0.4.47`, follow-up `0.4.48`; accepted on the installed iPhone (reported 30 September 2026)

- **What shipped.** Every confirmation is a named, described, non-modal `role="dialog"` with its own title and description ids, so two open at once each announce their own title. A pending route-switch prompt now yields to a newer ride choice, never clears storage once superseded, makes a newer ride choice wait for any clear already in flight, and returns inside its card when the rider comes back to Routes. The full record, including the Stage 0 measurements, is [`history/items-118-NN.md`](history/items-118-NN.md#item-119).
- **The evidence is automated**: unit tests, and browser-computed names and descriptions in Chromium and WebKit in the pinned container. **None of it is VoiceOver evidence**, which is deferred.
- **Accepted on the installed iPhone** (the two dated records above). The stale-prompt check and the representative confirmations passed on `0.4.47`, which also found that a switch confirmed from Ride opened the new route with the paused route's fix and progress; `0.4.48` keys the ride screen by route and guards the stored row, and its recheck (build `bf09776`) passed both overlapping-switch paths. VoiceOver stays deferred, and no physical-Android result is claimed.
- **An unrelated end-to-end flake measured during the `0.4.48` follow-up** — `mapImageryRecovery.spec.ts`'s route-riding reconnection test — is filed as unscheduled [item 130](backlog.md#item-130). It is not attributed to item 119.

### Item 102 — shipped `0.4.49`; accepted on the installed iPhone (reported 30 September 2026)

- **What shipped.** New icons for the four primary-navigation tabs: direction A's list, bicycle and gear in one 2 px line, with Plan's dotted trail kept and redrawn at that weight. The rider chose them from measured mock-ups ([`docs/design/navigation-symbols/`](../design/navigation-symbols/README.md)). Labels, order, the selected treatment, the Settings/Status switcher, accessible names and behaviour are unchanged. The full record is [`history/items-100-103.md`](history/items-100-103.md#item-102).
- **The evidence is automated.** In the pinned container the implemented header matches the chosen artwork: 114 of 120 icon boxes are pixel-identical and the rest differ only by antialiasing. Navigation geometry and the accessibility tree are identical to `0.4.48`, and the relevant Chromium, `webkit-smoke` and Android-emulation specs pass. **None of it is installed-iPhone evidence.**
- **Accepted on the installed iPhone** (the dated record above), at broad product level from the rider's report; no individual check is recorded as separately passed. **Not claimed:** VoiceOver, iOS Larger Text, landscape and physical Android.

### Item 128 — shipped `0.4.50`; accepted on the installed iPhone (reported 1 October 2026)

- **What shipped**, the rider's C6 choice of 1 October 2026: at ordinary text Planning's imagery message and Retry stay inside the map at its top, and Planning's own three messages sit below the map. The record is [`history/items-118-NN.md`](history/items-118-NN.md#item-128).
- **The automated evidence** is Chromium and WebKit in the pinned container. The informative 320×568 German case still overlaps the crosshair by 15 px; the device acceptance does not resolve it, and item 122 carries it forward.
- **Accepted on the installed iPhone** (`0.4.50`, build `3ebf4ce`; the dated record above) — all three checks, in English and German, at product level. **Not claimed:** VoiceOver, iOS Larger Text, landscape, physical Android and a separately tested light or dark appearance.

### Item 124 — slice 1 shipped `0.4.51`, accepted on the installed iPhone (reported 1 October 2026); slice 3 shipped `0.4.52`, device check pending

- **What shipped:** Planning's Clear draft and a route card's Delete route confirmations now reveal themselves under item 124's rule — no movement when they fit, otherwise the minimum, and the complete Cancel/Confirm row first when they cannot fit — and Cancel/Escape return focus to the opening button while keeping the rider's current position, moving only as far as reveals that button. The record, and slice 2's specification, are in [`backlog.md`](backlog.md#item-124); item 124 stays active.
- **The automated evidence** is Chromium and WebKit in the pinned container, at 390 px portrait, in English and German, at ordinary and 200% root text, with synthetic safe-area insets. Browser text scaling is not iOS Larger Text, and synthetic insets are not physical-device evidence. The rider's original observation — both confirmations staying out of view — was not reproduced in either desktop engine, and no cause is claimed. Opening while the software keyboard closes is not reproducible in desktop browsers.
- **Accepted on the installed iPhone** (`0.4.51`, build `04639cb`; the dated record above) — all six checks, in portrait at ordinary text size, at product level, the keyboard-open path included. It closes slice 1 only. **Not claimed:** the language tested, a physical Escape key, assistive-technology focus behaviour including VoiceOver, iOS Larger Text, landscape and physical Android.
- **Slice 3 — what shipped in `0.4.52`.** Planning's **Save route** only saves: it stays in Planning and shows a message naming the saved route, with a separate **Open saved route** beneath it. Opening goes through the existing ride-transition guard, and its switch confirmation appears directly beneath that action under item 124's rule. Separately, when the search or a tag filter hides a route whose Delete confirmation is open but unconfirmed, the confirmation is dismissed without moving focus or scrolling, and it stays closed when the route returns. The record is [`backlog.md`](backlog.md#item-124).
- **Slice 3 — automated evidence only, so far.** Chromium and WebKit in the pinned container, at 390 px portrait, in English and German, at ordinary and 200% root text. Desktop engines have no software keyboard, so the keyboard staying open is not reproduced: the evidence is where focus and keystrokes go. In Chromium, reopening the confirmation straight after a Cancel that had clamped the page lets the browser's own scroll anchoring restore part of the earlier position before the app's reveal, which ends at the same minimal position. Its device check is **Session 5**.

---

## Monitored reliability observations

These are explicitly **not** approved future work — see each entry's own text for why.

<a id="item-32"></a>

## Item 32 — `ridingFinishAndEnd.spec.ts`'s completion-detection test: primary mechanism diagnosed and corrected; residual sub-case monitored

_Category: Ride lifecycle_

32. **`ridingFinishAndEnd.spec.ts`'s completion-detection test: primary mechanism diagnosed and corrected; residual sub-case monitored**
    - Found 2026-08-12 while hardening the four `page.waitForTimeout(300)` sites (commit `c243100`, atop `9372991`). Under heavy artificial contention (`taskset -c 0-3`, 4-6 Playwright workers pinned to 4 cores), `e2e/ridingFinishAndEnd.spec.ts`'s "conservatively confirms route completion only after consecutive fixes, and Finish ride clears recovery state" test occasionally failed at `await expect(page.getByText("Route complete")).toBeVisible()` (a 5000ms timeout, element not found), after the test's second consecutive finish-line geolocation fix.
    - Reproduced identically on the pristine pre-`c243100` baseline (`git stash`, rebuilt, re-run) under the same contention — 2/30 failures, same assertion, same line — confirming this predates and is unrelated to that commit's own persistence-polling changes. Never reproduced under ordinary, non-contended concurrency across 150+ runs of the same test.
    - Not investigated further: the reproduction depended on artificial contention deliberately introduced to stress-test unrelated code, not a condition either normal local runs or CI would ordinarily hit. Investigate only if this exact assertion is seen failing in an ordinary local run or in a real GitHub Actions run.
    - **Further evidence (item 78's full local `npm run e2e` gate, 2026-08-25):** the identical `getByText("Route complete")` timeout was seen once more, this time in `e2e/ridingImmersiveShell.spec.ts`'s unrelated "Finish ride restores the normal app shell" test, under ordinary (not artificially pinned) full-parallel `npm run e2e` load — and reproduced identically on the unmodified pre-item-78 `fd813ac` baseline under the same load, confirming it predates and is unrelated to item 78 too. A second, structurally different flake (`e2e/lowZoomLegibility.spec.ts`'s `expect.poll` on `data-camera-zoom`, unrelated to route completion) was also observed exactly once in the same item-78 full-suite run and passed reliably 6/6 in an isolated single-worker rerun — consistent with the same general class of contention-sensitive timing flake under heavy parallel load, not a second confirmed root cause. Neither observation changes this item's own "not investigated further" conclusion; both are recorded here only as corroborating evidence that this class of flake is broader than the one test this item names, still gated on the same "only investigate if seen under ordinary load" condition.
    - **Not to be confused with the `RidingScreen.finishEndRide.test.tsx` wake-lock failure (noted 9 September 2026).** That one is a **Vitest** test-synchronisation defect with a confirmed root cause — it asserted the wake-lock release immediately after waiting only for `clearActiveRideState()`, several React commits too early — and it failed in a **real GitHub Actions run**, not merely under artificial local contention. It was previously and wrongly filed as an instance of this item's class; see [`history/items-100-103.md#item-100`](history/items-100-103.md#item-100)'s dated correction. This item remains what it has always been: a Playwright `getByText("Route complete")` timeout with no identified root cause, still gated on its own "only investigate if seen under ordinary load" condition. Fixing that Vitest test changes nothing here.
    - **Further evidence (item 115's corrective gate, 2026-09-12) — this time inside CI's own pinned container.** This item's **own named test** — `ridingFinishAndEnd.spec.ts`'s "conservatively confirms route completion only after consecutive fixes, and Finish ride clears recovery state" — failed once at a `toBeVisible` timeout during a full-parallel `npm run e2e` run inside `mcr.microsoft.com/playwright:v1.61.1-noble`, under ordinary (not artificially pinned) load. The change under test touched only `src/index.css` and `e2e/ridingClimbView.spec.ts`; the spec passed 4/4 in isolation in the same container, and the identical full suite had passed 345/345 twice earlier the same day. **This sighting does meet this item's own "seen failing in an ordinary local run" trigger**, and is recorded as such rather than absorbed as corroboration — the decision whether to investigate is the user's, and nothing about the test or its timeout was changed.
    - **Investigation, 12 September 2026, against `05161ef` — trigger met, mechanism confirmed, corrected in the tests only.** The 2026-09-12 sighting above met this item's own "seen failing in an ordinary local run" condition, so the bounded investigation it gates was carried out. **GitHub Actions did not fail at any point**; CI for `05161ef` was green, and the original sighting is a single ordinary-load observation, **not** deterministic fail-first evidence.
      - **The "CPU-contention" framing in this item's own title was wrong.** With no artificial contention and no competing load, in the pinned `mcr.microsoft.com/playwright:v1.61.1-noble` container, the named test failed **2/15**, then **8/40**, then **7/40** under `--repeat-each`. It reproduces readily at ordinary load once it is repeated.
      - **Three boundaries were instrumented separately** — `watchPosition` callback delivered, fix accepted and persisted, and fix observed by the completion UI — because "the completion hook did not observe a fix" and "the browser never delivered it" are different claims. Temporary instrumentation only; nothing of it is committed.
      - **Mechanism probe, clean.** A coordinate-identical `context.setGeolocation` **did** produce a fresh callback **50/50** and a fresh persisted fix **50/50** — so Chromium does not suppress identical overrides, and an early hypothesis that it did is refuted. But two overrides issued **back to back with no acknowledgement** were both delivered in only **25/50** samples, and the first reached persisted state in only **9/50**.
      - **Captured at the real failure:** in every one of 12 captured failures the callback log showed all five fixes delivered — `[0, 400, 420, 1000, 1000]` metres — while the per-fix persistence writes showed only **four** commits, `[0, 400, 1000, 1000]`. The 420 m fix was **delivered but never committed to a render**: its callback arrived ~17–30 ms after the 400 m one, React's batching kept only the latest `currentFix` object, and `useRouteCompletionCandidate`'s identity-keyed evaluation therefore never saw the superseded fix.
      - **Why that is fatal, and why it presents as a hard timeout.** The lost fix is the **second arming** fix. Arming stalls at one, the finish fix is then evaluated while still unarmed and is arming-**ineligible** (it fails the departure check), which resets the arming streak to zero. The ride never arms, so `Route complete` never appears at all — a 5 s `toBeVisible` timeout rather than a slow pass.
      - **What let the test do that.** `await expect(page.getByText("On route")).toBeVisible()` is already satisfied from the ride's very first fix, and `toBeHidden()` negatives pass instantly, so neither delayed the next override. Both named specs claimed in comments to wait for "each fix's own observable effect"; neither actually did. The closed-loop test in the same file, which waits on a distinctly-valued `Remaining` string after every fix, has never been reported flaking.
      - **This is not a production defect.** Coalescing can only make completion require _more_ evidence, never less: it delays or withholds the panel and can never show it early, so the conservative contract is never weakened. Real `watchPosition` fixes arrive seconds apart, not 17 ms apart. No production code was changed and **no version bump was made** — `0.4.31` stands.
      - **Correction, test-only, in both named specs.** Every deliberate fix is now acknowledged before the next is issued, by polling the persisted `rideState` row (which `useRideNavigation.ts` rewrites on every accepted fix) for the expected coordinate and a newer timestamp. The confirming finish fix moved 5 m past the route's final coordinate — distinct, and still inside `ROUTE_COMPLETION_ENDPOINT_BASE_RADIUS_METRES` (25 m) with the projection clamping to the route end. The persisted row is a causal fence proving the fix reached committed app state; it is **not** claimed as proof that the completion reducer accepted it, which is what the assertions after each call prove.
      - **`test.use({ serviceWorkers: "block" })` added to both specs, measured separately.** `installLocalMapStyle`'s own doc comment requires it and both specs omitted it. Adding it **alone** moved the failure rate from 8/40 to 4/40 but did **not** remove the flake, so it is recorded as a harness-contract correction and explicitly **not** as the cause.
      - **Post-correction stability, same conditions:** the named test **40/40**, both named tests together **80/80**, and the complete suite in the pinned container **345/345**. Contract controls confirm the behavioural assertions are still load-bearing rather than merely passing: forcing `ROUTE_COMPLETION_CONSECUTIVE_FIXES_REQUIRED = 1` fails **5/5**, and moving the confirming fix outside the 25 m endpoint radius fails **5/5**. These prove the contract, not the synchronisation fix.
      - **Residual, stated rather than smoothed over — and why this item stays monitored rather than closed.** The mechanism above was established and corrected in **11 of 12** captured failures. In the twelfth all five fixes _were_ committed, so a second sub-case remains unexplained. It did not recur within the bounded investigation, while the correction passed every repeated check reported below and CI. Accordingly this item is recorded as **primary mechanism diagnosed and corrected; residual sub-case monitored** — not as fully closed, and **not** as a claim that the correction explains every historic instance. The residual is **not** a confirmed production defect; it is an unexplained observation. **No further work is warranted unless a new recurrence appears.** If one does, investigate it from the failure artefacts item 116 now retains (`trace.zip`, the failure screenshot and `error-context.md`) rather than by re-instrumenting from scratch, and start in the narrowed remaining area: the reliable-distance freezing in `rideNavigationCore.ts` (a held `lastReliableMatch` can change `remainingMetres` without any fix being lost) and the off-route state machine's own escalation, since the delivery-and-commit boundary is now instrumented out as a cause. **Investigation budget actually spent:** one clean probe run (~1.7 min) plus three repeat-each reproduction runs (15, 40 and 40 repetitions, ~30 s each); the planned allowance of up to ten full-suite runs was not needed.
      - **A latent hazard found and deliberately not acted on:** `useRideNavigation.ts`'s mount-time restore has no guard against fixes that already arrived, so a fix racing the restore could be consumed while unarmed and then re-evaluated against rewound progress. It is not this flake's mechanism — the screen mounts and restoration settles before `Start riding` starts the watch — and no change was made for it.
    - **Further evidence (item 104's full local `npm run e2e` gate, 2026-09-04):** the same `ridingImmersiveShell.spec.ts` "Finish ride restores the normal app shell" test failed once more at the identical `getByText("Route complete")` assertion, under ordinary full-parallel load, alongside a separate one-off failure in `e2e/mapImageryRecovery.spec.ts` in a different run. Both passed cleanly in isolation (single worker), and two subsequent full-parallel reruns of the entire suite passed clean (273/273 and 273/273); neither touched file this item changed. Consistent with, not a new instance of, the already-documented contention-sensitive class above — recorded here as further corroborating evidence only.

---

<a id="item-66"></a>

## Item 66 — Investigate intermittent fresh-Start Follow remaining at route overview — accepted for now, monitored

_Category: Map camera controls_

66. **Investigate intermittent fresh-Start Follow remaining at route overview — accepted for now, monitored**
    - Kept as a separate, later-numbered investigation from item 65, not folded into it: both concern the same broad camera-correctness invariant — Follow's own commanded camera must actually reach the screen — but nothing below proves they share an immediate cause, and item 65's fix (a follow-offset-aware `changeZoomBy`) does not resolve this item, confirmed rather than merely assumed (see the investigation below).
    - Field evidence (unverified against ground truth, observed via screenshot/description only): on one fresh route Start — not a Resume — the map remained at a very wide, whole-route-like view even though the status strip showed a live on-route fix and Follow appeared selected (pressed). It did not recover automatically; the rider had to zoom in manually, in combination with Follow, to obtain the usual close perspective. A later fresh Start on the same device behaved normally, so the failure is intermittent, not a permanent regression. A separate screenshot showing very poor reported GPS accuracy still used the normal close view, so GPS accuracy alone does not explain the wide camera.
    - Confirmed (by direct source reading) exact fresh-Start ordering, recorded here as ground truth this investigation must reconcile with, not extend past: once the map style is ready, `MapView.tsx`'s route-overview `fitBounds` effect runs unconditionally the first time (gated only on `!suppressInitialOverviewFit`, which starts `false`) and instantly frames the whole route with no animation. Pressing Start/Resume calls `nav.start()` then `camera.requestFollow()`; for a genuine fresh Start, `currentFix` is still `null` at click time, so `requestFollow` dispatches `"follow-requested"` with `freshCoordinate: null`. The reducer's corresponding branch sets `mode: "following", awaitingFreshFix: true` but produces `NO_COMMAND` — no actual camera move happens yet, so `hasActionableCameraTarget` (`useRideCamera.ts`'s sticky/monotonic latch, true only once a real camera command has actually been produced this route-open session) stays `false`, and the overview fit is therefore not yet suppressed. Only once the first accepted, non-stale GPS fix arrives does `useRideCamera`'s fresh-fix effect dispatch `"fresh-fix"`, and because `awaitingFreshFix` was `true`, the reducer forces a real `followCommand(...)` — the actual first Follow camera command, gated on the first accepted fix, not on any prop directly. That non-null command flips `hasActionableCameraTarget` to `true`, flipping `RidingScreen.tsx`'s `suppressInitialOverviewFit` prop to `true`, so the overview-fit effect's later re-runs take the "already suppressed" branch and never re-fit. `MapView`'s `cameraTarget` effect then applies the command via `setCamera(..., {animate:true, followOffset:true})`, easing from the overview into the following position — and, per item 63's already-shipped fix, that effect now calls `mapRef.current?.resize()` immediately before `setCamera(...)`, mirroring `boundsTarget`'s identical resize-then-camera-op ordering, closing a confirmed race where a stale cached container size caused a `followOffset:true` ease to compute an incorrect geographic centre.
    - **Investigation performed (20 August 2026) — deterministic reproduction attempted, not achieved; item stays open, not "done."** A three-pass source investigation (`MapView.tsx`, `mapAdapter.ts`, `rideCamera.ts`, `useRideCamera.ts`, `RidingScreen.tsx`, `useRideNavigation.ts`, plus direct reading of the installed MapLibre 6.0.0 bundle's own `easeTo`/`resize`/`_fitInternal`/`_ease` internals in `node_modules`) closed several candidate mechanisms conclusively rather than merely by inference:
      - `switchToFallback()` (`MapView.tsx`) cannot interfere with an already-applied camera command: it bails immediately if the local `styleReady` closure var is already true, and a post-load tile error classifies as `"source-or-tile"` (never reaching `switchToFallback` at all) — so by the time any camera command could exist, this path is structurally excluded from touching it.
      - A retry-token-driven map-instance recreation (the manual "Retry map imagery" button, or the auto-retry-on-resume effect) self-heals: `lastAppliedCameraTargetRef`/`styleStructurallyReady` are unconditionally reset at the top of the map-creation effect on every rerun, while `hasActionableCameraTarget`/`suppressInitialOverviewFit` live entirely in `useRideCamera`'s own state, outside `MapView`'s internal lifecycle — so an unchanged `cameraTarget` correctly reapplies on the new instance once its own style structurally loads. Proven directly by a new test, `"a fallback swap landing before the first real camera command still applies that command once it arrives"` (`src/map/MapView.test.tsx`), constructing exactly this window (a pending, `cameraTarget: null` "follow-requested" state, a `style-request-or-parse` error triggering `switchToFallback()`, the fallback instance's own style becoming ready — one legitimate `resize→fitBounds` pair, since `suppressInitialOverviewFit` was still false — then the real follow command arriving and applying correctly: `resize→setCamera`, `nthCallOrder`-proven to land after the fitBounds pair).
      - The `fitBounds`-vs-`setCamera` race is conclusively closed, not merely reasoned about: `mapAdapter.ts`'s `fitBounds()` passes `animate:false` with no `linear:true`, routing through MapLibre's `flyTo`/`_fitInternal`, but `_ease()` (read directly in the installed bundle) short-circuits `animate===false` to a synchronous `frame(1); finish();` in the same call stack — the overview fit is always fully complete before a later `setCamera` call in a subsequent React commit can even begin. There is no live operation for a later command to race against.
      - `resize()` mid-`easeTo()` cannot corrupt the ease's target zoom: `Map.resize()` only calls `stop()` when not already moving (i.e. it explicitly leaves an in-flight ease running), and `easeTo`'s `to.zoom`/`to.center` (including the `followOffset` pixel-to-geographic conversion) are baked in synchronously at call time — a later `resize()` only updates cached container dimensions for future projection math. `_requestedCameraState` (the one thing that could carry corrupted state across frames) is unused, since this app configures neither `transformCameraUpdate` nor `terrain`. At most this could perturb the anchor pixel transiently (item 65's own domain), never the final zoom level.
      - The `NAVIGATION_ZOOM`/`fitBounds` `maxZoom` coincidence (both literally `16`, deliberately — `rideCamera.ts`'s own comment: chosen to match the overview cap so following never zooms further than the overview ever would) cannot mask a missed `setCamera` call, for two independent reasons: the overview effect never writes to `lastAppliedCameraTargetRef` at all (only the cameraTarget effect does — the two dedup mechanisms share no state), and `sameValues` requires lon **and** lat **and** every other field to match, which a route-bounds centroid and a live GPS coordinate essentially never do. Already covered by an existing regression, `"applies a new cameraTarget again once its position genuinely changes"` (`MapView.test.tsx`, pre-existing) — same zoom (16) both times, position changes, still reapplies — confirmed by re-running it rather than assumed; no new near-duplicate test was added for this specific concern.
      - The highest-value, previously-uncovered, entirely ordinary ordering — a rider on a slow connection tapping "Start riding" before the map style has loaded at all (candidate orderings 2/3) — is provably safe and was, until this investigation, genuinely untested: neither `RidingScreen.test.tsx` nor `e2e/ridingCamera.spec.ts` had any test where Start preceded style readiness, or that asserted `data-camera-zoom` reaches its expected value after a fresh Start at all (every existing e2e test only polled pitch reaching `"35"`). Closed by two new component tests in `RidingScreen.test.tsx` (`"recentres the camera on the first fresh fix even when Start is tapped before the map style is ready"`, with an explicit flush between the fix and `triggerStyleLoaded()` so the fresh-fix cascade has genuinely settled first; `"a stationary first fix, with no further fixes ever delivered, still converges to the follow command"`, closing the item's own "convergence must not depend on movement" requirement) and, most importantly, a new **real-browser** test, `"Riding: a fresh Start whose first fix arrives well before the map style becomes ready still converges to the followed zoom"` (`e2e/ridingCamera.spec.ts`), using a new `installLocalMapStyle(page, {styleDelayMs})` option (`e2e/support/localMapStyle.ts`) to genuinely delay style fulfilment 2 seconds past Start — real MapLibre, real (mocked) geolocation, no fixed sleeps beyond the deliberate style delay itself. All pass; `data-camera-zoom` reaches `"16"` and pitch reaches `"35"` every time (5/5 repeats, no flakiness).
    - **A genuine, new, empirically-demonstrated finding — real, but self-correcting, and does not by itself reproduce the field symptom.** While constructing the "Start before style ready" component test above, calling `stub.emitFix(...)` and `map.triggerStyleLoaded()` synchronously back-to-back (no intervening flush) revealed that `styleStructurallyReady` and the _downstream effect_ of a fresh fix (`useRideCamera`'s own fresh-fix dispatch, which lives in a **separate** `useEffect` from the one that sets `currentFix`) can land in the same React commit: in that exact commit, `styleStructurallyReady` has just become `true` but `camera.hasActionableCameraTarget`/`cameraTarget` are still their pre-fix values (the fresh-fix effect hasn't fired yet), so the overview effect's `!suppressInitialOverviewFit` gate is still `false` and it fires one spurious `fitBounds()` call — a genuine whole-route overview flash — before the real follow command catches up one render later and corrects it. This is pinned as a named, explicit regression, deliberately not "fixed" away, in `RidingScreen.test.tsx`'s `"still eventually converges to the follow command when style becomes ready in the same commit as the first fix (a spurious intermediate overview fit is a separate, documented finding)"` — `fitBoundsSpy` is explicitly asserted to have been called once, and `setCameraSpy` is explicitly asserted to still land correctly and exactly once afterward (the camera **does** converge within the same session, self-correcting — never "stuck"). Whether this exact React-commit-batching condition is reachable from two genuinely independent async browser callbacks (the geolocation `watchPosition` success callback vs. MapLibre's own internal style-load completion, driven by different underlying mechanisms — native task vs. promise-resolution microtask) remains unconfirmed; it is a real property of React's own batching model, not a jsdom artefact, but this investigation did not attempt to force it in a real browser (Playwright gives no reliable way to pin two independent async sources to the same microtask flush without manufacturing an artificial, unrepresentative race).
    - **A strengthened, still-unresolved combined hypothesis, not proven.** This finding gives the standing tab/rAF-backgrounding hypothesis (screen locking, an app-switch, or a permission-prompt interruption right after Start, throttling or pausing `requestAnimationFrame` and freezing an in-flight `easeTo()` mid-animation while React state — Follow pressed, a live on-route fix — continues updating independently) a concrete, specific mechanism for _why_ an interrupted ease would leave the camera looking exactly like "a very wide, whole-route-like view" rather than some other arbitrary stuck state: if the same-commit batching above occurs, the spurious `fitBounds()` sets the camera to the whole-route overview, and the _correcting_ `setCamera()` ease that follows always animates from wherever the camera currently is — i.e. from that exact overview — so an interruption landing inside that ease's own window would strand the camera precisely there. Both halves of this combined mechanism are independently plausible; only the first (same-commit batching → one spurious, self-correcting overview flash) has been empirically demonstrated here. The second (an ease interruption via tab/screen backgrounding) remains untestable in this environment: jsdom has no trustworthy `requestAnimationFrame`/visibility model, and headless Chromium's own background-tab throttling does not reliably mirror real mobile OS behaviour, so it was not attempted.
    - **Outcome: not reproduced, item remains pending — not "done," per this item's own stated outcome rules.** No constructed ordering (component-level or real-browser) left the camera "stuck" at an overview scale; every one converged to the followed zoom, including the one previously-uncovered, most field-plausible ordering (Start before style readiness) and a fallback/retry instance swap landing in the pending-command window. No speculative fix backlog item was added — the task's own rule for that is proof of the field symptom itself, which was not achieved; the spurious-overview-flash finding above is real but self-correcting, not "stuck," and so does not meet that bar on its own.
    - What would discriminate the remaining, still-live hypothesis (same-commit batching landing inside a real device's own async timing, combined with a tab/rAF-backgrounding interruption during the resulting ease): a Status-visible camera-event trace from a real recurrence (not added in this slice — no telemetry/logging feature is authorised by this backlog), or confirmation from the user of whether the phone's screen locked, the browser tab backgrounded, or a map retry/fallback banner was visible around the moment of the original incident. Re-litigating this item further without either kind of new evidence is unlikely to be productive.
    - **Files changed (investigation/test-only, no production code):** `src/ui/riding/RidingScreen.test.tsx` (`buildStubMapFactory` gained `triggerStyleLoaded()`, mirroring `MapView.test.tsx`'s own mock; three new tests in `describe("smart riding camera", ...)`), `src/map/MapView.test.tsx` (one new test in `describe("recoverable errors, staged readiness, and retry", ...)`), `e2e/support/localMapStyle.ts` (`installLocalMapStyle` gained an optional `{styleDelayMs}` parameter, default-preserving every existing call site), `e2e/ridingCamera.spec.ts` (one new real-browser test).
    - **Verification.** `npm run format`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` — 2652/2652 across 137 files, `npm run e2e` — 165/165 across both the `chromium` (150) and `android-chrome` (15) projects, `npm run format:check` run last, immediately before committing — all pass, no flakes observed this run. No version bump (`package.json`/`package-lock.json` untouched) — documentation/test-harness-only, no user-visible behaviour change, per this item's own investigation-only scope.
    - Do not change the default zoom, add sleeps/retries, or claim item 65 fixes this — none of that changed here. Any eventual production fix (e.g. for the spurious-overview-flash finding above, should it prove worth fixing on its own regardless of item 66's own unresolved status) needs its own targeted regression evidence and real-device re-acceptance, as a separate, later-numbered slice — not implemented here.
    - **Closure (accepted for now, monitored — 20 August 2026).** This item is closed as accepted-for-now, not as a proved root cause. Nothing above identifies a confirmed defect that reproduces the field symptom: every deterministic component-level and real-browser construction attempted (same-commit style/fix batching, a fallback/retry instance swap landing in the pending-command window, Start preceding style readiness) converged to the followed zoom rather than sticking at overview. Separately, the user has since revisited the specific route that had been the most reproduction-sensitive field case and could not reproduce the symptom there either. Item 65 (the confirmed, separately-verified follow-anchor-during-zoom fix) is **not** credited as resolving this item — it fixed a different, already-reproduced bug, with its own independent verification trail, and nothing in this investigation or in item 65's own evidence connects the two. If the symptom recurs, reopen this item with fresh evidence (ideally the phone's screen-lock/tab-background state and whether a map retry/fallback banner was visible at the time, per the discriminating evidence named above) rather than re-investigating from scratch on the strength of this closure alone.
    - **Related but distinct observation (24 August 2026), since investigated and fixed as item 74:** a further intermittent camera-zoom symptom was observed once in free roam (not route Riding) — see [`history/items-69-80.md#item-74`](history/items-69-80.md#item-74) for the confirmed root cause and fix. The two observations share the broad invariant that an active Follow camera did not reach a sensible navigation presentation, but nothing establishes that they share a cause: this item's own investigation closed without reproducing a defect, and item 74's own investigation found and fixed a genuinely different, independently-confirmed mechanism (a settle-provenance gap in `rideCamera.ts`'s shared `follow-zoom-settled` reconciliation), not the same one this item searched for and failed to reproduce. The free-roam occurrence must not be read as reopening, extending, or casting doubt on this item's own accepted-for-now closure, and item 74's fix must not be read as retroactively confirming a cause for this item's own unreproduced symptom.

---

## Follow-up acceptance ledger

<a id="item-43"></a>

## Item 43 — Real-device acceptance ledger for items 33–42

_Category: Follow-up acceptance ledger_

> **Editorial note (added during the CLAUDE.md documentation restructuring):** the inline "item N's own entry" / "above" cross-references below point to items now filed in `docs/project/history/` or `docs/project/backlog.md` rather than physically above this text in a single document — item 13 is in `docs/project/history/items-06-29.md`, item 25 in `docs/project/history/items-06-29.md`, item 35 in `docs/project/history/items-30-38.md`, items 40 and 41 in `docs/project/history/items-39-48.md`, and item 46 in `docs/project/history/items-39-48.md`. The "Manual acceptance status" ledger this entry references is the acceptance record above in this same file, renamed on 12 September 2026 when the per-item outstanding blocks were consolidated into the single checklist at the head of the file; read those references as pointing there. Item numbers themselves are stable identifiers throughout this project's documentation and are otherwise unchanged.

> **Editorial note (1 October 2026):** the older part of that acceptance record — including "Accepted on the installed iPhone, before 12 September 2026", which carries items 33–42's acceptances, and the 12 September 2026 bicycle ride this entry cites — now continues, unchanged, in [`current-status-archive.md`](current-status-archive.md). Read this entry's "above" references as spanning both files.

43. **Real-device acceptance ledger for items 33–42**
    - Recorded here so a future manual-verification pass has an authoritative checklist once items 33–42 land, rather than being invented ad hoc. Do not add any of the following to the "Manual acceptance status" ledger above until each has actually been checked on the corresponding real device — automated (Playwright/Chromium-emulated) evidence and real-device evidence must stay explicitly distinct, per this file's own established convention (item 25's own `docs/android-chrome-acceptance.md` tagging discipline). (Restored-draft/edit-copy camera framing, item 35, is now confirmed — see item 35's own entry and "Manual acceptance status" above. Items 33, 36, 37, 38, 39, 40 and 41 are likewise now confirmed on the installed iPhone Home Screen PWA — see each item's own entry and "Manual acceptance status" above. Item 42, free roam, was confirmed only via a walking test when this ledger entry was written, and has since had bicycle use confirmed on 12 September 2026 — see the dated acceptance record above.)
    - **Discharged as an active checklist (12 September 2026).** This ledger no longer carries any presently actionable check. Its last remaining entry was free roam's own dedicated bicycle field test (item 42), and item 42 now has **broad bicycle acceptance** from the 12 September 2026 installed-iPhone ride recorded above; longer representative battery and thermal behaviour has moved to opportunistic monitoring. **This is not a claim that the former bicycle checklist was completed point by point** — direction-following above the ~2.5 m/s (~9 km/h) threshold, stationary-bearing stability and camera behaviour under vibration were not separately reported, and none of them is recorded as individually verified. Anything still genuinely open for items 33–42 lives in the one checklist at the head of this file; Android remains under the umbrella there.
    - Item 46's closed-loop projection fix has since received that real-device retest: a post-fix bicycle ride to the finish of a closed loop, on a deployed build carrying item 46's fix, confirmed `Finish ride` appears correctly, with progress retained near the route total rather than snapping back to the start near the shared start/finish coordinate (see item 46's own entry and "Manual acceptance status" above). This is what allows item 40's closed-loop completion and item 41's Finish-ride finalisation path, above, to now be marked confirmed. The field ride that originally exercised items 40/41/42 surfaced the defect on the pre-fix build — it identified the defect, not a verification of the fix; the later, separate retest recorded here is the verification of the fix.
    - The previously still-outstanding normal road-bicycle field test for route Riding, and the live climb progress field test, are both now confirmed (see "Manual acceptance status" above and item 13's own entry). Item 46's own closed-loop field test additionally provided real-device confirmation of item 29's completion-detection and arming thresholds for a closed-loop route; a corresponding field confirmation on a non-loop (point-to-point) route has not been separately recorded, though nothing observed suggests it would behave differently. Free roam (item 42) has since had bicycle use confirmed on the installed iPhone on 12 September 2026, at product level rather than clause by clause — the earlier walking test did not reach the ~2.5 m/s direction-following threshold, and longer representative battery/thermal behaviour is now tracked as opportunistic monitoring rather than as an acceptance gate. Real Android Chrome verification (distinct from Playwright's `android-chrome` Chromium-emulated project, item 25) is required for every item above once implemented — extend `docs/android-chrome-acceptance.md` with the equivalent launcher/free-roam/layout/recovery checks at that time, rather than inventing a second acceptance document.
