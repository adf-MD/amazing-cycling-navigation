# Item 124, slice 2 — reveal inventory and review

**Status (1 October 2026): completed inventory, awaiting the rider's review.** Slice 2 changes no application behaviour. Slice 1 (Clear draft and Delete route) is approved, shipped in `0.4.51` and accepted on the installed iPhone; this inventory itself is authorised. **No additional surfaces are approved for behaviour changes**: only a later slice may extend the common rule, and only to the surfaces the rider confirms in the [checklist](#manual-review-checklist) below.

**Update (1 October 2026): two cases decided.** The rider approved [C-14](#c-14--switch-to-another-ride-page-level-dialog) and [D-03](#d-03--a-route-card-remounts-while-its-delete-is-pending) for change, and both shipped as item 124's slice 3 in `0.4.52` ([Decisions and delivery](#decisions-and-delivery)). Every other case still awaits the rider's review, and no other surface is approved for behaviour changes. The measurements below are kept as made against `04639cb`, before that change.

**Update (2 October 2026): D-01, D-02 and D-06 prepared for review.** These three cases were rechecked against `64bde8d` (`0.4.53`). They were measured with controlled synthetic fixtures: storage writes that fail at once, writes held pending, and writes that fail after the rider has scrolled or moved focus. Each was measured in English and German, at ordinary and 200% text, in desktop Chromium and WebKit, with C-12 as context. The rider also checked C-12 on an iPhone 13. The results, recommendations and the decisions they need are in [Review preparation](#review-preparation--d-01-d-02-and-d-06-2-october-2026). **Nothing further is approved**: every case except C-14 and D-03 still awaits the rider's review. The earlier measurements are kept as they were made.

**Update (2 October 2026, later): D-06, D-02, D-01 and C-12 decided.** The rider approved policies for these four cases, recorded in [Decisions — D-06, D-02, D-01 and C-12](#decisions--d-06-d-02-d-01-and-c-12-2-october-2026). They are product decisions authorising later work, **not device acceptance**, and nothing about them is implemented yet. D-06's repair is first in the execution order; D-01, D-02 and C-12's opening-reveal change follow item 132. Every other case still awaits the rider's review.

**Update (2 October 2026): D-06 delivered.** D-06's repair shipped in `0.4.54` as item 124's slice 4 ([record](../../project/history/item-124.md#item-124)); its ordinary flow was accepted on the installed iPhone in German and English, reported 2 October 2026 ([`current-status.md`](../../project/current-status.md)), and its pending-write and failure cases have automated evidence only. D-01, D-02 and C-12's opening-reveal change are not yet implemented.

**Update (3 October 2026): D-01 delivered.** D-01's repair shipped in `0.4.56` as item 124's slice 5 ([record](../../project/history/item-124.md#item-124)). A failed Clear draft now returns focus, and reveals the button and its message by the minimum, only while the rider is still waiting; once they have moved on, their focus and position are kept and the message stays in the Clear draft area. Its failure, delayed-completion and retry behaviour have synthetic, automated evidence only; its ordinary-flow device check is pending ([`current-status.md`](../../project/current-status.md)). D-02 and C-12's opening-reveal change are not yet implemented.

**Update (3 October 2026): D-01's ordinary flow accepted; D-02 next.** D-01's ordinary Clear draft flow was accepted on the installed iPhone in English and German, reported 3 October 2026, on `0.4.56` (build `439e578`) ([`current-status.md`](../../project/current-status.md)); its failure, delayed-completion, retry and enlarged-text cases keep synthetic, automated evidence only. **D-02's investigation and planning stage is the next slice**, with no implementation; C-12's opening reveal remains approved later work.

**Update (3 October 2026, later): D-02 investigated and planned.** Its pending and failure lifecycle was investigated against `439e578`, and an implementation proposed, in a separate [D-02 report](d-02-delete-lifecycle.md). **Nothing is implemented**, and the plan awaits the rider's review and one decision.

**Update (3 October 2026, later still): D-02 decided and delivered.** The rider approved the implementation and chose option A for a failure hidden by the rider's own filter (decision 8 in [Decisions](#decisions--d-06-d-02-d-01-and-c-12-2-october-2026), reported 3 October 2026). D-02 shipped in `0.4.57` as item 124's slice 6 ([record](../../project/history/item-124.md#slice-6--delete-route-pending-and-failing-d-02-shipped-0457-3-october-2026)); its pending, failure and enlarged-text cases have synthetic, automated evidence only, and its ordinary-flow device check is pending. C-12's opening reveal remains approved later work, and every other case still awaits the rider's review.

**Update (3 October 2026, latest): D-02 accepted; C-07, C-08, C-10, C-11 and C-13 decided; C-09 reported; C-12 next.** D-02's ordinary flow was accepted on the installed iPhone in English and German, on `0.4.57` (build `bd688d7`) ([`current-status.md`](../../project/current-status.md)); its pending, failure, failure-recovery and committed-but-unreconciled cases keep automated evidence only. The rider approved the common opening and cancellation policy for C-07, C-08, C-10, C-11 and C-13, observed that a lower opening position could not be reached for them, and reported C-09's missing-route variant on the device ([Decisions and observations](#decisions-and-observations--c-07-to-c-13-3-october-2026)). **C-12's opening reveal is the next implementation slice**, slice 7. Any targeted correction under the new policy, and every case not yet reviewed, is implementation still to be selected.

**Update (3 October 2026, evening): C-12 delivered.** C-12's opening reveal shipped in `0.4.58` as item 124's slice 7 ([record](../../project/history/item-124-continued.md#slice-7--edit-copys-replacement-confirmation-opening-c-12-shipped-0458-3-october-2026)): no movement when Edit copy's replacement confirmation fits, the minimum when it can fit, and its action row first when it is taller than the band, with Cancel focused without the browser's own focus scroll; the ordinary-text opening is unchanged. Its enlarged-text, oversized and reappearing-confirmation cases have automated evidence only, and its ordinary-flow device check is pending ([`current-status.md`](../../project/current-status.md)). Nothing else is selected for implementation.

**Update (3 October 2026, evening, later): C-12 accepted.** C-12's ordinary flows passed on the installed iPhone in English and German, on `0.4.58` (build `7e46daf`): the confirmation fully visible without unwanted movement from the pre-ride, paused and cold-start paused screens, Cancel and reopening keeping the draft, and Replace and edit opening the route's copy in Plan ([`current-status.md`](../../project/current-status.md)). Its enlarged-text, oversized and reappearing-confirmation cases, pending writes and failures keep automated evidence only.

**Update (3 October 2026, review): the ride confirmations and the remaining inventory reviewed — documentation only.** C-07, C-08, C-10, C-11 and C-13 were measured against the approved common policy at `7e46daf`, in Chromium and WebKit, English and German, ordinary and 200% text; every remaining entry was reconciled. C-10 and C-13 match; C-07 and C-08 match at ordinary text, with a 25 px overshoot at 200%; C-11 mismatches, and a correction is proposed. The findings, the proposed slice and a compact list of the decisions still needed are in the [review](ride-confirmations-review.md). **Nothing is selected, accepted or excluded by it**, and the sections below keep their original measurements.

**Update (3 October 2026, evening): four decisions; C-11 delivered.** The rider decided C-11 (correct it), C-07 and C-08 (unchanged, the 25 px at 200% a bounded exception), C-09 (its accepted flow preserved) and approved a separate slice dismissing unconfirmed ride-screen prompts on a successful Start, Resume or Pause ([decisions](../../project/history/item-124-continued.md#decisions-recorded-on-3-october-2026-evening)). C-11's correction shipped in `0.4.59` as item 124's slice 8, with automated evidence only; its device check is pending. The other dispositions stay proposals.

**Update (3 October 2026, later): C-11 accepted.** Its ordinary flows passed on the installed iPhone in English and German, the scrolled cancellation included, on `0.4.59` (build `bc4fb11`) ([`current-status.md`](../../project/current-status.md)). Its enlarged-text, oversized and held-Pause cases keep automated evidence only.

**Update (3 October 2026, later still): ride transitions.** Decision 4 shipped in `0.4.60` as item 124's slice 9: an unconfirmed C-10, C-11 or C-12 confirmation closes quietly when Start riding, Resume ride or Pause succeeds, and does not reappear ([record](../../project/history/item-124-continued.md#slice-9--confirmations-closed-by-a-ride-transition-c-10-c-11-c-12-shipped-0460-3-october-2026)). Automated evidence only; its device check is pending.

**Update (4 October 2026): slice 9 accepted.** Its ordinary flows passed on the installed iPhone in English and German, on `0.4.60` (build `e2ba7cf`) ([`current-status.md`](../../project/current-status.md)). A held or failed Pause, a confirmed operation still running and an immediate location error keep automated evidence only. For size, the 2 October review preparation of D-01, D-02 and D-06 moved, unchanged, to a [separate file](d-01-d-02-d-06-review-preparation.md); its heading below points there.

**Update (4 October 2026, later): every entry reconciled, and P-18 measured — documentation only.** The [reconciliation](closure-reconciliation.md) gives each ID one disposition, keeping approved and proposed retentions apart. P-18 shows a demonstrated problem: a warning selected on the map leaves its details below the screen. A correction is proposed as slice 10, not approved. Other concerns go to items 127, 103 and 134–138. Item 124 is not closed. The sections below keep their original text.

**Update (4 October 2026, evening): the rider's decisions.** P-18's correction is approved as slice 10; the other proposed retentions are approved except P-01, which an installed-iPhone observation the same day left unresolved; P-15 is to be measured with a mocked provider ([decisions](../../project/history/item-124-continued.md#decisions-recorded-on-4-october-2026)). These are decisions, not device acceptance; the reconciliation's tables carry them, and the sections below keep their original text.

**Update (4 October 2026, later): slice 10 shipped, and the close-out investigations.** P-18's correction shipped in `0.4.61`, its installed-iPhone check pending. P-01, P-15, a failed End ride's message and the launcher's confirmation after a re-read were then investigated, documentation only; each disposition awaits the rider ([reconciliation](closure-reconciliation.md#close-out-investigations-4-october-2026)). Item 124 is not closed.

**Update (4 October 2026, after slice 10's acceptance): the rider's dispositions.** P-18's ordinary flows were accepted on the installed iPhone on build `ae76f98`, its optional Reduced Motion step excepted. P-01 is deferred to item 135, with its desktop action-row clipping as a separate finding; P-15's bounded correction is approved as slice 11; a failed End ride's message is filed as item 139 and the stale launcher confirmation as item 140 ([decisions](../../project/history/item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice); [summary](closure-reconciliation.md#dispositions-after-slice-10s-acceptance-4-october-2026)). Item 124 is not closed: slice 11 and its device acceptance remain.

**Update (4 October 2026, closure): slice 11 accepted; item 124 closed.** P-15's result reveal shipped in `0.4.62` as slice 11 ([record](../../project/history/item-124-continued.md#slice-11--the-routing-connection-result-revealed-p-15-shipped-0462-4-october-2026)), and its ordinary flows were accepted on the installed iPhone in English and German on build `a71ca2f` ([`current-status-archive.md`](../../project/current-status-archive.md#installed-iphone-acceptance-of-0462-build-a71ca2f-item-124-slice-11-p-15-reported-4-october-2026)). **Item 124 was closed on 4 October 2026 with explicit deferrals** ([closure](../../project/history/item-124.md#closure-4-october-2026); [final dispositions](closure-reconciliation.md#closure-4-october-2026)): P-01 and, as a separate finding, its desktop action-row clipping → item 135; P-17 → item 127; D-05, P-24 and the focus parts of P-07, P-15, P-18, P-21 and P-29 → item 135; P-21 and P-26's cue → item 136; P-06 → item 137; copy and comments → item 138; Resume during a finishing End ride → item 134; a failed End ride's message → item 139; the stale launcher confirmation → item 140; C-14's styling → item 103; D-02's unreconciled list and P-33 → opportunistic monitoring. None of them is fixed or accepted by the closure. The sections below keep their original text.

**What this is.** Every confirmation in the app, every expanding card, form, editor and disclosure that could reasonably fall under the rider's "pop-up cards" request, and the conditional and failure states that change what would need revealing — each with a stable review ID, its labels in English and German, how to reach it, what it does today, where that is in the source and tests, what was measured, and a recommendation.

**The rule under review** ([item 124](../../project/history/item-124.md#item-124)): no movement when the newly opened content fits between the sticky navigation and the bottom safe area; otherwise only enough to reveal it; and when it cannot fit, only enough to show its complete action row. On Cancel and Escape: keep the page where the rider has left it, moving only as far as needed to reveal the opening control.

## Contents

- [How to read this](#how-to-read-this)
- [The mechanisms that exist today](#the-mechanisms-that-exist-today)
- [Protected behaviour](#protected-behaviour)
- [Confirmations, C-01 to C-14](#confirmations-c-01-to-c-14)
- [Expanding cards, forms, editors and disclosures, P-01 to P-35](#expanding-cards-forms-editors-and-disclosures-p-01-to-p-35)
- [Conditional and failure states, D-01 to D-07](#conditional-and-failure-states-d-01-to-d-07)
- [Measured results](#measured-results)
- [Other findings outside item 124](#other-findings-outside-item-124)
- [Recommendations at a glance](#recommendations-at-a-glance)
- [Manual review checklist](#manual-review-checklist)
- [Reproduction gaps](#reproduction-gaps)
- [Method and reproducing](#method-and-reproducing)
- [Limitations](#limitations)
- [Decisions and delivery](#decisions-and-delivery)
- [Review preparation — D-01, D-02 and D-06 (2 October 2026, a separate file since 4 October 2026)](d-01-d-02-d-06-review-preparation.md)
- [Decisions — D-06, D-02, D-01 and C-12 (2 October 2026)](#decisions--d-06-d-02-d-01-and-c-12-2-october-2026)
- [Decisions and observations — C-07 to C-13 (3 October 2026)](#decisions-and-observations--c-07-to-c-13-3-october-2026)
- [D-02 — investigation and plan (3 October 2026, a separate file)](d-02-delete-lifecycle.md)
- [The ride confirmations and the remaining inventory — review (3 October 2026, a separate file)](ride-confirmations-review.md)
- [Closing the inventory — reconciliation and P-18 (4 October 2026, a separate file)](closure-reconciliation.md)

## How to read this

**IDs are stable** and are the ones used in the measurement probe, the findings and the checklist: **C-** confirmations, **P-** expanding surfaces, **D-** conditional and failure states. A later discovery is appended with the next number; none is ever reused.

**Every statement carries its evidence:**

- **[S] source** — read from the source at `04639cb`; file and approximate line given.
- **[M] measured** — measured in a real browser, in the pinned Playwright container, on the `04639cb` build, at 390×844 portrait, ordinary text, English, in Chromium and WebKit, on 1 October 2026. See [Measured results](#measured-results).
- **[D] device report** — what the rider has reported from the installed iPhone, with its ledger reference.
- **[U] unverified assumption** — believed from reading, not confirmed by any of the above.

**Interaction.** Measurements open visible controls with real pointer input at their on-screen position, or with the keyboard, and position the page with real wheel input — never through Playwright's automatic scroll-into-view. A synthetic step is labelled as such. Fixed riding controls are measured where they actually are.

**Recommendations** are one of: **already complies**, **candidate for change**, **preserve existing behaviour**, or **needs discussion**. None is approved.

**Usable band.** From the bottom of the sticky chrome (the navigation, plus Settings' switcher or Riding's immersive header where present) plus 8 px, to the bottom of the visual viewport less the safe-area inset and 8 px — the same band slice 1 measures against.

## The mechanisms that exist today

| Mechanism                                                                     | Where                                               | Behaviour                                                                                       | Used by                                           |
| ----------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `applyConfirmationReveal`, with the action row                                | `src/ui/shared/confirmationRevealScroll.ts`         | minimal instant scroll into the band; oversized content only as far as completes its action row | C-01, C-05 (item 124 slice 1)                     |
| `applyConfirmationReveal`, without the action row, after native `autoFocus`   | the same                                            | the browser's own focus scroll first, then the residual; oversized content bottom-anchored      | C-06 (item 118)                                   |
| `isCardAlreadyFullyVisible` + `scrollIntoView({ block: "end" })`              | `RouteListItem.tsx`, `routeSwitchCardVisibility.ts` | instant, whole card, in a layout effect, once per actionable message                            | C-02 (item 95)                                    |
| settle-gated `scrollIntoView({ block: "end" })`, smooth unless reduced motion | `RouteLibrary.tsx` ~1117–1154                       | waits for the viewport to settle, then animates                                                 | C-03, C-04 (item 106)                             |
| `runWhenViewportSettled` + `applyTopRevealScroll`                             | `routeCardTopReveal.ts`, `viewportSettle.ts`        | top-prioritising, smooth unless reduced motion, after settling                                  | P-02 closing, P-04 after success (items 105, 106) |
| `scrollIntoView({ block: "nearest" })`, smooth unless reduced motion          | `RouteSummaryPanel.tsx` ~130–147                    | for a warning tapped on the map; not header-aware                                               | P-18                                              |
| plain `autoFocus` on Cancel                                                   | `ConfirmDialog.tsx`, the hand-written prompts       | only the browser's own focus scroll                                                             | C-02 to C-04 (hand-written), C-06 to C-14         |
| none                                                                          | —                                                   | —                                                                                               | every other surface                               |

Only Routes, Settings and Planning receive the sticky header's ref (`App.tsx` ~1220, ~1265, ~1277). During active riding the global header is replaced by the immersive one, and the Profile pane scrolls inside itself (`index.css` ~2936–2944).

**Update, 3 October 2026 (`7e46daf`).** This table and the note above describe `04639cb`. Since then C-14's Planning path (slice 3) and C-12 (slice 7) use `applyConfirmationReveal` with the action row and focus Cancel with `preventScroll`, so they have left the plain-`autoFocus` row; D-01 and D-02's failures reveal by the minimum; and Riding also receives the sticky header's ref (since `041da6c`). The five ride confirmations' current mechanisms are in the [review](ride-confirmations-review.md#the-five-surfaces-in-the-source-at-7e46daf).

## Protected behaviour

A common rule must not silently alter any of these accepted behaviours. Changing one needs the rider's explicit decision, recorded against its own item.

- **Item 95, the inline route-switch prompt (C-02):** an instant, pre-paint, whole-card reveal, never repeated for busy text; the action hierarchy (End and switch, Return to paused ride, Cancel); and the interaction-safety invariant that its actions must not move once they can be touched. Accepted on the installed iPhone on 12 September 2026 ([ledger](../../project/current-status.md)).
- **Item 118, Settings' Delete key (C-06):** contained in the OpenRouteService card, native `autoFocus` followed by the residual correction, bottom-anchoring when oversized, no busy state, and its disarming rules. Complete and accepted (13 and 14 September 2026).
- **The tag editor and manager flows of items 100, 105 and 106 (P-02, P-03, P-04, C-03, C-04):** the card focus park and top reveal on closing, the manager's post-success reveal, the settled confirmation reveal, the collapsed-on-every-mount filter chooser, and their one-at-a-time rules. Accepted on 10 September 2026.
- **Item 124 slice 1 (C-01, C-05):** accepted on the installed iPhone, reported 1 October 2026.
- **Item 97's untrusted-GPX notice (P-30):** never a fresh live region or alert, and its timer never shortened.
- **Item 128's Planning messages (P-19):** in normal flow below the map by design (C6), so the map never moves; accepted 1 October 2026.
- **Item 119's dialog semantics:** every confirmation a named, described, non-modal `role="dialog"` with per-instance ids. Nothing here proposes modality or focus traps.

## Confirmations, C-01 to C-14

Labels are quoted from `src/i18n/messages.en.ts` and `messages.de.ts`. All confirmations put Cancel before Confirm, and all handle Escape only while focus is inside them.

_Correction, 3 October 2026: C-02 is an exception — it orders its actions End and switch, Return to paused ride, then Cancel ([review](ride-confirmations-review.md#previously-noted-defects-and-concerns-awaiting-a-later-decision))._

### Routes

#### C-01 — Delete route (route card)

- **Labels:** **Delete** / **Löschen** opens "Delete “{name}”?" / "„{name}“ löschen?" — "This route will be permanently deleted from this device. This cannot be undone." / "Diese Route wird dauerhaft von diesem Gerät gelöscht. Das lässt sich nicht rückgängig machen." — **Cancel** / **Abbrechen**, **Delete route** / **Route löschen** (busy: "Deleting…" / "Wird gelöscht…").
- **Reproduce:** Routes, at least one saved route; tap **Delete** on its card.
- **Kind and purpose:** confirmation before permanently deleting a saved route.
- **Opening [S]:** inline in the card after its action row; Delete stays mounted. Cancel focused with `preventScroll`, then `applyConfirmationReveal` with the action row (`RouteListItem.tsx` ~491–532).
- **Cancel / Escape [S]:** focus back to Delete without scrolling, before Cancel is destroyed; after the collapse commits, the minimal correction only while Delete still has focus (~566–574).
- **Conditional states:** Deleting… with both actions disabled; a failure alert inside the confirmation ([D-02](#d-02--delete-route-fails)); remounting while pending ([D-03](#d-03--a-route-card-remounts-while-its-delete-is-pending)); activation off-screen ([D-04](#d-04--activating-clear-draft-or-delete-while-the-button-is-above-the-viewport)).
- **Tests:** `RouteListItem.test.tsx` (item 124 block, item 119 case), `RouteLibrary.test.tsx` "deleting a route"; e2e `confirmationReveal.smoke.spec.ts`, `confirmationRevealSettled.spec.ts`, `confirmationDialogs.smoke.spec.ts`.
- **Evidence:** [M] row C-01; [D] accepted, reported 1 October 2026.
- **Recommendation:** **already complies** — protected (slice 1).

#### C-02 — Switch to another route (inline, item 95)

- **Labels:** tapping a route's **name** while another ride is unfinished opens "Switch to “{name}”?" / "Zu „{name}“ wechseln?". Message (paused route resolved): '"{existing}" is paused. Return to it, or end it and switch to {target}. Ending it will clear ride progress; the saved route will remain in Routes.' / "„{existing}“ ist pausiert. Kehre zu dieser Fahrt zurück oder beende sie und wechsle zu {target}. …". Actions **End and switch** / **Beenden und wechseln**, **Return to paused ride** / **Zur pausierten Fahrt zurück**, **Cancel** / **Abbrechen**.
- **Variants** (same card): paused route resolved (three actions); route unresolvable or free roam unfinished (End and switch, Cancel); busy (Ending… / Opening your paused ride…); clear failed; return failed with **Check again** / **Erneut prüfen**; unsupported stored session (**Discard and continue**) and check failed (**Retry**) — see [Reproduction gaps](#reproduction-gaps).
- **Reproduce:** start a route ride, get a fix and pause it (or leave free roam paused); in Routes, tap another route's name.
- **Kind and purpose:** confirmation guarding a second ride session.
- **Opening [S]:** inside the card after its actions; plain `autoFocus` on Cancel; layout effect: if the card is not already fully visible, `scrollIntoView({ block: "end", behavior: "auto" })` of the whole card (~404–480). Re-runs for a new actionable message, never for busy text.
- **Cancel / Escape [S]:** App's `handlePendingSwitchCancel` (`App.tsx` ~968–978): plain synchronous `.focus()` on the captured trigger (normally the route name), no scroll correction.
- **Tests:** `rideSessionSwitchGuard.spec.ts` (geometry, recorder, throttled, landscape, 200% text), `RouteListItem.test.tsx` switch-prompt blocks, `App.test.tsx`.
- **Evidence:** [M] row C-02; [D] item 95's `0.4.33` correction accepted 12 September 2026.
- **Recommendation:** **preserve existing behaviour** (protected). Its whole-card reveal is not item 124's minimal confirmation reveal, and its Cancel relies on native focus scrolling; aligning either needs the rider's explicit decision.

#### C-03 — Merge tags (tag manager)

- **Labels:** in **Manage tags** / **Tags verwalten**, choose a tag, type an existing tag's name in **New name** / **Neuer Name**, then **Merge tags** / **Tags zusammenführen** opens "Merge “{source}” into “{target}”?" / "„{source}“ durch „{target}“ ersetzen?" — "“{target}” already exists, so this merges the two tags on {count} routes. “{source}” will no longer exist. No route is deleted." — **Cancel** / **Abbrechen**, **Merge tags**.
- **Reproduce:** routes carrying at least two distinct tags; Routes → Manage tags; select one tag; type the other's name; Merge tags.
- **Kind and purpose:** confirmation before merging two tags everywhere they are used.
- **Opening [S]:** at the bottom of the manager panel; its triggers are disabled while it is open. Cancel focused with `preventScroll`; after `runWhenViewportSettled`, if not fully visible, `scrollIntoView({ block: "end" })`, **smooth unless reduced motion** (`RouteLibrary.tsx` ~1117–1154). The only confirmation reveal that animates and waits.
- **Cancel / Escape [S]:** focus handed to the Rename/Merge button through a layout effect, plain `.focus()`; no deliberate scroll.
- **Conditional states:** Applying… (all disabled); failure closes it with an alert above.
- **Tests:** `RouteTagManager.test.tsx`, `RouteLibrary.tagManagement.test.tsx` (item 106 reveal block); e2e `routeLibraryTagManagement.spec.ts` (no e2e of the confirmation's own scroll).
- **Evidence:** [M] row C-03, including the WebKit note under the table.
- **Recommendation:** **preserve existing behaviour** (protected, items 100, 105 and 106). Its smooth, settled reveal is the opposite of item 95's interaction-safety invariant; whether that matters is for the rider — **needs discussion** only if a uniform motion rule is wanted.

#### C-04 — Delete tag (tag manager)

- **Labels:** **Delete tag** / **Tag löschen** opens "Delete the tag “{tag}”?" / "Den Tag „{tag}“ löschen?" — "“{tag}” will be removed from {count} routes. The routes themselves are not deleted and stay in your library." — **Cancel**, **Delete tag**.
- **Reproduce:** routes with tags; Routes → Manage tags; select a tag; Delete tag.
- **Kind, opening, cancel:** as C-03; focus returns to Delete tag; deleting the last tag moves focus to Search and closes the manager.
- **Evidence:** [M] row C-04.
- **Recommendation:** **preserve existing behaviour**, as C-03.

### Planning

#### C-05 — Clear draft

- **Labels:** **Clear draft** / **Entwurf verwerfen** opens "Clear this draft?" / "Diesen Entwurf verwerfen?" — "This removes all waypoints, the calculated route and other unsaved draft details. Saved routes are not affected." / "Damit werden alle Wegpunkte, die berechnete Route und alle weiteren ungespeicherten Daten dieses Entwurfs gelöscht. Gespeicherte Routen bleiben unverändert." — **Cancel** / **Abbrechen**, **Clear draft** (busy: "Clearing…" / "Wird verworfen…").
- **Reproduce:** Plan; tap **Clear draft** in the first action card, below the routing summary.
- **Kind and purpose:** confirmation before wiping the whole Planning draft.
- **Opening [S]:** replaces the button in place; focus parked on the routing `<summary>` if the button had it; Cancel focused with `preventScroll`; `applyConfirmationReveal` with the action row (`PlanningScreen.tsx` ~1596–1616).
- **Cancel / Escape [S]:** park, then in the close commit the minimal correction of the remounted button (once), then focus with `preventScroll`; dropped if focus has moved (~1547–1627).
- **Conditional states:** Clearing…; failure ([D-01](#d-01--clear-draft-fails)); off-screen activation ([D-04](#d-04--activating-clear-draft-or-delete-while-the-button-is-above-the-viewport)).
- **Tests:** `PlanningScreen.clearDraft.test.tsx`, `ConfirmDialog.test.tsx`; e2e `clearPlanningDraft.spec.ts`, `confirmationReveal.smoke.spec.ts`, `confirmationRevealSettled.spec.ts`.
- **Evidence:** [M] row C-05; [D] accepted, reported 1 October 2026.
- **Recommendation:** **already complies** — protected (slice 1).

### Settings

#### C-06 — Delete OpenRouteService key

- **Labels:** **Delete key** / **Schlüssel löschen** opens "Delete OpenRouteService key" / "OpenRouteService-Schlüssel löschen" — "This removes your saved key from this device. Route planning will be unavailable until you enter a key again. Any routes you have already saved remain fully usable without it." — **Cancel** / **Abbrechen**, **Delete** / **Löschen**.
- **Reproduce:** Settings, with a key saved; **Delete key** in the OpenRouteService card.
- **Kind and purpose:** confirmation before removing the stored routing key.
- **Opening [S]:** inside the card below Replace key / Delete key; plain `autoFocus` (the browser's focus scroll first), then `applyConfirmationReveal` without the action row (`SettingsScreen.tsx` ~316–327).
- **Cancel / Escape [S]:** disarm, then plain synchronous `.focus()` on Delete key; no correction.
- **Conditional states:** no busy state; disarmed if the key changes elsewhere, on Replace key, or on switching to Status; a failed delete is only logged.
- **Tests:** `SettingsScreen.test.tsx` (delete-confirmation reveal), `SettingsSection.test.tsx`; e2e `settings.spec.ts`, `androidMobileLayout.spec.ts`, `settingsStatusSwitcher.spec.ts`.
- **Evidence:** [M] row C-06; [D] item 118 complete, accepted 13 and 14 September 2026.
- **Recommendation:** **preserve existing behaviour** (protected). It reaches the same visible outcome as slice 1 by a different route (native focus scroll first, bottom-anchored when oversized); aligning the mechanism is **needs discussion**, not implied.

### Ride launcher

#### C-07 — End ride (unfinished route, launcher)

- **Labels:** the Ride tab shows the route, "You have an unfinished ride on this route." / "Du hast auf dieser Route eine unbeendete Fahrt.", **Resume ride** / **Fahrt fortsetzen** and **End ride** / **Fahrt beenden**, which opens "End this ride?" / "Diese Fahrt beenden?" — "Navigation progress for this ride will be cleared. The saved route will remain in your library." / "Der Navigationsfortschritt dieser Fahrt wird verworfen. Die gespeicherte Route bleibt in deiner Routenbibliothek." — **Cancel**, **End ride** (busy: "Ending ride…").
- **Reproduce:** start a route ride and pause it; then reload the app, or press **Back to Ride options**; open the Ride tab.
- **Kind and purpose:** confirmation before clearing an unfinished route session.
- **Opening [S]:** replaces the button in its row (`RidingLauncher.tsx` ~310–352); plain `autoFocus`; no reveal.
- **Cancel / Escape [S]:** a passive effect later focuses the remounted button with plain `.focus()` (~279–298).
- **Conditional states:** Ending…; failure alert ("The ride could not be ended on this device. Try again.").
- **Tests:** `RidingLauncher.test.tsx`; e2e `ridingLauncher.spec.ts`.
- **Evidence:** [M] row C-07.
- **Recommendation:** **already complies** as measured — it opens where it is, complete, with no movement, and focus returns to the button. [U] Not measured at 200% text or in German, where the launcher is taller.
- **Decided, 3 October 2026:** the common opening and cancellation policy, keeping its placement and ride semantics, with targeted corrections only where measurements demonstrate a mismatch; the rider could not reach a lower opening position on the installed iPhone. Nothing is implemented, and no correction is selected yet ([decisions and observations](#decisions-and-observations--c-07-to-c-13-3-october-2026)).
- **Reviewed, 3 October 2026:** matches at ordinary text; at 200% the browser's focus scroll overshoots the minimum by 25 px, stopped by the page's end, the confirmation ending complete; cancellation matches. Recommended unchanged ([review](ride-confirmations-review.md#verdicts)). Since item 132, a reload's first **Ride** entry shows the paused route screen, so the launcher is reached with **Back to Ride options**.
- **Decided, 3 October 2026, evening:** unchanged; the 25 px at 200% is accepted as a bounded exception to strict minimum scrolling, not exact compliance ([decision 2](../../project/history/item-124-continued.md#decisions-recorded-on-3-october-2026-evening)).

#### C-08 — End ride (unfinished free roam, launcher)

- **Labels:** "Free roam" / "Freies Fahren" panel with **Resume free roam** / **Freies Fahren fortsetzen** and **End ride**, opening "End this ride?" — "Your saved position and map view for Free roam will be cleared." / "Die letzte Position und Kartenansicht dieser Fahrt werden verworfen."
- **Reproduce:** Ride → **Start free roam** / **Freies Fahren starten** → **Pause** (returns to the launcher).
- **Kind, opening, cancel:** as C-07; failure "Free roam could not be ended on this device. Try again."
- **Tests:** `RidingLauncher.test.tsx`; e2e `freeRoam.spec.ts`.
- **Evidence:** [M] row C-08.
- **Recommendation:** **already complies** as measured; same caveat as C-07.
- **Decided, 3 October 2026:** the common opening and cancellation policy, keeping its placement and ride semantics, with targeted corrections only where measurements demonstrate a mismatch; the rider could not reach a lower opening position on the installed iPhone. Nothing is implemented, and no correction is selected yet ([decisions and observations](#decisions-and-observations--c-07-to-c-13-3-october-2026)).
- **Reviewed, 3 October 2026:** as C-07 — matches at ordinary text, a 25 px overshoot at 200%. Recommended unchanged ([review](ride-confirmations-review.md#verdicts)).
- **Decided, 3 October 2026, evening:** as C-07 ([decision 2](../../project/history/item-124-continued.md#decisions-recorded-on-3-october-2026-evening)).

#### C-09 — Discard unfinished ride (launcher)

- **Labels:** "This unfinished ride refers to a route that's no longer in your library, so it can't be resumed." with **Discard unfinished ride** / **Unbeendete Fahrt verwerfen**, opening "Discard unfinished ride?" / "Nicht beendete Fahrt verwerfen?" — "Only the stored progress for this unfinished ride will be removed — no saved route is affected." — **Cancel**, **Discard unfinished ride** (busy: "Discarding…").
- **Reproduce:** start and pause a route ride; reach the launcher (reload or **Back to Ride options**); delete that route in Routes; open Ride. (The unsupported-session variant is a [reproduction gap](#reproduction-gaps).)
- **Kind, opening, cancel:** as C-07; failure "This unfinished ride could not be discarded on this device. Try again."
- **Tests:** `RidingLauncher.test.tsx`; e2e `ridingLauncher.spec.ts`.
- **Evidence:** [M] row C-09 (reached with a stored row naming a missing route — a synthetic shortcut to the same state).
- **Recommendation:** **already complies** as measured; same caveat as C-07.
- **[D] device report, 3 October 2026** (`0.4.57`, build `bd688d7`, English and German): the missing-route variant was readable and fitted without unwanted movement; Cancel kept the unfinished-session warning; a confirmed Discard removed it, and it stayed gone after leaving and returning; other saved routes remained; a lower opening position was not reachable. It does not cover enlarged text, the unsupported or corrupt-session variant or storage failures, and **no policy decision is recorded for C-09** ([ledger](../../project/current-status.md); [decisions and observations](#decisions-and-observations--c-07-to-c-13-3-october-2026)).
- **3 October 2026:** not measured in the review; it shares C-07's component, so the review's C-07 findings apply to it by source inference, and whether it follows C-07's policy is listed as a decision ([review](ride-confirmations-review.md#decisions-still-needed-for-the-ride-confirmations)).
- **Decided, 3 October 2026, evening:** its accepted missing-route flow is preserved; if the shared launcher code changes, the launcher policy applies and C-09 is verified then — shared source alone proves neither its geometry nor its untested variants ([decision 3](../../project/history/item-124-continued.md#decisions-recorded-on-3-october-2026-evening)).

### Route riding

#### C-10 — End ride, from the riding header

- **Labels:** the immersive header's **End ride** (shown as "End ride" / "Beenden", named "End ride" / "Fahrt beenden") opens "End this ride?" with **Cancel** and **End ride**.
- **Reproduce:** Routes → a route → **Start riding** / **Fahrt starten**; with tracking active, tap End ride in the header.
- **Kind and purpose:** confirmation before ending an active ride.
- **Opening [S]:** in its own row directly below the immersive header; the header's button stays mounted but hidden (`visibility: hidden`, `aria-hidden`, disabled) (`RidingScreen.tsx` ~1199–1248); plain `autoFocus`; no reveal — the riding shell is fixed.
- **Cancel / Escape [S]:** passive effect, plain `.focus()` on the button once it is mounted and enabled (~999–1018).
- **Tests:** `RidingScreen.finishEndRide.test.tsx`, `RidingScreen.test.tsx`; e2e `ridingFinishAndEnd.spec.ts`, `ridingImmersiveShell.spec.ts`, `germanRidingHeader.spec.ts`.
- **Evidence:** [M] row C-10 (measured where the fixed control actually is); [D] the End confirmation's header stillness was accepted in German, 28 September 2026 (item 113).
- **Recommendation:** **already complies** — it opens directly below the fixed header, and nothing moves.
- **Decided, 3 October 2026:** the common opening and cancellation policy, keeping its placement and ride semantics, with targeted corrections only where measurements demonstrate a mismatch; the rider could not reach a lower opening position on the installed iPhone. Nothing is implemented, and no correction is selected yet ([decisions and observations](#decisions-and-observations--c-07-to-c-13-3-october-2026)).
- **Reviewed, 3 October 2026:** matches in every measured configuration; at 200% the map and the Map/Profile switcher sit below the screen while it is open, a fixed-layout constraint. An open confirmation survives **Pause** as C-11, recorded separately. Recommended unchanged ([review](ride-confirmations-review.md#verdicts)).
- **Delivered, 3 October 2026, later:** an unconfirmed confirmation closes quietly when **Pause** succeeds instead of reappearing as C-11 (slice 9, `0.4.60`; [record](../../project/history/item-124-continued.md#slice-9--confirmations-closed-by-a-ride-transition-c-10-c-11-c-12-shipped-0460-3-october-2026)). Device check pending.
- **Accepted, 4 October 2026:** slice 9's ordinary flows passed on the installed iPhone in English and German, on `0.4.60` (build `e2ba7cf`), opening and cancelling the header's End ride on purpose included ([`current-status.md`](../../project/current-status.md)).

#### C-11 — End ride, from the paused panel

- **Labels:** the paused panel's **End ride** / **Fahrt beenden**, as C-10.
- **Reproduce:** start riding, get a fix, **Pause** / **Pause**; the panel shows Resume ride, Back to Ride options, Edit copy and End ride.
- **Opening [S]:** replaces the button inside its row; plain `autoFocus`; no reveal. Edit copy (C-12) can be open at the same time ([D-07](#d-07--two-confirmations-open-at-once)).
- **Cancel / Escape [S]:** as C-10.
- **Tests:** `RidingScreen.finishEndRide.test.tsx`, `RidingScreen.test.tsx`, `App.test.tsx`; no e2e targets this placement.
- **Evidence:** [M] row C-11.
- **Recommendation:** **already complies** as measured (the paused panel sits near the page's top at 390×844); [U] not measured at 200% text.
- **Decided, 3 October 2026:** the common opening and cancellation policy, keeping its placement and ride semantics, with targeted corrections only where measurements demonstrate a mismatch; the rider could not reach a lower opening position on the installed iPhone. Nothing is implemented, and no correction is selected yet ([decisions and observations](#decisions-and-observations--c-07-to-c-13-3-october-2026)).
- **Reviewed, 3 October 2026: mismatches.** At 200% the opening over-scrolls by 280 px and hides the title; after the rider scrolls it, Cancel can leave **End ride** hidden under the sticky navigation, at ordinary text too. A targeted correction is proposed, not selected ([review](ride-confirmations-review.md#proposed-next-slice--c-11-only)).
- **Decided and delivered, 3 October 2026, evening:** shipped in `0.4.59` as item 124's slice 8 ([record](../../project/history/item-124-continued.md#slice-8--end-rides-confirmation-on-the-paused-screen-c-11-shipped-0459-3-october-2026)). The opening is revealed by the minimum under the navigation, and Cancel and Escape return focus to End ride with only the movement that reveals it; at ordinary text the opening is unchanged. Automated evidence only; its device check is pending.
- **Accepted, 3 October 2026:** the ordinary flows passed on the installed iPhone in English and German, the scrolled cancellation included, on `0.4.59` (build `bc4fb11`) ([`current-status.md`](../../project/current-status.md)). The enlarged-text, oversized and held-Pause cases keep automated evidence only.
- **Delivered, 3 October 2026, later:** an unconfirmed confirmation closes quietly when **Resume ride** succeeds instead of reappearing as C-10 (slice 9, `0.4.60`; [record](../../project/history/item-124-continued.md#slice-9--confirmations-closed-by-a-ride-transition-c-10-c-11-c-12-shipped-0460-3-october-2026)). Device check pending.
- **Accepted, 4 October 2026:** slice 9's ordinary flows passed on the installed iPhone in English and German, on `0.4.60` (build `e2ba7cf`), the cold-start paused screen included ([`current-status.md`](../../project/current-status.md)).

#### C-12 — Edit copy: replace your current draft?

- **Labels:** **Edit copy** / **Kopie bearbeiten** opens, only when a meaningful Planning draft exists, "Replace your current draft?" / "Aktuellen Entwurf ersetzen?" — "Editing this route will replace your unsaved draft in Planning. This route itself will remain unchanged." — **Cancel**, **Replace and edit** / **Ersetzen und bearbeiten**.
- **Reproduce:** have a Planning draft with at least one waypoint; open a route's pre-ride or paused panel; tap **Edit copy**.
- **Opening [S]:** inline after the Edit copy button, which stays mounted; plain `autoFocus`; no reveal (`RidingScreen.tsx` ~1772–1782).
- **Cancel / Escape [S]:** plain synchronous `.focus()` on Edit copy (~1082–1085); no in-flight guard ([D-06](#d-06--edit-copy-has-no-busy-guard-and-focuses-a-disabled-button-after-failure)).
- **Tests:** `RidingScreen.test.tsx` "Edit copy"; e2e `editRouteAsPlanningCopy.spec.ts`.
- **Evidence:** [M] row C-12.
- **Recommendation:** **already complies** for its reveal as measured; [D-06](#d-06--edit-copy-has-no-busy-guard-and-focuses-a-disabled-button-after-failure) is a separate **candidate for change**.
- **[D] device report, 2 October 2026** (the rider's iPhone 13, English and German; no build stated):
  - the replacement confirmation opened without moving the page and fitted on screen;
  - **Edit copy** sat high enough that no opening could be arranged where it would not fit by scrolling further up ([ledger](../../project/current-status.md)).

  This supports keeping the ordinary opening unchanged. It does not establish untested layouts, and it approves nothing for D-06. Desktop-browser context at 200% text and in German is in the [review preparation](#review-preparation--d-01-d-02-and-d-06-2-october-2026).

- **Decided, 2 October 2026:** when implemented, C-12's opening follows the common rule — no movement when it fits, the minimum when it can fit after scrolling, its action row first when it is taller than the usable space — and the ordinary-text opening the rider checked is preserved. Not yet implemented ([decisions](#decisions--d-06-d-02-d-01-and-c-12-2-october-2026)).
- **Delivered, 3 October 2026:** shipped in `0.4.58` as item 124's slice 7 ([record](../../project/history/item-124-continued.md#slice-7--edit-copys-replacement-confirmation-opening-c-12-shipped-0458-3-october-2026)). Re-measured first: at 390×844 it fits with no movement at ordinary text in both languages; at 200% the unchanged build's focus scroll moved 879–1,049 px where the rule warrants 599 px (English) and 781–788 px (German, oversized). The confirmation that reappears on Pause after surviving Start riding (D-06's separately recorded finding, not fixed) is revealed only once the sticky navigation has returned. Automated evidence only; its ordinary-flow device check is pending.
- **Accepted, 3 October 2026:** the ordinary flows passed on the installed iPhone in English and German, on `0.4.58` (build `7e46daf`) ([`current-status.md`](../../project/current-status.md)). The enlarged-text, oversized and reappearing-confirmation cases, pending writes and failures keep automated evidence only.
- **Delivered, 3 October 2026, later:** an unconfirmed confirmation closes quietly when **Start riding** or **Resume ride** succeeds and no longer reappears on **Pause**; one whose write is running is kept (slice 9, `0.4.60`; [record](../../project/history/item-124-continued.md#slice-9--confirmations-closed-by-a-ride-transition-c-10-c-11-c-12-shipped-0460-3-october-2026)). Device check pending.
- **Accepted, 4 October 2026:** slice 9's ordinary flows passed on the installed iPhone in English and German, on `0.4.60` (build `e2ba7cf`), the Planning draft kept; whether the transition tried was **Start riding** or **Resume ride** was not reported ([`current-status.md`](../../project/current-status.md)).

### Free roam

#### C-13 — End ride, free roam

- **Labels:** the free-roam header's **End ride** opens "End this ride?" — "Your saved position and map view for Free roam will be cleared." — **Cancel**, **End ride**.
- **Reproduce:** Ride → **Start free roam**; tap End ride in the header.
- **Opening and cancel [S]:** as C-10 (`FreeRoamScreen.tsx` ~316–420).
- **Tests:** `FreeRoamScreen.endRide.test.tsx`; e2e `freeRoam.spec.ts`, `germanRidingHeader.spec.ts`.
- **Evidence:** [M] row C-13 (measured where the fixed control actually is).
- **Recommendation:** **already complies**, as C-10.
- **Decided, 3 October 2026:** the common opening and cancellation policy, keeping its placement and ride semantics, with targeted corrections only where measurements demonstrate a mismatch; the rider could not reach a lower opening position on the installed iPhone. Nothing is implemented, and no correction is selected yet ([decisions and observations](#decisions-and-observations--c-07-to-c-13-3-october-2026)).
- **Reviewed, 3 October 2026:** matches in every measured configuration; an open confirmation is discarded on **Pause**. Recommended unchanged ([review](ride-confirmations-review.md#verdicts)).

### App-wide

#### C-14 — Switch to another ride (page-level dialog)

- **Labels:** "Switch to {target}?" / "Zu {target} wechseln?" — for example "You have an unfinished ride on another route. It must be ended before this can open — the saved route will remain in your library, but ride progress will be cleared." — **Cancel** / **Abbrechen**, **End and switch** / **Beenden und wechseln**. Other variants: free roam unfinished; busy ("Ending your current ride…", "Starting free roam…"); failures ("This unfinished ride could not be ended on this device. Try again.", **Try again**); **Retry**, **Discard and continue** and **Check again** — see [Reproduction gaps](#reproduction-gaps).
- **Reproduce:** (a) start a route ride and pause it; then in Plan build and calculate a route and tap **Save route** / **Route speichern**; (b) open C-02 in Routes, then leave Routes for another tab — the prompt follows as this dialog; (c) a stale launcher's Resume or Start free roam (another tab changed storage).
- **Kind and purpose:** the page-level form of the switch guard when the prompt cannot sit inside a route card.
- **Opening [S]:** rendered above `<main>`, directly after the sticky header — at the **top of the document**, whatever screen and scroll position the rider is at (`App.tsx` ~1186–1198). Plain `autoFocus`; no reveal.
- **Cancel / Escape [S]:** plain synchronous `.focus()` on the captured trigger, if still connected; no correction.
- **Tests:** `App.test.tsx` (item 119 block); e2e `rideSessionSwitchGuard.spec.ts`, `confirmationDialogs.smoke.spec.ts`.
- **Evidence:** [M] row C-14; [U] on the installed iPhone the browser's focus scroll may not reveal it (the original item 124 observation for C-01 and C-05 was "out of view"; no cause was ever established).
- **Recommendation:** **candidate for change.** Opened from Planning's Save route, it appears at the page's top and only the browser's own focus scroll brings it into view — about 1,070 px of movement in both desktop engines — and after Escape focus is lost and the rider is left far from Save. Where it should appear (near its trigger, or at the top with a deliberate reveal) and where focus should return **needs the rider's decision**.
- **[D] device report, 1 October 2026** (build and language not stated): saving caused no automatic movement; the dialog appeared at the top of Planning and had to be found by scrolling up; Cancel removed it without moving the view, and the original ride stayed resumable ([ledger](../../project/current-status.md)).
- **Decided and delivered, 1 October 2026:** approved for change — Save only saves, and a separate **Open saved route** shows this confirmation directly beneath itself under the common rule; shipped in slice 3, `0.4.52`. Its other entry paths, (b) and (c) above, are unchanged ([Decisions and delivery](#decisions-and-delivery)).

## Expanding cards, forms, editors and disclosures, P-01 to P-35

### Routes

#### P-01 — Rename (route card)

- **Labels:** **Rename** / **Umbenennen** opens a form: **Route name** / **Routenname**, **Save** / **Speichern**, **Cancel** / **Abbrechen**.
- **Reproduce:** Routes → a route card → Rename.
- **Kind:** inline form replacing the card body; the card element stays.
- **Opening [S]:** a passive effect focuses and selects the field without `preventScroll` (`RouteListItem.tsx` ~239–247): only the browser's own focus scroll; on iOS, the keyboard.
- **Closing [S]:** Save, Cancel and Escape end editing; a passive effect focuses the remounted Rename button. The focused Cancel or field is destroyed mid-event ([D-05](#d-05--a-focused-control-destroyed-mid-event)). No error state.
- **Tests:** `RouteListItem.test.tsx` ~225–321; `RouteLibrary.test.tsx` ~622, ~668; e2e `visualFoundation.spec.ts`.
- **Evidence:** [M] rows P-01 and P-01 (Escape).
- **Recommendation:** **needs discussion** — an editor, not a confirmation; the open question is whether focus-driven scrolling is enough here and what D-05 means for it.

#### P-02 — Add tags / Edit tags (route card)

- **Labels:** **Add tags** / **Tags hinzufügen** or **Edit tags** / **Tags bearbeiten**; the editor shows **Add a tag** / **Tag hinzufügen**, "Tag suggestions" / "Tag-Vorschläge", **Save tags** / **Tags speichern**, **Cancel**.
- **Opening [S]:** focus to the tag input (native focus scroll); no reveal. **Closing [S]:** card focus park, then a settled top reveal of the card (items 105, 106).
- **Tests:** `RouteListItem.test.tsx` tag editor and reveal blocks; e2e `routeLibraryTags.spec.ts`, `androidRouteLibraryTags.spec.ts`.
- **Evidence:** [M] row P-02.
- **Recommendation:** **preserve existing behaviour** (protected).

#### P-03 — Filter by tags

- **Labels:** **Filter by tags** / **Nach Tags filtern** ▾ reveals tag chips with counts ("{count} routes would remain" / "Es würden {count} Routen übrig blieben"), **Clear tag filters** / **Tags zurücksetzen**.
- **Kind:** a disclosure built from a button with `aria-expanded`; collapsed on every mount (item 106).
- **Opening and closing [S]:** focus stays on the button; no reveal (`RouteLibrary.tsx` ~1181–1197, ~1394–1553).
- **Tests:** `RouteLibrary.tagManagement.test.tsx` ~1868–2081; e2e `routeLibraryTagFiltering.spec.ts`.
- **Evidence:** [M] row P-03.
- **Recommendation:** **preserve existing behaviour** (protected, items 100, 106, 111); any reveal for the opened chooser **needs discussion**.

#### P-04 — Manage tags

- **Labels:** **Manage tags** / **Tags verwalten** opens a panel: "Selected tag" / "Ausgewählter Tag", "New name" / "Neuer Name", **Rename tag** / **Tag umbenennen** (or **Merge tags**), **Delete tag** / **Tag löschen**, **Close** / **Schließen**.
- **Opening [S]:** focus stays on Manage tags; no reveal. **Closing [S]:** Close focuses Manage tags; after a successful action, a settled top reveal (item 105).
- **Tests:** `RouteTagManager.test.tsx`, `RouteLibrary.tagManagement.test.tsx`; e2e `routeLibraryTagManagement.spec.ts`.
- **Evidence:** [M] row P-04.
- **Recommendation:** **preserve existing behaviour** for its accepted reveals; a reveal on **opening** is a **candidate for change** only with the rider's agreement, since it is part of a protected flow.

#### P-05 and P-06 — Routes status messages

Busy refusals ("Finish saving that route's tags first, then manage tags.", "Wait for the tag update to finish, then filter by tags.") and success messages near the tag controls; import notices and errors at the top of the screen; **export failure ("That route could not be exported." / "Diese Route konnte nicht exportiert werden.") at the top of the screen, while its trigger may be in a card far below** [S]; pin failure inside the card; sort-preference saving and failure in the toolbar. **Recommendation:** not candidates for the reveal rule; the export-failure placement **needs discussion** as a separate presentation question.

### Settings and Status

#### P-07 — Replace key

- **Labels:** **Replace key** / **Schlüssel ersetzen** opens the key form: "OpenRouteService API key" / "OpenRouteService-API-Schlüssel", "Reveal" / "Anzeigen", **Save on this device** / **Auf diesem Gerät speichern**, **Cancel** / **Abbrechen**.
- **Opening [S]:** the focused Replace key button unmounts; no focus move, no `autoFocus`, no reveal — focus falls to `<body>` (`SettingsScreen.tsx` ~170–188). **Closing [S]:** Cancel and a successful save destroy the focused control with no focus restoration; no Escape handling.
- **Conditional states:** save errors (invalid header character; "The key could not be saved on this device. Try again.").
- **Tests:** `SettingsScreen.test.tsx`; e2e `settingsStatusSwitcher*.spec.ts` (no e2e opens Replace key).
- **Evidence:** [M] row P-07.
- **Recommendation:** **candidate for change** — at least focus placement on opening and closing; a reveal **needs discussion**. Item 121's sticky-switcher release while the form has focus must be preserved.

#### P-08 to P-12 — Settings disclosures

Native `<details>`: focus stays on the summary, no reveal, collapsed on every visit; opening one leaves the scroll position alone (`settingsStatusSwitcher.spec.ts` ~554).

| ID   | Summary (EN / DE)                                                                                | Card                 |
| ---- | ------------------------------------------------------------------------------------------------ | -------------------- |
| P-08 | "How recalculation works" / "So funktioniert die Neuberechnung"                                  | Route planning       |
| P-09 | "How the key and route data are used" / "Wie der Schlüssel und die Routendaten verwendet werden" | OpenRouteService     |
| P-10 | "How climbs are classified" / "Wie Anstiege eingestuft werden"                                   | Climbs and gradients |
| P-11 | "Local gradient colours" / "Farbskala für lokale Steigungen" (the tallest)                       | Climbs and gradients |
| P-12 | "Screen on" / "Display an"                                                                       | Riding               |

**Evidence:** [M] row P-11 (representative). **Recommendation:** **needs discussion** — whether opening a disclosure should ever move the page is a design question; rejected-key and offline statuses must never be hidden inside one (item 112).

#### P-13 and P-14 — Status disclosures

Under Status → "Routing diagnostics" / "Routing-Diagnose": P-13 "Why a network request can fail before an HTTP response is available"; P-14 "What HTTP statuses mean" / "Was HTTP-Statuscodes bedeuten" (item 101; tall at 200% text). Native `<details>`, as P-08. **Evidence:** [M] row P-14. **Recommendation:** **needs discussion**, as P-08.

#### P-15 — Connection-test result (Status)

**Test routing connection** / **Routing-Verbindung testen** (needs a key; sends a real request) shows a result line, a definition grid and **Copy diagnostic report** / **Diagnosebericht kopieren**. The button is disabled during the test, so focus is lost; no restoration, no reveal [S]. Not measured (the e2e suite deliberately never runs the test). **Recommendation:** **needs discussion**.

### Planning

#### P-16 — Routing options ("Change")

- **Labels:** the summary "Routing: {profile} · Ferries {ferries}" with **Change** / **Ändern**; content: "Cycling profile for this draft" / "Routenprofil für diesen Entwurf" and "Avoid ferries for this draft" / "Fähren für diesen Entwurf vermeiden".
- **Kind:** native `<details>` (`PlanningScreen.tsx` ~2114–2179). Its `<summary>` is Clear draft's focus park and must stay mounted (slice 1). Opening it pushes the Clear draft row down.
- **Evidence:** [M] row P-16. **Recommendation:** **needs discussion**, as P-08.

#### P-17 — Waypoint actions

Tapping a waypoint row (or marker) shows **Move** / **Verschieben** and **Insert after** / **Danach einfügen** in the row, and **Deselect waypoint** / **Wegpunkt abwählen** in the actions above; Move and Insert after relabel the map's placement control, which may be scrolled out of view [S]. Deselect waypoint unmounts while focused ([D-05](#d-05--a-focused-control-destroyed-mid-event)). **Evidence:** [M] row D-05 (deselect). **Recommendation:** **needs discussion** (the off-screen placement control is a separate question, related to [item 127](../../project/backlog.md#item-127)).

#### P-18 — Route warning detail

Tapping a warning row under "Route warnings" / "Warnungen" expands its detail ("Surface: {surface}" / "Belag: {surface}") and **Clear warning selection** / **Auswahl der Warnung aufheben**. From the list: no scroll. From the map: `scrollIntoView({ block: "nearest" })` of the row, smooth unless reduced motion, **not aware of the sticky header** [S] (`RouteSummaryPanel.tsx` ~130–147). Not measured (needs a calculated route with a surface warning). **Recommendation:** **candidate for change** (header-aware reveal of a map-selected warning).

**Measured, 4 October 2026:** in 22 runs the selected row stopped at the screen's bottom edge, its details below the screen, in both engines, both languages and both text sizes. A correction is proposed as slice 10, not approved ([reconciliation](closure-reconciliation.md#p-18--a-surface-warning-selected-on-plannings-map)).

#### P-19 — Messages below the map (item 128)

"Clear the selected warning to place or move a waypoint.", the route-feature equivalent, and "Your location could not be determined." / "Dein Standort konnte nicht bestimmt werden." — in normal flow below the map by design. **Recommendation:** **preserve existing behaviour** (protected, item 128).

#### P-20 — Gradient colours

Native `<details>` "Gradient colours" / "Farben nach Streckenneigung" below Planning's elevation chart. **Recommendation:** **needs discussion**, as P-08.

#### P-21 — Feature and segment details

Tapping the chart, or a climb on the map, shows "Route feature details" / "Details zum Routenabschnitt" (or the gradient segment panel) with **Clear selection** / **Auswahl aufheben**, which unmounts while focused. No reveal: a tap on the map shows the panel far below it [S]. **Recommendation:** **candidate for change** for map-originated selections; **needs discussion** otherwise.

#### P-22 — Calculate, Save and Export messages

Routing errors, the stale-route status, save and export errors. **Recommendation:** not candidates.

### Ride

#### P-23 — Ride launcher sections

Data-driven panels ("Checking for an unfinished ride…", the resumable route, free roam, unresumable). **Recommendation:** not candidates (their confirmations are C-07 to C-09).

#### P-24 — Paused panel

**Pause** / **Pause** swaps the immersive header for the paused panel ("Resume riding to continue tracking your progress.", **Resume ride**, **Back to Ride options** / **Zurück zur Auswahl**, **Edit copy**, **End ride**). The focused Pause button unmounts and focus falls to `<body>` [S]. **Evidence:** [M] row D-05 (pause). **Recommendation:** **needs discussion** (focus placement), not a reveal question.

#### P-25 — Elevation view selector and climb cards

"Elevation profile view" / "Ansicht des Höhenprofils" (Full, 2/5/10 km, Climb); Climb shows "Climb preview" or "Climb progress". The Profile pane scrolls inside itself; no reveal or focus code. **Recommendation:** not a candidate (item 80's fixed four-column grid is protected).

#### P-26 — Pre-ride climb selector

"Recognised climbs" / "Erkannte Anstiege" (native `<select>`, default "All route" / "Gesamte Route"); choosing a climb shows its details panel, which is tall. No reveal; focus stays on the select [S]. **Recommendation:** **candidate for change**, as P-21.

#### P-27 and P-28 — Climb disclosures

"Climb categories" / "Anstiegskategorien"; "Local gradient colours on this climb" / "Farben für die Steigung der einzelnen Abschnitte" and its descent counterpart. Native `<details>`. **Recommendation:** **needs discussion**, as P-08.

#### P-29 — Selected feature summary (active ride)

"Selected feature summary" / "Übersicht des gewählten Abschnitts" after tapping the chart in an active view; Clear selection unmounts it. **Recommendation:** **needs discussion**.

#### P-30 — No turn cues (item 97)

**No turn cues** / **Keine Abbiegehinweise** expands "No trusted turn information is available for this imported GPX. Follow the route line on the map." **Recommendation:** **preserve existing behaviour** (protected).

#### P-31 and P-32 — Riding status rows and overlays

Geolocation **Try again**, **Retry map imagery**, the wake-lock failure row, the climb cue's **View**, the follow-paused toast, and the route-completion panel. **Recommendation:** not candidates.

### App-wide

#### P-33 to P-35 — Update prompt, no-key notice, map imagery messages

"An update is ready." with **Update now** / **Later** (a status above `<main>`, which can appear above the visible area when the rider is scrolled down); Planning's "Road routing requires your personal OpenRouteService key." with **Open Settings**; MapView's imagery messages. **Recommendation:** not candidates; the update prompt's placement **needs discussion** as a separate question.

## Conditional and failure states, D-01 to D-07

### D-01 — Clear draft fails

- **What happens [S]:** `handleClearDraftConfirm`'s rejection path closes the confirmation, shows "The draft could not be cleared on this device. Try again." / "Der Entwurf konnte auf diesem Gerät nicht gelöscht werden. Versuche es erneut." in the button's own row, and returns focus with a plain `.focus()` once the button is re-enabled — no park and no reveal (`PlanningScreen.tsx` ~1552–1556, ~1705–1713). Slice 1 deliberately left this unchanged.
- **Reachability:** **[S] reachable in principle, not by ordinary steps.** `clearDraft()` is a single IndexedDB delete; it rejects on an open failure (Dexie then rejects every call), a quota or unknown transaction error, or a lost connection. A blocked upgrade makes it wait, not fail. No e2e induces it, and the project's position is that a rejected IndexedDB transaction cannot be injected through request routing. **[U]** a WebKit IndexedDB connection lost after iOS suspends the app is a plausible device cause; nothing in the repository shows it.
- **Evidence:** [M] row D-01, with a **synthetic** fault (`IDBObjectStore.prototype.delete` throwing for `planningDrafts`).
- **Recommendation:** **needs discussion** — the failure message's reveal policy is the open question slice 1 left.
- **Update, 2 October 2026:** rechecked and measured further, including a failure that arrives after the rider has scrolled or moved focus elsewhere: the failure takes focus back to Clear draft in every case ([review preparation](#review-preparation--d-01-d-02-and-d-06-2-october-2026)).
- **Decided, 2 October 2026:** a failure preserves the rider's activity if they have moved elsewhere, and keeps its error in the Clear draft area; if they are still waiting, focus is restored and the button and message are revealed only as far as necessary. Not yet implemented ([decisions](#decisions--d-06-d-02-d-01-and-c-12-2-october-2026)).
- **Delivered, 3 October 2026:** shipped in `0.4.56` as item 124's slice 5 ([record](../../project/history/item-124.md#item-124)). Each confirmed attempt has its own interaction guard, shared with D-06, and focus is parked on the confirmation's title while the clear runs. A failure then focuses Clear draft, without the browser's own focus scroll, and reveals the button and its message by the minimum only if the rider is still waiting; otherwise it leaves their focus and position alone. The failure cases have synthetic, automated evidence only; the ordinary flow's device check is pending ([`current-status.md`](../../project/current-status.md)).
- **Accepted, 3 October 2026:** the ordinary flow passed on the installed iPhone in English and German, on `0.4.56` (build `439e578`) ([`current-status.md`](../../project/current-status.md)). The failure cases keep automated evidence only.

### D-02 — Delete route fails

- **What happens [S]:** the confirmation stays open and grows: an alert is inserted between the explanation and the action row (`RouteListItem.tsx` ~928), pushing the actions down. Nothing reveals it again — the reveal runs only on opening — and both buttons are disabled while deleting, so focus is lost and not restored.
- **The message shown [S]:** `RouteLibrary.tsx` ~1234 shows `error.message` for any `Error`, so a real IndexedDB failure would show **Dexie's own English, technical text** rather than "That route could not be deleted." / "Diese Route konnte nicht gelöscht werden." — the unit test locks this in.
- **Reachability:** as D-01, through `db.routes.delete`.
- **Evidence:** [M] row D-02, synthetic fault.
- **Recommendation:** **candidate for change** (re-reveal or keep the actions in view after a failure, and restore focus) and, separately, the raw error text — **needs discussion**.
- **Update, 2 October 2026:** rechecked and measured in both languages at ordinary and 200% text. A failure that arrives while the deletion is pending behaves differently: the route leaves the list as soon as Delete route is pressed, and stays hidden, with no error, after the failure ([review preparation](#review-preparation--d-01-d-02-and-d-06-2-october-2026)).
- **Decided, 2 October 2026:** the ordinary translated message, a guarded minimum reveal and appropriate focus restoration, and an accurate pending, success and failure presentation, after an investigation of the storage and list mechanism. Not yet implemented ([decisions](#decisions--d-06-d-02-d-01-and-c-12-2-october-2026)).
- **Investigated and planned, 3 October 2026:** the causes are measured — Dexie's optimistic live-query cache hides the route while pending and never restores it after an aborted deletion, and the confirmation's raw message, growth and focus loss are the app's — and a repair is proposed, in the [D-02 report](d-02-delete-lifecycle.md). Not implemented.
- **Decided and delivered, 3 October 2026:** option A for a failure hidden by a filter (decision 8), and the repair shipped in `0.4.57` as item 124's slice 6 ([record](../../project/history/item-124.md#slice-6--delete-route-pending-and-failing-d-02-shipped-0457-3-october-2026)). Automated evidence only so far; its ordinary-flow device check is pending.
- **Accepted, 3 October 2026:** the ordinary flow passed on the installed iPhone in English and German, on `0.4.57` (build `bd688d7`) ([`current-status.md`](../../project/current-status.md)). The pending, failure, failure-recovery and committed-but-unreconciled cases keep automated evidence only.

### D-03 — A route card remounts while its delete is pending

- **What happens [S]:** the pending delete is kept in `RouteLibrary` and is not cleared by search, tag filters, sort or pinning another card, none of which is hidden while a card's confirmation is open. Search and tag filters can remove the card from the list, which unmounts it; when it returns it remounts with the confirmation still pending, and slice 1's opening effect runs on mount: **focus jumps to Cancel and the page may scroll**, as the former `autoFocus` already took focus.
- **Reachability: [S] reachable by ordinary steps.**
  1. Routes, at least two routes (for example "Evening Ride" and "Alpine Climb").
  2. Tap **Delete** on Evening Ride; the confirmation opens.
  3. Tap **Search routes** / **Routen durchsuchen** and type text matching only the other route; Evening Ride disappears.
  4. Delete the text (or tap **Clear search** / **Suche zurücksetzen**); Evening Ride returns with its confirmation open, and focus leaves the search field for Cancel — on the iPhone the keyboard would close.
     The same happens with **Filter by tags**: select a tag the card lacks, then deselect it.
- **Evidence:** [M] row D-03.
- **Recommendation:** **candidate for change** — not by changing the reveal, but by deciding what a pending delete should do when its card leaves the list (for example, cancel it). Needs the rider's decision.
- **[D] device report, 1 October 2026** (build and language not stated): removing the search text made the keyboard vanish and brought the confirmation into the top third of the screen; both routes remained saved after Cancel ([ledger](../../project/current-status.md)).
- **Decided and delivered, 1 October 2026:** approved — an unconfirmed Delete is dismissed when the search or a tag filter hides its route, and stays closed when it returns; a deletion already running, or a confirmed one that failed (D-02), is left alone. Shipped in slice 3, `0.4.52` ([Decisions and delivery](#decisions-and-delivery)).

### D-04 — Activating Clear draft or Delete while the button is above the viewport

- **Correction to slice 1's record.** Slice 1 recorded that a button above the viewport is "reachable by neither tap nor Tab". **That is wrong**: focus a control, scroll the page on with the wheel, a trackpad or touch until the focused button is above the viewport, then press Enter or Space — the off-screen button activates. Nothing in the app blurs focus on scroll [S], and after Cancel or Escape the app itself returns focus to that very button. A rider needs a hardware keyboard for this on the iPhone. The committed e2e comment in `confirmationReveal.smoke.spec.ts` (~716–719) repeats the old claim; it is left for a later code slice, since committed tests are out of scope here.
- **What happens:** content grows above the browser's scroll-anchoring anchor, so the browser itself moves the page; slice 1's reveal then measures the result and corrects by the minimum.
- **Evidence:** [M] rows D-04 (Clear draft) and D-04 (Delete route), real keyboard and wheel input.
- **Recommendation:** **already complies** as measured: in both engines the browser's scroll anchoring moves the page first, and slice 1's reveal then brings the confirmation, complete, to the band's top.

### D-05 — A focused control destroyed mid-event

Item 106 measured a Chromium jump from scrollY 339 to 0 when a focused Cancel was destroyed inside its own event; slice 1's negative control (d) found **no** jump for Clear draft in either engine. The surfaces where this pattern exists today: P-01 (Cancel, Escape, Save), P-07 (Replace key, Cancel), P-17 (Deselect waypoint), P-21 (Clear selection), P-18 (Clear warning selection), P-24 (Pause). **Evidence:** [M] rows P-01, P-07, D-05 (deselect) and D-05 (pause): **no page jump in any of them, in either engine**; focus falls to `<body>` for Deselect waypoint, Pause and Replace key, and returns to Rename for P-01. Item 106's jump was therefore not reproduced on these surfaces. **Recommendation:** **needs discussion** — focus placement after a control disappears is a related but separate rule.

### D-06 — Edit copy has no busy guard, and focuses a disabled button after failure

[S] C-12's buttons are never disabled and its Cancel has no in-flight guard; on failure the dialog closes, an alert appears ("The editable copy could not be created on this device. Try again."), and `.focus()` is called on the Edit copy button while it is still disabled — so focus is probably lost (`RidingScreen.tsx` ~1057, ~1760). [U] not measured: inducing it needs a synthetic storage fault in a riding session. **Recommendation:** **candidate for change**, as a defect separate from the reveal rule.

**Correction, 2 October 2026.** "No busy guard", in this entry's heading, is imprecise; the heading is kept because it is this entry's anchor.

- `isEditCopyActionPendingRef`, present since item 38, already makes a second **Replace and edit** a no-op.
- **Edit copy** itself is disabled and reads "Creating editable copy…" while the write runs.
- What is missing is a busy state on the confirmation's own buttons and an in-flight guard on Cancel.

The [review preparation](#review-preparation--d-01-d-02-and-d-06-2-october-2026) measured the rest: Cancel during the write does not cancel it, and focus after a failure is lost in both engines.

**Decided, 2 October 2026:** a working state that refuses Cancel and Escape once the replacement is confirmed, completion that respects the rider's navigation, and failure focus only while the rider has stayed in the interaction. First in the execution order; not yet implemented ([decisions](#decisions--d-06-d-02-d-01-and-c-12-2-october-2026)).

**Delivered, 2 October 2026:** shipped in `0.4.54` as item 124's slice 4 ([record](../../project/history/item-124.md#item-124)). Its ordinary flow was accepted on the installed iPhone in German and English, reported the same day ([`current-status.md`](../../project/current-status.md)); the pending-write and failure cases have automated evidence only.

### D-07 — Two confirmations open at once

[S] Item 119 made this safe for naming and Escape: the page-level C-14 beside C-06, and C-11 beside C-12 in the paused panel. Nothing coordinates their reveals; each would act on its own subject. **Recommendation:** **needs discussion** only if a common rule would reveal one while the other is open.

## Measured results

All rows are 390×844 portrait, ordinary text, English, on the `04639cb` build, 1 October 2026, Chromium and WebKit in the pinned container; "both" means the two engines agreed to within 1 px. "App" movement is the application's own `scrollBy`/`scrollIntoView`; "browser" movement is everything else (focus scrolling, scroll anchoring). The band runs from 75 px (136 px in Settings, below the switcher; 69 px in Riding, below the immersive header) to 836 px.

| ID   | Setup                                                                                                | Opening                                                                                                                                                                                                                                                                                                | Closing                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| C-01 | Delete 16 px above the band's bottom, pointer                                                        | **184 px, all app**; complete in the band; Cancel focused (both)                                                                                                                                                                                                                                       | Cancel (pointer): no movement; focus on Delete, in the band (both)                                                       |
| C-02 | route name 16 px above the band's bottom, pointer                                                    | **441 px, app** (item 95's whole-card `scrollIntoView`); complete in the band; Cancel focused (both)                                                                                                                                                                                                   | Cancel: no movement; focus on the route name (both)                                                                      |
| C-03 | Merge tags at its own position (y≈623 Chromium, ≈700 WebKit), pointer                                | Chromium: **45 px, app** (settled, smooth), complete. WebKit: **no movement, action row left below the band** — the settle-gated reveal did not run (see note)                                                                                                                                         | Chromium: Cancel, focus on Merge tags. WebKit: Escape (Cancel was outside the band), focus on Merge tags                 |
| C-04 | Delete tag at its own position, pointer                                                              | Chromium **45 px**, WebKit **122 px**, app (settled); complete                                                                                                                                                                                                                                         | Cancel: no movement; focus on Delete tag (both)                                                                          |
| C-05 | Clear draft 16 px above the band's bottom, pointer                                                   | **145 px, all app**; complete; Cancel focused (both)                                                                                                                                                                                                                                                   | no movement; focus on the remounted Clear draft, in the band (both)                                                      |
| C-06 | Delete key 16 px above the band's bottom, pointer                                                    | Chromium: **551 px, all browser** (native focus scroll), no app scroll. WebKit: **235 px, all app** — no native scroll at all. Complete in both                                                                                                                                                        | Cancel: no movement; focus on Delete key (both)                                                                          |
| C-07 | launcher End ride where it is (y≈418), pointer                                                       | no movement; complete (both)                                                                                                                                                                                                                                                                           | no movement; focus on the remounted End ride (both)                                                                      |
| C-08 | launcher End ride, free roam (y≈384)                                                                 | no movement; complete (both)                                                                                                                                                                                                                                                                           | no movement; focus on End ride (both)                                                                                    |
| C-09 | launcher Discard (y≈257)                                                                             | no movement; complete (both)                                                                                                                                                                                                                                                                           | no movement; focus on Discard unfinished ride (both)                                                                     |
| C-10 | the riding header's End, where it is (y≈30)                                                          | no movement; the confirmation sits directly below the header (85–282 px) (both)                                                                                                                                                                                                                        | no movement; focus back on the header's End (both)                                                                       |
| C-11 | paused panel at the page's top, End at y≈437                                                         | no movement; complete (445–642 px) (both)                                                                                                                                                                                                                                                              | no movement; focus on End ride (both)                                                                                    |
| C-12 | paused panel, Edit copy at y≈377, a draft stored                                                     | no movement; complete (445–642 px) (both)                                                                                                                                                                                                                                                              | no movement; focus on Edit copy (both)                                                                                   |
| C-13 | the free-roam header's End (y≈30)                                                                    | no movement; below the header (85–261 px) (both)                                                                                                                                                                                                                                                       | no movement; focus back on End (both)                                                                                    |
| C-14 | Plan, Save route 16 px above the band's bottom, a route ride paused                                  | **−1,067 px (Chromium) / −1,066 px (WebKit), all browser** (native focus scroll up to the dialog at the page's top); complete there                                                                                                                                                                    | Escape: no movement; **focus on `<body>`**, so the rider is left at the top of Planning, about 1,070 px from Save (both) |
| D-01 | Clear draft 16 px above the band's bottom, synthetic fault, Confirm (pointer)                        | —                                                                                                                                                                                                                                                                                                      | no movement; the alert and the button are in the band; focus on Clear draft (both)                                       |
| D-02 | Delete 16 px above the band's bottom, synthetic fault, Delete route (pointer)                        | the confirmation grows **37 px** and its **action row is pushed below the band**; no movement; focus lost to `<body>` (Chromium) or left on the disabled Delete route (WebKit); the alert reads "probe fault UnknownError: probe fault", not "That route could not be deleted." (both)                 | —                                                                                                                        |
| D-03 | delete pending on a card; Search routes typed into from the page's top                               | typing hid the card; **one Backspace** brought it back: focus jumped from the search field to Cancel, the app asked for **872 px** (the page moved 180 px in Chromium, 872 px in WebKit), and the remaining Backspaces and a further keystroke went to Cancel — the search was left at "Route " (both) | —                                                                                                                        |
| D-04 | Clear draft: focus returned after Escape, wheel until the button is 156 px above the viewport, Enter | **+161 px browser** (scroll anchoring), then **−384 px app**; the confirmation ends complete at the band's top (both)                                                                                                                                                                                  | —                                                                                                                        |
| D-04 | Delete (second card): button 244 px above the viewport, Enter                                        | **+200 px browser**, then **−451 px app**; complete at the band's top (both)                                                                                                                                                                                                                           | —                                                                                                                        |
| D-05 | Deselect waypoint; Pause                                                                             | no page movement; **focus falls to `<body>`** (both)                                                                                                                                                                                                                                                   | —                                                                                                                        |
| P-01 | Rename 16 px above the band's bottom                                                                 | no movement; the editor ends **21 px below the band**; focus in the name field (both)                                                                                                                                                                                                                  | Cancel (pointer) and Escape: **no jump**; focus on Rename (both)                                                         |
| P-02 | Add tags 16 px above the band's bottom                                                               | Chromium: **450 px browser** (focus scroll for the input), complete. WebKit: **38 px browser**, editor **186 px below the band**                                                                                                                                                                       | not measured (protected flow)                                                                                            |
| P-03 | Filter by tags as low as it can be (y≈250 Chromium, ≈327 WebKit, page at its top)                    | no movement; chooser complete (both)                                                                                                                                                                                                                                                                   | —                                                                                                                        |
| P-04 | Manage tags, likewise                                                                                | no movement; panel complete (both)                                                                                                                                                                                                                                                                     | —                                                                                                                        |
| P-07 | Replace key 16 px above the band's bottom                                                            | no movement; form complete; **focus on `<body>`** (both)                                                                                                                                                                                                                                               | Cancel: no movement; **focus on `<body>`** (both)                                                                        |
| P-11 | Local gradient colours near the band's bottom                                                        | no movement; content runs **≈800 px below the band** (both)                                                                                                                                                                                                                                            | —                                                                                                                        |
| P-14 | What HTTP statuses mean, likewise (Status)                                                           | no movement; content runs **≈1,470–1,490 px below the band** (both)                                                                                                                                                                                                                                    | —                                                                                                                        |
| P-16 | Change (routing options), likewise                                                                   | no movement; content runs **≈123 px below the band** (both)                                                                                                                                                                                                                                            | —                                                                                                                        |

**Note on C-03 in WebKit.** The tag manager's reveal waits for three stable animation frames (`runWhenViewportSettled`) and abandons at a one-second cap. Headless WebKit in this container defers animation frames until something triggers rendering — recorded for this project under item 121 — so the abandoned reveal is taken as a container artefact, not as device behaviour. C-04 in the same engine did reveal. The tag manager's flow is protected and was accepted on the iPhone.

**An inference about WebKit's own focus scroll, labelled as such.** In C-06, WebKit's native focus scroll did not move the page at all and the application's residual reveal did all 235 px; in C-14, which has no reveal of its own, WebKit's focus scroll moved the page 1,066 px. That is consistent with WebKit's focus scroll running **after** the application's layout effects, finding the work already done when there is a reveal — and with slice 1's negative control (c), which did not discriminate in WebKit. It is an inference from two measurements, not an established engine fact, and it says nothing certain about iOS Safari.

## Other findings outside item 124

Reported here so they are not lost; nothing was changed.

- **German typo:** `routes.wouldRemain.other` reads "Es würden {count} Routen übrig **blieben**"; it should end "übrig **bleiben**".
- **Delete route failure shows Dexie's raw English text** ([D-02](#d-02--delete-route-fails)).
- **C-14's Confirm is always red,** even for **Retry**, **Check again** and **Try again**; the inline C-02 styles those as secondary.
- **Stale comments:** `RidingScreen.tsx` (~1277–1279, ~1876–1884) still says Riding renders the gradient-colours disclosure, which item 85 removed; `index.css` (~163–166) still mentions the wake-lock popover, which item 82 removed.
- **A committed e2e comment** (`confirmationReveal.smoke.spec.ts` ~716–719) repeats slice 1's incorrect "reachable by neither tap nor Tab" ([D-04](#d-04--activating-clear-draft-or-delete-while-the-button-is-above-the-viewport)).

## Recommendations at a glance

_4 October 2026: for each entry's current disposition, read the reconciliation's [closure table](closure-reconciliation.md#the-closure-table); this table keeps its recommendations as made, with later notes._

| ID                                       | Surface                                                          | Recommendation                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| C-01                                     | Delete route                                                     | already complies (protected, slice 1)                                           |
| C-02                                     | Switch to another route, inline                                  | preserve existing behaviour (protected, item 95)                                |
| C-03                                     | Merge tags                                                       | preserve existing behaviour (protected); motion needs discussion only if wanted |
| C-04                                     | Delete tag                                                       | preserve existing behaviour (protected)                                         |
| C-05                                     | Clear draft                                                      | already complies (protected, slice 1)                                           |
| C-06                                     | Delete key                                                       | preserve existing behaviour (protected, item 118)                               |
| C-07                                     | End ride, launcher (route)                                       | reviewed 3 October 2026: matches; 25 px over at 200% — recommend unchanged      |
| C-08                                     | End ride, launcher (free roam)                                   | reviewed 3 October 2026: matches; 25 px over at 200% — recommend unchanged      |
| C-09                                     | Discard unfinished ride                                          | already complies as measured — missing-route variant reported 3 October 2026    |
| C-10                                     | End ride, riding header                                          | reviewed 3 October 2026: matches — recommend unchanged                          |
| C-11                                     | End ride, paused panel                                           | **mismatch** (reviewed 3 October 2026) — a correction proposed                  |
| C-12                                     | Edit copy                                                        | opening decided 2 October 2026; shipped `0.4.58` (slice 7); accepted            |
| C-13                                     | End ride, free-roam header                                       | reviewed 3 October 2026: matches — recommend unchanged                          |
| C-14                                     | Switch to another ride, page-level                               | **candidate for change** — approved; shipped in slice 3 (`0.4.52`); accepted    |
| P-01                                     | Rename                                                           | needs discussion                                                                |
| P-02                                     | Add / Edit tags                                                  | preserve existing behaviour (protected)                                         |
| P-03                                     | Filter by tags                                                   | preserve existing behaviour (protected)                                         |
| P-04                                     | Manage tags                                                      | preserve existing behaviour; a reveal on opening needs discussion               |
| P-05, P-06                               | Routes status messages                                           | not candidates; the export-failure placement needs discussion                   |
| P-07                                     | Replace key                                                      | **candidate for change** (focus)                                                |
| P-08 to P-14, P-16, P-20, P-27, P-28     | disclosures                                                      | needs discussion                                                                |
| P-15                                     | Connection-test result                                           | needs discussion                                                                |
| P-17                                     | Waypoint actions                                                 | needs discussion                                                                |
| P-18                                     | Route warning detail                                             | **candidate for change** (header-aware reveal from the map)                     |
| P-19                                     | Planning messages below the map                                  | preserve existing behaviour (protected, item 128)                               |
| P-21, P-26                               | Feature and climb details                                        | **candidate for change** (map- or chart-originated)                             |
| P-22, P-23, P-25, P-31, P-32, P-34, P-35 | status rows, launcher sections, view selector, overlays, notices | not candidates                                                                  |
| P-24                                     | Paused panel                                                     | needs discussion (focus)                                                        |
| P-29                                     | Selected feature summary                                         | needs discussion                                                                |
| P-30                                     | No turn cues                                                     | preserve existing behaviour (protected, item 97)                                |
| P-33                                     | Update prompt                                                    | not a candidate; its placement needs discussion                                 |
| D-01                                     | Clear draft fails                                                | needs discussion — decided 2 October 2026; shipped `0.4.56`; accepted           |
| D-02                                     | Delete route fails                                               | **candidate for change** — approved 2 October 2026; shipped `0.4.57`; accepted  |
| D-03                                     | Card remounts while a delete is pending                          | **candidate for change** — approved; shipped in slice 3 (`0.4.52`); accepted    |
| D-04                                     | Activation above the viewport                                    | already complies as measured                                                    |
| D-05                                     | Focused control destroyed                                        | needs discussion                                                                |
| D-06                                     | Edit copy's busy guard and failure focus                         | **candidate for change** — approved 2 October 2026; shipped `0.4.54`; accepted  |
| D-07                                     | Two confirmations open                                           | needs discussion                                                                |

## Manual review checklist

For each line, please mark **confirm** (adopt the common rule in a later slice), **exclude** (leave as it is), or **discuss**. Steps use the labels you see; ids match the sections above.

C-01 (Delete route) and C-05 (Clear draft) are slice 1 — already approved and accepted on the iPhone — so they need no decision here.

1. **C-14 — the switch dialog from Planning.** With a route ride paused, plan a route in **Plan**, calculate it, and tap **Save route** near the bottom of the screen. The "Switch to …?" dialog appears at the very top of Planning, and after Cancel or Escape you are left there. _Should this dialog follow the common rule (appear where you are, keep your place on Cancel)?_ — confirm / exclude / discuss. **Decided 1 October 2026: confirmed, as a separate Open saved route — shipped in slice 3 (`0.4.52`); accepted on the installed iPhone, reported 2 October 2026.**
2. **D-03 — a delete left open while searching.** In **Routes**, tap **Delete** on a route, then type in **Search routes** so that route disappears, then delete one letter. The route reappears with its confirmation open, focus jumps to Cancel, and the page scrolls. _Should a pending Delete be cancelled when its route leaves the list, or kept as now?_ — confirm a change / exclude / discuss. **Decided 1 October 2026: confirmed, for an unconfirmed Delete — shipped in slice 3 (`0.4.52`); accepted on the installed iPhone, reported 2 October 2026.**
3. **D-02 — Delete route fails.** Not reproducible on demand; it needs the device's storage to fail. When it does, the confirmation grows, its buttons can drop below the screen, focus is lost, and the message is technical English. _Should the buttons be kept in view and the message be the ordinary "That route could not be deleted."?_ — confirm / exclude / discuss. **Decided 2 October 2026: confirmed, with an accurate pending state after an investigation of the list mechanism — not yet implemented. Investigated and planned 3 October 2026 ([report](d-02-delete-lifecycle.md)); shipped in `0.4.57` (slice 6); its ordinary flow accepted on the installed iPhone, reported 3 October 2026.**
4. **D-01 — Clear draft fails.** Not reproducible on demand. The message "The draft could not be cleared on this device. Try again." appears beside Clear draft. _Should that message itself be revealed if it falls off-screen?_ — confirm / exclude / discuss. **Decided 2 October 2026: only while the rider is still waiting, by the minimum; otherwise their activity is kept — shipped in `0.4.56`; its ordinary flow accepted on the installed iPhone, reported 3 October 2026.**
5. **D-06 — Edit copy.** With a draft in Planning, open a route's ride screen, tap **Edit copy**, and see "Replace your current draft?". Its buttons are never disabled while working, and after a failure focus is probably lost. _Fix as a separate defect?_ — confirm / exclude / discuss. **Decided 2 October 2026: confirmed, first in the execution order — shipped in `0.4.54`; its ordinary flow accepted on the installed iPhone, reported 2 October 2026.**
6. **C-07, C-08, C-09 — the Ride launcher's End ride and Discard unfinished ride.** With an unfinished ride, open **Ride** and tap **End ride** (or **Discard unfinished ride**). They open where they are and nothing moves. _Agree they already comply and need no change?_ — confirm / discuss. **3 October 2026: C-07 and C-08 decided — the common opening and cancellation policy, with targeted corrections only where measurements demonstrate a mismatch; C-09's missing-route variant reported on the installed iPhone, with no policy decision ([decisions and observations](#decisions-and-observations--c-07-to-c-13-3-october-2026)).** **Reviewed 3 October 2026: C-07 and C-08 match at ordinary text, with a 25 px overshoot at 200%; C-09's policy is a decision still needed ([review](ride-confirmations-review.md#verdicts)).**
7. **C-10, C-11, C-13 — End ride while riding, paused or in free roam.** Tap **End ride** in the riding header, in the paused panel, or in free roam. They open in view with no movement. _Agree they already comply?_ — confirm / discuss. **3 October 2026: decided — the common opening and cancellation policy, with targeted corrections only where measurements demonstrate a mismatch; a lower opening position was not reachable on the installed iPhone ([decisions and observations](#decisions-and-observations--c-07-to-c-13-3-october-2026)).** **Reviewed 3 October 2026: C-10 and C-13 match; C-11 mismatches, and a correction is proposed ([review](ride-confirmations-review.md#verdicts)).**
8. **C-12 — Edit copy's confirmation itself** opens in view with no movement. _Agree its reveal already complies (item 5 aside)?_ — confirm / discuss. **Decided 2 October 2026: the ordinary-text opening is kept; at enlarged text C-12 adopts the common rule — not yet implemented.** **Shipped in `0.4.58` (slice 7), 3 October 2026; its ordinary flow accepted on the installed iPhone, reported 3 October 2026.**
9. **C-02 — Switch to another route inside a card** (item 95). _Keep exactly as accepted?_ — confirm keeping / discuss.
10. **C-03, C-04 — Merge tags and Delete tag in Manage tags** (items 105 and 106). Their reveal waits a moment and then scrolls smoothly. _Keep as accepted?_ — confirm keeping / discuss motion.
11. **C-06 — Delete key in Settings** (item 118). _Keep as accepted?_ — confirm keeping / discuss aligning its mechanism with slice 1.
12. **P-07 — Replace key.** In **Settings**, with a key saved, tap **Replace key**, then **Cancel**. The form opens in place, but keyboard focus is dropped both times. _Should focus go into the key field on opening and back to Replace key on Cancel?_ — confirm / exclude / discuss.
13. **P-01 — Rename a route.** Tap **Rename** on a card near the bottom: the name field takes focus (on the iPhone the keyboard opens) and the editor can end just below the screen. _Leave it to the keyboard, or reveal the editor?_ — confirm a change / exclude / discuss.
14. **P-02, P-03, P-04 — the tag editor, Filter by tags and Manage tags** (items 100, 105, 106, 111). _Keep as accepted?_ — confirm keeping / discuss a reveal on opening Manage tags.
15. **Disclosures — P-08 to P-14, P-16, P-20, P-27, P-28.** For example Settings → **Local gradient colours**, Status → **What HTTP statuses mean**, Plan → **Change**. Opening one never moves the page; long ones continue far below the screen. _Should opening a disclosure ever move the page?_ — confirm a change / exclude / discuss.
16. **P-18, P-21, P-26, P-29 — details that appear far from where you tapped.** In **Plan**, tap a warning or a climb on the map, or the elevation chart; in a ride's overview choose a climb under **Recognised climbs**; during a ride, tap the elevation chart for the **Selected feature summary**. The details appear below, possibly off-screen. _Should these be revealed?_ — confirm / exclude / discuss.
17. **P-17 — waypoint actions.** In **Plan**, tap a waypoint, then **Move** or **Insert after**: the map's placement control may be off-screen. _Treat this here, or with item 127?_ — discuss.
18. **D-05, P-24 — when the tapped button disappears.** Tapping **Deselect waypoint**, **Pause**, or **Replace key** drops keyboard focus; the page does not jump. _Should focus go somewhere deliberate?_ — confirm / exclude / discuss.
19. **P-15 — Test routing connection** in Status (needs a key; sends a real request). The result appears below and focus is dropped. — confirm / exclude / discuss.
20. **D-04 — activating Clear draft or Delete from the keyboard after scrolling them off the top.** The confirmation still ends fully in view. _Agree no change is needed?_ — confirm / discuss.
21. **D-07 — two confirmations at once** (End ride and Edit copy in the paused panel; the page-level switch dialog beside Delete key). — discuss only if a common rule should coordinate them.
22. **Not candidates — P-05, P-06, P-19, P-22, P-23, P-25, P-30 to P-35.** Status messages, notices, overlays and the protected item 97 and item 128 surfaces. _Agree to leave them out?_ Two separate presentation questions are offered here instead: the export-failure message appearing at the top of Routes (P-06), and the update prompt appearing above the visible area (P-33). — confirm / discuss.

**3 October 2026:** the checklist items still open — 9 to 22, with D-04 measured as satisfactory but not device-accepted — are reconciled against current source, with recommended dispositions, in the [review](ride-confirmations-review.md#the-remaining-inventory--decisions-still-needed). The review decides none of them.

**4 October 2026:** every item still open is given one disposition in the [reconciliation](closure-reconciliation.md#the-closure-table) — approved retention, proposed retention, deferred or unresolved — under the rider's direction of that day. The proposed retentions still await the rider's confirmation.

## Reproduction gaps

Branches flagged as difficult to reach or apparently unreachable. No steps are invented for them, and none was removed or changed.

- **C-14 and C-02, "unsupported stored session" (Discard and continue):** needs a corrupt or unknown stored ride row; not reachable through the interface.
- **C-14 and C-02, "check failed" (Retry):** needs the ride-state read itself to fail; not reachable by ordinary steps.
- **C-14 and C-02, "clear failed", and C-02 "return failed":** need a storage write to fail, or a second tab changing the paused ride; the second-tab route is reachable but unusual.
- **C-09, unsupported-kind variant:** needs a corrupt stored row.
- **C-07, C-08, C-09, C-10, C-11, C-13, failure alerts; D-01, D-02:** need a real storage failure; measured here only with a synthetic fault.
- **D-06:** not measured. _(Measured on 2 October 2026 with controlled synthetic fixtures: [review preparation](#review-preparation--d-01-d-02-and-d-06-2-october-2026).)_
- **The tag manager's empty state** ("No tags left. Add tags from a route to manage them here."): from source, reachable when the last tag disappears while the panel is hidden (for example behind a card's delete confirmation, or from another tab); not reproduced.
- **P-15:** sends a real request; not measured.
- **P-18:** needs a calculated route with a surface warning; not measured. _(Measured on 4 October 2026 with a synthetic provider fixture and a real map tap: [reconciliation](closure-reconciliation.md#p-18--a-surface-warning-selected-on-plannings-map).)_

## Method and reproducing

**The probe.** A temporary Node script in the session's scratchpad — deliberately not committed, as the rider asked for diagnostics to stay out of the repository — modelled on item 128's [`capture.mjs`](../planning-imagery-banner/capture.mjs): the Playwright library from the repository's `node_modules`, the e2e suite's own `installLocalMapStyle` fixture and the English catalogue imported directly, run against `vite preview` of a `04639cb` build made **before** any documentation commit (`dist/` verified byte-identical to that build throughout).

- **Container and browsers:** `mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48`, Chromium and WebKit, 390×844, service workers blocked, geolocation granted at a fixed synthetic position, map style served locally, and openrouteservice answered by a local mock — no live provider is contacted.
- **Fixtures:** routes imported through the GPX import control; free roam and route riding started through the interface; tags, a paused ride and a Planning draft written directly to IndexedDB where going through the interface would add nothing to the measurement (C-02, C-03, C-04, C-07, C-09, C-12, C-14). C-09's paused ride names a route that was never saved, a synthetic shortcut to the "route missing" state.
- **Interaction:** pointer clicks at the control's centre, only after checking that the point hits the control and lies in the usable band (or in the sticky chrome, for the riding header's own controls); the page positioned with wheel input over non-map content; Escape and Enter from the keyboard. The one synthetic interaction is choosing a tag in the tag manager's native `<select>`, whose system picker cannot be driven.
- **Recorded per step:** the page's scroll position before and after; the application's own calls to `scrollBy`, `scrollTo` and `scrollIntoView` (wrapped, with the caller's arguments forwarded unchanged), which separates deliberate scrolling from the browser's own; the usable band; the confirmation, action row, panel and trigger boxes; and the focused element.
- **Synthetic faults (D-01, D-02):** `IDBObjectStore.prototype.delete` throwing for the named store.
- **A defect in the probe, corrected before any result was used:** its first `scrollBy` wrapper always forwarded two arguments, and `scrollBy(options, undefined)` selects the `(x, y)` overload, which scrolls by 0 — so a requested 184 px reveal appeared not to happen. Every result below comes from the corrected probe.

**Reproducing.** Build the commit, start `vite preview` inside the pinned container, and drive the steps given for each ID with real pointer, wheel and keyboard input, recording the same quantities. No probe ships with this document.

## Limitations

- Measured at 390×844 portrait, ordinary text, English only; 200% text and German were not measured for the surfaces beyond slice 1, except where noted. Browser root-text scaling is not iOS Larger Text in any case.
- Desktop Chromium and WebKit are not iOS Safari: in particular, whether the browser's own focus scroll reveals a confirmation on the iPhone is **not** established by these measurements, and slice 1's original observation was that it did not.
- Synthetic IndexedDB faults show what the interface does once a write fails; they do not show that such a failure occurs on a device.
- No VoiceOver, landscape, physical-Android or physical-keyboard result.
- Line numbers are approximate pointers into `04639cb`.

## Decisions and delivery

**1 October 2026 — two cases approved, and shipped as item 124's slice 3 (`0.4.52`).** The rider approved these, with corrections, and nothing else from this inventory:

- **C-14, Planning's entry path only.** **Save route** now only saves: it stays in Planning and shows `“{name}” is saved in Routes.` / `„{name}“ ist unter „Routen“ gespeichert.` in the save area, with a separate **Open saved route** / **Gespeicherte Route öffnen**. Opening goes through the existing ride-transition guard; when another ride is unfinished, the switch confirmation appears directly beneath that action, under the common rule, and Cancel or Escape keep the original ride and the rider's position. The dialog's other entry paths — a route card's prompt followed off Routes, and a stale launcher — are unchanged and still page-level, as is item 95's inline prompt.
- **D-03.** An unconfirmed Delete is dismissed when the search or a tag filter hides its route, quietly — no focus moved, nothing scrolled — and stays closed when the route returns. A deletion already running continues, and a confirmed deletion that failed keeps its confirmation and error (D-02's state, which is not decided).

**Still awaiting the rider's review:** every other case in this document, including checklist items 3 onwards. The full record of slice 3 — mechanism, evidence, baseline and controls, findings and limitations — is in [item 124](../../project/history/item-124.md#item-124); both cases were **accepted on the installed iPhone** in German and English, reported 2 October 2026 on `0.4.52` ([`current-status.md`](../../project/current-status.md)).

**2 October 2026 — D-06, D-02, D-01 and C-12 decided.** Since then, checklist items 3, 4, 5 and 8 are decided as well; the record is [Decisions — D-06, D-02, D-01 and C-12](#decisions--d-06-d-02-d-01-and-c-12-2-october-2026). Nothing about them is implemented yet, and every other case still awaits the rider's review.

**Later: D-06 shipped in `0.4.54` (2 October 2026) and D-01 in `0.4.56` (3 October 2026)**, as item 124's slices 4 and 5. D-02 and C-12's opening reveal remain approved and not implemented, and every other case still awaits the rider's review. D-01's ordinary flow was accepted on the installed iPhone, reported 3 October 2026, and D-02's investigation and planning stage is next.

**3 October 2026 — D-02 decided and delivered.** After the [D-02 report](d-02-delete-lifecycle.md), the rider approved its implementation with option A (decision 8 below), and it shipped in `0.4.57` as item 124's slice 6 ([record](../../project/history/item-124.md#slice-6--delete-route-pending-and-failing-d-02-shipped-0457-3-october-2026)). C-12's opening reveal remains approved later work; every other case still awaits the rider's review.

**3 October 2026, later — D-02 accepted; five surfaces decided; C-09 reported.** D-02's ordinary flow was accepted on the installed iPhone. The rider approved the common opening and cancellation policy for C-07, C-08, C-10, C-11 and C-13 and reported C-09's missing-route variant on the device — see [Decisions and observations](#decisions-and-observations--c-07-to-c-13-3-october-2026). C-12's opening reveal is the next slice; every case not yet reviewed still awaits the rider's review.

**3 October 2026, evening — C-12 delivered.** C-12's opening reveal shipped in `0.4.58` as item 124's slice 7 ([record](../../project/history/item-124-continued.md#slice-7--edit-copys-replacement-confirmation-opening-c-12-shipped-0458-3-october-2026)); its device check is pending.

**3 October 2026, later — C-12 accepted.** Its ordinary flows passed on the installed iPhone in English and German, on `0.4.58` (build `7e46daf`) ([`current-status.md`](../../project/current-status.md)).

**3 October 2026 — review, documentation only.** C-07, C-08, C-10, C-11 and C-13 were measured against the common policy, and every remaining entry was reconciled, in the [review](ride-confirmations-review.md). It proposes one correction, for C-11, and lists the decisions still needed; it selects, accepts and excludes nothing.

**3 October 2026, evening — four decisions; C-11 delivered.** The rider's decisions on C-11, C-07/C-08, C-09 and the surviving confirmations are recorded in the [continuation](../../project/history/item-124-continued.md#decisions-recorded-on-3-october-2026-evening); C-11 shipped in `0.4.59` as slice 8, and the transition dismissal is the next slice.

**3 October 2026, later — C-11 accepted.** Its ordinary flows passed on the installed iPhone in English and German, on `0.4.59` (build `bc4fb11`) ([`current-status.md`](../../project/current-status.md)).

**3 October 2026, later still — slice 9.** Decision 4's transition dismissal shipped in `0.4.60` ([record](../../project/history/item-124-continued.md#slice-9--confirmations-closed-by-a-ride-transition-c-10-c-11-c-12-shipped-0460-3-october-2026)).

**4 October 2026 — slice 9 accepted.** Its ordinary flows passed on the installed iPhone in English and German, on `0.4.60` (build `e2ba7cf`) ([`current-status.md`](../../project/current-status.md)). Item 124 stays active while the remaining inventory is reconciled.

## Review preparation — D-01, D-02 and D-06 (2 October 2026)

**Moved, 4 October 2026, for size only.** This section — its method, its source recheck at `64bde8d`, the D-02, D-01 and D-06 measurements with C-12 as context, the nine questions put to the rider and its limitations — now lives, unchanged, in a [separate file](d-01-d-02-d-06-review-preparation.md). The rider's answers stay below, in [Decisions — D-06, D-02, D-01 and C-12](#decisions--d-06-d-02-d-01-and-c-12-2-october-2026). Earlier links to its parts resolve here:

### D-02 — Delete route fails

Moved: [D-02's measurements](d-01-d-02-d-06-review-preparation.md#d-02--delete-route-fails).

### D-01 — Clear draft fails

Moved: [D-01's measurements](d-01-d-02-d-06-review-preparation.md#d-01--clear-draft-fails).

### D-06 — Edit copy, with C-12 as context

Moved: [D-06's measurements, with C-12 as context](d-01-d-02-d-06-review-preparation.md#d-06--edit-copy-with-c-12-as-context).

### Decisions needed from the rider

Moved: [the nine questions](d-01-d-02-d-06-review-preparation.md#decisions-needed-from-the-rider), each answered in the decisions section below.

## Decisions — D-06, D-02, D-01 and C-12 (2 October 2026)

**Status: approved by the rider on 2 October 2026, as product decisions authorising later work.** They are **not device acceptance** of any implementation. Nothing below is implemented yet, and each implementation will need its own evidence and its own installed-iPhone check. **This is not blanket approval:** every other case in this document still awaits the rider's review, and no other confirmation or expanding panel is approved for a behaviour change.

### What the decisions rest on, kept apart

- **The rider's device observation:** C-12 on an iPhone 13, in German and English, reported 2 October 2026 — its replacement confirmation opened without moving the page and fitted on screen. The dated record is in [`current-status.md`](../../project/current-status.md) and is not repeated here.
- **Synthetic desktop findings:** the [review preparation](#review-preparation--d-01-d-02-and-d-06-2-october-2026) — desktop Chromium and WebKit in the pinned container, with synthetic storage faults, holds and aborts, and browser root-text scaling.
- **Not reproduced on the phone:** a pending write, a storage failure, an enlarged-text layout and keyboard-focus behaviour. Nothing here claims otherwise.
- **The newly approved policies:** the seven decisions below, numbered as the rider gave them, with the [questions](#decisions-needed-from-the-rider) each answers — and an eighth, D-02's own question after its investigation, reported 3 October 2026.
- **Future implementation and acceptance:** none yet; see [Order](#order).

### The decisions

- **1. D-06, working state and cancellation (questions 5 and 6).** After **Replace and edit** is confirmed, both confirmation actions are disabled while the operation runs, with a clear translated working label, and Escape does not dismiss the confirmation during that period. Before confirmation, Cancel and Escape continue to cancel normally. The existing duplicate-operation guard is kept.
- **2. D-06, navigation during the operation (question 7).** The confirmed replacement may finish after the rider leaves Ride, but its completion must respect that navigation and must not pull the rider into Planning. If the rider remains in the initiating Ride context, successful completion may navigate to Planning as usual. The implementation plan must explain how the outcome stays discoverable after navigation, using existing interface conventions.
- **3. D-06, failure (question 8).** Once Edit copy is enabled again, focus returns there only if the rider has remained in the relevant interaction. If they have moved elsewhere, their focus and page position are preserved. Any necessary reveal uses minimum scrolling.
- **4. D-02, failure wording and controls (questions 1 and 2).** The ordinary translated "That route could not be deleted." / "Diese Route konnte nicht gelöscht werden." is shown, and the technical details stay in the existing redacted diagnostics log. The failure confirmation's actions stay accessible through a guarded minimum reveal and appropriate focus restoration. A failure must not take focus or scroll away from another activity the rider has started.
- **5. D-02, pending deletion and delayed failure (question 3).** The interface must represent pending, successful and failed deletion accurately, and a failed deletion must not leave a still-stored route hidden without an error or a way to recover. The storage and list mechanism is investigated before an implementation is chosen. Keeping the route, with "Deleting…", until the deletion has committed is the preferred presentation; this approval prescribes neither a cache workaround nor a storage architecture.
- **6. D-01, a Clear draft failure (question 4).** If the rider has moved elsewhere, their activity is preserved. The error stays in the Clear draft area. If they are still waiting at that operation, focus is restored appropriately and the button and its message are revealed only as far as necessary, avoiding the browser's own uncontrolled focus scrolling.
- **7. C-12, the opening reveal (question 9).** When implemented, C-12 follows the established common rule: no movement when the card fits, the minimum movement when it can fit after scrolling, and action-row priority when it is taller than the usable space. The ordinary-text opening the rider checked on the iPhone is preserved.
- **8. D-02, a failure while the rider's own filter hides the route (the [D-02 report's](d-02-delete-lifecycle.md#decision-for-the-rider) one question; reported 3 October 2026, with approval of D-02's implementation).** Option A: the route stays hidden according to the filter, and the failure stays with that route's confirmation; when the route becomes visible again, its message and recovery actions are shown without taking focus or scrolling. No list-level message or notification is added. Implementation approval, not device acceptance.

### Order

- **Execution order:** D-06's repair within item 124 → [item 132](../../project/history/items-132-147.md#item-132) → item 124's remaining approved slices (D-01, D-02 and C-12's opening reveal) → item 122's design stage → item 103 → item 120. The authoritative list is in the root [`CLAUDE.md`](../../../CLAUDE.md).
- **Why D-06 goes first:** an available Cancel currently closes the confirmation while the confirmed draft replacement continues, and its completion can override the rider's subsequent navigation.
- **Scope of the next slice:** D-06 only. D-01, D-02 and C-12's opening-reveal change remain later work; their implementation details are settled when each slice is planned.
- **Delivered:** D-06's repair shipped in `0.4.54`, 2 October 2026, as item 124's slice 4 ([record](../../project/history/item-124.md#item-124)). Its ordinary flow was accepted on the installed iPhone in German and English, reported the same day; the pending-write and failure cases have automated evidence only.
- **Delivered:** D-01's repair shipped in `0.4.56`, 3 October 2026, as item 124's slice 5, after [item 132](../../project/history/items-132-147.md#item-132) was accepted on the installed iPhone. Its failure cases have automated evidence only, and its ordinary-flow device check is pending.
- **Accepted and next:** D-01's ordinary flow was accepted on the installed iPhone in English and German, reported 3 October 2026, on `0.4.56` (build `439e578`). The next slice is D-02's investigation and planning stage, with no implementation; C-12's opening reveal remains approved later work.
- **D-02 investigated and planned, 3 October 2026:** the [D-02 report](d-02-delete-lifecycle.md). Not implemented; its implementation follows the rider's review.
- **Delivered:** D-02's repair shipped in `0.4.57`, 3 October 2026, as item 124's slice 6, with decision 8 ([record](../../project/history/item-124.md#slice-6--delete-route-pending-and-failing-d-02-shipped-0457-3-october-2026)). Its pending, failure and enlarged-text cases have automated evidence only, and its ordinary-flow device check is pending. C-12's opening reveal is the remaining approved work.
- **Accepted and next:** D-02's ordinary flow was accepted on the installed iPhone in English and German, reported 3 October 2026, on `0.4.57` (build `bd688d7`). C-12's opening reveal is the next slice, slice 7. The same day's policy for C-07, C-08, C-10, C-11 and C-13 and the C-09 report are in [Decisions and observations](#decisions-and-observations--c-07-to-c-13-3-october-2026).
- **Delivered:** C-12's opening reveal shipped in `0.4.58`, 3 October 2026, as item 124's slice 7 ([record](../../project/history/item-124-continued.md#slice-7--edit-copys-replacement-confirmation-opening-c-12-shipped-0458-3-october-2026)). Its enlarged-text, oversized and reappearing-confirmation cases have automated evidence only, and its ordinary-flow device check is pending.
- **Accepted:** C-12's ordinary flows passed on the installed iPhone in English and German, reported 3 October 2026, on `0.4.58` (build `7e46daf`).

## Decisions and observations — C-07 to C-13 (3 October 2026)

**Status: a policy approval and two device observations, recorded separately.** The rider approved the common opening and cancellation policy for C-07, C-08, C-10, C-11 and C-13 — a product decision, **not device acceptance**, and nothing about it is implemented. The rider also reported, from the installed iPhone, an observation for those five and a check of C-09's missing-route variant. C-12's opening reveal remains the only implementation selected.

### The policy approval and observation — C-07, C-08, C-10, C-11 and C-13

The rider's words, verbatim (reported 3 October 2026):

> “Keep these placements and existing ride semantics, and require the common opening/cancellation behaviour above. Make only targeted corrections where current checks or enlarged-text measurements demonstrate a mismatch. I can't position the cancel buttons low enough though for C10, C11, C07, C13 and C08. Please give me instructions for C09 too, then we can finish this slice.”

The common behaviour approved, as the rider stated it:

- the confirmations stay beside their opening controls, below the riding header or inside the paused or launcher panel;
- no scrolling when a confirmation fits; otherwise it is revealed only as far as necessary;
- an oversized confirmation prioritises its complete action row while its explanation stays reachable;
- Cancel closes the confirmation and preserves whether the ride was active or paused; the resulting page position is kept, with only a necessary adjustment to reveal the opening control;
- Cancel is focused on opening, and focus returns appropriately on cancellation, without uncontrolled browser scrolling and without taking focus after the rider has moved elsewhere;
- existing End ride semantics are preserved.

**What this is, kept apart:**

- **An approved behaviour policy** for five surfaces. Their placements and ride semantics are kept, and a correction is made only where current checks or enlarged-text measurements demonstrate a mismatch. Their recorded measurements are at ordinary text, in English ([Measured results](#measured-results)), so **which corrections, if any, are needed is implementation work still to be measured and selected**; none is selected.
- **A device observation:** the rider could not position the Cancel buttons low enough on the installed iPhone to reach a lower opening position for any of the five. It is **not** a report that every action passed on those surfaces, and **no version, build or language** was attached to it. That a lower position could not be reached on this phone does not establish that it is unreachable at every supported phone size.

### C-09 — Discard unfinished ride, the missing-route variant

The rider's report from the installed iPhone — `0.4.57` (build `bd688d7`), English and German, reported 3 October 2026 — is recorded once, verbatim, in [`current-status.md`](../../project/current-status.md): the missing-route confirmation is readable and fits without unwanted movement; Cancel keeps the unfinished-session warning; a confirmed Discard removes it, and it stays gone after leaving and returning; other saved routes remain; and a lower opening position was not reachable. It covers the **missing-route variant only** — not enlarged text, the unsupported or corrupt-session variant, or storage failures. **No policy decision is recorded for C-09.**

### Where item 124 now stands

- **Approved behaviour policies:** C-14 and D-03 (1 October 2026, delivered); D-06, D-02, D-01 and C-12 (2 October 2026 — D-06, D-01 and D-02 delivered); and the common policy for C-07, C-08, C-10, C-11 and C-13 (above).
- **Reported device observations:** C-12 on an iPhone 13 (2 October 2026); C-09's missing-route variant and the five surfaces' unreachable lower positions (3 October 2026).
- **Next:** C-12's opening reveal, slice 7.
- **Implementation still to be selected:** any targeted correction under the five-surface policy, and every inventory entry not yet reviewed, which needs an explicit review or disposition before item 124 closes.

**Later, 3 October 2026:** C-12's opening reveal shipped in `0.4.58` as slice 7 ([record](../../project/history/item-124-continued.md#slice-7--edit-copys-replacement-confirmation-opening-c-12-shipped-0458-3-october-2026)); its device check is pending. The categories above are otherwise unchanged.

**Later still, 3 October 2026:** C-12's ordinary flows were accepted on the installed iPhone in English and German, on `0.4.58` (build `7e46daf`) ([`current-status.md`](../../project/current-status.md)). Item 124 stays active: any targeted correction under the five-surface policy, and every inventory entry not yet reviewed, still needs review or disposition.

**Review, 3 October 2026:** the five surfaces were measured and the remaining entries reconciled in the [review](ride-confirmations-review.md), documentation only:

- **measured matches:** C-10 and C-13; C-07 and C-08 at ordinary text;
- **measured mismatches:** C-11, for which a correction is proposed; C-07 and C-08's 25 px overshoot at 200%, recommended unchanged;
- **decisions still needed:** the C-11 slice, C-09's policy, confirmations surviving ride transitions, and the remaining entries in the review's [decision list](ride-confirmations-review.md#the-remaining-inventory--decisions-still-needed).

**Evening, 3 October 2026:** those three decisions were taken, and C-07/C-08's 25 px accepted as a bounded exception ([decisions](../../project/history/item-124-continued.md#decisions-recorded-on-3-october-2026-evening)); C-11's correction shipped in `0.4.59` (slice 8), its device check pending. **Next:** the approved transition-dismissal slice. The remaining entries still need review or disposition.

**4 October 2026:** slice 9 was accepted on the installed iPhone, and every remaining entry was given a disposition in the [reconciliation](closure-reconciliation.md). **Next:** the rider's decisions on P-18's proposed slice 10, P-01 and the proposed retentions. Item 124 is not closed.

**4 October 2026, later:** the rider approved slice 10 and the proposed retentions except P-01; slice 10 shipped in `0.4.61`; and P-01, P-15 and the two source-only concerns were investigated. **Next:** P-18's installed-iPhone check and the rider's [decisions still needed](closure-reconciliation.md#decisions-still-needed-after-slice-10). Item 124 is not closed.

**4 October 2026, after slice 10's acceptance:** P-18 was accepted on the installed iPhone, and the rider decided P-01, P-15 and the two source-only concerns ([summary](closure-reconciliation.md#dispositions-after-slice-10s-acceptance-4-october-2026)). **Next:** slice 11, P-15's result reveal, then its installed-iPhone check. Item 124 is not closed.

**4 October 2026, later:** slice 11, P-15's result reveal, shipped in `0.4.62` ([record](../../project/history/item-124-continued.md#slice-11--the-routing-connection-result-revealed-p-15-shipped-0462-4-october-2026)). **Next:** its installed-iPhone check, then item 124's closure.

**4 October 2026, closure:** slice 11 was accepted on the installed iPhone, and item 124 was closed with explicit deferrals ([final dispositions](closure-reconciliation.md#closure-4-october-2026)). Its record is now in [`history/`](../../project/history/item-124.md#item-124). Every inventory entry has its final disposition.
