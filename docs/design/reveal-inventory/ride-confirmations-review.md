# Item 124 — the ride confirmations and the remaining inventory: review, 3 October 2026

**Status: documentation only — nothing implemented, nothing accepted, nothing decided on the rider's behalf.** This review covers item 124's ([backlog](../../project/backlog.md#item-124)) five ride confirmations — C-07, C-08, C-10, C-11 and C-13 — under the rider's approved common opening and cancellation policy, and reconciles every remaining entry of the [inventory](README.md). It was carried out against `7e46daf` (`0.4.58`). No application source, test, dependency, configuration or version changed, and the probe that measured it stayed outside the repository. Every disposition below is a **recommendation**.

**Update (3 October 2026, evening): decided, and C-11 delivered.** The rider took the four [ride-confirmation decisions](#decisions-still-needed-for-the-ride-confirmations) — C-11 corrected next; C-07 and C-08 unchanged, the 25 px at 200% accepted as a bounded exception; C-09's accepted flow preserved; and a separate slice to dismiss unconfirmed ride-screen prompts on a successful Start, Resume or Pause. The [proposed slice](#proposed-next-slice--c-11-only) shipped in `0.4.59` as item 124's slice 8 ([record](../../project/backlog-item-124-continued.md#slice-8--end-rides-confirmation-on-the-paused-screen-c-11-shipped-0459-3-october-2026)); its ordinary flows were accepted on the installed iPhone, reported 3 October 2026 ([`current-status.md`](../../project/current-status.md)). The decisions are recorded in the [continuation](../../project/backlog-item-124-continued.md#decisions-recorded-on-3-october-2026-evening). The text below is kept as written; the remaining dispositions stay proposals.

## Contents

- [Summary](#summary)
- [What this rests on, kept apart](#what-this-rests-on-kept-apart)
- [Method](#method)
- [The five surfaces in the source at `7e46daf`](#the-five-surfaces-in-the-source-at-7e46daf)
- [Measurements](#measurements)
- [Transitions measured](#transitions-measured)
- [Verdicts](#verdicts)
- [Proposed next slice — C-11 only](#proposed-next-slice--c-11-only)
- [Decisions still needed for the ride confirmations](#decisions-still-needed-for-the-ride-confirmations)
- [Previously noted defects and concerns awaiting a later decision](#previously-noted-defects-and-concerns-awaiting-a-later-decision)
- [The remaining inventory — decisions still needed](#the-remaining-inventory--decisions-still-needed)
- [Phone checks that would help](#phone-checks-that-would-help)
- [Reproduction gaps and synthetic-only cases](#reproduction-gaps-and-synthetic-only-cases)
- [Limitations](#limitations)

## Summary

| ID   | Surface                          | Verdict against the approved policy                                                                                                                                                                                             | Recommendation                                                            |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| C-07 | Launcher **End ride**, route     | Matches at ordinary text. At 200% the browser's focus scroll overshoots the minimum by **25 px**, stopped by the page's end, and the confirmation still ends complete.                                                          | Unchanged — the 25 px is a decision for the rider                         |
| C-08 | Launcher **End ride**, free roam | As C-07: matches at ordinary text; a 25 px overshoot at 200%, ending complete.                                                                                                                                                  | Unchanged — as C-07                                                       |
| C-10 | Route riding header **End ride** | **Matches** in every configuration: no movement, Cancel focused, focus back on **End ride**, tracking undisturbed. At 200% the map and Map/Profile switcher are pushed off-screen while it is open — a fixed-layout constraint. | Unchanged                                                                 |
| C-11 | Paused screen **End ride**       | **Mismatches.** At 200% the opening moves 280 px beyond the minimum and hides the title. After the rider scrolls it, Cancel can leave **End ride** hidden under the navigation even at ordinary text.                           | A targeted correction — [proposed slice](#proposed-next-slice--c-11-only) |
| C-13 | Free-roam header **End ride**    | **Matches** in every configuration, as C-10. An open confirmation is discarded on **Pause**.                                                                                                                                    | Unchanged                                                                 |

Every result agreed between Chromium and WebKit, and between in-session and item 132's cold-start paths. Separately, an unconfirmed **End ride** confirmation reappears across **Pause** and **Resume ride** (C-10 ↔ C-11); it is recorded with the other [noted defects](#previously-noted-defects-and-concerns-awaiting-a-later-decision), not folded into the proposed slice.

## What this rests on, kept apart

- **Accepted device flows.** C-12's ordinary flows on `0.4.58` (build `7e46daf`) and C-09's missing-route variant on `0.4.57` (build `bd688d7`), both in English and German, and slices 1 to 6 before them — each recorded once in [`current-status.md`](../../project/current-status.md). This review re-asserts none of them and reopens none.
- **Approved behaviour policy.** The common opening and cancellation policy for C-07, C-08, C-10, C-11 and C-13, approved on 3 October 2026, with targeted corrections only where current checks or enlarged-text measurements demonstrate a mismatch. Its exact wording is in the inventory's [decisions and observations](README.md#decisions-and-observations--c-07-to-c-13-3-october-2026).
- **A device observation, not acceptance.** The rider could not reach a lower opening position for those five surfaces on the installed iPhone; no version, build or language was attached, and it was not a report that every action passed. Nothing below is borrowed from it.
- **Newly measured matches and mismatches.** Desktop Chromium and WebKit in the pinned container, described under [Method](#method). These are automated measurements, not device evidence.
- **Proposed implementation.** The [C-11 slice](#proposed-next-slice--c-11-only) is a proposal; nothing is selected.
- **Decisions still needed.** Listed for the [ride confirmations](#decisions-still-needed-for-the-ride-confirmations) and for the [remaining inventory](#the-remaining-inventory--decisions-still-needed).

## Method

- **Build.** `7e46daf` (`0.4.58`), built before any documentation commit with the pinned toolchain — Node 24.18.0 and npm 11.16.0, from the checksum-verified official tarball — and `APP_BUILD_SHA` set to the commit, so the bundle reads `0.4.58` / `7e46daf` as deployed. `dist/`'s SHA-256 was recorded and was unchanged before, between and after the runs.
- **Browsers.** The pinned container, `mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48` — the CI image, by digest — with `vite preview` inside it. Chromium and WebKit with their Desktop Chrome and Desktop Safari presets, at 390×844 portrait; service workers blocked; the e2e suite's local map style; geolocation granted at a fixed synthetic position. No live map or routing provider was contacted.
- **Matrix.** English and German (the stored language preference, then a reload), at 100% and 200% root text (applied before the app's first paint and read back after every reload): eight configurations per surface. 48 flows in all, every one completed, with no page errors.
- **Genuine entry paths only.** A GPX route imported through **Import GPX file**; **Start riding** and a fix 400 m along the route, awaited in storage (C-10); **Pause** to the paused screen (C-11), and, after a reload, **Ride** to item 132's cold-start paused screen (C-11 again); **Back to Ride options** to the launcher (C-07, after an in-session Pause and after the cold start); **Ride → Start free roam** and a fix (C-13); **Pause** back to the launcher (C-08). Apart from the language preference, nothing was written to storage to reach a state.
- **Input.** Real pointer clicks at an element's centre, only after checking that the point lies in the viewport and hits the element; real wheel input over ordinary page content; Escape from the desktop keyboard; one real drag on the map. Playwright's own scroll-into-view was never used for a measured step.
- **Recorded.** Instrumentation installed before the app's scripts recorded:
  - the app's own `scrollBy`, `scrollTo` and `scrollIntoView` calls — **none** in any opening or cancellation; the only ones recorded were the app's scroll to the top when a navigation changed the screen (free roam's **Pause** to the launcher, and **Routes** → **Ride**);
  - every script focus call that moved focus, with its options and the geometry just before it;
  - every scroll event, of the window **and** of any element, the fixed riding shell's `section.screen` included;
  - location-watch starts and stops.

  Settling is sampled with timers, not animation frames, because headless WebKit defers them.

- **The band** is the inventory's: from the bottom of the sticky navigation — or, while riding, of the immersive header — plus 8 px, to the visual viewport's bottom less the safe-area inset and 8 px.
- **Positions.** Each page-flow trigger was measured from the **lowest position it can be opened from**: at the page's top when it already sits in the band there, otherwise scrolled by wheel until its bottom is 16 px above the band's bottom. Only C-07 in German at 200% needed that scroll (17–18 px); everywhere else the page's top was already the lowest position. No synthetic inset, forced layout or programmatic scroll manufactured a position. The header triggers (C-10, C-13) were measured where they are.
- **Cancellation.** Cancel by pointer and Escape, at once. For the page-flow surfaces, three wheel-scrolled cases followed:
  - the trigger's slot scrolled under the sticky navigation with Cancel still tappable, then Cancel;
  - the slot partly above the viewport with Cancel still tappable, then Cancel;
  - the slot wholly above the viewport, then Escape.

  A case the page could not scroll to is reported as unreachable, not forced. For the header surfaces, a map drag while open, then Cancel.

- **The rule's warranted movement** is computed from the geometry just before the focus call:
  - none when the confirmation already lies in the band;
  - otherwise the smallest movement that brings it in;
  - when it is taller than the band, the smallest movement that completes its action row, and none when the row already shows.

  Each is limited to what the page can actually scroll. For a cancellation, it is the smallest movement that brings the returning trigger into the band.

- **Mismatch criteria.**
  - **[behaviour]** — what the rider sees: movement beyond the warranted amount, or any movement when the confirmation fits; the action row, or (when it fits) the title, left outside the band; a returning trigger left hidden; a ride's active or paused state changed by Cancel or Escape.
  - **[implementation]** — how it is done: no `preventScroll`, or a passive focus effect. These are noted, but they are not mismatches unless a measured case shows a visible effect.

## The five surfaces in the source at `7e46daf`

Rechecked rather than taken from the inventory, whose line numbers predate later slices.

- **One shared shape.** All five use `ConfirmDialog` with **none** of its opt-ins (`containerRef`, `actionsRef`, `titleRef`, `focusCancelWithoutScroll`, `headingLevel`). Cancel takes focus by plain `autoFocus` — the browser's own focus scroll (`src/ui/shared/ConfirmDialog.tsx`, the `autoFocus` and its opt-out). No reveal of any kind runs.
- **Cancel and Escape** set a latch and close the confirmation. A passive effect with no dependency list then calls a plain `trigger.focus()` once the trigger is mounted and enabled: no `preventScroll`, no check that focus has moved elsewhere, no correction. This is the same pattern in all three components:
  - `RidingLauncher.tsx` 307–326 (C-07, C-08 and C-09, rendered by `renderClearAction` at 338–380);
  - `RidingScreen.tsx` 1117–1136 (C-10 and C-11, `renderEndRideAction` at 1573–1592);
  - `FreeRoamScreen.tsx` 316–335.
- **Placements:**
  - **C-07 and C-08** replace their button inside the launcher panel's last row, in normal page flow under the sticky navigation.
  - **C-11** replaces the paused screen's **End ride**, the panel's last row (`RidingScreen.tsx` 2174–2178), also in page flow under the sticky navigation.
  - **C-10 and C-13** open in a row directly after the sticky immersive header (`RidingScreen.tsx` 2066–2070; `FreeRoamScreen.tsx` 418–420). The header's own trigger stays mounted but concealed.
  - **The fixed shell.** Those two sit in `.screen.riding-fixed-shell` (`100dvh`, `overflow: hidden`): the document cannot scroll, and the row takes its height from the map area (`.ride-content-area--immersive`).
- **The existing helper.** `applyConfirmationReveal` scrolls only the window. It is therefore no remedy for C-10 or C-13, and it is not assumed to be one.
- **Not reset by ride transitions:**
  - **Pause** stays enabled while C-10 or C-13 is open (`pauseDisabled` excludes only a pending pause or a running finalisation);
  - nothing resets `isEndRideConfirmOpen` on Pause or Resume;
  - **Resume ride** stays enabled while C-07 or C-11 is open.
- **C-12, for comparison:** Edit copy's confirmation passes `titleRef`, `containerRef`, `actionsRef` and `focusCancelWithoutScroll`, and its one opening reveal waits for the sticky navigation (`RidingScreen.tsx` 1540–1556). C-11 has none of this.

## Measurements

All values are in CSS pixels at 390×844. Chromium and WebKit agreed within 1 px unless a cell shows "Chromium / WebKit". The ordinary-text rows are the configurations the rider can reach on a phone; the 200% rows are browser root-text scaling, which is not iOS Larger Text.

### C-10 and C-13 — the fixed riding header

| Surface, language, text | Confirmation | Band   | Movement (window, shell) | Map area while open (closed)               | Cancel, Escape, map drag then Cancel   |
| ----------------------- | -----------: | ------ | ------------------------ | ------------------------------------------ | -------------------------------------- |
| C-10, English, 100%     |          197 | 69–836 | none, none               | 297 (518)                                  | no movement; focus on the header's End |
| C-10, German, 100%      |          197 | 69–836 | none, none               | 278 (499)                                  | as above                               |
| C-10, English, 200%     |          460 | 87–836 | none, none               | 0; map and switcher below the screen (174) | as above                               |
| C-10, German, 200%      |          690 | 87–836 | none, none               | 0; map and switcher below the screen (134) | as above                               |
| C-13, English, 100%     |          176 | 69–836 | none, none               | 478 (678)                                  | as above                               |
| C-13, German, 100%      |          176 | 69–836 | none, none               | 478 (678)                                  | as above                               |
| C-13, English, 200%     |          416 | 87–836 | none, none               | 95 (543)                                   | as above                               |
| C-13, German, 200%      |          558 | 87–836 | none, none               | 0; map below the screen (543)              | as above                               |

- **The opening fits in every configuration.** The confirmation, its title and its action row lie in the band. Cancel is focused, the header is unchanged to the pixel, and neither the window nor the fixed shell scrolled.
- **Cancel, Escape and a map drag followed by Cancel** each return focus to the header's **End ride**, visible and hit-testable, with no movement.
- **The ride stays active.**
  - No location watch was started or cleared.
  - **Pause** stayed visible.
  - A later fix was accepted into storage after Cancel.
- **A fixed-layout constraint, not a policy mismatch.** At 200% the confirmation takes the map area's height:
  - in route riding the map and the **Map** / **Profile** switcher sit below the screen while it is open;
  - in free roam at German 200%, the map does.

  Nothing of the confirmation itself is clipped, and everything returns on Cancel. The policy keeps this placement.

### C-07 and C-08 — the Ride launcher

| Surface, language, text | Confirmation | Band    | Rule's branch | Warranted (px) | Moved (px) | Ends                                                    |
| ----------------------- | -----------: | ------- | ------------- | -------------: | ---------- | ------------------------------------------------------- |
| C-07, English, 100%     |          197 | 75–836  | fits          |              0 | 0          | complete, 404–601                                       |
| C-07, German, 100%      |          197 | 75–836  | fits          |              0 | 0          | complete, 425–622                                       |
| C-07, English, 200%     |          646 | 91–836  | minimum       |            571 | 596        | complete, 165–811; stopped by the page's end            |
| C-07, German, 200%      |          690 | 122–836 | minimum       |      628 / 629 | 653 / 654  | title in the band; top edge 1.3 px above it; page's end |
| C-08, English, 100%     |          176 | 75–836  | fits          |              0 | 0          | complete, 370–546                                       |
| C-08, German, 100%      |          176 | 75–836  | fits          |              0 | 0          | complete                                                |
| C-08, English, 200%     |          558 | 91–836  | minimum       |            367 | 392        | complete, 253–811; page's end                           |
| C-08, German, 200%      |          558 | 122–836 | minimum       |      442 / 449 | 467 / 474  | complete, 253–811; page's end                           |

- **Ordinary text.** Both fit where they open, with no movement, in both languages. Cancel is focused. Cancel and Escape leave the page where it is, with focus back on the remounted **End ride**, inside the band.
- **200% text.** The browser's focus scroll, which centres Cancel where it can, runs to the page's end, 25 px beyond the minimum in every case. The rider sees the whole confirmation, its title and its actions.
- **Cancel and Escape at 200%.** As the confirmation collapses, the page shortens and the browser clamps it, leaving **End ride** in the band and focused. The policy allows for that shortening, so this matches.
- **Scrolled cancellations are unreachable here.** The launcher pages cannot scroll far enough to put the trigger's slot under the navigation or above the viewport: at ordinary text they do not scroll at all, and at 200% they fall 31–333 px short. Nothing was forced.
- **The ride is untouched.** The stored session row was unchanged and **Resume ride** / **Resume free roam** stayed available after every Cancel and Escape. Opening C-07, leaving for **Routes** and returning to **Ride** showed it closed, with no focus taken and nothing moved.
- **C-09 shares C-07's component.** By source inference, the same holds for it; it was not measured here, and its device report stands as recorded.

### C-11 — the paused screen

**Opening and immediate cancellation:**

| Language, text | Confirmation | Band    | Branch  | Warranted | Moved | Result                                         | Cancel or Escape at once: moved (warranted)    |
| -------------- | -----------: | ------- | ------- | --------: | ----: | ---------------------------------------------- | ---------------------------------------------- |
| English, 100%  |          197 | 75–836  | fits    |         0 |     0 | complete, 445–642                              | 0 (0); **End ride** in the band                |
| German, 100%   |          197 | 75–836  | fits    |         0 |     0 | complete, 445–642                              | 0 (0); **End ride** in the band                |
| English, 200%  |          646 | 91–836  | minimum |       582 |   862 | **title hidden** (−65–63); action row 391–531  | **−497 (−197)**; **End ride** centred, 391–453 |
| German, 200%   |          690 | 122–836 | minimum |       613 |   893 | **title hidden** (−109–19); action row 391–531 | **−541 (−272)**; **End ride** centred, 391–453 |

The same values were measured on item 132's cold-start paused screen. At 200% the immediate cancellation's excess follows partly from the opening's: the over-scroll left **End ride**'s slot above the band.

**After the rider scrolls the open confirmation:**

| Scrolled case, then                    | Reachable by touch    | English 100%                                                                                 | German 100% | English 200%                                                    | German 200%                                                      |
| -------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Slot under the navigation, Cancel      | yes                   | no movement; **End ride hidden under the navigation** (35–79, band from 75); 40 px warranted | as English  | no movement; **hidden** (43–105, band from 91); 48 px warranted | no movement; **hidden** (74–136, band from 122); 48 px warranted |
| Slot partly above the viewport, Cancel | yes                   | moved 28 px; **hidden under the navigation** (0–44); 103 px warranted                        | as English  | moved 36 px; **hidden** (0–62); 127 px warranted                | moved 36 px; **hidden** (0–62); 158 px warranted                 |
| Slot wholly above the viewport, Escape | desktop keyboard only | moved 488 px, **centred**; 163 px warranted                                                  | as English  | moved 487 px, centred; 187 px warranted                         | moved 487 px, centred; 218 px warranted                          |

- **The opening.** Cancel is focused in every case. At ordinary text the confirmation fits where it opens, in both languages, as the rider's lower-position observation suggests. At 200% the browser's focus scroll centres Cancel: 280 px beyond the minimum, with the title under the navigation or above the screen, although the whole confirmation would fit in the band.
- **Cancellation after scrolling.** The browser's own focus scroll does not know the sticky navigation exists.
  - **The slot under the navigation:** **End ride** is "in the viewport", so nothing moves, and it stays covered.
  - **The slot partly above the viewport:** the browser moves only until its top meets the viewport's top, still under the navigation.
  - **The slot wholly above the viewport:** the browser centres it.

  None of these is the policy's "keep the position, with only the adjustment needed to reveal the opening control".

- **The ride stays paused.** Cancel and Escape started no location watch, the stored session row was unchanged, and **Resume ride** stayed available. Opening it, leaving for **Routes** and returning to **Ride** showed it closed, with no focus taken and nothing moved.

## Transitions measured

| Sequence                                  | Result                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-10 open → **Pause**                     | The paused screen opens with "End this ride?" **already open** as C-11, and Cancel is focused again. At ordinary text it fits with no movement. At 200% the browser moved the page 862 px (English) or 893 px (German), hiding the title — as an unrevealed C-11 opening does. |
| C-11 open → **Resume ride**               | Riding resumes with "End this ride?" **already open** below the immersive header as C-10, and Cancel is focused; it fits.                                                                                                                                                      |
| C-13 open → **Pause**                     | Free roam returns to the launcher with the confirmation **gone**. Focus is on the page body, as after any Pause.                                                                                                                                                               |
| C-07 or C-11 open → **Routes** → **Ride** | The confirmation is closed on return, with no focus taken and nothing moved.                                                                                                                                                                                                   |

The first two are the same class as Edit copy's [recorded survival](../../project/backlog-item-124-continued.md#slice-7--edit-copys-replacement-confirmation-opening-c-12-shipped-0458-3-october-2026) across **Start riding** and **Pause**. They are recorded under [noted defects](#previously-noted-defects-and-concerns-awaiting-a-later-decision) for a separate decision.

## Verdicts

- **C-07 — matches at ordinary text; a 25 px overshoot at 200%, bounded by the page's end.** The confirmation ends complete and cancellation matches. **Recommendation: leave unchanged.** Correcting 25 px would mean changing the launcher's shared code path, which C-09 also uses (C-09 has a device report and no policy decision). If the rider wants strict conformity, it can join the C-11 slice as an optional part — see the [decisions](#decisions-still-needed-for-the-ride-confirmations).
- **C-08 — as C-07.** Recommendation: leave unchanged.
- **C-10 — matches in every configuration.** Recommendation: leave unchanged, including its placement. The map is displaced while it is open at 200%, which is a property of the fixed riding layout that the policy keeps.
- **C-11 — mismatches, measured in both engines, both languages, in-session and after a cold start:**
  1. at 200%, the opening over-scrolls by 280 px and hides the title;
  2. at 200%, an immediate Cancel or Escape moves the page about 300 px more than needed;
  3. at every text size, after the rider scrolls it, Cancel can leave **End ride** hidden under the sticky navigation — touch-reachable at ordinary text;
  4. Escape after scrolling it fully away centres **End ride**, on a desktop keyboard only.

  **Recommendation: a targeted correction**, the [proposed slice](#proposed-next-slice--c-11-only).

- **C-13 — matches in every configuration.** Recommendation: leave unchanged.

## Proposed next slice — C-11 only

**A proposal, not a selection.** It is the smallest change that would make C-11 follow the approved policy, reusing what slices 1 and 7 established rather than a new mechanism.

**Selected and delivered (3 October 2026, evening):** shipped in `0.4.59` as slice 8 ([record](../../project/backlog-item-124-continued.md#slice-8--end-rides-confirmation-on-the-paused-screen-c-11-shipped-0459-3-october-2026)). Beyond this proposal, a focus return that has to wait — a Cancel made in the riding header while a Pause is still being saved — is guarded against the rider having moved on.

- **Opening.** Only for the paused screen's placement — the header's (C-10) is unchanged:
  - pass `ConfirmDialog`'s existing opt-ins `containerRef`, `actionsRef` and `focusCancelWithoutScroll`;
  - run one opening reveal with `applyConfirmationReveal` and the action row, under the sticky navigation's band;
  - pay it, as C-12 does, only once the sticky navigation is present, so the confirmation that reappears after **Pause** is measured with the navigation back. Slice 7 found that otherwise browser scroll anchoring can hide a 58–114 px shortfall.
- **Cancel and Escape.**
  - Focus **End ride** without scrolling.
  - Then, after the collapse has committed, move only as far as reveals **End ride** below the sticky navigation and above the bottom safe area, and only while it still has focus — slice 1's Delete route pattern.
  - The rider's scrolled position is otherwise kept, and the position saved before opening is never restored.
- **Unchanged:**
  - C-10's header placement and its plain focus;
  - Pause, Resume ride, Back to Ride options and Edit copy;
  - End ride's busy and failure states;
  - the launcher (C-07, C-08, C-09) and free roam (C-13).
- **Not included:** dismissing the confirmation across **Pause** and **Resume ride**. It is the separate decision below. Until it is decided, the slice would reveal the reappearing confirmation by the rule, as slice 7 does for Edit copy's.
- **Evidence it would need:**
  - component tests for the opening, the guarded cancellation reveal, no repeat on unrelated renders, and the waiting for the navigation;
  - browser tests in the pinned container, Chromium and WebKit, English and German, ordinary and 200% text, on the in-session and cold-start paused screens;
  - the three scrolled cancellations with real wheel and pointer input;
  - the reappearing confirmation with scroll anchoring switched off as a labelled synthetic step;
  - this review's numbers as the baseline;
  - negative controls for each part.
- **Device check it would need:** the ordinary flows, including the touch-reachable scrolled Cancel. The 200% branch cannot be reached on the phone.

## Decisions still needed for the ride confirmations

**Decided on 3 October 2026, evening** — all four, as recommended, with C-07 and C-08's 25 px accepted as a bounded exception rather than exact compliance ([decisions](../../project/backlog-item-124-continued.md#decisions-recorded-on-3-october-2026-evening)). The list is kept as it was put to the rider.

1. **The C-11 slice:** whether to schedule the [proposed correction](#proposed-next-slice--c-11-only), and where it sits in the execution order. **Recommended: yes, as item 124's next slice.**
2. **C-07 and C-08's 25 px at 200%:** leave it, or include the launcher in that slice. **Recommended: leave it.** The rider-visible difference is 25 px with the confirmation complete either way, and the change would touch C-09's code path.
3. **C-09:** no policy decision is recorded for it. If the launcher is ever changed, it changes too. **Recommended:** record that C-09 follows C-07's policy whenever the launcher changes, keeping its device-reported missing-route flow and opening no new check for its unsupported-session or failure variants.
4. **Confirmations surviving ride transitions** (C-10 ↔ C-11; C-12 across Start riding and Pause): whether an unconfirmed ride-screen confirmation should be dismissed quietly when the ride starts, resumes or pauses. See [noted defects](#previously-noted-defects-and-concerns-awaiting-a-later-decision) and group 6 of the [remaining inventory](#the-remaining-inventory--decisions-still-needed).

## Previously noted defects and concerns awaiting a later decision

Listed so they are not lost. **Listing one adds no work to item 124.** Each keeps its own evidence level:

- **measured** — reproduced through the interface in a desktop engine;
- **synthetic** — reproduced only with an induced fault or hold;
- **source only** — read from the code, never reproduced.

None is a confirmed device defect.

| Concern                                                                                                                                                                         | Evidence                       | Recorded in                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| An unconfirmed **Edit copy** confirmation survives **Start riding** and reappears on **Pause**, taking focus again                                                              | measured (slices 4 and 7)      | [slice 4](../../project/backlog.md#item-124); [slice 7](../../project/backlog-item-124-continued.md)           |
| An unconfirmed **End ride** confirmation survives **Pause** (C-10 → C-11) and **Resume ride** (C-11 → C-10), taking focus again; at 200% its reappearance on Pause over-scrolls | measured, this review          | [Transitions](#transitions-measured)                                                                           |
| After a committed deletion whose list then fails to re-read, the card stays a disabled "Deleting…" and the list's other actions stay refused until a re-read or reload          | synthetic (slice 6)            | [slice 6](../../project/backlog.md#slice-6--delete-route-pending-and-failing-d-02-shipped-0457-3-october-2026) |
| A route deleted in another tab while its unconfirmed confirmation has focus leaves focus on `<body>`                                                                            | source only (slice 6)          | slice 6's limitations                                                                                          |
| A failed **End ride** shows its message inside the riding header's end slot, a placement no browser test measures                                                               | source only; failure synthetic | this review                                                                                                    |
| Cancelling **End ride** while a **Pause** is still being saved leaves a deferred focus that later lands on the paused screen's **End ride** with an ordinary focus call         | source only (a timing window)  | this review                                                                                                    |
| A Planning-origin switch prompt that has fallen back to the page-level dialog restores no focus on Cancel                                                                       | source only                    | this review                                                                                                    |
| The launcher's open confirmation is not reset when its session is re-read, for example after another tab's change, so it could reappear later                                   | source only                    | this review                                                                                                    |
| German `routes.wouldRemain.other` reads "übrig **blieben**"; it should be "bleiben"                                                                                             | source, still present          | [inventory](README.md#other-findings-outside-item-124)                                                         |
| Stale comments: `RidingScreen.tsx` on a removed gradient-colours disclosure; `index.css` on a removed wake-lock popover                                                         | source, still present          | [inventory](README.md#other-findings-outside-item-124)                                                         |
| A committed e2e comment repeats slice 1's incorrect "reachable by neither tap nor Tab"                                                                                          | source, still present          | [inventory, D-04](README.md#d-04--activating-clear-draft-or-delete-while-the-button-is-above-the-viewport)     |
| C-14's confirm action is always red, even for **Retry**, **Check again** and **Try again**, now including Planning's inline prompt                                              | source, still present          | [inventory](README.md#other-findings-outside-item-124)                                                         |
| C-02 orders its actions End and switch, Return, Cancel — not "Cancel before Confirm" as the inventory's introduction to the confirmations states                                | source                         | a correction note in the [inventory](README.md#confirmations-c-01-to-c-14)                                     |

## The remaining inventory — decisions still needed

Every entry not decided, shipped or accepted, reconciled against the dated decisions, slices and acceptance records. The evidence ages are:

- **fresh** — re-read in the source at `7e46daf` on 3 October 2026;
- **1 October** — the inventory's measurement at `04639cb` (390×844, ordinary text, English, Chromium and WebKit), not repeated here.

Every disposition is a **recommendation**, and the dispositions are:

- **in item 124** — a change within item 124;
- **unchanged** — leave as it is;
- **exclude** — not part of item 124's rule;
- **separate item** — proposed for a new backlog entry.

Phone steps are optional decision aids, not acceptance checks. None is added to the checklist in [`current-status.md`](../../project/current-status.md).

| Group                                | ID and surface                                                           | Decision needed                                                 | Recommended disposition                           | Phone check |
| ------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------- | ----------- |
| 1. Rename, Replace key, Manage tags  | P-01 Rename                                                              | reveal the editor on opening, or leave it to focus and keyboard | unchanged; exclude                                | optional    |
|                                      | P-07 Replace key                                                         | where focus goes on opening, Cancel and Save                    | separate item (focus), with group 4               | none        |
|                                      | P-04 Manage tags, opening                                                | a reveal on opening                                             | unchanged                                         | none        |
| 2. Disclosures                       | P-08 to P-14, P-16, P-20, P-27, P-28                                     | should opening a disclosure ever move the page                  | unchanged; exclude                                | none        |
| 3. Details from maps and charts      | P-18 warning tapped on Planning's map                                    | make the existing scroll follow the band                        | measure first; in item 124 only if it shows a gap | useful      |
|                                      | P-21 Planning feature and segment details                                | bring map- or chart-opened details into view                    | unchanged; a cue would be a separate item         | optional    |
|                                      | P-26 pre-ride Recognised climbs                                          | bring the chosen climb's details into view                      | unchanged                                         | optional    |
|                                      | P-29 selected feature summary while riding                               | anything moving during a ride                                   | unchanged; exclude                                | none        |
| 4. Waypoints and focus               | P-17 waypoint Move / Insert after                                        | here, or with item 127                                          | exclude; item 127                                 | none        |
|                                      | D-05, P-24 and the newly found cases                                     | place focus after a tapped control disappears                   | separate item (accessibility, VoiceOver-led)      | none        |
| 5. Results and placement             | P-15 Test routing connection                                             | reveal the result; restore focus                                | unchanged; focus → separate item                  | optional    |
|                                      | P-06 export failure                                                      | show it beside its card, as D-02 does                           | separate item                                     | none        |
|                                      | P-33 update prompt                                                       | its placement above `<main>`                                    | unchanged; reconsider if ever missed              | watch only  |
|                                      | C-14's other entry paths                                                 | follow the common rule                                          | unchanged; focus → separate item                  | none        |
| 6. Simultaneous confirmations        | D-07 pairs                                                               | close one when another opens                                    | unchanged                                         | none        |
|                                      | confirmations surviving ride transitions                                 | dismiss quietly on Start, Resume and Pause                      | in item 124, as its own slice, if agreed          | optional    |
| 7. Protected or measured — unchanged | listed [below](#7-protected-accepted-or-measured--recommended-unchanged) | confirm leaving them as they are                                | unchanged; the "not candidates" excluded          | none        |

### 1. Rename, Replace key and Manage tags

- **P-01 — Rename on a route card.**
  - **Current behaviour:**
    - fresh: the name field is focused and selected without `preventScroll` (`RouteListItem.tsx` 290–298); Save, Cancel and Escape focus the remounted **Rename**; since `0.4.57`, Rename is refused while its own card's deletion runs;
    - 1 October: no movement on opening, the editor ending 21 px below the band; no jump on closing.
  - **Recommendation:** leave it. On the phone the keyboard decides what is visible, and an app reveal measured before the keyboard opens could fight it. The trade-off is a Save/Cancel row that can end just below the screen until the rider scrolls.
  - **Gap:** desktop engines have no software keyboard.
- **P-07 — Replace key (Settings).**
  - **Current behaviour:**
    - fresh, file unchanged since `04639cb`: opening unmounts the focused **Replace key**, so focus falls to `<body>`; Cancel and a successful save destroy the focused control without restoring focus; there is no Escape;
    - 1 October: the form opens complete with no movement.
  - **Recommendation:**
    - return focus to **Replace key**, without scrolling, after Cancel and Save;
    - do **not** move focus into the key field on opening: that opens the keyboard, and could meet the open key-field zoom finding in [`current-status.md`](../../project/current-status.md).

    Touch riders see no difference; keyboard and VoiceOver users would. It is a focus question, so it belongs with group 4 rather than item 124's reveal rule.
- **P-04 — Manage tags, opening.**
  - **Current behaviour:**
    - fresh: unchanged, except that since `0.4.57` it is refused while a deletion is busy, and opening it dismisses a failed deletion;
    - 1 October: at its lowest reachable position, the page's top, the panel opens complete with no movement.
  - **Recommendation:** leave it — it is part of the protected, accepted flow of items 100, 105 and 106.
  - **Gap:** 200% text and German were not measured.

### 2. Disclosures and expanding sections

- **P-08 to P-14 (Settings and Status), P-16 (Plan → Change), P-20 (Plan → Gradient colours), P-27 and P-28 (the ride's climb disclosures).**
  - **Current behaviour:**
    - fresh: all are native `<details>`, with no focus or reveal code; P-16's summary is also Clear draft's and D-01's focus park;
    - 1 October: opening moves nothing, and long ones continue 123–1,490 px below the band.
  - **Recommendation:** leave them, and exclude them from the rule. The summary the rider tapped stays where it was and the text follows in reading order, as platform disclosures do; moving the page would take the tapped summary away. The trade-off is scrolling to read a long one. P-16's summary must stay mounted either way.

### 3. Details opened from maps and charts

- **P-18 — a route warning tapped on Planning's map.**
  - **Current behaviour,** fresh, file unchanged (`RouteSummaryPanel.tsx` 130–147): the matching row is scrolled into view with `block: "nearest"`, smoothly unless reduced motion is set, aware of neither the sticky navigation nor the safe area. From the list, nothing scrolls. **Never measured.**
  - **Recommendation:** measure before deciding. The list sits below the map, so the row is normally below the viewport and `nearest` aligns it with the viewport's bottom. Whether that ever leaves it under the safe area or the navigation is unproved, and the trade-off of the smooth motion is likewise unmeasured.
- **P-21 — feature and gradient-segment details in Planning.**
  - **Current behaviour,** fresh, unchanged: tapping the chart, or a climb on the map, shows its details below with no reveal; **Clear selection** unmounts while focused.
  - **Recommendation:** do not scroll automatically — it would take the map away while the rider is still looking at it. A non-moving cue would be a design question of its own.
- **P-26 — the pre-ride Recognised climbs selector.**
  - **Current behaviour,** fresh, unchanged: a native `<select>`; the chosen climb's details appear with no reveal, and focus stays on the select. Not measured.
  - **Recommendation:** leave it.
- **P-29 — the selected feature summary during a ride.**
  - **Current behaviour,** fresh, unchanged: it sits inside the Profile pane, which scrolls itself; **Clear selection** unmounts it while focused.
  - **Recommendation:** leave it — nothing should move on its own during a ride.

### 4. Waypoint actions, and focus after a control disappears

- **P-17 — waypoint Move and Insert after.**
  - **Current behaviour,** fresh, unchanged: they relabel the map's placement control, which may be scrolled out of view, and **Deselect waypoint** unmounts while focused (focus to `<body>`; 1 October: no page jump).
  - **Recommendation:** treat it with [item 127](../../project/backlog.md#item-127), which is about discovering **Insert after**. It is a discoverability question, not a reveal of opened content.
- **D-05, P-24 and newly found cases — focus after the tapped control disappears.**
  - **Current behaviour,** fresh: focus is left on `<body>` after each of these:
    - **Pause** — items 131 and 132 changed no focus handling;
    - **Deselect waypoint**;
    - **Replace key**;
    - **Clear selection** (P-21 and P-29) and **Clear warning selection**;
    - **Resume ride** and **Start riding**;
    - the paused screen's restore-failure **Retry**.

    A route card's Rename returns focus correctly. On 1 October no page jump was measured on the surfaces tried.

  - **Recommendation:** a separate, accessibility-led item with VoiceOver as its evidence, not item 124's reveal rule. Touch riders see no difference.

### 5. Connection test, export failure, update prompt and C-14's other paths

- **P-15 — Test routing connection (Status).**
  - **Current behaviour,** fresh, file unchanged: the button is disabled while testing, so focus is lost, and the result appears below with neither reveal nor focus. Never measured, because the test sends a real request.
  - **Recommendation:** leave the reveal, and fold the focus question into group 4.
- **P-06 — a route's export failure.**
  - **Current behaviour,** fresh: "That route could not be exported." (or the longer cryptography-unavailable message) appears under the Routes heading, while the **Export** that failed may be in a card far below. Nothing is focused or revealed. Not reproducible on demand.
  - **Recommendation:** a separate presentation item that puts the failure beside its card, as D-02 now does for deletion; a failure shown off-screen is otherwise invisible.
- **P-33 — An update is ready.**
  - **Current behaviour,** fresh: it is rendered above `<main>`, so it can be above the visible area while the rider is scrolled down. It is never forced during a ride.
  - **Recommendation:** leave it unless the rider ever misses one. It persists until acted on and sits at the top of every screen.
- **C-14 — the page-level switch dialog's other entry paths.**
  - **Current behaviour,** fresh: these paths still open at the top of the document with plain `autoFocus`, and a Planning-origin fallback's Cancel restores no focus:
    - a route card's prompt followed off Routes;
    - a stale launcher;
    - since `0.4.52`, a Planning prompt that has lost its anchor.

    Only the Planning path was approved and changed, in slice 3.

  - **Recommendation:** leave them — each needs a deliberate cross-screen sequence, and the ordinary path was repaired in slice 3. The lost focus joins group 4.

### 6. Simultaneous confirmations

- **D-07 — two confirmations open at once.**
  - **Current behaviour,** fresh: item 119 keeps each named and acting on its own subject. These pairs can be open together:
    - C-11 and C-12 on the paused screen;
    - the page-level C-14 beside C-06;
    - a failed or running deletion on one card beside C-02 on another, recorded in slice 6;
    - since `0.4.52`, Planning's Open saved route prompt beside Clear draft.
  - **Recommendation:** leave them possible. Closing one when another opens would discard a choice the rider may still want.
- **Confirmations surviving ride transitions** (C-10 ↔ C-11 measured here; C-12 recorded in slices 4 and 7).
  - **Recommendation:** dismiss an unconfirmed ride-screen confirmation quietly when the ride starts, resumes or pauses — as D-03 dismisses a hidden Delete, with no focus taken and nothing scrolled. The benefit is that no confirmation reappears out of context and takes focus; the trade-off is reopening it if the rider still wants it.
  - **If agreed,** it would be its own slice, separate from the C-11 correction.

### 7. Protected, accepted or measured — recommended unchanged

| ID and surface                                 | Status, kept apart                                                                                                                    | Recommendation                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| C-01 Delete route, C-05 Clear draft            | slice 1, accepted on the installed iPhone (reported 1 October 2026)                                                                   | unchanged                                          |
| C-02 inline route switch                       | item 95, accepted (12 September 2026); its broader switch-prompt scope remains in Session 1                                           | unchanged                                          |
| C-03, C-04, P-02, P-03 and P-04 (tag flows)    | items 100, 105 and 106, accepted (10 September 2026); C-03 and C-04's smooth, settled reveal is the one animated reveal               | unchanged; motion only if a uniform rule is wanted |
| C-06 Delete key                                | item 118, complete and accepted (13 and 14 September 2026)                                                                            | unchanged                                          |
| C-12 Edit copy, C-14 from Planning, D-03       | slices 7 and 3, accepted                                                                                                              | unchanged                                          |
| D-01, D-02, D-06                               | slices 5, 6 and 4; ordinary flows accepted, failure and pending cases automated only                                                  | unchanged                                          |
| D-04 activation above the viewport             | **measured as satisfactory** (1 October 2026, desktop keyboard and wheel, both engines); not device-accepted, no disposition reported | recommend unchanged                                |
| P-19 Planning messages below the map           | item 128, accepted (reported 1 October 2026)                                                                                          | unchanged                                          |
| P-30 No turn cues                              | protected by item 97's contract; its own device check is still open in Session 1                                                      | unchanged                                          |
| P-05, P-22, P-23, P-25, P-31, P-32, P-34, P-35 | status messages, launcher sections, the view selector, overlays and notices; never candidates                                         | recommend excluding                                |

## Phone checks that would help

Optional decision aids for the installed iPhone, at ordinary text size. They are safe — nothing is ended or deleted — and they are not acceptance checks. **Read the version and build from Status first.**

1. **C-11 after scrolling (supports the proposed slice).**
   1. Start a route ride, get a position, then tap **Pause** (**Pause**).
   2. Tap **End ride** (**Fahrt beenden**).
   3. Drag the page upwards until the top of "End this ride?" (**Diese Fahrt beenden?**) is hidden behind the navigation bar, with **Cancel** (**Abbrechen**) still visible.
   4. Tap **Cancel**.
   - Expected on `0.4.58`: **End ride** stays hidden behind the navigation until you scroll back.
2. **The surviving End ride confirmation (supports the transition decision).**
   1. On an active ride, tap **End ride** in the header, then **Pause** without answering: "End this ride?" is already open on the paused screen.
   2. Tap **Cancel**.
3. **P-18 (supports measuring it).** In **Plan**, with a calculated route that shows a surface warning, tap that segment on the map: does the matching warning row come fully into view above the bottom of the screen?
4. **P-21 and P-26 (optional).** In **Plan**, tap a climb on the map; on a route's pre-ride screen, choose a climb under **Recognised climbs**. Is it obvious where the details appeared?

## Reproduction gaps and synthetic-only cases

- **Not reachable here:**
  - the launcher's scrolled cancellations — the pages cannot scroll far enough;
  - the 200% branches on the phone — iOS Larger Text does not resize this app.
- **Not measured:**
  - End ride's busy and failure states (they need synthetic storage faults);
  - Cancel during a pending Pause (a timing window);
  - C-09 in this matrix (a source inference from C-07);
  - P-15 (it sends a real request);
  - P-18 (it needs a route with a surface warning);
  - P-21 and P-26 geometry.
- **Desktop keyboard only:** Escape in every case — and so the wholly-above-viewport cancellation — is desktop-keyboard evidence, not a physical-keyboard result.

## Limitations

- **Measured only at 390×844 portrait, in desktop Chromium and WebKit in a container.** These are not iOS Safari, and browser root-text scaling is not iOS Larger Text. A position unreachable at 390×844 is not shown to be unreachable at every supported phone size.
- **The focus-scroll behaviour this review describes is the desktop engines'.** Whether the iPhone's own focus scroll centres, aligns or does nothing in the same cases is not established; the phone checks above would show the ordinary-text case.
- **No VoiceOver, physical-keyboard, landscape or physical-Android result** is claimed, and none of this is device acceptance.
- **The probe is not committed.** It is a scratchpad script modelled on [`capture.mjs`](../planning-imagery-banner/capture.mjs), driving the genuine entry paths above; anyone reproducing it builds `7e46daf` and follows the [Method](#method).
