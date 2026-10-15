# Item 146 — E2E coverage and runtime audit

**Recorded in its own file for size only.** Item 146 belongs in [`items-132-147.md`](items-132-147.md), between items 141 and 147, where a pointer keeps the numeric order. That file holds about 143,000 characters, and this record would take it past the ~150,000-character soft cap documented in [`README.md`](README.md). This is the only record of item 146, not a second one.

See [`README.md`](README.md) for the full history index, [`../backlog.md`](../backlog.md) for pending specifications, and [`../current-status.md`](../current-status.md) for the manual acceptance ledger.

---

<a id="item-146"></a>

## Item 146 — E2E coverage and runtime audit — done

_Category: End-to-end test suite_

**Status: done — concluded on 8 October 2026** ([conclusion](#conclusion-8-october-2026)).

- **What is complete:** its first investigation slice; its approved timing capture, verified in CI run 37638928929; and items 147 and 148, the separate investigations it prioritised.
- **The concluding review** gave each finding an explicit disposition, from existing evidence only. It changed no test, CI configuration or application code.
- **Where things live:** the entry moved here from `backlog.md` on 8 October 2026. The text below is as it stood there, with its links adjusted for this file, and the conclusion follows it. [The audit report](../e2e-coverage-runtime-audit.md) stays the evidence source.

146. **E2E coverage and runtime audit**
     - **Filed and scheduled on 7 October 2026**, by the rider's decision, first in the approved execution order, ahead of items 103 and 120 ([order](../../../CLAUDE.md)).
     - **Purpose:** to assess the end-to-end suite's distinct regression coverage, execution cost and maintainability **before** any further optimisation or sharding is chosen.
     - **It is an investigation, not approval to delete tests or weaken CI.** There is no test-count reduction target. The E2E job's 20-minute limit, the required CI gate — Deploy needs Verify and build and every shard — the failure evidence [item 116](items-114-117.md#item-116) retains, and meaningful assertions are all preserved.
     - **While investigating:** no retries, no change to global timeouts, no additional shards, no test removal, no production-code change and no new reporting dependency. A reporter or workflow change, if proposed, belongs in the proposal, before any implementation.
     - **The first investigation slice:**
       - an inventory of the spec files and the expanded executable cases by project, parameterised cases and browser duplication included; for each spec or coherent group, the behaviour or regression protected, why it needs browser execution, its language, text-size, viewport and engine combinations, potential overlap, and its runtime evidence where available;
       - an assessment of genuine duplication that does not treat similar-looking tests as interchangeable: browser layout, focus, gestures, real IndexedDB transactions and multi-window races can need browser coverage;
       - candidates to retain, consolidate, move exhaustive logic to component or unit tests, repair, or investigate further, each with a concrete rationale and an account of the coverage that would remain;
       - runtime from existing CI logs, reports and metadata first, compared across several runs, separating test execution from installation, build and other job overhead, test counts from duration, repeatable expensive work from runner variability, and waits genuinely needed to prove behaviour from unnecessary settling;
       - the worker and sharding configuration, without assuming that more workers help software-rendered map tests;
       - fixed waits reviewed individually — autosave observation windows, debounce guards and genuine-touch pacing keep their evidential purpose — and matrix expansion reviewed selectively: German wrapping, enlarged text and WebKit focus behaviour may justify separate cases, pure logic may not need every combination;
       - focused diagnostics in the pinned CI image where necessary, prioritising [item 147](items-132-147.md#item-147) and [item 148](items-148-NN.md#item-148) without implementing their fixes, reusing the existing repetition evidence and preserving failure artefacts in separate output directories before any rerun.
     - **Output:** a linked audit report — the coverage inventory, the available runtime measurements and their limits, prioritised findings, a small proposed first implementation slice with the coverage and CI guarantees it preserves, and whether additional shards are warranted. **The item stays open** while further evidence or approved implementation is needed, and completed investigation is kept distinct from proposed change.
     - **Context:** [item 133](items-132-147.md#item-133)'s four shards; the shard durations under "Monitored, corroborating only" in [`current-status.md`](../current-status.md). [Item 130](../backlog.md#item-130), [item 147](items-132-147.md#item-147) and [item 148](items-148-NN.md#item-148) are separate investigations: the audit may prioritise diagnostics for 147 and 148, but neither absorbs nor fixes them.
     - **Related standard, from the same decision:** a new browser test states briefly its distinct purpose, why it needs browser execution and any relevant overlap with existing coverage (the root [`CLAUDE.md`](../../../CLAUDE.md)'s Engineering standards).
     - **First investigation slice, 7 October 2026 — reported; nothing implemented** ([report](../e2e-coverage-runtime-audit.md)). Measured from per-test durations in the rider-supplied logs of CI runs 37602138083 and 37499907118, cross-checked row by row against the raw logs, and from focused diagnostics in the CI image by digest. Its findings, each a candidate rather than a decision:
       - **No shard change is warranted now.** The longest shard job at head took 806 s, 394 s under the limit; the longest recorded took 967 s (shard 4 of run 37614828755). Each shard spends about 50–60 s before its tests start. Count-based sharding leaves the mixed shard 3 shorter than the others.
       - **Cost is concentrated in the two-engine smoke specs**, about 59 % of summed durations. Their geometry needs the language × size combinations; their state and storage assertions repeat per combination.
       - **Items 147 and 148 now have characterised failure patterns**, still without a cause; see each entry.
       - **Smaller items:** five specs omit the `serviceWorkers: "block"` their map-style helper requires; landscape assertions remain in 12 specs, one holding the only 200 % compaction check; a few Android duplicates; fixed waits mostly evidential; some stale comments.
     - **Proposed first implementation slice, awaiting the rider's review:** keep per-test durations from every CI run, using Playwright's built-in JSON reporter beside `list` and an always-run upload per shard with 7-day retention. _(Corrected by the decision below: uploaded on successful runs and ordinary test failures, not on every run.)_ Test, timeout, retry, worker, shard, failure-evidence and gate behaviour are all unchanged. Later candidates are listed in the report. **The item stays open and first in the order.**
     - **Follow-up, 7 October 2026 — CI run 37614828755's failure repaired, test-only** ([report](../e2e-coverage-runtime-audit.md#13-follow-up-ci-run-37614828755-and-its-repair)).
       - **The failure:** the run on the documentation commit `892a59a` failed one Chromium case, `gradientColouring.spec.ts:1026`, and deployed nothing.
       - **The cause, from its CI trace:** the test helper treated `map-loading` being hidden as readiness while Routes was still showing.
       - **The repair:** the helper now waits for the opened route's `h1` first, with every assertion unchanged.
       - **Its shard 4 took 967 s,** 233 s under the limit, the longest shard job recorded.
       - The JSON timing proposal stays separate and unapproved.
     - **Run 37622132469, 7 October 2026:** it deployed `49547aa` with every job passing — Verify and build 249 s; shards 633, 893, 561 and 763 s; Deploy 10 s. The live site served `0.4.69` / `49547aa`. One run: no trend is claimed. `677a03e` remains the accepted phone build; these test and CI changes need no device check.
     - **Decisions, 7 October 2026, by the rider** ([report](../e2e-coverage-runtime-audit.md#decisions-of-7-october-2026)):
       1. **Timing capture is approved.** Playwright's built-in JSON reporter runs alongside `list`, with separate per-shard artefacts uploaded on successful runs and ordinary test failures, kept for 7 days. Selected baseline reports are kept in the external audit folder for longer comparisons. **Retrieving them still needs authenticated GitHub access**; the benefit is consistent, machine-readable evidence without parsing console logs.
       2. **[Item 147](items-132-147.md#item-147)'s focused assertion repair** is scheduled after timing capture.
       3. **[Item 148](items-148-NN.md#item-148)'s bounded investigation and proposal** is scheduled after item 147. It authorises investigation and a proposal, not implementation.
       4. **The landscape end-to-end checks are kept for now.** Portrait remains the only supported and acceptance-tested orientation. The audit's roughly 38 s covers whole cases, not removable landscape cost. Any later retirement must first move unique coverage, including the 200 % warning-compaction assertion, to portrait. No landscape test changes in this slice.
     - **The sequence:** item 146's timing capture → item 147's assertion repair → item 148's bounded investigation and proposal → item 146's concluding review and dispositions → item 103 → item 120. Item 145 stays unscheduled, with its rider-review checkpoint before item 103 starts. Persistence across app closure stays deferred. The other audit candidates stay candidates, not prerequisites for item 103.
     - **How this item concludes:** with each finding explicitly retained, deferred or tracked separately. Completing every proposed optimisation is not its closure condition, and unresolved reliability findings stay accurately recorded.
     - **Timing capture, implemented 7 October 2026 — configured; first CI run pending** ([record](../e2e-coverage-runtime-audit.md#14-timing-capture-the-implementation-7-october-2026)).
       - **The change:** the E2E job now runs `--reporter=list,json`, with `PLAYWRIGHT_JSON_OUTPUT_FILE=playwright-report/e2e-timing-shard-N.json`.
       - **The upload:** each shard uploads `playwright-timing-<run_id>-<run_attempt>-shard-<n>` when the test step passed or failed in the ordinary way, kept for 7 days, with `continue-on-error` so that it cannot change the deployment gate.
       - **Unchanged:** failure evidence, the exit status and Deploy's `needs`.
       - **Retrieval** needs authenticated GitHub access.
       - **Verified locally only:**
         - the workflow's structure against its parent, with two negative controls;
         - a small selection in the CI image, giving valid JSON with identities, statuses, millisecond durations, annotations and `actualWorkers`;
         - a failure probe outside the suite: failure stays failure, and the trace, screenshot and error context are kept.
       - **Gaps:** the first CI artefacts' contents, until downloaded; a failing run's upload, not yet observed; no artefact on early termination; the reporter's cost, to be compared over a later ordinary run; baselines, still to be downloaded into the audit folder.
     - **Timing capture verified in CI, 7 October 2026** ([record](../e2e-coverage-runtime-audit.md#the-first-ci-run-37638928929)).
       - **The run:** run 37638928929, on `51f1069`, passed every job and deployed. Verify and build took 319 s; the shard jobs 623, 887, 444 and 965 s; their test steps 556, 824, 380 and 903 s; Deploy 49 s. Each shard uploaded its `playwright-timing-37638928929-1-shard-N` artefact, in 1–2 s.
       - **The baseline:** the four reports were retrieved through authenticated GitHub access in a ChatGPT session, then supplied and extracted by the rider into the external audit folder's `ci-timing/`, with a manifest. They stay outside the repository.
       - **Verified from those files:**
         - each report's checksum and size match the manifest, and each archive digest there equals GitHub's published digest;
         - 298 cases per shard, 1,192 overall, one result each: 1,187 passed and 5 skipped (WebKit);
         - two actual workers per shard;
         - finite, non-negative millisecond durations, with identities and annotations present;
         - no unexpected results and no top-level errors.
       - **This closes the first-run content gap only.** Still open:
         - the reporter's own cost;
         - an upload from a failing CI run, still unobserved;
         - no artefact on early termination.
       - **The second timing sample** comes from the next ordinary CI run. No run is triggered for it, and comparing its contents needs another authenticated download.
       - **Landscape checks** are unchanged.
     - **Follow-up, 8 October 2026 — CI run 37748819780's Android failure repaired, test-only** ([record](../e2e-coverage-runtime-audit.md#15-follow-up-ci-run-37748819780-and-its-repair)).
       - **The failure:** run 37748819780, on `827b362`, failed `android-chrome`'s two-finger tap in `androidPlanningTouchPlacement.spec.ts:482`. Shard 3 failed, the other jobs passed, and Deploy was skipped.
       - **The mechanism, confirmed locally:** a contact's `TouchEvent.timeStamp` span follows CDP command arrival, so a slow `touchStart` acknowledgement can stretch a tap past MapLibre's 500 ms limit. That CI's contact exceeded the limit is inferred from its 500.873 ms command interval.
       - **The repair:** explicit CDP timestamps, 40 ms apart, for the two-finger tap only.
       - **Verification:** the case ×5 and the complete spec passed; the overlong-contact and zoom-prevented controls both failed at the second zoom poll.
       - **The failing run's timing upload is now observed and verified from its contents,** which closes that gap. Still open: the reporter's own cost and early termination.
     - **Run 37758419670, 8 October 2026:** it deployed `5c27a37` with every job passing — Verify and build 311 s; shards 689, 782, 428 and 981 s; Deploy 10 s. The live site served `0.4.69` / `5c27a37`; `677a03e` remains the accepted phone build.
       - Every executed test passed, with expected skips permitted. The run's per-test counts stay unverified until its four timing reports, which exist, are inspected.
       - Shard 4's 981 s is the longest shard job recorded, 219 s under the limit. One run: neither a trend nor a cause is claimed.
       - It completed [item 147](items-132-147.md#item-147) within its approved scope. The order is now item 148's investigation and proposal → this item's concluding review → item 103 → item 120 ([order](../../../CLAUDE.md)).

### Conclusion (8 October 2026)

**From existing evidence only.** The conclusion draws on:

- the audit's inventory and coverage review;
- CI per-test durations from the logs of runs 37602138083 and 37499907118, and from the JSON timing reports of runs 37638928929 and 37791383314;
- the focused investigations of items 147 and 148.

No benchmark, full-shard run or new diagnostic was made for it. The evidence, the comparison of the two JSON samples and the shard jobs since the first slice are in [the audit report's section 17](../e2e-coverage-runtime-audit.md#17-concluding-review-8-october-2026). Item 148's reopening-title change is accounted for there when test identities are matched.

**Final dispositions.** "Retained" means kept as it is. "Deferred" means left unchanged, with a stated condition for revisiting it. "Tracked separately" means it belongs to an existing item. No new item number is allocated, and nothing is scheduled ahead of item 103.

| Finding                                                                                                                                                                                | Disposition                                      | Rationale and coverage                                                                                                                                                                                                                                                                                 | Revisit when                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Four shards (F1, sections 10 and 17)                                                                                                                                                   | **Retained**                                     | The longest shard job took 958–985 s in the five most recent runs, 215–242 s under the limit. Each shard job spends 61–68 s outside its test step. The imbalance is structural: count-based sharding leaves shard 4 all WebKit.                                                                        | A monitoring heuristic below fires                                                                        |
| Browser × language × text-size matrices (F2, section 7)                                                                                                                                | **Retained**                                     | Their geometric assertions need the combinations: German wrapping, 200 % text, and WebKit's own focus and scroll behaviour. Removing a combination would remove that coverage.                                                                                                                         | —                                                                                                         |
| State and storage checks repeated within those matrices (F2, section 7)                                                                                                                | **Deferred**                                     | A per-family consolidation pilot could assert engine-independent state once per engine and keep every geometric combination. It needs the family's durations before and after, and the rider's approval per family. Until then, nothing is lost.                                                       | A heuristic fires, or a family is next substantially changed                                              |
| Language pairs that differ only in copy (C6)                                                                                                                                           | **Deferred**, with the pilot                     | German stays wherever geometry is asserted.                                                                                                                                                                                                                                                            | As for the pilot                                                                                          |
| English cases of `germanRidingHeader` (C7)                                                                                                                                             | **Retained**, its limit noted                    | They measure English header fit. They cannot distinguish the compact End label, which reads the same in English.                                                                                                                                                                                       | —                                                                                                         |
| Landscape checks (C4, F6)                                                                                                                                                              | **Retained** (the rider, 7 October 2026)         | Portrait is the only supported and acceptance-tested orientation, but landscape is not deliberately broken. `ridingNextManoeuvre`'s 200 % warning compaction is asserted only in landscape.                                                                                                            | Only before any retirement, after first moving that assertion, and any other unique coverage, to portrait |
| Android near-duplicates (C1, C2, F7)                                                                                                                                                   | **Deferred**                                     | Low projected runtime saving, about 9 s. Their assertions also run in desktop Chromium, and for C2 in WebKit.                                                                                                                                                                                          | Those specs are next edited, or alongside the pilot                                                       |
| The harness's own self-tests (C3)                                                                                                                                                      | **Retained**                                     | Harness logic at about 0.01 s. Moving them to Vitest would be tidiness only.                                                                                                                                                                                                                           | —                                                                                                         |
| Five specs without the `serviceWorkers: "block"` their map-style helper requires (C5, F4)                                                                                              | **Deferred**                                     | A harness-contract repair, with all coverage unchanged. Item 32 measured it halving one flake's rate without removing the flake, so it is not expected to repair anything by itself.                                                                                                                   | Any of the five is next edited, or one fails in a way the service worker could explain                    |
| Evidential fixed waits: debounce and autosave guards, nothing-happens windows, stays-the-same samples, touch pacing, layout-flip windows, the Dexie-timer precondition (F8, section 6) | **Retained**                                     | They are the observation windows behind the assertions.                                                                                                                                                                                                                                                | —                                                                                                         |
| 500 ms MapLibre paint settles (section 6)                                                                                                                                              | **Deferred**                                     | No render-idle signal exists. The wait is also the observation window for zero-pixel assertions, so a replacement needs a paint-completion condition.                                                                                                                                                  | Such a signal is added for another reason, or a paint test fails                                          |
| Five unexplained Planning settles and seven font-change settles (F8)                                                                                                                   | **Deferred**                                     | Identifiable conditions exist (the `data-camera-*` attributes settled, and the computed font size). The projected runtime saving is small.                                                                                                                                                             | The spec is next edited, or flakes                                                                        |
| Stale comments and titles at four sites (F9, C8)                                                                                                                                       | **Deferred**                                     | Documentation only. [Item 138](../backlog.md#item-138)'s maintenance pass is the natural home, if the rider widens it.                                                                                                                                                                                 | That pass                                                                                                 |
| `map-loading` `toBeHidden()` as readiness straight after a click: 142 sites in 50 files (section 13)                                                                                   | **Deferred**, site by site                       | Which sites can race is unknown. A failure traced to one is repaired there with a positive end state, as `49547aa` did. There is no sweep.                                                                                                                                                             | A failure traced to a site                                                                                |
| [Item 147](items-132-147.md#item-147)'s assertion repair                                                                                                                               | **Closed**                                       | Focus is compared by node identity. WebKit's focus fix-up timing is unexplained; the product focus question belongs to [item 135](../backlog.md#item-135).                                                                                                                                             | A failure with a new signature                                                                            |
| [Item 148](items-148-NN.md#item-148)'s fixture repair                                                                                                                                  | **Closed**                                       | The ten setup-only cases are positioned by script, and the held-Pause case keeps its real wheel. Why headless WebKit sometimes applies a wheel's scroll late is unresolved. 16 other specs use wheel input and were not examined.                                                                      | A failure in which a delivered wheel produced no scroll within a settle                                   |
| CDP touch timestamps (section 15): `doubleTap` (`androidPlanningTouchPlacement.spec.ts:460`) and `androidMapCameraGestureRace`                                                         | **Deferred**                                     | They share the exposure of the repaired two-finger tap, and the repair pattern is known (`5c27a37`).                                                                                                                                                                                                   | A CI failure in those cases                                                                               |
| Unresolved reliability observations: [item 130](../backlog.md#item-130), [item 32](../current-status.md#item-32)'s residual sub-case, [item 66](../current-status.md#item-66)          | **Tracked separately**                           | Each keeps its own entry and evidence.                                                                                                                                                                                                                                                                 | Their own triggers                                                                                        |
| Timing capture and its evidence gaps (sections 14 and 17)                                                                                                                              | **Retained**; the gaps are accepted and recorded | The JSON reports give per-test durations from ordinary runs. The gaps: the reporter's own overhead cannot be measured from runs that all used it, no artefact appears on early termination, and retrieval needs authenticated access. The trace's `retain-on-failure` cost stays protected (item 116). | Headroom pressure in which the reporter is a plausible contributor                                        |

**Sharding.** Four shards remain appropriate. Sharding, workers, retries, timeouts and tests are unchanged.

**Monitoring.**

- **Record every ordinary CI run's shard jobs.** Record the completed shard-job durations of every ordinary run, failed workflows included, and mark cancelled or incomplete jobs separately: they have no comparable duration.
- **Retrieve the JSON timing reports when needed:** to diagnose a failure, when a heuristic below fires, or to keep a useful baseline after a material change to the suite. Not every run is downloaded.
- **Heuristics that prompt a review, and nothing more.** They are not validated limits, CI gates or changes to the schedule.
  1. Any shard job of an ordinary run at or above 1,080 s, which is 90 % of the limit.
  2. The longest shard job at or above 1,000 s in two of three consecutive ordinary runs.
  3. A slice that adds smoke-matrix cases states their expected cost in WebKit, which lands mostly in shard 4.
     - Case count alone does not predict headroom. Use relevant measured durations where they exist, and label any projection as an estimate; otherwise record the uncertainty.
     - If shard 4's headroom might fall below about 150 s, raise the question before the slice is accepted.
- **If one fires, weigh three options:**
  - rebalancing the existing four shards, with every configured case still running exactly once;
  - the consolidation pilot;
  - a fifth shard.

  Nothing is chosen or implemented now.

**Closure.** Item 146 is concluded. Every material finding has an explicit disposition above. Completing every possible optimisation was not its closure condition, by the rider's decision of 7 October 2026, and unresolved reliability findings stay recorded where the table says. No further audit candidate is scheduled ahead of item 103. The order is now item 103 → item 120, with [item 145](../backlog.md#item-145)'s review checkpoint before item 103's audit.

**CI of the closing commit, 8 October 2026.** Run 37800024030, for `cdc0529`, which concluded this item, passed every job: Verify and build 251 s; shards 622, 647, 525 and 828 s; Deploy 526 s. The live site served `0.4.69` / `cdc0529`, and `677a03e` remains the accepted phone build. No heuristic above fired, and 985 s remains the longest shard job recorded. Deploy's duration is recorded in [`current-status.md`](../current-status.md) as an observation outside the test shards, with no cause claimed. Nothing in this record — its dispositions, limitations or heuristics — changes.

<a id="runtime-review-14-october-2026"></a>

### Runtime review: heuristic 2, 14 October 2026

**The trigger.** The longest shard jobs of three consecutive ordinary runs were 969, 1,024 and 1,000 s, all in shard 4:

| Run         | Commit    | Result                                      | Longest job |
| ----------- | --------- | ------------------------------------------- | ----------- |
| 38550272618 | `4e2a9b1` | passed                                      | 969 s       |
| 38567715515 | `1a1fb00` | failed, on the imagery race; Deploy skipped | 1,024 s     |
| 38581636998 | `72f1084` | passed; `0.4.71` live                       | 1,000 s     |

That meets heuristic 2. None reached 1,080 s, and the latest left 200 s of headroom. This is a prompt for review, not a breach, a trend or an instruction to optimise.

**The evidence.** The JSON timing reports, four shards for each run, were downloaded and parsed by the rider's reviewer; their figures are attributed to that inspection. The job and step durations come from the public job metadata. No timing run or local suite was made for this review.

| Shard 4             | 38550272618 | 38567715515 | 38581636998 |
| ------------------- | ----------- | ----------- | ----------- |
| Whole job           | 969 s       | 1,024 s     | 1,000 s     |
| "Set up Node.js"    | 6 s         | 6 s         | 27 s        |
| Test-suite step     | 907 s       | 960 s       | 918 s       |
| JSON test phase     | 906.391 s   | 959.101 s   | 916.250 s   |
| Summed test time    | 1,791.208 s | 1,891.225 s | 1,807.776 s |
| Failure upload step | skipped     | about 1 s   | skipped     |

**Summed durations are not elapsed time.** They add up concurrent tests at two workers with `fullyParallel`, so they are not wall-clock time.

**What changed between the two successful runs:**

- **The job and the test phase:** the job grew 31 s, and the test phase only 9.859 s (the suite step 11 s). The other 21 s was the "Set up Node.js" step, at 6 s and then 27 s. Its variation has no established cause.
- **Summed test time grew 16.568 s,** from four parts that agree within 0.3 s:
  - **The seven new refused Screen on WebKit cases** added 55.825 s.
  - **Four existing WebKit cases moved to shard 3**, two from `clearDraftFailure` and two from `coldStartPausedRoute`, removing their baseline 29.530 s. On shard 3 they now sum 24.918 s.
  - **The 291 retained passed cases** went from 1,759.913 s to 1,749.911 s.
  - **The seven Chromium cases** of the new spec landed in shard 2, summing 52.987 s.
- **The failed run:** its first-failing case stopped early, so its work is not that of a complete run. Its failure-evidence upload took about 1 s. CI records traces for every test, passing ones included, and discards them on success, so recording is not a cost peculiar to the failure. Any extra cost of keeping the failing test's evidence falls inside the test step and is unmeasured.

**Where the time goes.** Sharding is by count, in project order, so shard 4 takes the last 303 cases, all WebKit. The suite steps of the latest run, against their allocation:

| Shard | Cases                               | Test-suite step |
| ----- | ----------------------------------- | --------------- |
| 1     | 304 Chromium                        | 630 s           |
| 2     | 304 Chromium                        | 853 s           |
| 3     | 232 Chromium, 46 Android, 25 WebKit | 511 s           |
| 4     | 303 WebKit, five of them skipped    | 918 s           |

- **Engine cost explains part of it.** WebKit's cases are generally slower, and they all fall in shard 4.
- **Per-file cost matters too.** Shards 1 and 2 have the same count and engine, yet their steps differ by 223 s.
- **The 407 s between shards 3 and 4 is an observed imbalance, not an estimate of what rebalancing would save.** Shard 2's 853 s also bounds the overall completion time.
- **The setup:** each shard spends about 70–80 s outside the suite step: containers 25 s, Node 6–27 s, install about 6 s, build about 16 s.

**The conclusion: retain the current configuration and monitor.**

- **Why:**
  - the test phase grew less than 10 s between the successful runs, and most of the job's growth was outside the tests;
  - the new spec's WebKit cost was partly offset by redistribution;
  - 200 s of headroom remains, above the 150 s at which heuristic 3 asks for the question to be raised;
  - one triggering value came from a failed run doing different work.
- **The monitoring rules are unchanged**, including completed shard jobs from failed workflows.
- **No setup change is proposed:** the build and install are small, and the Node step's variation is unexplained.

**An unvalidated option, for a future scoped proposal only.** If a slice's added WebKit cost would bring shard 4's projected headroom below about 150 s, or a heuristic fires again, one option is to rebalance the four shards: the WebKit smoke project would be split into two file-partitioned projects at different points in the project order. Its effect is not estimated here. Validating it would need:

- every case still running exactly once, in its intended engine;
- a check of the project-name dependencies in commands, test behaviour, reports and documentation;
- a temporary allocation experiment against CI per-test durations, then a full CI run.

`PWTEST_SHARD_WEIGHTS` stays not recommended, as the audit found: it is internal and undocumented. No timeout, retry, skip or coverage change is proposed.

<a id="double-tap-timestamps-15-october-2026"></a>

### Follow-up: the double tap's timestamps, 15 October 2026

**The trigger.** The deferred "CDP touch timestamps" row above named a CI failure in `doubleTap` or `androidMapCameraGestureRace` as its revisit condition. Run 38607781112, for the documentation commit `52e03cb`, failed `android-chrome`'s double-tap zoom case: its zoom poll found no change, and Deploy was skipped ([run record](../current-status.md)).

**The CI evidence, from command times.** The rider's reviewer inspected the retained artifact (`playwright-failures-38607781112-1-shard-3`, ID 11916128520). In its trace, the first `touchStart` and `touchEnd` began 55.6 ms apart, the nominal 100 ms gap lasted 416.147 ms, and the second `touchStart` took 232.851 ms to return, so the two `touchEnd` commands began 718.636 ms apart. These are command timings, not DOM timestamps. MapLibre 6.6.0's `TapRecognizer` needs successive tap ends under 500 ms apart by `TouchEvent.timeStamp`, and `doubleTap` sent no timestamps.

**The mechanism, reproduced locally** in the CI image by digest, under `android-chrome`, with two workers and no retries. A harness outside the repository delayed only the helper's await of the first `touchEnd` acknowledgement by 600 ms, after the event had been dispatched. The intervals are differences of DOM `timeStamp`:

| Helper and delay, three runs each | Contact / gap / contact (ms) | Tap ends apart (ms) | Zoom      | Waypoints |
| --------------------------------- | ---------------------------- | ------------------- | --------- | --------- |
| `52e03cb`'s, none                 | 62–71 / 122–179 / 62–307     | 184–486             | changed   | 0         |
| `52e03cb`'s, 600 ms               | 59–61 / 740–762 / 56–107     | 796–869             | unchanged | 0         |
| Repaired, 600 ms                  | 40.0 / 100.0 / 40.0, ±0.1    | 140.0–140.1         | changed   | 0         |

- **Without timestamps,** each event's `timeStamp` followed its command's send, so the late acknowledgement moved the second tap. With the repaired schedule, the commands were still sent 717–765 ms apart across the gap, but the events kept their 0, 40, 140 and 180 ms times.
- **No timestamp lay in the future:** every event's `timeStamp` was at or before its receipt `performance.now()`, the same clock in the same units.
- **The old margin could be small without any delay:** one undelayed run had a 306.5 ms second contact, and tap ends 485.6 ms apart. That is one run, and no rate is claimed.
- No touch or pointer cancellation was recorded.

**The repair, test-only.** `doubleTap` keeps one CDP session, genuine stationary `Input.dispatchTouchEvent`, and its real 40 ms contacts and 100 ms gap. All four events take explicit timestamps from one origin and one schedule, at 0, 40, 140 and 180 ms, each covered by the real waits before it; the session is detached in `finally`. The spec's recorder now also keeps `touchend`, `touchcancel` and `pointercancel`, with each event's `timeStamp`. Before the zoom poll, the test attaches the gesture's input and timing, then checks two contacts, no cancellation, each contact at most 500 ms, and tap ends under 500 ms apart. The original zoom, touch, click and zero-waypoint assertions follow, counting each recorded event once.

**Verification.**

- **Controls on the committed test, with the same 600 ms delay:** with `52e03cb`'s helper restored, it failed at the new check after 4.1 s (tap ends 784 ms apart, against under 500), with the attachment in its report and retained trace. With the repaired helper it passed.
- **Ordinary runs:** the complete spec passed, 8 of 8, and the double-tap case 10 of 10 with retries off. Its contacts were 39.9–40.1 ms, and its tap ends 139.9–140.0 ms apart.
- **Checks:** lint, typecheck and build passed. Production code, MapLibre, thresholds, timeouts, retries and CI are unchanged.

**Still deferred:** `androidMapCameraGestureRace` keeps the same exposure, under the row's existing condition. This repair's own CI run is reported separately.

<a id="headroom-question-15-october-2026"></a>

### The 134-second headroom question and a four-shard rebalancing proposal, 15 October 2026

**Why now.** Run 38746731316, for `7e6246a` (`0.4.72`), passed every job, and shard 4 took 1,066 s: 134 s under the 1,200 s limit, below the ~150 s at which heuristic 3 asks for the question to be raised. Neither formal runtime heuristic fired: 1,066 s is under 1,080 s, and only one of the last three longest shard jobs (978, 988 and 1,066 s) reached 1,000 s. This is a question about headroom, not a breach.

**The evidence.** The rider's reviewer retrieved both runs' JSON timing reports and job metadata, for this run and run 38712502462 (`5354bc6`), as one archive kept outside the repository; the eight reports' SHA-256 checksums match those recorded with them. The experiments also ran outside the repository: `--list` against temporary configurations, with no browser suite or timing run, and one failure-path probe in the CI image.

**What changed between the two runs.** Summed test seconds, with the case counts in brackets. These are observations; no cause is attributed.

| Shard | Summed        | New or rewritten                     | Moved out, then in    | Retained in the same shard | Phase     | Job         |
| ----- | ------------- | ------------------------------------ | --------------------- | -------------------------- | --------- | ----------- |
| 1     | 957 → 1,308   | —                                    | 56 in (4)             | 957 → 1,252 (304)          | 485 → 665 | 541 → 734   |
| 2     | 1,779 → 1,246 | 3 notice tests rewritten: 27.3 → 6.3 | 66 out (4), 33 in (8) | 1,685 → 1,207 (297)        | 899 → 630 | 959 → 692   |
| 3     | 1,008 → 862   | 9 new: 91.3                          | 36 out (8), 18 in (4) | 972 → 753 (295)            | 516 → 439 | 582 → 506   |
| 4     | 1,830 → 1,975 | 9 new: 107.3                         | 33 out (4)            | 1,797 → 1,868 (299)        | 926 → 999 | 988 → 1,066 |

- **Shard 4, as the reviewer found:** the nine new cases added 107.341 s, the four cases moved out had summed 32.753 s, and the retained cases grew by 70.466 s, so 1,830.119 → 1,975.173 s in all. The Playwright phase went from 926.455 to 999.024 s, the suite step from 927 to 1,000 s and the job from 988 to 1,066 s.
- **Two workers:** in every shard of both runs, their busy times differed by under 6 s, and summed ÷ phase was 1.953–1.979. The phase exceeded the busier worker by 6.1–11.0 s, for start-up (the preview server included), the gaps between tests and teardown. Nothing here shows two-worker scaling failing.
- **The retained cases, case by case** (run 2 ÷ run 1, for cases of at least 1 s):
  - shard 1: every case slower, median 1.32, 10th to 90th percentile 1.15–1.49;
  - shard 2: none slower, median 0.70, 0.59–0.86;
  - shard 3: all but one faster, with medians of 0.67 for Android, 0.83 for Chromium and 0.79 for WebKit;
  - shard 4: two thirds slower, median 1.03, 0.94–1.17.

  One direction within each of shards 1–3 is consistent with differences in execution speed between jobs, but the reports do not establish a cause, and the spread within a shard is wide. Shard 4's +70.5 s is a small, mixed shift, and its cause is unestablished.

- **Outside the suite step,** each job spent 56–68 s.
- **The `0.4.72` estimate** ([slice](../backlog.md#item-145-short-map-slice)) forecast about +84 s summed for shard 4. The new and moved cases came to +74.6 s; the retained +70.5 s was not forecast. Within each run, half the summed time described the elapsed time closely; the miss came from the inputs. That corrects a statement made after the deployment, that halving was unreliable. Halving is still not a prediction of future durations, and the retained-case change has no established cause.

**Why shard 4 carries the most.** In Playwright 1.61.1, with `fullyParallel` and no serial blocks or `beforeAll` hooks, every case is its own group. `--shard` takes contiguous runs of equal count, ordered by project, then worker hash, file name and declaration order. Shard 4 is therefore all WebKit: 308 cases summing 1,975 s, against 1,348 s per shard if the work were spread evenly.

**Two candidates.** In both, every case still runs exactly once, with two workers per job; no test, timeout, retry or browser selection changes.

- **A, the WebKit smoke split into two file-partitioned projects** (`playwright.config.ts` only):
  - `webkit-smoke-1`, the smoke specs starting a to o (ten files), comes first;
  - `webkit-smoke-2`, the rest of the smoke selection (19 files), comes last;
  - `chromium` and `android-chrome` sit between them.

  Both parts stay inside `/smoke\.spec\.ts$/` by construction.

- **B, each engine sharded within the same four jobs** (the workflow only):
  - each job runs `--project=chromium --project=android-chrome --shard=k/4`, then `--project=webkit-smoke --shard=k/4`;
  - each run has its own JSON report and `--output` directory;
  - the job fails if either run does.

**The inventory proof.**

- **Method:** a `--list` of the current configuration reproduced run 2's four shards, case for case.
- **Exactly once:** for A and B, the listed shards together hold the 1,232 current cases, none twice and none missing; for B that is eight lists.
- **A's projects:**
  - they map back to `webkit-smoke` by file, and its two parts divide the same 29 smoke files;
  - every project's resolved settings equal today's;
  - a synthetic check showed that no file outside the smoke selection enters either part.
- **B:** its configuration is unchanged.

**Estimates, not predictions.**

- **The method:**
  - a two-worker simulation over the listed order. It reproduced every observed shard's busier worker within 0.5 s, and run 2's four jobs within 5 s;
  - plus 8.8 s for each Playwright run (6.1–11.4 s observed), which covers its own preview server's start and stop;
  - plus 1 s to start each run, and 63 s outside the step (56–68 s observed).
- **B pays the per-run costs twice:** about 10 s more per job.

| Allocation | Heaviest job, summed: run 1 / run 2 / per-case maximum | Its estimate  | Headroom  |
| ---------- | ------------------------------------------------------ | ------------- | --------- |
| Current    | 1,905 / 1,975 / 2,004                                  | 1,026–1,075 s | 125–174 s |
| A          | 1,742 / 1,639 / 1,787                                  | 893–967 s     | 233–307 s |
| B          | 1,669 / 1,555 / 1,702                                  | 865–935 s     | 265–335 s |

- **B with the highest observed overheads:** with 11.4 s per run and 68 s per job, its heaviest job estimates 875–945 s. With the 82 s outside the step seen in run 38581636998, 889–959 s.
- **B's 865–935 s is an estimate awaiting CI confirmation.**
- **Sensitivity checks, neither statistical bounds nor guaranteed headroom:** with run 2's durations, the heaviest job's work was scaled.

  | Heaviest job's work                              | Current | A       | B       |
  | ------------------------------------------------ | ------- | ------- | ------- |
  | ×1.15                                            | 1,209 s | 1,016 s | 982 s   |
  | ×1.31 (shard 1's ratio of sums between the runs) | 1,367 s | 1,147 s | 1,107 s |

- **A growth replay, not a hypothetical addition:** each scheme allocated `5354bc6`'s inventory, then `7e6246a`'s, with run 2's durations. The 18 framing cases and the three rewritten notice tests are counted once, in the second.

  | Allocation | Heaviest job's rise, summed |
  | ---------- | --------------------------- |
  | Current    | +90 s                       |
  | A          | +53 s                       |
  | B          | +28 s                       |

  Under B the nine WebKit cases still landed together, in job 4, which also carries the lightest end of the Chromium work.

**B's failure path, probed in the CI image.** The probe was a single spec that fails in Chromium and passes in WebKit:

- the step exited 1;
- both JSON reports were written;
- the first run's trace, screenshot and error context survived the second run.

A control with one shared output directory lost them. The step behaved the same under `sh -e`.

**Consequences:**

- **For A:**
  - reports name `webkit-smoke-1` and `-2`, so historical comparisons map by file;
  - `--project=webkit-smoke` stops matching;
  - comments in 27 spec files name the old project.
- **For B:**
  - each timing artefact holds two reports, `e2e-timing-shard-N-chromium.json` and `-webkit.json`;
  - failure evidence sits under `test-results/chromium` and `test-results/webkit`;
  - reproducing one CI job locally takes both commands;
  - project names, the configuration and the test comments are unchanged.

**The choice: B.** The rider chose it on 15 October 2026. It gives the largest estimated headroom and changes no project or test. It distributes the existing WebKit workload across the four jobs. Future additions still follow count-based allocation within each engine, so they may land together in one job.

**Its uncertainties:**

- most retained cases ran 0.6–1.5 times as long in one run as in the other;
- within each engine the quarters are still split by count, so B's job 4 runs lighter than the others;
- only a full CI run after implementation can confirm any of it.

A fifth shard and the consolidation pilot remain the alternatives if four-shard rebalancing proves insufficient.

**Implementation, 15 October 2026.** In `.github/workflows/deploy-pages.yml`, each of the four jobs keeps its test step (`id: e2e`), which now runs `--project=chromium --project=android-chrome --shard=k/4`, then `--project=webkit-smoke --shard=k/4`.

- **Failures:** the second run starts even if the first fails, and the step fails if either does.
- **Timing reports:** `e2e-timing-shard-k-chromium.json` and `-webkit.json`, both uploaded in the existing best-effort timing artefact.
- **Failure evidence:** `test-results/chromium` and `test-results/webkit`, uploaded under the existing condition.
- **Unchanged:** `playwright.config.ts`, the two workers, the 20-minute timeout, retries, the container image and Deploy's dependencies.
- **Checks:**
  - the eight commands, taken from the committed workflow, list all 1,232 current cases exactly once, including run 2's five skipped WebKit cases;
  - the committed step matches the probed one;
  - actionlint 1.7.7 reports nothing; shellcheck was not available.

**Status:** implemented; CI confirmation was pending at commit time. The tests, timeouts, retries, Playwright configuration and shard count are unchanged. The evidence is in `~/acn-review/item-146-rebalance/`.
