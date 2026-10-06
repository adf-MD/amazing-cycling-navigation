# Item 124 — slice records, continued

This file continues [item 124](item-124.md#item-124)'s entry in [`item-124.md`](item-124.md), from slice 5 onwards. It was split out of `backlog.md` on 3 October 2026, for size only: `backlog.md` had reached about 146,000 characters, and one more slice record would have taken it past the 150,000-character limit set out in [the documentation index](../README.md). It began at slice 7; slice 6's record was moved here unchanged later the same day, when `backlog.md` had again reached about 149,000 characters, and slice 5's on 4 October 2026, at about 147,000, with only its pointer to slice 4 adjusted for its new place. **Item 124 was closed on 4 October 2026**, and this file moved the same day from `docs/project/backlog-item-124-continued.md` to `history/`, with the entry's first part; only its links, this introduction and a closing pointer changed.

- **It is the same entry, not a second record.** Item 124's specification, the decisions recorded on 1, 2 and 3 October, the records of slices 1 to 4 and the [closure](item-124.md#closure-4-october-2026) are in `item-124.md`, with a short pointer there for each slice recorded here. The decisions of 3 October evening and later are recorded here.
- **Item 124 is closed.** This text was written while it was pending: where it names `backlog.md` for item 124's own records, that is now `item-124.md`, and "Session 5" means a session of [`current-status.md`](../current-status.md)'s checklist, since completed and removed.
- **Device acceptance is recorded only in [`current-status.md`](../current-status.md)**, never here.

## Slice 5 — Clear draft failing (D-01) (shipped `0.4.56`, 3 October 2026)

**Approved by the rider on 2 October 2026** — decision 6 in the inventory's [decisions section](../../design/reveal-inventory/README.md#decisions--d-06-d-02-d-01-and-c-12-2-october-2026). It was made the next slice once item 132 had been accepted, D-01 only.

**The defect.** A failed Clear draft returned focus to the re-enabled button with a plain `.focus()`, whatever the rider had done meanwhile ([review preparation](../../design/reveal-inventory/README.md#d-01--clear-draft-fails-1)):

- focus was taken back from Route name, from another control and from a rider who had scrolled away;
- at 200% text the browser's own focus scroll then pulled the page back, by up to 4,282 px in Chromium;
- while the rider was still waiting, that same focus scroll centred the button rather than revealing it by the minimum. Measured again on the unchanged build in German at 200%: 476 px where 207 px was the minimum.

**Mechanism** (`PlanningScreen.tsx`, unless named).

- **The guard, shared.** D-06's interaction guard moved from `src/ui/riding/editCopyInteractionGuard.ts` to `src/ui/shared/operationInteractionGuard.ts`, as `armOperationInteractionGuard` / `OperationInteractionGuard`. The slice 4 record in [`backlog.md`](item-124.md#slice-4--edit-copy-while-a-copy-is-being-made-d-06-shipped-0454-2-october-2026) names it by its old path.
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

**Installed-iPhone acceptance, reported 3 October 2026.** The ordinary Clear draft flow passed on `0.4.56` (build `439e578`), in English and German: opening Clear draft, cancelling without losing the draft, confirming a successful clear, and repeating with a new draft, with no stale error or busy state. This accepts slice 5's ordinary-flow regression checks only: the failure, delayed-completion, failure-retry and enlarged-text cases above keep their synthetic, automated evidence and were not induced on the phone. The dated record, with what it does not claim, is in [`current-status.md`](../current-status.md).

## Slice 6 — Delete route pending and failing (D-02) (shipped `0.4.57`, 3 October 2026)

**Approved by the rider on 3 October 2026**, after the [investigation](../../design/reveal-inventory/d-02-delete-lifecycle.md): implementation of decisions 4 and 5 in the inventory's [decisions section](../../design/reveal-inventory/README.md#decisions--d-06-d-02-d-01-and-c-12-2-october-2026), following the report's recommendation. This is implementation approval, not device acceptance.

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

**Installed-iPhone acceptance, reported 3 October 2026.** The ordinary Delete route flow passed on `0.4.57` (build `bd688d7`), in English and German: cancelling Delete preserves the route; confirmed deletion and repeated use work without unexpected page jumps or stale states; and an unconfirmed Delete hidden by Search or a tag filter stays closed when the route returns, with Search typing uninterrupted. This accepts slice 6's ordinary-flow regression checks only: a pending deletion, the synthetic failures, failure recovery and the committed-but-unreconciled state above keep their synthetic, automated evidence and were not induced on the phone, and the Search result is an installed-iPhone typing result, not physical-keyboard evidence. The dated record, with what it does not claim, is in [`current-status.md`](../current-status.md).

## Slice 7 — Edit copy's replacement confirmation, opening (C-12) (shipped `0.4.58`, 3 October 2026)

**Approved by the rider on 2 October 2026** — decision 7 in the inventory's [decisions section](../../design/reveal-inventory/README.md#decisions--d-06-d-02-d-01-and-c-12-2-october-2026). It was made the next slice on 3 October 2026, once D-02's ordinary flow had been accepted, and it is C-12's opening only: no other confirmation, and no new cancellation policy.

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

**CI and deployment.** Run [37133035503](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37133035503), for commit `7e46daf`: **Verify and build, all four End-to-end shards and Deploy succeeded, each on its first attempt.** The durations come from the run's own job and step start and completion times, read once after the run and kept locally as saved job data. Verify and build's test step is its unit and component tests; each shard's is its end-to-end suite.

| Job              | Test step | Whole job |
| ---------------- | --------: | --------: |
| Verify and build |     137 s |     241 s |
| E2E shard 1/4    |     463 s |     527 s |
| E2E shard 2/4    |     521 s |     588 s |
| E2E shard 3/4    |     288 s |     352 s |
| E2E shard 4/4    |     600 s |     665 s |
| Deploy           |         — |      11 s |

The longest job, shard 4, left 535 s below the E2E jobs' 1,200-second timeout. The deployment served `0.4.58` / `7e46daf`. These are one run's timings, not an established trend, and no sharding change is made or authorised here.

**Installed-iPhone acceptance, reported 3 October 2026.** The ordinary flows passed on `0.4.58` (build `7e46daf`), in English and German: Edit copy's confirmation fully visible without unwanted movement from the pre-ride, paused and cold-start paused screens; Cancel and reopening preserving the original draft; and Replace and edit opening the route's copy in Plan, the saved route unchanged. This accepts slice 7's ordinary-flow checks only: the enlarged-text geometry, the synthetic inset, the reappearing-confirmation comparison, and pending writes and failures keep their automated evidence and were not induced on the phone. The dated record, with what it does not claim, is in [`current-status.md`](../current-status.md).

## Review of the ride confirmations and the remaining inventory (3 October 2026, documentation only — not a slice)

C-07, C-08, C-10, C-11 and C-13 were measured against the rider's approved common opening and cancellation policy, at `7e46daf`, and every remaining inventory entry was reconciled against the dated decisions, shipped slices and acceptance records. The account — method, measurements, verdicts, a proposed slice, noted defects kept apart by evidence level, and a compact list of the decisions still needed — is the [review](../../design/reveal-inventory/ride-confirmations-review.md); it is not repeated here.

- **Measured matches:** C-10 and C-13 in every configuration; C-07 and C-08 at ordinary text, with a 25 px overshoot at 200% recommended unchanged.
- **Measured mismatch:** C-11 — at 200% the opening over-scrolls by 280 px and hides the title, and after the rider scrolls it, Cancel can leave **End ride** hidden under the sticky navigation, at ordinary text too.
- **Proposed, not selected:** a C-11-only slice reusing slices 1 and 7's mechanisms.
- **Nothing is implemented, accepted or excluded by the review**, and no device check is added to [`current-status.md`](../current-status.md).

## Decisions recorded on 3 October 2026, evening

**Approved by the rider on 3 October 2026, after the [review](../../design/reveal-inventory/ride-confirmations-review.md).** These are product decisions, **not device acceptance**: no new device report came with them, and C-12's acceptance, already recorded, is not repeated.

1. **C-11 — implement the demonstrated correction next.** End ride's confirmation on the paused route screen gets the opening and cancellation correction the review measured as needed. It is slice 8, below.
2. **C-07 and C-08 — unchanged.** The launcher confirmations keep their current behaviour. The measured extra 25 px of scrolling at 200% browser text is accepted as a **bounded exception** to strict minimum scrolling, because their content stays readable and their actions accessible. It is not described as exact compliance.
3. **C-09 — its accepted missing-route ordinary flow is preserved.** If the shared launcher implementation changes later, the same launcher policy applies to C-09 and C-09 is verified appropriately then. Shared source alone does not establish identical geometry, nor acceptance of its untested variants.
4. **Surviving confirmations — a separate follow-up slice is approved.** It will quietly dismiss unconfirmed ride-screen prompts when Start, Resume or Pause **successfully** changes the ride context. A failed transition does not count as success, and the dismissal must never cancel, conceal or misrepresent an operation already confirmed and running. It is the next slice after slice 8; nothing about it was implemented with slice 8, and it is slice 9, below.

The remaining inventory dispositions in the review stay **proposals**, not blanket approvals.

## Slice 8 — End ride's confirmation on the paused screen (C-11) (shipped `0.4.59`, 3 October 2026)

**Approved as decision 1 above.** It changes C-11 only: End ride's confirmation in the paused route screen's panel, both after an in-session Pause and on item 132's paused screen after a cold start. Unchanged are:

- the riding header's End ride (C-10);
- the launcher (C-07, C-08, C-09);
- free roam (C-13);
- Edit copy (C-12, D-06);
- whether a confirmation survives Start, Pause or Resume, which is decision 4's separate slice.

**The rule** — the common policy approved on 3 October 2026:

- **Opening:**
  - no movement when the confirmation fits the usable band where it opens;
  - otherwise only enough to show all of it;
  - when it is taller than the band, only enough to complete its Cancel/End ride row, and none when that row already shows;
  - once per opening, re-measured on reopening;
  - Cancel focused without the browser's own focus scroll.
- **Cancel and Escape:**
  - the ride stays paused;
  - focus returns to End ride without the browser's own focus scroll;
  - the page moves only as far as reveals **End ride itself**. The rider's resulting position, including any scrolling done while the confirmation was open, is otherwise kept. The position before the opening is never restored, and only the clamping a shorter page forces is allowed for;
  - a focus return that has had to wait never takes focus or moves the page once the rider has moved on.

**The defect, re-measured on the unchanged build.** `16ba72d` (`0.4.58`), in the pinned container (the CI image, by digest), in Chromium and WebKit at 390×844 portrait. Every case was reached through the interface: a GPX import, **Start riding**, a fix 400 m along the route, **Pause**, with the text size applied on the paused screen. The paused panel starts at the page's top, where End ride already sits in the band, so that is the lowest position reachable at this viewport. Both engines agreed to the pixel.

| Case, language, text                       | Band (px)     | Confirmation (px) | Warranted (px) | Unchanged build (px)                 |
| ------------------------------------------ | ------------- | ----------------- | -------------: | ------------------------------------ |
| Opening, English and German, 100%          | 75–836        | 197               |              0 | 0                                    |
| Opening, English, 200%                     | 91–836        | 646               |            535 | 815 — the title left above the band  |
| Opening, German, 200%                      | 122–836       | 690               |            566 | 846 — the title left above the band  |
| Immediate Cancel or Escape, English, 200%  | 91–836        | —                 |           −197 | −497                                 |
| Immediate Cancel or Escape, German, 200%   | 122–836       | —                 |           −272 | −541                                 |
| Scrolled: slot under the navigation, 100%  | 75–836        | —                 |            −48 | 0 — End ride left at 27–71, covered  |
| Scrolled: slot under the navigation, 200%  | 91 or 122–836 | —                 |            −56 | 0 — End ride left covered            |
| Scrolled: slot partly above, English, 100% | 75–836        | —                 |           −103 | −28 — End ride left at 0–44, covered |
| Scrolled: slot partly above, German, 200%  | 122–836       | —                 |           −158 | −36 — End ride left at 0–62, covered |
| Scrolled: slot wholly above, Escape, 100%  | 75–836        | —                 |           −167 | −492 — centred                       |
| Scrolled: slot wholly above, Escape, 200%  | 91–836        | —                 |           −209 | −509 — centred                       |

- **Cold start.** Item 132's paused screen gave the same values as the in-session one.
- **Against the review's figures.** The review recorded English 200% as warranting 582 px and moving 862 px. Here the same over-scroll of 280 px appears from a confirmation sitting 47 px higher. The review applied the text size before the app's first paint, and this slice applies it on the paused screen; no cause for the difference is claimed. The cancellation figures, −497 against −197 px, match the review exactly.
- **The movement warranted after a Cancel** is computed from End ride's own geometry just before the app's focus call — after the confirmation has collapsed — so clamping is never charged to the app.

**Mechanism** (`RidingScreen.tsx`):

- **Opt-ins, the paused panel only.** End ride's `ConfirmDialog` now passes the existing `containerRef`, `actionsRef` and `focusCancelWithoutScroll` only when it is rendered in the paused panel. In the riding header it keeps plain `autoFocus` inside its fixed shell, exactly as before.
- **The opening reveal is C-12's mechanism.**
  - One no-deps layout effect owes a reveal each time the confirmation appears in the panel. It pays the reveal with `applyConfirmationReveal` and the action row, under the shared band of the sticky navigation, the visual viewport and the safe area.
  - It is paid once the sticky navigation is there, so a confirmation that survives **Pause** (still recorded, still unfixed) is measured after App has put the navigation back.
  - A reopening re-measures; no other render repeats it.
  - It is declared after Edit copy's reveal. When both confirmations reappear after one Pause, End ride's Cancel is the one focused, and its reveal runs last.
- **Cancel and Escape record a request with the placement they came from.** A new no-deps layout effect, its only reader, decides it:
  - it waits while End ride is absent or disabled, or while the panel is shown before the navigation is back;
  - **in the riding header**, it hands the request to the existing passive effect, unchanged, which makes today's plain `focus()` in the same commit;
  - **in the paused panel**, it focuses End ride with `preventScroll` and then, only while End ride still has focus, reveals End ride itself by the minimum.
- **An ordinary Cancel is decided in its own closing commit**, where nothing can intervene, so it always returns focus, as before.
- **A request that had to wait arms an interaction guard with no area** (`operationInteractionGuard.ts`). It is then decided only if the guard saw no tap, key, wheel or touch scroll and focus is on `<body>` or End ride. The only reachable case is a Cancel in the riding header while a **Pause** is still being saved, landing on the paused screen.
- **Lifetime.** A new opening or a new Cancel drops a waiting request, and unmounting detaches its guard.
- **The failure path is unchanged:** a failed ending still returns focus to End ride with a plain `focus()`.
- **Files:**
  - **source:** `src/ui/riding/RidingScreen.tsx`; `src/ui/shared/ConfirmDialog.tsx` and `src/ui/shared/operationInteractionGuard.ts` (comments only);
  - **version:** `0.4.59`;
  - **tests:** `src/ui/riding/RidingScreen.finishEndRide.test.tsx`, `e2e/endRidePausedConfirmationReveal.smoke.spec.ts` (new) and `e2e/confirmationRevealSettled.spec.ts`.

**Evidence — automated only.**

- **Unit and component.** The full suite passes: 4,923 tests in 208 files, 17 more than `0.4.58`. The 17 new C-11 cases stub geometry as C-12's do:
  - the opening fits, takes the minimum, or is oversized with its row shown or clipped;
  - no repeat on unrelated re-renders, and a fresh measurement on reopening;
  - Cancel and Escape: the minimal reveal of End ride, or none when it is in the band, with the stored session unchanged;
  - refused Cancel and Escape while the ending runs, and the unchanged plain focus after a failure;
  - C-10 unchanged, including a paused confirmation carried into riding by **Resume ride**;
  - the survivor revealed only once the header ref is back;
  - with Edit copy's confirmation reappearing too, End ride's reveal runs last and keeps focus;
  - with the Pause write held: the focus return after the release when the rider did nothing; none after a tap, a key, a wheel or a focus moved elsewhere; the header's own plain focus when the Pause fails; and the guard detached on unmount.
- **Browser, in the pinned container (the CI image, by digest), at 390×844 portrait.** `e2e/endRidePausedConfirmationReveal.smoke.spec.ts` (new) has 27 tests in Chromium and 26 in WebKit; the case with both confirmations reappearing runs in Chromium only.
  - **Input:** real pointer, wheel and key input. App scroll calls and the focus calls that moved focus are recorded, with the geometry just before each, along with location-watch starts.
  - **Cases:**
    - the paused matrix, English and German at 100% and 200%, with Cancel or Escape;
    - item 132's cold-start screen at English 200%, German 200% and English 100%;
    - a reopening after a wheel scroll;
    - the review's three scrolled cancellations;
    - the survivor after **Pause**, with scroll anchoring off (synthetic) at English and German 200% and English 100%, and with anchoring left on at English 200%;
    - both confirmations reappearing (Chromium);
    - a Cancel during a Pause held by the app's own e2e seam (synthetic), with the rider waiting or moving on by Tab or wheel;
    - C-10 at English 100% and German 200%;
    - End ride confirmed after the reveal.
  - **[behaviour] assertions:**
    - Cancel, then End ride, focused;
    - the confirmation, its row and End ride in the band;
    - movement of exactly the warranted amount;
    - the position kept until the focus return;
    - the stored session unchanged, **Resume ride** shown and no watch started.
  - **[implementation] assertions:** `preventScroll`, and one app scroll call accounting for all the movement.
  - **Results:** all 53 runs passed; the Chromium-only case was skipped in WebKit, as intended.
- **The frame recorder.** `e2e/confirmationRevealSettled.spec.ts` has two new Chromium cases at English 200%, at ordinary speed and under a 20× CPU throttle. They show only that the actions did not move by more than 1 px across the sampled frames, and that the opening was a reveal. Both pass on the unchanged build too, so they are regression guards, not discriminating tests.
- **Regression specs, run together with the new spec:**
  - `coldStartPausedRoute.smoke`, `ridingFinishAndEnd`, `germanRidingHeader`, `ridingImmersiveShell`, `ridingMapProfileViews` and `ridingPauseAfterResume.smoke`;
  - `editCopyConfirmationReveal.smoke`, `editCopyBusyState.smoke` and `editRouteAsPlanningCopy`;
  - `confirmationReveal.smoke`, `confirmationRevealSettled` and `confirmationDialogs.smoke`;
  - `ridingLauncher` and `rideSessionSwitchGuard`.

  307 passed, with the one skip.

- **The full browser suite, once, at 8 workers:** 1,001 passed, with the same one skip, in both engines and the `android-chrome` project, the new spec included.

- **Which branch each case took**, on the shipped build:
  - every ordinary-text opening: fits, no movement;
  - English 200%: a minimum reveal of exactly 535 px; German 200%: 566 px. The cold-start screen gave the same, and a reopening after a wheel scroll warranted, and moved, 37 px;
  - an immediate Cancel at 200%: no movement, End ride already in the band at 174–236 (English) and 130–192 px (German);
  - the scrolled cancellations: exactly the warranted −48, −56, −103, −158, −167 and −209 px, with no movement before the app's focus call;
  - the survivor at 200%: one reveal of 535 or 566 px once the navigation was back, the whole confirmation then in the band. With both survivors, Edit copy's 599 px came before End ride's 678 px.
- **Baseline, `16ba72d`** — the 53 runs of the new spec. The unit cases are separate: 13 fail on the unchanged source and 4 pass, the latter being regression guards for C-10, the failure path and Resume.
  - **39 fail on behaviour**, 20 in Chromium and 19 in WebKit: every case with a 200% opening, including the reopening and the confirmed ending; every immediate 200% cancellation; every scrolled cancellation; the survivors at 200%; both survivors; and the two moved-on cases, where the unchanged build took focus back to End ride.
  - **10 fail on the implementation assertion only:** the ordinary-text openings, the survivor at 100% and the held-Pause case where the rider waits. The page did not move there, but focus lacked `preventScroll`.
  - **4 pass:** the C-10 regression guards, in both engines.
- **Negative controls.** Each was applied alone to `RidingScreen.tsx`, built separately and restored byte-for-byte (SHA-256). Unit failures are of the 17 C-11 tests. Browser failures are of 55 runs: the new spec in both engines plus the two frame-recorder cases.

| Control | What it changes                                  | Unit failures | Browser failures                                                                                                                                                                 |
| ------- | ------------------------------------------------ | ------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a)     | the panel without `focusCancelWithoutScroll`     |             3 | 16 on behaviour — Chromium's 200% openings moved 634 / 590 px where 535 / 566 were warranted, and the survivors overshot in both engines; 26 implementation-only, most in WebKit |
| (b)     | the opening reveal removed, `preventScroll` kept |             5 | 27 on behaviour — every 200% opening left its row below the band — and both frame-recorder cases ("not a reveal")                                                                |
| (c)     | the wait for the sticky navigation removed       |             2 | 5 on behaviour — the survivors with anchoring off at 200% ended 58 / 89 px below the band, and both survivors; **with anchoring on, both engines compensated**                   |
| (d)     | Cancel reverted to the old plain focus return    |             7 | 20 on behaviour — the scrolled cancellations and the moved-on cases; 26 implementation-only                                                                                      |
| (e)     | "still waiting" forced true                      |             4 | 4 on behaviour — exactly the moved-on cases; the paired case where the rider waits still passed                                                                                  |
| (f)     | the header hand-off removed                      |             2 | 4 implementation-only — C-10's focus took `preventScroll`; nothing visible, since the fixed shell cannot scroll                                                                  |

**Findings worth carrying forward.**

- **The opening's correction removes the immediate cancellation's over-scroll as well.** After a minimum reveal End ride's slot is already in the band, so an immediate Cancel warrants nothing. The cancellation correction acts only once the rider has scrolled.
- **No clamping or anchoring movement was seen before a focus return** in any measured cancellation, in either engine. The allowance stays in the assertion all the same.
- **The header hand-off is load-bearing only for implementation.** Control (f) changes nothing the rider can see, because the riding shell cannot scroll. It is kept so that C-10's own focus code path and timing are exactly what they were.
- **A returning sticky header is again absorbed by scroll anchoring.** As in slice 7, removing the wait for the navigation failed only with anchoring switched off.
- **WebKit again needs no `preventScroll` to look right on opening.** Control (a) changed WebKit's openings on the implementation assertion only; its survivors overshot.

**Limitations, stated plainly.**

- **Measured at 390×844 portrait only**, in desktop Chromium and WebKit in a container. These are not iOS Safari, and browser root-text scaling is not iOS Larger Text.
- **The oversized branches are unit-only.** At 200% the German confirmation (690 px) still fits the 714 px band, and no synthetic oversized case was built for C-11.
- **Synthetic steps:**
  - scroll anchoring switched off for the survivors;
  - the Pause write held open by the app's e2e seam;
  - keyboard activation of a script-focused End ride and **Resume ride** in the both-survivors case.
- **A failed ending is unchanged.** Its plain focus can still leave End ride under the navigation if the rider had scrolled; failure is synthetic, and that case was not measured.
- **The survival across Pause and Resume is unchanged.** It is decision 4's separate slice.
- **Reasoned from source, not measured:**
  - in WebKit, a pointer Cancel while focus stays on an element that outlives a pending Pause drops the waiting focus return;
  - a second Escape during that wait counts as moving on.
- **Desktop keyboard only.** There is no VoiceOver, physical-keyboard, landscape or physical-Android result. `useLayoutEffect` is kept as the design guarantee and is not proved load-bearing here.

**CI and deployment.** Run [37153751967](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37153751967), for commit `bc4fb11`: **Verify and build, all four End-to-end shards and Deploy succeeded, each on its first attempt.** The durations come from the run's own job and step start and completion times, read once after the run and kept locally as saved job data. Verify and build's test step is its unit and component tests; each shard's is its end-to-end suite.

| Job              | Test step | Whole job |
| ---------------- | --------: | --------: |
| Verify and build |     174 s |     301 s |
| E2E shard 1/4    |     394 s |     450 s |
| E2E shard 2/4    |     623 s |     684 s |
| E2E shard 3/4    |     330 s |     392 s |
| E2E shard 4/4    |     626 s |     693 s |
| Deploy           |         — |       8 s |

The longest job, shard 4, left 507 s below the E2E jobs' 1,200-second timeout. The deployment served `0.4.59` / `bc4fb11`. These are one run's timings, not an established trend, and no sharding change is made or authorised here.

**Installed-iPhone acceptance, reported 3 October 2026.** The ordinary flows passed on `0.4.59` (build `bc4fb11`), in English and German: opening and cancelling End ride on the in-session and cold-start paused screens, the ride staying paused, reopening, Resume preserving the ride's position and progress, and the scrolled cancellation — End ride returning fully into view with only the necessary adjustment. This accepts slice 8's ordinary-flow checks only: the enlarged-text openings and cancellations, the oversized branches, the held Pause and the anchoring-off survivor keep their automated evidence and were not induced on the phone, and no location-watch count, progress or camera value was measured there. The dated record, with what it does not claim, is in [`current-status.md`](../current-status.md). **Next, approved:** the transition-dismissal slice (decision 4 above), which is slice 9, below.

## Slice 9 — Confirmations closed by a ride transition (C-10, C-11, C-12) (shipped `0.4.60`, 3 October 2026)

**Approved as decision 4 above.** An unconfirmed ride-screen confirmation closes quietly when **Start riding**, **Resume ride** or **Pause** successfully changes the ride context, and does not reappear when the rider returns to the previous context. It covers the survivors already recorded:

- End ride's confirmation moving between the riding header and the paused screen (C-10 and C-11), measured in the [review](../../design/reveal-inventory/ride-confirmations-review.md#transitions-measured);
- Edit copy's "Replace your current draft?" surviving **Start riding** and reappearing on **Pause** (C-12), recorded in slices 4 and 7.

Unchanged are:

- the launcher (C-07, C-08, C-09) and free roam (C-13), whose Pause already returns to the launcher with the confirmation gone;
- two independent confirmations open at once (D-07): no "one at a time" rule is added;
- the C-11 and C-12 opening and cancellation rules, and every Cancel and Escape.

**Success, from the ride lifecycle.** Read from `useRideNavigation.ts` before anything changed:

- **Start riding and Resume ride** call `start()`, which begins watching at once — status `idle` to `watching` — with no fix needed. A location error that follows, even one reported within the call, leaves the riding shell showing with **Try again**, so the context has still changed. Start is not refused from the pre-ride or paused screen.
- **Pause** writes its snapshot and only then stops the watch (`idle`). A Pause still being saved, a failed write and the hook's own refusals leave the ride active. The hook's refusal resolves silently, so the screen's "Pause resolved" is not a success signal.
- **Try again** (`error` to `watching`) and a return to the page (`stop(); start()` in one handler, rendered as one `watching`) do not change the context.
- The only other change, a successful End or Finish ride, closes End ride's confirmation itself.

**Mechanism** (`RidingScreen.tsx` only).

- **One adjustment during render.** When navigation's idle/active state differs from the one last seen, the screen records the new one and closes both confirmations. This is the file's existing "adjust state during render" idiom (`reachedManoeuvreIndex`, `wasStatusCardShown`).
- **Quiet by construction.**
  - React renders again before committing, so the confirmation is never mounted in the new context: no Cancel focus, no opening reveal.
  - Nothing records a Cancel, so no focus return or cancellation scroll follows.
  - Focus ends wherever the same transition leaves it with nothing open — on the page body in every measured case.
- **A confirmed operation keeps its confirmation**, and settles it as before:
  - End ride's while it finalises (`activeFinalizeSource === "end"`);
  - Edit copy's while its write is in flight (`isEditCopyInFlight`, D-06).

  Both are state rather than those operations' refs, since they are read during render.

- **Stays closed.** The open state itself is cleared, so later Pause and Resume cycles and screen returns cannot revive it. Reopening uses the unchanged handlers.
- **Unchanged:**
  - the C-11 and C-12 opening reveals, including their wait for the sticky navigation. No ordinary flow now reaches that wait; it is kept as a guard and pinned by one synthetic unit test each;
  - C-11's waiting Cancel and its guard;
  - D-06's context counter, navigation rule and failure focus;
  - item 131's one-use resume instruction and item 132's restore gating.

  The reveal comments that called the survivor "recorded separately, not fixed here" are updated.

- **Files:**
  - **source:** `src/ui/riding/RidingScreen.tsx`;
  - **version:** `0.4.60`;
  - **tests:** `src/ui/riding/RidingScreen.finishEndRide.test.tsx`, `src/ui/riding/RidingScreen.test.tsx`, `e2e/endRidePausedConfirmationReveal.smoke.spec.ts`, `e2e/editCopyConfirmationReveal.smoke.spec.ts` and `e2e/support/rideTransitionProbe.ts` (new).

**Evidence — automated only.**

- **Unit and component.** The full suite passes: 4,931 tests in 208 files, 8 more than `0.4.59`. The four tests that asserted the survival were rewritten. The cases are:
  - closing with no focus call and no scroll, and staying closed through the next transition: C-10 on **Pause**; C-11 on **Resume ride**; C-11 and C-12 together; and C-12 on **Start riding**, both before any fix and with a location watch that fails at once;
  - reopening C-11 and C-12 afterwards, each with its own opening reveal;
  - kept open: a Pause still being saved, closed once it succeeds; a failed Pause, whose Cancel is still C-10's; **Try again**; and a return to the page;
  - kept as running: a confirmed End ride carried, still "Ending ride…", across **Resume ride**; and a confirmed Edit copy write carried across **Start riding** and **Pause** in D-06's working state;
  - each opening reveal's wait for the sticky navigation, synthetic.
- **Browser, in the pinned container (the CI image, by digest), at 390×844 portrait.** 12 tests in each of Chromium and WebKit, in the two existing specs, replacing their survivor cases.
  - **The paired control**, the rider's refinement: each affected transition is compared with the same transition, from the same starting state and position, with nothing open (`e2e/support/rideTransitionProbe.ts`). A transition replaces the riding shell with the paused screen or the reverse, and whatever the browser does to the scroll position then, it does to both. So the movement is compared, never required to be nil.
  - **[behaviour] assertions:** no confirmation after the transition; focus ends where the control's did, never on Cancel, End ride or Edit copy; the page moved as the control's did.
  - **[implementation] assertions:** no scroll call and no focus call beyond the control's.
  - **Cases:**
    - C-10 and **Pause**, in English and German at ordinary text and in English at 200%, then **Resume ride** and **Pause** again;
    - C-11 and **Resume ride**, in both languages, and on item 132's cold-start screen in German;
    - C-11 and C-12 open together, then **Resume ride** and **Pause**;
    - C-12 with **Start riding** and the **Pause** after it, in both languages;
    - reopening, with Cancel, by the C-11 and C-12 rules;
    - synthetic: a Pause held open by the app's own seam, then released, in both languages, and failed, in German. The failure rejects the seam's promise through a test-only resolver beside the existing one; nothing in production changed.
  - **Measured:** every affected transition and its control started at the page's top and ended there. Focus ended on the page body in both, and neither made a scroll call or a focus call. The layout change shows only in the scrollable height, for example from 0 to 656 px on an English Pause.
  - **Results:** 24 of 24.
- **The full browser suite, once, at 8 workers:** 1,010 passed, in both engines and the `android-chrome` project, with nothing skipped — the Chromium-only survivor case that `0.4.59` skipped in WebKit is gone. Every regression spec slice 8 named is part of it, and both converted specs then passed again in full, 86 of 86, after formatting.
- **Baseline, `c5255ae`** (application code identical to `bc4fb11`, `0.4.59`):
  - **unit:** the 7 dismissal tests fail, each because the confirmation is still there; the other 9 pass — the failed and pending Pause, Try again, the confirmed operations and the synthetic waits;
  - **browser:** 22 of the 24 runs fail on behaviour — the confirmation still open, its Cancel focused. At 200% the old survivor's reveal moved the page 535 px where the control moved none. The 2 failed-Pause runs pass, as regression guards.
- **Negative controls.** Each was applied alone to `RidingScreen.tsx`, built separately and restored byte-for-byte (SHA-256). Unit failures are of the 317 tests in the two test files. Browser failures are of 30 runs: the 24 above plus the 6 existing runs that Cancel during a held Pause.

| Control | What it changes                                            | Unit failures                                                                    | Browser failures                                                                                                   |
| ------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| (a)     | the in-flight conditions removed                           | 2 — the confirmed End ride and Edit copy cases                                   | not run: no confirmed operation can be held in these specs                                                         |
| (b)     | Pause also dismisses at its press                          | 6 — the held and failed Pause, the Cancel-while-pausing group, Edit copy's write | 6 on behaviour — held and failed Pause — and 6 timeouts: the existing held-Pause cases find nothing left to cancel |
| (c)     | any status change dismisses, not only idle and active      | 1 — Try again                                                                    | not run: no location error in these specs                                                                          |
| (d)     | the dismissal made through End ride's Cancel path          | 4                                                                                | 18 on behaviour — focus lands on End ride                                                                          |
| (e)     | a layout effect after the commit, instead of during render | 4 — Cancel focused, and in the harness the 140 px opening reveal                 | 18 on the implementation check only — a focus call to Cancel; focus then fell to the body, and no reveal ran       |

**Findings worth carrying forward.**

- **Pause resolving is not Pause succeeding.** `pause()` resolves silently when it refuses, and the screen's code after its `await` is not guaranteed to land in the same commit as the status change. Acting on the status change itself avoids both.
- **Adjusting during render is load-bearing.** Control (e) shows that a post-commit effect mounts the confirmation for one commit: its Cancel takes focus, and wherever the navigation is already present the opening reveal is paid before the close. In the browser the navigation returns a commit after Pause, so only the focus call showed there.
- **The paired control made "no movement" meaningful.** At 200% the old survivor's reveal stood out against the control by exactly 535 px, while the transition itself changed the page's scrollable height legitimately.

**Limitations, stated plainly.**

- **Measured at 390×844 portrait only**, from the page's top, where these transitions start in ordinary use at this viewport, in desktop Chromium and WebKit. These are not iOS Safari, and browser root-text scaling is not iOS Larger Text.
- **Synthetic steps:** the held and failed Pause; and, in component tests only, the confirmed operations running across a transition, the immediate location failure and the sticky-navigation waits.
- **Observed, not changed:** **Resume ride** on the paused screen stays enabled while a confirmed End ride is finishing, where Back to Ride options is disabled. A Resume in that window starts a watch that the finishing End ride then stops. This slice keeps that confirmation showing "Ending ride…" and changes nothing else; it is recorded, not fixed.
- **Not newly tested:** **Start riding** while Edit copy's preliminary check is still reading; D-06's context counter already stops that confirmation opening.
- **Desktop input only.** There is no VoiceOver, physical-keyboard, landscape or physical-Android result.

**CI and deployment.** Run [37159182397](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37159182397), for commit `e2ba7cf`: **Verify and build, all four End-to-end shards and Deploy succeeded, each on its first attempt.** The durations come from the run's own job and step start and completion times, read once after the run and kept locally as saved job data. Verify and build's test step is its unit and component tests; each shard's is its end-to-end suite.

| Job              | Test step | Whole job |
| ---------------- | --------: | --------: |
| Verify and build |     177 s |     302 s |
| E2E shard 1/4    |     542 s |     607 s |
| E2E shard 2/4    |     522 s |     582 s |
| E2E shard 3/4    |     344 s |     410 s |
| E2E shard 4/4    |     791 s |     851 s |
| Deploy           |         — |      12 s |

The longest job, shard 4, left 349 s below the E2E jobs' 1,200-second timeout. The deployment served `0.4.60` / `e2ba7cf`. These are one run's timings, not an established trend, and no sharding change is made or authorised here.

**Installed-iPhone acceptance, reported 4 October 2026.** The ordinary flows passed on `0.4.60` (build `e2ba7cf`), in English and German: an unanswered End ride confirmation closing after a successful Pause or Resume ride and staying closed on the return; an unanswered Edit copy confirmation closing on the transition tried and staying closed after Pause — whether that was Start riding or Resume ride was not reported, so neither is claimed separately; deliberate reopening and Cancel; the cold-start paused screen; and the ride, its progress and the Planning draft preserved. This accepts slice 9's ordinary-flow checks only: a held or failed Pause, confirmed operations still running and an immediate location error keep their automated evidence and were not induced on the phone, and no location-watch count, progress or camera value was measured there. The dated record, with what it does not claim, is in [`current-status.md`](../current-status.md). **Item 124 stays active** while its remaining inventory is reconciled.

## Reconciliation of the remaining inventory (4 October 2026, documentation only — not a slice)

After slice 9's acceptance, every inventory entry was given an explicit disposition under the rider's direction of 4 October 2026, and P-18 was measured for the first time. The account — the direction verbatim, P-18's method and measurements, the closure table, the defects and concerns, the follow-up destinations and the decisions still needed — is the [reconciliation](../../design/reveal-inventory/closure-reconciliation.md); it is not repeated here.

- **P-18: a demonstrated problem.** In 22 runs in Chromium and WebKit — English and German, 100% and 200% root text, touch and mouse, from the page's top and from the lowest tappable position — selecting a surface warning on Planning's map left the selected row at the very bottom of the screen, with its "Surface: …" and "Route position: …" details below it. The smallest correction is proposed as slice 10: scroll the row with its details, rather than its button alone. It is **not approved**, and its design choices are listed for the rider.
- **Approved and proposed retentions are kept apart.** Retentions resting on an acceptance, a dated decision or the direction's points 2 and 3 are approved. P-01 (provisional), the disclosures, the non-candidate messages, P-07's reveal, P-21, P-26, P-29, P-33, C-14's other paths and D-04 are retentions proposed for the rider's confirmation.
- **Unresolved evidence:** P-15's result reveal, the placement of a failed End ride's message, and the launcher confirmation after a session re-read.
- **Deferred, not fixed:**
  - items 134 (Resume ride while a confirmed End ride finishes), 135 (focus continuity), 136 (where map- and chart-selected details appear), 137 (export-failure placement) and 138 (copy and comment corrections), all unscheduled;
  - P-17 to item 127, and C-14's button styling to item 103;
  - two monitoring lines in [`current-status.md`](../current-status.md).
- **Not closed.** Item 124 closes only once the rider has decided on slice 10, P-01 and the proposed retentions. No implementation, device check or version change came with the reconciliation.

## Decisions recorded on 4 October 2026

**Approved by the rider on 4 October 2026, after the [reconciliation](../../design/reveal-inventory/closure-reconciliation.md).** These are product decisions, **not device acceptance**. The same report carried an installed-iPhone observation of P-01, recorded only in [`current-status.md`](../current-status.md#installed-iphone-observation-of-p-01-rename-on-the-last-route-card-item-124-inventory-reported-4-october-2026).

1. **P-18 — the correction is approved, as slice 10.** A warning selected on the Planning map brings its row and its explanatory details into view together.
2. **Where it comes to rest:** below the sticky navigation and clear of the bottom safe area, with a small margin consistent with the app's existing reveal behaviour.
3. **Motion:** smooth scrolling is kept under ordinary motion preferences, and reduced motion is respected. The confirmations' instant movement is not copied merely for uniformity.
4. **Only as far as needed:** if the entire item already fits, nothing scrolls; otherwise the page moves only as far as needed.
5. **Taller than the usable viewport:** its beginning is aligned below the navigation, so that its label and the start of its explanation are visible, and the rider scrolls through the remainder normally. It is not repositioned repeatedly.
6. **Scope:** map-originated warning selections only. Bringing the separate **Clear warning selection** control into view is not required.
7. **The reconciliation's other proposed retentions are approved**, excluding P-01 and P-18, which remain unresolved:
   - the disclosures P-08 to P-14, P-16, P-20, P-27 and P-28;
   - the messages and overlays P-05, P-22, P-23, P-25, P-31, P-32, P-34 and P-35;
   - P-07's reveal, P-21 and P-26 (no automatic scroll; the cue stays with [item 136](../backlog.md#item-136)), P-29 and P-33;
   - C-14's other entry paths;
   - D-04.

   This approves retaining their behaviour under item 124. It is **not new device acceptance**, and their deferred focus questions stay with [item 135](../backlog.md#item-135).

8. **P-15 is measured before closure**, with a mocked provider.
9. **The two source-only concerns** — where a failed End ride's message appears, and what happens to the launcher's open confirmation when its session is re-read — are resolved through a narrow check or an explicit proposed deferral.

**P-01 stays unresolved** until its disposition is agreed. The device observation shows the focused field out of view on the last route card, which the reconciliation's provisional recommendation did not consider; a bounded browser reproduction accompanies slice 10. **Item 124 stays active**: implementing P-18 does not by itself close it.

## Slice 10 — A warning selected on Planning's map, revealed with its details (P-18) (shipped `0.4.61`, 4 October 2026)

**Approved by the rider on 4 October 2026** as decisions 1 to 6 above, after the [reconciliation](../../design/reveal-inventory/closure-reconciliation.md#p-18--a-surface-warning-selected-on-plannings-map) measured the defect. This is implementation approval, not device acceptance.

**The defect.** Selecting a surface warning on the map scrolled only its row's button into view (`scrollIntoView({ block: "nearest" })`). The row stopped flush with the screen's bottom edge, and the "Surface: …" and "Route position: …" lines the selection had opened stayed below the screen, in both engines, both languages and both text sizes.

**What the rider gets.**

- **A warning tapped or clicked on the map** brings its whole row — the button and the details it opens — into view together: below the sticky navigation plus 8 px, and above the visible screen's bottom less the safe-area inset plus 8 px.
- **Only as far as needed.** Nothing moves when the row and details already fit. Otherwise the page moves the minimum; arriving from below, as a map selection always does, the details come to rest 8 px above the bottom inset.
- **Taller than that band:** its beginning comes to rest 8 px below the navigation, so the label and the start of the explanation show, and the rider scrolls on for the rest.
- **Motion:** smooth under ordinary motion preferences, instant with reduced motion.
- **Once per map selection.** The movement is computed once and never repeated. A later, deliberate map selection reveals the newly selected warning.
- **Unchanged:**
  - a selection from the list, which still does not scroll;
  - the selection itself, the map's highlight and framing, the "Selected warning: …" announcement and focus;
  - **Clear warning selection**, which is not brought into view (decision 6);
  - waypoint placement, route calculation and every confirmation's reveal.
- **One side effect, intended:** a warning row without details, such as an access or ferry warning, is revealed by the same rule, so it now stops 8 px plus the inset above the bottom rather than flush.

**Mechanism.**

- **New `src/ui/planning/warningReveal.ts`.** `revealSelectedWarning` measures the selected item, reads the visual viewport as the other reveals do, and takes its delta from `routeCardTopReveal.ts`'s `computeTopRevealScrollDelta`, **unchanged**. It passes that function a visible bottom already reduced by `readSafeAreaInsetBottomPx()` plus `REVEAL_GAP_PX`, both from `confirmationRevealScroll.ts`.
  - That function is top-prioritising, which is exactly decisions 4 and 5. The confirmations' `computeConfirmationRevealDelta` would have been wrong here: it anchors an oversized item's bottom, which would hide the label.
  - One `window.scrollBy`, smooth unless reduced motion is set, with `left: 0`. An item with no laid-out box returns 0, as the confirmation helper does.
- **`RouteSummaryPanel.tsx`.** The reveal ref moves from the selected button to its `<li>`. The existing one-shot effect, keyed on the token that only map selections bump (a repeat tap included), calls the reveal with the sticky navigation's bottom, from a new optional `stickyHeaderRef` prop that `PlanningScreen` passes.
  - It stays a passive effect. The selection's own commit also collapses any route-feature panel and adds the 35 px "Clear the selected warning…" message below the map, both above the list, and the effect measures after them.
- **No accepted helper changes its code.** `routeCardTopReveal.ts` gains only a comment naming the new caller.
- **Files:**
  - **source:** `src/ui/planning/warningReveal.ts` (new), `src/ui/planning/RouteSummaryPanel.tsx`, `src/ui/planning/PlanningScreen.tsx` (one prop), `src/ui/library/routeCardTopReveal.ts` (a comment);
  - **version:** `0.4.61`;
  - **tests:** `src/ui/planning/warningReveal.test.ts` (new), `src/ui/planning/RouteSummaryPanel.test.tsx`, `src/ui/planning/PlanningScreen.test.tsx`, `e2e/planningWarningMapReveal.smoke.spec.ts` (new).

**Evidence — automated only.**

- **Unit and component.** The full suite passes: 4,945 tests in 209 files, 14 more than `0.4.60` and one new file.
  - `warningReveal.test.ts` (new, 12 cases): no movement when the item fits; the minimum from below and from above; an oversized item aligned below the navigation from below and from above, and left alone once aligned; sub-pixel tolerance; the synthetic 34 px inset; no navigation; no laid-out box; smooth and reduced-motion behaviour.
  - `RouteSummaryPanel.test.tsx`: the map-originated cases now stub the geometry, the selected item below the band with its button inside it, so a reveal that measured only the button would move nothing, and every "does not scroll" case is non-vacuous. New cases: an oversized item and the navigation's bottom; an item that already fits.
  - `PlanningScreen.test.tsx`: the map-to-list cases count the reveals — one per map selection, a repeat tap included, none from the list — and the now-unused `scrollIntoView` stub in the route-feature cases is gone.
- **Browser, in the CI image by digest, at 390×844 portrait unless stated.** `e2e/planningWarningMapReveal.smoke.spec.ts` (new): 13 tests in Chromium and 9 in WebKit.
  - **The path is the real interface.** Two waypoints placed by mouse; **Calculate route**; then a real touch tap — one case a mouse click — on the painted warning, located from the two waypoint markers and checked to hit the map canvas.
  - **Synthetic:** the provider is answered locally with a straight line between the requested waypoints and three surface warnings; the 34 px bottom inset is the documented `--safe-area-inset-bottom` seam; the short (390×460) and tall (390×1900) viewports are geometry stand-ins.
  - **[behaviour] assertions** are geometry measured in the page against the band, focus, the selection, the announcement and the waypoints; **[implementation] assertions** are the app's scroll calls, recorded by an init script.
  - **Both engines:** English and German at 100% and 200% root text, default and reduced motion; the synthetic inset; the lowest tappable start; the oversized item; a second warning selected after zooming out; and scrolling during the movement.
  - **Chromium only, as guards:** a mouse click; an item that already fits; a selection from the list; placement after **Clear warning selection**.
  - **Results:** 22 of 22, then 66 of 66 over three repeats.
- **Measured, the same in both engines:**

| Configuration                            | Page moved, unchanged build (px) | Page moved, `0.4.61` (px) | Row and details after (viewport px) | Band (px) |
| ---------------------------------------- | -------------------------------: | ------------------------: | ----------------------------------- | --------- |
| English 100%                             |                              858 |                       914 | 744–836                             | 75–836    |
| German 100%                              |                              969 |                     1,025 | 744–836                             | 75–836    |
| English 200%                             |                            2,192 |                     2,389 | 541–836                             | 91–836    |
| German 200%                              |                            3,020 |                     3,261 | 453–836                             | 122–836   |
| English 100%, 34 px inset (synthetic)    |                              858 |                       948 | 710–802                             | 75–802    |
| German 200% at 390×460, oversized (syn.) |                            3,304 |                     3,492 | 122–505: row and first line shown   | 122–452   |

Positions are rounded to the pixel; every bottom edge was within 0.5 px of the band's. On the unchanged build the row ended at the screen's bottom edge (844 px) and both detail lines were below it in every row of the table; in the oversized case the row ended at the viewport's bottom (460 px) with both lines below.

- **Scrolling during the movement**, the rider's refinement. The rider's wheel was dispatched once the smooth movement had visibly started and before it finished. **Qualified the same day by the [repair note](#slice-10-repair-note--the-end-to-end-test-that-failed-ci-4-october-2026-test-only):** that timing was a position read before the wheel was sent, not the wheel event itself, and the test that measured it later failed in CI. The engine figures below are corrected there.
  - **The app:** its one smooth call came before the wheel in every run, and it made no call afterwards; the page then stayed where it came to rest for the 2.2 s observed. Planning re-renders every second, and nothing re-issued the reveal.
  - **The engines, native behaviour:** headless WebKit applied the wheel once its own animation had finished (914 px, then 614). Headless Chromium did not apply a wheel that arrived during the animation, early or late, and finished at 914; the same wheel at rest scrolled normally. The unchanged build's smooth `scrollIntoView` behaved identically in both engines (Chromium ignored wheels at 190 and 509 px and finished at 858; WebKit went on to 558). This is the engines' own smooth scrolling, not a repositioning by the app, so no cancellation machinery was added.
  - **Touch was not reproduced:** Chromium's synthesized touch-scroll gesture moved nothing even at rest, so it was discarded, and nothing is claimed about a finger scrolling during the movement.
- **A selection from the list**, measured: it adds no scroll call, and the row stays where it was tapped. The selection also adds the 35 px "Clear the selected warning…" message above the list; scroll anchoring absorbs it, in Chromium and WebKit alike, and with anchoring switched off the row moved down 35 px instead. That is existing behaviour, unchanged here.
- **The full browser suite, once, at 8 workers:** 1,032 passed and 4 skipped — the new spec's Chromium-only guards under WebKit — in both engines and the `android-chrome` project.
- **Baseline: the unchanged application source** (`81dcd07`, identical to `e2ba7cf` apart from documentation), with the new spec and tests.
  - **Browser:** 20 of the 22 runs fail.
    - **17 fail on visible behaviour:** the four language and text-size configurations, the inset, the lowest tappable start, the oversized item and the second selection in both engines, and the mouse click — each because "Surface: …" or "Route position: …" is below the screen, or, oversized, because the row sits at the viewport's bottom with both lines below it.
    - **3 fail on implementation only:** the already-fitting item in Chromium, where the old code's `scrollIntoView` call moved nothing, and the scrolling-during-movement case in both engines, whose precondition reads the reveal's one smooth `scrollBy`.
    - **2 pass, as guards:** the list selection and placement.
  - **Unit:** 19 of the 199 tests in the three files fail, all on implementation: the old code calls `scrollIntoView`, which jsdom lacks, so the call throws. None of them is visible-behaviour evidence.
- **Negative controls**, each applied alone to `warningReveal.ts`, built for the browser runs, and restored byte-for-byte (SHA-256):

| Control | What it changes                        | Unit failures                                   | Browser failures                                                                                   |
| ------- | -------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| (a)     | no bottom cushion (inset and 8 px gap) | 6 — the geometry cases and the panel's minimum  | 15 on behaviour — every case arriving from below, both engines; the oversized and guard cases pass |
| (b)     | the sticky navigation's bottom ignored | 5 — the oversized and from-above geometry cases | 2 on behaviour — the oversized case, both engines: the only case a map tap can reach from above    |

**Findings worth carrying forward.**

- **The top-prioritising geometry already existed.** Reusing `computeTopRevealScrollDelta` with a reduced visible bottom gives decisions 4 and 5 exactly, with no accepted helper changed. The confirmations' helper anchors an oversized item's bottom and would have hidden the label.
- **A smooth programmatic scroll and the rider's own input are the engine's business.** Desktop Chromium dropped a wheel during the movement, before and after this slice alike, and desktop WebKit applied it afterwards. The app's part — one call, never repeated — is what the tests assert. **Qualified by the [repair note](#slice-10-repair-note--the-end-to-end-test-that-failed-ci-4-october-2026-test-only):** Chromium's dropping holds on the wheel event's own timing; WebKit's wheel always arrived after its movement, so nothing about WebKit during the movement is established.
- **Selecting a warning frames it on the map**, so a second warning is usually off the map until the rider zooms out; the test does so with the map's own control. After zooming out, the warnings are short on screen, and a tap must stay clear of an adjoining warning within the map's ±14 px hit box.
- **"Nothing moved" after a list selection is judged by the row's place on screen**, not by `scrollY`, which scroll anchoring changes by the 35 px message.

**Limitations, stated plainly.**

- **Desktop engines, not iOS Safari.** The 34 px inset is synthetic, browser root-text scaling is not iOS Larger Text, and the short and tall viewports are stand-ins.
- **The route is a synthetic fixture**, with three warnings in a straight line. Real routes can have many warnings, which lengthens the list, but the rule does not depend on the item's place in it.
- **A finger scrolling during the movement** was not reproduced; what iOS does then is its own scrolling.
- **No VoiceOver, physical-keyboard, landscape or physical-Android result.**

## Slice 10 repair note — the end-to-end test that failed CI (4 October 2026, test-only)

**The failure.** CI run [37203592186](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37203592186), for `3f58248`, failed in E2E shard 4, so Deploy was skipped and `0.4.60` stayed live. The rider read the retained failure: in **webkit-smoke**, "a rider who scrolls while the smooth reveal is still moving is not pulled back by the app" timed out at its `waitForFunction` (line 781); the rest of the shard was 254 passed and 4 skipped. **The artefact and job log were not accessible here** (401 and 403), and the CI run itself was **not reproduced**: shard 4 run locally with CI's settings passed 255 of 255.

**What local diagnostics established** — the pinned image by digest, `CI=1`, two workers; "constrained" adds a 4-CPU limit; diagnostics in the scratchpad only, never committed.

- **The old test waited for a transient position.**
  - Constrained, headless WebKit's smooth reveal stood within 4 px of its start for 0.8–2.4 s, then reached its destination in one step, in 8 of 8 runs. On the test's English route the first step was 1 px, which the old condition excluded, so the intermediate position it waited for never existed. It timed out 4 of 4, although it began polling before the movement ended.
  - Chromium timed out 1 of 4, when its first poll came 2 ms after the movement ended.
  - A labelled controlled variant, which starts observing 1.5 s after the reveal request, timed out 16 of 16 in both engines, constrained and not: once the movement has ended, no timeout can recover it.
  - This is **consistent with** the CI failure; it is not the CI run.
- **`atWheel` was not the wheel.** Recorded in the page, the real wheel event arrived 104–257 ms after `atWheel` had read an intermediate position. In WebKit it arrived after the movement had ended in every run that sent one (12 of 12).
- **A related weakness in the geometry tests.** Under the same limit, WebKit's stand-still outlasted the 500 ms quiet window that decided "settled", so 15 of 16 default-motion runs measured the page within 5 px of where it started. The movement then completed by itself, with no frame stimulation, and the final geometry was correct in all 8 diagnostic runs.
- **No application scroll call beyond the one reveal** appeared in any of these runs.

**The repair — test code only:** `e2e/planningWarningMapReveal.smoke.spec.ts`. No production, dependency, configuration, version or sharding change.

- **The recorder** is armed before the selection that starts a reveal. It records:
  - every scroll attempt — window and element scroll methods, `scrollIntoView` and `scrollTop` writes to the document — with its time, its start and its destination clamped to the page's range;
  - real wheel events, as the page received them;
  - the trajectory.

  The test's own positioning is recorded as **"test setup"**, never left out, and the whole record is attached to every result, pass or fail.

- **The interruption test is replaced** by "after the reveal request, a rider's wheel is followed by no further reveal or scroll from the app". The wheel is sent as soon as the request is recorded. The test asserts the real selection, the one smooth request, the wheel's arrival after it, and **no scroll attempt of any kind** after the wheel event, across Planning's once-a-second re-renders. Whether the wheel arrived during the movement is recorded as evidence only. Where the page ends is not asserted.
- **Uninterrupted reveals** now wait for the **expected final geometry in the measured band** — the bottom at the band's bottom, or, oversized, the top at its top — bounded at 8 s, a little over three times the worst 2.4 s observed. The existing assertions then judge it, so a missing or wrong reveal still fails, and a repeated one fails the one-call assertion.
- **"A later map selection"** returns to the top with one programmatic scroll, recorded as test setup. Its assertions expect exactly the two application reveals plus that one setup call. Its real-wheel check waits for the rider's own scroll to take effect, then asserts no application attempt after the wheel event.
- **What an engine does with a wheel during its own movement** stays a scratchpad diagnostic, outside the suite.

**Evidence.**

- **The repaired spec, unconstrained:** 22 of 22 in Chromium and WebKit, then 88 of 88 over four repeats in isolation. Uninterrupted reveals reached their expected geometry in 0.30–1.19 s.
- **Constrained, 4-CPU limit:** the spec passed 88 of 88 over four repeats, where the unchanged spec failed 23. Uninterrupted reveals reached their expected geometry in at worst 1.1 s (Chromium) and 1.9 s (WebKit).
- **Shard 4, constrained, every run of this spec passed:**
  - **At the 4-CPU limit:** the shard took 36 min against CI's 13. Twenty tests in other, unchanged specs failed, 18 of them `planningEnlargedTextLayout` timeouts.
  - **At a 6-CPU limit:** 25.5 min, with 5 failures in other specs.

  Those specs passed in CI and unconstrained. A CPU limit here is harsher than CI's runner, so neither run is offered as a reproduction of CI.

- **The negative control**, applied to `RouteSummaryPanel.tsx` alone and restored byte-for-byte (SHA-256); the rebuilt bundle matched `3f58248`'s.
  - **(a) The reveal reissued inside the first wheel handler** failed both targeted tests in Chromium, and neither in WebKit. WebKit runs the handler before it applies the wheel's scroll, and its wheel came after the movement, so the reissued reveal found nothing to move and made no scroll attempt. A reissue that moves nothing is, by design, not observable from scroll attempts.
  - **(b) The reveal reissued 150 ms after the first wheel** failed both targeted tests in both engines. The regression test failed on "no scroll attempt of any kind after the rider's wheel", with the reissued `scrollBy` recorded; the later-selection test failed on the rider's scroll being pulled back. The other 18 runs passed.
- **Checks:** lint, typecheck and the build with the pinned Node 24.18.0 and npm 11.16.0; `planningWarningRows` and `routeFeatureColouring` as regression; `format:check` last.

**Correction to slice 10's record above.** Its "Scrolling during the movement" evidence took `atWheel` as the wheel's timing, and that is not established. The wheel event's own timing now shows:

- **Chromium** did not apply a wheel that reached the page while it was still moving, in all 10 such runs (8 unconstrained, 2 constrained). It did not apply one that arrived within 5–12 ms after the last observed movement either (2 runs), and applied ones that arrived later.
- **WebKit** received the wheel after its movement in every run (12 of 12), so **nothing is established about WebKit during the movement**: "applied once its own animation had finished" means only that a later wheel was applied.
- **The unchanged build's comparison** (190 and 509 px) also rests on positions read before the wheel.
- **One caveat for the new evidence field:** Chromium can apply a wheel on its compositor before the page's handler runs, so a wheel handled at 614 px reads as "not during movement".

**Limitations.** Desktop headless engines only. A finger scrolling during the movement was never reproduced, and nothing is claimed about iOS. The CPU-limited conditions were harsher than CI's runner, not a copy of it. Repeated green runs are not offered as proof: the argument is that the required tests no longer depend on catching a native animation in flight. **P-18's installed-iPhone check is still pending**, until this build is deployed.

## Close-out investigations (4 October 2026, documentation only — not a slice)

With slice 10, P-01, P-15 and the two source-only concerns were investigated in desktop Chromium and WebKit, on the `0.4.61` build. The account — method, measurements, what each establishes and does not, and the options — is in the [reconciliation](../../design/reveal-inventory/closure-reconciliation.md#close-out-investigations-4-october-2026); it is not repeated here. **Nothing was fixed, and each disposition awaits the rider.**

- **P-01:** not reproduced in desktop engines, where the last card's field is on screen. The last card leaves no scroll room below, where a middle card leaves 990 px: consistent with the device observation if the keyboard covered the field, but not established. Recommended: defer to item 135; the alternative is a device-verified slice.
- **P-15:** with the button low on the screen, the result appears wholly below it in every case; nothing moves. Recommended: a bounded correction, as a further slice; the alternative is retention.
- **A failed End ride's message**, with a synthetic failure: clipped at the screen's edge in the riding header — 55% visible in English, 36% in German. Recommended: a new unscheduled item.
- **The launcher's confirmation**, in two browser tabs only: no re-read happens, and confirming a stale launcher confirmation ended the other tab's newer session. Not reachable in the installed single-window PWA. Recommended: a new, low-priority item.
- **Item 124 stays active** until P-18's device check and these decisions.

## Slice 10's acceptance and CI, and the close-out dispositions (4 October 2026, documentation only — not a slice)

**Installed-iPhone acceptance, reported 4 October 2026.** The ordinary tested flows passed on `0.4.61` (build `ae76f98`), in English and German:

- a warning selected on Planning's map brought its information into view as expected, with movement as the rider expected;
- a selection from the list behaved normally;
- the rider's own scrolling afterwards was respected;
- clearing the selection permitted normal waypoint placement.

This accepts slice 10's ordinary-flow checks only.

- **Reduced Motion was optional and is not accepted:** the report asks what it means rather than reporting a result.
- **The conditional second-warning check is not claimed separately:** the report does not say whether a route with two surface warnings was available.
- **No further evidence came with it:** no Status reading, measured geometry, finger during the movement, enlarged text, VoiceOver, physical keyboard, landscape or Android evidence.
- **The accepted build stays `ae76f98`** after later deployments.
- **Automated evidence, separate from the device acceptance:** the synthetic provider, the stand-in viewports and the [repair note](#slice-10-repair-note--the-end-to-end-test-that-failed-ci-4-october-2026-test-only)'s corrected timing evidence.

The dated record, with the rider's words, is in [`current-status.md`](../current-status.md#installed-iphone-acceptance-of-0461-build-ae76f98-item-124-slice-10-p-18-reported-4-october-2026).

**CI and deployment.** Run [37215419294](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37215419294), for commit `ae76f98`: **Verify and build, all four End-to-end shards and Deploy succeeded, each on its first attempt.** The durations come from the run's own job and step start and completion times, read once after the run and kept locally as saved job data. Verify and build's test step is its unit and component tests; each shard's is its end-to-end suite.

| Job              | Test step | Whole job |
| ---------------- | --------: | --------: |
| Verify and build |     174 s |     296 s |
| E2E shard 1/4    |     410 s |     466 s |
| E2E shard 2/4    |     654 s |     716 s |
| E2E shard 3/4    |     348 s |     414 s |
| E2E shard 4/4    |     795 s |     857 s |
| Deploy           |         — |       8 s |

The longest job, shard 4, left 343 s below the E2E jobs' 1,200-second timeout. The deployment served `0.4.61` / `ae76f98`, read again from the deployed bundle on 4 October 2026. These are one run's timings, not an established trend, and no sharding change is made or authorised here.

**The rider's dispositions, 4 October 2026.** These were given with the acceptance ("I agree with you recommendations otherwise"), together with the rider's further directions and two answers the same day. They are product decisions, **not device acceptance**, and continue the numbering of the [decisions recorded earlier that day](#decisions-recorded-on-4-october-2026).

10. **P-01 — deferred to [item 135](../backlog.md#item-135).** The rider's [device observation](../current-status.md#installed-iphone-observation-of-p-01-rename-on-the-last-route-card-item-124-inventory-reported-4-october-2026) stays recorded: on the last route card, Rename's focused field did not come into view, though scrolling brought it into view and Save and Cancel stayed reachable. So does its [desktop non-reproduction](../../design/reveal-inventory/closure-reconciliation.md#p-01--rename-on-the-last-route-card): there, the last card's field is on screen, with 0 px of scroll room below, against a middle card's 990 px. The keyboard mechanism is unresolved. **Deferral is neither acceptance nor a fix.**
11. **P-01's desktop action-row clipping — deferred with it, as a separate finding**, by the rider's answer the same day.
    - **The finding:** on a middle card, the opened editor's Save and Cancel row ends 21 px below the usable band, about 13 px beyond the viewport's edge. It was measured on 1 October and reproduced on 4 October, in desktop engines only, with no software keyboard.
    - **Kept distinct:** it concerns partly clipped actions, whereas the device observation concerns the last card's focused field.
    - **For item 135:** it assesses the visibility of the field and the actions together, keyboard and visual-viewport behaviour included, without assuming a shared cause. Neither finding is accepted or fixed.
12. **P-15 — a bounded correction approved, as slice 11.** When the current **Test routing connection** completes and the rider is still waiting, the result line is revealed only as far as needed.
    - **Where it comes to rest:** below the sticky navigation and clear of the bottom safe area, with the existing small margin.
    - **Only as far as needed:** no movement when it fits.
    - **Motion:** smooth under ordinary motion preferences, respecting Reduced Motion.
    - **Taller than the usable band:** its beginning first; the rider scrolls normally through the rest.
    - **Not required:** bringing the diagnostic grid and **Copy diagnostic report** into view.
    - **Focus and the announcement:** both preserved; the result is never focused merely to reveal it.
    - **A rider who has moved on:** if they scrolled, tapped elsewhere, moved focus elsewhere or left Status while the request was pending, their position and focus are left alone.
    - **Once per completion:** one reveal per eligible completion; rerenders never restart it, and each later deliberate attempt gets a fresh eligibility decision.
    - **Hidden document, by the rider's further answer:** the document becoming hidden while a test is in flight — switching apps or locking the phone — also counts as moving on, for that attempt. Returning does not re-enable it, and the request and its result are neither cancelled nor suppressed.
    - **Focus questions** stay with item 135.
13. **A failed End ride's message — filed as [item 139](../backlog.md#item-139)**, a separate, unscheduled presentation defect. No fix comes with slice 11.
14. **The stale launcher confirmation — filed as [item 140](items-132-NN.md#item-140)**, a separate, unscheduled correctness item. No priority is assigned, and the execution order is unchanged.

**Where item 124 stands.** Slice 11, P-15, is the next and only approved slice. Every other inventory entry now has a disposition ([reconciliation](../../design/reveal-inventory/closure-reconciliation.md#dispositions-after-slice-10s-acceptance-4-october-2026)), and item 124 stays active until slice 11's installed-iPhone acceptance. Item 122's design stage has not started.

## Slice 11 — The routing-connection result revealed (P-15) (shipped `0.4.62`, 4 October 2026)

**Approved by the rider on 4 October 2026** as [decision 12](#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice), with the rider's further answer that an app hidden while a test runs counts as having moved on. This is implementation approval, not device acceptance.

**The defect,** measured in the [close-out investigation](../../design/reveal-inventory/closure-reconciliation.md#p-15--the-routing-connection-result): with **Test routing connection** low on Status, its result line, the grid below it and **Copy diagnostic report** appeared wholly below the screen, in both engines and both languages, for success and every failure. Nothing moved; the only visible change was the button's label returning.

**What the rider gets.**

- **When the current test finishes and the rider is still waiting**, the result line comes into view:
  - **where:** below the sticky navigation and the Settings/Status switcher plus 8 px, and above the visible screen's bottom less the safe-area inset plus 8 px;
  - **how far:** not at all when it already fits, otherwise by the minimum;
  - **taller than that band:** its beginning comes to rest just below the switcher, and the rider scrolls on for the rest;
  - **motion:** smooth, instant with reduced motion;
  - **not required:** bringing the grid and **Copy diagnostic report** into view.
- **"Still waiting"** means no rider input since the tap that started the test. Each of these counts as having moved on, and the page and focus are then left alone:
  - a scroll by wheel or touch;
  - a tap or click elsewhere;
  - a key;
  - focus moved to anything else;
  - leaving Status, for Settings or another tab;
  - the app hidden — switching apps or locking the phone — even once it is visible again.

  A repeated tap on the disabled **Testing…** button still counts as waiting.

- **Once per completion.** Re-renders never repeat it, and each new attempt decides afresh, in both directions.
- **Unchanged:**
  - the request and its error classification;
  - the result's text, the grid and the button's states;
  - the stored key, copying and the copied report;
  - the result line's `role="status"` announcement. Nothing is focused to reveal it.

**Mechanism.**

- **New `src/ui/diagnostics/connectionTestResultReveal.ts`.**
  - **`revealConnectionTestResult`** is the same composition as slice 10's `warningReveal.ts`, which stays byte-identical rather than being generalised. It uses `computeTopRevealScrollDelta` (`routeCardTopReveal.ts`), unchanged, with a visible bottom reduced by `readSafeAreaInsetBottomPx()` plus `REVEAL_GAP_PX` (`confirmationRevealScroll.ts`), then makes one `window.scrollBy`, smooth unless reduced motion is set.
  - **`armConnectionTestWaitGuard`** composes the accepted `armOperationInteractionGuard`, unchanged, with the button as its area: a `pointerdown` elsewhere, any key, a wheel or a `touchmove` disarms it. It adds two signals of its own:
    - **`focusin` outside the button.** A disabled button losing focus fires only blur and focusout, so this tells the activation's own focus loss apart from a deliberate move. `document.activeElement` could not, since a WebKit tap need not focus the button.
    - **`visibilitychange` to hidden**, which never re-arms.
- **`DiagnosticsScreen.tsx`.**
  - **One guard per attempt**, held in a ref and armed inside the click, after the existing early return.
  - **One layout effect, keyed on `isTestingConnection` and the two sticky refs,** acts on the commit in which the test ends. It takes the guard, reads `armed`, detaches it, and reveals only if the rider was still waiting.
  - **Why that is enough:** the result commits with or before the label returns (`.then` runs before `.finally`), so no batching is assumed. A detached guard reads as disarmed, so nothing reveals twice.
  - **An unmount cleanup detaches the guard.** That is the protection for a completion after the rider has left: an unmounted screen's state updates do nothing, and its effect never runs.
- **`SettingsSection.tsx`** passes App's navigation ref and its switcher ref to Status, as it already does to Settings. **`routeCardTopReveal.ts`** gains a comment only.
- **Files:**
  - **source:** `src/ui/diagnostics/connectionTestResultReveal.ts` (new), `src/ui/diagnostics/DiagnosticsScreen.tsx`, `src/ui/settings/SettingsSection.tsx`, `src/ui/library/routeCardTopReveal.ts` (a comment);
  - **version:** `0.4.62`;
  - **tests:** `src/ui/diagnostics/connectionTestResultReveal.test.ts` (new), `src/ui/diagnostics/DiagnosticsScreen.test.tsx`, `src/ui/settings/SettingsSection.statusRefs.test.tsx` (new), `e2e/statusConnectionResultReveal.smoke.spec.ts` (new).

**Evidence — automated only.**

- **Unit and component.** The full suite passes: 4,975 tests in 211 files, 30 more than `0.4.61` and two new files.
  - **`connectionTestResultReveal.test.ts`** (new, 20 cases): the geometry, mirroring slice 10's; and the wait guard — `focusin` on the button against elsewhere, focusout and blur alone, a hidden document not re-armed by a visible one, the composed guard's signals, and `detach` removing every listener.
  - **`DiagnosticsScreen.test.tsx`** (9 new): with the line's box stubbed and the clock's interval faked, it checks:
    - one reveal per armed completion, kept across ticks and a live re-render;
    - none after a wheel, a tap elsewhere, a focus move, a hidden app or an unmount;
    - a repeated tap on the disabled button;
    - fresh eligibility both ways;
    - focus unchanged.
  - **`SettingsSection.statusRefs.test.tsx`** (new): Status receives both sticky refs.
- **Browser, in the CI image by digest, at 390×844 portrait unless stated.** `e2e/statusConnectionResultReveal.smoke.spec.ts` (new) has 24 tests in Chromium and 23 in WebKit.
  - **The path is the real interface.** Settings, then the switcher's **Status**; a test-setup scroll that puts the button's bottom 4 px above the band; then a real touch tap. One case uses Enter, and one, Chromium only, a mouse click.
  - **Synthetic:**
    - the provider is answered locally, each request held until the test answers it with a success, a 401 or a network failure;
    - the 34 px inset is the documented `--safe-area-inset-bottom` seam;
    - the 390×360 viewport is a stand-in;
    - a hidden app is a dispatched `visibilitychange`;
    - a programmatic focus stands in for assistive technology.
  - **[behaviour] assertions** are the line against the band measured in the page, the button, focus and the text. **[implementation] assertions** are the app's scroll calls, recorded by an init script that marks the test's own positioning as "test setup". The final geometry, the reveal's duration and every call are attached to each result as diagnostics.
  - **Waiting.** An uninterrupted reveal waits for the line's measured final place, bounded at 8 s. No test catches the engine's smooth scroll in flight.
  - **Both engines:**
    - English success and network failure, German 401 and network failure, English success and German network failure at 200% root text, and the synthetic inset;
    - reduced motion;
    - an already-fitting line, and a line on screen but inside the cushion;
    - the oversized line;
    - a completion delayed 2.5 s;
    - a repeated tap on the disabled button, and Enter;
    - five ways of moving on: a wheel, a tap elsewhere, a programmatic focus, Tab and a hidden app;
    - an older completion after Settings and back, while a newer attempt runs;
    - a completion after leaving for Routes;
    - three attempts — waiting, moved on, waiting;
    - and the rider's own wheel after a reveal, followed by more than two re-render ticks.
- **Measured, the same in both engines** (the 200% rows differ by 1 px):

| Configuration                         | Line height (px) | Unchanged build: line (viewport px) | `0.4.62`: page moved (px) | Line after (viewport px) | Band (px) |
| ------------------------------------- | ---------------: | ----------------------------------- | ------------------------: | ------------------------ | --------- |
| English success, 100%                 |               56 | 867–923, below the screen           |                        87 | 780–836                  | 136–836   |
| English network failure, 100%         |              113 | 905–1,018, below the screen         |                       182 | 723–836                  | 136–836   |
| German 401, 100%                      |               75 | 849–924, below the screen           |                        88 | 761–836                  | 136–836   |
| German network failure, 100%          |              132 | 906–1,038, below the screen         |                       202 | 704–836                  | 136–836   |
| English success, 200%                 |              178 | 874–1,052, below the screen         |                   216–217 | 658–836                  | 156–836   |
| German network failure, 200%          |              498 | 1,038–1,536, below the screen       |                   700–701 | 338–836                  | 187–836   |
| English success, 34 px inset (synth.) |               56 | 833–889: 11 px, inside the inset    |                        87 | 746–802                  | 136–802   |

Positions are rounded to the pixel; every bottom edge after the reveal was within 0.7 px of the band's. In the oversized stand-in (German network failure at 200%, 390×360), the line, taller than the band, came to rest with its top at the band's top after a 177–178 px movement; on the unchanged build it stayed 177 px below that place.

- **Results:**
  - **The final spec:** 47 of 47, then 141 of 141 over three repeats.
  - **Under a 4-CPU limit with two workers:** 47 of 47, then 94 of 94 over two repeats.
  - **Settling times:** uninterrupted reveals reached their measured final place in 0.40–0.73 s in Chromium and 0.39–0.53 s in WebKit unconstrained, and at worst 0.73 s and 1.74 s under the limit — within the 8 s bound carried over from slice 10's measurement.
- **The full browser suite, once, at 8 workers:** 1,079 passed and 5 skipped — 47 runs and one skip more than `0.4.61`'s 1,032 and 4, the skip being the Chromium-only mouse case under WebKit. It ran before the spec's arrival settle, a finding below, which the repeats above cover.
- **Baseline: the unchanged application source** (`55f6ae8`'s, identical to `ae76f98`'s), with the new spec and tests.
  - **Browser:** 33 of the 48 runs fail.
    - **31 fail on visible behaviour:** every case that expects a reveal, because the result line is below the screen — or, in the oversized case, 177 px below its place.
    - **2 fail on implementation only:** reduced motion, in both engines, whose first assertion is the one immediate call.
    - **14 pass:** the already-fitting line, a completion after leaving for Routes, and the five moved-on cases, in both engines. Nothing ever reveals there, so the moved-on passes are vacuous: the guards are proved by the controls below, not by the baseline.
  - **Unit:** 5 of the 66 tests in the three files fail: the four component cases that expect a reveal, and the refs test. The five moved-on component cases pass vacuously. None of the unit failures is visible-behaviour evidence.
- **Negative controls**, each applied alone, built and run against both test sets, and restored byte-for-byte (SHA-256):

| Control | What it changes                                                  | Unit failures                                          | Browser failures                                                                                                                                                              |
| ------- | ---------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a)     | the guard ignored: always revealed                               | 5 — the moved-on and fresh-eligibility component cases | 12 on behaviour — the five moved-on cases and the three attempts, both engines; the leave cases pass, being structural                                                        |
| (b)     | no `focusin` listener                                            | 4 — three guard cases and the focus component case     | 2 on behaviour — the programmatic focus, both engines, and nothing else                                                                                                       |
| (c)     | no `visibilitychange` listener                                   | 3 — two guard cases and the hidden-app component case  | 2 on behaviour — the hidden app, both engines, and nothing else                                                                                                               |
| (d)     | no bottom cushion: the band ends at the screen's edge            | 7 — the geometry cases and the component reveal cases  | 31 on behaviour — every case arriving from below, the cushion and inset cases included, with the line flush at 844 px; the oversized, already-fitting and moved-on cases pass |
| (e)     | the switcher ignored: the band begins below the navigation alone | 0                                                      | 2 on behaviour — the oversized case, both engines, its top 64–65 px under the switcher, and nothing else                                                                      |
| (f)     | a second reveal on every render, ignoring the guard              | 8 — every component case that counts reveals           | 41 — among them the rider's later wheel, on behaviour: the line pulled back into the band                                                                                     |
| (g)     | the reveal focuses the result line                               | 1 — the component focus check                          | 16 on behaviour — every focus assertion: the geometry cases and Enter, both engines                                                                                           |

Control (d)'s first build failed — removing the cushion left its imports unused — so its first browser run used the previous control's bundle and was discarded; a variant that keeps them compiled, and is the one reported. Controls (a) to (f) ran against the spec before its last test-only changes — the attached geometry diagnostics, the focus allowance and the arrival settle, the last two described below; (g) and the baseline were run again on the final spec, with the same results.

**Findings worth carrying forward.**

- **The guard composes rather than changes.** The accepted `operationInteractionGuard.ts` already treats a pointerdown elsewhere, a key, a wheel and a touch scroll as moving on, and a repeated tap on the disabled button as waiting. P-15 needed only two signals more — focus moved elsewhere and a hidden app — and adding them outside it leaves the four accepted callers untouched.
- **`focusin` separates the activation's focus loss from a deliberate move.** Disabling the focused button fires only blur and focusout, so the guard sees nothing then. Control (b) shows that nothing else in the set catches a focus move without a key or a tap.
- **React's own focus restoration writes the root's scroll position.** In Chromium, every activation records two `scrollTop` writes from the bundle's commit path: React saves the ancestors' scroll offsets, refocuses the now-disabled button and writes them back. They move nothing, precede any answer, and appear on the unchanged build too; the spec measures the app's calls from after the activation.
- **Linux WebKit keeps a just-disabled button focused until a deferred focus fixup**, which landed after the test's snapshot in 2 of 3 repeats. The focus assertion allows exactly that change and nothing else, and control (g) still fails it.
- **Settings' arrival reset can outlive a wall-clock wait.** Under the CPU limit, headless WebKit deferred the reset loop's frames past the test's 1.2 s wait, and the loop flattened the test's own setup scroll; Playwright's tap then scrolled the button to mid-screen, which looked like an over-reveal. The spec now requests frames before positioning, as `settingsStatusSwitcher.smoke.spec.ts` does. This is a test-sequencing matter: a rider's touch, pointer or wheel ends the loop at once.

**Limitations, stated plainly.**

- **Desktop engines, not iOS Safari.** The inset is synthetic, browser root-text scaling is not iOS Larger Text, and the short viewport is a stand-in. WebKit here is Playwright's Linux WebKit, whose focus behaviour is not iOS Safari's.
- **Every provider answer is synthetic**: a success, a 401 and a network failure. A 429 and a malformed body were not run here; they produce result lines of the same kind.
- **Assistive technology is a stand-in:** a programmatic focus. Whether VoiceOver moving its cursor fires `focusin` on the phone is not established, and the line's announcement was not heard.
- **A hidden app is a dispatched `visibilitychange`**, not a real app switch or lock.
- **A finger scrolling during the movement** was not tested, by the rider's instruction not to repeat slice 10's experiment; what iOS does then is its own scrolling.
- **No VoiceOver, physical-keyboard, landscape or physical-Android result.**

**The installed-iPhone check is Session 5 of [`current-status.md`](../current-status.md).** It uses the key already saved on the phone, and it neither invalidates the key nor induces errors or slow requests. **Item 124 stays active until that check:** its ordinary flows still need device acceptance, while the delayed-request, failure, leave and hidden-app cases keep the automated evidence above.

**Slice 11's acceptance, its CI run and item 124's closure**, all on 4 October 2026, are recorded in the entry's [closure section](item-124.md#closure-4-october-2026).
