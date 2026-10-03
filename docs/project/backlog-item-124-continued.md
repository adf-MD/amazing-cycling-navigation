# Item 124 — slice records, continued

This file continues [item 124](backlog.md#item-124)'s entry in [`backlog.md`](backlog.md), from slice 7 onwards. It was split out on 3 October 2026, for size only: `backlog.md` had reached about 146,000 characters, and one more slice record would have taken it past the 150,000-character limit set out in [the documentation index](README.md).

- **It is the same entry, not a second record.** Item 124's specification, its dated decisions and the records of slices 1 to 6 stay in `backlog.md`, with a short pointer there for each slice recorded here.
- **Item 124 is still pending.** Nothing about it enters [`history/`](history/README.md) before its final slice; at that point both parts move there together.
- **Device acceptance is recorded only in [`current-status.md`](current-status.md)**, never here.

## Slice 7 — Edit copy's replacement confirmation, opening (C-12) (shipped `0.4.58`, 3 October 2026)

**Approved by the rider on 2 October 2026** — decision 7 in the inventory's [decisions section](../design/reveal-inventory/README.md#decisions--d-06-d-02-d-01-and-c-12-2-october-2026). It was made the next slice on 3 October 2026, once D-02's ordinary flow had been accepted, and it is C-12's opening only: no other confirmation, and no new cancellation policy.

**The rule:**

- no movement when the confirmation fits the usable band where it opens;
- otherwise only enough to reveal all of it;
- when it is taller than the band, only enough to complete its Cancel/Replace and edit row, leaving the explanation reachable by scrolling — and no movement when that row already shows;
- instant, once per opening, re-measured on reopening;
- Cancel focused without the browser's own focus scroll.

The ordinary-text opening the rider checked on an iPhone 13 is preserved.

**The defect, re-measured on the unchanged build.** The 2 October measurements predate later Riding changes, so the opening was measured again before anything changed. The build was `6e0e470`, whose application code is identical to `bd688d7` (`0.4.57`). It ran in the pinned container — the CI image, by digest — in Chromium and WebKit at 390×844 portrait, from where Edit copy naturally sits: the panel starts at the page's top, so that is the lowest position reachable at this viewport. The confirmation had no reveal of its own. Cancel's plain `autoFocus` let the browser's focus scroll centre it.

| Context, language, text  | Edit copy (px) | Band (px) | Confirmation (px) | Rule's branch         | Warranted (px) | Unchanged build moved (px)   |
| ------------------------ | -------------- | --------- | ----------------- | --------------------- | -------------: | ---------------------------- |
| Pre-ride, English, 100%  | 377–421        | 75–836    | 197               | fits, no movement     |              0 | 0                            |
| Pre-ride, German, 100%   | 398–442        | 75–836    | 270 / 274         | fits, no movement     |              0 | 0                            |
| Pre-ride, English, 200%  | 631–693        | 91–836    | 710               | minimum reveal        |            599 | 879 — title left at −129     |
| Pre-ride, German, 200%   | 706–768        | 122–836   | 842 / 849         | oversized, action row |      781 / 788 | 1,042 / 1,049 — title hidden |
| Paused, English, 200%    | 631–693        | 91–836    | 710               | minimum reveal        |            599 | 879                          |
| Cold start, German, 200% | 618–680        | 122–836   | 842 / 849         | oversized, action row |      693 / 700 | 954 / 961                    |

Where the engines differed, values are given as Chromium / WebKit; otherwise they agreed to within 1 px.

- **"Paused" and "cold start".** "Paused" is the paused screen after an in-session Pause. "Cold start" is item 132's paused screen after a reload, which stands in for fully closing and reopening the PWA.
- **Comparison with 2 October.** The cold-start German figures match the 2 October paused-panel figures (618–680 px, 842–849 px). German Edit copy sits lower on the pre-ride screen; no cause is claimed.
- **WebKit's focus scroll.** WebKit's own focus scroll happened after the focus call had returned: 0 px inside the call, but 879 px by the time the page settled. This is consistent with the inventory's inference about WebKit. The assertions measure from just before the focus call to after settling, so they judge both engines the same way.

**Mechanism** (`RidingScreen.tsx`, unless named).

- **Opt-ins, no shared change.** Edit copy's `ConfirmDialog` now passes the existing opt-ins `containerRef`, `actionsRef` and `focusCancelWithoutScroll`. Cancel is focused with `preventScroll` from the dialog's own layout effect, which runs before the screen's. `ConfirmDialog`'s behaviour and markup are unchanged for every other caller; only its comments, which named every other caller as leaving these props unset, now name the callers that set them.
- **The reveal, owed once per appearance.**
  - One layout effect, re-checked on every render, compares whether the confirmation is on screen — open, and inside the pre-ride/paused panel that renders it — with the last commit.
  - Each appearance makes a reveal owed, unless a confirmed write is in flight, so D-06's working state is untouched.
  - It is paid with `applyConfirmationReveal` and the action row, under the shared helper's sticky-header, visual-viewport and safe-area band.
  - A reopening re-measures, and no other render repeats it.
- **Paid once the sticky navigation is there.**
  - On a genuine opening it always is.
  - On the one appearance where it is not — the separately recorded confirmation that survives Start riding and reappears on Pause — the reveal waits a commit, until App has put the navigation back.
  - Without that wait, the first implementation depended on the browser's scroll anchoring (below).
- **Unchanged:**
  - Cancel and Escape, including the plain focus back to Edit copy;
  - D-06's working labels, disabled actions, refused cancellation, title park, attempt and context guards, navigation handling and failure focus and reveal;
  - the direct path with no meaningful draft, which opens no confirmation;
  - item 132's restore gating and explicit Resume;
  - End ride's confirmation (C-11), and every other confirmation.
- **Files:**
  - **source:** `src/ui/riding/RidingScreen.tsx`, `src/ui/shared/ConfirmDialog.tsx` (comments only);
  - **version:** `0.4.58`;
  - **tests:** `src/ui/riding/RidingScreen.test.tsx`, `e2e/editCopyConfirmationReveal.smoke.spec.ts` (new) and `e2e/confirmationRevealSettled.spec.ts`.

**The reappearing confirmation, compared before claiming anything.** The rider asked for this comparison rather than an assumed "not a regression". The sequence is reachable through the interface:

- a draft;
- the pre-ride screen;
- open the confirmation;
- scroll back up and **Start riding**, so the confirmation unmounts with the panel;
- a fix;
- **Pause**, so the panel returns with the confirmation still open.

In that Pause commit App still believes the ride is active, because it learns otherwise from a passive effect, so the sticky navigation returns one commit later and pushes everything below it down. Each build was measured once the navigation had returned:

| Build, scroll anchoring              | English 200%: page, action row (band 91–836) | German 200%: page, action row (band 122–836) | English 100% |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------- | ------------ |
| Unchanged, browser default           | 879; 391–531; title hidden (−129)            | 954 / 961; 391–575; title hidden             | no movement  |
| Unchanged, anchoring off             | 796; 474–614; title partly hidden (−46)      | 840 / 847; 505–689; title hidden             | no movement  |
| First repair, browser default        | 599 (516 + 83 by anchoring); 671–811         | 693 / 700 (579 / 586 + 114); 652–836         | no movement  |
| First repair, anchoring off          | 516; **754–894, 58 px below the band**       | 579 / 586; **766–950, 114 px below**         | no movement  |
| Shipped repair, default or off alike | 599; 671–811; title 151–343                  | 693 / 700; 652–836; title at 44 / 37         | no movement  |

- **The first repair.** It measured the reveal before the navigation returned. It was worse than the unchanged build wherever scroll anchoring did not compensate, because the unchanged build centred Cancel and so had room to absorb the shift.
- **Why the default run hid it.** Both desktop engines in the container compensated by exactly the navigation's height, hiding the difference.
- **The correction.** The reveal now waits for the navigation. With it, the action row stays in the band in both engines with anchoring on or off, and the title, which the unchanged build hid, is visible.
- **The scope of the claim.** "Not worse" is claimed for these three cases at 390×844, in desktop Chromium and WebKit, only.
- **The survival itself is unchanged.** It stays recorded and unfixed. Slice 4's description of it in `backlog.md` — "its Cancel `autoFocus` fires again" — is out of date: Cancel is now focused with `preventScroll`, and the confirmation is revealed by the rule once the navigation is back.

**Evidence — automated only.**

- **Unit and component.** The full suite passes: 4,906 tests in 208 files, 10 more than `0.4.57`. In `RidingScreen.test.tsx` there are ten new C-12 cases, with geometry stubbed as Planning's Clear draft reveal tests stub it:
  - Cancel focused without scrolling, then one minimal reveal measured below the header;
  - no movement when it fits;
  - an oversized confirmation: nothing when its row shows, otherwise exactly the row;
  - no reveal on an unrelated re-render, and a fresh measurement on reopening;
  - Cancel and Escape returning focus to Edit copy as before, keeping the draft and revealing nothing on closing;
  - the opening reveal's arguments;
  - nothing while a confirmed write is in flight, with D-06's failure reveal still targeting Edit copy;
  - no confirmation and no reveal on the direct path;
  - the survivor revealed only once the header ref is back, and not at all while its write is in flight.
- **Browser, in the pinned container (the CI image, by digest), at 390×844 portrait.** `e2e/editCopyConfirmationReveal.smoke.spec.ts` (new) has 12 tests in each of Chromium and WebKit.
  - **Input and recording:** real pointer, wheel and key input. The app's scroll calls are recorded, and so is every focus call made by script that moved focus, together with the confirmation's and the band's geometry just before it.
  - **[behaviour] assertions:** Cancel is focused; the action row is in the band, and the whole confirmation is when it fits; the page moved exactly what the rule warrants from that pre-focus geometry.
  - **[implementation] assertions:** `preventScroll`, and one app scroll call accounting for all the movement.
  - **Cases:**
    - the pre-ride matrix, English and German at 100% and 200%, with Cancel (Escape in one case) keeping the stored draft;
    - a reopening after a wheel scroll;
    - the oversized case whose row already shows, which is synthetic: a 37 px safe-area inset makes the 708 px band 2 px shorter than the 710 px confirmation, and Edit copy is placed under the navigation by wheel and opened from the keyboard;
    - Replace and edit after the reveal, opening Plan with the copy;
    - the paused screen after Pause;
    - item 132's cold-start paused screen;
    - the reappearing confirmation in English and German at 200% and English at 100%. Here the browser's scroll anchoring is switched off, a labelled synthetic step, so the test cannot depend on it.
  - **Results:** 24 of 24.
- **The full browser suite, once, at 8 workers:** 946 of 946, in both engines and the `android-chrome` project, with the new spec included.
- **The frame recorder.** `e2e/confirmationRevealSettled.spec.ts` has two new Chromium cases, at English 200%, at ordinary speed and under a 20× CPU throttle. They show only that the actions did not move by more than 1 px across the sampled frames of this asynchronous opening, and that the opening was a reveal.
- **Regression specs**, with the new ones: `editCopyBusyState.smoke`, `editRouteAsPlanningCopy`, `coldStartPausedRoute.smoke`, `confirmationReveal.smoke`, `confirmationRevealSettled`, `confirmationDialogs.smoke`, `clearDraftFailure.smoke`, `ridingPauseAfterResume.smoke`, `ridingLauncher`, `rideSessionSwitchGuard`, `reverseRoute`, `germanRidingHeader` and `ridingFinishAndEnd`. 285 of 285 passed.
- **Which branch each case took**, on the shipped build:
  - every ordinary-text opening: fits, no movement;
  - English 200%: a minimum reveal of exactly 599 px, both on the pre-ride and on the paused screen; the reopening after a wheel scroll warranted, and moved, 179 px;
  - German 200%: oversized, with the action row brought to the band's bottom — 781 / 788 px on the pre-ride screen and 693 / 700 px on the cold-start screen;
  - the synthetic case: oversized with the row showing, so no movement.
- **Baseline, `6e0e470`** (application code identical to `bd688d7`). Of 26 runs, the new spec in both engines plus the two settled cases:
  - **12 fail on behaviour:** every 200% opening, in both engines, moved more than the rule warrants. In English that left the title above the band.
  - **6 fail on the implementation assertion only:** at ordinary text and in the synthetic row-showing case the page did not move, but focus lacked `preventScroll`.
  - **8 pass:** the six reappearing-confirmation cases — the unchanged build centred Cancel, so these are regression guards against the first repair rather than tests that discriminate the baseline — and the two settled cases, since the baseline had no reveal to drift.
- **Negative controls**, each applied alone to `RidingScreen.tsx`, rebuilt, and restored byte-for-byte (SHA-256). Unit failures are of the 272 tests in `RidingScreen.test.tsx`. Browser failures are of 33 runs: the new spec in both engines, plus `confirmationRevealSettled` in Chromium.

| Control | What it disables                                             | Unit failures | Browser failures                                                                                                                   |
| ------- | ------------------------------------------------------------ | ------------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| (a)     | the opening reveal, keeping `preventScroll`                  |             5 | 20 — every 200% opening, both engines; the reappearing cases; the settled cases' reveal check                                      |
| (b)     | `preventScroll`, restoring `autoFocus` with the reveal kept  |             3 | 18 — on behaviour in Chromium (634 px where 599 was warranted; 1,042 px where 781); **in WebKit on the implementation check only** |
| (c)     | the action row, so the whole confirmation is bottom-anchored |             2 | 8 — German 200%, over-scrolled by 25 px; the synthetic row-showing case moved 24 px                                                |
| (d)     | the appearance tracked by "open" alone, not "on screen"      |             1 | 4 — the reappearing confirmation at 200%, both engines: no reveal at all                                                           |
| (e)     | the in-flight condition                                      |             1 | none: a held write is not reachable in this spec; unit only                                                                        |
| (f)     | `useLayoutEffect`, replaced by `useEffect`                   |             0 | **none, not even under the 20× throttle**: not discriminating                                                                      |
| (g)     | the wait for the sticky navigation                           |             1 | 4 — the reappearing confirmation at 200%, both engines: the action row 58–114 px below the band                                    |

**Findings worth carrying forward.**

- **A collapsing or returning sticky header can be absorbed by scroll anchoring.** On the reappearing confirmation, both desktop engines in the container compensated by exactly the navigation's height, so a reveal measured without the navigation looked correct. Only switching anchoring off exposed a 58–114 px shortfall. The shipped reveal waits for the navigation, and the test runs with anchoring off.
- **The `useLayoutEffect` control did not discriminate, even though this opening is asynchronous.** The opening comes after two storage reads, not a click's own commit, so the item 95 risk was plausible. Yet the throttled frame recorder saw no drift with a passive effect. `useLayoutEffect` is kept as the design guarantee and is not proved load-bearing here, as with item 118.
- **WebKit again needs no `preventScroll` to look right.** Restoring `autoFocus` (control b) changed nothing visible in WebKit, as slice 1's control (c) found: its focus scroll ran after the reveal and found nothing left to do.

**Limitations, stated plainly.**

- **Measured at 390×844 portrait only.** The ordinary-text minimum-reveal branch was not reached at this viewport, and the rider could not arrange it on an iPhone 13. That does not establish that it is impossible at every supported phone size. At 200% it is reached naturally in the browser.
- **Synthetic steps:** the safe-area inset in the row-showing case, and scroll anchoring switched off in the reappearing-confirmation cases. Desktop Chromium and WebKit are not iOS Safari, and browser root-text scaling is not iOS Larger Text.
- **No "moved on" policy is added for opening.** The confirmation opens after the preliminary storage reads, which are short in these tests; nothing establishes an upper bound on a device. If the rider scrolls meanwhile, the opening still focuses Cancel and reveals as specified, just as `autoFocus` used to take focus.
- **Cancel and Escape are unchanged.** Focus returns to Edit copy with a plain `focus()`, so the browser's own focus scroll can still move the page when the reveal has carried Edit copy under the navigation. No cancellation policy is added here.
- **The reappearing confirmation is not fixed.** An unconfirmed confirmation still survives Start riding and Pause, as recorded in slice 4. Only how it is revealed changed, and that was measured above.
- **Desktop keyboard only.** Escape and Enter were exercised with the desktop engines' keyboard, which is automated evidence. There is no physical-keyboard, VoiceOver, landscape or physical-Android result.

**CI and deployment:** pending when this record was written. The run's results are reported in the handoff and recorded with the device acceptance.
