# Item 124 — review preparation for D-01, D-02 and D-06 (2 October 2026)

This record was moved here unchanged from the [reveal inventory](README.md) on 4 October 2026, for size only: the inventory had reached 149,117 characters, against the 150,000-character limit the project keeps each document below, and slice 9's acceptance was about to add to it. **It is the same record, not a second one.** Its text, measurements and dated notes are exactly as they were; the only edit is one link to the inventory's decisions section, which now names `README.md`. Where the text below says "above" or "the earlier sections", it means the inventory's own sections, against `04639cb`. The inventory keeps a pointer under this section's original heading, so every earlier link to it, or to its D-02, D-01 and D-06 measurements and its list of decisions, still resolves.

## Review preparation — D-01, D-02 and D-06 (2 October 2026)

**Status: prepared for the rider's review; nothing is approved.** This section rechecks three failure and busy states against current source and measures them with controlled fixtures, with C-12 as context. Every recommendation below is a proposal. The earlier sections and their measurements, made against `04639cb`, are unchanged.

### Method

- **Build and environment:**
  - a build of `5db2522` (application code `64bde8d`, `0.4.53`), served by `vite preview`;
  - the same pinned container as above, with desktop Chromium and WebKit at 390×844 portrait;
  - English and German, at ordinary text and at 200% root text; browser root-text scaling is not iOS Larger Text;
  - the local map style, openrouteservice mocked, a fixed synthetic position, and service workers blocked.
- **Input:** real pointer clicks at measured centres inside the usable band, real wheel input, and real Escape key presses.
- **The probe:** a temporary script in the session scratchpad, not committed. It was copied from this inventory's own probe, which was left unchanged.
- **Controlled fixtures. All of them are synthetic.**
  - _Immediate failure:_ `IDBObjectStore.prototype.delete`, or `put`, throws for the named store, so the write fails as it is issued.
  - _Hold:_ the probe runs its own readwrite transaction on the store, kept alive by chained reads, so the app's write queues behind it. It is bounded by a 30-second deadline and always released in a `finally`. The probe never reads a held store while the hold lasts. Values come from:
    - a snapshot taken before the hold;
    - the hold's own first read;
    - a read after release.
  - _Delayed failure:_ a hold whose release first aborts the app's queued transaction. The write therefore fails after the rider has done something else.
- **What these fixtures show** is what the interface does once a write is pending or fails. They do not show that such failures happen on a device, which message a real engine would give, or how long a real write takes.
- **Runs:** 80 recorded runs:
  - nine cases in all four language and text combinations, in both engines;
  - four further cases in English at ordinary text, in both engines.

  Sixteen earlier runs of the held deletion were discarded. They followed the original confirmation node, which the list removes while the deletion is pending; that removal is itself finding D-02.3 below.

### Source recheck at `64bde8d`

- **D-01 (`PlanningScreen.tsx` ~1759–1788, ~1853–1936, ~2397–2431).** In substance, the code still does what is recorded above.
  - A rejected `clearDraft()` closes the confirmation, shows the alert beside the remounted Clear draft, and focuses that button with a plain `.focus()` once it is enabled. There is no `preventScroll`, no reveal, and no check of where focus has gone in the meantime.
  - The line references above (~1552–1556, ~1705–1713) are out of date.
  - `PlanningScreen.clearDraft.test.tsx` (~463) pins the message, the focus and the retry.
- **D-02 (`RouteLibrary.tsx` ~1248–1268, `RouteListItem.tsx` ~917–959).** Also unchanged in substance.
  - The alert is inserted between the explanation and the actions, with no reveal. Both actions are disabled while deleting, and focus is not restored.
  - The message is `error.message` for any `Error`, now at ~1265 rather than ~1234. `RouteLibrary.test.tsx` (~948, ~1158) pins the raw text.
  - The alert is not part of the confirmation's `aria-describedby`.
  - Since slice 3, a failed confirmed deletion is deliberately never dismissed by filtering.
- **D-06 (`RidingScreen.tsx` ~798–805, ~1026–1091, ~1783–1810).** See the dated correction under D-06 above.
  - The re-entrancy ref and the disabled, relabelled Edit copy exist.
  - `ConfirmDialog` receives neither `confirmDisabled` nor `cancelDisabled`, and `handleEditCopyCancel` has no in-flight guard.
  - The failure path calls `.focus()` on Edit copy synchronously, while that button is still disabled.
  - On success, `performEditCopy` calls `onNavigateToPlanning`, which is App's unconditional `setScreen("planning")` (`App.tsx` ~1164).
  - No test covers C-12's buttons while a write is pending, Cancel during the write, or focus after a failure.

### D-02 — Delete route fails

**1. An immediate failure**, with Delete placed 16 px above the band's bottom. The opening is slice 1's reveal.

| Measure                   | Ordinary text                                                                                                                                           | 200% text                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Opening                   | the minimum: 184 px in English; 205 px (Chromium) and 212 px (WebKit) in German                                                                         | the action row only: 636 px in English; 724 and 736 px in German                              |
| The confirmation grows by | 37 px                                                                                                                                                   | 164 px                                                                                        |
| The action row afterwards | 816–860 px: 24 px below the band's 836 px bottom                                                                                                        | 835–975 px: entirely below the band                                                           |
| Page movement             | none                                                                                                                                                    | none                                                                                          |
| Message shown             | the raw `error.message` ("probe fault UnknownError: probe fault"), not "That route could not be deleted." / "Diese Route konnte nicht gelöscht werden." | the same                                                                                      |
| Focus                     | Chromium: `<body>`; WebKit: still on Delete route                                                                                                       | the same                                                                                      |
| Escape afterwards         | Chromium: **nothing happens**, because the confirmation handles Escape only while focus is inside it. WebKit: it closes and focus returns to Delete     | the same; in German, WebKit's close moved the page 82 px, which is slice 1's reveal of Delete |

The same in both engines unless stated.

**2. A failure while pending, after the rider scrolls 300 px.** Measured in both languages and at both text sizes.

**3. A failure while pending, after the rider moves focus to Search routes.** Also measured in both languages and at both text sizes.

- **While the deletion is pending, the route's card and its confirmation leave the list.** This happened in all 16 runs: within 600 ms of pressing Delete route, the list went from eight cards to seven, so "Deleting…" is never seen. [S] Dexie 4.4.5's `liveQuery` cache applies pending writes optimistically; its cache middleware keeps `optimisticOps`.
- **After the failure, the route stays hidden, and no error is shown.** In all 16 runs:
  - no card, confirmation or message returned within 10 seconds, although the route was still stored;
  - nothing moved, and focus stayed where the rider had left it.

  In English at ordinary text, in both engines, the route was still hidden three seconds later. It reappeared only after leaving Routes and returning (Plan, then Routes) or after a reload, and then without its confirmation or any message.

- **Why Dexie's cache did not restore the route when the transaction aborted was not established.**
- **With this fixture, a failed deletion that is still pending looks exactly like a successful one** until the rider leaves Routes.

**Recommendation — candidate for change, in two separable parts:**

- **(a) The confirmation after a failure.**
  - Show the localised "That route could not be deleted." The technical text is already recorded by `logError` for Status's redacted log.
  - Keep the action row in view once the message appears, by slice 1's minimal reveal, and only while the rider has not moved on.
  - Return focus into the confirmation, so that Retry and Escape work.
  - _Trade-offs:_ the localised message carries less detail, though the rider cannot act on Dexie's text in any case, and two unit tests pin the raw text. A reveal after a failure moves the page without the rider asking, which is why it is guarded.
- **(b) The pending and delayed-failure presentation.**
  - Keep the route, and its "Deleting…" confirmation, until the deletion has committed, or re-read the list on failure.
  - This touches how the list reads storage, so it needs its own investigation and design before any decision about implementation.
  - _Trade-off:_ a deletion would look slower. It would also be truthful about whether it happened.

### D-01 — Clear draft fails

**1. An immediate failure**, with Clear draft placed 16 px above the band's bottom:

- **In all eight runs:**
  - the confirmation closes;
  - the message and Clear draft end inside the band;
  - focus is on Clear draft;
  - the app makes no scroll call.
- **At ordinary text in both languages, and at 200% in English:** no movement.
- **At 200% in German:** the confirmation, 930 px tall and taller than the band, collapses. The browser then moved the page 476 px in both engines when the plain `.focus()` reached the remounted button, which had been left above the band. The button ended near the band's middle, which is more than the minimum.

**2. Pending.** Both actions are disabled ("Clearing…" / "Wird verworfen…"), and focus is on `<body>` in both engines.

**3. A delayed failure after the rider scrolls 300 px further down:**

- **At ordinary text:** no movement, and focus goes to Clear draft, which is in view.
- **At 200%:** the browser moved the page back 561 px in English and 776 px in German, and focus went to Clear draft.

**4. A delayed failure after the rider scrolls to the save area and puts focus in Route name** (nothing typed):

- **In all eight runs, focus was taken from the Route name field back to Clear draft.**
- **Chromium** scrolled the page back to the button: 717 and 759 px at ordinary text (English and German), and 2,358 and 4,282 px at 200%.
- **WebKit** moved only 117–732 px, and **left the focused Clear draft and its message outside the band**.

**The failure focus is unconditional.** Unlike slice 1's Cancel correction, which is dropped once focus has moved, it ignores where the rider has gone.

**Recommendation — candidate for change:**

- Guard the failure focus as the Cancel path is guarded: apply it only while focus is still where the confirmation left it.
- When it is applied, focus with `preventScroll` and reveal the button and its message by the minimum.
- When it is not applied, the message is still announced, because it is `role="alert"` [S]. Whether it should also be revealed is the open policy question slice 1 left.
- _Trade-off:_ a keyboard rider who has moved on loses the direct way back to Clear draft. In exchange, the rider's place is never taken away.

### D-06 — Edit copy, with C-12 as context

**C-12's opening, from the lowest reachable position.** The paused panel starts at the page's top, so Edit copy cannot sit lower than it does at scrollY 0.

| Measure                    | English, ordinary     | German, ordinary                   | English, 200%                                                                                                                   | German, 200%                                                    |
| -------------------------- | --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Edit copy at the top; band | 377–421 px; 75–836 px | 377–421 px; 75–836 px              | 631–693 px; 91–836 px                                                                                                           | 618–680 px; 122–836 px                                          |
| Confirmation height        | 197 px                | 270 px (Chromium), 274 px (WebKit) | 710 px                                                                                                                          | 842 and 849 px, taller than the band                            |
| Opening                    | no movement; complete | no movement; complete              | the browser's focus scroll moved 879 px, and the app made no scroll call. It fits the band, but its top 245 px is left above it | the browser moved 954 and 961 px; the action row is in the band |

At ordinary text, the browser evidence agrees with the rider's iPhone 13 report. At 200% text, C-12 has no reveal of its own: native `autoFocus` centres Cancel, and in English that hides the confirmation's title even though the whole confirmation would fit.

**1. The confirmation's buttons while the write is pending** (held; all eight runs, both engines):

- **Replace and edit** and **Cancel** stay enabled and keep their labels.
- **Edit copy** is disabled and reads "Creating editable copy…" / "Kopie zum Bearbeiten wird erstellt…".
- **A second Replace and edit issued no second write** (the write count stayed at 1), and the confirmation stayed open: the existing ref guard holds.

**2. Cancelling during the write:**

- **Cancel and Escape.** Cancel by pointer (all eight runs) and Escape (English at ordinary text, both engines) close the confirmation and leave focus on `<body>`. **The write then completes, the Planning draft is replaced, and the app switches to Planning.** The Cancel did not cancel.
- **At 200%,** the confirmation's collapse moved the page 742–881 px; the app made no scroll call.
- **Leaving Ride for Routes during the write** (English at ordinary text, both engines): once the write completed, the app switched from Routes to Planning, and focus stayed on the Routes tab.

**3. Focus after a failure:**

- **With the confirmation.** Measured with an immediate fault in all eight runs, and with a failure while pending in English at ordinary text in both engines.
  - Focus is on `<body>` in every run, in both engines, and still 500 ms later.
  - The message and Edit copy are in the band, and Edit copy is enabled again.
- **Without a draft, so with no confirmation** (eight runs):
  - Chromium: `<body>`.
  - WebKit: focus stays on Edit copy, which is enabled again.
  - At 200% in German, the message runs below the band.

**Recommendation — candidate for change, separate from the reveal rule:**

- **A busy state, as C-01 and C-05 have:** both actions disabled while the write runs, with Replace and edit reading "Creating editable copy…", and Escape guarded.
- **Cancel during the write cannot simply undo it,** because by the time the rider cancels, the earlier draft may already be replaced. The consistent option is to refuse Cancel while writing, as the busy state above does. Staying on Ride after a cancelled but completed write would leave the draft replaced while the rider believes nothing happened, so it is not recommended.
- **Not switching to Planning if the rider has left Ride** is a separate choice: the draft would still be replaced, and the rider would find it in Plan.
- **After a failure,** return focus to Edit copy once it is enabled again, as Clear draft's failure path does, and only while focus has not moved elsewhere.
- **C-12 at 200% text:** whether C-12 adopts the common rule for enlarged text is checklist item 8. Its ordinary opening stays as it is, as the device report supports.

### Decisions needed from the rider

1. **D-02, the message:** show "That route could not be deleted." / "Diese Route konnte nicht gelöscht werden." instead of the technical text, with the technical text kept only in the redacted diagnostics log?
2. **D-02, after an immediate failure:** keep the action row in view and return focus into the confirmation?
3. **D-02, a pending deletion:** should the route stay visible, with "Deleting…", until the deletion has committed, so that a failure can be shown, accepting that deleting looks slower? Or should another approach be investigated first?
4. **D-01:** may a Clear draft failure take focus back from wherever the rider has moved it? If not, guard it like Cancel. When focus is restored, should the button and its message be revealed by the minimum, instead of by the browser's own focus scroll?
5. **D-06, the buttons:** disable both actions while the write runs, as C-01 and C-05 do?
6. **D-06, cancelling:** refuse Cancel and Escape while the write runs, which is consistent with C-01 and C-05? Or allow them, knowing the draft is still replaced?
7. **D-06, leaving Ride during the write:** should completion still switch to Planning?
8. **D-06, after a failure:** return focus to Edit copy once it is enabled again, unless the rider has moved on?
9. **C-12 at 200% text:** adopt the common rule's minimal reveal for enlarged text, or keep the browser's own focus scroll? Ordinary text stays unchanged.

**Decided, 2 October 2026:** all nine questions are answered in [Decisions — D-06, D-02, D-01 and C-12](README.md#decisions--d-06-d-02-d-01-and-c-12-2-october-2026).

### Limitations

- Desktop Chromium and WebKit in a container are not iOS Safari. Their focus behaviour already differs here: after a failure, Chromium moves focus off a disabled button and WebKit does not. Browser root-text scaling is not iOS Larger Text.
- All faults, holds and aborts are synthetic. The hold also keeps the page's own thread busy with IndexedDB reads while it lasts.
- **Escape was measured with the browser's keyboard. There is no physical-device keyboard result**, and no VoiceOver, landscape or physical-Android result.
- D-02's hidden route was measured with an aborted transaction only. Whether other real failure modes leave the list in the same state was not established.
