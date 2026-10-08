# Completed backlog items 148–

This file continues the 100– numeric range and opens at item 148. It was started on 8 October 2026, when item 148 was closed. Its natural range file, then `items-132-NN.md`, held about 143,000 characters, and item 148's record would have taken it past the ~150,000-character soft cap documented in [`README.md`](README.md). That file was therefore closed at item 147 and renamed [`items-132-147.md`](items-132-147.md), as `items-118-NN.md` was renamed `items-118-131.md`. Item 146, concluded the same day, has its own file, [`item-146.md`](item-146.md#item-146), with a pointer in `items-132-147.md`. Stable item numbers never change, regardless of which file their text lives in.

See [`README.md`](README.md) for the full history index, [`../backlog.md`](../backlog.md) for pending specifications, and [`../current-status.md`](../current-status.md) for the manual acceptance ledger.

---

<a id="item-148"></a>

## Item 148 — Paused-End confirmation scroll preconditions — done

_Category: End-to-end test reliability_

**Status: done — CI verified on 8 October 2026, in run 37791383314, which deployed `0198b2b`** ([CI verification](#ci-verification--run-37791383314-8-october-2026)). It is complete within its approved fixture-repair scope.

- **Test-only:** no application, CI, version, retry or timeout change, and no device check.
- **Where things live:** the entry moved here from `backlog.md` on 8 October 2026, with item 146's conclusion. The text below is as it stood there, with its links adjusted for this file, and the CI verification follows it. The investigation and the repair are recorded in detail in [the audit report's section 16](../e2e-coverage-runtime-audit.md#16-item-148-investigation-and-proposal-8-october-2026).

148. **Paused-End confirmation scroll preconditions — unscheduled test-reliability investigation**
     - **Origin:** recorded on 6 October 2026, during item 139's verification, and again on 7 October 2026, during item 125's, as an unnumbered observation in [`current-status.md`](../current-status.md), and promoted to this number on 7 October 2026 by the rider's decision. **Automated evidence only**, from local runs in the pinned Playwright container; not an installed-iPhone observation.
     - **Unscheduled, and not part of the approved execution order.** It is linked to [item 146](item-146.md#item-146), the E2E audit, which may prioritise diagnostics for it but does not fix it. No change to the test or production code is approved by this entry.
     - **The spec:** `e2e/endRidePausedConfirmationReveal.smoke.spec.ts`, whose "scrolled" cases are generated at line 1041 from its `SCROLLED_CASES` table. Each asserts its own precondition — that wheel input put End ride's slot where the case requires — before the behaviour it tests.
     - **First occurrence, 6 October 2026, on item 139's build:** project `webkit-smoke`, "(en, 100%) scrolled with End ride's slot under the navigation, then Cancel: only the movement that reveals End ride" and "(de, 100%) scrolled with End ride's slot under the navigation, then Cancel: only the movement that reveals End ride", in a combined local run of 164 tests. **Its artefacts were overwritten and not inspected.**
     - **Second occurrence, 7 October 2026, on item 125's build (`index-Df45j2uq.js`):** project `webkit-smoke`, "(en, 100%) scrolled with End ride's slot partly above the viewport, then Cancel: only the movement that reveals End ride", in a combined local run of 229 tests. **Its artefacts were kept:** the failure screenshot shows the paused screen at its top with End ride's confirmation open.
     - **Reruns and baselines, kept on record and not treated as resolution:** after the first, an identical combined run passed 164 of 164, the case passed 12 of 12 in isolation on that build and on the baseline, and a combined baseline run showed no such failure; after the second, the next identical combined run passed that case, as did a combined run of the same specs on a build source-equivalent to `0.4.68`.
     - **Not assumed:** that the two occurrences — different cases, on different builds, in different runs — share a cause, or that either is attributable to item 125 or item 139. **No cause is established.**
     - **Not [item 130](../backlog.md#item-130)**, which concerns a different spec and assertion.
     - **Diagnostics from item 146's first slice, 7 October 2026** ([report](../e2e-coverage-runtime-audit.md#8-focused-diagnostics-items-147-and-148)). They started with the eight WebKit scrolled cases and the kept artefacts; the broader 230-case selection was not reconstructed.
       - **The unmodified cases × 5, with a JSON reporter (40 tests on 36 workers): 3 failed**, in three different cases. The spec's own placement note shows every pass exactly on target and every failure exactly where the confirmation was before the wheel.
       - **An instrumented copy × 5, recording wheel and scroll events without requesting frames (40 tests on 36 workers): 2 failed.** In both, the document received one cancelable, not default-prevented `wheel` and the page could scroll, but no `scroll` event followed and `scrollY` never changed within the settle window, at least 300 ms. In passes the first scroll followed within 5–107 ms.
       - **The same at 2 workers with `--cpus=4`, a controlled comparison, not CI-equivalent: 6 of 40 failed, all in that pattern** — so high concurrency is not required for reproduction; a load contribution remains unestablished.
       - **All eight cases passed in both supplied CI runs.**
       - **Not established:** a cause; whether WebKit would have scrolled after the settle window; whether the first occurrence had the same form. Nothing is attributed to item 125 or 139, and no change is approved.
     - **Scheduled, 7 October 2026, by the rider's decision:** a bounded investigation and proposal, third in the order, after [item 147](items-132-147.md#item-147).
       - Establish whether wheel input is part of the behaviour these cases protect, or only prepares their scroll position.
       - Deliver a bounded proposal before changing their setup or assertions.
       - High concurrency is not required for reproduction; any load contribution remains unestablished.
       - The scheduling authorises investigation and a proposal, not implementation.
     - **Investigation and proposal, 8 October 2026 — reported; nothing implemented** ([report](../e2e-coverage-runtime-audit.md#16-item-148-investigation-and-proposal-8-october-2026)). No test, assertion, application or CI change.
       - **The answer, from source and measurement.** In ten of the spec's eleven wheel-using cases — the eight scrolled cases, the reopening case and the Edit copy case — the wheel only prepares the scroll position. The application never observes how the page got there, and each case's own precondition or comparison checks the position. In "Cancel during a held Pause, then the rider moves on with wheel", the wheel is the behaviour: C-11's guard disarms on the event, and no scroll is needed.
       - **The trace.** The spec's `settle()` resolves once nothing has moved for 300 ms, counted from its own start, so a scroll that has not yet begun reads as settled.
       - **The runs.** All were in the CI image by digest, with `CI=1`, 2 workers (by banner and report) and 4 CPUs, in WebKit, with the eleven cases ×5 each.
         - **U1, unmodified, trace recorded as `CI=1` configures:** 55 passed.
         - **I1, a light instrumented copy:** 55 passed.
         - **I2, the same with `--trace off`** — a controlled comparison, not CI-equivalent: 7 failed at the spec's own precondition.
       - **Confirmed.** All 100 instrumented setup wheels were delivered to `SECTION.screen` and none was cancelled, before or after dispatch. No application scroll call followed. Where the page had moved by the settle (93 of 100), it was exactly on target.
       - **In the seven failures,** exactly one later scroll reached the target, 1.28–2.39 s after the wheel, with no input in between. It came about when Playwright wrote its failure screenshot, which shows the pre-wheel position. The scroll was late, not lost.
       - **Not established:** why, whether it would arrive without that capture, whether tracing affects it (traces were associated with no failures), the first occurrence's form, and any CI rate.
       - **Proposed — recommended (B):** in the ten setup-only cases, set the position directly through `document.scrollingElement.scrollTop`, labelled synthetic, and keep every precondition and behaviour assertion.
         - The held-Pause case keeps its genuine wheel, and every pointer and key input stays.
         - Waiting positively for the wheel's target (A) is not recommended unless a further diagnostic shows the late scroll arrives with no capture.
         - The report gives the focused verification and three negative controls for a later implementation.
       - **Awaiting the rider's decision;** nothing of it is implemented.
     - **Documentation commit `6967c02`, CI run 37767874728, 8 October 2026:** every job passed — Verify and build 307 s; shards 691, 888, 496 and 985 s; Deploy 12 s. The live site served `0.4.69` / `6967c02`, and `677a03e` remains the accepted phone build. Shard 4's 985 s is the longest shard job recorded, 215 s under the limit. One run: neither a trend nor a cause is claimed.
     - **Approved, 8 October 2026, by the rider:** proposal B. The cause of WebKit's late wheel scrolling remains unresolved; the approval covers correcting the fixture's preparation only.
     - **Fixture repair, 8 October 2026 — implemented, test-only; CI verification pending** ([record](../e2e-coverage-runtime-audit.md#approval-and-implementation-8-october-2026)). No application, CI, version, retry or timeout change.
       - **The change, in both engines.** In the ten setup-only cases, `wheelBy` is replaced by `positionPageBy`, which is labelled synthetic. It sets `document.scrollingElement.scrollTop` from the current position plus the delta, clamped to the reachable range, then runs the unchanged `settle()`. `wheelBy` is removed.
       - **One narrow setup precondition,** in the reopening case only: "the prepared position put End ride 120 px below the band's top". Its target is reachable: −37 px, from 535 to 498, within 0–1,545 px.
       - **Unchanged:** the held-Pause wheel, every click and key press, every behaviour assertion and every other precondition.
       - **The reopening title** changed from "… after Cancel and a wheel scroll …" to "… after Cancel and a scroll …", so its identity in timing comparisons changes.
       - **The trade-off:** these ten cases no longer exercise browser wheel scrolling, or focus preservation specifically during wheel input. Their application geometry, focus-return and ride-state checks remain.
       - **Verification,** in the CI image by digest, `CI=1`, 2 workers, `--cpus=4`, not CI-equivalent; typecheck and lint passed:
         - V1, the ten cases ×5 in WebKit with trace off — the condition that reproduced the failure: 50 passed, every prepared position matching the genuine wheel's in CI;
         - V2, the complete spec once in both engines with CI's normal tracing: 64 passed, 32 per engine.
       - **Negative controls,** once each in WebKit, all failing where intended:
         - **Positioning made a no-op** failed at the scrolled cases' "the prepared position put End ride's slot partly above the viewport" and the Edit copy case's "the same starting position as the control". The reopening case **passed** until its narrow precondition was added, and then failed at it.
         - **A return focus that scrolls back to the pre-opening position** failed at "[behaviour] … moved -465.0 px after the collapse; revealing End ride warrants -103.0 px", and at two implementation checks.
         - **The held-Pause case without its wheel** failed at "[behaviour] End ride did not take focus" and "[behaviour] no focus call returned to End ride".
       - **Still unresolved:** the cause of WebKit's late wheel scrolling, and the first occurrence's form.
       - **Closure, by the rider's decision:** this commit's CI run is recorded, and the item closed and moved to history, in the next scheduled documentation commit, alongside item 146's concluding review.

**The observation as recorded in `current-status.md`, moved here unchanged on 7 October 2026:**

- **Two WebKit cases of `endRidePausedConfirmationReveal.smoke.spec.ts` failed once, on 6 October 2026, and their cause is not established.** "(en, 100%)" and "(de, 100%) scrolled with End ride's slot under the navigation, then Cancel" failed at the test's own precondition, "wheel input put End ride's slot under the navigation", in a combined local run of 164 tests in the CI image on item 139's build. A second identical run passed 164 of 164, the case passed 12 of 12 in isolation on that build and on the baseline, and a combined baseline run showed no such failure. The case concerns the paused panel, whose markup item 139 does not change. The failure's artefacts were overwritten and not inspected. It is not called unrelated or a flake; details are in [item 139's record](items-132-147.md#item-139). **No item number is allocated**; whether it warrants one is the rider's decision. **Update, 7 October 2026:** it stays unnumbered and its cause unknown. Neither the unchanged markup nor the passing reruns make it unrelated or resolved. **A future diagnostic rerun must preserve the existing failure artefacts first** — a separate output directory, or archiving them before rerunning — so that a failure can still be inspected after it has been rerun.

  **A second occurrence, 7 October 2026, with its artefacts kept.** It happened in a combined local run of 229 tests in the CI image, on item 125's build (`index-Df45j2uq.js`), in another case of the same spec: WebKit's "(en, 100%) scrolled with End ride's slot partly above the viewport, then Cancel". It failed at its own precondition, "wheel input put End ride's slot partly above the viewport".
  - **What the artefacts show:** they were kept in a separate output directory and inspected. The failure screenshot shows the paused screen **at its top, with End ride's confirmation open** — when the snapshot was taken, the wheel had not moved the page, or the page had been moved back.
  - **Reruns:** the next identical combined run passed that case, and so did a combined run of the same specs on a build source-equivalent to `0.4.68`.
  - **Against item 125:** that slice adds no scroll loop to this flow, which reaches the paused screen through a route opened from Routes, Start riding and Pause, just as before.
  - **No cause is established.** Nothing here attributes it to item 125 or calls it unrelated.

### CI verification — run 37791383314 (8 October 2026)

Run [37791383314](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37791383314), "Deploy to GitHub Pages" for `0198b2b` — this item's fixture repair — **passed every job**:

| Job              | Whole job |
| ---------------- | --------: |
| Verify and build |     236 s |
| E2E shard 1      |     619 s |
| E2E shard 2      |     784 s |
| E2E shard 3      |     496 s |
| E2E shard 4      |     971 s |
| Deploy           |      13 s |

- **Deployed:** the live site served `0.4.69` / `0198b2b`, with the version unchanged, as intended. `677a03e` remains the phone-accepted build; this test-only change needs no device check.
- **Its timing reports:** retrieved later by the rider and checked for item 146's concluding review ([audit, section 17](../e2e-coverage-runtime-audit.md#17-concluding-review-8-october-2026)):
  - 1,192 cases — 1,187 passed and 5 skipped — on 2 workers per shard;
  - the ten changed cases and the held-Pause wheel case passed in both engines, the reopening case under its new title.
- **Shard 4's 971 s** was 229 s under the limit. **985 s remains the longest shard job recorded, 215 s under.** It is one run: neither a trend nor a cause is claimed.
- **Kept, as recorded above:**
  - the coverage trade-off: the ten cases no longer exercise the browser's wheel scrolling, or focus preservation during wheel input, while their geometry, focus-return and ride-state checks remain;
  - the negative controls, including the reopening case that passed with no-op positioning until its narrow precondition was added;
  - the unresolved cause of headless WebKit's late wheel scrolling.

**Closure.** Item 148 is complete within its approved scope, which was correcting the fixture's preparation. The cause of WebKit's late wheel scrolling, whether tracing affects it, and the first occurrence's form stay unresolved. They were never its closure conditions, and [item 146's conclusion](item-146.md#conclusion-8-october-2026) records when to revisit them.
