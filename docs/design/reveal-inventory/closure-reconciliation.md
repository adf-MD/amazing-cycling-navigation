# Item 124 — closing the inventory: reconciliation and P-18, 4 October 2026

**Status: documentation only.** Item 124 is **not closed**. Nothing is implemented, no correction is selected, and no device check is added to [`current-status.md`](../../project/current-status.md). This document gives every entry of the [inventory](README.md) one explicit disposition. It reconciles the inventory's stable IDs with the [review](ride-confirmations-review.md), the slice records in [`history/item-124.md`](../../project/history/item-124.md#item-124) and its [continuation](../../project/history/item-124-continued.md), and the acceptance ledger. It also measures P-18, the entry the review said should be measured before any decision. The baseline is `0.4.60`, build `e2ba7cf`, after slice 9's acceptance was recorded. No application source, test, dependency, configuration or version changed, and the probe stayed outside the repository.

**Update, 4 October 2026 — the rider's decisions** ([record](../../project/history/item-124-continued.md#decisions-recorded-on-4-october-2026)). P-18's correction is approved as slice 10, with its design choices; the other proposed retentions are approved, except P-01; P-15 is to be measured with a mocked provider; and the two source-only concerns get a narrow check or an explicit proposed deferral. The same report observed P-01 on the installed iPhone ([dated record](../../project/current-status.md#installed-iphone-observation-of-p-01-rename-on-the-last-route-card-item-124-inventory-reported-4-october-2026)): on the last route card the focused field did not come into view, so P-01 is unresolved. The closure table and the defects table below carry the new dispositions; the rest of this account keeps its original text. These are decisions, not device acceptance, and item 124 is not closed.

**Update, 4 October 2026, later — slice 10 and the close-out investigations.** P-18's correction shipped in `0.4.61` as item 124's [slice 10](../../project/history/item-124-continued.md#slice-10--a-warning-selected-on-plannings-map-revealed-with-its-details-p-18-shipped-0461-4-october-2026) and awaits its installed-iPhone check. P-01, P-15 and the two source-only concerns were then investigated, documentation only, and await the rider's decisions: see [the close-out investigations](#close-out-investigations-4-october-2026), [where every entry stands](#where-every-entry-stands-after-slice-10) and [the decisions still needed](#decisions-still-needed-after-slice-10). Item 124 is not closed.

**Update, 4 October 2026, after slice 10's acceptance — the rider's dispositions.** P-18's ordinary flows were [accepted on the installed iPhone](../../project/current-status.md#installed-iphone-acceptance-of-0461-build-ae76f98-item-124-slice-10-p-18-reported-4-october-2026) on build `ae76f98`, Reduced Motion excepted. The rider then deferred P-01 to item 135, its desktop action-row clipping with it as a separate finding; approved P-15's bounded correction as slice 11; and filed a failed End ride's message as item 139 and the stale launcher confirmation as item 140 ([record](../../project/history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)). The closure and defects tables carry these dispositions, each close-out finding below has its outcome appended, and [the new summary](#dispositions-after-slice-10s-acceptance-4-october-2026) supersedes "Where every entry stands after slice 10". Item 124 stays active for slice 11.

**Update, 4 October 2026 — slice 11 shipped.** P-15's correction shipped in `0.4.62` as item 124's [slice 11](../../project/history/item-124-continued.md#slice-11--the-routing-connection-result-revealed-p-15-shipped-0462-4-october-2026) and awaits its installed-iPhone check. Item 124 then needs only its closure.

**Update, 4 October 2026 — slice 11 accepted; item 124 closed.** P-15's ordinary flows were [accepted on the installed iPhone](../../project/current-status.md#installed-iphone-acceptance-of-0462-build-a71ca2f-item-124-slice-11-p-15-reported-4-october-2026) on build `a71ca2f`, and item 124 was closed with explicit deferrals ([record](../../project/history/item-124.md#closure-4-october-2026)). [The closure](#closure-4-october-2026) gives every entry its final disposition and supersedes the earlier summaries; P-15's row in the closure table is updated. Closure fixes and accepts none of the deferred findings.

## Contents

- [The rider's direction](#the-riders-direction)
- [How to read the dispositions](#how-to-read-the-dispositions)
- [P-18 — a surface warning selected on Planning's map](#p-18--a-surface-warning-selected-on-plannings-map)
- [The closure table](#the-closure-table)
- [Defects and concerns found during item 124](#defects-and-concerns-found-during-item-124)
- [Follow-up destinations](#follow-up-destinations)
- [Outcome](#outcome)
- [Decisions for the rider](#decisions-for-the-rider)
- [Close-out investigations, 4 October 2026](#close-out-investigations-4-october-2026)
- [Where every entry stands after slice 10](#where-every-entry-stands-after-slice-10)
- [Decisions still needed after slice 10](#decisions-still-needed-after-slice-10)
- [Dispositions after slice 10's acceptance, 4 October 2026](#dispositions-after-slice-10s-acceptance-4-october-2026)

## The rider's direction

Approved by the rider for this reconciliation on 4 October 2026, verbatim:

> 1. Preserve previously accepted behaviour and retain satisfactory existing confirmations, editors and disclosures where there is no demonstrated mismatch.
> 2. Keep multiple independent confirmations allowed. Do not introduce a global one-confirmation rule.
> 3. Keep P-17’s Move / Insert after placement issue with item 127.
> 4. Separate focus issues, distant-detail presentation, export-failure placement and other distinct concerns should have explicit follow-up destinations rather than extending item 124 by default.
> 5. Ensure known defects discovered during item 124 have a clear disposition. This includes Resume remaining available while a confirmed End ride is still finishing. Recording or deferring a defect does not mean it is fixed or accepted.

When approving the plan, the rider added three points:

- **P-18:** what the target should be is not decided. Confirmation-specific margins, revealing the whole row and instant movement are not an approved rule for it.
- **P-01:** its disposition stays provisional while it needs the rider's judgement.
- **Evidence and dispositions:** approved retention, proposed retention, deferred investigation and unresolved evidence are kept apart, and unverified effects are not turned into defects.

## How to read the dispositions

| Disposition            | Meaning                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completed              | Delivered by an item 124 slice, at the evidence level stated.                                                                                                                                                                                         |
| Approved retention     | Kept unchanged under an explicit rider decision: an accepted, protected flow; a dated decision; or points 2 and 3 of the direction above.                                                                                                             |
| Approved correction    | A change the rider has approved. Not implemented unless the row says so.                                                                                                                                                                              |
| Proposed retention     | Kept unchanged by **recommendation**. Point 1 allows it where there is no demonstrated mismatch, but whether that holds for this entry needs the rider's confirmation. A 3 October recommendation does not become an approval by being repeated here. |
| Deferred investigation | Sent to a named destination. **Not fixed and not accepted.**                                                                                                                                                                                          |
| Unresolved             | Either a demonstrated problem awaiting a decision, or missing evidence. The smallest next step is given.                                                                                                                                              |

**Evidence labels:**

- **[A]** device acceptance recorded in `current-status.md`;
- **[O]** a device observation that is not acceptance;
- **[M]** measured in desktop Chromium and WebKit in the pinned container, which is automated evidence only;
- **[Syn]** reached only through a synthetic fault or hold;
- **[S]** read from source, never reproduced.

"Measured as satisfactory" is never device acceptance. Browser root-text scaling is not iOS Larger Text.

## P-18 — a surface warning selected on Planning's map

### The question

Tapping a surface warning's stretch on Planning's map selects it. Its row in **Route warnings** / **Warnungen** then expands to show "Surface: {surface}" and "Route position: {start}–{end} km". The list sits below the map.

From source (`src/ui/planning/RouteSummaryPanel.tsx` ~130–147, unchanged since the inventory), a passive effect calls `scrollIntoView({ block: "nearest", behavior })` on the **row's button only**. The motion is smooth unless reduced motion is set. The expanded details render below that button. The call is aware of neither the sticky navigation nor the bottom safe area.

**No rule for P-18 is approved.** The question measured here is a plain one: after the selection, are the selected row and its explanatory details visible, readable, and clear of the navigation and the screen's edges?

### Method

- **Build.** `0.4.60`, from source identical to `e2ba7cf`, built with the pinned Node 24.18.0 and npm 11.16.0 from the checksum-verified official tarball. `APP_BUILD_SHA` was set to the full commit. Its content-hashed main asset is `index-CxWuNOVx.js`, the name the live site serves, and `dist/`'s SHA-256 was unchanged across all runs.
- **Browsers.** The CI image, by digest: `mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48`, with `vite preview` inside it. Chromium and WebKit ran at 390×844 portrait with touch enabled, service workers blocked and the e2e suite's local map style. Geolocation was granted at a fixed synthetic position.
- **The path, through the interface:**
  1. Store the language and a dummy key, as `e2e/planningWarningRows.spec.ts` does, then open **Plan**.
  2. Place two waypoints by mouse click on the map.
  3. Reach **Calculate route** with the wheel and press it.
  4. Wheel back to the page's top.
  5. **Tap the painted warning on the map.**

  The provider is a **fixture**: openrouteservice is answered locally with a synthetic, flat, straight 1.5 km route at 51.5° N, modelled on `e2e/routeFeatureColouring.spec.ts`. Its surface extras give three warnings: questionable 0.3–0.6 km, unknown 0.9–1.2 km, unsuitable 1.2–1.5 km. The app's parsing, warning derivation, list and map overlay are real; the route is not real data.

- **Locating the tap.**
  - The probe finds the painted route line in a real screenshot of the map, with the map's DOM overlays hidden for that screenshot only.
  - It taps the middle of the questionable stretch, but only where the map canvas itself is hit.
  - Every run confirmed the questionable row was selected, and that no waypoint was added.
- **The matrix: 22 runs.**
  - **16:** both engines × English and German × 100% and 200% root text × default motion and reduced motion, each with a touch tap from the page's top.
  - **2 with a synthetic 34 px bottom safe-area inset**, English 100%, as a model of the installed iPhone's home-indicator inset.
  - **2 mouse clicks**, English 100%.
  - **2 from a scrolled start**, English 100%: wheel-scrolled 226 px, so the warning sat just below the sticky navigation. That is the furthest down the page can be with the warning still tappable, and the closest the list can come to the screen.
- **Recorded:**
  - the app's scroll calls;
  - the scroll position, settled by timers rather than animation frames, since headless WebKit defers those;
  - the boxes of the selected row, each detail line, the list's announcement and **Clear warning selection**;
  - the map's visibility, focus and page errors.
- **Superseded attempts, reported rather than dropped.**
  - **The first matrix** located the painted line wrongly at 200% text and in WebKit German at 100%. It found the wide placement control, and the tap then added a waypoint through that control. Those runs were discarded.
  - **The second matrix** hid the map container's own overlays. Its 100% runs are kept. At 200% the placement control, which sits outside that container, was still found, and the new canvas-only guard refused to tap.
  - **The third attempt** hid every element intersecting the map, which fixed the detection. Two WebKit reduced-motion runs at 200% also needed a short repaint pause before the screenshot.
  - All 22 reported runs are valid.

### Observed behaviour

Every run made exactly one app scroll call: `scrollIntoView` on the row's button, `{ block: "nearest" }`, smooth or instant as the motion setting asks. Chromium and WebKit agreed within 0.5 px, and touch and mouse gave identical results.

| Configuration                         | Page moved (px) | Selected row after (viewport px)       | Detail lines visible | Extra movement for the details to reach the screen's edge (px) |
| ------------------------------------- | --------------: | -------------------------------------- | -------------------- | -------------------------------------------------------------: |
| English 100%, from the top            |             939 | 800–844, flush with the bottom         | 0 of 2, from 848 px  |                                                             48 |
| German 100%, from the top             |           1,050 | 800–844, flush                         | 0 of 2, from 848 px  |                                                             48 |
| English 100%, from the scrolled start |             713 | 800–844, flush                         | 0 of 2               |                                                             48 |
| English 100%, 34 px inset (synthetic) |             939 | 800–844; only 10 px clear of the inset | 0 of 2               |                                              82 (to the inset) |
| English 200%, from the top            |           2,256 | 738–844, flush                         | 0 of 2, from 852 px  |                                                            189 |
| German 200%, from the top             |           2,999 | 694–844, flush                         | 0 of 2, from 852 px  |                                                            189 |

- **The row** is complete and readable on screen, its lower edge on the screen's bottom edge, in every run without an inset. With the synthetic 34 px inset, 34 px of the 44 px row lies in the area the inset reserves for the home indicator.
- **The explanatory details** are below the screen in all 22 runs: "Surface: Compacted gravel" / "Belag: Verdichteter Schotter" and "Route position: 0.3–0.6 km" / "Position auf der Route: 0,3–0,6 km". The page could have moved further: after the selection, the remaining scroll range was 631 px at English 100%.
- **Further below**, at 100% text:
  - the list's announcement, "Selected warning: …", starts 180 px below the screen's edge; its text also names the surface for a screen reader;
  - **Clear warning selection** starts 275 px below.
- **The map** leaves the screen entirely.
- **Focus** stays on the map canvas that was tapped. Nothing else is focused.
- **Motion.** Smooth scrolling had settled 0.7–1.4 s after the tap in both engines, a figure that includes the probe's 500 ms quiet window, and needed no pointer nudge. Reduced motion moved at once. The geometry was identical either way.
- **Enlarged text.** The row and its details measured 295 px (English) and 339 px (German), and the area between the navigation and the screen's edge measured 761 and 730 px, so they would fit at 390×844. **This was not measured at smaller screens or larger text**, and fitting is not assumed in general.
- **No sticky-navigation case is reachable from a map tap.** The list is always below the map, so the scroll comes from below.

### Verdict — a demonstrated problem

Selecting a surface warning on the map scrolls the map away and stops with the selected row at the very bottom edge. The details that the selection opened — the surface and the route position — are never visible without further scrolling, in either engine, language or text size, from the page's top or from the furthest-down position at which the warning can still be tapped. On an iPhone, the row itself would sit largely in the home-indicator inset; that part rests on the synthetic inset and is not a device observation.

The browser evidence is automated only. **No device observation of P-18 exists.**

### Reproduction

1. In **Plan**, calculate a route that produces a surface warning (**Questionable surface**, **Unknown surface** or similar).
2. Scroll to the page's top, so that the map is in full view.
3. Tap the warning's highlighted stretch on the map.
4. **Seen:** the page scrolls until the matching row reaches the bottom of the screen, and stops. "Surface: …" and "Route position: …" are below the screen edge, and the map is out of view.

### Smallest correction — proposed, not approved

**Proposed as item 124's slice 10, for the rider's decision.** It covers only map-originated selections; list-originated selections, which do not scroll today, are unchanged.

- **The smallest change.** Scroll the selected row's list item (its button and its details) into view instead of the button alone. Keep `block: "nearest"` and today's motion. By the same alignment this would bring the details' lower edge to the screen's bottom edge; it has not been built or measured.
- **Design choices for the rider:**
  1. **What must come into view:** the row with its details (proposed); or also **Clear warning selection** and the announcement, which are list-level and lie further down when there are several warnings.
  2. **The bottom margin:** flush with the screen's edge; or clear of the bottom safe area plus a small gap. Clearing the inset is what makes the row readable above the home indicator. Item 95's route-switch card already does this with a `scroll-margin-bottom` on its target, so the browser's own scroll honours it.
  3. **Motion:** keep today's smooth movement unless reduced motion is set; or move at once, as item 124's confirmations do.
  4. **Too tall to fit:** `nearest` would align the row's top, showing the row first. That case was not reached at 390×844.
- **Implementation candidates:**
  - `scrollIntoView` on the list item with a `scroll-margin-bottom`: the smallest change, keeping today's motion;
  - the shared `applyConfirmationReveal` in `src/ui/shared/confirmationRevealScroll.ts`: instant, aware of the sticky navigation and the safe area, and bottom-anchoring when oversized. Neither is required.
- **Evidence it would need:**
  - component tests;
  - this probe's matrix as browser tests, with the unchanged build as the baseline and a negative control;
  - one installed-iPhone check of the ordinary flow, with the steps above, asking whether "Surface: …" and "Route position: …" are visible above the home indicator.

**Optional before deciding**, and not a checklist entry: the same four reproduction steps on the installed iPhone would show whether the phone matches the desktop engines. The mechanism is engine-independent, and both engines agree, so the decision does not depend on it.

### Limitations

- Desktop engines are not iOS Safari. The 34 px inset is synthetic, and browser root-text scaling is not iOS Larger Text.
- The route is a synthetic fixture, and only the first of three warnings was selected. With more warnings the selected row can be lower in a longer list, and `nearest` still stops at its button.
- Measured at 390×844 only. No VoiceOver, physical-keyboard, landscape or physical-Android result.

## The closure table

Each row groups IDs only where their disposition and evidence match. Dates are 2026.

| IDs                                                                | Disposition                                                          | Evidence or decision                                                                                                                                                                 | Remaining action → destination                                                        |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| C-01, C-05                                                         | Completed                                                            | Slice 1 (`0.4.51`); [A] 1 Oct, build `04639cb`                                                                                                                                       | —                                                                                     |
| C-14 (Planning's path), D-03                                       | Completed                                                            | Slice 3 (`0.4.52`); [A] 2 Oct, `68e6697`                                                                                                                                             | C-14's other paths: below                                                             |
| D-06, D-01, D-02                                                   | Completed                                                            | Slices 4, 5 and 6; ordinary flows [A] 2–3 Oct; pending and failing writes [Syn][M] only                                                                                              | D-02's committed-but-unreconciled list → [monitoring](#follow-up-destinations)        |
| C-12, C-11                                                         | Completed                                                            | Slices 4, 7, 8 and 9; ordinary flows [A] 2–4 Oct; enlarged-text, oversized, held-Pause cases [M][Syn] only                                                                           | —                                                                                     |
| C-10                                                               | Completed (its transition); approved retention (open and cancel)     | 3 Oct common policy, corrections only where a mismatch is measured; review [M] matched in every configuration; slice 9's checklist [A] 4 Oct, deliberate opening and Cancel included | —                                                                                     |
| C-13                                                               | Approved retention                                                   | The same 3 Oct policy; review [M] matched in every configuration; the 3 Oct [O] lower-position observation; not separately device-accepted                                           | —                                                                                     |
| C-07, C-08                                                         | Approved retention                                                   | Decision 2, 3 Oct evening: the 25 px at 200% a bounded exception; [M]                                                                                                                | —                                                                                     |
| C-09                                                               | Approved retention                                                   | Decision 3, 3 Oct evening; missing-route variant [O] 3 Oct, `bd688d7`; unsupported-session and failure variants untested                                                             | Verify if the launcher's shared code changes (decision 3)                             |
| C-02, C-03, C-04, C-06, P-02, P-03, P-04, P-19                     | Approved retention                                                   | Protected, accepted flows: items 95, 100/105/106, 118 and 128 [A]; direction 1; no uniform motion rule is adopted, so C-03 and C-04 keep their settled smooth reveal                 | —                                                                                     |
| P-30                                                               | Approved retention                                                   | Item 97's shipped contract (never a fresh live region or alert); its own device check stays open in Session 1 of `current-status.md`                                                 | —                                                                                     |
| D-07                                                               | Approved retention                                                   | Direction 2; slice 9 added no one-at-a-time rule                                                                                                                                     | —                                                                                     |
| P-17 (the placement control)                                       | Deferred investigation                                               | Direction 3; [S]                                                                                                                                                                     | → [item 127](../../project/backlog.md#item-127); Deselect waypoint's focus → item 135 |
| D-05, P-24, and the focus parts of P-07, P-15, P-18, P-21 and P-29 | Deferred investigation                                               | Direction 4; [M] 1 Oct and slice 9's tests: focus falls to `<body>`, with no page jump on 1 Oct; other cases [S]                                                                     | → [item 135](../../project/backlog.md#item-135)                                       |
| P-06                                                               | Deferred investigation                                               | Direction 4; [S]; not reproducible on demand                                                                                                                                         | → [item 137](../../project/backlog.md#item-137)                                       |
| P-21, P-26                                                         | Approved retention (no automatic scroll; decision 7); a cue deferred | [S]; where the panels land is not measured; the review's reasoning that scrolling would take the map or selector away                                                                | The cue → [item 136](../../project/backlog.md#item-136)                               |
| P-01                                                               | **Deferred investigation** (decision 10, 4 Oct; not accepted)        | [O] 4 Oct: on the last route card the focused field did not come into view; [M] 1 Oct, a separate finding, below; Routes rename broadly [A] earlier                                  | → [item 135](../../project/backlog.md#item-135), with the action-row clipping         |
| P-08 to P-14, P-16, P-20, P-27, P-28                               | Approved retention (decision 7)                                      | [M] 1 Oct (P-11, P-14, P-16 measured): opening moves nothing; long ones continue 123–1,490 px below the screen, with the tapped summary kept in place                                | —                                                                                     |
| P-05, P-22, P-23, P-25, P-31, P-32, P-34, P-35                     | Approved retention, outside the rule (decision 7)                    | Status messages, sections, overlays and notices, listed "not candidates" since 1 Oct; checklist item 22 was never answered                                                           | —                                                                                     |
| P-07 (its form's reveal)                                           | Approved retention (decision 7)                                      | [M] 1 Oct: the form opens complete with no movement                                                                                                                                  | Focus → item 135                                                                      |
| P-29                                                               | Approved retention (decision 7)                                      | [S]: inside the Profile pane, which scrolls itself; nothing should move on its own during a ride                                                                                     | Focus → item 135                                                                      |
| P-33                                                               | Approved retention (decision 7)                                      | [S]: above the screen's content, persists until acted on, never forced during a ride                                                                                                 | Watched → [monitoring](#follow-up-destinations)                                       |
| C-14 (its other entry paths)                                       | Approved retention (decision 7)                                      | [S], fresh at `7e46daf`, files unchanged since: each needs a deliberate cross-screen sequence; not measured on the current build                                                     | Cancel's lost focus → item 135                                                        |
| D-04                                                               | Approved retention (decision 7)                                      | [M] 1 Oct, measured as satisfactory with a desktop keyboard and wheel; **not device-accepted**; on the iPhone it needs a hardware keyboard                                           | The e2e comment → item 138                                                            |
| P-15 (its result's reveal)                                         | **Completed — slice 11, `0.4.62`**                                   | [M] 4 Oct, mocked provider: with the button low on the screen, the result appears wholly below it; ordinary flows [A] 4 Oct, `a71ca2f`                                               | Focus → item 135                                                                      |
| P-18                                                               | Completed — slice 10, `0.4.61`                                       | [M] 4 Oct, 22 runs: before slice 10 its details were never on screen; ordinary flows [A] 4 Oct, `ae76f98`; Reduced Motion not accepted                                               | —                                                                                     |

**P-01, the judgement.** The 1 October measurement is desktop, with no software keyboard. Opening **Rename** with the button placed 16 px above the band's bottom moved nothing, and the editor ended 21 px below the confirmation band's bottom. By that band's definition, that is about 13 px beyond the screen's edge. Its Save and Cancel row is its last content, so at most that strip of the buttons is cut off.

On the iPhone, the name field takes focus and opens the keyboard, which covers the lower screen whatever the page does. The form also saves with the keyboard's Return key, from source (`onSubmit`). An app reveal measured before the keyboard opens could fight iOS's own keyboard scrolling.

**Recommendation: keep it.** On desktop, the cost is at most a short scroll to see Save and Cancel whole. On the phone, Save is also reachable through Return. Nothing has been measured on the phone, and no device report describes a problem. **Retaining it is a decision for the rider, not taken here.**

**Overtaken on 4 October 2026.** The rider's installed-iPhone observation ([dated record](../../project/current-status.md#installed-iphone-observation-of-p-01-rename-on-the-last-route-card-item-124-inventory-reported-4-october-2026)) found that on the last route card the focused field itself did not come into view, although Save and Cancel stayed reachable after scrolling. That is a different finding from the 21 px above, which concerned the action row. The recommendation therefore no longer stands, and P-01 is unresolved pending a bounded reproduction and the rider's decision.

**Deferred on 4 October 2026** ([decisions 10 and 11](../../project/history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)). P-01 goes to item 135, and the 21 px action-row clipping above goes with it as a **separate finding**: it concerns a middle card's partly clipped Save and Cancel row on desktop, where the device observation concerns the last card's focused field. Neither is accepted or fixed, and item 135 assesses both without assuming a shared cause.

## Defects and concerns found during item 124

Each keeps its own evidence level. **Recording or deferring one does not mean it is fixed or accepted.**

| Finding                                                                                                           | Evidence                                      | Disposition                                                                          | Destination                                                                        |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **Resume ride** stays enabled on the paused screen while a confirmed End ride is finishing                        | [S]; a component test with a held clear [Syn] | Deferred investigation — **not fixed**                                               | [Item 134][item-134-history]                                                       |
| Unconfirmed End ride and Edit copy confirmations surviving Start riding, Pause and Resume ride                    | [M], reviews and slices 4 and 7               | Completed                                                                            | Slice 9, [A] 4 Oct                                                                 |
| A Cancel in the riding header while a Pause is still being saved left a deferred focus                            | [S] in the review                             | Completed: slice 8 guards the wait                                                   | Slice 8, [Syn][M] only                                                             |
| A committed deletion whose list then fails to re-read keeps a disabled "Deleting…" card                           | [Syn], slice 6                                | Deferred investigation                                                               | Opportunistic monitoring in `current-status.md`                                    |
| A route deleted in another tab while its unconfirmed confirmation has focus leaves focus on `<body>`              | [S], slice 6 and the D-02 report              | Deferred investigation                                                               | Item 135                                                                           |
| A failed End ride returns focus with a plain `focus()`, which could leave End ride under the navigation           | [S]; failure [Syn]; not measured              | Deferred investigation                                                               | Item 135                                                                           |
| A Planning switch prompt fallen back to the page-level dialog restores no focus on Cancel                         | [S]                                           | Deferred investigation                                                               | Item 135                                                                           |
| Whether VoiceOver announces the title focus park used by D-01, D-02 and D-06 while a write runs                   | Untested                                      | Deferred investigation                                                               | Item 135                                                                           |
| A failed End ride shows its message inside the riding header's end slot, a placement no test measures             | [Syn][M] 4 Oct: clipped at the screen's edge  | Investigated (decision 9's check); **filed as item 139**, decision 13: **not fixed** | [Item 139](../../project/backlog.md#item-139) (decision 13): a presentation defect |
| The launcher's open confirmation is not reset when its session is re-read, for example after another tab's change | [M] 4 Oct, two browser tabs: no re-read       | Investigated (decision 9's check); **filed as item 140**, decision 14: **not fixed** | [Item 140][item-140-history] (decision 14): a correctness item                     |
| German `routes.wouldRemain.other` reads "übrig blieben"                                                           | [S], present at `e2ba7cf`                     | Deferred                                                                             | [Item 138](../../project/backlog.md#item-138)                                      |
| Stale comments: `RidingScreen.tsx` (gradient-colours disclosure), `index.css` (wake-lock popover)                 | [S], present                                  | Deferred                                                                             | Item 138                                                                           |
| A committed e2e comment repeats slice 1's incorrect "reachable by neither tap nor Tab"                            | [S], present                                  | Deferred                                                                             | Item 138                                                                           |
| C-14's confirm action is always `btn-danger`, even for **Retry**, **Check again** and **Try again**               | [S], present                                  | Deferred                                                                             | [Item 103](../../project/backlog.md#item-103), an input note                       |
| C-02 orders its actions End and switch, Return, Cancel, unlike the inventory's general statement                  | [S]                                           | Approved retention (item 95, protected)                                              | The inventory's correction note stands                                             |

[item-134-history]: ../../project/history/items-132-NN.md#item-134
[item-140-history]: ../../project/history/items-132-NN.md#item-140

## Follow-up destinations

Each new item was checked against every pending backlog entry and found distinct. Items 125, 127 and 103 are the nearest, and each is coordinated rather than duplicated. All five new items are **unscheduled**, with specifications in [`backlog.md`](../../project/backlog.md):

- **[Item 134](../../project/history/items-132-NN.md#item-134)** — Resume ride offered while a confirmed End ride is still finishing: a defect investigation.
- **[Item 135](../../project/backlog.md#item-135)** — Focus continuity when a control disappears or an operation ends: an accessibility investigation that includes VoiceOver, and any scrolling or software-keyboard effect of a focus target.
- **[Item 136](../../project/backlog.md#item-136)** — Showing where map- and chart-selected details appear (P-21, P-26): a design candidate.
- **[Item 137](../../project/backlog.md#item-137)** — A route's export failure shown beside its card (P-06): a design candidate.
- **[Item 138](../../project/backlog.md#item-138)** — Copy and comment corrections recorded during item 124: maintenance.

**Existing destinations:**

- [item 127](../../project/backlog.md#item-127) for P-17's placement control, by direction 3;
- [item 103](../../project/backlog.md#item-103) for C-14's button styling;
- `current-status.md`'s opportunistic monitoring for D-02's committed-but-unreconciled list and for a missed update prompt (P-33).

**Added on 4 October 2026, after slice 10's acceptance** ([decisions 10–14](../../project/history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)), both unscheduled, with specifications in [`backlog.md`](../../project/backlog.md):

- **[Item 139](../../project/backlog.md#item-139)** — A failed End ride's message clipped in the riding header: a presentation defect.
- **[Item 140](../../project/history/items-132-NN.md#item-140)** — A stale Ride-launcher confirmation clearing a newer session: a correctness investigation.

[Item 135](../../project/backlog.md#item-135) also receives P-01 and, as a separate finding, its desktop action-row clipping.

## Outcome

**Updated 4 October 2026:** the rider has answered the decisions below ([record](../../project/history/item-124-continued.md#decisions-recorded-on-4-october-2026)). Slice 10 is approved; the proposed retentions listed here are approved, except P-01, which is unresolved; P-15 is to be measured; and the two source-only concerns are to be checked or deferred. The text of this section is otherwise as reconciled.

**A specific demonstrated problem remains, with a bounded proposed correction: P-18**, the [proposed slice 10](#smallest-correction--proposed-not-approved). It is not approved and not implemented. Item 124 is not ready to close until the rider decides on it.

Closure also still needs the following. **None of it is implementation within item 124.**

- **Proposed retentions awaiting the rider's confirmation:**
  - P-01, provisional;
  - the disclosures P-08 to P-14, P-16, P-20, P-27 and P-28;
  - the messages and overlays P-05, P-22, P-23, P-25, P-31, P-32, P-34 and P-35;
  - P-07's reveal, P-21 and P-26 (no automatic scroll), P-29 and P-33;
  - C-14's other entry paths;
  - D-04.
- **Unresolved evidence**, none blocking a decision on P-18:
  - **P-15's result reveal.** The smallest step is a measurement with the provider mocked.
  - **Two source-only concerns:** the End ride failure message's placement, and the launcher confirmation after a session re-read. Their smallest steps are above; neither has an item, since neither has been reproduced.
- **Deferred elsewhere, not fixed:**
  - items 134–138;
  - the notes on items 127 and 103;
  - the two monitoring lines.

## Decisions for the rider

1. **P-18:** approve the proposed slice 10 or not, and if so choose its four design choices: what must come into view, the bottom margin, the motion, and a target too tall to fit.
2. **P-01:** keep it as it is (recommended), or treat its 21 px as a mismatch.
3. **The proposed retentions** listed under [Outcome](#outcome): confirm, or name any to reopen.
4. **P-15:** whether its result's reveal should be measured before closure, or accepted unmeasured.
5. **Closure:** once those are settled, whether item 124 closes and moves to `history/`, with item 122's design stage next in the approved order.

**Answered on 4 October 2026** ([record](../../project/history/item-124-continued.md#decisions-recorded-on-4-october-2026)): 1 — slice 10 approved, with its design choices; 2 — not kept as recommended, since the device observation leaves P-01 unresolved; 3 — confirmed, excluding P-01 and P-18; 4 — to be measured before closure; 5 — not yet: item 124 stays active.

## Close-out investigations, 4 October 2026

Asked for by the rider with slice 10: P-01 after the device observation, P-15 under decision 8, and the two source-only concerns under decision 9. **Documentation only: nothing was fixed, and no disposition is taken here.** Each finding keeps its own evidence level.

**Method, shared.** The `0.4.61` build, whose change touches none of these surfaces. The CI image by digest, `mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48`, with `vite preview`. Chromium and WebKit at 390×844 portrait, touch enabled, service workers blocked, the e2e suite's local map style. The probe stayed outside the repository; it recorded the app's own scroll and focus calls with an init script, and settled by timers, not animation frames.

### P-01 — Rename on the last route card

- **Path, through the interface:** eight routes imported through **Import GPX file**; the page wheeled to its end, which puts the last card's **Rename** as low as it can go (715–759 px); **Rename** opened by a touch tap and, separately, by a mouse click. For comparison, a middle card's **Rename** was placed 16 px above the band's bottom, as on 1 October. English and German; one more pair of last-card runs with the synthetic 34 px inset. 18 runs.
- **Measured, identical in both engines, both languages and both inputs:**
  - **Last card, page at its end.** Focus goes to the name field, its text selected. The editor is 15 px shorter than the card body it replaces, so the page's end moves up and the browser clamps the scroll by 15 px; the app makes no scroll call. The field, 673–717 px, and the Save and Cancel row, 767–811 px, are **wholly inside the band** — the field 127 px above the screen's bottom edge, 161 px with the inset. **There is no scroll room left below: 0 px.**
  - **Middle card.** Nothing moves. The field, 719–763 px, is visible; the Save and Cancel row, 813–857 px, ends 21 px below the band and 13 px below the screen's edge — the 1 October finding, reproduced. There are 990 px of scroll room below.
- **What this establishes.** Desktop engines **do not reproduce** the rider's observation: there, the last card's field is on screen. They also confirm that the 1 October clipping concerns the **middle** card's action row, a different finding from the off-screen field.
- **Not established, and the gap.** Desktop engines have no software keyboard. On the phone the focused field opens the keyboard, which covers the lower part of the screen. The one structural difference measured — the last card leaves no scroll room below, a middle card leaves 990 px — is **consistent** with the observation, if the keyboard covered the field and the page could not be moved to lift it, but that is a hypothesis: neither whether the keyboard covered the field, nor whether iOS tried to scroll, is known.
- **Disposition: investigated, awaiting the rider's decision.** Two options:
  - **A, recommended:** defer P-01's keyboard question to [item 135](../../project/backlog.md#item-135), whose scope already includes "any page scrolling or software-keyboard opening that a chosen focus target would cause" and which requires installed-iPhone evidence. This record and the device observation go with it. Save, Cancel and the field stay reachable by scrolling, and Return saves.
  - **B:** a small, device-verified slice within item 124: once Rename's focus has opened the keyboard and the visual viewport has settled, bring the label and field into the visual viewport by the minimum — the tag editor's `runWhenViewportSettled` with `computeTopRevealScrollDelta` — with focus, selection, Save, Cancel and Return unchanged. Whether the page can move far enough at the list's end with the keyboard open is not known, so it could only be judged on the phone.
- **P-01 is not accepted** by either option.
- **Decided 4 October 2026: A** — deferred to [item 135](../../project/backlog.md#item-135), with the middle card's desktop action-row clipping as a separate finding ([decisions 10 and 11](../../project/history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)). Not accepted, not fixed.

### P-15 — the routing-connection result

- **Path:** a dummy key stored; Settings, then the **Status** switcher; the openrouteservice host answered locally after 0.7 s — **synthetic** — with success, 401, 429, a network failure and a malformed body; **Test routing connection** activated by a touch tap. English and German; one English success and one German 401 at 200% root text. 20 runs.
- **Measured, identical in both engines:**
  - **On arrival at Status** the button is 1,519–1,623 px down the page, so a rider always scrolls to it.
  - **While the test runs** the button reads **Testing…** / **Wird getestet…** and is disabled, and focus is on `<body>`.
  - **With the button in the screen's lower part** (its bottom 4 px above the band's), the result line, its grid and **Copy diagnostic report** appear **wholly below the screen** in every case: success, 401, 429, network failure and malformed, in both languages and at 200%. Nothing moves, the app makes no scroll call, and focus stays on `<body>`. The only visible change is the button's label returning.
  - **With the button in mid-screen** (543–587 px), the result line is wholly visible, the grid 30% so.
  - **Readability:** the result line wraps — 56 px tall for success and 113 px for the network failure, at 100% — and the page has no horizontal overflow, at 200% too. It is the screen's `role="status"` live region, mounted with its text, so assistive technology is told the outcome without focus.
- **Disposition: investigated, awaiting the rider's decision.**
  - **Recommended: a bounded correction**, as a further item 124 slice if approved. When the test finishes, bring the result line into view by the minimum, with slice 10's reveal — smooth unless reduced motion is set, clear of the navigation and the safe area — and only while the rider has not moved on. The grid and **Copy diagnostic report** stay reachable by scrolling, and focus stays with item 135.
  - **The alternative, retention:** Status is a diagnostic view, used rarely, and the outcome is announced. The cost is a sighted rider who sees only the button's label return.
- **Decided 4 October 2026: the bounded correction**, approved as item 124's slice 11 ([decision 12](../../project/history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)). By the rider's further answer, the app being hidden while a test runs also counts as having moved on.

### A failed End ride's message

- **Path:** a route ride started through the interface, and free roam from **Start free roam**; **End ride** confirmed. The failure is **synthetic**: the existing test-only seam `window.__acnE2eRideStateClearFailure` fails the first clear of the stored session only. Route riding's header in English and German, and for comparison the paused panel and free roam's header in English. 8 runs.
- **Measured, identical in both engines:**
  - **The riding header (C-10) and free roam's header (C-13):** the message — "The ride could not be ended on this device. Try again." — is one line in the header's end slot, beside **End ride**. In English it runs 318 px wide, from x = 216 to 534 on a 390 px screen; in German, 464 px wide, to x = 685. The fixed riding shell clips it at the screen's edge, so about 55% of the English sentence and 36% of the German one are visible. The page itself does not overflow.
  - **Beside it:** the route's title collapses to 16 px, and **End ride** moves left to x = 125–216, but stays visible and works: the retry ended the ride and cleared the stored session.
  - **The paused panel (C-11):** the same message wraps under its button, 324 px wide, wholly on screen.
- **What this establishes.** A demonstrated presentation defect in the riding header, reached here only through a synthetic failure; a genuine failure would render the same way. How often a clear fails on the phone is unknown. Focus returned to **End ride** in every run; its scrolling question stays with item 135.
- **Disposition: investigated, awaiting the rider's decision.** It is not a reveal question, and no existing item covers it: item 134 concerns a finishing End ride, item 135 focus only, item 137 the export failure beside a route card, and item 103 control styling. **Recommended: a new unscheduled item**, numbered only if the rider agrees — a design candidate that shows the failure on its own wrapping line below the header row, leaving **Pause** and **End ride** where they are.
- **Decided 4 October 2026:** filed as unscheduled [item 139](../../project/backlog.md#item-139) ([decision 13](../../project/history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)). Not fixed.

### The launcher confirmation after a re-read

- **Re-reads, from source.** The launcher reads its session once, on mount, after **Retry**, and after `sessionRefreshToken` changes, which only a successful **End and switch** does. Dexie's cross-tab broadcast reaches only live queries, which the launcher does not use, so another tab's change triggers no re-read.
- **Path: two pages in one desktop browser context**, sharing IndexedDB, with ordinary interface steps in each. **This is not reachable in the installed iPhone PWA, which has a single window;** it needs two tabs or windows of the site in a browser. In page A, a route ride was started and paused, **Back to Ride options** taken, and the launcher's **End ride** opened, unconfirmed. In page B, the same route's paused screen was ended and free roam started. English; 6 runs.
- **Measured, identical in both engines:**
  - **Nothing re-reads.** Page A kept showing "You have an unfinished ride on this route." with its **End this ride?** open and **Cancel** focused, while storage held page B's free-roam session.
  - **Confirming page A's stale confirmation ended page B's session.** The clear carries no session identity, so it deleted whatever was stored: page B's newer free roam. Page B still showed free roam until reloaded, when nothing was stored.
  - **The ordinary re-read path does not reach an open confirmation.** **Resume ride** stays enabled with the confirmation open; it raised the page-level switch prompt, "Switch to "…"? You have an unfinished free roam session…", above it. **End and switch** then cleared page B's session and replaced the launcher with the route's screen, so the confirmation went with it; focus fell to `<body>`.
- **What this establishes.** The concern as worded — an open confirmation surviving a re-read — was not reached through the ordinary re-read. The re-reads after **Retry** or a failed free-roam write need synthetic faults and were **not exercised**. A related hazard **is** demonstrated, in a two-tab browser setup only: a stale launcher confirmation ends another tab's newer session.
- **Disposition: investigated, awaiting the rider's decision.** No existing item covers it: item 119's guard protects **Resume**, not the launcher's End or Discard; item 134 concerns a finishing End ride; and focus after **End and switch** belongs to item 135. **Recommended: a new unscheduled, low-priority item**, numbered only if the rider agrees — a candidate that has the launcher's End and Discard confirm the stored session is still the one it showed before clearing, as **Resume** already does through the switch guard.
- **Decided 4 October 2026:** filed as unscheduled [item 140](../../project/history/items-132-NN.md#item-140) ([decision 14](../../project/history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)), with no priority assigned and the execution order unchanged. Its investigation must consider atomicity — a clear conditioned on the session's identity within one transaction — not merely a fresher preliminary read. Not fixed.

## Where every entry stands after slice 10

The five states the rider asked to keep apart. **Item 124 is not closed: P-18's device acceptance is one condition, and the decisions in the next section are the others.** Both have since been settled; [the summary after slice 10's acceptance](#dispositions-after-slice-10s-acceptance-4-october-2026) supersedes this table.

| State                                       | Entries                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implemented, awaiting device acceptance     | **P-18**: slice 10, `0.4.61`; Session 5 of [`current-status.md`](../../project/current-status.md)                                                                                                                                                                                                                                                                                             |
| Retained by the rider's approval            | Before 4 October: C-02, C-03, C-04, C-06, C-07, C-08, C-09, C-10 (opening and cancellation), C-13, D-07, P-02, P-03, P-04, P-19 and P-30. On 4 October, decision 7: P-05, P-07's reveal, P-08 to P-14, P-16, P-20, P-21 and P-26 (no automatic scroll), P-22, P-23, P-25, P-27, P-28, P-29, P-31 to P-35, C-14's other entry paths and D-04 — retention under item 124, not device acceptance |
| Investigated, awaiting the rider's decision | **P-01** (A, recommended: defer to item 135; or B: a device-verified slice); **P-15** (recommended: a bounded correction; or retention); **a failed End ride's message** (recommended: a new item); **the launcher's stale confirmation** (recommended: a new, low-priority item) — all [above](#close-out-investigations-4-october-2026)                                                     |
| Deferred, with a destination                | P-17's placement control → item 127; D-05, P-24 and the focus parts of P-07, P-15, P-18, P-21 and P-29, and the focus findings in the defects table → item 135; P-21 and P-26's cue → item 136; P-06 → item 137; copy and comments → item 138; Resume during a finishing End ride → item 134; C-14's styling → item 103; D-02's unreconciled list and P-33 → opportunistic monitoring         |
| Unresolved evidence                         | P-01's keyboard mechanism, on the phone only; a finger scrolling during P-18's movement; the launcher's re-reads after **Retry** or a failed free-roam write, which need synthetic faults; VoiceOver throughout, with item 135                                                                                                                                                                |

Completed, for completeness: C-01, C-05, C-11, C-12, C-14 (Planning's path), D-01, D-02, D-03, D-06 and C-10's transition.

## Decisions still needed after slice 10

1. **P-01:** A — defer to item 135 (recommended) — or B — a device-verified correction slice.
2. **P-15:** a bounded correction (recommended) or retention.
3. **A failed End ride's message:** a new unscheduled item (recommended), or another destination.
4. **The launcher's stale confirmation:** a new unscheduled, low-priority item (recommended), or another destination.
5. **Closure:** after P-18's installed-iPhone check and decisions 1 to 4, whether item 124 closes and moves to `history/`, with item 122's design stage next in the approved order.

**Answered on 4 October 2026** ([record](../../project/history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)): 1 — A, deferred to item 135, with the action-row clipping as a separate finding; 2 — a bounded correction, slice 11; 3 — a new unscheduled item, 139; 4 — a new unscheduled item, 140, with no priority assigned; 5 — not yet: item 124 closes only after slice 11's installed-iPhone acceptance.

## Dispositions after slice 10's acceptance, 4 October 2026

P-18's ordinary flows were [accepted on the installed iPhone](../../project/current-status.md#installed-iphone-acceptance-of-0461-build-ae76f98-item-124-slice-10-p-18-reported-4-october-2026), and the rider decided the four open questions ([decisions 10–14](../../project/history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)). **Item 124 is not closed: slice 11 and its installed-iPhone acceptance remain.** Every entry now has a disposition. [The closure](#closure-4-october-2026) supersedes this table.

| State                            | Entries                                                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completed                        | C-01, C-05, C-10's transition, C-11, C-12, C-14 (Planning's path), D-01, D-02, D-03, D-06, and **P-18** — slice 10, ordinary flows accepted on `ae76f98`; its optional Reduced Motion step not accepted                                        |
| Implemented, awaiting acceptance | **P-15** — slice 11, `0.4.62` (decision 12); Session 5 of `current-status.md`                                                                                                                                                                  |
| Retained by the rider's approval | Unchanged from the table above                                                                                                                                                                                                                 |
| Deferred, with a destination     | As above, and: **P-01** and, as a separate finding, its desktop action-row clipping → item 135 (decisions 10 and 11); a failed End ride's message → item 139; the stale launcher confirmation → item 140 — none of them fixed or accepted      |
| Unresolved evidence              | P-01's keyboard mechanism, with item 135; a finger scrolling during P-18's movement, and Reduced Motion on the device; the launcher's re-reads after **Retry** or a failed free-roam write, with item 140; VoiceOver throughout, with item 135 |

## Closure, 4 October 2026

Slice 11's ordinary flows were [accepted on the installed iPhone](../../project/current-status.md#installed-iphone-acceptance-of-0462-build-a71ca2f-item-124-slice-11-p-15-reported-4-october-2026) on build `a71ca2f`, in English and German; its conditional scroll-while-pending check, Reduce Motion and any particular provider outcome are not claimed. **Item 124 was closed on 4 October 2026** ([record](../../project/history/item-124.md#closure-4-october-2026)). This table gives every entry its final disposition and supersedes [the summary after slice 10's acceptance](#dispositions-after-slice-10s-acceptance-4-october-2026).

| State                                                           | Entries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completed                                                       | C-01, C-05, C-10's transition, C-11, C-12, C-14 (Planning's path), D-01, D-02, D-03, D-06; **P-18** — slice 10, ordinary flows accepted on `ae76f98`, its optional Reduced Motion step not accepted; and **P-15** — slice 11, ordinary flows accepted on `a71ca2f`                                                                                                                                                                                                                                                                                                                                                           |
| Retained by the rider's approval                                | Unchanged from [the table after slice 10](#where-every-entry-stands-after-slice-10) — retention under item 124, not device acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Deferred, with a destination — open, neither fixed nor accepted | P-01's last-card Rename observation and, as a separate finding, its desktop action-row clipping → item 135; P-17's placement control → item 127, and Deselect waypoint's focus → item 135; D-05, P-24, the focus parts of P-07, P-15, P-18, P-21 and P-29, and the focus findings in the defects table → item 135; P-21 and P-26's cue → item 136; P-06 → item 137; copy and comments → item 138; Resume during a finishing End ride → item 134; a failed End ride's message → item 139; the stale launcher confirmation → item 140; C-14's styling → item 103; D-02's unreconciled list and P-33 → opportunistic monitoring |
| Unresolved evidence, carried by those destinations              | P-01's keyboard mechanism, with item 135; a finger scrolling during P-18's or P-15's movement, and Reduced Motion on the device; the launcher's re-reads after **Retry** or a failed free-roam write, with item 140; VoiceOver throughout, with item 135                                                                                                                                                                                                                                                                                                                                                                     |

Each completed entry's acceptance keeps the scope and limitations recorded in [`current-status.md`](../../project/current-status.md); closing item 124 accepts nothing more broadly.
