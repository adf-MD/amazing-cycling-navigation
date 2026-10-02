# Completed backlog items 132–

This file continues the 100– numeric range and opens at item 132. It was started when item 132 was completed (2 October 2026, `0.4.55`). Its entry belongs before item 133's in numeric order, and adding it to what was then `items-118-NN.md` would have taken that file to about 176,000 characters, past the ~150,000-character soft cap documented in [`README.md`](README.md). That file was therefore closed at item 131 and renamed [`items-118-131.md`](items-118-131.md), and item 133's entry — completed earlier the same day as a CI-only change — moved here unchanged apart from its link to item 132, which now points within this file. No entry was shortened or rewritten by that split. Stable item numbers never change regardless of which file their text lives in: item 133 was completed before item 132 and is filed after it, since a number is an identifier and never a schedule.

See [`README.md`](README.md) for the full history index, [`../backlog.md`](../backlog.md) for pending specifications, and [`../current-status.md`](../current-status.md) for the manual acceptance ledger.

---

<a id="item-132"></a>

## Item 132 — Consistent paused-route screen after a cold start — done

_Category: Riding lifecycle_

132. **Consistent paused-route screen after a cold start — done**
     - Origin: the rider's decision, 2 October 2026, after item 131's installed-iPhone acceptance. The same paused route ride has two presentations today. After the PWA is fully closed and reopened, the Ride tab shows the Ride launcher's short summary; opening the same route from Routes shows the full paused-route screen. **The two caused confusion and made Edit copy harder to discover.**
     - **An approved usability refinement of intentional existing behaviour — not a regression, and not attributed to item 131.** The launcher was added by [item 41](items-39-48.md#item-41), and the tests below pin today's behaviour as the established contract. Item 131 neither introduced nor changed it.
     - **Scheduled on 2 October 2026, first** in the approved execution order (root [`CLAUDE.md`](../../../CLAUDE.md)), ahead of item 124's remaining approved slices, by the rider's decision. It was filed during a documentation and review-preparation task. **Nothing about it has been implemented.** Later the same day the rider placed item 124's D-06 repair ahead of it; once that repair had shipped in `0.4.54`, the rider placed [item 133](#item-133), a CI-infrastructure change, ahead of it. With item 133 configured for four shards, it is first again.
     - **Approved target behaviour.** The first time the rider enters Ride after fully closing and reopening the PWA, a valid unfinished route ride opens the existing full paused-route screen, with its map, elevation information and **Edit copy**. This is the same paused-route experience as opening that route from Routes. **Restoration starts no tracking, and Resume remains an explicit, single action.**
     - **Approved constraints:**
       - reuse the existing paused-route screen rather than create another presentation;
       - preserve route progress and the existing restored-session state;
       - preserve item 131's one-use resume handling, and its protection against restarting tracking after Pause or navigation;
       - keep the current initial navigation tab unchanged; the change concerns entering Ride after a cold reopen;
       - preserve appropriate recovery for a missing route, an unsupported session and a storage-read failure;
       - free roam is outside this change.
     - **Present facts, read from source at `64bde8d` (`0.4.53`) for this entry, not measured:**
       - **The app always starts on Routes.** `screen` and `ridingContent` are in-memory state (`src/App.tsx` ~293, ~300), and nothing reads the stored ride before the first render. A cold start and a reload therefore take the same path.
       - **The launcher.** While `ridingContent` is `none`, Ride renders `RidingLauncher` (`App.tsx` ~1326–1363), which re-reads storage on every mount (`RidingLauncher.tsx` ~154–200). For an unfinished route it shows the route's name, "You have an unfinished ride on this route.", **Resume ride** and **End ride**. Its other branches are:
         - "Checking for an unfinished ride…";
         - a failed read, with **Retry**;
         - a missing route, with **Discard unfinished ride**;
         - an unsupported stored kind, also with **Discard unfinished ride**;
         - an unfinished free roam.
       - **Resuming from the launcher.** **Resume ride** goes through the ride-transition guard and stamps the one-use resume instruction (items 72 and 131). The riding screen consumes it once restoration has settled.
       - **Opening from Routes.** A route card goes through the same guard with no instruction. The paused-route screen restores progress, the stale last fix, the elevation view, the camera, the wake-lock preference, the dismissed climb and the completion state, and starts no location watch (`useRideNavigation.ts` ~482–518). A watch starts only from `handleStart()`.
       - **Leaving Ride.** App keeps the selected route in `ridingContent` across tab changes. `RidingScreen`, keyed by route, still **unmounts when the rider leaves Ride and mounts again on return**: the remount behind item 131's replay. **Back to Ride options** sets `ridingContent` to `none` (`App.tsx` ~1136–1149), so the launcher renders and re-reads storage. End, Finish, and pausing or leaving free roam also lead back to the launcher.
       - **The restore-failed alert renders only while a resume instruction is pending** (`RidingScreen.tsx` ~1207–1210, ~1739–1755). The alert reads "Your ride could not be restored on this device. Try again.", with **Retry** and **Back to Ride options**. Opened without an instruction, as from a route card, a failed restoration would show the ordinary no-fix panel with **Start riding** and no error. While restoration is still loading, **Start riding** can show briefly before **Resume ride**. This is from source only: no test covers it, and it was not reproduced in a browser.
       - **Today's behaviour is pinned as the established contract** by:
         - `e2e/ridingLauncher.spec.ts` (~146–212, with its comment at ~174–178);
         - `e2e/ridingPauseAfterResume.smoke.spec.ts`;
         - `e2e/rideSessionSwitchGuard.spec.ts` (~338–372);
         - `e2e/androidPersistenceAndOffline.spec.ts`;
         - `App.test.tsx` and `RidingLauncher.test.tsx`;
         - [`docs/android-chrome-acceptance.md`](../../android-chrome-acceptance.md) (~105–111);
         - Session 1's item 72 cold-relaunch check in [`current-status.md`](../current-status.md).

         An implementation revises these deliberately, rather than leaving them to describe a removed path.
     - **The implementation plan must address, and this entry deliberately does not settle:**
       - loading and error presentation before restoration finishes;
       - navigation or session changes while restoration is pending;
       - the existing **Back to Ride options** action, avoiding automatic return loops or an unexplained duplicate paused-route view;
       - keeping route selection, free-roam entry and the ride-switch guards accessible;
       - regression coverage for restoration without tracking, an explicit Resume, Pause, navigation round trips and the recovery states.
     - **Not approved:** a different initial tab; any change to free roam; tracking started by restoration or by entering Ride; a new presentation of a paused ride.
     - **Evidence required when implemented:**
       - component and App-level tests;
       - browser coverage, in Chromium and WebKit, in English and German, of a real reload followed by entering Ride;
       - the unchanged `0.4.53` behaviour failing those tests;
       - negative controls;
       - then the installed-iPhone check after fully closing and reopening the PWA.

### Decisions made in planning (2 October 2026)

The specification left five points to the implementation plan. Reviewing that plan, the rider chose two wider options, then asked for three amendments before any code was written:

- **(a) Every open of a known paused ride restores deliberately**, not only the new cold-start entry. A Routes card, Planning's Open saved route, a switch prompt's Retry and Return to paused ride all hold their controls back until the session is restored, whenever their guard finds that same route stored. A fresh route still shows its pre-ride panel at once.
- **(b) A restored session always offers Resume ride and End ride**, with or without a fix, on every path. A ride paused before its first fix previously reopened as **Start riding**, with no End ride.
- **Amendment 1: the knowledge that a session is stored is kept independently of Pause and of the consumed resume instruction.** That knowledge must not be lost with the launcher Resume's one-use instruction, which item 131 retires once it is handled, and item 131's protection against restarting tracking must hold. The rider also asked for a targeted test of a departure from Ride without Pause.
- **Amendment 2: the whole no-fix lifecycle is tested automatically**, never by racing GPS on the phone:
  - a fresh ride paused before any fix;
  - a reload, and the actual saved session restored;
  - Resume ride and End ride offered;
  - End ride cancelled, then confirmed.
- **Amendment 3: no assumed flake allowance.** Each failure is inspected before it is classified, and a passing rerun alone never shows that a failure is pre-existing.

**Engineering choices, made in the plan and kept:**

- **The cold-start open is decided from the launcher's own check.** The launcher's loading, read failure with Retry, missing-route and unsupported-session presentations are therefore unchanged, and so is its generation guard, which discards a check that settles after the rider has left.
- **It is not a ride choice.** It takes no transition request id, so it can neither supersede nor withdraw a pending switch prompt.
- **It declines while a switch prompt is pending, staying armed.** The launcher's guarded Resume ride then remains the way on, and with it item 119's wait for an End and switch clear that is still in flight. The design stress-test found that the paused screen's own Resume, under a page-level dialog, could otherwise start tracking while that clear ran.
- **A session that has gone between the two reads returns the rider to the launcher.** Ended or replaced elsewhere, it is never shown as Start riding over whatever storage now holds.

### What the rider now sees

- **The first Ride entry after a cold start**, with a valid unfinished route ride:
  - "Checking for an unfinished ride…" while the launcher reads storage;
  - then the route's own paused screen, showing **"Restoring your unfinished ride…"** / **"Deine unbeendete Fahrt wird wiederhergestellt…"** while it restores;
  - then the paused panel: **Resume ride**, **Back to Ride options**, **Edit copy** and **End ride**, with the map, the route profile, and the status card's stale last fix and remaining distance.

  No location watch starts.

- **A failed read.**
  - The launcher's own check: its existing alert and Retry.
  - The screen's restoration: the existing alert ("Your ride could not be restored on this device. Try again."), with **Retry** and **Back to Ride options**.

  Neither offers Start riding, Retry never starts tracking, and nothing is cleared.

- **A missing route, an unsupported session or a free roam:** the launcher's existing branches, unchanged.
- **Back to Ride options:** the launcher's summary, for the rest of the app session, never returning to the paused screen by itself.
  - Its **Resume ride** still carries the one-use instruction of items 72 and 131.
  - Its **End ride** works as before, followed by Choose a route and Start free roam.
  - Routes and Planning keep their switch guards.
- **Later returns to Ride** while the route stays open: whenever a session is known to be stored, the screen shows "Restoring…" until that session is restored, then the paused panel. No watch starts.
- **Resume stays explicit.** The paused screen's **Resume ride** starts exactly one watch and Pause stops it; Routes → Ride stays paused; a second Resume and Pause behave the same.

### Implementation account (2 October 2026, `0.4.55`)

**`src/App.tsx`.**

- **One intent field.** The route content carries `intent?: { kind: "resume" | "restore"; token }` in place of `resumeIntentToken`, so the two kinds can never coexist. The tokens come from one monotonic counter.
- **Item 131 unchanged.** Its retirement now matches `intent.kind === "resume"`, and nothing else in it changed.
- **Arming.** `coldStartAutoOpenArmedRef` is armed when App mounts. It is disarmed synchronously by `openRideTarget`, through which every explicit open passes, and by the first launcher check that decides the auto-open.
- **`handleLauncherSessionChecked`** opens the route with a `"restore"` intent and returns true only when it has done so. It never records the Routes scroll position.
- **`handleRestoredSessionMissing`** returns to the launcher, but only for the content that still carries that exact token.
- **`handleStoredSessionKnown`** marks route content that carries no intent with a `"restore"` intent. It never replaces an intent already present, in particular a pending `"resume"` one.
- **No side effects inside state updaters.** These three are stable callbacks that read mirrors of the content and the pending prompt, kept in step by layout effects. Each decides outside any state updater and then applies an identity-guarded one, so Strict Mode's double invocation changes nothing.
- **Explicit opens stamp `"restore"`** whenever they classify as resume: `requestRouteTransition` without `stampResumeIntent`, `retryPendingSwitchCheck` for a route, and `returnToPausedRide`.

**`src/ui/riding/RidingLauncher.tsx`.**

- An optional `onSessionChecked(route | null)` is called once per successful check, inside the existing generation-guarded hydration.
- It is called with null for no session, a free roam, an unsupported kind and a missing route.
- Returning true keeps "Checking…" on screen while App replaces the launcher, so the summary never flashes.
- A failed read never calls it.

**`src/ui/riding/RidingScreen.tsx`.**

- `restoreIntentToken` is **fixed at its value at mount**. A token App adds while the screen is mounted is for the next mount: it would otherwise hide the controls of a mount whose restoration has already settled, possibly as a fresh route.
- While `isAwaitingRestoredSession`, the existing pending/alert block shows `riding.restoring` or the restore alert in place of the panel.
- Two effects report back: `onRestoredSessionMissing` and `onStoredSessionKnown`. The second is reported only while no resume token is pending, and it re-runs when item 131 retires that token.
- `hasResumableSession` (a fix, or a stored session) drives the Resume/Start label, its prompt and the panel's End ride.

**`src/ui/riding/useRideNavigation.ts`.**

- A new `hasStoredSession` is set after a restored match, a successful persistence write or a successful Pause, and cleared by `finish()`. It is never set optimistically.
- The restoration commit no longer writes the row back; see the next section.

**Copy.** `riding.restoring` is added in English and German. `messages.de.test.ts` pins the catalogue's plain-entry count literally, so it moves from 737 to 738.

### A pre-existing defect the new entry would have amplified: showing a paused ride rewrote its stored camera

**How it was found.** A revised item 131 App test began failing on the stored camera zoom: `cameraZoom` was 16, not the 15.5 it had seeded. That revision reaches the launcher through the paused screen, which adds one restoring mount.

**The mechanism.** Restoration applies the stored row in one commit. The persistence effect runs in that same commit, because its dependencies changed, and wrote the row straight back. It read the camera through `getCameraState()`, a ref that RidingScreen updates only in a later effect, before `useRideCamera` had applied the restored camera. Merely showing a paused ride's screen therefore replaced its stored camera with the default overview and no zoom.

**What it caused.** The next mount restored that default instead, and resuming then used the default follow zoom.

**It predates item 132.** On `0.4.54`, opening a paused ride from its Routes card rewrites the stored `cameraMode` from `following` to `overview` and `cameraZoom` from 15.5 to null. The new App test "merely showing a paused ride's screen leaves its stored camera state untouched" fails on `75094b0` with exactly that diff. Two Routes → Ride returns in a row already lost the rider's Follow zoom there. Item 132's first-entry screen adds a restoring mount on the most common path, so leaving it unfixed would have made the loss routine: for example, cold start → Ride → Back to Ride options → the launcher's Resume, or cold start → Ride → Routes → Ride → Resume.

**The fix.** Restoration now sets a ref that the persistence effect consumes first, so the restoration commit writes nothing; storage already holds exactly what was restored.

- **No lost write.** The effect always runs in that commit, because restoration replaces `coreState`, so a restored row without a fix can never leave the flag set to swallow a later write.
- **No rewrite merely by being shown.** One consequence: an older row is no longer normalised just by being shown. A row without `kind`, for example, keeps its stored shape until the next fix or Pause writes it, and the mapping already accepts such rows.

### Reachability: real rider paths and the one synthetic departure

**Leaving Ride without pressing Pause is not reachable in today's UI.** While tracking, the immersive shell removes the main navigation altogether (`immersiveRidingShell.ts`; `RidingScreen` reports `geolocationStatus !== "idle"` as active). The only in-app ways out of an active ride are therefore Pause and End ride. Amendment 1's knowledge is nonetheless independent of Pause, and the evidence keeps the two kinds of path apart.

**Real rider paths, tested with the real screen in App and in the browser:**

- cold start → Ride → Resume → Pause → Routes → Ride, with the remount's read held to show "Restoring…";
- launcher Resume, whose instruction is retired once handled → Pause → Routes → Ride, restoring first;
- a ride freshly started from its Routes card, whose first fix is stored → Pause → Routes → Ride, restoring first;
- Back to Ride options, and every recovery state.

**The synthetic departure without Pause.** This test runs App with a stub `RidingScreen` that never reports riding as active, so the navigation stays available while the stub "rides".

- **The sequence:** launcher Resume → the stub reports the instruction handled and the session known, as the real screen does once tracking has persisted → Routes → Ride.
- **What it proves:** App's bookkeeping only. The remount receives a `"restore"` token and no `"resume"` token, so there is no replay. A known-session report that arrives while the resume instruction is still pending never overwrites it.
- **The screen's half** — "Restoring…", then the paused panel, Retry and Back on failure, and no watch from a passive Retry — is proved by `RidingScreen` component tests of a mount carrying that token.

The synthetic test is labelled as synthetic in its own title and comments.

### Evidence — automated only

- **Component and App tests.**
  - `RidingLauncher.test.tsx`: 5 new tests for `onSessionChecked`.
  - `RidingScreen.test.tsx`: 8 new tests for the restore intent, the no-fix label and the known-session report.
  - `App.test.tsx`: 15 new tests in "first Ride entry after a cold start (item 132)".
  - `App.resumeIntent.test.tsx`: 4 new stub tests.
  - `App.planningSavedRoute.test.tsx`: 1 new test of Planning's path.
  - The full suite: 4,828 tests in 206 files, all passing, with `npm run lint`, `npm run typecheck` and `npm run build` clean.
- **Deliberate revisions.** These tests pressed "Resume ride" on the launcher. They now reach it through the paused screen's Back to Ride options, and press the launcher's own, scoped, so item 72's and item 131's instruction keeps being exercised; the paused screen's button has the same label. They are:
  - in `App.test.tsx`, item 72's contract test, both End-ride-from-resumed tests, the free-roam-unavailable test and item 131's describe, whose read-counting test now arms its counter only once the launcher shows;
  - item 131's two stub tests;
  - in `e2e/`: `ridingLauncher.spec.ts`'s cold resume and End-ride tests, `ridingPauseAfterResume.smoke.spec.ts`'s preparation and `rideSessionSwitchGuard.spec.ts`'s same-route launcher resume.

  `confirmationDialogs.smoke.spec.ts` needed no change, because a pending switch prompt keeps the launcher.

- **Browser: `e2e/coldStartPausedRoute.smoke.spec.ts`**, run in Chromium and WebKit in the pinned container, at 390 × 844. All 28 runs pass.
  - **English and German:**
    - a reload then Ride shows the full paused screen, with the remaining distance carried over, the stored row unchanged and no watch;
    - a failed launcher read, then Retry;
    - a failed screen restoration after the Ride-tab entry and after a Routes-card entry, then Retry;
    - the complete no-fix lifecycle.
  - **English only:**
    - Resume, Pause, Routes → Ride, a second Resume and a second Pause, with watch and clearWatch counts 1/1, then 2/2;
    - Back to Ride options with no return, sampled across Routes → Ride, and then the launcher's one-tap Resume;
    - a deleted route and an unsupported session;
    - Edit copy from the cold-start paused screen opening Planning with the copy.
- **Storage faults are synthetic.** An init script wraps `IDBObjectStore.prototype.get` for the `rideState` store and fails exactly the reads a test plans; no production seam was added. Its own control is the "failed check" test on `0.4.54`, which shows the launcher's existing check-failed alert before failing where the new behaviour begins.
- **The full browser suite** in the pinned container: all 820 tests pass (the existing 792 and these 28), with no retries, across the `chromium`, `webkit-smoke` and `android-chrome` projects.
- **Not device evidence.** A browser reload stands in for fully closing and reopening the PWA, and Playwright's geolocation is emulated.

### Baseline comparison (`0.4.54`, `75094b0`)

The rider asked for the comparison against `0.4.54`, the deployed build; the specification's own wording names `0.4.53`. The new tests ran against an unchanged worktree of `75094b0`, built and served on its own port.

| Tests run against `0.4.54`                                | Fail | Pass | Reason for the failures                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------- | ---: | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coldStartPausedRoute.smoke.spec.ts`, Chromium and WebKit |   26 |    2 | Ride shows the launcher's summary, so the paused screen's own route heading is missing. The Routes-card restoration failure shows **Start riding** with the start prompt and no alert, which until now was a source-only finding. The two passes are the deleted-route and unsupported-session regression test, in each engine. |
| App, "first Ride entry after a cold start"                |   12 |    3 | The same presentation difference; the stored camera rewritten, as above; no "Restoring…". The passes are the missing/unsupported/free-roam recovery, the Routes-card Back to Ride options case and the discarded late check — protections the baseline also has, covered instead by negative controls.                          |
| App, Planning's Open saved route of the paused route      |    1 |    0 | A failed restoration offers Start riding, with no alert.                                                                                                                                                                                                                                                                        |
| App, stub tests (`App.resumeIntent.test.tsx`)             |    6 |    0 | The first Ride entry shows the launcher, not the screen.                                                                                                                                                                                                                                                                        |

**Correcting a test that passed on the baseline.** The no-fix lifecycle test first passed on `0.4.54` in all four runs, because the launcher's summary also offers Resume ride and End ride for that session. It now requires the full paused screen, and fails there on the baseline.

### Negative controls

Each control was one temporary source mutation. It was run against the narrowest tests, then restored, and the file's SHA-256 was compared afterwards; every one matched.

| Mutation                                             | Tests that failed                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The arming check removed                             | Back to Ride options keeps the launcher (it bounced back to the paused screen); the stub's "Back to Ride options never reopens it" |
| No disarm in `openRideTarget`                        | After a Routes-card open, Back to Ride options keeps the launcher                                                                  |
| The panel not held back while restoring              | The component's pending-restoration test and the App "Checking, then Restoring" test (Start riding appeared)                       |
| The missing-session handler ignored                  | The replaced-session App test                                                                                                      |
| The pending-prompt check removed                     | The pending-prompt App test, and item 119's "Resume ride during an older End and switch's clear waits for it"                      |
| No mount latch                                       | The component's token-after-mount test; the App fresh-route return                                                                 |
| The label back to fix-only                           | Both component no-fix tests; the browser no-fix lifecycle in Chromium, English and German (Resume ride missing)                    |
| The screen never reports a known session             | Both App "returning to Ride restores first" tests; the component report test                                                       |
| App ignores the known-session report                 | The stub departure without Pause (no restore token); both App returns                                                              |
| The known-session report overwrites a pending resume | The stub departure without Pause                                                                                                   |
| The restoration write put back                       | The stored-camera App test; item 131's revised "fresh, explicit Resume" test (`cameraZoom` 16)                                     |

### A test defect found during verification

**What happened.** One full unit-suite run failed the new App test of the Routes-card and Return-to-paused-ride paths, but my output filter discarded its error. A rerun passing proves nothing, so the test was run six times in parallel under load, and it failed twice.

**The cause.** "Unable to find … button 'Route B'": the test clicked a route card synchronously after returning to Routes, before the library had listed its routes. This was a test-synchronisation defect, not a product one.

**The fix and its check.** The test now awaits the card, and it then passed 16 of 16 runs under the same parallel load. The other new tests passed 8 of 8 under that load.

### Findings worth carrying forward

- **Same-labelled buttons hide a change of path.** The launcher's and the paused screen's "Resume ride" share a label. After this change, most tests that pressed the launcher's still passed while pressing the screen's, which carries no instruction. Each was revised to scope its click to the launcher's region. Only one item 131 test failed loudly.
- **An effect that reads a ref written by a later effect reads the previous commit.** The restoration re-persist read the camera that way. Any new persistence path should be checked for the same ordering.
- **A callback that a hydration effect depends on must be stable.** An inline callback would re-read storage on every App render, and the reads would change the counts that item 131's tests rely on.

### Limitations, stated plainly

- **Automated evidence only so far.** A browser reload is not a device cold start, and desktop WebKit is not iOS Safari. Nothing is claimed for VoiceOver, iOS Larger Text, landscape or physical Android.
- **Item 131's own no-match is unchanged.** A launcher Resume whose session vanished before the screen restored still falls back to the ordinary panel for that route.
- **A pre-existing exposure, recorded and not fixed.** A page-level switch dialog can sit over an already open paused screen, and that screen's Resume ride is not disabled while an End and switch is clearing. The cold-start open avoids it by declining while a prompt is pending. Disabling in-screen Resume while a switch is busy would be separate work.
- **Back to Ride options is sticky for the app session.** After it, the paused screen returns only through a Routes card or the launcher's Resume ride.

### CI and deployment

This entry was written before the push. The CI run, its shards and the deployed build were reported in the handoff and are recorded here together with the device acceptance.

Run [37068927716](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37068927716), for commit `501e1d4`: **Verify and build, all four End-to-end shards and Deploy succeeded, each on its first attempt.** The durations come from the run's own job and step start and completion times, read once after the run and kept locally; Verify and build's test step is its unit and component tests, each shard's its end-to-end suite.

| Job              | Test step | Whole job |
| ---------------- | --------: | --------: |
| Verify and build |     168 s |     291 s |
| E2E shard 1/4    |     371 s |     433 s |
| E2E shard 2/4    |     465 s |     524 s |
| E2E shard 3/4    |     288 s |     350 s |
| E2E shard 4/4    |     437 s |     491 s |
| Deploy           |         — |      11 s |

The live bundle then contained `0.4.55` and `501e1d4`, and no longer the previous build `75094b0`. One run, so no trend is claimed.

### Installed-iPhone acceptance (reported 2 October 2026)

**Accepted** on the installed iPhone, on `0.4.55` (build `501e1d4`), in English and German: the ordinary flows and their visible behaviour, at product level. The verbatim report and what it does not establish — GPS-watch counts, induced storage failures, the no-first-fix lifecycle and a measured Follow-zoom result — are in the dated record in [`current-status.md`](../current-status.md). The automated evidence above is unchanged by it.

---

<a id="item-133"></a>

## Item 133 — Four end-to-end CI shards instead of two — done

_Category: CI infrastructure_

**Status: CI verified on 2 October 2026, in run 37055399688.** The workflow change and its local verification are below. When this record was first written, the first four-shard CI run had not happened, so it read "configured for four shards; CI verification pending". That run's outcome, each shard's test-step and whole-job duration against run 37048604312, and the deployed build are now recorded in [CI verification](#ci-verification--run-37055399688-2-october-2026), at the end of this entry.

133. **Four end-to-end CI shards instead of two — done**
     - Origin: the rider's decision, 2 October 2026, after item 124's D-06 repair (`0.4.54`) deployed. **Scheduled first** in the approved execution order (root [`CLAUDE.md`](../../../CLAUDE.md)), ahead of [item 132](#item-132). **CI infrastructure only:** no application behaviour, test, assertion or version change.
     - **Why now.** The latest successful run, [37048604312](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37048604312) (`041da6c`, `0.4.54`), took **14 min 48 s** (888 s) in its End-to-end test step and **15 min 56 s** (956 s) for the whole shard job, both in shard 2, against the E2E job's `timeout-minutes: 20`. Shard 1 took 603 s and 678 s. The suite was first split into two shards on 29 September 2026 (`bac3553`), when a single job reached that limit; [item 116](items-114-117.md#item-116) had kept the limit and asked for the suite to be optimised or sharded rather than given a bigger budget.
     - **Present facts, read from `.github/workflows/deploy-pages.yml` and `playwright.config.ts` at `041da6c`:**
       - the `e2e` job is a matrix `shard: [1, 2]`, named `End-to-end tests (shard N of 2)`, running `npm run e2e -- --shard=N/2` in the pinned Playwright container, with `fail-fast: false` and `timeout-minutes: 20`;
       - each shard uploads its failure evidence as `playwright-failures-<run id>-<attempt>-shard-<N>`;
       - Deploy's `needs: [verify, e2e]` requires Verify and build and every shard;
       - Playwright runs `fullyParallel` with no `workers` or `retries` setting, so each runner keeps Playwright's default worker count and no retries;
       - `playwright test --list` selects **792 tests** — 622 `chromium`, 124 `webkit-smoke`, 46 `android-chrome` — and `--shard=N/4` gives **198 per shard**. Shard 4 holds all the `webkit-smoke` and `android-chrome` tests plus 28 `chromium` tests; shards 1–3 are `chromium` only. Sharding divides by test count, so equal counts do not guarantee equal durations.
     - **Approved change:** four shards, through Playwright's existing `--shard` mechanism: the matrix, the shard denominator, the job names, and the current documentation that describes two shards.
     - **Must stay unchanged:** the 20-minute job limit; per-runner worker behaviour; every browser project and test; retries; failure traces, screenshots and uniquely named per-shard artefacts; `fail-fast: false`; Deploy requiring Verify and build and every E2E shard; the pinned toolchain, container and dependencies; the application version.
     - **Not approved:** test-flake repairs, assertion changes, a new reporting system, a timeout change, or any part of item 132.
     - **Evidence required:**
       - the unsharded test inventory equal to the combined inventories of shards 1/4 to 4/4, with every test/project combination exactly once;
       - workflow and formatting validation;
       - a CI run of the commit in which Verify and build and all four shards pass and Deploy succeeds, the deployed version still `0.4.54` and the build ID that commit's;
       - each shard's test-step and whole-job duration, compared with run 37048604312.

       Timings from four shards competing on one local machine are not evidence of GitHub runner performance. **No halving is promised**: if the longest shard stays close to the limit, its measured bottleneck is explained before any further change is proposed.

     - **No installed-iPhone check:** nothing on the device changes.

### Implementation account (2 October 2026)

- **The change**, in `.github/workflows/deploy-pages.yml` only: the `e2e` matrix becomes `shard: [1, 2, 3, 4]`, the job name `End-to-end tests (shard N of 4)`, and the test step `npm run e2e -- --shard=N/4`. The comment above the job now records two shards since `bac3553`, four since this item, and that the denominator appears in three places that must agree.
- **Unchanged:**
  - the job's `timeout-minutes: 20` and `fail-fast: false`;
  - the pinned container image and digest, the toolchain and `expected_playwright` checks, `npm ci` and the build;
  - the failure-evidence upload, whose name `playwright-failures-<run id>-<attempt>-shard-<N>` is already unique per shard;
  - `playwright.config.ts`, so each runner keeps the default worker count, no retries, CI-only traces, failure screenshots and every project;
  - the Verify and build and Deploy jobs. Deploy's `needs: [verify, e2e]` requires every matrix shard;
  - the application version, `0.4.54`.
- **Other consumers checked.** `main`'s branch protection requires no status checks, and its ruleset only blocks deletion and non-fast-forward pushes, so the renamed jobs break nothing on GitHub. `.github/dependabot.yml` names no job, and nothing else in the repository reads the job names or the shard count.
- **Not changed:** no test, assertion, timeout, retry or reporter; no flake repair; nothing of item 132.

### Evidence — local, before the push

- **Test inventory.** `CI=1 playwright test --list --reporter=json`, unsharded and for each of `--shard=1/4` to `4/4`, each test keyed by project, file, line, column and title path:
  - 792 tests in 77 files unsharded — 622 `chromium`, 124 `webkit-smoke`, 46 `android-chrome`;
  - 198 tests in each shard; shards 1–3 are `chromium` only, and shard 4 holds all 124 `webkit-smoke` and 46 `android-chrome` tests plus 28 `chromium`;
  - the four shards together equal the unsharded set: none missing, none extra, none in two shards and none twice within a shard. The two-shard split (396 + 396) matches in the same way, as a control.
  - **The checker's own controls fail as they must:** shards 1–3 alone report 198 missing, shard 1 counted twice reports 198 duplicated, and one test removed from shard 4 reports 1 missing.
- **Workflow structure**, parsed with PyYAML and compared with the parent commit:
  - the matrix is `[1, 2, 3, 4]`, and the denominators in the job name and in `--shard` equal its length;
  - `fail-fast` is false and the limit is 20 minutes;
  - the container, the upload step, the Verify and build and Deploy jobs, the triggers and the permissions are identical, and nothing else in the `e2e` job differs.

  Three controls each fail the check: a `/2` denominator, a three-entry matrix and `fail-fast: true`. `actionlint` is not available here and was not run.

- **Formatting:** `npm run format:check` and `git diff --check`.
- **No local end-to-end run** was made for this workflow-only change, and no local four-shard timings were taken: four shards competing on one machine say nothing about GitHub's runners.

### Limitations, stated plainly

- **Equal counts, not equal durations.** Playwright divides `fullyParallel` tests by count, so shard 4 carries every `webkit-smoke` and `android-chrome` test. Whether that makes it the longest shard, and how much headroom four shards leave under the 20-minute limit, is for the CI timings to show. No halving of runtime is claimed. The first run's answer is under [CI verification](#ci-verification--run-37055399688-2-october-2026) below: shard 2, not shard 4, was the longest.
- **The counts will change** as tests are added. They are recorded here as measured on 2 October 2026, not as a standing rule.
- **Four runners per push instead of two.** Each shard repeats container start-up, `npm ci` and the build — about 70 s per shard in run 37048604312.

### CI verification — run 37055399688 (2 October 2026)

Run [37055399688](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37055399688), for commit `75094b0`: **Verify and build, all four End-to-end shards and Deploy succeeded, each on its first attempt.** Verify and build took 287 s and Deploy 11 s. The deployed application was `0.4.54`, build `75094b0`: the version unchanged, as intended, and the build ID this commit's. The durations below come from the run's own job and step start and completion times.

| Shard | Tests                                                         | Test step | Whole job |
| ----- | ------------------------------------------------------------- | --------: | --------: |
| 1/4   | `chromium` only                                               |     338 s |     398 s |
| 2/4   | `chromium` only                                               |     458 s |     523 s |
| 3/4   | `chromium` only                                               |     270 s |     352 s |
| 4/4   | every `webkit-smoke` and `android-chrome`, plus 28 `chromium` |     445 s |     512 s |

- **Against run 37048604312** (two shards, `041da6c`):
  - the longest whole job fell from **956 s to 523 s**, leaving **677 s** under the 20-minute (1,200 s) limit, where the two-shard run left 244 s;
  - the longest test step fell from 888 s to 458 s.
- **The longest shard was 2, which runs Chromium only, not shard 4**, which carries every WebKit and Android test. The limitation above left this open, and equal test counts did not give equal durations. Why shard 2's 198 tests took the longest was not investigated.
- **Parallelism, not speed.** The four test steps sum to 1,511 s, against 1,491 s (603 s + 888 s) for the two-shard run, so the suite's own work is unchanged and the gain is that the work is spread over four runners. Each shard still spends 60–82 s outside its test step, on container start-up, `npm ci` and the build.
- **One run per configuration.** Every figure here comes from a single run, so none of it is a measured trend or a stable margin, and runner speed varies between runs. No further sharding or optimisation is requested.
