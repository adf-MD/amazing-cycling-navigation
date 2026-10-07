# E2E coverage and runtime audit — item 146

**Status: open.** This is the record of the audit's **first investigation slice**, carried out on 7 October 2026. It changes no test, no CI configuration and no production code; everything under "Proposals" is proposed only and awaits the rider's review. The item's specification is [`backlog.md#item-146`](backlog.md#item-146); the two WebKit investigations it prioritised are [item 147](backlog.md#item-147) and [item 148](backlog.md#item-148).

Contents:

1. [Scope and what this does not establish](#1-scope-and-what-this-does-not-establish)
2. [Method and evidence](#2-method-and-evidence)
3. [Inventory](#3-inventory)
4. [Coverage review](#4-coverage-review)
5. [Runtime](#5-runtime)
6. [Fixed waits and timeouts](#6-fixed-waits-and-timeouts)
7. [Matrix review](#7-matrix-review)
8. [Focused diagnostics: items 147 and 148](#8-focused-diagnostics-items-147-and-148)
9. [Findings, ranked](#9-findings-ranked)
10. [Are more shards warranted?](#10-are-more-shards-warranted)
11. [Proposals](#11-proposals)
12. [Decisions for the rider, and evidence gaps](#12-decisions-for-the-rider-and-evidence-gaps)
13. [Follow-up: CI run 37614828755 and its repair](#13-follow-up-ci-run-37614828755-and-its-repair)
14. [Appendix: per-spec inventory](#14-appendix-per-spec-inventory)

---

## 1. Scope and what this does not establish

**In scope:** the end-to-end suite as it stands at `7cc9e55` (test sources identical to `677a03e`, `0.4.69`): what each spec protects, why it needs a browser, its combinations, overlap with other coverage, and what it costs in CI; the worker and shard configuration; fixed waits; and focused diagnostics for items 147 and 148.

**Constraints observed throughout:** no test-count target; the E2E job's 20-minute limit, the required CI gate (Deploy needs Verify and build and every shard), item 116's failure evidence and meaningful assertions are all preserved. No retries, global timeout change, extra shard, test removal, production change or new reporting dependency was made.

**Not established by this slice:**

- **Trends.** Two runs' per-test durations cannot establish a trend, or separate machine, workload and application effects.
- **CI behaviour under other worker counts.** Every supplied CI job ran 2 workers; nothing here measures 3 or 4.
- **Causes for items 147 and 148.** Section 8 narrows both mechanisms; neither cause is established.
- **That any candidate below is safe to act on.** Each is a candidate with its rationale and the coverage that would remain; none is approved.
- **Anything about the installed iPhone.** All evidence here is from browsers in CI or in the CI image.

---

## 2. Method and evidence

**Suite inventory.** `CI=1 npx playwright test --list --reporter=json`, overall and with `--shard=N/4`, at `7cc9e55`. It needs no web server. Each spec's first commit is from `git log --diff-filter=A`.

**CI per-test durations.** The rider supplied, for this audit, all four E2E job logs of two runs, retrieved through an authenticated GitHub connection, with CSV extracts of the list reporter's per-test durations. They are kept outside the repository and are not committed; this report cites them by run and job ID.

| Run         | Build                | Job IDs (shards 1–4)                                   | Scheduled | Passed | Skipped |
| ----------- | -------------------- | ------------------------------------------------------ | --------: | -----: | ------: |
| 37602138083 | `0.4.69` / `677a03e` | 112728809657, 112728809676, 112728809959, 112728809662 |     1,192 |  1,187 |       5 |
| 37499907118 | `0.4.68` / `9334b25` | 112393950786, 112393950560, 112393950798, 112393950762 |     1,171 |  1,166 |       5 |

- **Cross-check, completed:** every one of the 2,353 CSV rows matched its own log line — project, spec, title and reported duration — and per-shard counts match each log's summary. The 5 skipped cases per run, all in shard 4, are taken from the logs: four WebKit cases of `planningWarningMapReveal.smoke.spec.ts` (lines 1094, 1116, 1141, 1179) and the Chromium-only mouse-click case of `statusConnectionResultReveal.smoke.spec.ts` (line 979). They have no duration.
- **Rounding:** the list reporter prints `N.Ns` at one second or more (2,104 rows) and whole milliseconds below (249 rows). These are elapsed test durations, not CPU time, and include each test's own setup.
- **Concurrency:** every one of the eight job logs reports 2 workers ("Running 298 tests using 2 workers" at head; 292 or 293 tests at `0.4.68`). The configuration leaves `workers` unset, so the count is the runner's default, recorded here from the banners rather than assumed for every future runner.

**Job and step metadata.** Run 37602138083's jobs, read once from the GitHub API. Earlier runs' shard durations come from what the project docs already record; no further API request was needed.

**Coverage summaries.** Six read-only agents summarised the 93 specs against a fixed schema: behaviour protected, the specific browser behaviour or integration boundary, dimensions, fixed waits, unit counterparts and overlap. Every overlap, duplication or wait claim this report relies on was then checked against the source by hand; claims not re-checked are not used as findings.

**Local diagnostics.**

- **Image:** the CI image by digest, `mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48`.
- **Build:** the existing `dist/`, bundle `index-Df45j2uq.js`. A fresh scratch build at head produced the identical bundle name, so it is source-equivalent to `677a03e`.
- **Probes:** instrumented copies of the two specs, generated outside the repository and never committed; nothing was added to `e2e/`. Each run wrote to its own output directory, with trace off as in the local runs whose failures were being examined.
- **Concurrency** is recorded from each run's banner.
- **The earlier failure artefacts** from item 125's verification were copied, unchanged, into a durable audit folder beside the supplied logs before anything was rerun. New outputs are kept there too.

---

## 3. Inventory

**At `7cc9e55`: 1,192 executable cases in 93 spec files.**

| Project          | Matches                                                                   | Files | Cases |
| ---------------- | ------------------------------------------------------------------------- | ----: | ----: |
| `chromium`       | every spec except `android*` (including the two `e2e/support` self-tests) |    81 |   829 |
| `webkit-smoke`   | `/smoke\.spec\.ts$/`: 25 `*.smoke.spec.ts` plus the plain `smoke.spec.ts` |    26 |   317 |
| `android-chrome` | `/android.*\.spec\.ts$/`, Pixel 7 emulation in Chromium                   |    12 |    46 |

- **WebKit duplication.** Every smoke spec runs in both Chromium and WebKit: 26 files, 317 WebKit cases, of which 5 are skipped by design (above).
- **Shards.** `fullyParallel` with `--shard=N/4` splits by count: 298 cases each. Shards 1 and 2 are all Chromium; shard 3 is 233 Chromium, 46 Android and 19 WebKit; shard 4 is 298 WebKit.
- **Growth, for context only.** Item 133 recorded 792 cases in 77 files on 2 October 2026 (622 Chromium, 124 WebKit, 46 Android). The WebKit project has grown from 124 to 317 cases since. No duration claim is drawn from that.
- **Parameterisation.** 62 loops generate tests in 28 files, in four idioms: full `LANGUAGES × TEXT_SIZES` cross products; hand-picked case tables (for example `SCROLLED_CASES`); width × language grids; and loops inside a single test. Their dimensions are reviewed in [section 7](#7-matrix-review).
- **Origin.** 23 specs first added on or after 1 October 2026 hold 568 of the cases; 27 added in September hold 318; 43 older specs hold 306. A spec counts by its first commit, so cases added later to an older spec count with that spec.

The per-spec table is in [the appendix](#14-appendix-per-spec-inventory).

---

## 4. Coverage review

The review asked of each spec what it protects, and what in it actually needs a browser. A category such as "layout" or "network" was not accepted as a reason by itself; the summaries name the specific boundary, and the appendix table carries one line per spec.

### What genuinely needs a browser

Most of the suite tests behaviour that jsdom cannot reproduce, at a named boundary:

- **Real layout and geometry**, against sticky chrome, `visualViewport` and the resolved safe-area property: the reveal and confirmation specs, the fit specs, the Planning map-area specs. Line counts and clipping are measured with `Range`, natural widths with `max-content` clones, hits with `elementFromPoint`.
- **The browser's own focus and scroll behaviour.** The native focus scroll, scroll anchoring and clamping, focus loss when a focused control is disabled (which differs between Chromium and Linux WebKit, and which jsdom never reproduces), `:focus-visible`, and native `<details>` and `<select>` keys.
- **Real IndexedDB transactions.** Held read-write transactions that queue the app's own write behind them, aborts at issue, Dexie's live-query cache eviction, two pages sharing one database, and reloads across documents.
- **MapLibre.** Real WebGL paint read back as pixels (layer order, colours, arrows, badges), the camera transform after real keyboard and touch gestures, style and tile failure and recovery, and the map worker loading a route.
- **Real input pipelines.** Genuine touch through CDP with Chromium's tap slop, pinch and pen; the WebKit quirk that labels a touch-generated click `mouse`; real wheels and keys.
- **Platform integration.** The enforced CSP, the service worker serving the shell offline, real download and file-input events, and real geolocation delivery through `watchPosition` (item 32's commit coalescing is a browser-and-React effect).

### Where a spec's assertions do not depend on the browser

The summaries also found assertions that are pure state or logic, already covered by unit tests: dialog text, `aria-pressed`, stored-row equality, request counts, sort order. That is ordinary in an end-to-end test that drives a real flow, and it is not by itself a reason to change anything. It matters only where a whole spec, or a whole matrix dimension, adds nothing a browser contributes. Those cases are listed below and in section 7.

### Verified candidates

Each was checked by hand against the source.

| #   | Candidate                                                                                                                  | Evidence                                                                                                                                                                                                                                                                                      | Coverage that would remain                                                                                                                                       | Disposition                              |
| --- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| C1  | `androidPlanning.spec.ts` (7.9 s)                                                                                          | Same title, clicks (100,100 / 200,150) and captured-URL check as `planning.spec.ts:265`, which also asserts the surface rows and more. No assertion reads the viewport, touch or device scale factor.                                                                                         | `planning.spec.ts:265` in desktop Chromium; Planning at phone width in `planning.spec.ts`'s 390 px describe; touch placement in `androidPlanningTouchPlacement`. | Consolidate (low value)                  |
| C2  | `androidCspEnforcement.spec.ts` (0.6 s)                                                                                    | Its assertions are those of `csp.smoke.spec.ts`'s "blocks and reports a forbidden inline script", which runs in Chromium and WebKit; only the device preset differs.                                                                                                                          | The same test in both desktop engines.                                                                                                                           | Consolidate (low value)                  |
| C3  | `e2e/support/csp.spec.ts`, `e2e/support/localMapStyle.spec.ts` (14 cases, about 0.01 s)                                    | Pure logic; no test requests a page. They test the harness, not the product.                                                                                                                                                                                                                  | Unchanged, if moved to Vitest; or left as they are, since they cost nothing.                                                                                     | Retain, or move for tidiness only        |
| C4  | **Landscape assertions** in 12 specs (steps inside cases that together take about 38 s; not the landscape steps' own cost) | Short landscape is retired as an acceptance requirement, but not deliberately broken. In `ridingNextManoeuvre.spec.ts` the compaction of the untrusted-GPX warning at 200 % text is asserted only after the resize to 844×390 (line 880); portrait at 200 % asserts only horizontal overflow. | If landscape blocks are retired, the 200 % compaction must first be asserted in portrait, or it is lost.                                                         | Retained for now — rider, 7 October 2026 |
| C5  | Five specs use `installLocalMapStyle` without the `serviceWorkers: "block"` its documentation says callers must add        | `androidFreeRoam`, `ridingLauncher`, `ridingOutAndBackTurnaround`, `ridingShortTurnaroundWalkingPace` and `settings`. Item 32 measured that adding it halved one flake's rate, without removing the flake.                                                                                    | All coverage unchanged; the harness contract would hold everywhere.                                                                                              | Repair (small)                           |
| C6  | German × English pairs where language changes only the locator copy                                                        | For example `editCopyBusyState`'s navigation pairs, `ridingPauseAfterResume`, `coldStartPausedRoute`'s state tests, and `screenScrollRestoration.smoke`'s first test (the switcher geometry does depend on German).                                                                           | German's wrapping and geometry cases stay wherever geometry is asserted.                                                                                         | Investigate per family (section 7)       |
| C7  | `germanRidingHeader.spec.ts` English cases                                                                                 | English `ride.endRideCompact` equals `ride.endRide` ("End ride"), so English cases cannot tell the compact label from the full name. They still measure English header fit.                                                                                                                   | Unchanged if kept; this is a statement of what they prove.                                                                                                       | Retain, with the limit noted             |
| C8  | Comments and titles that no longer match the code                                                                          | See finding F9.                                                                                                                                                                                                                                                                               | Unchanged.                                                                                                                                                       | Repair (documentation-level)             |

**Not candidates, although similar-looking.** These were examined and are not interchangeable:

- **`planningTouchPlacement.smoke` and `androidPlanningTouchPlacement`.** Only the smoke spec reaches WebKit. Only the Android spec drives genuine CDP touch: tap slop, beyond-slop pans, double-tap, pinch and pen.
- **`confirmationReveal.smoke` and `confirmationRevealSettled`.** They share surfaces. One asserts reveal geometry in both engines; the other asserts frame-level drift, with a CPU throttle that only Chromium supports.
- **`screenScrollRestoration.spec` and its smoke spec.** The smoke spec's switcher-held-still, German and post-restore reveal checks exist nowhere else. The spec's Plan, Ride, held-estimate, wheel, prompt and reload checks run only in Chromium.
- **`settingsStatusSwitcher.spec` and its smoke spec.** The smoke spec's WebKit Save-press anchoring check has no counterpart.

---

## 5. Runtime

### Where a shard job's time goes

From run 37602138083's job and step metadata, and its job-log timestamps (seconds):

| Shard | Whole job | Before the test step | Test step | Step start → "Running" banner | Banner → last result | Cases (C/W/A) |
| ----: | --------: | -------------------: | --------: | ----------------------------: | -------------------: | ------------- |
|     1 |       714 |                   61 |       647 |                           5.6 |                641.2 | 298/0/0       |
|     2 |       806 |                   61 |       739 |                           4.6 |                732.7 | 298/0/0       |
|     3 |       520 |                   61 |       451 |                           5.1 |                446.2 | 233/19/46     |
|     4 |       742 |                   51 |       686 |                           4.3 |                681.2 | 0/298/0       |

- **Before the test step** — container start (26–32 s), checkout, Node set-up, `npm ci` (5–9 s) and the build (11–17 s) — about 50–60 s per shard. The preview server starts within about 5 s of the step.
- **Verify and build** took 253 s, its unit-test step 141 s; Deploy took 10 s. Neither is on the E2E path: the E2E jobs do not wait for Verify.

### Summed durations

Summed reported durations at head: 4,968 s — Chromium 3,245 s (829 cases), WebKit 1,461 s (312 run), Android 262 s (46). These are concurrent durations and are **not** wall-clock time.

- **An aggregate consistency check, not proof of continuous saturation:** each shard's summed durations divided by its two workers comes within about 10 s of its banner-to-last-result time (1,274/2 against 641 s; 1,459/2 against 733 s; 881/2 against 446 s; 1,353/2 against 681 s).
- **Where the cost concentrates:**
  - the 26 smoke specs: 2,946 s (Chromium 1,485 s, WebKit 1,461 s), about 59 %;
  - the 23 specs first added since 1 October 2026: 2,720 s, about 55 %.
- **Per project, observed statistics** (head run): Chromium median 3.1 s, 5th percentile 0.69 s, 90th 7.5 s; WebKit median 4.2 s, 5th percentile 1.9 s, 90th 8.0 s; Android median 5.1 s. These are descriptions of one run, not a floor or a bound on what consolidation could save.

### The costliest tests and specs, from CI durations

- **Slowest single case in both runs:** `planningEnlargedTextScrollbar.spec.ts:88`, 48.8 s at head (48.3 s at `0.4.68`). About 40 s of it is fixed waiting inside a 31-step viewport sweep ([section 6](#6-fixed-waits-and-timeouts)).
- **Next slowest at head:** `lowZoomLegibility.spec.ts:148` 24.3 s, `ridingActiveDirectionLayering.spec.ts:287` 24.9 s, `androidPlanningTouchPlacement.spec.ts:581` 24.9 s, `planningPlacementControlLayering.spec.ts:679` 19.8 s, `ridingShortTurnaroundWalkingPace.spec.ts:189` 19.6 s, `planning.spec.ts:2560` 19.3 s. The same tests rank similarly in both runs.
- **Costliest spec × project at head:** `endRidePausedConfirmationReveal.smoke` 170 s Chromium and 127 s WebKit; `planningEnlargedTextLayout.smoke` 154 s WebKit and 100 s Chromium; `clearDraftFailure.smoke` 131 s and 132 s; `germanRidingHeader` 118 s (44 cases); `planning` 111 s; `routeDeleteFailure.smoke` 105 s WebKit and 81 s Chromium.

### The two runs compared

For 1,163 identities present in both runs, the median ratio of head to `0.4.68` duration was:

| Project  | Head shard | `0.4.68` shard | Cases ≥ 1 s | Median ratio | Interquartile range |
| -------- | ---------: | -------------: | ----------: | -----------: | ------------------: |
| Chromium |          1 |              1 |         263 |         1.35 |           1.24–1.46 |
| Chromium |          2 |              2 |         276 |         1.06 |           1.02–1.12 |
| Chromium |          3 |              3 |         131 |         1.04 |           1.00–1.10 |
| Android  |          3 |              3 |          41 |         1.08 |           1.00–1.12 |
| WebKit   |          3 |              3 |          19 |         1.07 |           1.04–1.09 |
| WebKit   |          4 |              4 |         282 |         0.77 |           0.69–0.84 |

- **Consistent with run-to-run variation, not a demonstration of it.** The same tests ran slower on one job and faster on another between the two runs. That fits job-to-job variation, but two runs cannot isolate machine, workload and application effects, and these ratios are descriptive, not measured properties of any runner.
- **Engine and machine are confounded.** Each shard runs on its own VM, and shards 1, 2 and 4 are single-engine. Only shard 3 mixes all three projects on one machine.
- **Recorded runner images differ.** At head, shards 1 and 3 ran on runner image `20260927.320.1` (provisioner `20260901.588`, Azure region `centralus`), and shards 2 and 4 on `20261004.327.1`; every `0.4.68` job ran on `20261004.327.1`. The tests themselves run inside the pinned container either way. No effect is attributed to the image.

### Shard durations recorded in the project's docs

Whole jobs, in seconds; no trend is drawn from them.

| Run         | Build              | Shards 1–4            | Longest | Under the 1,200 s limit by |
| ----------- | ------------------ | --------------------- | ------: | -------------------------: |
| 37055399688 | `75094b0`          | 398 / 523 / 352 / 512 |     523 |                        677 |
| 37068927716 | `501e1d4`          | 433 / 524 / 350 / 491 |     524 |                        676 |
| 37434895346 | `1d59d95`          | longest recorded only |     877 |                        323 |
| 37448703698 | `351ae8f`          | longest recorded only |     819 |                        381 |
| 37461451985 | `c2cb9e6`          | 671 / 864 / 461 / 926 |     926 |                        274 |
| 37483537843 | `964f585` (failed) | shard 4 recorded      |     963 |                        237 |
| 37491370472 | `9f73242`          | 692 / 765 / 525 / 719 |     765 |                        435 |
| 37499907118 | `9334b25`          | 542 / 753 / 484 / 954 |     954 |                        246 |
| 37602138083 | `677a03e`          | 714 / 806 / 520 / 742 |     806 |                        394 |
| 37614828755 | `892a59a` (failed) | 525 / 802 / 550 / 967 |     967 |                        233 |

### Configuration

- `workers` unset; every supplied CI job used 2 workers.
- `fullyParallel`, sharded by count.
- `retries: 0`.
- Trace `retain-on-failure` in CI only. Item 116 measured that as a 23–28 % per-test cost. It is a **protected cost**: it pays for the failure evidence CI otherwise discards, and it is not proposed for removal.
- Playwright 1.61.1 has an internal `PWTEST_SHARD_WEIGHTS` environment variable for weighted sharding. It is undocumented and unsupported, and it is not recommended.
- Nothing here measures whether more workers per shard would help software-rendered maps, and nothing assumes it.

---

## 6. Fixed waits and timeouts

**80 `page.waitForTimeout` calls in 28 files**, each classified by its stated or evident purpose:

| Class                                                                                 | Sites | Examples                                                                                                                                                     | Disposition                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Debounce or autosave guard, past Planning's 900 ms autosave or recalculation debounce |    18 | `editCopyBusyState` (2,000 ms), `planning`/`editRouteAsPlanningCopy`/`editCopyNotice` (1,200 ms), `reverseRoute` (3 × 1,200 ms), the touch-placement settles | **Evidential: keep.** A few could poll the stored draft instead (`planning.spec.ts:463`, `:610`; `editRouteAsPlanningCopy.spec.ts:447`), where the purpose is "it was written", not "nothing else happened".                                                                |
| Nothing-happens observation windows                                                   |    11 | `planningWarningMapReveal` 2,200 and 1,500 ms; `mapImageryRecovery` 1,000 ms; `editCopyNotice` 2 × 1,000 ms                                                  | **Evidential: keep.**                                                                                                                                                                                                                                                       |
| Repeated-sample "stays the same" loops                                                |    12 | `coldStartPausedRoute`, `ridingPauseAfterResume` and `resumeDuringEndRide` watch-count windows; draft-unchanged windows                                      | **Evidential: keep.**                                                                                                                                                                                                                                                       |
| Touch or drag pacing                                                                  |    17 | `androidPlanningTouchPlacement` 40 ms steps and 600 ms between taps (MapLibre's double-tap window); 150–300 ms drag holds                                    | **Evidential: keep.**                                                                                                                                                                                                                                                       |
| MapLibre paint and placement settle, 500 ms                                           |     4 | `gradientColouring.spec.ts:170` (12 call sites, one inside a poll), `directionArrows`, `ridingActiveDirectionLayering`, `planning.spec.ts:998`               | **Investigate.** The wait is also the only observation window behind several zero-pixel-count assertions, so a replacement must keep a paint-completion condition. MapView exposes no render-idle signal today.                                                             |
| Settle after opening Planning, 500 ms, unexplained                                    |     5 | `reverseRoute.spec.ts:139`, `:228`, `:627`; `clearPlanningDraft.spec.ts:153`; `editRouteAsPlanningCopy.spec.ts:177`                                          | **Candidate:** an identifiable condition exists (`data-camera-*` settled).                                                                                                                                                                                                  |
| Settle after a root-font change, 150–300 ms                                           |     7 | `setRootText` in five smoke specs (followed by a scroll-quiet settle); two 300 ms waits after a font change                                                  | **Candidate:** the computed font size can be read back; low value (under 2 s per spec).                                                                                                                                                                                     |
| Layout-flip counting                                                                  |     5 | `planningEnlargedTextScrollbar.spec.ts:129`, `:148`, `:150`; `planningMapArea.smoke.spec.ts:865`, `:869`                                                     | **Mostly evidential.** In the scrollbar sweep, each step's 800 ms window proves no ongoing flips, and the original defect flipped 21–25 times in 800 ms. Only each step's 500 ms settle could be conditional; the 10 px step size is what finds the 20 px oscillation band. |
| Library-timer precondition                                                            |     1 | `routeDeleteFailure.smoke.spec.ts:1354`, 3,600 ms past Dexie's live-query cache eviction                                                                     | **Evidential: keep**, as documented in the [D-02 report](../design/reveal-inventory/d-02-delete-lifecycle.md).                                                                                                                                                              |

That accounts for all 80. Seconds of fixed waiting per run are small next to the per-test setup — importing a GPX, starting a ride, waiting for the map — that most specs repeat per case. The one exception is the scrollbar sweep, about 40 s in one case, mostly evidential.

**Timeouts.** There are 58 `test.setTimeout` overrides: 32 at 90 s, 24 at 120 s, one at 150 s and one at 180 s. Many sit inside loops. No CI case came near them: the slowest was 48.8 s, under its own 180 s budget.

**Engine skips.** `planningWarningMapReveal` skips 4 cases in WebKit; `statusConnectionResultReveal` skips its mouse-click case in WebKit.

---

## 7. Matrix review

These families carry most of the cost. For each, the question is which assertions actually depend on each dimension. That is answered from the source; nothing here is proposed for removal by this slice.

| Family                                  | Cases (C+W) | CI Σ s | Dimensions                                           | Depends on the dimension                                                    | Does not                                                                                                                                                                                                                                                        |
| --------------------------------------- | ----------: | -----: | ---------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endRidePausedConfirmationReveal.smoke` |     32 + 32 |    297 | language × size × placement; cold start; transitions | Geometry (band, slot placement, minimal reveal), at 100/200 % and in German | "still paused", stored row and watch counts (identical across cases). Which of the four opening branches a case exercises is annotated, not asserted. Escape is used only for de/100 % and en/200 %, so the cancel method is confounded with language and size. |
| `clearDraftFailure.smoke`               |     23 + 23 |    263 | en/de × ordinary/200 % on four tests                 | The reveal (recomputed from each run's geometry, accepting zero)            | The moved-on assertions, identical for every combination                                                                                                                                                                                                        |
| `planningEnlargedTextLayout.smoke`      |     21 + 21 |    254 | 3 sizes × en/de × message state; dark scheme         | Every collision, contrast and hit-test assertion                            | In the "none" message state, the Retry, stability and message assertions are vacuous                                                                                                                                                                            |
| `editCopyBusyState.smoke`               |     25 + 25 |    204 | en/de on five tests; 200 % once                      | Geometry only where measured (two tests, plus the 200 % case)               | The navigation and Plan-opened pairs assert identical logic with translated labels                                                                                                                                                                              |
| `routeDeleteFailure.smoke`              |     27 + 27 |    186 | en/de × ordinary/200 % on four tests                 | Band geometry; whether the fit or oversized branch is taken is annotated    | Copy-only differences between languages                                                                                                                                                                                                                         |
| `statusConnectionResultReveal.smoke`    |     24 + 23 |    186 | 7 geometry cases, plus single cases                  | 200 %, the inset and wrapped line height                                    | Language and outcome change only the expected text (`de 401` and `de network` differ only in text length)                                                                                                                                                       |
| `confirmationReveal.smoke`              |     14 + 14 |    176 | en/de × 100/200 % on both surfaces                   | Geometry and branch (annotated)                                             | Library and draft unchanged                                                                                                                                                                                                                                     |
| `germanRidingHeader`                    |          44 |    118 | 4 widths × en/de × stress × mode, plus single tests  | Fit and stillness geometry                                                  | English cannot distinguish the compact End label (C7)                                                                                                                                                                                                           |
| `settingsStatusSwitcher`                |          31 |     34 | widths × en/de × size × stress                       | Fit and stacking predicate                                                  | The unsaved-key test's language pair                                                                                                                                                                                                                            |

**What follows, as observation rather than recommendation.** The geometric assertions in these families genuinely need the language × size combinations: German wrapping, enlarged text and WebKit's own focus and scroll behaviour are why they exist. Their state and storage assertions do not, and they repeat per combination. A future consolidation slice could keep every geometric combination while asserting the engine-independent state once per engine. That would need each family's per-case durations measured before and after, and the rider's approval per family.

---

## 8. Focused diagnostics: items 147 and 148

The existing evidence was reused: item 147's 60-repeat rates (20/60 on item 125's build, 18/60 on the `0.4.68` baseline) were not re-measured. New runs were bounded and recorded with their concurrency. **Neither cause is established.**

### The earlier combined runs, accounted for

The combined local runs of 7 October 2026 were re-read from their preserved logs.

**`e2e-smoke-1`** (on the log banner, "Running 230 tests using 36 workers"; 224 passed, 5 failed, 1 skipped). All five failures were in WebKit:

1. `endRidePausedConfirmationReveal.smoke.spec.ts:1041`, "(en, 100%) scrolled with End ride's slot partly above the viewport, then Cancel: only the movement that reveals End ride", at its precondition: **item 148's second occurrence.**
2. `statusConnectionResultReveal.smoke.spec.ts:953`, the Enter case: expected "BUTTON:Test routing connection" to be in `["BUTTON:Testing…", "body"]`. **Item 147.**
3. `screenScrollRestoration.smoke.spec.ts:168`, "(en) Settings and Status keep their own positions in both directions, with the switcher held still";
4. the same test in German;
5. `screenScrollRestoration.smoke.spec.ts:200`, "(en) Routes and Settings each come back where they were left, in both directions".

**The three `screenScrollRestoration.smoke` failures (3–5)** were all at a `scrollY` poll in `expectBackAt`. The log places that poll at lines 158–161. In the committed spec those lines hold `settleFrames` (lines 155–175), and `expectBackAt` begins at line 186. That spec was new in item 125 and was revised before its commit. **So the run used an earlier, uncommitted revision of item 125's own new spec, from before its animation-frame settle was added.** Item 125's record describes that settle as the harness finding for headless WebKit's deferred frames. That is consistent with these failures, but the failures were not themselves recorded. They are not items 147 or 148, and no cause beyond that is claimed.

**The next identical run, `e2e-smoke-2`,** had one failure: item 147's Enter case (228 passed).

**The combined baseline run, `e2e-smoke-base-1`,** on a build source-equivalent to `0.4.68`, had four failures. Two were the late-Edit-copy case in each engine, stopping at "the click point is inside the viewport", and two were the Open-saved-route case in each engine, with Routes at 734 px instead of 0. Both are item 125's new checks failing on the build before item 125, exactly as its record states.

### Item 147 — the Status connection-result Enter/focus check

**The assertion.** `measure()` records `active` as `body` or the focused element's tag with its `aria-label` or first 30 characters of text. The button has no `aria-label`, and its label changes from "Testing…" while the request is held to "Test routing connection" when it is re-enabled. `before` is taken just after the button becomes disabled, `after` once the result line has come to rest.

**The probe.** An instrumented copy of the Enter case marks the focused button with a data attribute before Enter, and records:

- whether the focused element is the same node at both snapshots;
- the button's disabled state and `document.hasFocus()`;
- every `focusin` and `focusout`;
- each change to the button's `disabled` attribute and text.

Its timing differs from the original by one extra page evaluation before Enter, not between Enter and the first snapshot.

| Batch                                                                                                 | Concurrency (from the banner)       | Result                  | At failure                                                                                                                                                                              | In passes                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| D1a, instrumented × 30                                                                                | 30 tests on 30 workers, 72-CPU host | **3 failed**, 27 passed | In all three, the focused element at both snapshots was **the same button node**. No `focusout` was logged. The button was disabled at `before` and re-enabled, relabelled, at `after`. | 24: focused at `before`, then a `focusout` from the button before it was re-enabled, so `body` at `after`. 3: already `body` at `before`. |
| D1b, instrumented × 30 — **a controlled comparison, not CI-equivalent** (trace off, a different host) | 2 workers, `--cpus=4`               | 0 failed, 30 passed     | —                                                                                                                                                                                       | 26: already `body` at `before`; 4: a `focusout` between the snapshots.                                                                    |

**What this establishes.**

- In every failure observed under instrumentation, **focus did not move.** The button kept focus through being disabled and re-enabled, and the text comparison failed only because the label changed. That matches the test's own `[behaviour]` intent, "the reveal moved focus nowhere".
- The failures occurred when Linux WebKit's deferred focus fix-up did not run before the button was re-enabled. In the failing example the button was re-enabled about 100 ms after being disabled.

**What it does not establish.**

- That every historical failure had this form: the 60-repeat failures were not instrumented.
- Why the fix-up is sometimes later than re-enabling.
- That a product change is needed. Item 135 holds the product question of a disabled control's focus. This item concerns what the assertion measures.

### Item 148 — the paused-End confirmation scroll preconditions

**The precondition.** Each scrolled case opens End ride's confirmation and computes a wheel delta from the open snapshot. It then calls `wheelBy`, which finds a point outside the map, moves the mouse there, sends one `mouse.wheel(0, dy)`, and waits for 300 ms without `scrollY` changing (at most 5 s). Finally it asserts that the confirmation's top lies in the case's band.

**The kept artefact** from the second occurrence (screenshot and `error-context.md`, no trace) shows the paused screen at its top with Cancel focused in the open confirmation.

| Batch                                                                  | Concurrency (from the banner) | Result                  | What failed                                                                                                         |
| ---------------------------------------------------------------------- | ----------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| D2a, the unmodified 8 WebKit scrolled cases × 5, JSON reporter         | 40 tests on 36 workers        | **3 failed**, 37 passed | Three different cases (en/100 % under the navigation; en/100 % partly above; en/200 % wholly above, an Escape case) |
| D2b, instrumented × 5                                                  | 40 tests on 36 workers        | **2 failed**, 38 passed | en/100 % partly above; en/200 % under the navigation                                                                |
| D2c, instrumented × 5 — **a controlled comparison, not CI-equivalent** | 2 workers, `--cpus=4`         | **6 failed**, 34 passed | All six had the same pattern as D2b's failures                                                                      |

**What the runs show.**

- **D2a's JSON annotations** (the spec's own `placed` note, which the list reporter discards): every pass put the confirmation exactly at its target — 35, −20, 82, 51, −84 or −102 px by case. Every failure left it **exactly where it was before the wheel** (445 px at en/100 %, 190 px at en/200 %). In none of these failures did the wheel move the confirmation short of its target.
- **D2b's probe** records listeners only, without requesting animation frames: the page's scroll extent and `scrollY` before the wheel, every `wheel` event, every `scroll` event, and `scrollY` straight after the wheel and after the settle. In both failures:
  - the document received exactly one cancelable `wheel` event, on `SECTION.screen`, not default-prevented;
  - the page could scroll (maximum 856 and 2,293 px, from 0 and 535 px);
  - **no `scroll` event followed, and `scrollY` never changed** before the settle resolved, at least 300 ms after the wheel.

  In every pass, the first `scroll` event followed the wheel within 5–107 ms (2–180 ms in D2c), and an animated scroll reached the target over about 200 ms.

- **High concurrency is not required for reproduction; a load contribution remains unestablished.** The controlled comparison at 2 workers failed 6 of 40, against 3 and 2 of 40 in the 36-worker batches. Those batches differ in more than worker count, so the rates are not compared as a load effect.

**What this establishes.** In the observed failures, headless WebKit delivered the wheel to the page but performed no scroll within the test's settle window. Nothing in the app prevented the default, and the page did not move and then move back.

**What it does not establish.**

- Whether WebKit would have scrolled later than the settle window.
- Why the wheel sometimes produces no scroll.
- Whether the first occurrence, whose artefacts were overwritten, had the same form.

**CI.** Every one of these cases passed in both supplied CI runs (16 executions, with trace on). No CI failure is recorded. These local results suggest the precondition can fail at a CI-like worker count, so it remains a possible CI failure; no rate is claimed.

**No cause is attributed to item 125 or item 139.** The first occurrence predates item 125, and the second occurred on item 125's build.

---

## 9. Findings, ranked

Completed observations; each disposition is a candidate, not a decision.

- **F1. Runtime has headroom; no sharding change is warranted now.** The longest shard job at head was 806 s (394 s under the limit); the longest recorded is 967 s, shard 4 of run 37614828755 (233 s under). Overhead is about 50–60 s per shard. See [section 10](#10-are-more-shards-warranted).
- **F2. Cost is concentrated in the two-engine smoke matrices.** They make up 59 % of summed duration. Their geometric assertions need the combinations; their state and storage assertions repeat per combination ([section 7](#7-matrix-review)). _Candidate: a measured, per-family consolidation pilot, later._
- **F3. Two WebKit-only reliability problems now have characterised mechanisms** ([section 8](#8-focused-diagnostics-items-147-and-148)).
  - Item 147's failures, under instrumentation, were a text-identity artefact with focus unmoved.
  - Item 148's failures were a delivered wheel with no scroll, reproducible locally at 2 workers.

  Both threaten the required gate's reliability more than its duration. _Candidates: schedule item 147's assertion repair; decide item 148's next step. Both are separate items._

- **F4. A harness contract is not applied everywhere.** Five specs omit the `serviceWorkers: "block"` that `installLocalMapStyle` documents as required (C5). _Candidate: small repair._
- **F5. Per-test CI durations are not retained by CI itself.** This audit depended on the rider retrieving authenticated logs. A local run cannot replace them: the host, worker count and trace settings all differ. _Candidate: proposal 1._
- **F6. Retired-orientation assertions remain in 12 specs.** One unique assertion (200 % compaction in `ridingNextManoeuvre`) lives only in landscape (C4). _The rider's decision._
- **F7. A few duplicates in the Android project assert nothing that depends on the emulation** (C1, C2). Their runtime value is small (about 9 s).
- **F8. Fixed waits are mostly evidential.** The unexplained ones are five 500 ms settles after opening Planning, and the 150 ms font-change settles ([section 6](#6-fixed-waits-and-timeouts)). Low runtime value.
- **F9. Some comments and titles no longer match the code**, found by the summaries and checked against the source:
  - `diagnostics.spec.ts`'s header says it never runs Test routing connection because the app has no routing-provider injection point, but `statusConnectionResultReveal.smoke` runs it by intercepting the OpenRouteService URL;
  - `settingsStatusSwitcher.smoke`'s `settleArrival` comment still describes item 121's replaced top reset;
  - `ridingNextManoeuvre`'s last test asserts its 200 % compaction in landscape only;
  - `freeRoam.spec.ts:782`'s title promises the position marker but asserts none.

  _Candidate: a maintenance pass, like item 138._

---

## 10. Are more shards warranted?

**Not on these measurements.**

- **Headroom.** The longest shard job was 806 s at head; the longest ever recorded, 967 s (shard 4 of run 37614828755, on documentation-only `892a59a`), still had 233 s to spare.
- **Fixed cost per shard.** Each extra shard adds about 50–60 s of start-up, install and build, plus a runner. It does not reduce the summed test time; item 133 measured that four shards "bought parallelism, not speed".
- **Imbalance, not capacity.** Count-based sharding leaves shard 3, the mixed one, about 290 s shorter than shard 2 at head. A supported way to rebalance by cost does not exist in Playwright 1.61.1.
- **Variation.** The same shard varied by roughly ±25 % between two runs. That alone could move a 950 s shard towards the limit, which is why per-run durations should be observed (proposal 1) rather than inferred.

**What would change this:** a longest shard job consistently above about 1,000 s across several runs, with retained per-test durations showing where the growth is. Even then, consolidating repeated state assertions (F2) would be considered alongside sharding.

---

## 11. Proposals

**Nothing below is implemented.** Each needs the rider's approval before it starts.

### Proposal 1 — the recommended first slice: keep per-test durations from every CI run

**The change**, to `.github/workflows/deploy-pages.yml`'s E2E job only:

- Run Playwright's **built-in** `json` reporter alongside the existing `list` reporter: `--reporter=list,json`, writing a per-shard file outside `test-results/` through the installed version's supported output setting.
- Upload that file when the test step passed or failed in the ordinary way — **not** on every run: a cancelled or timed-out job, or an earlier step's failure, uploads nothing. Each shard gets its own artefact, kept for 7 days, using the already-pinned `actions/upload-artifact` and a name distinct from the failure-evidence artefact.

**Why it is first.**

- It measures before anything is optimised.
- It gives consistent, machine-readable evidence without parsing console logs. _(Corrected 7 October 2026: an earlier draft said it removed the dependence on authenticated retrieval. It does not — downloading a CI artefact also needs authenticated GitHub access.)_
- It gives every later slice — a consolidation pilot, a wait replacement, item 147's repair — a before/after comparison over more than two runs.
- It is the smallest change that does so.

**Guarantees it preserves.**

- The list output in the job log is unchanged.
- Item 116's failure-only upload of `test-results/`, with traces and screenshots, is unchanged.
- No test, timeout, retry, worker or shard changes; the 20-minute limit and Deploy's `needs` are unchanged.
- No new dependency.

**To verify in the slice.**

- The JSON report's contents, before it is uploaded: no secrets — only the synthetic key appears in tests — and annotations within reasonable size.
- The extra wall-clock per shard, compared over at least two runs.
- That a failing shard still uploads both artefacts.

**Alternative, if the rider prefers no workflow change:** keep retrieving logs on request, as for this audit.

### Later candidates, in suggested order

None is part of the first slice.

1. **The harness contract** (C5): add `serviceWorkers: "block"` to the five specs, with each spec's own run as evidence. Small.
2. **Item 147's assertion repair** — its own item, to be scheduled by the rider. The evidence supports comparing node identity rather than text while keeping "focus moved nowhere". Any change follows that item's own approval.
3. **Item 148's next step** — its own item. Decide whether the scrolled cases' precondition should keep relying on headless WebKit's wheel scrolling, which the diagnostics show can deliver no scroll, and what the cases are meant to prove about wheel input.
4. **A consolidation pilot on one family** (F2): keep every geometric combination and assert engine-independent state once per engine. Use proposal 1's durations before and after, and record the coverage that remains.
5. **Landscape assertions** (C4): the rider's decision. If they are retired, move `ridingNextManoeuvre`'s 200 % compaction to portrait first.
6. **The Android near-duplicates** (C1, C2) and the support self-tests (C3).
7. **The unexplained Planning settles and the font-change settles** (F8), each replaced only by its identifiable condition.
8. **Comment and title corrections** (F9).

---

## 12. Decisions for the rider, and evidence gaps

**Decisions requested:**

1. Approve, amend or decline proposal 1.
2. Whether to schedule item 147's repair and item 148's next step.
3. Whether landscape end-to-end assertions stay, given that portrait is the only acceptance-tested orientation and landscape must not be deliberately broken.
4. Whether item 146 stays first in the order while proposal 1 is decided. It is an open investigation either way.

**Evidence gaps:**

- **Only two runs' per-test durations.** No trend, and no separation of machine from application effects.
- **No CI measurement at other worker counts.**
- **No CI evidence of the item 147 or 148 failures**; the local rates are not CI rates.
- **Item 147's uninstrumented 60-repeat failures** are not shown to have the same form as the instrumented ones.
- **Item 148's first occurrence** (artefacts overwritten) is not shown to have the same form as the later ones, and whether WebKit's scroll would have arrived after the settle window is not known.
- **The coverage summaries** were agent-assisted. Only the claims named in this report were checked by hand; the appendix's one-line descriptions are summaries, not audits.

### Decisions of 7 October 2026

The rider's decisions on the questions above, recorded as made:

1. **Proposal 1 is approved**, with its upload conditions as corrected above:
   - the built-in JSON reporter alongside `list`;
   - separate per-shard artefacts, uploaded on successful runs and ordinary test failures, with 7-day retention;
   - selected baseline reports kept in the external audit folder for longer comparisons.

   Retrieving the artefacts still needs authenticated GitHub access. The benefit is consistent, machine-readable evidence without parsing console logs.

2. **Item 147's focused assertion repair** is scheduled after timing capture:
   - compare actual element identity rather than the changing label text;
   - keep the test's allowed focus behaviour when the button is disabled;
   - show that unexpected movement to another control still fails.

   The instrumented failures justify repairing what the assertion measures. They do not explain the WebKit timing or every earlier failure. There is no product focus-policy change and no expansion into item 135.

3. **Item 148's bounded investigation** is scheduled after item 147:
   - establish whether wheel input is part of the behaviour those cases protect, or merely prepares their scroll position;
   - deliver a bounded proposal before changing their setup or assertions.

   High concurrency is not required for reproduction; any load contribution remains unestablished. This scheduling authorises investigation and a proposal, not implementation.

4. **The landscape end-to-end checks are kept for now** (C4).
   - Portrait remains the only supported and acceptance-tested orientation.
   - The roughly 38 s is whole cases, not the landscape steps' removable cost.
   - Any later retirement must first preserve unique coverage in portrait, including the 200 % warning-compaction assertion.
   - No landscape test changes in this slice.

**The sequence:** item 146's timing capture → item 147's assertion repair → item 148's bounded investigation and proposal → item 146's concluding review and dispositions → item 103 → item 120.

- **Item 145** stays unscheduled, with its rider-review checkpoint before item 103 starts.
- **Persistence across app closure** stays deferred.
- **The other candidates** in [section 11](#11-proposals) stay candidates, not additional prerequisites for item 103.

**Closure.** Item 146 can conclude with each finding explicitly retained, deferred or tracked separately. Completing every proposed optimisation is not its closure condition, and unresolved reliability findings stay accurately recorded.

---

## 13. Follow-up: CI run 37614828755 and its repair

Run [37614828755](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37614828755), "Deploy to GitHub Pages" for `892a59a` — this report's own documentation commit — on 7 October 2026. Its job and step metadata were read once, after it completed:

| Job              | Result                                  | Whole job |                        Test step |
| ---------------- | --------------------------------------- | --------: | -------------------------------: |
| Verify and build | passed                                  |     310 s | 178 s (unit and component tests) |
| E2E shard 1      | **failed**: one case failed, 297 passed |     525 s |                            465 s |
| E2E shard 2      | passed                                  |     802 s |                            734 s |
| E2E shard 3      | passed                                  |     550 s |                            489 s |
| E2E shard 4      | passed                                  | **967 s** |                            903 s |
| Deploy           | skipped                                 |         — |                                — |

- **Shard 4's 967 s is the longest shard job recorded**, 233 s under the 1,200 s limit. It is one run, so no trend or cause is claimed.
- **Deploy was skipped**, so the live site stayed `0.4.69` / `677a03e`. `677a03e` remains the phone-accepted build.

### The failure

- **The case:** `[chromium] e2e/gradientColouring.spec.ts:1026` › "Riding: pre-ride full profile (item 77) › 390x844 phone viewport › the expanded Climb categories disclosure introduces no horizontal overflow, and the pre-ride reading order is unchanged".
- **The assertion:** it expected the headings `["climb-then-descent-route", "Route profile", "Recognised climbs"]` and received `["Routes"]`.

**The evidence is the CI trace, inspected before anything was rerun.** The rider supplied the shard's failure artefact — trace, screenshot and error context — which is kept outside the repository.

- **The trace's sources are the failed head's.** It embeds `e2e/gradientColouring.spec.ts` and `e2e/support/localMapStyle.ts`, and both are byte-identical to `892a59a`. No test or application source changed between `677a03e` and `892a59a`.
- **The sequence, in the trace's own timestamps:**

  | Time (ms)       | Step                                              | What the trace shows                                                                              |
  | --------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
  | 455,987         | The click on the route card completed             | —                                                                                                 |
  | 455,988–455,990 | `expect(getByTestId("map-loading")).toBeHidden()` | Passed in 2 ms. The DOM snapshots show no `map-loading` element yet, with Routes still displayed. |
  | 455,990–456,007 | `locator("h1, h2").allTextContents()`             | Returned `["Routes"]`                                                                             |
  | 456,029         | The next DOM snapshot                             | Already holds the pre-ride `h1`, both `h2` sections and `map-loading`                             |

  The failure screenshot, taken afterwards, shows the pre-ride screen.

- **The cause is a readiness race in the test helper.** `importClimbThenDescentRoute` used a negative check, on an element that did not yet exist, as its barrier. So it could pass before the pre-ride screen rendered. That is the same trap item 32 recorded for `toBeHidden()`.

### The repair, test-only

**The change.** The helper now waits for the opened route's own level-1 heading, a positive end state, and then keeps its existing `map-loading` check.

**Why one check is enough.** `RidingScreen.tsx` renders the route's `h1` (`route.name`) and both `h2` sections in the same pass while it is idle. "Route profile" comes from `RidingScreen.tsx` itself, and "Recognised climbs" from `RidingClimbSelector`, which renders even when there are no climbs. The climbs come from a synchronous `useMemo`.

**What is unchanged.**

- Every reading-order assertion — the exact three-item list and its order — and every overflow, disclosure, swatch and selected-feature assertion.
- There is no sleep, retry or timeout change, and the new check uses the default expect timeout.
- No application change and no version change.

Eight tests use the helper. The one at line 1281 makes the same immediate heading read, and is covered by the same change.

### Verification

In the CI image by digest, with outputs kept in the audit folder:

- **The filter** selected exactly this case, before and after the change.
- **Before the repair:** 10 repetitions at 2 workers (the banner reads "Running 10 tests using 2 workers") all passed. The race did not reproduce locally.
- **After the repair:** the same, 10 passed.
- **The complete spec in Chromium, once:** 16 passed, at 16 workers by the banner.

Because the race never reproduced locally, these runs show only that the change causes no regression, not its effect. The evidence for the defect is the CI trace.

### The wider pattern, a candidate only

A `map-loading` `toBeHidden()` check directly after a click appears at **142 sites in 50 files**. Many have a positive check before or after it, or may render synchronously. Which of them can race is not established, and this repair was deliberately not extended to them.

### Deployment of the repair

Run [37622132469](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37622132469), for `49547aa`, passed every job on its first attempt:

- Verify and build: 249 s;
- shards 1 to 4: 633, 893, 561 and 763 s;
- Deploy: 10 s.

The live site then served `0.4.69` / `49547aa`. The longest shard job, 893 s (shard 2), was 307 s under the limit. One run: no trend is claimed. `677a03e` remains the accepted phone build.

---

## 14. Appendix: per-spec inventory

Cases are listed Chromium/WebKit/Android, from `--list` at `7cc9e55`; WebKit counts include the 5 skipped cases. "CI Σ s" is the summed reported duration in run 37602138083, excluding skipped cases; it is a concurrent sum, not wall-clock. "CI max s" is the slowest case. "Fixed waits" counts `page.waitForTimeout` calls in the source. "Added" is the spec's first commit.

| Spec                                    | Cases C/W/A | CI Σ s | CI max s | Fixed waits | Added              | Protects · browser boundary                                                                                                                                                         |
| --------------------------------------- | ----------- | -----: | -------: | ----------: | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `androidCspEnforcement`                 | 0/0/1       |    0.6 |      0.6 |           0 | 4d4444d 2026-09-01 | CSP blocks an inline script under Pixel 7 emulation · same assertions as csp.smoke test 2                                                                                           |
| `androidDistanceBadges`                 | 0/0/1       |    5.8 |      5.8 |           0 | 80e1aad 2026-08-27 | Item 84 badge paint at DPR 2.625 · composited crop decode (no hidden comparison)                                                                                                    |
| `androidFreeRoam`                       | 0/0/2       |    7.5 |      4.0 |           0 | 1a8cc9e 2026-08-14 | Free roam start, reload, End under emulation · no emulation-dependent assertion                                                                                                     |
| `androidGpxImportExport`                | 0/0/2       |    8.1 |      6.4 |           0 | d888727 2026-08-10 | Item 25 GPX import/export · real file input and download events                                                                                                                     |
| `androidMapCameraGestureRace`           | 0/0/14      |   96.2 |     10.4 |           0 | 554d59d 2026-09-03 | Item 94 camera under a real two-finger pinch during fallback and retries · CDP touch                                                                                                |
| `androidMobileLayout`                   | 0/0/4       |    8.9 |      6.2 |           0 | d888727 2026-08-10 | Items 25, 55, 92, 117, 118, 121 at Pixel 7 · overflow, targets, unstubbed storage estimate                                                                                          |
| `androidOfflineAppShell`                | 0/0/1       |    1.6 |      1.6 |           0 | d888727 2026-08-10 | Items 25, 93 · service worker controls and serves the shell while offline                                                                                                           |
| `androidPersistenceAndOffline`          | 0/0/3       |   22.0 |     13.8 |           0 | d888727 2026-08-10 | Item 25 · stored ride across reload, fallback style, offline state                                                                                                                  |
| `androidPlanning`                       | 0/0/1       |    7.9 |      7.9 |           0 | d888727 2026-08-10 | Item 25 Planning under emulation · assertions a subset of planning.spec.ts:265                                                                                                      |
| `androidPlanningTouchPlacement`         | 0/0/8       |   75.7 |     24.9 |          10 | b690496 2026-09-29 | Item 123 under genuine CDP touch · tap slop, pan, double-tap, pinch, pen                                                                                                            |
| `androidRiding`                         | 0/0/4       |   18.6 |      5.4 |           0 | d888727 2026-08-10 | Items 25, 55, 110 · Follow/north-up targets, wake-lock stub paths including rejection                                                                                               |
| `androidRouteLibraryTags`               | 0/0/5       |    9.3 |      4.6 |           0 | 39e45fe 2026-09-08 | Items 100, 111 under emulation · overflow, targets, reveal (mouse clicks)                                                                                                           |
| `clearDraftFailure.smoke`               | 23/23/0     |  262.7 |      8.6 |           0 | 439e578 2026-10-03 | Item 124 D-01 · held IndexedDB transaction and aborted delete, focus/scroll recorders, band geometry, real wheel and Shift+Tab                                                      |
| `clearPlanningDraft`                    | 6/0/0       |   41.9 |     14.2 |           3 | 30295ff 2026-08-13 | Item 37 Clear draft · request interception, camera re-fit eligibility, reload, phone sizes                                                                                          |
| `climbSelectorFit`                      | 6/0/0       |    9.9 |      1.8 |           0 | 714ec0b 2026-09-25 | Item 113 follow-up climb select fit · select client width against probe text with stress                                                                                            |
| `coldStartPausedRoute.smoke`            | 14/14/0     |  150.3 |     10.6 |           3 | 501e1d4 2026-10-02 | Item 132 cold-start paused screen · real reload, IndexedDB read faults below Dexie, withheld fixes                                                                                  |
| `confirmationDialogs.smoke`             | 6/6/0       |   30.6 |      6.4 |           1 | 6966539 2026-09-30 | Item 119 dialog semantics · names, descriptions, id integrity, Escape scoping, real IndexedDB and reload; no geometry                                                               |
| `confirmationReveal.smoke`              | 14/14/0     |  176.4 |      9.5 |           3 | 04639cb 2026-10-01 | Item 124 slice 1 (Clear draft, Delete route) · band from header/visualViewport/safe area, scroll recorder, clamping, anchoring                                                      |
| `confirmationRevealSettled`             | 11/0/0      |   44.7 |      9.3 |           0 | 04639cb 2026-10-01 | Item 124 slices 1, 3, 7, 8 · rAF recorder of action drift, 20× CDP CPU throttle (Chromium), second page re-render                                                                   |
| `csp.smoke`                             | 5/5/0       |   15.5 |      4.5 |           0 | 4d4444d 2026-09-01 | Items 90, 93 CSP · exact policy, enforcement and reporting per engine, clean startup and SW registration                                                                            |
| `diagnostics`                           | 14/0/0      |   16.1 |      1.7 |           0 | 1863fba 2026-08-05 | Status content, items 92, 101, 112, 117, 118 · overflow, native details keys, 200 % (storage estimate stubbed)                                                                      |
| `directionArrows`                       | 3/0/0       |   15.6 |      6.5 |           1 | 3ab2e15 2026-07-28 | Milestone 3 direction arrows · canvas screenshot decode of arrow taper; drag-rotate                                                                                                 |
| `distanceBadges`                        | 12/0/0      |   89.8 |     15.3 |           0 | 7ca6b85 2026-07-29 | Item 84 badge paint and layering · screenshot decode with visible/hidden comparison, stacking ancestry, pointer-events                                                              |
| `editCopyBusyState.smoke`               | 25/25/0     |  203.5 |      7.5 |           8 | 041da6c 2026-10-02 | Item 124 D-06 and item 125 · held IndexedDB writes, real ordering against Planning hydration, focus after disable/re-enable                                                         |
| `editCopyConfirmationReveal.smoke`      | 11/11/0     |   90.9 |      9.4 |           1 | 7e46daf 2026-10-03 | Item 124 C-12 and decision 4 · focus wrapper capturing autoFocus geometry, band, ride transitions                                                                                   |
| `editCopyNotice.smoke`                  | 11/11/0     |  162.5 |     12.4 |           3 | a474254 2026-10-05 | Item 141 notice · Range clipping per variant, native Space not scrolling, stable live region                                                                                        |
| `editRouteAsPlanningCopy`               | 5/0/0       |   46.7 |     13.1 |           3 | 055acea 2026-08-10 | Item 26 Edit copy · zero-request recovery, real download and offline re-import, digest tamper fallback, camera fit                                                                  |
| `endRideFailureHeader.smoke`            | 8/8/0       |   58.5 |      4.8 |           1 | 9334b25 2026-10-06 | Item 139 · error row geometry and Range line clipping in the fixed shell at 100/200 %                                                                                               |
| `endRidePausedConfirmationReveal.smoke` | 32/32/0     |  297.1 |      8.7 |           1 | bc4fb11 2026-10-03 | Item 124 C-10/C-11, decision 4 · confirmation band geometry, focus recorder, real wheel, ride transitions                                                                           |
| `fetchInvocation`                       | 2/0/0       |    1.2 |      0.7 |           0 | 1e956a5 2026-07-27 | Chromium's fetch receiver rules behind the ORS adapter fix · native fetch in the page                                                                                               |
| `freeRoam`                              | 16/0/0      |   62.8 |     11.8 |           0 | 1a8cc9e 2026-08-14 | Item 42 free roam and its shell, camera, zoom, guard, imagery · camera attributes, gestures, reloads, geometry                                                                      |
| `germanRidingHeader`                    | 44/0/0      |  117.6 |      5.0 |           0 | 3503136 2026-09-25 | Item 113 follow-up riding header fit and stillness · Range extents with stress, header boxes held still                                                                             |
| `gradientColouring`                     | 16/0/0      |   46.3 |      7.3 |           1 | d5892c2 2026-07-29 | Items 55, 56, 77, 78, 79 climb colours · canvas pixel counts per colour, legend boxes                                                                                               |
| `language`                              | 18/0/0      |   15.5 |      1.3 |           0 | 91dc4fd 2026-09-14 | Item 113 language, item 121 nav fit · document lang, built manifest, reload, nav text layout with stress                                                                            |
| `layout`                                | 3/0/0       |    6.7 |      2.4 |           0 | 19324e0 2026-07-26 | Map attribution and control clusters, item 53/56 · MapLibre controls geometry, canvas follows ResizeObserver                                                                        |
| `lowZoomLegibility`                     | 6/0/0       |   89.0 |     24.3 |           0 | 072ce18 2026-08-07 | Items 23 and 39 · marker boxes shrinking through CSS zoom bands; route keeps loading (no pixel sampling)                                                                            |
| `mapImageryCameraFraming`               | 5/0/0       |   11.3 |      3.7 |           0 | fcf507c 2026-09-02 | Item 94 framing after a failed start · style fail/succeed, data-camera-*, marker inside the map                                                                                     |
| `mapImageryRecovery`                    | 18/0/0      |  102.4 |     12.2 |           2 | 5bd0913 2026-08-20 | Items 67, 81, 83, 96, 108, 115 imagery recovery · real tile/style failures, camera after recreation, grace timing                                                                   |
| `mapStyleReadiness`                     | 2/0/0       |    2.0 |      1.1 |           0 | e498834 2026-07-29 | Harness contract and item 96 fast path · local style readiness, MutationObserver from before app start                                                                              |
| `planning`                              | 22/0/0      |  111.4 |     19.3 |           3 | e35dd29 2026-07-25 | Core Planning flows and controls (items 17, 34, 35, 48, 52, 110, 124) · MapLibre keyboard camera, crosshair and marker geometry, canvas pixels for the location dot and north arrow |
| `planningEnlargedTextLayout.smoke`      | 21/21/0     |  253.8 |      9.8 |           0 | f320316 2026-09-29 | Item 114's enlarged layout · elementFromPoint hit grid, Range clipping, contrast, collisions at 125–200 % text                                                                      |
| `planningEnlargedTextLayout`            | 12/0/0      |   19.8 |      2.9 |           2 | f320316 2026-09-29 | Item 114's switching · first-paint rAF sampler, canvas identity across switches, measured size thresholds, real drag-pan                                                            |
| `planningEnlargedTextScrollbar`         | 1/0/0       |   48.8 |     48.8 |           3 | e1e70cf 2026-10-05 | Item 122's scrollbar compensation · classic Chromium scrollbars, a 31-step viewport-height sweep counting class flips                                                               |
| `planningImageryBanner.smoke`           | 23/23/0     |  158.1 |      4.7 |           1 | 47f8c40 2026-10-01 | Item 128 (C6) and item 122's floor · imagery message hit-tests against the crosshair; tile hold/fail                                                                                |
| `planningMapArea.smoke`                 | 15/15/0     |  191.7 |     10.1 |           5 | e1e70cf 2026-10-05 | Item 122's map size and Calculate-first order · snapped heights, band geometry under synthetic insets, editing row held still, real drags                                           |
| `planningPlacementControlLayering`      | 9/0/0       |   89.5 |     19.8 |           3 | c368560 2026-09-11 | Item 109's control layering · screenshot byte/colour comparison, stacking ancestry, elementsFromPoint grid                                                                          |
| `planningPlacementLabelFit`             | 8/0/0       |   17.5 |      2.3 |           0 | 219a99c 2026-09-25 | Item 113 follow-up placement label fit · Range line counts, max-content clone widths, letter-spacing stress                                                                         |
| `planningSavedRoute.smoke`              | 14/14/0     |  165.5 |      7.4 |           3 | 68e6697 2026-10-01 | Item 124 slice 3 (C-14), items 140 and 125 · confirmation band, app scroll recorder, scroll anchoring, watch counter                                                                |
| `planningTouchPlacement.smoke`          | 5/5/0       |   39.5 |     12.3 |           4 | b690496 2026-09-29 | Item 123 touch versus mouse placement · real touchscreen taps with a pointerType recorder (WebKit labels touch clicks 'mouse')                                                      |
| `planningWarningMapReveal.smoke`        | 13/13/0     |  122.4 |      9.8 |           3 | 3f58248 2026-10-04 | Item 124 slice 10 (P-18) · map-tap selection on the canvas, scroll API recorder, reduced motion, smooth-scroll completion                                                           |
| `planningWarningRows`                   | 4/0/0       |   12.6 |      3.4 |           0 | cbaa3aa 2026-09-25 | Item 113 follow-up warning rows · computed list style, Range first-line and number–unit wrapping, :focus-visible                                                                    |
| `pwaManifestAndScope`                   | 1/0/0       |    0.7 |      0.7 |           0 | d888727 2026-08-10 | Item 25 base path · manifest and SW scope under the Pages base                                                                                                                      |
| `resumeDuringEndRide.smoke`             | 2/2/0       |   29.5 |      8.6 |           2 | 964f585 2026-10-06 | Item 134 · held rideState transaction, abort-at-issue delete, reloads                                                                                                               |
| `reverseRoute`                          | 7/0/0       |   64.1 |     12.3 |           7 | 662624a 2026-08-10 | Item 38 Reverse route · request counts past debounce, reversed request bodies, download/re-import, reload                                                                           |
| `rideLauncherStaleConfirmation.smoke`   | 1/1/0       |    9.8 |      5.0 |           0 | 1d59d95 2026-10-06 | Item 140 launcher slice · two pages sharing IndexedDB, stale confirmation                                                                                                           |
| `rideSessionSwitchGuard`                | 16/0/0      |   62.1 |      7.7 |           0 | 74e5dfb 2026-08-24 | Items 73, 95, 124, 140 switch guard · rAF action-drift recorder, 20× throttle, scrollY recorder, reloads                                                                            |
| `ridingActiveDirectionLayering`         | 2/0/0       |   39.8 |     24.9 |           1 | cee20f2 2026-09-07 | Item 98 coincident-direction paint · canvas pixel bands relative to the painted marker; 33 acknowledged fixes                                                                       |
| `ridingCamera`                          | 6/0/0       |   39.1 |     11.6 |           0 | 7ab38ec 2026-08-01 | Northwards/Follow re-press (requestId), items 53, 65, 66, 110 · MapLibre transform via data-camera-*, keyboard gestures, reload                                                     |
| `ridingClimbView`                       | 26/0/0      |   91.1 |      6.9 |           0 | 32dd9ea 2026-07-31 | Items 56, 57, 71, 76, 80, 82, 108, 115 · cue geometry, container-query placement, painted marker/route extent, 200 %                                                                |
| `ridingElevationWindows`                | 4/0/0       |   12.8 |      3.9 |           0 | 251f69d 2026-08-18 | Profile windows and guides (items 54, 70, 76, 80) · rendered SVG guide labels after fixes, flush ring geometry                                                                      |
| `ridingFinishAndEnd`                    | 4/0/0       |   24.0 |      7.2 |           0 | 4728e0d 2026-08-11 | End and Finish ride, closed-loop completion (items 32, 50, 55) · real fix delivery acknowledged through storage, reloads                                                            |
| `ridingImmersiveShell`                  | 8/0/0       |   31.6 |      6.3 |           0 | 4bdcbd0 2026-08-18 | Item 55/56/72 immersive shell · watch counter, wake-lock stub, stored row, sticky and safe-area geometry                                                                            |
| `ridingLauncher`                        | 6/0/0       |   22.6 |      5.7 |           0 | 2dc431f 2026-08-14 | Items 41, 50, 51, 72, 132 launcher · reload drops in-memory state, watch counter, ORS abort, stored row                                                                             |
| `ridingMapProfileViews`                 | 12/0/0      |   31.6 |      4.8 |           0 | 515059c 2026-08-19 | Item 56 Map/Profile layout · header geometry under insets, map growth, watch counter, held Pause write                                                                              |
| `ridingNextManoeuvre`                   | 6/0/0       |   53.4 |     12.2 |           0 | 461cf66 2026-07-30 | Trusted manoeuvres, items 47 and 97 · ORS mock, fixes, export/offline re-import, real 10 s compaction timer                                                                         |
| `ridingOutAndBackTurnaround`            | 1/0/0       |    8.0 |      8.0 |           0 | 97cc233 2026-09-04 | Item 104 out-and-back progress · real watch delivery to rendered text; logic otherwise unit-tested                                                                                  |
| `ridingPauseAfterResume.smoke`          | 4/4/0       |   50.7 |      8.4 |           1 | 64bde8d 2026-10-02 | Item 131 · reload into launcher Resume, watch/clear counters, German via stored preference                                                                                          |
| `ridingSelectedFeatureSummary`          | 9/0/0       |   18.1 |      2.4 |           0 | 5075d52 2026-08-26 | Item 85 selected-feature summary · screenshot edge-paint of Clear selection, :focus-visible                                                                                         |
| `ridingShortTurnaroundWalkingPace`      | 1/0/0       |   19.6 |     19.6 |           0 | 8ed4b68 2026-09-04 | Item 104 follow-up walking cadence · 19 acknowledged fixes, acn:navigation digest, stored progress                                                                                  |
| `ridingStatusCardRecovery`              | 9/0/0       |   18.4 |      3.3 |           0 | 6d05b0b 2026-08-24 | Item 75 status card recovery · real PERMISSION_DENIED and offline, card width ratios, 200 %                                                                                         |
| `ridingWakeLock`                        | 6/0/0       |   14.7 |      3.1 |           0 | 6c8c02d 2026-07-31 | Screen on control · stubbed Wake Lock and synthetic visibility, geometry, :focus-visible, 200 %                                                                                     |
| `routeDeleteFailure.smoke`              | 27/27/0     |  185.7 |      6.4 |           1 | bd688d7 2026-10-03 | Item 124 D-02 · held IndexedDB and aborted delete, Dexie cache eviction (3.6 s), second page, band geometry                                                                         |
| `routeDeleteFiltering.smoke`            | 4/4/0       |   17.6 |      4.2 |           0 | 68e6697 2026-10-01 | Item 124 D-03 · real keystrokes after remount, focus, band geometry                                                                                                                 |
| `routeFeatureColouring`                 | 2/0/0       |    8.9 |      4.7 |           0 | ecf811c 2026-07-29 | Map-tap climb selection and warning priority · real MapLibre hit-testing on the fallback style (no colour asserted)                                                                 |
| `routeLibraryPinning`                   | 3/0/0       |    3.4 |      1.4 |           0 | 47f73d3 2026-08-06 | Pinning order and item 99 · native blur-on-disable focus, reload                                                                                                                    |
| `routeLibraryScroll`                    | 3/0/0       |    4.2 |      1.7 |           0 | 8722f2d 2026-08-06 | Routes position after opening a route, item 125 round trip · real document scroll                                                                                                   |
| `routeLibrarySearchSort`                | 5/0/0       |    5.1 |      1.8 |           0 | 65aa9fa 2026-08-06 | Search and sort, item 99 · reload persistence, containment at 200 % and landscape                                                                                                   |
| `routeLibraryTagFiltering`              | 13/0/0      |   16.4 |      3.4 |           0 | 7eb4bf1 2026-09-08 | Items 100, 106, 111 tag filtering · scroll clamp, chip geometry, Range widths, aria-disabled focus                                                                                  |
| `routeLibraryTagManagement`             | 8/0/0       |   12.1 |      3.1 |           0 | aced1df 2026-09-09 | Item 100 stage 4A and item 105 · reload, panel reveal against the sticky header                                                                                                     |
| `routeLibraryTags`                      | 9/0/0       |   15.4 |      4.2 |           0 | 39e45fe 2026-09-08 | Item 100 stage 2 and items 105/106 · card reveal geometry after Save/Cancel, reload                                                                                                 |
| `screenScrollRestoration.smoke`         | 5/5/0       |   28.8 |      4.3 |           0 | 677a03e 2026-10-07 | Item 125 in both engines · switcher held still, clamp, item 118 reveal after a restored arrival                                                                                     |
| `screenScrollRestoration`               | 8/0/0       |   34.7 |     13.5 |           0 | 677a03e 2026-10-07 | Item 125 slice 1 · real scroll across all 20 view pairs, held storage estimate, wheel, reload                                                                                       |
| `settings`                              | 15/0/0      |   16.9 |      1.9 |           0 | 64ae976 2026-09-13 | Items 95, 112, 113, 118 Settings · 200 % fit, card containment, reveal band, rAF action recorder with 20× throttle                                                                  |
| `settingsChoiceFit`                     | 16/0/0      |   19.5 |      1.6 |           0 | 4e86300 2026-09-25 | Item 113 follow-up segmented choices · Range/word line counts, clone widths, stress                                                                                                 |
| `settingsStatusSwitcher.smoke`          | 4/4/0       |    8.0 |      1.3 |           0 | 1fe46d6 2026-09-28 | Item 121 WebKit focus/scroll defects · scrollY at pointer phases on Save, focus without scrolling                                                                                   |
| `settingsStatusSwitcher`                | 31/0/0      |   33.6 |      2.1 |           0 | 1fe46d6 2026-09-28 | Items 118, 121, 125 switcher · sticky and :has() release, focus scroll, gate geometry, fit                                                                                          |
| `smoke`                                 | 2/2/0       |    6.8 |      3.1 |           0 | 420474b 2026-07-23 | Shell loads; GPX opens in Riding with the real map worker · Chromium and WebKit                                                                                                     |
| `staleSessionActions.smoke`             | 4/4/0       |   44.4 |      7.5 |           0 | 7da1f19 2026-10-06 | Item 140 slice 2 · two pages, one geolocation feed, stale End and switch/End ride                                                                                                   |
| `statusConnectionResultReveal.smoke`    | 24/24/0     |  185.5 |      7.7 |           0 | a71ca2f 2026-10-04 | Item 124 slice 11 (P-15) · band geometry, engine smooth scroll, input recorders, focus after disable                                                                                |
| `stickyNavigation`                      | 15/0/0      |   16.8 |      3.1 |           0 | 8bd26bb 2026-08-09 | Items 24, 34, 55, 112, 121 sticky header · stuck geometry while scrolled, nav fit at 200 %, synthetic top inset                                                                     |
| `support/csp`                           | 6/0/0       |    0.0 |      0.0 |           0 | 4d4444d 2026-09-01 | Self-test of the e2e CSP parser · pure logic, no page                                                                                                                               |
| `support/localMapStyle`                 | 8/0/0       |    0.0 |      0.0 |           0 | e498834 2026-07-29 | Self-test of the local-style URL predicate · pure logic, no page                                                                                                                    |
| `visualFoundation`                      | 3/0/0       |    2.6 |      1.1 |           0 | 54f5dbc 2026-08-04 | Visual-foundation migration · Routes overflow, wrapping, rename keeps cards mounted                                                                                                 |
