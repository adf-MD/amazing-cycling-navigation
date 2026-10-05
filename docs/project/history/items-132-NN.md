# Completed backlog items 132–

This file continues the 100– numeric range and opens at item 132. It was started when item 132 was completed (2 October 2026, `0.4.55`). Its entry belongs before item 133's in numeric order, and adding it to what was then `items-118-NN.md` would have taken that file to about 176,000 characters, past the ~150,000-character soft cap documented in [`README.md`](README.md). That file was therefore closed at item 131 and renamed [`items-118-131.md`](items-118-131.md), and item 133's entry — completed earlier the same day as a CI-only change — moved here unchanged apart from its link to item 132, which now points within this file. No entry was shortened or rewritten by that split. Stable item numbers never change regardless of which file their text lives in: item 133 was completed before item 132 and is filed after it, since a number is an identifier and never a schedule. Item 141 — implemented in `0.4.63` on 5 October 2026, with its installed-iPhone acceptance pending — follows them, moved from `backlog.md` under the same convention.

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

---

<a id="item-141"></a>

## Item 141 — A compact Edit copy notice in Planning — implemented, device acceptance pending

_Category: Planning layout_

141. **A compact Edit copy notice in Planning — design candidate, coordinated with item 122**
     - **Origin: the rider's observation, reported 5 October 2026**, verbatim:

       > The "you edit a copy" message above the screen is pretty big and takes a considerable amount of vertical space.

       It is a rider observation about the Planning layout, **not a measured defect**. No version, build, language or pixel measurement was supplied with it, and none is assumed.

     - **The notice today (source).** When Planning holds an Edit copy draft, `PlanningScreen.tsx` renders one `status-row status-row--info` paragraph with `role="status"` between the Planning heading and the map. `describeEditCopyNotice()` chooses exactly one of four catalogue strings (`planning.editCopy.*` in `src/i18n/messages.{en,de}.ts`) from the draft's stored provenance:
       - **exact:** an editable copy created from the route's original planning waypoints; the saved route will remain unchanged;
       - **estimated:** the editable waypoints were estimated from the route; recalculation may follow different roads; the saved route will remain unchanged;
       - **reversed, exact** (legacy draft rows written by `0.3.17`–`0.3.28` only): a reversed editable copy; recalculate before saving, because one-way restrictions may make the new route differ from the original; the saved route remains unchanged;
       - **reversed, estimated** (legacy): the reversed waypoints were estimated; recalculation may follow different roads, especially around one-way restrictions; the saved route remains unchanged.

       Its contract, from [item 26](items-06-29.md#item-26) and [item 38](items-30-38.md#item-38): a small, persistent informational notice; it survives unrelated edits; it narrates how the draft was seeded, not later edits; and corrupt stored metadata suppresses it rather than showing a wrong one.

     - **Why it is linked to [item 122](../backlog.md#item-122).** The notice sits above the map, so its full height pushes the map and **Calculate route** down the first screen. Item 122's measurements were made without it, and the rider's layout decision depends on the space it takes.
     - **Approved design direction (the rider, 5 October 2026):**
       - no automatic, timed disappearance;
       - a compact, persistent indication that the draft is an editable copy;
       - the full explanation in a nearby disclosure, closed by default;
       - the important qualification about estimated waypoints kept visible rather than hidden behind the disclosure — both that the waypoints were estimated and that recalculation may follow different roads;
       - the meaning of every existing variant preserved, the legacy reversed-copy cautions included.
     - **Still open, for visual review:** the exact placement; the English and German labels and their wrapping ("Editing a copy" and "Copy details" are suggestions, not approved catalogue wording); the accessible name, and where, if anywhere, the `role="status"` announcement belongs.
     - **Not authorised:** any change to draft provenance, persistence, editing, recalculation, saving or the source route — this is presentation only. It is design work coordinated with item 122 and considered before that item's final layout decision. Filing it schedules no implementation, and its sequencing is decided with item 122's decision, never ahead of the approved order in the root [`CLAUDE.md`](../../../CLAUDE.md).
     - **When implemented, the tests that assert the notice are updated deliberately, never relaxed:** `e2e/editRouteAsPlanningCopy.spec.ts`, `e2e/reverseRoute.spec.ts`, `e2e/clearPlanningDraft.spec.ts` and `e2e/editCopyBusyState.smoke.spec.ts` (English and German, also run in WebKit); `src/ui/planning/PlanningScreen.test.tsx`, `PlanningScreen.draftHydration.test.tsx`, `PlanningScreen.clearDraft.test.tsx` and `PlanningScreen.reverseRoute.test.tsx`. Three hazards:
       - a negative check (`not.toBeVisible`, `toBeHidden`, `/editable copy/i`) would pass vacuously once the full text sits in a closed disclosure, so it must target the new indicator;
       - a DOM-presence check stops proving visibility if the panel is hidden;
       - a heading-by-name query needs any new control kept outside the `h1`.

       The evidence then covers English and German, 200% text and the installed PWA's safe-area insets.

     - **Visual proposal, 5 October 2026 — design only, nothing implemented** ([report](../../design/planning-map-area/copy-notice-and-map-size.md)), measured with item 122's intermediate map sizes. It proposes:
       - the indicator as a disclosure button in the heading's row;
       - a visible qualifier for estimated and legacy reversed copies;
       - today's full text in a panel closed by default.

       The rider's combined notice and layout decision is awaited.

     - **Direction approved, 5 October 2026** ([record](../../design/planning-map-area/copy-notice-and-map-size.md#approved-direction-and-the-calculate-first-comparison-5-october-2026)): the compact notice as proposed, with full stops in the short qualifiers and the polite announcement kept, separately from the disclosure button. It is the first of the two intended implementations, before item 122's map and layout change. Nothing is implemented yet.
     - **Final decisions, 5 October 2026** ([record](../../design/planning-map-area/copy-notice-and-map-size.md#final-design-decisions-5-october-2026)). To be implemented first, before item 122. These are design approvals, not device acceptance:
       - the approved structure and labels, with "Editing a reversed copy" / "Umgekehrte Kopie in Bearbeitung" for legacy reversed drafts;
       - the English and German full-stop qualifiers;
       - the button's accessible name as its visible label;
       - a non-live panel rendered only while open;
       - a stable, initially empty, visually hidden `role="status"` with `aria-atomic="true"` for the announcement.

       Possible duplicate screen-reader reading while the panel is open is not approved; it is an unverified limitation for the VoiceOver check.

### Implementation account (5 October 2026, `0.4.63`)

The rider's [final design decisions](../../design/planning-map-area/copy-notice-and-map-size.md#final-design-decisions-5-october-2026) of the same day, implemented as presentation only. Item 122's map height, enlarged-text mechanism and action order are untouched; they are the next slice.

**What the rider now sees,** while Planning holds an Edit copy draft:

- **Beside "Plan a route" / "Route planen":** a compact button, "Editing a copy" / "Kopie in Bearbeitung" with a chevron. A legacy reversed draft shows "Editing a reversed copy" / "Umgekehrte Kopie in Bearbeitung". The button sits in the heading's row and wraps below the heading only when the row cannot hold both.
- **Below that row, for estimated and legacy reversed copies only:** the short qualifier, as approved. For example, "Waypoints estimated. Recalculation may follow different roads." / "Wegpunkte geschätzt. Die Neuberechnung kann andere Straßen wählen." An exact copy shows no qualifier.
- **Pressing the button** opens a panel below the row with **today's full explanation, unchanged**, and hides the qualifier. Pressing it again closes the panel and brings the qualifier back.
- **The panel is closed** on every arrival in Planning, after a reload, and whenever the copy's metadata is cleared or replaced. Nothing disappears on a timer.

**`src/ui/planning/PlanningScreen.tsx`:**

- **The meta type.** The inline meta type became `interface EditCopyMeta`, a type-only change.
- **`describeEditCopyIndicator`** returns the label and the qualifier, or `null` for an exact forward copy. It sits beside `describeEditCopyNotice`, which is unchanged.
- **The open state** is `copyDetailsOpenFor`, the meta object the panel was opened for:
  - `isCopyDetailsOpen` holds only while it is the current `editCopyMeta`, so a cleared or replaced meta starts closed without an effect;
  - it is held apart from `editCopyMeta` because the autosave effect depends on `editCopyMeta`, so toggling can never schedule a draft write;
  - the meta's one writer is hydration, which runs at most once per mount, and Planning unmounts on navigation.
- **The heading block,** a `.planning-heading` wrapper:
  - the title row, holding the `h1` and, for an edit copy, the button;
  - the qualifier while closed;
  - the announcement;
  - the panel while open.

  Every child keeps a fixed position, so React never turns one paragraph into another. The block now precedes `NoApiKeyNotice`; no test depends on that order.

- **Unchanged:**
  - `describeEditCopyNotice` and its four catalogue strings;
  - hydration, autosave, Save and Clear draft, and the persistence of the copy metadata (`editCopySourceRouteId`, `editCopyWaypointsOrigin`, `editCopyOperation`);
  - the map container and the enlarged-text logic.

**Accessibility, as decided:**

- **The button:**
  - its accessible name is its visible label only, because the chevron is `aria-hidden`;
  - `aria-expanded` gives its state;
  - `aria-controls` names the panel only while the panel is open, following the repository's disclosure convention (`RouteLibrary.tsx`, `RidingUntrustedGpxNotice.tsx`).
- **The panel** exists only while open and is not a live region.
- **The announcement** is a visually hidden `<p role="status" aria-atomic="true">`.
  - It is rendered from Planning's first render and stays empty until the asynchronous hydration sets the meta, so the region exists before its message (W3C's technique ARIA22).
  - Its text then follows the meta alone: the full explanation until Save or Clear draft empties it.
  - Neither ordinary edits nor opening and closing the panel touch the node or its text.

**`src/index.css`,** at the top of the Planning section, with these rules:

- **`.planning-heading`:** a flex column with a 4 px gap.
- **`.planning-title-row`:**
  - flex and wrap, with a 12 px column gap and a 4 px row gap;
  - **no `min-height`**, so an ordinary draft's row is exactly the `h1`.
- **`.planning-copy-toggle`:**
  - inline-flex, with the info colours;
  - 0.9rem text and `--radius-sm`;
  - 4 px by 12 px padding, so a label wrapped at 200% clears the border;
  - the global 44 px minimum, and no `nowrap`.
- **Its chevron:** it mirrors `.tag-disclosure-chevron`'s 180° rotation. The global reduced-motion rule covers its transition.
- **`.planning-copy-qualifier`:** 0.85rem text in the info colour.

No map, enlarged-text or action rule changed.

**Catalogues, `messages.en.ts` and `messages.de.ts`:**

- **Five keys:** `planning.editCopy.indicator` and `.indicatorReversed`, and `.qualifierEstimated`, `.qualifierReversedExact` and `.qualifierReversedEstimated`. Their wording is the approved table.
- **`messages.de.test.ts`:** the pinned plain count is now 743, up from 738.

**Version** `0.4.63`.

### Evidence — automated only

**Unit tests** (Vitest): the four Planning notice suites and the three catalogue guards, **7 files and 369 tests, all passing**. The guards are `messages.de.test.ts`, `residualCopyAudit.test.ts` and `planningCopyMigration.test.ts`.

- **A shared helper, `src/test/editCopyNotice.ts`,** now carries every existing notice assertion, deliberately and never relaxed. It checks:
  - the indicator, by its exact name, collapsed and outside the `h1`;
  - the qualifier, or its absence;
  - no panel;
  - exactly one atomic, visually hidden status holding the full text.

  Its absence check names the indicator, the qualifier, the panel and the announcement's text one by one.

- **Vacuous checks replaced.** `/editable copy/i` cannot match "Editing a copy", so the old absence checks would have passed against the new indicator.
- **New cases:**
  - the toggle by click, Enter and Space, with focus kept on the same button, `aria-controls` naming the panel only while open, a role-less panel and the qualifier hidden and restored;
  - zero mutations of the announcement's node across toggles, Reverse route, a rename and an added waypoint, with the panel kept open across Reverse;
  - the region present and empty before a delayed hydration, and the same node then receiving the text;
  - a German render with no English leaks.

**Browser tests,** in the CI image by digest (`mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294a…`):

- **The new `e2e/editCopyNotice.smoke.spec.ts`: 22 of 22** (11 cases in Chromium and WebKit). It covers:
  - **every variant in English and German, at ordinary and 200% text,** closed and open: names and states, the qualifier, no horizontal overflow, everything inside the content box, text unclipped and the 44 px target;
  - **a 320×568 German reversed case** at 200% text;
  - **pointer, Enter and Space** toggles on representative cases, from the top and from a 12 px scrolled start. In each, `scrollY` and the button's position are unchanged and focus does not move elsewhere;
  - **the announcement:** first seen empty, then the same node with zero mutations across toggles and Reverse route;
  - **persistence:** no draft writes over a second of toggling, and closed again after leaving Planning and after a reload;
  - **the synthetic 47/34 insets case;**
  - **a structural guard for ordinary drafts:** the heading block is exactly the `h1`, followed by the usual 16 px gap.
- **The five updated specs: 94 of 94.** `editCopyBusyState.smoke` and `coldStartPausedRoute.smoke` ran in both engines; `editRouteAsPlanningCopy`, `reverseRoute` and `clearPlanningDraft` ran in Chromium.
- **Static checks:** lint, typecheck (`tsc -b`) and the production build pass.
- **Not run locally,** by the slice's proportionate scope:
  - the full unit suite and the full browser suite (CI runs both);
  - negative controls: the indicator and qualifier these checks require do not exist in `0.4.62`.

### Findings worth carrying forward

- **Playwright counts the 1×1 visually hidden announcement as visible,** so `getByText(fullText).toBeVisible()` would pass without the rider seeing anything. The helpers assert the indicator and qualifier for what is visible, and the announcement's text separately.
- **"Kopie in Bearbeitung" is a substring of "Umgekehrte Kopie in Bearbeitung",** so every Playwright role query here is `exact: true`.
- **Planning now always contains one empty `role="status"`.** Every existing status query on Planning filters by its text, so none gained a match.
- **Linux WebKit focuses a clicked button; iOS Safari does not.** Pointer checks therefore accept focus on the button or unchanged, never anywhere else. Keyboard checks require the button.

### Limitations, stated plainly

- **No screen reader was available.** Names, states and the live region's structure are asserted in the DOM, but what VoiceOver announces is unverified, including:
  - whether it speaks the arrival announcement;
  - whether it reads the full text twice while the panel is open, once from the announcement and once from the panel. This possible duplicate reading is **not** an approved behaviour; it is a limitation for the VoiceOver check.
- **Focus can fall to `<body>`.** If Save or Clear draft completes while focus is on the indicator, the button is removed and focus falls to `<body>`. That is the kind of focus continuity [item 135](../backlog.md#item-135) investigates. It is not rider-accepted and not fixed here.
- **Assumed environment:**
  - the 47/34 insets are assumed iPhone values;
  - 200% root text in the container's fonts is not iOS Larger Text, and container fonts have not predicted iOS widths before;
  - there is no physical Android evidence.
- **Legacy reversed variants** are reachable only from draft rows written by `0.3.17`–`0.3.28`, so their evidence is automated only.

### CI and deployment

This entry was written before the push. The CI run, its shards and the deployed build are reported in the handoff and recorded here together with the device acceptance.

### Installed-iPhone acceptance — pending

Session 5 of [`current-status.md`](../current-status.md). Item 122's implementation waits for this acceptance.
