# Android/Chrome acceptance checklist

This is the internal acceptance checklist for CLAUDE.md Future-backlog
item 25 ("Explicit Android/Chrome PWA compatibility"). It records
verification evidence only; the behaviour contracts themselves remain
defined by CLAUDE.md and are not restated here.

**What the automated Android coverage actually proves.** Every
`e2e/android*.spec.ts` file runs under playwright.config.ts's
`android-chrome` project, which uses Playwright's `devices["Pixel 7"]`
preset — a **Chromium** browser with an Android-shaped viewport, user
agent, touch context and device-scale factor. This is genuinely useful
integration coverage (real DOM layout, real MapLibre/WebGL rendering,
real IndexedDB, a real installed service worker), but it is **not** real
Android Chrome or WebView, and it cannot exercise anything that depends
on Android's own OS, browser binary, or hardware. Each section below is
tagged:

- **(Auto)** — proven by the automated suite (unit, component, or e2e).
- **(Device)** — can only be proven on a real, physically installed
  Android phone. Never mark one of these as verified without actually
  doing it.
- **(Recheck vs iPhone)** — already manually verified on the deployed
  iPhone PWA (see CLAUDE.md's "Manual acceptance status"), but not yet
  separately confirmed on Android.

Target: **Android 10 or later, current stable Chrome for Android.** This
is PWA support, not native Android packaging — there is no APK, Trusted
Web Activity, or Play Store listing.

## 1. Installation

- Manifest validity (`start_url`/`scope`/`display: standalone`/icons all
  correctly scoped under `/amazing-cycling-navigation/`), served HTML has
  no root-relative URL escaping that base path, and the installed service
  worker registers with the correct scope — **(Auto)**,
  `e2e/pwaManifestAndScope.spec.ts`.
- The native "Add to Home Screen"/install prompt actually appears and
  installs the app — **(Device)**.
- The installed app opens in standalone display mode (no browser
  chrome/URL bar) — **(Device)**.

## 2. Mobile layout baseline

- No document-level horizontal overflow, ≥44×44px touch targets on
  primary navigation/camera controls, and the sticky-header-except-
  during-active-riding contract, all at a representative Android phone
  viewport — **(Auto)**, `e2e/androidMobileLayout.spec.ts`.
- Real-world readability in daylight, with gloves, while mounted on a
  bicycle — **(Device)**, **(Recheck vs iPhone)**.

## 3. GPX import/export

- Import via the real file input; export via a real download, with the
  expected filename and `<acn:navigation>` manoeuvre content surviving a
  re-import performed entirely offline — **(Auto)**,
  `e2e/androidGpxImportExport.spec.ts`.
- Android's real file-picker UI, download notification, Files app, and
  any share-sheet interaction with the downloaded GPX — **(Device)**.

## 4. Planning

- Waypoint placement, a mocked-provider route calculation, save, and
  reopen without a further provider request, on the default Road bike
  (`cycling-road`) profile — **(Auto)**, `e2e/androidPlanning.spec.ts`.
  General cycling (`cycling-regular`) profile selection is already proven
  by `e2e/planning.spec.ts` and PlanningScreen's own unit/component
  tests; it is not duplicated here.
- Both cycling profiles produce viable, meaningfully different real-world
  routes — **(Recheck vs iPhone)** (already verified there, per CLAUDE.md's
  "Manual acceptance status").

## 5. Active Riding and geolocation

- A saved route opens, Riding starts, a mocked GPS fix appears and
  navigation state updates, the route renders on the local map style,
  camera controls (Follow my location, North-up) stay operable, and the
  navigation bar leaves sticky flow while genuinely tracking — **(Auto)**,
  `e2e/androidRiding.spec.ts`. No Android-specific geolocation code exists
  anywhere in the app (confirmed by source audit,
  `grep -rniE "useragent|isAndroid" src/` returns nothing) — this test
  exercises the same standards-based `navigator.geolocation.watchPosition`
  path already proven at a desktop viewport elsewhere in this suite.
- Real GPS fix quality, cold-fix time, and a genuine road-bike field test
  — **(Device)**. Mocked geolocation proves the app's _reaction_ to a fix,
  never sensor realism.

## 6. Screen Wake Lock

- The control is visible and requests a lock when `navigator.wakeLock` is
  available, is entirely absent when it isn't, and a rejected request
  surfaces the existing retry state without crashing Riding — **(Auto)**,
  `e2e/androidRiding.spec.ts`. The full acquire/release/reacquire-on-
  visibilitychange state machine is already proven at the hook level
  (`useScreenWakeLock.test.ts`) and in `e2e/ridingWakeLock.spec.ts`; it is
  not re-proven here.
- Real screen-dimming/battery-saver interaction on an Android device —
  **(Device)**. Already verified once on the user's iPhone, per CLAUDE.md's
  "Manual acceptance status" — **(Recheck vs iPhone)**.

## 7. Persistence, reload, and offline saved-route use

- A genuine `page.reload()` during an active ride returns the rider to
  the Routes screen (App.tsx keeps no persisted "last screen" — a real,
  previously-undocumented contract, confirmed by reading the source
  directly); reopening the **same** route then offers "Resume riding"
  with the persisted fix/progress restored, and makes no further
  OpenRouteService request — **(Auto)**,
  `e2e/androidPersistenceAndOffline.spec.ts`.
- Opening a saved route into Riding while tile/style requests are blocked
  still renders it on the app's own local fallback style — **(Auto)**,
  same file.
- An already-open ride stays usable (route, progress, elevation) once the
  browser goes genuinely offline (`context.setOffline(true)`), showing
  the app's existing "Offline —" banner — **(Auto)**, same file.
- The application shell (JS/CSS/HTML) remains available, served by the
  real installed service worker, after a reload with the network fully
  down — attempted as `e2e/androidOfflineAppShell.spec.ts`. Real
  service-worker activation/control timing is a known source of
  Playwright/Chromium flakiness: see that file's own header comment and
  this document's "What automation cannot prove" section below for
  whether this shipped or was dropped.
- General PWA suspend/resume recovery (backgrounding, screen lock,
  reopening the app) — **(Device)**, **(Recheck vs iPhone)**.

## 8. Free roam (route-less Riding, CLAUDE.md backlog item 42)

- Starting free roam from the idle Ride launcher shows a live GPS position
  on the map with camera follow, and makes no OpenRouteService request at
  any point — **(Auto)**, `e2e/androidFreeRoam.spec.ts`. The header leaves
  sticky flow the instant free roam is genuinely watching, mirroring
  section 5's identical Riding contract, proven again here under the same
  device emulation.
- A committed free-roam session survives a real `page.reload()` and is
  discoverable by navigating directly to the "Ride" tab, offering `Resume
free roam` — **(Auto)**, same file.
- Ending an active free-roam session clears the persisted row and returns
  to the empty launcher — **(Auto)**, same file.
- The fuller state machine — a manual camera gesture pausing follow and
  Follow restoring it, reload recovery restoring a genuinely usable state,
  the conflict guard blocking a saved route while free roam is unfinished
  (and recovering once it's ended), and the local fallback map style — is
  already proven at a desktop viewport in `e2e/freeRoam.spec.ts` and is
  deliberately not duplicated here, matching this document's own
  established "lighter-touch Android pass" convention (see section 5's own
  Wake Lock note for the identical rationale).
- Real GPS-driven direction-of-travel following (course-based bearing
  while moving, retained bearing while stationary, no oscillation), Screen
  Wake Lock hardware/OS behaviour during free roam, and any genuine
  bicycle field test are all **(Device)** — none of this has been checked
  on a real Android phone. Free roam is a wholly new capability with no
  prior iPhone verification either, so there is no **(Recheck vs iPhone)**
  row for it yet — see CLAUDE.md item 43's own ledger, which lists free
  roam's full real-device checklist (including its own dedicated bicycle
  field test, distinct from route Riding's).

## What automation cannot prove

Consolidated from every "(Device)" row above, so nobody has to re-derive
it by scanning all eight sections:

- The real native "Add to Home Screen"/install prompt, and standalone
  display chrome after installing.
- Real GPS chip behaviour: fix accuracy, drift, cold-fix time, and any
  background-throttling the OS applies.
- Real Screen Wake Lock hardware/OS behaviour: actual screen-dimming
  policy, battery-saver interaction.
- Android's real file-picker, download notification, Files app, and
  share-sheet handling of an exported GPX.
- Real Chrome-for-Android service-worker storage quota/eviction under
  genuine low-storage conditions.
- General backgrounding/screen-lock/process-eviction recovery, beyond
  what dispatching `visibilitychange`/`pagehide`/`pageshow` in a
  Chromium-emulated context can approximate.
- Anything about real-world daylight/glove/vibration readability while
  actually cycling.
- Free roam's real GPS-driven direction-of-travel camera following
  (course-based bearing while genuinely moving, stationary-bearing
  stability, no oscillation) — Playwright's geolocation emulation can set
  a fix's coordinates but cannot reliably drive trustworthy heading/speed
  values, so this is unverifiable by any automated means, not just Android
  emulation.

## How to run the Android-emulated suite

```bash
npm run build
npx playwright install --with-deps chromium
npx playwright test --project=android-chrome
```

## How to run a real Android acceptance pass

1. On the Android phone, open Chrome and keep it updated to the current
   stable release.
2. Navigate to the deployed GitHub Pages URL.
3. Install: use Chrome's menu → "Add to Home screen" (or the install
   banner if Chrome shows one). Confirm the app opens standalone (no
   Chrome address bar) from the Home Screen icon afterwards.
4. GPX: import a real GPX file via Routes → Import GPX; export a planned
   or saved route via Export GPX and confirm the download completes and
   can be reopened.
5. Planning: place at least two waypoints, calculate a route on both Road
   bike and General cycling profiles, and confirm they produce viable,
   different-looking routes; save one.
6. Riding: open a saved route, grant location permission, start riding,
   and confirm the current-position dot, route line, and camera controls
   (Follow my location, North-up) all work while genuinely moving or
   simulating movement.
7. Wake lock: enable "Keep screen awake" during a ride and confirm the
   screen does not sleep; confirm it releases sensibly when backgrounded.
8. Suspension: lock the screen or switch apps mid-ride, then return, and
   confirm the app recovers cleanly (stale fix shown, then a fresh one).
9. Offline: with the ride's route already saved, turn on aeroplane mode,
   reopen the app and the route, and confirm the route/position/progress
   remain usable even though map imagery may not load.
10. Free roam: from an idle Ride tab, tap "Start free roam" and confirm
    the live position dot, camera follow, and North-up/Follow controls
    all work while genuinely moving or simulating movement; confirm the
    camera points in the actual direction of travel while moving and
    holds a stable bearing while stationary; back out to another tab and
    return, confirming the launcher requires an explicit "Resume free
    roam" tap rather than silently resuming; end the session and confirm
    it returns to the empty launcher.
11. If anything fails, open Diagnostics, note the app version/build and
    any recent redacted errors shown there, and record the exact device
    model and Chrome version alongside the failure.
