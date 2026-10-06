# Completed backlog items 132–

This file continues the 100– numeric range and opens at item 132. It was started when item 132 was completed (2 October 2026, `0.4.55`). Its entry belongs before item 133's in numeric order, and adding it to what was then `items-118-NN.md` would have taken that file to about 176,000 characters, past the ~150,000-character soft cap documented in [`README.md`](README.md). That file was therefore closed at item 131 and renamed [`items-118-131.md`](items-118-131.md), and item 133's entry — completed earlier the same day as a CI-only change — moved here unchanged apart from its link to item 132, which now points within this file. No entry was shortened or rewritten by that split. Stable item numbers never change regardless of which file their text lives in: item 133 was completed before item 132 and is filed after it, since a number is an identifier and never a schedule. Item 141 — completed in `0.4.63` on 5 October 2026 and accepted on the installed iPhone the same day — follows them, moved from `backlog.md` under the same convention. Item 134 — implemented in `0.4.67` on 6 October 2026 and accepted on the installed iPhone the same day — moved here from `backlog.md` on that day, under the same convention. Item 139 — implemented in `0.4.68` on 6 October 2026, with its installed-iPhone acceptance pending — moved here from `backlog.md` the same day, under the same convention, and is filed between items 134 and 140 in numeric order. Item 140 — completed in two slices, `0.4.65` and `0.4.66`, both accepted on the installed iPhone on 6 October 2026 — moved here from `backlog.md` on that day under the same convention and is filed before item 141, in numeric order, although item 141 was completed first.

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

<a id="item-134"></a>

## Item 134 — Resume ride offered while a confirmed End ride is still finishing — done

_Category: Riding lifecycle_

**Status: done — implemented in `0.4.67` on 6 October 2026, and its ordinary flows accepted on the installed iPhone in German and English, reported the same day, on build `9f73242`** ([acceptance](#installed-iphone-acceptance-reported-6-october-2026)). The investigation its scheduling approved was made on 6 October 2026 on `c2cb9e6` (`0.4.66`), and the rider approved the change the same day. The entry moved here from `backlog.md` with its implementation, as item 141's did. Item 134 stayed first in the execution order until its device acceptance; it is now removed from the order, which is 139 → 125 → 103 → 120. The specification below is as filed; the investigation, decisions, implementation, evidence, CI and acceptance follow it.

134. **Resume ride offered while a confirmed End ride is still finishing — defect investigation**
     - Origin: observed while implementing item 124's slice 9 (`0.4.60`, 3 October 2026) and recorded in its [limitations](item-124-continued.md#slice-9--confirmations-closed-by-a-ride-transition-c-10-c-11-c-12-shipped-0460-3-october-2026). The rider's direction of 4 October 2026 asked that it get its own disposition; the [reconciliation](../../design/reveal-inventory/closure-reconciliation.md) sends it here. **Recording it here does not mean it is fixed or accepted.**
     - **Scheduled on 5 October 2026**, second in the approved execution order, after item 140 and before items 139, 125, 103 and 120, by the rider's decision ([order](../../../CLAUDE.md)); it was unscheduled until then. **Scheduling approves the investigation, not the candidate below or any other change.** **Update, 6 October 2026:** with item 140 completed, it is first in the order, ahead of items 139, 125, 103 and 120.
     - **Present facts, from source (`src/ui/riding/RidingScreen.tsx`, at `e2ba7cf`):** after End ride is confirmed on the paused screen, its confirmation reads "Ending ride…" with both actions disabled, and **Back to Ride options** is disabled while the ending runs (`activeFinalizeSource !== null`). The panel's **Resume ride** has no such condition and stays enabled.
     - **What a component test shows, with a synthetic hold:** `RidingScreen.finishEndRide.test.tsx` ("keeps a confirmed End ride's confirmation, still ending, when Resume ride is pressed while it runs") holds the stored session's clear open. Pressing **Resume ride** then starts riding: the riding header and **Pause** appear, with "Ending ride…" carried below it. Once the clear is released, the screen returns to the pre-ride state with **Start riding**. Slice 9 kept that behaviour and changed nothing else.
     - **Not established:** whether a rider can reach the window on a device, since how long the clear takes there is unknown; whether a fix accepted inside the window writes anything to storage after the clear; whether the location watch is always stopped; and how item 131's one-use resume instruction behaves there. It has not been reproduced in a browser or on the installed iPhone.
     - **A candidate, not a decision:** keep **Resume ride** unavailable while an End ride finishes, as **Back to Ride options** already is.
     - **Evidence required when resolved:** a component test and a browser test, in Chromium and WebKit, that each hold the clear; the stored session read after the release; a negative control; and the installed-iPhone End ride check.

### Investigation — the baseline, measured on `c2cb9e6` (6 October 2026)

**Method.** Two temporary diagnostics, removed afterwards and never committed: a component test on the real database (Dexie on fake-indexeddb), and a browser test in Chromium and WebKit, in the CI image by digest, on a fresh build. Each held the End's conditional clear behind a real readwrite transaction on `rideState` (`holdIdbStore` in the component, an in-page equivalent in the browser), counted `watchPosition` and `clearWatch` calls and `rideState` writes, and read the stored row only once the hold had been released.

**The failure fixture.** An interceptor aborted the transaction of the next delete issued on `rideState`, at the moment it was issued. The conditional clear reads before it deletes, so its delete is issued only once the hold is released: a fixture aborting deletes captured while the store was held would have caught nothing and let the clear succeed — the rider's correction of the first plan. In every run the clear's own transaction was confirmed captured and aborted, and it never completed, before any result was read as a failure.

**Findings**, the same in both engines and in the component:

- **Reachable:** while "Ending ride…" showed on the full paused-route screen, Resume ride stayed enabled although Back to Ride options was disabled. A tap started one location watch, switched to the immersive riding shell — main navigation hidden, Pause disabled — and carried "Ending ride…" into the riding header.
- **Writes during the window:** fixes accepted then caused no write at all — no call to the write function and no `put` request on `rideState` — because `isFinalizingRef` stops the persistence effect.
- **A successful End:** the clear reported "cleared", the watch was cleared, and App showed the empty Ride launcher. The stored row stayed absent over repeated reads, after a later fix and after a reload.
- **A failed End:** the ride carried on. The watch stayed live, "The ride could not be ended on this device. Try again." appeared in the riding header — item 139's layout — and the next fix wrote the session back, with the same `sessionId`. Without the Resume tap, the paused screen showed the error under its button, Resume ride was available, nothing was tracked and the row was unchanged.
- **A refused End** (a newer session stored first): "session-gone". The watch was cleared, the screen handed back, and the Ride launcher showed the existing notice; the newer row was untouched.
- **Other entry points, none of which offered tracking during the End:**
  - **Leaving for Routes and returning to Ride:** while the clear was held, the remounted screen showed "Restoring your unfinished ride…" with no start control; after release, the Ride launcher. No watch, nothing stored.
  - **Opening another route from Routes:** 800 ms after its card was tapped, with the clear still held, Routes was still shown, with no target screen and no Start control. After release the target's pre-ride screen appeared, ready to start, with no watch. That matches the storage ordering: App's check before opening a route (`getActiveRideStateWithSessionId`, which reads first) queues behind the clear's readwrite transaction. The latency from release to display was not measured.
  - **A `visibilitychange`** on the paused screen, before or during the End, started nothing.
  - **From source:** the status card's Try again appears only when location tracking has failed, never on the idle paused screen; and item 131's one-use resume instruction is consumed before the paused panel, and its End ride, are shown.
- **The existing component test** that pressed Resume during an End mocked the clear's result. The mocked "cleared" deleted nothing, so the real stored row survived it: that test could say nothing about storage.
- **No storage loss or recreation was observed in these measured cases.** What they showed was a tracking and presentation problem: a tap during the End briefly started a location watch — on the iPhone, possibly a permission prompt — and switched the screen, and a failing End then left the ride running.

### The rider's decisions (6 October 2026)

- Resume ride on the full paused-route screen is disabled while a confirmed End ride is finishing, with `disabled={activeFinalizeSource !== null}`, as Back to Ride options is.
- A successful End returns to the empty Ride launcher.
- A failed End keeps the stored session, keeps the screen paused with the existing error, and makes Resume ride available again; tracking restarts only when the rider chooses Resume.
- A refused End keeps item 140's retirement and hand-back.
- Resume ride stays available while an End confirmation is still unconfirmed, and item 124's quiet closing of that confirmation when Resume succeeds is kept.
- Edit copy stays outside item 134; its availability during an End is recorded as an unmeasured observation.

### Implementation (`0.4.67`, 6 October 2026)

- **One change:** `src/ui/riding/RidingScreen.tsx` gives the paused panel's Resume ride `disabled={activeFinalizeSource !== null}`. No label, confirmation behaviour, layout, focus policy, navigation hook or App code changed, and item 140's identity checks, atomic clears, cancellation of pending writes, retirement and hand-back are untouched.
- **Against the baseline:** while an End finishes, Resume ride is unavailable and the screen no longer switches; a failed End now leaves the ride paused, where a Resume in the window used to leave it running. Successful and refused Ends end as before.

### Evidence — automated only

- **Component**, a new describe in `src/ui/riding/RidingScreen.finishEndRide.test.tsx`, on the real database with `holdIdbStore`:
  - **success:** Resume ride is disabled while the clear is held and a tap starts no watch; after release the screen returns to its pre-ride state, and the stored session stays absent over repeated reads, with still no watch;
  - **failure:** the clear's own transaction is aborted as its delete is issued, and asserted captured, aborted and never completed; the error shows on the paused panel, the stored session equals its snapshot from before the End, and Resume ride is enabled with no watch. Pressing it starts exactly one watch, and a fix then persists the same `sessionId`;
  - **refusal:** Resume ride is disabled during the End; `onSessionGone` is called once, no watch starts, and the newer session is untouched.
- **Replaced by intent:** the decision-4 test "keeps a confirmed End ride's confirmation, still ending, when Resume ride is pressed while it runs". The transition it asserted — the confirmation carried into the riding header by a Resume — is no longer available. Its replacement checks that the confirmation stays in the paused panel, still ending, with Resume ride disabled. The decision-4 tests in which Resume ride succeeds while End ride's confirmation is still unconfirmed, and that confirmation closes quietly, are unchanged. No other unit or browser test encoded the old behaviour.
- **Browser**, `e2e/resumeDuringEndRide.smoke.spec.ts`, in Chromium and WebKit, in the CI image by digest, on a fresh build:
  - **success:** Resume ride is disabled and never clicked; no watch is added while the location moves; then the Ride launcher, with the row absent after release and after a reload;
  - **failure:** the fixture's validity is asserted; the error shows on the paused screen, the row equals its snapshot, and Resume ride is enabled. A real Resume then starts exactly one watch, and a moved location persists the same `sessionId`; after a reload the paused screen offers Resume ride.
- **Negative control:** only the new `disabled` removed.
  - In the component, all four tests that check it — the three new ones and the replaced decision-4 test — failed at their Resume ride `toBeDisabled()` assertion, before any watch or storage check.
  - In the browser, the control build compiled (exit 0, with its own asset hash) and was served by a newly started preview server; both tests failed in both engines at `toBeDisabled()` ("Received: enabled").
  - The line was restored by edit, its SHA-256 matched the fixed file, and the rebuilt application passed.
- **Also run, once:** the three complete `RidingScreen` unit files and the catalogue guards (673 tests); the new spec with `endRidePausedConfirmationReveal`, `editCopyConfirmationReveal`, `coldStartPausedRoute`, `ridingPauseAfterResume` and `staleSessionActions` in both engines and `ridingFinishAndEnd` in Chromium (138 runs); lint, typecheck, the build, links, whitespace and formatting.

### Limitations and observations

- **The held window and the synthetic failure cannot be induced through an ordinary phone checklist** and keep automated evidence only. Whether a naturally slow End shows the pending state on an iPhone is unmeasured.
- **Edit copy stays available while an End ride finishes.** Read from source, not measured; it starts no tracking, it is unchanged by item 134, and no defect is claimed.
- **Slice 9's guard**, which keeps a confirmation that is still ending when a ride transition happens, is unchanged; from source, no ordinary path reaching it is known after this change.
- VoiceOver, enlarged text and physical Android are not covered, and focus after an End is [item 135](../backlog.md#item-135)'s.
- **CI:** the first run failed in an unrelated, long Planning test, and a test-only repair followed ([below](#ci-run-37483537843-failed-and-a-test-only-repair-6-october-2026)).
- **Installed-iPhone acceptance:** reported 6 October 2026 ([below](#installed-iphone-acceptance-reported-6-october-2026)).

### CI run 37483537843 failed, and a test-only repair (6 October 2026)

- **The failure.** CI run 37483537843, for `964f585`, deployed nothing.
  - **Jobs:** Verify and build (305 s) and shards 1, 2 and 4 (680, 900 and 963 s) succeeded. Shard 3 (job 112337636300, 544 s) failed one test of 289, so Deploy was skipped and `0.4.67` was not deployed.
  - **The test:** `android-chrome`, `e2e/androidPlanningTouchPlacement.spec.ts`'s "the crosshair control adds, moves and inserts on the intended waypoint by touch, and a map tap never completes a pending Move" (item 123's). It used up the default 30 s budget during its third and last touch pan, with every earlier assertion passed.
  - **The runner** was GitHub-hosted `ubuntu-latest`. Its CPU count and Playwright's worker count appear only in the job log, which cannot be read without authentication, so they are not recorded.
  - **The failure evidence** uploaded with the run (`playwright-failures-37483537843-1-shard-3`) also needs authentication and was not inspected. The error text is the rider's.
- **Diagnosis**, in the CI image by digest, on fresh builds of `964f585` and of `61e8644` (a temporary worktree, since removed):
  - **Nothing points to the riding change.** The spec, the Playwright configuration and the workflow are unchanged; the application change is confined to the riding screen; and shard 3 holds the same tests at both heads but for one WebKit test.
  - **Alone and unloaded**, with tracing, the test passed in 17.7 s: setup about 2.5 s, each genuine touch pan 1.7–1.9 s, three autosave polls of 1.1–1.4 s each, and a 1.2 s settle. No step waited on something that did not arrive.
  - **Under a deliberately harsher load than CI** — 4 CPUs and 2 workers, under which the whole shard took 13.9 min against CI's 8.1 — the same test timed out. Every step was still progressing, though a 40 ms wait took 0.3–0.8 s.
  - **Given a temporary 120 s budget,** for diagnosis only, it completed with every assertion passing: in 57.8 s and 48.9 s on `964f585`, and in 66 s and 47.9 s on `61e8644`.
  - **Conclusion:** a long test running close to its budget, not a stall, a missed gesture or an application change. That this CI run needed slightly over 30 s is inferred from where the test stopped; its usual CI duration is not known.
- **The repair, test-only.** That test alone gets `test.setTimeout(90_000)`, the per-test budget pattern other specs here already use, with a comment citing these measurements.
  - **Unchanged:** genuine touch input and its 40 ms pacing; every Add, pending Move, completed Move and Insert check; the waypoint identity and coordinate assertions; the proof that a map tap never completes a Move; the autosave settling.
  - **Not added:** a global timeout, a retry.
- **Verification:**
  - **The complete spec in `android-chrome`, unloaded:** 8/8 passed, the repaired test in 15.7 s.
  - **The same spec under the harsher load, run twice:** the repaired test passed both times, in 56.3 s and 38.4 s, within its budget.
  - **Also passed:** lint, typecheck and the build, whose bundle is unchanged.
- **Unresolved, and seen only under the harsher load; none failed in CI:**
  - **The same spec's double-tap zoom test (`:460`)** failed in both runs on each head. Its two-finger-tap test (`:482`) failed once on `964f585`. In each case the zoom did not change within the poll's 5 s. With 40 ms contacts stretched several-fold, the gesture probably fell outside MapLibre's recognition window; that is an inference, not established.
  - **`androidMapCameraGestureRace.spec.ts:742` and `ridingShortTurnaroundWalkingPace.spec.ts:189`** each used up 30 s in the shard run under that load, still progressing through their last steps.
  - **That spec's `:528` test** took 31.2 s and 32.5 s on `61e8644`, and 25.5 s and 30.8 s on `964f585`.

  These are recorded, not repaired: none of them is a failure CI demonstrated.

- **CI and deployment** of the repair were reported in the handoff and are recorded below with the device acceptance.

### CI and deployment — run 37491370472 (6 October 2026)

This section was written after the run. Run [37491370472](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37491370472), for the test-only repair `9f73242`: **Verify and build, all four End-to-end shards and Deploy succeeded.**

- Verify and build took 317 s.
- The shard jobs took 692, 765, 525 and 719 s (shards 1 to 4). The longest, 765 s (shard 2), was 435 s under the E2E job's 1,200 s limit.
- Deploy took 48 s.

The live site then served `0.4.67` with build `9f73242`. Run 37483537843's failure on `964f585` and the repair stay as recorded above. One run, so no trend is claimed; the durations are also noted under "Monitored, corroborating only" in [`current-status.md`](../current-status.md).

**The original timeout's cause stays qualified.** The local measurements above support a long test exhausting its 30 s budget under load, but run 37483537843's log and failure artefacts were not available, so that cause is not established. This run's success with the 90 s budget does not establish it either.

**The stress-only observations stay unresolved:** the double-tap (`:460`) and two-finger-tap (`:482`) zoom tests, `androidMapCameraGestureRace.spec.ts:742`, `ridingShortTurnaroundWalkingPace.spec.ts:189` and `:528`'s durations. Every shard of this run succeeded with no retries configured, so they passed here, as they had in CI before; that is not evidence that any of them is fixed under the harsher load, and none is treated as fixed.

### Installed-iPhone acceptance (reported 6 October 2026)

**Accepted** on the installed iPhone, in German and English, at product level: Session 5's four checks ([dated record](../current-status.md#installed-iphone-acceptance-of-0467-build-9f73242-item-134-reported-6-october-2026)). The rider reported: "All checks pass in German and English. The installed version and build are 0.4.67 and 9f73242."

- **The accepted checks:** ordinary Pause, Resume ride and Pause again; End ride cancelled on the full paused-route screen, then a successful Resume ride and Pause again; End ride confirmed from that full paused-route screen without going through Back to Ride options, reaching `Choose a route`; and nothing offered to resume after fully closing and reopening the app.
- **The accepted build is `9f73242`**, and it stays so when later deployments change the deployed build ID.
- **Automated evidence only:** Resume ride disabled during a held End; a failed End's recovery, with the ride paused and Resume ride available again; a refused End's hand-back.
- **Unmeasured:** whether a naturally slow End exposes the pending state on an iPhone.
- **VoiceOver** remains unverified; the report supplies no VoiceOver result.
- **Not inferred:** a phone model, iOS version, measured geometry, GPS-watch count or physical-Android result.

With this acceptance item 134 is complete within its approved scope. [Item 135](../backlog.md#item-135)'s focus questions and [items 142](../backlog.md#item-142), [143](../backlog.md#item-143) and [144](../backlog.md#item-144) stay outside it.

---

<a id="item-139"></a>

## Item 139 — A failed End ride's message clipped in the riding header — implemented, device acceptance pending

_Category: Riding presentation_

**Status: implemented in `0.4.68` on 6 October 2026; installed-iPhone acceptance pending.** The rider approved its candidate the same day, together with item 134's acceptance, and the entry moved here from `backlog.md` with its implementation, as item 134's did. Item 139 stays first in the execution order until its device acceptance. The specification below is as filed, with its links adjusted for this file; the baseline, decision, implementation and evidence follow it.

139. **A failed End ride's message clipped in the riding header — presentation defect**
     - Origin: item 124's close-out investigation of 4 October 2026 ([findings](../../design/reveal-inventory/closure-reconciliation.md#a-failed-end-rides-message)), filed by the rider's disposition the same day ([decision 13](item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)). **Filing it here does not mean it is fixed or accepted.**
     - **Scheduled on 5 October 2026**, third in the approved execution order, after items 140 and 134 and before items 125, 103 and 120, by the rider's decision ([order](../../../CLAUDE.md)); it was unscheduled until then. **Scheduling approves no change:** the candidate below is not a decision. **Update, 6 October 2026:** with items 140 and 134 completed, it is first in the order, ahead of items 125, 103 and 120.
     - **What was measured**, in desktop Chromium and WebKit in the pinned container at 390×844 portrait, identically in both engines. The failure is **synthetic**: the existing test-only seam `window.__acnE2eRideStateClearFailure` fails the first clear of the stored session only.
       - **Route riding's header (C-10):** the message "The ride could not be ended on this device. Try again." sits on one line in the header's end slot, beside **End ride**. It is 318 px wide in English, from x = 216 to 534 on a 390 px screen, and 464 px wide in German, to x = 685. The fixed riding shell clips it at the screen's edge, so about 55% of the English sentence and 36% of the German one are visible. The page itself does not overflow.
       - **Free roam's header (C-13):** the same placement and clipping, measured in English only.
       - **Beside it:** the route's title collapses to 16 px, and **End ride** moves left, to x = 125–216, but stays visible and works. The retry ended the ride and cleared the stored session, and focus returned to **End ride** in every run.
     - **The comparison that reads well:** on the paused panel (C-11), the same message wraps under its button, 324 px wide, wholly on screen.
     - **Not established:**
       - how often a clear fails on a phone;
       - anything on the installed iPhone, where nothing was reproduced; a genuine failure is expected, not shown, to render the same way;
       - German free roam and enlarged text, which were not measured.
     - **A candidate, not a decision:** show the failure on its own wrapping line below the header row, leaving **Pause** and **End ride** where they are.
     - **Coordinate with:**
       - [item 134](#item-134), Resume while an End ride is finishing;
       - [item 135](../backlog.md#item-135), focus after a failure, including the plain `focus()` noted there;
       - [item 103](../backlog.md#item-103), control styling;
       - the riding header's existing layout decisions: items 68 and 76, and item 113's `0.4.42` and `0.4.43` header corrections.
     - **Evidence required when implemented:**
       - the synthetic failure in Chromium and WebKit, in English and German, at 100% and 200% root text, on route riding and free roam;
       - the message measured wholly visible, with **Pause** and **End ride** unmoved;
       - a negative control;
       - an installed-iPhone check of an ordinary End ride, since a failure cannot be induced on the phone.

### Baseline — measured on `8eee8eb` (6 October 2026)

**The application measured.** `8eee8eb` is item 134's documentation-only acceptance commit. Its tree differs from `9f73242` (`0.4.67`) only under `docs/` and in `CLAUDE.md`, so its application sources are those of `9f73242`. The build was made locally, so its build identity is the local one (`dev`), not CI's, and it is not claimed to be byte-identical to the deployed bundle. Its main script was `index-BR6O8acP.js`.

**Method.** A temporary diagnostic, kept outside the repository and never committed, ran in Chromium and WebKit in the CI image by digest (`mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294a…`, digest confirmed locally), at 390×844 portrait, against that build, served by a freshly started preview. It covered English and German, 100% and 200% root text, and route riding and free roam: 16 cases.

- Each ride was started through the interface, and its stored session was read.
- The seam was set immediately before End was confirmed, with a counter failing call 1 only. In every case the counter read 1 after the failure and 2 after the retry, so the End's own clear was the one failed and the retry cleared again.
- Before the confirmation opened, and again after the failure, the diagnostic recorded:
  - the Pause, End ride, End slot and title boxes;
  - the message's box, and its text extent line by line;
  - page overflow;
  - the content area holding the map (the visible map region), and the focused element.
- The stored session was read before the End and after the failure.

**Findings**, identical in Chromium and WebKit to within 0.5 px, and identical between route riding and free roam for everything in the header:

| Case               | End ride's left edge | Title width | End slot width | The message                        | Visible |
| ------------------ | -------------------- | ----------- | -------------- | ---------------------------------- | ------- |
| English, 100% text | 282.8 → 125.1 px     | 173.7 → 16  | 91.2 → 409.1   | one line, 318 px, x = 216.3–534.2  | 54.6%   |
| German, 100% text  | 278.3 → 125.1 px     | 169.2 → 16  | 95.7 → 559.9   | one line, 464 px, x = 220.8–685.0  | 36.4%   |
| English, 200% text | 225.6 → 168.3 px     | 73.3 → 16   | 148.4 → 784.2  | one line, 636 px, x = 316.7–952.5  | 11.5%   |
| German, 200% text  | 216.7 → 168.3 px     | 64.4 → 16   | 157.3 → 1085.7 | one line, 928 px, x = 325.6–1254.0 | 6.9%    |

- **Visible** is the share of the sentence's line width inside both the screen and the fixed shell, which clipped the rest. WebKit read 36.5% for German at 100%.
- **Pause did not move** in any case (x = 16–93.1 at 100%, 16–136.3 at 200%). The page did not overflow (`scrollWidth` 390 against 390), and the map region kept its height, because the one-line message did not make the header taller.
- **Focus** was on End ride after every failure. The stored session kept its `sessionId` through the failure, and the retry ended the ride: the Ride launcher showed **Choose a route** / **Route wählen**, and the stored session was gone.
- The German and enlarged-text cases the filing had not measured behave the same way, and worse: at 200% only 6.9–11.5% of the sentence is visible.

### The rider's decision (6 October 2026)

With item 134's acceptance, the rider approved the candidate for this slice: **show a failed End ride's existing error on its own wrapping row immediately below the immersive header's action/title row**, in both route riding and free roam.

- **The full error sentence is visible**, without horizontal clipping or truncation.
- **The header holds still:**
  - Pause and End ride keep their positions and dimensions when the error appears;
  - the error no longer takes the header's End slot or collapses the title's available width.
- **What stays the same:**
  - the existing wording, a single alert, and the existing announcement semantics;
  - the End confirmation, retry, session protection and tracking;
  - the paused-route panel's wrapping error presentation;
  - item 134's pending-End Resume condition.
- **A scoped presentation change only:** no redesigned controls, no change of focus policy, no new announcement mechanism, and no broad restyling of unrelated errors. Items 135 and 103 keep those wider questions.

### Implementation (`0.4.68`, 6 October 2026)

- **Route riding (`src/ui/riding/RidingScreen.tsx`):**
  - `renderEndRideTrigger` now renders the error only for its `"panel"` placement, so the paused panel is unchanged;
  - the active branch renders the same `<p className="field-error" role="alert">` directly after `<RidingImmersiveHeader/>`, before the existing Pause-error row, under the guard the header's `concealed` flag expressed before (`!isEndRideConfirmOpen && finalizeError?.source === "end"`).
- **Free roam (`src/ui/riding/FreeRoamScreen.tsx`):** the same. The header trigger is now the button alone, and the error row follows the header.
- **`RidingImmersiveHeader.tsx`:** only its `endAction` comment changed, to say the slot holds the button alone.
- **Precedent:** both screens already showed a failed Pause's error as exactly this kind of row, beneath the header.
- **No CSS changed.** In the fixed shell's flex column the paragraph wraps at the column's width, 16 px below the header's border, and the content area holding the map gives up the row's height.
- **Unchanged:**
  - the wording, `role="alert"` mounted when the failure occurs, and one alert;
  - the confirmation, which still clears the error when it opens again;
  - session identity, the retry and tracking;
  - focus, still a plain `focus()` on End ride ([item 135](../backlog.md#item-135));
  - item 134's `disabled={activeFinalizeSource !== null}`.
- **Version:** `0.4.68`.

### Evidence — automated only

**After the change**, measured by the same diagnostic on the fixed build (`index-Dzk-e09h.js`), identical in Chromium and WebKit to within 0.5 px:

| Case               | The message on its own row                 | Map region, route riding | Map region, free roam |
| ------------------ | ------------------------------------------ | ------------------------ | --------------------- |
| English, 100% text | one line, y = 77–94, text x = 16–333.9     | 518 → 484 px             | 678 → 644 px          |
| German, 100% text  | two lines, y = 77–112, text x = 16–356.7   | 499 → 447 px             | 678 → 626 px          |
| English, 200% text | two lines, y = 96–166, text x = 16–348.3   | 174 → 86 px              | 543 → 455 px          |
| German, 200% text  | three lines, y = 96–202, text x = 16–352.6 | 134 → 10 px              | 543 → 419 px          |

- **The message is wholly visible** in every case: 100% of the sentence, inside a 358 px row on the 390 px screen.
- **The header holds still.** Pause, End ride, End's slot and the title kept their boxes exactly, before the confirmation and after the failure, so the title kept its full width.
- **Elsewhere:**
  - the page did not overflow;
  - End ride kept focus, and the error was the only alert;
  - the stored session kept its `sessionId`;
  - the retry ended the ride, with the seam's count reaching 2.
- **The map region** is the content area that holds the map, which is the map the rider can see. In route riding at 200% the map container itself stays at its 160 px defensive floor, and that content area clips it; the Map/Profile switcher and the status card are unmoved.

**Component tests:**

- **`src/ui/riding/RidingScreen.finishEndRide.test.tsx`**, a new test. After a failed End:
  - exactly one alert, with the exact text;
  - it is the riding header's next sibling, not inside the header;
  - End's slot holds End ride alone, and Pause stays in its own slot;
  - End ride has focus;
  - opening the confirmation again clears the error, and the confirmation row again follows the header directly.

  The existing paused-panel failure test also asserts that the error follows the panel's End ride button in its row and is the only alert. That guards the preserved panel presentation.

- **`src/ui/riding/FreeRoamScreen.endRide.test.tsx`:** the equivalent new test.

**Browser:** `e2e/endRideFailureHeader.smoke.spec.ts`, 8 cases per engine, in Chromium and WebKit. Each case asserts:

- **[behaviour], first and soft**, so a regression reports what the rider sees before anything structural:
  - every line of the sentence inside the screen, the fixed shell and its own box;
  - no overflow of the message or the page;
  - Pause, End ride, End's slot and the title unmoved, within 0.5 px.
- **[structure]:** the only alert, outside the header and below it.
- **Then:** End ride focused, the stored session's `sessionId` kept, and the seam's counts of 1 and then 2 around an ordinary retry that reaches **Choose a route** / **Route wählen** with nothing stored.
- **The map region** is recorded as an annotation, not asserted.

**Negative control.** Only the old placement was restored, by putting both screens back to their `8eee8eb` text, while the new tests were kept.

- **The build:** it compiled with exit 0 into `index-BR6O8acP.js`, the baseline's own bundle name, distinct from the fix's `index-Dzk-e09h.js`. It was served by a freshly started preview.
- **The browser spec failed all 16 cases.** Every case reported, in order:
  - "lines not wholly visible" — for example English at 100%, the line at x = 216.3–534.2;
  - "End ride x", moved 157.7 px at English 100% and 57.3 px at English 200%;
  - "End's slot x" and "End's slot width";
  - "title width";
  - then the structural check, the error inside the header.

  The error's own overflow, page overflow and Pause did not fail, because in the old placement the slot sized the paragraph to its text, the fixed shell clipped it, and Pause never moved.

- **The ordering behind those results.** The spec's first version put the structural check first, and the control failed all 16 cases there, before the visibility and geometry checks ran. So the visibility and geometry checks were made soft and moved ahead of it, and the control was run again for the results above.
- **The component tests:** both new tests failed at `not.toContainElement`, with the header containing the alert. The paused-panel guard passed, as expected, since that presentation is unchanged.
- **The fix restored:** it was restored from saved copies, with SHA-256 matches for both screens. The rebuilt bundle was again `index-Dzk-e09h.js`, and with the version raised to `0.4.68`, `index-DLFr4bV6.js`.

**Also run, once, on the final build:**

- **Unit tests**, 352 in all:
  - the two complete End-ride files above;
  - `RidingScreen.test.tsx`, whose header tests assert the End slot and the confirmation row's position;
  - `germanRenderLeak.test.tsx`, which reads the End slot.
- **In the CI image:**
  - the new spec in both engines;
  - `ridingFinishAndEnd`, `freeRoam`, `germanRidingHeader` and `ridingImmersiveShell` in Chromium;
  - `endRidePausedConfirmationReveal`, `resumeDuringEndRide` and `staleSessionActions` in both engines.
- **Lint, typecheck, the build, links, whitespace and formatting.**

**One unexplained failure in those browser runs.** The first combined run (164 tests) failed two WebKit cases of `endRidePausedConfirmationReveal.smoke.spec.ts`: "(en, 100%)" and "(de, 100%) scrolled with End ride's slot under the navigation, then Cancel". Both failed at the test's own precondition, "wheel input put End ride's slot under the navigation".

- **Not reproduced:**
  - a second identical combined run on the same build passed 164 of 164;
  - the case passed 12 of 12 in isolation, both on that build and on the baseline build;
  - one combined run on the baseline build failed only the new spec's 16 cases, by design.
- That case concerns the paused panel, whose markup this change does not alter, since the active header branch is not rendered while paused.
- **No cause is established.** The failure's artefacts were overwritten by the later runs and were not inspected, and nothing here calls it unrelated or a flake.

### Limitations and observations

- **The failure is synthetic.** A clear cannot be made to fail through the installed PWA's interface, so the error row itself has automated evidence only. A genuine failure is expected, not shown, to render the same way.
- **The map gives up the row's height while the error shows.** At ordinary text that is 34 px in English and 52 px in German. In route riding at 200% root text, the visible map region falls from 174 to 86 px in English and from 134 to 10 px in German. That is recorded, not changed: the approved row is in flow by design, the error lasts until the next End attempt, and the header, status card and Map/Profile switcher stay usable.
- **Browser text scaling is not iOS Larger Text.** VoiceOver and physical Android are not covered. Every measurement is desktop Chromium or WebKit, with the container's fonts.
- **Out of scope:** focus after a failure, still a plain `focus()`, stays with [item 135](../backlog.md#item-135), and control styling with [item 103](../backlog.md#item-103).
- **If both errors show at once**, after a failed Pause and then a failed End, the End error is the first row and the Pause error follows. That combination was not measured.
- **Installed-iPhone acceptance pending:** Session 5 of [`current-status.md`](../current-status.md), an ordinary End ride in route riding and in free roam.

---

<a id="item-140"></a>

## Item 140 — A stale Ride-launcher confirmation clearing a newer session — done

_Category: Riding lifecycle_

140. **A stale Ride-launcher confirmation clearing a newer session — done**
     - Origin: item 124's close-out investigation of 4 October 2026 ([findings](../../design/reveal-inventory/closure-reconciliation.md#the-launcher-confirmation-after-a-re-read)), filed by the rider's disposition the same day ([decision 14](item-124-continued.md#slice-10s-acceptance-and-ci-and-the-close-out-dispositions-4-october-2026-documentation-only--not-a-slice)). **Filing it here does not mean it is fixed or accepted.**
     - **Scheduled on 5 October 2026**, first in the approved execution order, ahead of items 134, 139, 125, 103 and 120, by the rider's decision ([order](../../../CLAUDE.md)); it was unscheduled until then. Scheduling approves the investigation and the safeguard below, not any particular design.
     - **Status, 6 October 2026: the launcher slice is implemented in `0.4.65`, and its ordinary flows were accepted on the installed iPhone in English and German, reported the same day** ([the slice](#item-140-launcher-slice)). **Item 140 is not complete:** the other unconditional clears and stale-window writes stay open ([remaining scope](#item-140-remaining-scope)), and the slice's ordinary phone checks close none of them.
     - **Status, 6 October 2026, later: by the rider's [scope decision](#item-140-scope-decision), slice 2 — End and switch, route riding's End ride and Finish ride, and free roam's End ride — is implemented in `0.4.66`, with its installed-iPhone acceptance pending** ([slice 2](#item-140-slice-2)). Stale-window writes and older-version windows are filed separately as unscheduled [item 143](../backlog.md#item-143) and [item 144](../backlog.md#item-144). Item 140 stays active until slice 2's device acceptance.
     - **Status, 6 October 2026, evening: slice 2's ordinary flows were accepted on the installed iPhone in English and German, on `0.4.66` (build `c2cb9e6`), and item 140 is complete within its approved scope** ([slice 2](#item-140-slice-2)). Its record moved here from [`backlog.md`](../backlog.md) under the history convention. Finish ride, VoiceOver, the two-window races and their refusal notices, and the synthetic failure paths keep automated evidence only or stay untested. [Item 142](../backlog.md#item-142) stays an unscheduled, uninvestigated observation, and [items 143](../backlog.md#item-143) and [144](../backlog.md#item-144) stay open; this completion closes none of them.
     - **The demonstrated path: two pages in one desktop browser context**, sharing IndexedDB, with ordinary interface steps in each. Chromium and WebKit in the pinned container, English, 6 runs, identical in both engines.
       1. In page A, a route ride was started and paused, **Back to Ride options** taken, and the launcher's **End ride** opened, unconfirmed: "End this ride?", with **Cancel** focused.
       2. In page B, the same route's paused screen was ended and free roam started.
       3. Page A, which does not re-read, still showed "You have an unfinished ride on this route." with its confirmation open.
       4. **Confirming page A's stale confirmation deleted page B's newer free-roam session.** The clear carries no session identity, so it removed whatever was stored. Page B still showed free roam until it was reloaded; then nothing was stored.
     - **Not claimed:**
       - any reproduction in the installed iPhone PWA, which has a single window; this path needs two tabs or windows of the site in a browser;
       - the launcher's re-reads after **Retry** or a failed free-roam write, which need synthetic faults and were **not exercised**.
     - **Present facts, from source (at `ae76f98`):**
       - The launcher (`src/ui/riding/RidingLauncher.tsx`) reads its session once on mount, after **Retry**, and when `sessionRefreshToken` changes, which only a successful **End and switch** does.
       - Dexie's cross-tab broadcast reaches only live queries, which the launcher does not use.
       - The stored session is cleared through one function, `clearActiveRideState()` (`src/storage/rideStateRepository.ts`), which takes no session identity. Its callers are `src/App.tsx`, `src/ui/riding/RidingLauncher.tsx`, `src/ui/riding/useRideNavigation.ts` and `src/ui/riding/useFreeRoamNavigation.ts`.
     - **The safeguard to achieve:** a confirmation must never clear a session other than the one it refers to.
     - **The investigation must consider atomicity, not merely a potentially stale preliminary read.** A fresh read before an unconditional clear still leaves a window between the read and the delete. The candidate to evaluate is a clear conditioned on the session's identity, checked and applied within one IndexedDB read-write transaction, together with what the rider sees when the condition fails.
     - **It must also inventory every caller of the identity-less clear** — the launcher's **Discard** among them — and establish which share the hazard.
     - **Coordinate with:**
       - [item 119](items-118-131.md#item-119)'s switch guard, which protects **Resume** comparably; it is precedent, not a fix here;
       - [item 134](#item-134), an End ride still finishing;
       - [item 135](../backlog.md#item-135), focus after **End and switch**;
       - item 124's C-09, whose accepted flow is to be verified again if the launcher's shared code changes.
     - **Evidence required when resolved:**
       - a two-page browser test in Chromium and WebKit reproducing the path above, with the stored session read before and after;
       - a negative control showing that the identity check is what prevents the deletion;
       - a synthetic-fault test for any re-read path changed;
       - an installed-iPhone check of the launcher's ordinary End ride and Discard, since the two-window path itself cannot be reached there.
     - <a id="item-140-launcher-slice"></a>**Launcher slice — implemented in `0.4.65` on 6 October 2026; ordinary flows accepted on the installed iPhone, reported the same day.** It covers the Ride launcher's End ride (route and free roam) and Discard only. The design was revised once before implementation, on the rider's review of 5 October 2026: no fallback identity, free roam's identity kept through restoration, explicit sequencing for the atomicity test, and this slice's wording.
       - **The cause, confirmed.** The launcher's shared clear called `clearActiveRideState()`, which deletes the singleton row `"active"` whatever it holds. Reproduced once before the fix with the regression below, in Chromium in the CI image (by digest), on a build whose application was identical to `0c69101`: after page A's stale confirmation nothing was stored, page B's newer free-roam session having been deleted.
       - **A session identity.** Every session now has a random `sessionId` (`generateId()`), minted together with `startedAt` when the session starts — by the riding hooks, or by App for a new free-roam row — and carried through every later write. It is an optional field, so there is no Dexie version bump. `startedAt` was verified and rejected as an identity: it is millisecond-resolution and clock-derived, so two sessions can share it (a fixed test clock gives every session the same value), and in free roam an early fix could replace it before restoration. There is **no fallback** to kind, route and start time: two rows can share all of them, and an unsupported row's missing fields collapse to the same values.
       - **The safeguard.**
         - The launcher reads the session through `getActiveRideStateWithSessionId()`. In one read-write transaction it gives a row without an id one, keeping every other field (an unsupported row's unknown ones included), before any confirmation is offered for it; a row that has an id is never written.
         - The confirmation keeps the id it was opened for and is never re-targeted: a re-read showing another session closes it.
         - Confirm calls `clearActiveRideStateIfSession(id)`, which checks the id and deletes in one read-write transaction, and reports `"cleared"`, `"missing"` or `"changed"`. The existing `__acnE2eRideStateClearFailure` seam applies to it unchanged.
         - **On `"missing"` or `"changed"` nothing is deleted.** The confirmation closes with neither success nor an error, and the launcher re-reads. Once that read succeeds it shows what is stored with a polite notice, by the rider's decision: "The previously shown ride had already ended or been replaced. Nothing was deleted." / "Die zuvor angezeigte Fahrt war bereits beendet oder ersetzt worden. Es wurde nichts gelöscht." — a stable, initially empty, visually hidden `role="status"` with `aria-atomic="true"`, filled once, and a visible, non-live `.status-row`. A failed re-read shows the existing check failure and Retry instead, with no notice. Focus is not moved, as on success.
         - **A failed identity assignment** is reported as the existing check failure with Retry, because the session cannot be anchored. It can affect any row without an id: one written before `0.4.65`, or one another window rewrote without it.
       - **Free roam's identity during restoration.** FreeRoamScreen starts its watch on mount, so a fix could arrive before the restore read had adopted App's identity. Nothing is now persisted, and no identity minted, until that read settles; a Pause in that window waits for it. **A failed restore read is not evidence that no session exists:** after one, free roam mints nothing and writes nothing over the stored session, and Pause reports its existing failure. Route riding needed no such gate for ordinary flows: App opens a route without a restore intent only when its click-time read found nothing stored, and with one — holding the controls back until restoration — when that route's session is stored.
       - **Evidence** (local, before the push):
         - **The regression**, `e2e/rideLauncherStaleConfirmation.smoke.spec.ts`, Chromium and WebKit in the CI image: two pages in one context; the stored newer session's kind, start time and id are checked first, then the notice and the free-roam panel, then a reload. **Negative control:** with the clear's id check made inert and the app rebuilt, the test failed at that first check, with no row stored; the safeguard was then restored and the app rebuilt.
         - **Repository tests:** the assignment (no write for an identified row, every other field kept, distinct ids); the three outcomes; an id-less row identical in every other field to the presented one refused; the failure seam; and atomicity. In the atomicity test a competing write is started outside the clear's transaction once the clear's read has succeeded, its promise kept and awaited only after the clear completes; it lands after the delete. **Negative control:** a separate read and delete let that write land between them and be deleted, so the test failed on its final read, not by stalling.
         - **Launcher tests:** a newer session on the same route; an id-less unsupported record replaced by an identical id-less one; a session that has gone; a failed re-read; legacy and unsupported rows given an id and cleared; the notice in German.
         - **Hook tests:** one stable id across writes and Pause, a new id after `finish()`, an adopted id kept and a restored id-less row left id-less; in free roam, a delayed restore with an early fix (**negative control:** without the gate an early write occurred), a failed restore read and a fresh session.
         - **Updated by intent, not weakened:** tests whose launcher read or clear seam moved to the new functions; App tests asserting that nothing writes the row now seed a row with an identity, as `0.4.65` writes, while id-less rows are covered by the new tests; the pinned catalogue count, 743 → 744.
         - **Affected specs, once each:** `coldStartPausedRoute.smoke.spec.ts` in Chromium and WebKit, and `ridingLauncher.spec.ts` and free roam's launcher End in Chromium; the affected unit suites; lint, typecheck, build and formatting.
       - **Limitations:** the two-window race cannot be reached in the installed iPhone PWA, which has one window; VoiceOver is untested, including whether the notice is read twice; after the notice focus is on the page, as after a successful End ride, which is item 135's concern.
       - **CI and deployment.** Run [37434895346](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37434895346), for commit `1d59d95`: Verify and build, all four End-to-end shards and Deploy succeeded. Verify and build took 301 s; the shards took 672, 877, 535 and 710 s (shards 1 to 4), the longest 323 s under the 1,200 s limit; Deploy took 14 s. The live site then served `0.4.65` with build `1d59d95`.
       - **Installed-iPhone acceptance (reported 6 October 2026).** **Accepted** on the installed iPhone, in English and German, at product level: ordinary End ride, Discard, their cancellation and reopening the app, with no unexpected error or stale-session notice ([dated record](../current-status.md#installed-iphone-acceptance-of-0465-build-1d59d95-item-140-launcher-slice-reported-6-october-2026)). The accepted build is `1d59d95`. **VoiceOver was not checked.** The two-window race and the notice's behaviour in it cannot be reached on the phone and have automated evidence only, and this acceptance closes none of the remaining scope below. A separate observation reported with it is filed as [item 142](../backlog.md#item-142), with no cause or connection to item 140 established.
     - <a id="item-140-scope-decision"></a>**Scope decision, 6 October 2026 (the rider's).** End and switch — including Discard and continue for an unsupported session — route riding's End ride and Finish ride, and free roam's End ride stay inside item 140, as its second slice. The stale-window persistence hazards and older-version windows become separate, bounded, unscheduled investigations: [item 143](../backlog.md#item-143) and [item 144](../backlog.md#item-144). The execution order is unchanged, and item 142 stays unscheduled.
     - <a id="item-140-slice-2"></a>**Slice 2 — End and switch, End ride and Finish ride: implemented in `0.4.66` on 6 October 2026; ordinary flows accepted on the installed iPhone, reported the same day.** The plan was amended on the rider's review the same day: confirmations capture their identity as they open and Finish as it is pressed; a hand-back from content a newer ride choice has replaced never resets that choice; writes still waiting when an End begins are cancelled; and a missing App-owned free-roam session is gone, not resurrected.
       - **The causes, confirmed** once, with the regression below in Chromium in the CI image (by digest), on a build of the unchanged `351ae8f`. Each action cleared or wrote whatever was stored:
         - End and switch to a route deleted another window's newer free roam;
         - End and switch to free roam overwrote it with its own fresh row — a clear, then a second, unconditional write;
         - a paused route ride's End ride deleted a newer ride on the same route;
         - free roam's End ride deleted another window's newer free roam.
       - **Identity — owned, and established before each action is offered.** No fallback to route, kind or start time anywhere.
         - **End and switch** acts on the identity its own prompt was created with. The guard's check now reads through `getActiveRideStateWithSessionId()`, which gives an id-less or unsupported row an identity, every other field kept; a failed read or assignment is the existing check failure with Retry.
         - **Route riding** mints a new session's identity with its start time when Start is pressed — so End ride's confirmation always has one to capture, even before a first fix — and its restore read now assigns one to a stored row without it, which every later write carries. End ride's confirmation captures the identity as it opens; Finish ride as it is pressed.
         - **Free roam's identity is App's.** App stores the session, or validates it on Resume, and opens FreeRoamScreen with its id. The screen adopts only that session: finding none, or another, at its restore means it is gone — it stops, writes nothing and hands back. After a failed restore read it writes nothing, while End ride still clears only App's session.
       - **Safeguards:**
         - **End and switch.** A route target clears through `clearActiveRideStateIfSession()`, as in slice 1. A free-roam target uses a new `replaceActiveRideStateIfSession()`, which checks and writes the fresh row in one read-write transaction: no window between ending one session and starting the next. Item 119's request ownership, supersession checks and pending-mutation tracking are unchanged.
         - **A deliberate behaviour change:** a write that fails inside the replacement aborts its transaction, so the old session stays stored. The prompt then shows the existing "This unfinished ride could not be ended on this device. Try again.", with End and switch — the same guarded replacement — as the retry. Before, the old session was cleared first, and a failed write left nothing stored, with a write-only retry; that retry now remains only after a fresh check that found nothing stored.
         - **A refused End and switch** (missing or changed) clears, writes, opens and tracks nothing; the Ride launcher underneath re-reads. The prompt shows the approved notice with **Check again** — a fresh check, never End and switch against the stale snapshot, following `return-failed` — and no Return. One stable, initially empty, visually hidden polite region in App announces it once, for every prompt surface.
         - **End ride and Finish ride.** `finish()` takes the captured identity:
           - cleared → ended;
           - missing or changed, for a session that was stored — restored, or one of its own writes committed, tracked in a ref rather than the rendered `hasStoredSession` — → "session-gone": nothing is deleted, the watch stops, and the hook retires, so it never starts, persists or pauses again. The screen calls `onSessionGone`; App, unless a newer ride choice has replaced that content, hands back to the Ride launcher, which shows what is stored and, after its own successful read, the approved notice — announced politely once; a failed read shows the existing failure instead;
           - a ride never stored — ended before its first committed write — ends without deleting anything, never an unrelated stored session.
         - **Pending writes.** Dexie issues a plain write's transaction synchronously while the database is open, and same-store transactions commit in creation order, so a write issued before an End commits before the End's check. A write invoked before the End but not yet issued — held before its transaction, which the e2e write-delay seam does, and which production reaches only while Dexie is reopening the database — is cancelled at issue by an epoch check. A write that overwrote a newer session before the End began is [item 143](../backlog.md#item-143)'s hazard, not the End's.
         - **Two supporting fixes found while testing:** the identity-assigning read takes a plain read first, keeping the old read's transaction ordering (an explicit Dexie transaction is created a microtask later); and free roam's restore no longer replaces a live fix that arrived first with the stored one.
       - **Evidence** (local, before the push; the CI image by digest, fresh builds):
         - **The regression**, `e2e/staleSessionActions.smoke.spec.ts`, four two-window tests in Chromium and WebKit: End and switch from a route card; End and switch to free roam; a paused route ride's End ride after a newer ride on the same route; and free roam's End ride, including its watch stopping and no later write. The newer row is read before, checked first after, and again after a reload.
         - **Browser negative controls**, each build confirmed compiled and served: End and switch identifying whichever row exists at confirmation time fails both switch tests; both hooks' `finish()` doing the same fails both End tests.
         - **Local negative controls:** the replacement without its transaction lets a competing write be overwritten; writes not cancelled at issue, and hooks not retired after a refusal, each fail their tests; App without its content check resets a newer ride choice.
         - **Unit tests:** the repository (the replacement's outcomes, the seam, rollback and atomicity); the hooks (identity, refusal, never stored, held writes, a stale confirmation's identity); the screens (End and Finish refusals, Finish through the existing completion fixtures); the launcher (the requested notice); App (refused switches and Check again, the free-roam replacement and its failure, the hand-back and its guard, and Discard and continue for an id-less unsupported row).
         - **Updated by intent, not weakened:** spies moved to the conditional functions and the identity-assigning read; free-roam tests open the screen with App's owned row; held clears resolve an outcome; id-less seeded rows either carry an identity or assert its assignment; the two "write after a successful clear" tests are rewritten for the replacement.
         - **Existing specs, once:** `rideSessionSwitchGuard`, `ridingFinishAndEnd` and `freeRoam` in Chromium; `confirmationDialogs`, `coldStartPausedRoute`, `rideLauncherStaleConfirmation` and Planning's End and switch in both engines; the affected unit suites; lint, typecheck, build, the catalogue guards, links and formatting.
         - **First CI run failed; test-only repair:** run 37458478038 on `7da1f19` failed 17 tests, so nothing was deployed from it. In `confirmationRevealSettled` and `planningSavedRoute`, neither of which had been run in full before the push, a seeded id-less paused ride gained an identity from the guard's read. That is the planned assignment, with every other field kept, and each test's exact comparison after Cancel caught it. The repair gives those seeds an identity, as `rideSessionSwitchGuard`'s already had. Both specs then passed in Chromium and WebKit, and reproducing shards 1, 2 and 4 in the CI image found no other failure. The application is unchanged.
       - **Limitations:** the two-window races cannot be reached in the installed PWA; End and switch to free roam is reached only from a launcher that read nothing stored, so it has automated evidence only; VoiceOver is untested; after a refusal focus is on the page ([item 135](../backlog.md#item-135)); [item 134](#item-134)'s Resume stays enabled during an End, and a refusal still stops the watch; [item 139](#item-139)'s header error layout is unchanged.
       - **CI and deployment.** Nothing was deployed from `7da1f19` (run 37458478038, above). Run [37461451985](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37461451985), for the test-only repair `c2cb9e6`: Verify and build, all four End-to-end shards and Deploy succeeded. Verify and build took 209 s; the shard jobs took 671, 864, 461 and 926 s (shards 1 to 4); Deploy took 11 s. The live site then served `0.4.66` with build `c2cb9e6`.
       - **The longest shard job, 926 s (shard 4), against the E2E job's 20-minute (1,200 s) limit** — 274 s under it. For comparison only, the longest shard jobs of the day's two earlier successful runs were 877 s (run [37434895346](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37434895346), `1d59d95`, shard 2) and 819 s (run 37448703698, `351ae8f`, documentation only, shard 4). These are three single runs: no trend is established, no cause is attributed to the duration and it is not called normal variance. CI was not changed. It is also recorded under "Monitored, corroborating only" in [`current-status.md`](../current-status.md).
       - **Installed-iPhone acceptance (reported 6 October 2026).** **Accepted** on the installed iPhone, in English and German, at product level: Session 5's checks 1 to 5 ([dated record](../current-status.md#installed-iphone-acceptance-of-0466-build-c2cb9e6-item-140-slice-2-reported-6-october-2026)). That is End and switch from a paused route ride to another route — cancellation, the target opening ready to start, and reopening — and from paused free roam to a route, with cancellation and reopening; and End ride from active route riding, from the full paused-route screen without going through Back to Ride options, and from active free roam, with cancellation and reopening. The accepted build is `c2cb9e6`, and it stays so when later documentation deployments change the deployed build ID; the launcher slice's stays `1d59d95`.
         - **Finish ride** was not exercised: its optional check stays open, and it keeps automated evidence only.
         - **VoiceOver** was not checked.
         - **Automated evidence only:** the two-window races and their refusal notices; End and switch to free roam; a failed free-roam replacement and its retry; the synthetic failure paths; held writes; free roam's restore finding its session gone.
         - **Not closed by it:** [item 143](../backlog.md#item-143) and [item 144](../backlog.md#item-144). [Item 142](../backlog.md#item-142) stays unscheduled and uninvestigated.
         - **Not inferred:** a phone model, iOS version, measured geometry or GPS-watch count.
     - <a id="item-140-remaining-scope"></a>**Remaining scope after the launcher slice — open, not approved for implementation**, and unchanged by the slice's acceptance. Each item awaits the rider's decision on whether it is handled inside item 140 or filed separately:
       - **End and switch** (`App.confirmPendingSwitch`) still clears whatever is stored; across windows its prompt knows only the stored kind and route. → **Handled by [slice 2](#item-140-slice-2)** (`0.4.66`), by the [scope decision of 6 October 2026](#item-140-scope-decision).
       - **Route riding's End ride and Finish ride** (`useRideNavigation.finish()`) still clear whatever is stored, so a stale riding window ending its own ride can delete a newer session. → **Handled by [slice 2](#item-140-slice-2).**
       - **Free roam's End ride** (`useFreeRoamNavigation.finish()`): the same. → **Handled by [slice 2](#item-140-slice-2).**
       - **Stale-window writes:** both riding hooks' per-fix and Pause writes replace whatever is stored, including a newer session or an identity the launcher assigned. Route riding opened without a known session can, after a failed restore read, start a session over whatever another window has stored since App's read. → **Filed as unscheduled [item 143](../backlog.md#item-143)**; unresolved.
       - **Windows still running an older version** clear unconditionally. → **Filed as unscheduled [item 144](../backlog.md#item-144)**; unresolved.
       - **A refusal that can repeat:** while another window rides a session that has no id, each of its writes removes the id the launcher assigned, so this window's End ride or Discard is refused, with the notice, until that ride ends. → **Part of [item 144](../backlog.md#item-144)**: since `0.4.66` a current-version window's restore gives such a session an identity that its writes carry, so only a window running an older version still rides one without.

---

<a id="item-141"></a>

## Item 141 — A compact Edit copy notice in Planning — done

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

     - **Why it is linked to [item 122](item-122.md#item-122).** The notice sits above the map, so its full height pushes the map and **Calculate route** down the first screen. Item 122's measurements were made without it, and the rider's layout decision depends on the space it takes.
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

This entry was written before the push. Run [37306394172](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37306394172), for commit `a474254`: **Verify and build, all four End-to-end shards and Deploy succeeded, each on its first attempt.**

- Verify and build took 235 s.
- The shards took 659, 778, 349 and 893 s (shards 1 to 4). The longest was 307 s under the 1,200 s limit.
- Deploy took 11 s.

The live site then served `0.4.63` with build `a474254`, and the previous build, `320b1d9`, was gone.

### Installed-iPhone acceptance (reported 5 October 2026)

**Accepted** on the installed iPhone, in German and English: Session 5's six visual and functional checks, at product level.

- **The build** was deployed `0.4.63` (`a474254`). That is the deployed context: no version, build, phone model or iOS version was reported from the device.
- **The verbatim report,** and what it does not establish, is in [`current-status.md`](../current-status.md#installed-iphone-acceptance-of-0463-build-a474254-item-141-reported-5-october-2026).
- **VoiceOver was not checked.** The announcement, the button's name and state, and possible duplicate reading remain untested, so this is not screen-reader acceptance.
- **Item 135's focus limitation** is unchanged.

Item 122's implementation follows.
