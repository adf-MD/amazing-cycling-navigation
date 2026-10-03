# D-02 — Delete route's pending and failure lifecycle: investigation and plan

**Update, 3 October 2026: implemented in `0.4.57`, as item 124's slice 6; not yet accepted on the device.** The rider approved the implementation and chose option A in the [decision below](#decision-for-the-rider), reported 3 October 2026. The delivered behaviour, the seven differences from this report's recommendation and why, the evidence, the baseline, the negative controls and the limitations are recorded once, in [item 124's slice 6 record](../../project/backlog.md#slice-6--delete-route-pending-and-failing-d-02-shipped-0457-3-october-2026); this report is otherwise kept as written, as the investigation's record.

**Status: investigated and planned, 3 October 2026. Not implemented, not accepted.** This is item 124's D-02 investigation and planning stage ([backlog](../../project/backlog.md#item-124)), carried out against `439e578` (`0.4.56`). It establishes what causes each recorded problem and proposes a bounded implementation. No application source, test, dependency, configuration or version changed. The approved policy it serves is decision 4 and decision 5 of the [inventory's decisions](README.md#decisions--d-06-d-02-d-01-and-c-12-2-october-2026). The [review preparation](README.md#d-02--delete-route-fails-1) holds the earlier measurements, which are reproduced below rather than assumed.

## Contents

- [Summary](#summary)
- [Method](#method)
- [Reproduction on the unchanged build](#reproduction-on-the-unchanged-build)
- [The causal sequence](#the-causal-sequence)
- [Confirmed, inferred and unresolved](#confirmed-inferred-and-unresolved)
- [What a storage-only change fixes, and what it exposes](#what-a-storage-only-change-fixes-and-what-it-exposes)
- [Recommended implementation](#recommended-implementation)
- [Alternatives considered](#alternatives-considered)
- [Decision for the rider](#decision-for-the-rider)
- [Test plan](#test-plan)
- [Installed-iPhone checks](#installed-iphone-checks)
- [Limitations](#limitations)

## Summary

The four recorded problems have three separate causes, in three layers.

- **The route vanishes while its deletion is pending, and stays hidden after a failure.** This is the storage layer.
  - **Pending:** Dexie 4.4.5's live-query cache removes the route from the list optimistically, before the transaction commits.
  - **After an abort:** Dexie does not re-run the list query, because of how its change tracking describes an index-ordered query. So the list keeps showing the route as deleted although it is still stored.
  - **On the app side:** `RouteLibrary` keeps the failure inside the route's card, which no longer exists, so nothing shows it.
- **Technical English text.** `RouteLibrary` shows the raw `error.message`, which differs by engine.
- **The actions below the visible area, and focus lost.** These are `RouteListItem`'s confirmation:
  - the failure alert grows it with no reveal;
  - a focused **Delete route** that becomes disabled loses focus in Chromium;
  - nothing returns focus afterwards.

**Recommended.** A deletion runs in an explicit Dexie transaction, which no longer has an optimistic removal. The confirmed deletion is owned by `App`, so it survives leaving Routes. Its "Deleting…" state stays until the live list itself no longer contains the route. Its card refuses conflicting actions while it runs. Every failure shows the translated message. Focus is restored only when the rider is still waiting at the card, or when the rider's own focus was inside the card that was removed — never because focus happens to be on the page body.

The [decision for the rider](#decision-for-the-rider) concerns a single situation: a failure arriving while the rider's own filter hides the route.

## Method

- **Builds.** Three scratch copies of `439e578` were made with `git archive`, outside the repository, and each was built with `vite build`:
  - **base**, unchanged;
  - **instr**, with temporary `window.__acnProbe` hooks:
    - in `useLiveQuery`'s `next`, for route arrays only;
    - a `RouteLibrary` state, mount and unmount effect;
    - logging around `deleteRoute`'s promise;
    - a `RouteListItem` layout-effect cleanup reporting whether focus was inside the card as it was removed;
  - **cand**, which is _instr_ plus `deleteRoute` in an explicit `db.transaction("rw", db.routes, …)`.

  **The main checkout was never edited.** The SHA-256 of all 604 tracked files was identical before and after the experiments.

- **Environment.** `vite preview` ran in the pinned container `mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f…`.
  - **Engines and viewport:** desktop Chromium and WebKit at 390×844 portrait.
  - **Language and text size:** English, with English and German at ordinary and 200% root text where layout matters.
  - **Isolation:** the local map style; service workers blocked.
- **Input.** Real pointer clicks at measured centres inside the usable band, real wheel input and real key presses.
- **Fixtures, all synthetic, all in the page:**
  - **an immediate fault:** `IDBObjectStore.prototype.delete` throws for the app's `routes` delete;
  - **a hold:** the probe's own `readwrite` transaction on `routes`, kept alive by chained reads. It is bounded by 30 s and always released;
  - **an abort:** the app's queued transaction, captured from the delete call, is aborted at release, giving a delayed failure;
  - **a read fault:** `IDBIndex.prototype.getAll` throws for `routes`, standing in for a live-query failure.

  No held store was read while it was held. Stored rows come from a read made after the release.

- **Recorded, with timestamps:**
  - from IndexedDB:
    - the app's `readwrite` transactions on `routes` being created, completing and aborting, with listeners registered before Dexie's own;
    - real reads of `routes` (index `getAll` or `openCursor`), which separate a cache-served re-run from an IndexedDB read;
  - from the app: the _instr_ and _cand_ hooks;
  - from the page:
    - every DOM commit that changed the route list or the target card, through a `MutationObserver`;
    - every painted frame that did so, through `requestAnimationFrame`;
    - focus moves;
    - the app's own scroll calls.
- **Dexie in isolation.** A Node script used fake-indexeddb 6.2.5 and Dexie 4.4.5 from `node_modules`, with no React or app code, and ran 14 cases.
- **Runs:**
  - 38 per build, so 114 across the three. Each build ran the immediate fault in English and German at ordinary and 200% text, and 15 lifecycle cases in English at ordinary text, in both engines;
  - 20 repeats of the candidate's commit ordering;
  - 8 conflicting-action runs.

  Every run completed. The probe is in the session scratchpad and is not committed.

## Reproduction on the unchanged build

All results are the same in both engines unless stated.

**An immediate failure**, with the card's **Delete** placed 60 px above the band's bottom before the confirmation opened:

| Measure                      | Ordinary text                                                                                                                                | 200% text                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| The confirmation grows by    | 37 px                                                                                                                                        | 164 px                                              |
| The action row afterwards    | 24 px below the band                                                                                                                         | 139 px below the band (a two-line, 140 px-tall row) |
| Page movement                | none                                                                                                                                         | none                                                |
| Message, in both languages   | "probe fault UnknownError: probe fault" — the raw text, not "That route could not be deleted." / "Diese Route konnte nicht gelöscht werden." | the same                                            |
| Focus                        | Chromium: `<body>`. WebKit: still on **Delete route**                                                                                        | the same                                            |
| Escape afterwards            | Chromium: nothing, as focus is outside the confirmation. WebKit: it closes, and focus returns to **Delete**                                  | the same                                            |
| Transaction and stored route | the implicit transaction **completes** with no request in it; the route is still stored                                                      | the same                                            |

**A held deletion**, then committed or aborted:

| Step                                                               | What happens                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirm                                                            | "Deleting…" is committed 10–11 ms after the press and painted for one frame. The card leaves the DOM 18–24 ms after the press, while the transaction is still queued, with **no IndexedDB read** (_instr_: a live-query emission without the route at about 20 ms). |
| Commit (released after about 1 s)                                  | The transaction completes; focus moves to the next card's name. The list was already correct.                                                                                                                                                                       |
| Abort (released after about 1 s)                                   | `deleteRoute` rejects; `RouteLibrary` holds `pendingDeleteId` and the raw `deleteError`; **no live-query emission follows**. The route stays absent for at least 4 s, with no message, although it is still stored.                                                 |
| The same, after scrolling 300 px or typing in Search while pending | the same: hidden, no message, nothing moved, focus left where the rider put it                                                                                                                                                                                      |

**Filtering while pending:** Search typed so that it hides the deleting route.

- **On an abort:** clearing the search brings back every route except the deleting one. It is still stored, and still absent from the list.
- **On a commit:** the success handler **took focus from the Search field to the Routes heading**, in both engines. The next card it aimed for was filtered out.

**Leaving Routes while pending, then returning:**

| Return                                                  | While still pending                                                                                     | After an abort                                                                                          | After a commit |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------- |
| Within about 0.6 s (Dexie's cache entry is still alive) | the route is **absent**, served from the cache with the pending removal applied, with no IndexedDB read | **still absent**: no re-run                                                                             | absent         |
| After about 3.6 s (the cache entry has been evicted)    | **Loading routes…** — a real read queued behind the hold                                                | the route appears as an **ordinary card**; the failure is lost                                          | absent         |
| After the abort, then Plan → Routes                     | —                                                                                                       | an ordinary card, from the cache entry's unmodified result, with no IndexedDB read; the failure is lost | —              |

**A route genuinely deleted elsewhere.** A second tab deleted the route while this tab's confirmation for it was open but unconfirmed. Tab 1's list dropped it after a real read, and the card's cleanup saw focus inside it (_instr_, _cand_). Focus then fell to `<body>`.

**Commit ordering with no hold.** The transaction completes. The success handler's `.then` then focuses the next card about 0.6 ms later. The card leaves the DOM 3–9 ms after that, with no intermediate ordinary-card state committed. Dexie's optimistic emission arrives within about 1 ms of the commit (_instr_), so the removal and the success state land in one React commit.

## The causal sequence

Dexie line references are to `node_modules/dexie/dist/dexie.js`, version 4.4.5. The production build loads `dexie.min.js` through `import-wrapper-prod.mjs`, which is the same code minified.

1. **Confirm.** `RouteLibrary.handleDeleteConfirm` (`RouteLibrary.tsx` ~1248) sets `isDeleting` and calls `deleteRoute` (`routesRepository.ts` ~55), which is `db.routes.delete(id)` in an implicit transaction.
2. **Dexie records a pending removal.**
   - The observability middleware marks the deleted key in the mutation's changed parts, both the primary-key part and `:dels` (~5191–5210).
   - The cache middleware, for a non-explicit `readwrite` transaction (the skip condition is ~5725–5731), pushes an optimistic operation and signals subscribers **before the request runs** (~5759–5760; `signalSubscribersLazily` ~4442).
3. **The list re-runs from cache.** `orderBy("createdAt").reverse().toArray()` is a cachable `query` (`isCachableContext` ~5136). The re-run is served from the cache entry with the pending removal applied, and the entry's observed set is replaced by the new read's (~5787). For an index query, that set lists only the primary keys actually returned (~5312), so **the deleted key is no longer in it**.
4. **The card unmounts.** `routes` lacks the route, so `viewRoutes` lacks it and the card unmounts, taking its confirmation and its "Deleting…" with it.
   - **This layer is React's:** the list is derived only from the live query.
   - **Chromium:** it had already dropped focus to `<body>` when the focused **Delete route** became disabled.
5. **Abort.** The request fails. Dexie's mutate resolves with a failure count rather than rejecting, so its failure branch removes the optimistic operation and signals again (~5761–5770). The transaction's own abort handler (~5641–5707) then finds none of its optimistic operations left, so it re-runs nothing either. That the request's error precedes the transaction's abort is from the IndexedDB specification, not measured.
6. **No re-run — the decisive step.** The signal carries the primary-key and `:dels` parts for the deleted key, and no `createdAt` part. The entry's observed set has the `createdAt` range and the surviving keys only. `obsSetsOverlap` (~4432) is false, so nothing is re-run, and the subscriber keeps the last emission without the route. The cache entry's own result is still correct, which is why a remount within 3 s shows the route again. After 3 s with no subscriber, the entry is evicted (~5622) and the next subscription reads IndexedDB.
7. **No UI either.** `RouteLibrary`'s `catch` sets `isDeleting` false and `deleteError` to `error.message` (~1265). The confirmation that would show it lives inside a card that is not rendered, because the route is not in `routes`.
8. **The immediate fault differs** because the operation is removed in a microtask, before the `setTimeout(0)` flush that would apply it. The list never changes, and the card stays with its alert. That alert is inserted between the explanation and the actions (`RouteListItem.tsx` ~932), and only the opening reveals, so the action row is pushed down. Both actions were disabled while deleting, so Chromium's focus was already on `<body>`, and nothing returns it.

**Isolating Dexie confirms steps 2–6 without React.** With fake-indexeddb and the same schema and query:

| Case                                       | While held                                                 | After release                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| implicit delete, commit                    | emitted without the route within 2 ms of the call, no read | no further emission (already absent)                                                                |
| implicit delete, abort                     | emitted without the route                                  | **no re-emission**; the list stays wrong                                                            |
| implicit delete, immediate throw           | —                                                          | re-emitted unchanged, with the route                                                                |
| **primary-key query** (`toArray()`), abort | emitted without the route                                  | **re-emitted with the route within 2 ms of the abort** — so the overlap explanation in step 6 holds |
| explicit transaction, commit               | **no emission**                                            | a real read, then an emission without the route                                                     |
| explicit transaction, abort                | **no emission**                                            | none needed; the list was never wrong                                                               |
| `cache: 'disabled'`, commit or abort       | no emission                                                | the same as the explicit transaction                                                                |
| implicit, resubscribed during pending      | the new subscription gets the list **without** the route   | no re-emission after the abort                                                                      |
| implicit, resubscribed after the abort     | —                                                          | correct after 100 ms (cache entry) and after 3.5 s (real read)                                      |

## Confirmed, inferred and unresolved

**Confirmed by measurement in both browser engines** (the storage items also in isolation, with fake-indexeddb):

- the optimistic disappearance while pending;
- the absence of any re-run after an abort;
- the stored route still being present;
- the cache-served remount within 3 s, and the queued read after 3 s;
- the immediate fault's growth, raw text and focus loss;
- the success handler taking focus from Search to the heading after a filtered success;
- an explicit transaction removing both storage effects.

**Confirmed from source and consistent with the measurements:** the mechanism of step 6, meaning the observed set losing the deleted key, and a mutation with no `createdAt` part.

**Inferred, not measured:**

- that the same non-restoration follows any real failure mode other than an aborted transaction;
- that iOS WebKit behaves like desktop WebKit here.

**Unresolved:**

- whether this is a defect Dexie upstream would accept, as no upstream issue was searched for or filed;
- how often a deletion is pending long enough on an iPhone for any of this to be seen. An ordinary deletion here took about 15–20 ms from press to commit.

## What a storage-only change fixes, and what it exposes

The _cand_ build changed only `deleteRoute`. Under a hold, in both engines:

- **Pending:** the route stays, its confirmation shows **Cancel** and **Deleting…** disabled, and there is no optimistic emission.
- **Abort:** the route stays, the confirmation shows the alert, and the actions are enabled again. The raw text now differs by engine: Chromium reads "The transaction was aborted, so the request cannot be fulfilled.", and WebKit "The operation was aborted.".
- **Commit:** a real read, then the route leaves the list.

It also exposes five UI defects that the vanishing card used to hide. None of them is a storage defect:

1. **Between commit and the list's update, the deleted route shows as an ordinary card.** `.then` clears the deletion state 7–26 ms before the live list re-emits.
   - Over 20 runs (ordinary and held, 5 each per engine), the deleted route was committed to the DOM as an ordinary card with every action enabled **in 20 of 20**, for 5–21 ms.
   - That card was **painted in 10 of 20**.
   - It is not usable by hand in that window, but it is a wrong state on screen.
2. **The page jumps.** Today's `.focus()` on the next card runs while the expanded card is still laid out, so the browser scrolls to it. The page moved **246 px (Chromium) and 297 px (WebKit) in 18 of 20 runs**, including the ordinary unheld flow.
3. **Conflicting actions become reachable on the deleting card**, whose name, **Rename**, **Add tags**, **Export** and **Delete** stay enabled (only the pin is disabled):
   - tapping the name opened the route's pre-ride screen while the deletion was pending, and after the commit that screen remained, offering **Start riding** for a route no longer stored;
   - **Rename** replaced "Deleting…" with a rename form, which the commit then removed.
4. **Leaving Routes loses the operation.**
   - A return within 3 s showed the deleting route as an **ordinary, fully enabled card** while the deletion was still pending.
   - An abort while away left that ordinary card and no failure.
   - A return after 3 s showed **Loading routes…** until the outcome.
5. **Focus.**
   - After a failure, focus stays on `<body>`, or on the card when its text was tapped.
   - After a failure while Search hid the route, clearing the search **remounted the card and took focus from Search to Cancel**, moving the page 180 px in Chromium and 930 px in WebKit.
   - A filtered success still **took focus from Search to the heading**.

**A live-query failure after the commit**, using the synthetic read fault: no emission follows. Today's handling then leaves the deleted route as an ordinary, enabled card indefinitely, and the whole list stays stale for every other change too. Dexie's `liveQuery` stays subscribed after an error (`closed` is never set in its error branch, ~6356–6366), so a later successful re-run would correct it; that recovery is from source and was not measured.

## Recommended implementation

Each part addresses a measured cause. File references are to `439e578`.

### 1. Storage: no optimistic removal

`deleteRoute` performs `db.routes.delete(id)` inside `db.transaction("rw", db.routes, …)`.

- **Why it works.** Dexie skips optimistic operations for explicit transactions (~5727). On commit, it deletes the overlapping cache entries and re-runs them (~5651–5665). The returned promise resolves only after the commit and rejects on an abort.
- **Precedent.** `applyRouteTagLifecycle` already writes routes this way.
- **Scope.** `deleteRoute` is the only deletion of routes. Updates and puts should need no change, because their row stays in the query's observed set, so a failure is re-run. That is from source, not measured.
- **The comment** names the Dexie behaviour and the regression test that guards it.

### 2. Owner: the confirmed deletion lives in `App`

**Who owns what.**

- **`App`** owns the confirmed deletion: one record, `{ attempt, routeId, phase: "deleting" | "committed" | "failed" }`, which survives leaving Routes. This follows the precedent of `routeSwitchPrompt` (`App.tsx` ~1380), which is App-owned and handed to `RouteLibrary`.
- **`RouteLibrary`** keeps the **unconfirmed** confirmation local, as it is today: leaving Routes still closes it, and D-03's dismissal is unchanged.
- **A small pure module, `src/ui/library/routeDeletion.ts`**, holds the record's transitions, each guarded by attempt number, so App stays thin and every transition is unit-tested.

**The lifecycle:**

- **Start.** Confirming starts an attempt in `App`, which calls `deleteRoute`. `logError("route-delete", error)` always runs in `App`, mounted or not.
- **Commit.** The phase becomes `committed`.
- **Failure.** The phase becomes `failed`.
- **Cleared:**
  - on reconciliation (section 3);
  - by Cancel on a failed confirmation;
  - by a new Delete on any card, which also covers a retry;
  - by opening **Manage tags**, as today;
  - by a switch prompt appearing, as today, but only for `failed`, **never** for `deleting` or `committed`;
  - when the loaded live list genuinely lacks a `failed` record's route, deleted elsewhere.
- **Memory only.** A reload starts empty, and storage is then the truth.

**Returning to Routes** renders the record on its card:

- `deleting` and `committed` show the confirmation with **Cancel** and **Deleting…** disabled;
- `failed` shows the translated message with **Cancel** and **Delete route** enabled;
- neither ever takes focus or reveals on that mount (section 4).

This removes the round trip's ordinary, actionable card, and keeps a failure beside its route.

**Busy for the rest of the list** is `deleting` or `committed`. That keeps today's behaviour:

- every pin disabled;
- a second Delete refused;
- **Manage tags** refused, with its existing hint.

The pin-focus effect keyed on `isDeleting` (~578) keys on that derived value instead.

### 3. Reconciliation: keep the existing state until the list agrees

**`committed` keeps showing "Deleting…".** The record clears only when the **loaded** live list no longer contains the route. `RouteLibrary` reports this to `App` with the attempt number, and the card leaves in that same commit. This alone removes defects 1 and 2: there is no intermediate ordinary card, and no focus move while the expanded card is still laid out.

**No second list.** No extra filtered set is added over `routes`, groups or tag suggestions.

**A tombstone was considered and is not recommended.** It means filtering committed ids out of `routes` at `.then`.

- **What it would gain:** removing the card about 10 ms earlier, and hiding the deleted route if the live query fails.
- **Why it isn't needed:** the measured gap closes without it.
- **The failure case is not specific to deletion:** the whole list is then stale for every change.
- **The recommended state fails safe:** a card stuck on a disabled "Deleting…" allows no action on a route that no longer exists. Today's stale card offers every action.
- **Recovery:** Dexie's `liveQuery` stays subscribed after an error, so a later successful re-run reconciles it.

**A live-query failure is recorded as a general limitation outside D-02**, not handled here.

### 4. Focus and reveal

**Pending.** Confirming parks focus on the confirmation's own title, with `preventScroll`, before both actions are disabled. The title is a `tabIndex={-1}` heading reached through a ref, as `ConfirmDialog`'s `titleRef` is in D-01 and D-06. While pending, focus therefore stays inside the card unless the rider moves it, and a refused Escape stays inside the dialog. One `armOperationInteractionGuard` (`src/ui/shared/operationInteractionGuard.ts`) is armed per confirmed attempt, over the whole card, by the `RouteLibrary` that confirmed it.

**Failure.** A layout effect in `RouteLibrary` with no dependencies decides once for its own attempt, following D-01's pattern (`PlanningScreen.tsx` ~1809). It finds the elements through a per-route ref map of Cancel, the confirmation and its action row.

- **Still waiting** means the guard is still armed **and** `document.activeElement` is inside the card: the parked title, the card itself after a tap on its text, or the disabled actions.
  - Cancel is then focused with `preventScroll`.
  - Then `applyConfirmationReveal(confirmation, headerBottom, actionRow)` brings the confirmation in by the minimum, or only its action row when it cannot fit.
  - Cancel is the safe target beside a destructive retry, and it matches the opening focus.
- **Otherwise nothing happens.** The message stays in the confirmation as an alert, and the confirmation's `aria-describedby` names it. No announcement is claimed.
- **`<body>` never counts as waiting.** A tap on blank space leaves focus on `<body>` deliberately and also disarms the guard.
- **Nothing to decide about:**
  - if the card is not mounted, because a filter hides it, the guard is detached and the decision is "not waiting";
  - if the `RouteLibrary` that armed the guard has unmounted, its guard went with it.

**Success: focus repair only, and a separate behaviour change.** When the card leaves, its own layout-effect cleanup reports whether focus was inside it.

- **Measured feasible.** The cleanup runs while the card is still connected, and it saw focus inside a removed, focused card in both engines (`focusInside: true`).
- **Not focus events.** Chromium then fired `focusout` and WebKit fired nothing, so focus events are not a reliable signal.

`RouteLibrary` then distinguishes three cases:

| At removal                                                                                         | Action                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focus was inside the removed card: the parked title, or the card after a text tap                  | Focus is lost because of the removal. Move it, with `preventScroll`, to the neighbouring card's name, chosen from the last list that contained the route, or else to tag-save's fallback order: Clear tag filters, the filter disclosure, Search, the heading. Reveal the new target by the minimum **only if the guard is still armed**. A rider who scrolled away while focus stayed on the title keeps their scroll position. |
| The rider deliberately moved focus: Search, another control, or a blank-space tap leaving `<body>` | Leave focus where it is.                                                                                                                                                                                                                                                                                                                                                                                                         |
| The rider scrolled away with focus still inside the card                                           | The first row applies: focus is repaired without moving the page.                                                                                                                                                                                                                                                                                                                                                                |

**This changes today's behaviour**, which focuses the next card unconditionally with the browser's own scroll, and is listed as its own behaviour change.

- **What it corrects:** focus taken from Search to the heading after a filtered success, which was measured.
- **What it removes:** the page jump of defect 2.

**Remount.** A card mounting in `deleting`, `committed` or `failed` takes no focus and scrolls nothing, after a filter returns it or the rider returns to Routes. Only a genuine opening of an unconfirmed confirmation runs slice 1's opening focus and reveal. That opening behaviour, including D-03's quiet dismissal and staying closed, is unchanged.

### 5. Conflicting actions

While a card's own deletion is `deleting` or `committed`, its handlers refuse the name's open, **Rename**, **Add tags** / **Edit tags**, **Export** and the **Delete** trigger. Each control is also disabled, and the pin is already disabled. This is a guard inside each handler, not only styling, because these became reachable once the card stays visible, as the conflicting-action runs showed. Other cards behave as today.

### 6. Message

Every failure shows `t("routes.error.delete")`: "That route could not be deleted." / "Diese Route konnte nicht gelöscht werden.". Both keys exist. The technical text goes only to `logError`, which feeds Status's redacted log. `RouteLibrary.tsx` ~1265's `error.message` path is removed.

### Files, cleanup and guard behaviour

**Source:**

- `src/storage/routesRepository.ts`;
- `src/ui/library/routeDeletion.ts` (new, pure);
- `src/App.tsx`, the owner;
- `src/ui/library/RouteLibrary.tsx`;
- `src/ui/library/RouteListItem.tsx`;
- `src/ui/shared/operationInteractionGuard.ts`, whose doc comment gains a third caller.

**Version:** `0.4.57`. **No i18n, schema or dependency change.**

**Cleanup:**

- **The guard** is detached when its decision is made, when its attempt ends or is superseded, and when `RouteLibrary` unmounts.
- **App's handlers** compare the attempt number before changing the record, so a late result never touches a newer attempt.
- **The cleanup's focus report** is consumed once per removal.

**Not changed:**

- slice 1's opening and cancellation;
- D-03's dismissal of an unconfirmed Delete;
- item 95's route-switch prompt;
- tag editors and the tag manager;
- D-01 and D-06.

## Alternatives considered

- **`new Dexie(name, { cache: "disabled" })`.** It removes the same storage effects (Node cases 7 and 8), but it changes the timing of every live query in the app: Settings, Planning's key, Status, the language provider. That is far wider than D-02 needs.
- **Listing routes by primary key and sorting in JavaScript.** It restores the route after an abort (Node case 9), but still hides it while pending.
- **A UI snapshot overlay plus a forced resubscribe.** Two sources of truth, and the forced read depends on Dexie's 3-second eviction.
- **Keeping the deletion in `RouteLibrary` and accepting the loss on navigation.** Rejected on the round-trip evidence: an ordinary, actionable card while pending, and a lost failure.
- **A module-level store instead of `App`.** It is workable, but adds a global singleton. App already owns cross-screen Routes state, so it is the conventional owner here.
- **A tombstone for committed deletions.** Not supported by the evidence (section 3).

## Decision for the rider

**A failure that lands while the rider's own search or tag filter hides the route.** It is reachable only when a deletion is pending long enough to type a filter. The record keeps the failure, and the route is never brought back against the filter. The choice is what the rider sees meanwhile:

- **(a) Recommended:** nothing until the route is shown again. It then appears with its failed confirmation and message, without taking focus.
- **(b) The alternative:** a one-line message at the list, naming the route and saying it could not be deleted. It would take no focus and move nothing.

Everything else above follows from the approved policy and the measurements, and needs no decision.

**Decided, reported 3 October 2026: option (a).** The route stays hidden according to the rider's filter, the failure stays with that route's confirmation, and when the route becomes visible again its message and recovery actions are shown without taking focus or scrolling. No list-level message or notification is added. This is implementation approval, not device acceptance; it shipped in `0.4.57`.

## Test plan

**Unit: real Dexie on fake-indexeddb, which reproduces the mechanism (Node cases 1–14).**

- **`routesRepository`:** with a raw `readwrite` hold on the same database, while held the list subscription keeps the route. An abort keeps it and rejects; a commit removes it.
- **Its negative control,** an implicit delete, must fail all three.

**Transitions.** `routeDeletion.ts`: every transition and every attempt guard.

**Component:** `App`, `RouteLibrary` and `RouteListItem`.

- **Holds at the IndexedDB level, not mocks.** Today's tests mock `deleteRoute` (`RouteLibrary.test.tsx` ~950, ~1086, ~1125, ~1158, ~1510). The ~1086 hold even waits _before_ the real delete, so those tests pass on the defective build.
- **What they cover:**
  - the translated message and no raw text;
  - the title park, and Escape refused;
  - the refused card actions;
  - the remount taking no focus;
  - an unmount mid-attempt still logging;
  - the record surviving a `RouteLibrary` remount;
  - the switch prompt never clearing a running deletion;
  - reconciliation;
  - retry starting a new guard.
- **jsdom limits.** jsdom does not blur a disabled focused element. Its focus after removal is checked before any assertion relies on it.

**Browser: a new `e2e/routeDeleteFailure.smoke.spec.ts`**, in Chromium and WebKit, at 390×844, in English and German, at ordinary and 200% text where layout matters. Real input, with `[behaviour]` and `[implementation]` assertions as in D-01. Cases:

- **Failures:**
  - an immediate failure: the message, the minimal reveal at both sizes, Cancel focused and Escape working;
  - a delayed failure while waiting;
  - a delayed failure after moving on: a wheel scroll, typing in Search, a tap on blank space, and a tap on the confirmation's text (Cancel gets focus).
- **Success:**
  - a held success: "Deleting…" until the commit;
  - no ordinary-card DOM commit or painted frame between commit and removal, measured with the probe's recorders;
  - no page jump;
  - each focus-repair case in the table above.
- **Retry, and filtering while pending,** both committed and aborted, with no focus taken when the route returns.
- **Navigation:**
  - a return within and after 3 s, then a commit or an abort;
  - "Deleting…" on return, the failure on return, no focus and no conflicting actions.
- **Refused actions,** each reached with `dispatchEvent("click")`, since Playwright refuses disabled targets.
- **Another tab** deleting the route while it is deleting or has failed.
- **The read fault after a commit:** the card stays a disabled "Deleting…", with no crash. This is a characterisation test.

**Regression specs:**

- `routeDeleteFiltering.smoke`, whose comment saying a Dexie write cannot be held in a browser is corrected;
- `confirmationReveal.smoke`;
- `confirmationRevealSettled`;
- `confirmationDialogs.smoke`;
- the Routes pinning and tag specs.

**Baseline.** The new spec runs against the unchanged build, and failures are reported by kind.

**Negative controls**, each applied alone and restored byte-for-byte:

- the implicit delete;
- the record kept in `RouteLibrary`, so navigation loses it;
- the record cleared at `.then`, with no reconciliation;
- focus repair keyed on `<body>` instead of the card's removal report;
- the guard always armed;
- the reveal removed;
- `error.message` restored;
- the title park removed;
- focus taken on remount;
- the handler guards removed.

## Installed-iPhone checks

**Ordinary flow only, in English and German:**

- open **Delete** on a route in the middle of the list, then **Cancel**: the route is unchanged;
- confirm **Delete route**: the route leaves the list, the page does not jump, and focus or position is sensible;
- delete a second route the same way: no stale message or "Deleting…" remains;
- D-03 unchanged: an unconfirmed Delete closes quietly when Search hides its route.

A pending deletion, a failure, navigation while pending and a hidden failure cannot be produced on the phone. They keep synthetic, automated evidence and are **not** to be induced there.

## Limitations

- **Synthetic only.** Holds, aborts, immediate faults and the read fault are synthetic. Nothing is established about real failure modes, how often they occur, or how long a deletion stays pending on an iPhone. No physical-device reproduction of D-02 exists.
- **Desktop engines in a container are not iOS Safari.** Browser text scaling is not iOS Larger Text. No VoiceOver, physical-keyboard, landscape or physical-Android result is claimed.
- **Lifecycle cases were measured in English at ordinary text.** The immediate failure covered both languages and both text sizes.
- **The _instr_ and _cand_ builds carry temporary hooks.** The visible outcome of _instr_ — route list, target card, focus, message and stored routes at every recorded step — matched _base_ in all 38 paired runs.
- **Measured, not guaranteed.** The cleanup report's timing is React 19.2.8's commit order, measured, not a documented React guarantee, so the implementation's own tests must hold it. Dexie line numbers are for 4.4.5 and will move with an upgrade, which the regression test is there to catch.
- **Out of scope:**
  - a live-query failure leaving the whole Routes list stale. This is general, and not addressed by D-02;
  - a route deleted in another tab while its confirmation has focus, which leaves focus on `<body>`. This is pre-existing, and unchanged here.
