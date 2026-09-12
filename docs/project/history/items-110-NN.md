# Completed backlog items 110–

This file continues the 100– numeric range and opens at item 110. It was started when item 110 was completed: adding it to what was then `items-104-NN.md` would have taken that file to 163,015 characters, past the ~150,000-character soft cap documented in [`README.md`](README.md), so that file was closed at item 109 and renamed [`items-104-109.md`](items-104-109.md) instead of growing unbounded. No existing entry was moved, shortened or rewritten by that split — only the filename changed, plus the inbound links that pointed at it. Stable item numbers never change regardless of which file their text lives in: item 110 held the highest number in the project when this file was opened and was nevertheless completed ahead of items 102 and 103, which remain pending. The file now holds items 110, 111, 115 and 116, so its contents are not contiguous — item 111 was completed after items 115 and 116 and is filed in numeric order regardless, since a number is an identifier and never a schedule.

**These are historical accounts of what shipped and why, at the time each was recorded.** Where later work has changed or superseded a detail described here, current source and tests are authoritative — but the rationale, rejected alternatives and real regressions documented here are preserved rather than edited to match the present state. See root [`CLAUDE.md`](../../../CLAUDE.md) for the required reading order before implementing anything.

---

<a id="item-110"></a>

## Item 110 — North-pointing orientation indicator on the north-up control — done

_Category: Map camera controls_

110. **North-pointing orientation indicator on the north-up control**
     - Origin: the installed-iPhone field test of 10 September 2026 — see [`current-status.md`](../current-status.md) for the dated report. The rider wants to know **where north lies relative to the currently rotated map**. They explicitly do **not** need another indication of their direction of travel.
     - Proposed behaviour, approved as the item's contract:
       - replace or augment the static `N` presentation with a clear arrow that points towards geographic north relative to the screen;
       - derive it from the map's **existing bearing**, not from continuous compass or heading-sensor tracking;
       - retain the control's existing north-up/reset action;
       - when the map is north-up, the arrow points upwards;
       - provide an accessible name that describes the **action**, not merely the icon;
       - do **not** add a rider-heading arrow or any continuous travel-direction feature;
       - verify that the implementation does not introduce a new battery-intensive sensor subscription.
     - **The implementation slice must first inspect the current map-bearing and north-up contracts, then use the smallest change consistent with them.** The findings below are the starting point for that inspection, not a design.
     - Confirmed current implementation:
       - Three sites render a literal `N` character with `aria-label="North-up, top-down view"` and `aria-pressed={isNorthUpTopDown}` — `src/ui/riding/RidingScreen.tsx` (`.ride-map-control--north-up`, inside `.ride-map-camera-controls`), `src/ui/riding/FreeRoamScreen.tsx` (byte-identical structure), and `src/ui/planning/PlanningScreen.tsx` (`.planning-map-control`). There is no SVG, glyph or rotation transform anywhere in the control today.
       - Bearing availability **differs by screen** and is the crux of the inspection. Planning already holds a live `settledOrientation.bearingDegrees`, set from `MapView`'s `onCameraSettled` callback, and derives `isNorthUpTopDown` from it against a 0.5° tolerance. Riding and Free roam receive the same `settled.bearingDegrees` in their own `onCameraSettled` handlers but pass it straight into `useRideCamera` / `useFreeRoamCamera`, which expose only `isNorthUpTopDown` plus a `persistableCameraState.bearingDegrees` that is hard-coded to `0` outside `free` mode — so no continuous bearing currently reaches the Riding or Free roam control. `MapView`'s own `cameraOrientation` state and its `data-camera-bearing` attribute are documented as diagnostic only and are deliberately not passed up; the map adapter deliberately exposes no `getBearing()` on its interface.
       - **Open implementation question, to be decided deliberately rather than assumed:** `onCameraSettled` fires on settle, so whether the arrow tracks continuously through a rotate gesture or only updates once the camera settles is a real choice with different plumbing costs. Decide it explicitly and record the reasoning; do not silently pick one.
       - Baseline for the "no new sensor subscription" check: an exhaustive repository-wide search finds **no** `deviceorientation`, `DeviceOrientationEvent`, `AbsoluteOrientationSensor` or compass code anywhere in `src/`, `e2e/` or `docs/` today, and no orientation permission request. The only heading-like value in the system is `GeolocationFix.headingDegrees`, which `src/storage/mapping.ts` deliberately restores as `null`. Any new subscription would therefore be a genuinely new capability and is not approved by this item.
     - Cross-reference the durable Riding rule on repeat Northwards/Follow presses and the `requestId`-based camera deduplication described in the root [`CLAUDE.md`](../../../CLAUDE.md): the reset action's existing semantics must survive intact, including a second press after an intervening manual rotation. Item 66 ([`current-status.md#item-66`](../current-status.md#item-66)) remains a monitored camera observation and is neither reopened nor addressed by this item.
     - Physical acceptance on the installed iPhone Home Screen PWA is required, covering Riding, Free roam and Planning. Physical Android verification is separately outstanding, as for most recent items.

### Implementation account (11 September 2026, `0.4.27`)

**What shipped.** All three north-up map controls — route Riding (`src/ui/riding/RidingScreen.tsx`), free roam (`src/ui/riding/FreeRoamScreen.tsx`) and Planning (`src/ui/planning/PlanningScreen.tsx`) — now render a north-pointing arrow in place of the static letter `N`. The arrow rotates so that it keeps pointing at geographic north relative to the currently rotated map. Everything else about the control is untouched: the press still issues the same orientation-only north-up/top-down command, `aria-label="North-up, top-down view"` and `aria-pressed` are unchanged, the 48px circular touch target is unchanged, and no rider-heading arrow was added to the position marker.

**Bearing source.** The map camera's own bearing, and nothing else. `mapAdapter.ts`'s `onCameraSettled` registers a single MapLibre `moveend` listener and reports `map.getBearing()` — the only `getBearing()` call in the repository. Planning already held that value as `settledOrientation.bearingDegrees`; Riding and free roam already received it in `reportCameraSettled` and threw it away, so the change there is to retain and expose it. No compass, no orientation sensor, no heading subscription, no permission prompt, no `requestAnimationFrame` loop, and no new map event.

**Transform convention, established empirically rather than assumed.** Nothing in the repository previously asserted the relationship between a MapLibre bearing and a screen rotation, so this item introduces it — and proves it against the real map instead of against a table. A new Planning browser test (`e2e/planning.spec.ts`) places two waypoints, **asserts from their stored coordinates** that the second is genuinely north of the first (`lat2 > lat1`, longitudes equal to within 1e-6) rather than inferring it from having pressed `ArrowUp`, rotates the map through MapLibre's own `KeyboardHandler`, and then measures both `.planning-waypoint-marker` boxes on screen. Measured result, printed by the test itself:

```
[item-110-convention] bearing=90 northMarker=(187,451) southMarker=(253,451) arrowRotation=-90
```

At a settled bearing of `90` the northern waypoint paints at x=187 and the southern at x=253 — north really is to the **left** — and the arrow is painted at `-90`. So a map bearing names the compass direction drawn at the top of the screen, CSS rotation is clockwise-positive, and the arrow (authored pointing up at 0°) is rotated by the **negation** of the bearing. The four screen-relative cardinal cases therefore hold: `0°` up, `90°` left, `180°` down, `270°`/`-90°` right.

**A correction to the assumed bearing range.** MapLibre's `getBearing()` does **not** return `[0, 360)`. `Transform.setBearing` does `wrap(bearing, -180, 180) * Math.PI / 180` and stores radians, and the getter converts back — so a settled readback for "west is up" is `-90`, while a `RideCameraCommand.bearingDegrees` is contractually `[0, 360)` and reports `270` for the same orientation. Both feed the same presentation value, so they must be made comparable before they are ever compared.

**Normalisation at the reducer boundary, not in the icon.** A new `toDisplayBearingDegrees` in `src/navigation/bearing.ts` reduces a bearing to one canonical form — whole-degree, `[0, 360)` — or `null` when it is not a usable bearing at all. It is applied where the value enters hook state, so the hook never stores a raw or non-finite value; the icon keeps its own guard purely as a final defensive boundary. Three jobs, deliberately in one place:

- **One domain**, reconciling the signed readback with the `[0, 360)` command value.
- **Reference stability.** The same degrees→radians→degrees round trip returns a neighbouring float for a byte-identical commanded bearing: measured directly, **105 of the 360 whole degrees** in `[0, 360)` do not survive it exactly. An exact `===` no-op guard on the raw value would therefore see a change where the map had not moved, turning every ordinary settle into a re-render. Rounding to whole degrees removes that entirely, and is not observable — 1° is roughly 0.2px at the arrow's radius.
- **A representable "unknown".** `normaliseBearingDegrees(NaN)` is `NaN`, and `rotate(NaNdeg)` is an invalid CSS declaration browsers drop silently. Persisted camera rows are only defended with `?? 0`, which does not catch a structured-cloned `NaN`.

**Shared presentation design.** One new component, `src/ui/shared/NorthArrowIcon.tsx`, used by all three screens, so there is exactly one bearing-to-transform rule and the negation lives in a single place no call site can get wrong. It follows the established icon house style (`NavIcon.tsx`, `ManoeuvreIcon.tsx`): a hand-authored, dependency-free inline SVG, `fill="currentColor"` so it inherits both the ordinary and the pressed-on-accent colour with no second rule, `aria-hidden="true"` and `focusable="false"` because the hosting button's own name and `aria-pressed` carry every bit of accessible meaning. All styling is inline and never a CSS class, because Vitest runs with `css: false` and a class-only rotation would be invisible to every unit test. `src/map/routeArrowIcon.ts` was deliberately **not** reused: it is a raw RGBA bitmap authored pointing along +x for MapLibre's own `icon-rotation-alignment: "map"` symbols, not DOM chrome. No CSS file was touched at all — `margin: 0 auto` in the glyph's own inline style centres it inside the 48px control, and the control's box, border and touch target measure unchanged.

**Exposing the bearing from the two camera hooks.** `useRideCamera.ts` and `useFreeRoamCamera.ts` gain one presentation-only field, `liveCameraBearingDegrees: number | null`, kept conceptually separate from persistence:

- It is updated from every `camera-settled`, in **every** camera mode. This is the crux. `freeCameraPosition` is cleared the moment mode leaves `"free"`, and the settle handler previously early-returned for non-free modes — so route Riding's normal case, `following` with the camera rotated to the travel bearing, retained no bearing at all. That is exactly when the arrow has something worth saying.
- It is **never** sourced from `persistableCameraState.bearingDegrees`, which is hard-coded to `0` outside `"free"` mode. Driving the arrow from it would have shown a permanent, false "north is up" for an entire followed ride.
- Reference stability is preserved: when the normalised value is unchanged the reducer returns the same `state` object, so the documented "never adds a re-render on every ordinary moveend while following" property survives. A non-finite reading is rejected and the previous value retained, so a stream of invalid events cannot produce repeated state updates either.
- It is optimistically set from a real camera command's own bearing when one is produced, so a north-up press snaps the arrow upright on press rather than a whole `moveend` later, and a restored but still-rotated free camera shows the correct arrow before its first settle. Either way the following settle overwrites it with the map's real readback, so it is self-correcting. It returns to `null` on entry to `overview`, whose fit resets bearing to 0 explicitly.
- `persistableCameraState`, `freeCameraPosition`, `isNorthUpTopDown` and free roam's `persistableLastReliableBearingDegrees` are all behaviourally unchanged. While `"free"`, the hook now deliberately carries two bearings that can differ: the raw one (persistence, and `isNorthUpTopDown`'s exact-equality test) and the normalised presentation one. The field's doc comment forbids collapsing them.

**Why settle-only, decided explicitly.** The backlog entry required this choice to be made deliberately rather than silently. `onCameraSettled` is a `moveend` listener; nothing in the repository fires per frame during a rotate gesture, and the map adapter deliberately exposes no `getBearing()` on its interface. Tracking the arrow continuously through a gesture would mean a new adapter event plus a per-frame React state write on a screen used on a phone mounted on a bicycle — precisely the battery cost the item forbids. The arrow therefore updates when the camera settles, including after programmatic moves, and the optimistic-from-command path above removes the one case where a settle-only contract would have felt laggy (a north-up press). The measured re-render cost of the new field is bounded by one additional render per settle, only when the whole-degree bearing actually changes, on screens that already re-render at least once per GPS fix; while following a straight road, where commanded bearings are dead-banded, it is zero.

**Fail-first evidence.** New tests were run against the parent commit `ef02ad2` with the production files reverted to their parent content and only the new tests present (an explicit, byte-verified file-level revert with backups, never a `git checkout` over uncommitted work). Recorded results:

| Group                                                     | Against `ef02ad2`                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| Planning screen integration (`PlanningScreen.test.tsx`)   | **5 failed**, 1 passed                                                |
| Route Riding screen integration (`RidingScreen.test.tsx`) | **5 failed**, 1 passed                                                |
| Free roam screen integration (`FreeRoamScreen.test.tsx`)  | **5 failed**                                                          |
| `useRideCamera.test.ts` live-bearing suite                | **8 failed**                                                          |
| `useFreeRoamCamera.test.ts` live-bearing suite            | **7 failed**                                                          |
| `bearing.test.ts`                                         | **6 failed** (`toDisplayBearingDegrees is not a function`), 16 passed |
| `NorthArrowIcon.test.tsx`                                 | could not run — the module does not exist on the parent               |
| `sensorFreeSource.test.ts`                                | 3 passed, 2 failed                                                    |

The four required parent failures are all covered: route Riding, free roam and Planning each show a static `N` at a non-zero settled bearing, and a restored non-zero free-camera bearing is not represented by a north-pointing arrow (`seeds a restored, still-rotated free camera before its first settle`, failing in both hooks).

**What in that table is a compatibility guard rather than fail-first evidence**, stated precisely. The single passing screen-integration test in Planning and in Riding is `still invokes the existing north-up camera action when pressed` — it passes on the parent because the action is genuinely unchanged, which is the point. `bearing.test.ts`'s 16 passes are the pre-existing bearing suite, unmodified. `sensorFreeSource.test.ts`'s three absence assertions pass on the parent, since the parent has no sensor code either; its two failures there are only because it names the new icon file. `NorthArrowIcon.test.tsx` is new coverage, not fail-first evidence — a test that cannot run against the parent proves nothing about it.

**Compatibility guards, run unmodified.** The full Vitest suite (**3615 tests, 167 files**) and the full local Playwright suite were run with no assertion relaxed and no timeout increased. That includes camera persistence, north-up/top-down mode, free-camera restoration, map pitch, location following, rider-marker presentation, Planning camera settlement, pause/resume and route restoration, keyboard and pointer activation, and the map-control geometry assertions in `e2e/layout.spec.ts` and `e2e/androidMobileLayout.spec.ts` that measure the real 48px boxes. Item 109's stacking and its 4px isolation band, item 108's imagery and climb behaviour, and item 107's projection were not touched.

**Negative controls.** All nine were applied, measured and reverted. Every one discriminated:

| #   | Control                                                                | Result                                                                   |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Reverse the transform sign                                             | **11 failed** — cardinal-direction tests across the icon and two screens |
| 2   | Hard-code the arrow to `0°`                                            | **11 failed**                                                            |
| 3   | Feed `persistableCameraState.bearingDegrees` into Riding and free roam | **8 failed** in those two screens; Planning, untouched, stayed green     |
| 4   | Omit one screen (Planning reverted to `N`)                             | **5 failed** in Planning; Riding and free roam, untouched, stayed green  |
| 5   | Rotate the whole button instead of the glyph                           | **12 failed**                                                            |
| 6   | Misname the accessible action (`aria-label="Arrow"`)                   | **15 failed**                                                            |
| 7   | Leave a stale bearing after returning to north-up                      | **4 failed**                                                             |
| 8   | Add a `deviceorientation` listener                                     | **2 failed** in the source guard                                         |
| 9   | Break restored free-camera initialisation                              | **2 failed**                                                             |

Two are worth carrying forward. **Control 5 did not discriminate by geometry**, and a naive version of it would have passed silently: a 48px circular control is rotationally symmetric, so its bounding box, border and focus ring measure identically whether the glyph or the whole button is rotated. The tests therefore assert _both_ halves explicitly — that the button's computed transform is `none`/identity **and** that the glyph carries the expected `rotate(-bearing)`. **Control 3 only discriminates in a non-`free` mode**, because while `"free"` the persistence bearing happens to equal the live one; the Riding coverage therefore had to establish a genuinely _following_, travel-up rotated camera, which in turn required moving the rider onto the fixture route's eastward leg — its first leg runs due north, so a followed camera at the start is legitimately north-up and would have proved nothing.

**Proof that no sensor or high-frequency listener was introduced.** A new root-level Vitest guard, `sensorFreeSource.test.ts`, scans every `.ts`/`.tsx`/`.css` file under `src/` and `e2e/` for `deviceorientation`, `DeviceOrientationEvent` and `AbsoluteOrientationSensor`, asserts the scan actually found the real tree before trusting its result, and separately asserts that the icon contains no `addEventListener`, `requestAnimationFrame` or `setInterval`. It is deliberately **not** a ban on generic `requestPermission`, which could legitimately support an unrelated capability later — a guard that fires on unrelated work gets weakened or deleted. It lives at the repository root beside `vite.csp.test.ts` rather than under `src/`, because `tsconfig.app.json` declares no `node` types and `node:fs` would not typecheck there.

**Two findings worth carrying forward.**

1. **A literal-token absence guard cannot tell prose from a call.** The guard's first run failed on `NorthArrowIcon.tsx` itself — its doc comment said, truthfully, that there is no `deviceorientation` subscription behind the arrow. The comment now hyphenates the term, and both files record why. This is the same class of trap as this project's existing "negation-safe verification greps" lesson: an absence check breaks precisely when the required text is an explicit negation.
2. **The diff-review half of control 8 does not work on a new file.** `git diff` reports nothing for an untracked file, so adding a sensor subscription inside `NorthArrowIcon.tsx` before it was ever staged was caught by the automated guard alone. Diff review remains a real check, but only for files git is already tracking.

**Limitations, stated honestly.**

- The arrow updates when the camera **settles**, not continuously through a rotate gesture. During a two-finger rotation it lags the map until the gesture finishes.
- Free roam has a second camera-command path the reducer never sees: `initialFramingCommand` is synthesised in the hook and merged at the return site, so a free-roam session resumed into `following` with a restored last-reliable bearing rotates the map without the arrow being seeded. It is `animate: false`, so the corrective `moveend` lands within a frame; it is documented rather than special-cased. This is **not** the restored _free_-camera case the item required, which is covered and tested.
- The presentation bearing is quantised to whole degrees. This is deliberate and imperceptible, but it means the arrow is not a sub-degree-accurate instrument and must not be treated as one.
- The `e2e` convention proof and all browser coverage ran in Chromium and Chromium-emulated `android-chrome`. `webkit-smoke` could not launch locally (missing system libraries — an environment limitation covered by CI, not an application failure).
- **No physical iPhone or Android verification is claimed.** See [`../current-status.md`](../current-status.md) for the required stationary, portrait checklist.

### Presentation follow-up (11 September 2026, `0.4.28`)

**Why.** The installed-iPhone check of `0.4.27` was positive on everything it exercised — the map rotated, the indicator updated once the gesture was released, and the control's tap action behaved. What it showed instead was that the four circular 48px map controls were not legible enough, nor distinct enough from one another. This is an acceptance-driven presentation follow-up to item 110, not a new backlog item, and it changes no behaviour at all.

**The visual invariant implemented.**

- The pointer's silhouette is item 110's, byte-for-byte: `M12 3 L19 20.5 L12 16 L5 20.5 Z`. It is now rendered in a **38px** box rather than 22px, so the artwork measures **22.2 × 27.7px** inside the unchanged 48px button.
- A drawn upright **`N`** sits at the rotation centre, ink **6.0 × 6.8px**, with **+0.76px of clearance from the pointer's edge at every bearing**.
- The letter stays upright while the pointer turns: the `<svg>` keeps item 110's own `transform: rotate(-bearing)` and the letter sits in a `<g transform="rotate(+bearing 12 12)">` that cancels it about the identical centre.
- Inverse colour, with the two tokens resolved **inside** the component from a semantic `isPressed` flag, so the three screens pass state and never a colour: dark pointer with a light `N` when idle, light pointer with an accent `N` when pressed. No badge, disc or halo.
- `CrosshairIcon` (22 × 22px, 2px stroke) and `ZoomIcon` (24 × 24px, `direction: "in" | "out"`) replace the `⌖`, `+` and `−` **text characters**. Those were rendered by whichever font in the system stack happened to carry them — one on an installed iPhone, another in CI — which is why their size and weight had never been consistent. The zoom pair is matched by construction: the minus is the horizontal bar, the plus is that same bar plus an identical vertical one.

**Why 38px, when 26px was proposed first.** Because the letter is upright and centred, it is invariant under the pointer's rotation while the pointer is not. It must therefore fit the largest **disc** centred on the rotation point that lies inside the dart — **radius 3.3425 units**, set by the two slanted edges (the notch edge gives 3.3647). A first measurement taken at 0° only suggested 26px, then 32px, would work. Both are wrong: measured against the disc, a ~10px letter has **−1.23px** of clearance at 26px and **−0.39px** at 32px, i.e. it would clip the pointer at some bearings. 38px with a 9.4px letter is the first pairing that clears at every bearing while keeping the artwork comfortably inside the button. `northArrowGeometry.test.ts` keeps both rejected sizes as executable evidence.

**Fail-first evidence**, taken against `b85c7f3` with the three screens and `NorthArrowIcon.tsx` reverted to their parent content and the new modules left in place so the test files could load:

| Group                                                  | Against `b85c7f3`                        |
| ------------------------------------------------------ | ---------------------------------------- |
| `NorthArrowIcon.test.tsx`                              | **10 failed**, 12 passed                 |
| The three screens' "drawn control symbols"             | **6 failed**, 5 passed                   |
| Browser: shared north component separation/uprightness | **failed**                               |
| Browser: Riding integration                            | **failed**                               |
| Browser: Free roam integration                         | **failed**                               |
| `northArrowGeometry.test.ts`                           | 10 passed — pure data, new coverage      |
| `CrosshairIcon.test.tsx`, `ZoomIcon.test.tsx`          | 15 passed — new components, new coverage |
| Existing item 110 browser suite                        | 4 passed — compatibility guards          |

The passing screen tests are the compatibility half and are named as such: accessible names, both pressed semantics, and the pending `"Waiting…"`/`"Locating…"` wording are contracts this follow-up must **not** change, so they pass on the parent by design.

**Negative controls.** All seven were applied, measured and reverted. **Two did not discriminate at first, and both exposed a real gap rather than test noise:**

| #   | Control                                   | Result                                      |
| --- | ----------------------------------------- | ------------------------------------------- |
| 1   | Remove the `N`                            | 12 failed (unit); browser separation failed |
| 2   | Drop the counter-rotation                 | 2 failed (unit); browser uprightness failed |
| 3   | Reverse the counter-rotation              | 2 failed                                    |
| 4   | Restore the old crosshair size            | 2 failed                                    |
| 5   | Restore the old `+`/`−` size              | 1 failed                                    |
| 6   | Enlarge the button instead of its symbol  | **passed at first** — fixed, then failed    |
| 7   | Replace the pointer with a different icon | **passed at first** — fixed, then 3 failed  |

Control 7 passed because the silhouette assertion compared the rendered path against the **same exported constant the component draws from** — a constant asserted to equal itself follows any edit to it and catches nothing. The shape is now pinned to a literal, with a second test proving the vertex list used by the containment proof still matches the path actually drawn. Control 6 passed because nothing anywhere asserted the button's **exact** size; every existing guard asserts `>= 44px`, which a 64px button satisfies while breaking this item's contract. All three screens now pin 48 × 48px exactly.

**Two measurement findings worth carrying forward.**

1. **A rotated element's bounding box is not its artwork.** `isFullyWithin(arrowBox, buttonBox)` began failing at 200% text — not because anything overflowed, but because a 38px square rotated 45° has a 53.7px axis-aligned box while the ink never leaves a 17.4px radius. Measured at 24.6°: element box 50.5px against a 48px button, ink 31.8 × 34.5px with at least 6.4px clear on every side. Containment is now measured on painted extent via the child shapes' own client rects, which is stricter than what it replaced.
2. **The letter's centre is the worst place to sample it.** The `N`'s centre is its diagonal — about 1.15px across, the thinnest part of the glyph — which antialiases almost entirely into the pointer behind it. The composited probe samples the two **stems** (1.50px wide, full height) instead, and states its result as a ratio rather than an absolute tolerance, because the design's whole margin is about one pixel and an absolute threshold would be measuring the browser's antialiasing rather than the separation.

**Limitations.** The 360-degree sweep proves containment exactly, but it **cannot** prove uprightness: a centred rectangle's footprint stays inside a rotation-invariant disc at any angle, so dropping or reversing the counter-rotation still passes it. Uprightness is proved separately, by the `<g>`'s transform and by the letter's composited `getScreenCTM()` carrying no rotation. The browser matrix is deliberately not a full pixel proof on every screen at every bearing: the shared component is proved once at representative bearings in both colour states, and each screen gets one representative integration state plus its existing action and containment checks. **No physical iPhone or Android verification of the revised symbols is claimed** — see [`../current-status.md`](../current-status.md).

### Second presentation follow-up (11 September 2026, `0.4.29`)

**Why.** `0.4.28` was exercised on the installed iPhone and every check actually performed passed — in Planning, in free roam, and in route riding **stationary on a test route**. Two refinements came out of that session: the north pointer was attractive and legible but still looked **slightly fragile**, and **Planning reversed** the vertical control order used by the other two screens.

**What shipped.** Two changes, nothing else.

1. **The north artwork grows from 38px to 42px.** One constant — `NORTH_ARROW_SIZE_PX` — which is already the sole source of `NorthArrowIcon`'s default size. `DART_PATH` and `NORTH_LETTER_PATH` are byte-for-byte unchanged, so the whole icon scales together and every internal relationship is preserved exactly; nothing was nudged independently to reach a preferred number.
2. **One right-hand control order on every map: North-up first, Location/Follow second.** Route riding and free roam already did this (`RidingScreen.tsx` North-up before Follow, `FreeRoamScreen.tsx` likewise) and were left untouched. Planning's two buttons were swapped **in the DOM**, not with CSS — no `order`, no `column-reverse` — so sequential keyboard and assistive-technology navigation matches what is on screen rather than merely looking as though it does. There is no `tabIndex` anywhere on these screens, so DOM order alone governs focus order.

**The geometry, recomputed from the shipped constants rather than copied.**

|                                                                    | 38px            | **42px**            |
| ------------------------------------------------------------------ | --------------- | ------------------- |
| Dart artwork                                                       | 22.17 × 27.71px | **24.50 × 30.62px** |
| Farthest dart vertex → inside of button border (radial, unpressed) | 4.565px         | **2.730px**         |
| Same, pressed (border dropped, radius 24px)                        | 6.565px         | **4.730px**         |
| `N` clearance inside the rotation-invariant disc, every bearing    | +0.760px        | **+0.840px**        |
| `N` ink                                                            | 5.985 × 6.808px | **6.615 × 7.525px** |

The farthest point of the artwork is a **wing**, 11.0114 units from the rotation centre — not the apex. Because the dart turns about that exact centre, its radial clearance from the circular button's border is **identical at every bearing**, which the new sweep asserts as well as measures. The button's inner border edge is a 22px-radius circle: 48px wide, `box-sizing: border-box` globally, 2px border.

**Fail-first evidence against `12333c8`, classified honestly.**

_Genuine fail-first_ — cannot pass on the parent:

| Contract                                           | Against `12333c8`                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| The svg renders at 42px, and the `N`'s ink follows | **4 failed** (`NorthArrowIcon.test.tsx`, `northArrowGeometry.test.ts`) |
| Planning's DOM order is North-up then Locate me    | **failed**                                                             |
| Planning's visual order matches the DOM            | **failed** (browser)                                                   |
| Planning's sequential keyboard order matches       | **failed** (browser)                                                   |

_Compatibility guards_ — these already passed at `12333c8` and are regression protection, **not** evidence of new behaviour: the button is exactly 48px; the dart stays inside the border at every bearing; route riding and free roam already used the standard order (both confirmed passing on the parent); and `DART_PATH`, `NORTH_LETTER_PATH`, every handler, camera behaviour and the `Locating…` / `Waiting…` fallbacks are unchanged.

**A forward-looking guard that deliberately cannot fail today.** `e2e/planning.spec.ts`'s composited probe used pixel constants derived for the 38px box (`PROBE_RADIUS_PX = 4.2`, `STEM_OFFSET_PX = 2.24`). They are _correct at 38px_, so a runtime-scaled replacement cannot honestly fail on the parent. Its value was demonstrated the other way round — by restoring the stale constants **against the new 42px build** and measuring what degrades: the probe's vertical margin from the letter collapses from **0.80px to 0.44px** (about 1.3 device pixels at the 3× sampling scale, against an antialiased edge), and the stem probe sits 0.24px off the true stem centre. The test still passed, which is precisely why this is filed as a regression guard rather than as evidence. The offsets are now viewBox-unit fractions multiplied by the svg's _rendered_ width, so every margin is preserved in proportion at any size and the constants cannot go stale again.

**Negative controls.** Six were applied, measured and reverted. **One exposed a real gap and one was my own badly-built control** — both reported rather than quietly re-run:

| #   | Control                                       | Result                                               |
| --- | --------------------------------------------- | ---------------------------------------------------- |
| 1   | Restore the 38px size                         | 4 failed                                             |
| 2   | Enlarge the button along with the icon        | failed (browser)                                     |
| 3   | Change the `N` path rather than only scaling  | **passed at first** — fixed, then 2 failed           |
| 3b  | Change the dart path rather than only scaling | 3 failed                                             |
| 4   | Swap visually with CSS, DOM order unchanged   | **passed at first** — control was wrong, then failed |
| 5   | Reorder the DOM, leave visual order contrary  | failed (browser)                                     |
| 6   | Remove `Locating…` / `Waiting…`               | 1 failed / 4 failed                                  |

Control 3 passed because **nothing pinned `NORTH_LETTER_PATH`**, and — the worse half — nothing checked that `NORTH_LETTER_BOUNDS` actually described the path being drawn. The containment sweep works off the bounds while the component draws the path, so the two could drift and the proof would keep passing while the letter clipped. Both are now closed: the letter is pinned to a literal, and a second test parses the path's own commands and ties its extents to the bounds. This is the same class of gap as the previous slice's self-referential `DART_PATH` assertion.

Control 4 passed for a different reason entirely: the control itself was faulty. It inserted `flex-direction: column-reverse` _above_ the rule's own `flex-direction: column`, which overrode it, so nothing actually changed. Rebuilt to replace the declaration rather than precede it, it fails on the visual-order assertion (north at y=332.78 against locate at y=276.78). **The test was never weak; the control was.**

**Limitations.** The `0.4.28` field result covers only what was exercised: `Waiting…` was **not observed** (transient, and it did not fail), and route riding was checked **stationary** — the route was never actively followed. Neither the 42px presentation nor Planning's reordered controls has any physical verification; both carry automated evidence only. Physical Android remains separately outstanding. The one element-box containment assertion left in the suite (`planning.spec.ts`'s 390px check) is safe at 42px only because it measures at bearing 0 — a rotated 42px square spans 59.4px, against 53.7px at 38px — and everything rotated is measured on painted ink instead.

### Installed-iPhone acceptance (12 September 2026, `0.4.29`)

The user exercised the deployed `0.4.29` build (application commit `7383ae0`) on the installed iPhone Home Screen PWA and reported: "The new northwards arrow checks all aforementioned tests. Also during an actual route ride the new arrow consistently points into the northern direction."

This is **full installed-iPhone acceptance of item 110's implemented presentation and behaviour**: the enlarged north pointer is clear and contained; the `N` stays upright and visibly separated while the pointer rotates; North-up returns the map to north-up/top-down with the correct pressed styling; North-up sits above Locate/Follow consistently; the zoom pair and crosshair remain clear and usable; no unwanted sensor permission prompt and no rider-direction arrow appeared; and the pointer consistently indicated north **during an actual route ride**, which closes the "never actively followed" gap the `0.4.28` result left open. It accepts the `0.4.29` presentation specifically — the 42px artwork and the standardised North-up-first control order.

`Waiting…` was **not observed**, because the initial fix arrived too quickly. That is neither a failure nor an acceptance blocker; no physical acceptance of that fallback is claimed in either direction, and its automated coverage is unchanged. The `0.4.27` and `0.4.28` results recorded above stand as their own dated evidence of what each of those builds showed, and are not restated here as acceptance of those builds. **Physical Android verification remains separately outstanding**, as for most recent items.

---

<a id="item-111"></a>

## Item 111 — Contextual tag-filter counts in the Route Library — done

_Category: Route Library organisation_

111. **Contextual tag-filter counts in the Route Library — done**
     - Origin: the installed-iPhone field test of 10 September 2026 — see [`current-status.md`](../current-status.md) for the dated report. As the number of tags grows, the filter chooser should help the rider understand which additional filters would still produce routes. Approved as an enhancement.
     - Approved semantics:
       - for every **unselected** tag, show the prospective number of routes that would remain if that tag were added to the current selection;
       - use the Route Library's existing multi-tag combination semantics rather than silently changing them;
       - visually subdue and, where semantically safe, disable an unselected tag whose prospective result count is zero;
       - do not rely on colour alone to communicate zero availability;
       - keep selected tags operable so they can always be removed;
       - update counts immediately when filters, routes or route tags change;
       - preserve the existing collapsed chooser, active-filter summary, Clear action and tag-management behaviour;
       - test empty, single-filter, multiple-filter, zero-result and live-update cases;
       - consider both ordinary portrait use and long labels without making the filter area permanently overwhelming.
     - **The implementation plan must confirm the existing filter semantics and accessible disabled-state behaviour before choosing the precise markup.** The findings below are that confirmation's starting point, not the markup decision.
     - Confirmed current implementation:
       - `src/ui/library/routeLibraryView.ts`'s `filterRoutesByTags` implements **AND** — a route must carry every selected tag — matching by `tagIdentityKey` identity rather than display spelling, with an empty selection matching everything through a vacuous `.every()`. `selectRouteLibraryGroups(routes, query, sortOrder, tagKeys)` composes the whole view in the order name filter → tag filter → pinned/unpinned partition → sort.
       - Chips are native `<button type="button" aria-pressed>` elements with class `tag-filter-chip` (`is-selected` when pressed), containing an absolutely positioned `.tag-filter-check` tick and a `.tag-filter-label`. They are rendered **only while the chooser disclosure is open**, deliberately, so nothing unreachable stays in the tab order. The collapsed summary comes from `describeActiveTagFilterCount` ("1 filter active" / "N filters active") beside a Clear tag filters button, and exactly one Clear ever renders.
       - The available-tag list comes from `collectTagSuggestions` over the **full unfiltered** live-query result, never from the currently filtered view.
       - **A per-tag count already exists and is a genuine reuse candidate:** `src/domain/routeTags.ts`'s `countRoutesByTagIdentity` counts routes (not occurrences) by tag identity, and is computed in `RouteLibrary.tsx` against the whole corpus purely to label the Manage-tags `<option>` entries. A _prospective_ count under the current selection is a different question, so confirm deliberately whether that function extends cleanly or whether a sibling is the honest answer — do not assume either.
     - Two decisions the implementation plan must settle explicitly **before** choosing markup, recorded here as open rather than pre-decided:
       - whether the prospective count also respects the active name search, given that the existing pipeline applies both the name filter and the tag filter;
       - exactly what "where semantically safe" means for disabling an `aria-pressed` toggle, given that a disabled control cannot be operated at all.
     - Carry this project's own hard-won focus caution into the disabled-state decision above: a browser ignores `.focus()` on a disabled element, and jsdom never auto-blurs an element that becomes disabled, so a focused chip that becomes disabled by a live update would strand focus. Items 105 and 106 ([`items-104-109.md#item-105`](items-104-109.md#item-105), [`items-104-109.md#item-106`](items-104-109.md#item-106)) are the precedent, item 106's root cause having been a focused control unmounted mid-event.
     - Do not change tag identity or normalisation, the storage lifecycle transaction, filter reconciliation, or any other item 100 stage 1–4A behaviour. This is a presentation and derivation slice.
     - Cross-references: item 100 stages 3 and 4A ([`items-100-103.md#item-100`](items-100-103.md#item-100)) for the filter and lifecycle contracts; item 106 for the current control layout, which this item must preserve; item 99 ([`items-95-99.md#item-99`](items-95-99.md#item-99)) for the adjacent sorting control. Item 100 stage 4B is closed and is **not** reopened by this item.
     - Physical acceptance on the installed iPhone Home Screen PWA is required. Physical Android verification is separately outstanding, as for most recent items.

### Implementation account (12 September 2026, `0.4.32`)

**What shipped.** Every **unselected** chip in the Route Library's expanded "Filter by tags" chooser now carries a compact route count: how many routes would remain if that tag were added to the current selection, under the existing AND semantics and the active name search. A candidate that would leave nothing shows a literal `0`, is visually subdued, and is made non-operable through `aria-disabled` while staying focusable. Selected chips are untouched — same tick, same `aria-pressed`, no count, always removable. The collapsed summary, the single Clear tag filters action, the tag manager and its whole-corpus counts, filter reconciliation, session restoration, search, sorting, pinning and route-card tag editing are all unchanged.

**The two semantics the backlog entry left open, settled explicitly.**

- **The count respects the active name search.** The existing pipeline applies the name filter and the tag filter in sequence, and the chooser sits above a list the search has already narrowed; a count that ignored the search would have described a list the rider cannot see. A search matching nothing therefore drives every prospective count to zero, which is the honest answer rather than a degenerate case.
- **"Where semantically safe" means `aria-disabled` plus an explicit handler no-op, never the native `disabled` attribute.** A chip can become unavailable _while it holds focus_ — the rider types in the search field, or a live corpus update lands — and a browser refuses `.focus()` on a disabled element while jsdom never reproduces the resulting blur. The chip therefore stays focusable, in the tab order, and focused; no focus hand-off is introduced, because none is needed. This is item 100 stage 4A's own already-shipped lesson (focusing a control the confirmation had just disabled silently dropped focus to `<body>`) applied before it could bite again.

**Derivation: one pass, and that is a property of AND rather than an optimisation.** A new pure `selectProspectiveTagFilterCounts(routes, query, selectedTagKeys)` in `src/ui/library/routeLibraryView.ts` composes three helpers the project already owns — `filterRoutesByName`, then `filterRoutesByTags`, then `domain/routeTags.ts`'s `countRoutesByTagIdentity` — and deletes the selected keys from the result. Because AND-narrowing is monotone, the routes matching `selected ∪ {candidate}` are exactly the routes matching `selected` that also carry `candidate`, so a candidate's tally **within** the already-narrowed set _is_ its prospective count: one tally answers every candidate at once. `selectRouteLibraryGroups` is deliberately not used, once or per tag — it would compute the same membership while also partitioning pinned from unpinned and sorting, neither of which can change who is in the set.

Three consequences fall out by construction rather than by care, and each has its own test: counts are routes and never occurrences (`countRoutesByTagIdentity` normalises each route's tags, so one route listing two spellings of one identity counts once); pinned and unpinned contribute identically, there being no pin logic in the path at all; and nothing passed in is mutated. An oracle test cross-checks every candidate against what the rider would actually see, `selectRouteLibraryGroups(routes, query, sort, selected ∪ {candidate})`'s own `pinned.length + unpinned.length`.

**Absence means zero, deliberately.** The chips come from `collectTagSuggestions` over the full unfiltered corpus, while the counts come from the narrowed subset, so a candidate that survives nowhere is simply missing from the map. That is the normal representation of a zero-result candidate, not an error, and the component resolves it with an explicit `?? 0` at the single point of use. Selected keys are stripped inside the helper rather than only skipped at render, so a selected chip can never be handed a prospective count at all — its entry would otherwise equal the whole current result size, since it is already applied.

**Two reused-helper documentation corrections, made because reuse falsified existing comments.**

- `countRoutesByTagIdentity` described itself as counting "across the whole corpus". That was true of its only caller, not of the function, and item 111 calls it with a filtered subset. Its comment now says **the supplied route collection**, and records that the tag manager deliberately supplies the full corpus while item 111 supplies the current result set — with the monotonicity argument written down where the next reader of that function will find it.
- `formatRouteCount` lived in `tagLifecycleMessages.ts`, whose header states that **every count in it** is the repository's own authoritative `sourceRouteCount` and never a pre-submit UI count, and whose own comment claimed it was "the only place that needs one". A prospective filter count is precisely a derived UI count, so importing the formatter out of that module would have stretched a real safety statement over a count it was never written about. It moved to a new leaf `src/ui/library/routeCountCopy.ts` that both modules import, and the lifecycle module's header now scopes its claim to its own messages explicitly. One pluralisation rule, no false comment, and no re-export shim.

**Markup, and the two existing contracts that shaped it.** The count is an `aria-hidden` `<span class="tag-filter-count">` inside the button, and the accessible description is a `.visually-hidden` element **outside** every button, referenced by `aria-describedby`. Both decisions are forced:

- **The chip's accessible name has to stay the bare tag.** Roughly forty call sites resolve a chip by exact accessible name — `getTagFilterButton` in both component suites, and `{ name, exact: true }` in four e2e specs — besides voice control. A visible count inside the name would rename every chip. The existing `aria-hidden` tick span was already the in-repo precedent for "visual affordance, excluded from the name", and `ElevationChart.tsx`'s visually-hidden description element was the precedent for the other half.
- **`e2e/routeLibraryTagFiltering.spec.ts` already asserted chip geometry item 106 fought for**: an unselected chip's label optically centred within 2px, and a chip's width unchanged when toggled, so wrapped rows never reflow under the finger that just tapped one. A count rendered in flow, or rendered only while unselected, breaks both. The count is therefore positioned absolutely in the chip's right padding — the exact mirror of `.tag-filter-check` in the left — and the reserved slot is shared by both and present on **every** chip whether or not a count renders. That existing test passes unchanged and is now a guard on the new design rather than an obstacle to it.

**The slot is sized from the corpus, and there is no 999-route cap.** A prospective count can never exceed the number of saved routes, so the corpus size is a genuine upper bound that is _also_ stable across every search and tag-filter change — sizing the slot from the largest count currently visible would have reflowed every chip row as the rider typed. `tagFilterCountSlotDigits(routeCount)` is a pure function tested exhaustively across the power-of-ten boundaries including `1000` and `10000`, and the component passes its result to CSS as `--tag-filter-count-digits` on the chip group. This is the project's first inline CSS custom property, and deliberately so: the value is data no static class can know. It is typed through an explicit `CSSProperties & Record<\`--${string}\`, string>`intersection rather than forced with a cast, since React's`CSSProperties` carries no index signature for custom properties.

The per-digit figure is **measured, not estimated**. A 0.75rem `tabular-nums` digit in this font stack advances 7.640625px at a 16px root, i.e. 0.4775rem, so the slot is `max(1em, digits × 0.48rem + 0.2rem)`: about 3px of slack at _every_ digit length rather than slack that shrinks as the corpus grows. The first attempt used 0.4375em, which happened to fit at four digits purely because of its constant term and would have run out at six; the browser measurement is what caught it. The `max(1em, …)` floor keeps the check glyph's original slot intact, so a one- or two-digit library renders exactly the chips item 106 shipped.

**Measured in the pinned CI container as well as on the host, because item 115's fifth finding says to.** The container's font stack is _narrower_, not wider: a 0.75rem `tabular-nums` digit advances **7.203125px (0.4502rem)** there against **7.640625px (0.4775rem)** on the development host, both at a 16px root. The host is therefore the tighter case, the 0.48rem constant was sized against it, and the container has more slack rather than less — the opposite direction to item 115, where the container measured the tighter geometry and a shortfall shipped. All thirteen `routeLibraryTagFiltering.spec.ts` tests were run in `mcr.microsoft.com/playwright:v1.61.1-noble` at the workflow's own pinned digest and pass there, including the four-digit slot and the 200%-root-text case. **Local WebKit still cannot launch in this environment** (the host is missing root-only system libraries and `browserType.launch` fails before any page loads), so every browser measurement behind this item is Chromium, and the seven `webkit-smoke` failures in a local full run are that launch failure and nothing to do with this change.

**Non-colour communication.** Unavailability is carried by three independent cues, only the third of which is colour: the literal visible `0`, a dashed chip border, and a recessed surface. `--colour-text-muted` measures 7.3:1 against `--colour-bg` in light mode and 9.5:1 in dark. Nothing is natively disabled, so `button:disabled`'s `opacity: 0.55` never applies and the global `button:focus-visible` ring reaches an unavailable chip exactly as it does any other.

**A behaviour change worth stating plainly.** An empty tag-filter result can no longer be reached by _tapping_: any chip that would empty the list is exactly the chip this item makes inoperable. The state itself still occurs — a live retag pulling the last shared route out from under an already-valid selection, a restored session, or a search the current selection cannot satisfy — and selected chips stay operable throughout so the rider can always recover. Two existing tests had constructed that state by tapping, and were rewritten to reach it the way it now actually arises (a live retag, and a filter that hides a pending switch's target while other routes remain). Their assertions are unchanged; only the setup path moved.

**Fail-first evidence.** Against the parent commit `eeb9309`, with `src/ui/library/RouteLibrary.tsx`, `src/ui/library/routeLibraryView.ts` and `src/index.css` reverted to their parent content by file-level copy — never a `git checkout` over uncommitted work — and only the new tests present:

| Group                                   | Against `eeb9309`                                    |
| --------------------------------------- | ---------------------------------------------------- |
| `routeLibraryView.test.ts`              | 20 of the new tests fail; 48 pre-existing tests pass |
| `RouteLibrary.test.tsx`, item 111 block | 12 fail, 2 pass                                      |
| `routeLibraryTagFiltering.spec.ts`, new | 6 fail, 1 passes                                     |
| `androidRouteLibraryTags.spec.ts`, new  | fails                                                |

The three that pass are **preservation guards, not fail-first evidence**, and are recorded as such rather than counted as proof: "never disables a selected chip", "keeps exactly one Clear tag filters action" and "keeps Manage tags and the collapsed summary working unchanged" all assert that existing behaviour survives, so passing against the parent is exactly what they should do.

**Negative controls — all eight discriminate.**

| Control                                              | Result                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| Count the whole corpus, ignoring the name search     | "respects the active name search" fails                      |
| OR instead of AND for the prospective candidate      | "applies AND, not OR, across several selected filters" fails |
| Return unconditional whole-corpus Manage-tags counts | "narrows every candidate to the intersection" fails          |
| Let an `aria-disabled` zero-result chip activate     | the pointer/keyboard no-op test fails                        |
| Use native `disabled`                                | the real-browser focus-retention test fails                  |
| Disable selected chips at a zero prospective result  | "never disables a selected chip" fails                       |
| Remove the visible zero                              | the zero-result presentation test fails                      |
| Reintroduce non-wrapping/clipping for long labels    | both wrapping/containment tests fail                         |

**Two measurement findings worth carrying forward.**

- **Playwright's own actionability check honours `aria-disabled`.** An ordinary `locator.click()` on the unavailable chip is refused outright with "element is not enabled", and `locator.press()` likewise. That is real evidence the semantics reach tooling rather than only a screen reader — but it means the no-op itself can only be proved with `click({ force: true })` and `page.keyboard.press`, which simulate a rider who taps anyway. A test written without that bypass does not prove the guard; it times out on the guard's own side effect.
- **`scrollWidth` cannot measure text width or slack here.** It is an integer and is never smaller than the element's own box, so on a fixed-width count it simply reports the box back: a first attempt measured 4-digit "slack" as −0.09px and a clipping check that could never fail. Real text extent comes from a `Range` over the element's contents, and the containment, clipping and slack assertions all use that instead.

**Verification.** `npm run lint`, `npm run typecheck`, the full `npm test` (3709 tests, 171 files), `npm run build`, the focused Chromium Route Library specs, the `android-chrome` project, the full Playwright suite, `npm run format:check` last and `git diff --check`. The Android coverage is **Chromium with a Pixel 7 preset — emulation, never physical Android acceptance**, and the 200%-root-text coverage is **browser-text evidence, never iOS Dynamic Type acceptance**.

**Files changed.** `src/ui/library/routeLibraryView.ts`, `src/ui/library/RouteLibrary.tsx`, `src/index.css`, `src/domain/routeTags.ts` (comment only), `src/ui/library/tagLifecycleMessages.ts` and its test (formatter extraction), new `src/ui/library/routeCountCopy.ts` and its test, `src/ui/library/routeLibraryView.test.ts`, `src/ui/library/RouteLibrary.test.tsx`, `e2e/routeLibraryTagFiltering.spec.ts`, `e2e/androidRouteLibraryTags.spec.ts`, `package.json` and `package-lock.json`. No storage schema, repository, GPX, service-worker, manifest or provider change; no new dependency.

**Its first deployment run was blocked, by something else.** CI run `34714031877` for this commit failed its End-to-end job on `e2e/rideSessionSwitchGuard.spec.ts`'s item-95 follow-up, so Deploy was skipped and `0.4.32` never reached the device; item 111 reached the installed PWA as part of `0.4.33` instead. **No causation is attributed to item 111**, which did not touch that spec — the retained trace traced the failure to the switch prompt's animated reveal moving a consequential action under the pointer, corrected under item 95. Equally, nothing here claims item 111 did not shift timing; the evidence simply does not address that.

**Installed-iPhone acceptance is outstanding**, and its stationary portrait checks are on the consolidated checklist in [`../current-status.md`](../current-status.md). Physical Android remains outstanding for this item as for every other.

---

<a id="item-115"></a>

## Item 115 — Lower-right climb cue and a compact imagery-recovery row — done

_Category: Riding presentation_

115. **Lower-right climb cue and a compact imagery-recovery row — done**
     - Origin: the installed-iPhone bicycle field test of 12 September 2026 — see [`current-status.md`](../current-status.md) for the dated report. That ride **accepted item 108**, and item 115 is a follow-up to it, not a reopening of it. Two further presentation observations came out of the same session:
       - the active-climb cue, at the top centre of the riding map, covers the central and upper route-ahead corridor — the part of the map a rider actually reads at speed — and would be better in the lower right, where it also sits nearer the thematically related **Profile** control in the Map/Profile switcher directly below the map;
       - a retryable map-imagery message in the top status card puts **Retry map imagery** on a wrapped line of its own at ordinary phone portrait size, making the card taller than it needs to be.
     - **Approved product behaviour — the climb cue's placement.**
       - At ordinary phone portrait size, place `.ride-climb-cue` inside the lower right of the map rather than at the top centre, visibly inset from both edges, with `Climb active`, the remaining distance and `View climb` all fully visible, the action keeping its 44px minimum touch target and its existing behaviour, and no truncation, smaller text or shortened label.
       - No navigation, climb-detection, camera, projection or elevation-logic change.
       - The testable contract is that the normal central route-ahead corridor in the representative Follow fixture is cleared and the cue occupies the lower-right overlay region. **No claim is made that a fixed screen corner can never cover any possible route geometry.**
       - The bottom-centre `.ride-map-paused-toast` can genuinely coexist with an active climb. Both messages are preserved; they must not overlap or obscure one another; the cue stays right-aligned; the **cue** shifts far enough above the toast to leave a normal design-token gap rather than the toast's ordinary position changing everywhere; and neither element is hidden or resolved away by z-index alone.
       - Non-collision was also required against the rider marker in the representative Follow-camera position, the north/Follow and zoom clusters, the map attribution, and the Map/Profile switcher or map boundary.
     - **Approved product behaviour — the imagery-recovery row.** Applied consistently to `RidingStatusCard` and `FreeRoamStatusCard`. For a retryable terminal imagery state at ordinary 390px portrait: the explanatory message is the flexible left column, `Retry map imagery` the non-shrinking right-hand action, message before button in DOM and reading order, contents optionally vertically centred but the text naturally wrapped and left-aligned, the button keeping its full label, existing styling and 44px minimum touch target, and the resulting row and card measurably shorter than before. A content-responsive CSS solution only — no `window.innerWidth`, no JavaScript text measurement, no resize listeners. Where the contents do not fit comfortably, including at 200% browser text, the row reverts naturally to the existing stacked arrangement with no horizontal overflow, no clipping, no squeezed text column, no button-label wrapping and no hard-coded assumption that item 113's future German localisation would invalidate. The non-retryable delayed state has no button and must not reserve an empty action column.
     - Preserved without modification: all imagery-state derivation and retry semantics, the shared `describeMapImageryRecovery` copy table, every current message, role and `data-testid`, the delayed-versus-terminal distinction, the rule that active Route riding and free roam host imagery status in the top status card with no duplicate over the map, Planning's and every other unhosted context's in-map presentation, and connectivity, geolocation, wake-lock and Screen-on behaviour.
     - Physical acceptance on the installed iPhone Home Screen PWA is required. Physical Android verification is separately outstanding, as for most recent items.

### Implementation account (12 September 2026, `0.4.30`)

**Outcome.** At ordinary phone portrait the climb cue now sits in the map's lower right, clear of the painted route ahead, and shifts further up when a paused-Follow toast appears beneath it. A retryable imagery row reads as one row — message left, action right — taking the status card from 162px to 142px in the representative state. Nothing else changed: no imagery-state derivation, no retry path, no copy, no role, no `data-testid`, no camera, projection, climb or geolocation code.

#### The climb cue

**The lower-right placement is an enhancement gated on available height, not an unconditional move.** This was decided before any code was written, from measurement rather than preference. At 390×844 with 200% root text the immersive map compresses to **358×206** while the cue grows to **230×206**, `.map-attribution` wraps to two lines at **278×62.25** and `.ride-map-paused-toast` reaches **333×54**. There is no arrangement of those four boxes inside 206px of map height in which a lower-right cue clears both the attribution and the toast. Three ways out were considered and two rejected outright: shrinking `.map-attribution` inside the riding map (rejected — it must stay legible and compliant, and at 200% it would have wrapped to roughly four lines in a 98px column), and placing the cue lower-right unconditionally while documenting a known collision (rejected — a documented collision is still a collision). What shipped instead is the third: **the base rule remains item 57's top placement, and the lower-right placement applies only above a measured height threshold.**

**The mechanism is a CSS size container, on a new wrapper rather than on the map.** `RidingClimbCue.tsx` now returns `.ride-climb-cue-slot` wrapping the unchanged cue markup. The slot is `position: absolute; inset: 0; z-index: 5; pointer-events: none; container-type: size`, so its height _is_ the map container's height and the cue can query it. It deliberately is **not** `container-type: size` on `.ride-map-container` itself: that property implies `contain: layout`, which makes an element a stacking context, and `.ride-map-container` is currently `z-index: auto` — `e2e/distanceBadges.spec.ts`'s own stacking-ancestry check depends on there being no stacking context between the map's markers and the overlay tier. The slot was _already_ a stacking context by virtue of `position: absolute` plus `z-index: 5`, so containment adds nothing new there. `container-type: size` is safe on it because all four insets are specified, so its size never depends on its contents, and size/layout containment do not clip (that is `contain: paint`, which is not applied). `RidingScreen.tsx`'s JSX is unchanged apart from its own positioning comment.

**The threshold, derived rather than picked.** `@container ride-map-overlay (min-height: 14rem)`. It is the height the map needs before the cue, the paused toast, the attribution and their `--space-8` gaps genuinely fit one above the other: 8px of top breathing room, plus the cue's worst-case height (its 8px vertical padding, a title line at `1rem`, a `--space-4` gap, a remaining-distance line at `0.85rem` allowed to wrap to two lines, another `--space-4` gap, and the action at `max(44px, 2 * --space-8 + a 1rem line)`), plus the larger of the two bottom reserves. That comes to roughly **174px at 100% root text and 266px at 200%**; as a single `rem` multiple the binding case is 100% text (174 / 16 = 10.9rem), so 14rem carries about 29% headroom there and far more at enlarged text, where the map is nowhere near that tall. It is in `rem`, not `px`, precisely so it scales with the content it protects. The flip was then **measured**: at 390px wide the immersive shell spends a constant 330px on chrome, and the cue is bottom-anchored at a map height of 230px and top-anchored at 210px — i.e. exactly at the 224px the rule specifies.

**Two rem-scaled reserves, combined with `max()` rather than an assumed ordering.** `.ride-climb-cue-slot` declares `--ride-map-attribution-reserve: calc(12px + 2rem + var(--space-8))` (the attribution's own 8px bottom inset, its 2px padding top and bottom, up to two wrapped lines at `line-height: 1.3` of `0.7rem` = 1.82rem rounded up to 2rem for headroom, and one `--space-8` gap) and `--ride-map-paused-toast-reserve: calc(24px + 1.35rem + var(--space-8))` (the toast's 8px inset, its `2 * --space-8` padding, one unwrapped line — it sets `white-space: nowrap` — budgeted at 1.35rem rather than a measured `line-height: normal` multiplier, and one `--space-8` gap). Neither dominates at every text size: at 100% root text the toast reserve is the larger, at 200% the two-line attribution reserve overtakes it, so the with-toast rule uses `max()` of the two. Both are deliberately conservative — `line-height: normal` is font-dependent and is not a number this project's stylesheet may assume.

**The toast rule is a sibling selector, and that is load-bearing.** `.ride-map-paused-toast ~ .ride-climb-cue-slot .ride-climb-cue` reaches the cue _through_ the slot, because the toast is a sibling of the slot rather than of the cue. `RidingScreen.tsx` renders the toast before the cue, and its comment now records that the DOM order is a dependency. Measured at 390×844: without the toast the cue's bottom inset is **52px**; with it, **53.6px**, leaving a **10.6px** gap above the toast. The shift is genuinely necessary — the toast spans x 105.7–284.3 and the cue x 222.0–366.0, a **62px horizontal overlap**.

**`max-width` relaxed from the control-safe span to the map's own insets.** In the lower-right branch only, `max-width: calc(100% - 16px)` replaces `calc(100% - 128px)`: the bottom of the map has no 48px control column to clear. The box still shrink-to-fits, so item 108's compaction result is untouched — the cue measures **144.03×91** at this viewport either way.

**What the geometry proof actually measures.** Two things were rejected during review and are worth recording. A "middle third of the map" corridor would have been wrong: at a 358px map width a 144px lower-right cue can intersect the horizontal middle third while clearing the real route ahead entirely, so that test could have rejected the approved design. And treating every blue pixel on the canvas as the rider would have been wrong for the same class of reason — `#1a73e8` is used by more than one layer. So `e2e/ridingClimbView.spec.ts` now screenshots the map with every DOM overlay hidden (including the cue itself, so the capture is equally clean on any earlier build), reads the backdrop colour off the image rather than hard-coding the local style's value, finds the **rider's marker** only within the below-centre region the following camera anchors it to, and then defines the route ahead as non-background ink strictly above that marker. Measured on the fixture: the marker paints at map-local (172–185, 310–323) against an expected follow anchor of (179, 317), and the route ahead is a 4px band at x 177–180 running from the map's top edge down to y 306. With a 24px safety band either side the corridor is x 153–204; the shipped cue occupies map-local 206.0–350.0, and the old top-centre cue occupied 64–208 × 8–99, which intersects it.

#### The imagery-recovery row

**One class, one rule, no new component.** Both cards' rows were already byte-identical, and the brief's instruction was to avoid extracting a component merely to remove that duplication. Inspection found no correctness benefit in doing so, so the change is a single class on the existing `<span>` — `ride-status-card-imagery-message` — applied identically in `RidingStatusCard.tsx` and `FreeRoamStatusCard.tsx`, plus two stylesheet rules. The rows remain byte-identical to each other.

**The mechanism is the `flex-wrap` the row already had.** `.ride-status-card-imagery-message` is `flex: 1 1 0; min-width: 14ch`, so its _hypothetical_ main size during line breaking is the floor rather than its much longer max-content; `.ride-status-card-imagery-row .map-status-retry-button` is `flex: 0 0 auto`, so its hypothetical size is its own label width. When floor + gap + label fits, the two share a line and the message then grows to fill; when it does not, the browser wraps the button onto a second line and the message takes the full width — which is exactly the previous stacked arrangement, reached naturally rather than by a breakpoint. No JavaScript measures anything, and there is no resize listener.

**The floor is `14ch`, and the value was measured, not guessed.** At 390px portrait the row's content box is **321px**, the Retry button's own label width **148.98px**, and `1ch` at the card's `0.85rem`/13.6px is **8.649px** — so the budget left for the message is **164.02px** and the floor must be at most that. 14ch is 121.08px. The remaining 43px of slack is deliberate: `ch` and the label width are both font-metric dependent, this project's primary device is iOS Safari, and **local WebKit could not be launched in the development environment** (`playwright install-deps` needs root for `libgtk-4`, `libevent-2.1`, `libgstcodecparsers-1.0` and `libavif`). The two metrics would have to run about 16% wider together than they do in Chromium before the row stopped fitting side by side at 100% text, and iOS's own system-ui is narrower rather than wider. A first attempt at `20ch` (172.98px) was measured and **rejected because it did not fit** — the row stayed stacked. The same slack at the other end means the row returns to stacking somewhere above roughly 115% root text, which measurement confirms is where stacking is genuinely the shorter arrangement anyway.

**Measured result, same viewport and same state.** Before: row 332×**84**, message 321×32 on two lines, button 148.98×44 wrapped below it, card 358×**162**. After: row 332×**64**, message 164.02×64 on four lines at x 40, button 148.98×44 at x 212.02 beside it, card 358×**142**. The row's height is governed by its taller child (64 = the message) rather than by message + gap + button (116), and the browser test asserts that relationship directly rather than only asserting a smaller number. At 125%, 150% and 200% root text the row stacks again, with the button at 181.81px, 214.47px and 279.97px respectively and no horizontal overflow at any of them.

**Three details that keep the change contained.** The button overrides are scoped to `.ride-status-card-imagery-row` because `.map-status-retry-button` is shared with MapView's own in-map overlay, which Planning still uses and where the button genuinely does belong beneath its message — the `margin-top: var(--space-4)` belongs there, not here. `white-space: nowrap` is the explicit guarantee that the present label stays on one line, with `max-width: 100%` as a last-resort backstop so the button's box can never be wider than the row; the two only come into tension for a label that cannot fit the row at all, which the current one does not approach at either 100% or 200% text. And the transient `delayed` row needed no rule of its own: with no button, its single flex item grows to the whole row, so no empty action column is reserved.

#### Evidence

**Fail-first against `3767d6e`, measured in a temporary worktree** (never a checkout over live work; `node_modules` was copied rather than hard-linked, because hard links were not permitted in this environment). **Six Playwright tests failed for the predicted reasons:**

| Contract                                                      | Against `3767d6e`                                                           |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| The cue is lower-right, clear of the painted route ahead      | **failed** — right inset `Expected: 8, Received: 149.97`                    |
| The lower-right placement applies only above the threshold    | **failed** — `anchoredToBottom` false at a map height well above it         |
| Cue and paused toast coexist, the cue shifting up to clear it | **failed** — the cue does not move (`Expected: < 257, Received: 257`)       |
| Item 108's test, re-anchored to the map's right inset         | **failed** — same 8 vs 149.97                                               |
| Route riding: message left of Retry, sharing a row            | **failed** — `Expected: <= 40, Received: 361` (the button is wrapped below) |
| Free roam: the same one-row layout                            | **failed** — identically                                                    |

Five Vitest tests also failed there, all with "expected null not to be null": the slot wrapper and the message class simply do not exist on the parent. Those are **structural guards that cannot pass on the parent by construction**, not geometry evidence, and are classified as such. Two further honest classifications: the imagery tests had to be run on the parent with a temporarily adapted locator, because the parent's message span carries no class at all; and within the coexistence test only the "the cue moves up" assertion discriminates against the parent — its non-intersection assertions pass there, since a top-placed cue has no collision to have. What those non-intersection assertions catch is a _naive_ item 115, which is what negative control 1 demonstrates.

**Compatibility guards** — these already passed at `3767d6e` and are regression protection, **not** evidence of new behaviour: the cue's own touch target, readability and control-cluster/attribution/switcher non-overlap at 100% text; the short-landscape case; the 200%-text case in full, including the new "the top placement is in force" and "`View climb` stays operable" assertions, which hold on the parent for the same reason they hold now; the imagery row's 200% stacked arrangement; the delayed row's full width; Planning's unchanged in-map presentation; and every message, role, `data-testid` and retry path.

**Negative controls.** Nine were applied, measured and reverted. **One did not discriminate and exposed a genuine gap**, which was closed rather than quietly re-run:

| #   | Control                                                      | Result                                     |
| --- | ------------------------------------------------------------ | ------------------------------------------ |
| 1   | Move the cue down but drop the paused-toast rule             | 1 failed                                   |
| 2   | Delete the `@container` block (restore the old top position) | 3 failed                                   |
| 3   | Raise the threshold to 40rem                                 | 3 failed                                   |
| 4   | Lower the threshold to 6rem                                  | 2 failed                                   |
| 5   | Force the imagery row to stay one line (`flex-wrap: nowrap`) | 1 failed                                   |
| 6   | Let the Retry button shrink and wrap (`flex: 1 1 auto`)      | **passed at first** — fixed, then 3 failed |
| 7   | Reserve an empty action column for the delayed row           | 1 failed                                   |
| 8   | Unscope the row's button overrides so they reach Planning    | 1 failed                                   |
| 9   | Restore an in-map duplicate of the hosted imagery message    | 3 failed                                   |

Control 6 passed because at 390px the row is not tight enough for a shrinkable button to visibly break anything: with `flex: 1 1 auto` the button simply _grew_ into the message's space (170.5px against its own 148.98px of label) while still fitting one line, and every assertion held. The gap was that nothing pinned the action to its own intrinsic width. It now does: the test clones the button in place at `width: max-content` and asserts the rendered width matches, so the action can be neither squeezed nor stretched by the row's flex distribution. That is a real measurement, not a restated constant, and the rebuilt control fails on it.

**Limitations, stated precisely.**

- **Local WebKit could not be run at all** in the development environment, for the missing-system-library reason above; every browser measurement here is Chromium (and the `android-chrome` Chromium-emulated project). CI's own `webkit-smoke` project covers `smoke.spec.ts` only and does not exercise any of this geometry. The `14ch` floor's headroom is the deliberate mitigation, not a substitute for a measurement.
- **At 200% root text the cue keeps its top placement**, by design — but see the two follow-up sections below: the top inset was subsequently reduced to 0 at severely constrained map heights, because the ordinary 8px inset was pushing the action below the 44px floor in CI's container. Pairwise non-intersection with the attribution and the paused toast is asserted **only** in the height-qualified lower-right branch. That over-constrained coexistence at 200% is a **preserved pre-existing limitation**, neither introduced nor fixed by item 115, and **no claim is made that no map content is obscured at that text size**. (This bullet originally quoted "52px of its 56px" from a development-host measurement; the pinned container measures the same build differently, which is what the next section is about.)
- The repository's own `e2e/ridingClimbView.spec.ts` comment for the short-landscape test previously attributed 200%-portrait numbers ("map 358x206, cue 230x206") to short landscape. That was already wrong before this item and is corrected here with the measured landscape values (map 812×160, cue 144×91, contained in practice); the non-assertion itself is kept rather than tightened, because landscape is explicitly not an acceptance-tested orientation for this project.
- **Item 115 carries automated evidence only** until it is checked on the installed iPhone. Physical Android verification remains separately outstanding.

### CI failure on the first push, and what it changed (12 September 2026)

The first push of this item (`cf5e6e6`, `0.4.30`) **failed CI** — the `End-to-end tests` job, at the `End-to-end test suite` step; `Verify and build` passed and `Deploy` was correctly skipped, so nothing was deployed. The parent run for `3767d6e` had passed, so the failure was this change's own.

**The cause was one of this item's own new assertions, not a defect in the shipped behaviour.** The 200%-enlarged-text climb-cue test asserted that at least 44px of the `View climb` action remained inside the map. That passed on the development host and failed in CI with `Expected: >= 44, Received: 42`.

**Diagnosed by reproducing CI's exact environment, not by guessing.** The pinned container image was already available locally, so the whole suite was run inside `mcr.microsoft.com/playwright:v1.61.1-noble` against the same build. It reproduced precisely: **1 failed, 344 passed**, the same single test. The container's own fonts make the immersive header and status card taller, so at 390x844 and 200% root text the map measures **358x174** there against **358x206** on the host, and more of the cue falls past the map's `overflow: hidden` edge.

**The clipping is pre-existing, and that was measured rather than assumed.** The parent commit `3767d6e` was built in a worktree and probed in the same container: map **358x174**, cue **230x190** at the map's own y+8, action **206x62**, **42px** of it visible, 24px of cue overflowing — **byte-identical to the item 115 build**. Item 115 does not engage its lower-right placement at that size, so this is exactly the behaviour item 57's placement has always had at extreme text scaling.

**What `7bee475` changed — and what it got wrong.** That commit rewrote the assertion to describe the clipping instead of rejecting it: the action's top edge inside the map, the clipped amount being less than the cue's total overflow, a real click still switching the view, plus a guard that the constrained branch is the base rule. It then recorded the 42px as a pre-existing limitation "for a later decision", on the stated ground that enlarged browser text is not an acceptance requirement for this project.

**That ground was wrong, and the conclusion with it.** [`current-status.md`](../current-status.md)'s own reading note already establishes the opposite: ACN has **no iOS Dynamic Type opt-in**, so the system Larger Text setting does not resize the application at all, and **the automated 200% root-font-size Playwright coverage IS this project's enlarged-text evidence**. Shipping `0.4.30` with the action below the 44px floor at the one text condition the project actually tests was therefore not a deferrable observation, and `clippedActionHeight < cueOverflowPastMapBottom` was a weak proxy besides — it follows largely from the action sitting above the cue's bottom edge and would pass with almost the whole button clipped. A successful Playwright click proves some clickable area survives, not that an adequate target is exposed. See the next section for the correction.

**A negative control that had to be rebuilt, reported rather than quietly re-run.** Lowering the `@container` threshold to 6rem was meant to prove the new guards catch the lower-right branch leaking into the constrained case. It failed only the short-landscape test — because 6rem at 200% root text is 192px, still above the container's 174px map, so **the control never reached the case it was aimed at**. Rebuilt at 4rem (128px at 200% text) it does: the 200% test then fails on `cue.y - map.y` with `Expected: 8, Received: -64`. Same class of mistake as item 110's control 4 — the test was fine, the control was wrong.

**After the correction the full suite passes in the pinned container: 345 passed, 0 failed**, across all three Playwright projects including `webkit-smoke`. That container run is also the only WebKit evidence this item has, and it covers `smoke.spec.ts` only, not any of the geometry above.

**One unrelated failure was seen and diagnosed, not re-run into submission.** During the post-fix sweep, `src/gpx/parseAcnExtension.test.ts`'s "rejects when the manoeuvre count exceeds MAX_ACN_MANOEUVRES" timed out at 22.7s against Vitest's 20s per-test limit. It is unrelated to item 115: `git diff 3767d6e..HEAD -- src/gpx/` is empty, so the file and everything it exercises are byte-identical to the parent, and the failure is a timeout rather than an assertion. Measured in isolation the file takes 15.3s of test time, nearly all of it that one test building a document with more than `MAX_ACN_MANOEUVRES` manoeuvres — about 30% of headroom against the limit, which concurrent CPU load (several Playwright containers, in this case) is enough to consume. It passed in isolation and in a full-suite run with no competing load, and had already passed twice earlier in the same session. Recorded here as a pre-existing, load-sensitive slow test rather than given a ledger entry or quietly re-run.

**The process lesson, worth carrying forward.** Host-green is not CI-green for anything whose geometry depends on text metrics. The host and the pinned container disagreed by 32px of map height at 200% text on an unchanged build. Any future change that asserts pixel relationships involving rendered text should be run in `mcr.microsoft.com/playwright:v1.61.1-noble` before pushing — it is a single `docker run` against the working tree and takes about a minute for the whole suite.

### Corrective follow-up: keeping the enlarged-text action fully exposed (`0.4.31`)

`0.4.30` deployed carrying the 42px shortfall. This follow-up restores the project's 44px automated enlarged-text contract in production CSS rather than in the test.

**The correction, one rule.** A second container query, written after the lower-right one:

```css
@container ride-map-overlay (max-height: 7rem) {
  .ride-climb-cue {
    top: 0;
  }
}
```

At a map height that cannot afford the ordinary 8px top inset, the inset is given back. **Nothing shrinks** — not the action, not the text, not `.map-attribution` — the placement stays the top one item 57 chose, the 14rem lower-right eligibility contract is untouched, and there is no JavaScript.

**Both the inset and the threshold were measured, not chosen.** Candidate insets, at 390x844 and 200% root text in `mcr.microsoft.com/playwright:v1.61.1-noble`, action 206x62:

| top inset       | visible action | against the 44px floor              |
| --------------- | -------------- | ----------------------------------- |
| 8px (`7bee475`) | 206x**42**     | **−2, fails**                       |
| 4px             | 206x**46**     | +2 — too close to be worth shipping |
| **0**           | 206x**50**     | **+6**                              |

`0` was taken: it is the smallest possible inset and the only candidate with real headroom. On the development host the same rule exposes all **56px** of the action. Removing the cue's block padding was available as a further 4px and was **not** taken — it changes the visual treatment, and measurement showed it was not needed.

The `7rem` threshold is derived from the cue's own height, which is roughly 5.7–6.0rem at any text size, so it reads as "the map is no taller than about the cue itself". At 200% text that is 224px, comfortably above the container's 174px map, so it fires; at short landscape (map 160px at 100% text) it is 112px, so it does not, and that already-contained case keeps its 8px inset. It is strictly below 14rem, so the two queries are mutually exclusive by construction and the lower-right placement can never engage at 200%.

**Investigation, before any CSS changed.** `7bee475` was measured in both environments. Ordinary 390x844 at 100% text: lower-right branch in both (map 358x514 host / 358x518 container, cue right inset 8px, action fully visible). At 200%: constrained top branch in both (cue top inset 8px, left inset 64px), action horizontally unconstrained (the full 206px intersects the map), and the only clipping ancestor cutting it is `.ride-map-container--immersive`'s own `overflow: hidden`. `document.elementFromPoint` at the centre of the visible area resolved to the action itself, so nothing covers it. The imagery row is untouched throughout.

**The restored test contract.** The test is renamed to what it actually guarantees — _"the Map climb cue remains readable with a fully exposed action at 200% enlarged text"_ — and now computes the real intersection of the action box with the map box, requiring **both** dimensions to be at least 44px:

```ts
visibleWidth = Math.min(buttonRight, mapRight) - Math.max(buttonLeft, mapLeft);
visibleHeight = Math.min(buttonBottom, mapBottom) - Math.max(buttonTop, mapTop);
```

The weak `clippedActionHeight < cueOverflowPastMapBottom` proxy is gone. The measured map, cue, button and intersection geometry is embedded in each assertion's failure message, so a future environment difference is diagnosable without editing the test first — which is exactly what the original assertion cost. Hit-testability is proved at the centre of the **visible** area with `document.elementFromPoint(...).closest("button")` and a real `page.mouse.click` at that point, deliberately not `locator.click`, which would aim at the whole element's centre including the clipped part. The retained guards are exact rather than informal: still the constrained branch, `0 ≤ cue.y − map.y ≤ 8`, `cue.x − map.x ≈ 64` and `width ≤ map.width − 128` (which together already prove at least 64px of clearance on both sides, so no separate right-inset assertion is needed), horizontal containment, untruncated text, and the action's own box at ≥44x44.

**Fail-first against `7bee475`, in the pinned container.** The restored assertion fails there with exactly the reproduced result, and the new diagnostics carry the whole geometry:

```
visible action height below the 44px floor: {"mapBox":{...,"width":358,"height":174},
"cueBox":{...,"width":230,"height":190},"cueButtonBox":{...,"width":206,"height":62},
"visibleWidth":206,"visibleHeight":42}
Expected: >= 44   Received: 42
```

The other eight tests in the file pass on `7bee475` and are **compatibility guards**, not fail-first evidence.

**Negative controls — all five discriminated.** Each applied, measured in the container and reverted:

| #   | Control                                                                 | Result   |
| --- | ----------------------------------------------------------------------- | -------- |
| 1   | Remove the new constrained-height query                                 | 1 failed |
| 2   | Restore the 8px inset inside it                                         | 1 failed |
| 3   | Force the lower-right branch at 200% (14rem → 4rem)                     | 2 failed |
| 4   | Widen the new query so it matches at ordinary height too (7rem → 40rem) | 5 failed |
| 5   | Shrink the action itself instead of exposing it                         | 5 failed |

Control 4 is why the new block is written **after** the lower-right one: a threshold edit that made the two overlap is caught by the ordinary placement tests rather than silently preferred.

**An unrelated failure, diagnosed again rather than re-run into green.** The full container suite showed one failure in `e2e/ridingFinishAndEnd.spec.ts`'s "conservatively confirms route completion only after consecutive fixes" — item 32's own named test and its own `toBeVisible` timeout. This change touches only `src/index.css` and `e2e/ridingClimbView.spec.ts`; the spec passes 4/4 in isolation in the same container, and the identical suite had passed 345/345 twice earlier the same day. Recorded as a further dated sighting under item 32 in [`current-status.md`](../current-status.md), with its own "ordinary load" trigger noted honestly rather than quietly absorbed. Its timeout was not touched.

**Verification.** The focused enlarged-text test passes three consecutive times in the pinned container; the whole of `ridingClimbView.spec.ts` passes 9/9 there; the full suite passes across all three Playwright projects, `webkit-smoke` included — that container run remains the only WebKit evidence, since local WebKit cannot be launched in this development environment at all.

---

<a id="item-116"></a>

## Item 116 — Retain Playwright failure evidence — done

_Category: Verification / test-infrastructure hardening_

116. **Retain Playwright failure evidence — done**
     - Origin: item 32's bounded investigation of 12 September 2026 ([`current-status.md#item-32`](../current-status.md#item-32)). That investigation had to build its own instrumentation from scratch, because this repository retained **nothing** from a failed run: `playwright.config.ts`'s `use` block was only `baseURL`, so `trace`, `screenshot` and `video` were all at their `off` defaults; the reporter is `list`; and the workflow uploaded no artefacts. Four months of item 32 sightings had been diagnosed from reporter text alone.
     - Approved outcome, stated as an outcome rather than one exact configuration: traces retained for failed tests only; screenshots captured for failed tests only; no video by default; the E2E GitHub Actions job uploads the relevant `test-results/` contents **when it fails**; passing runs retain and upload nothing unnecessary; short (seven-day) artefact retention; no HTML reporter unless inspection establishes a concrete benefit; no production behaviour change; no application version bump.
     - Constraints: keep it small — no new reporting framework, dependency, retry policy or external service.
     - Item 116 requires **no physical-device acceptance**: it changes only test infrastructure and CI, and nothing about the deployed application's bytes or behaviour.

### Implementation account (12 September 2026, no version bump)

**What shipped, in two files.** `playwright.config.ts` gained `screenshot: "only-on-failure"` unconditionally and `trace: process.env.CI ? "retain-on-failure" : "off"`. `.github/workflows/deploy-pages.yml` gained an `id: e2e` on its test step and one failure-path upload step. Nothing else: no retries, no video, no HTML reporter, no dependency, no lockfile change, no production source or CSS, and `package.json` stays at `0.4.31` — matching this repository's established precedent for test-only slices (items 21/30/44/45, and item 86's own explicit statement that there is nothing for a version number to mark when the deployed bytes are unchanged).

**Values verified against the installed package, not assumed.** `@playwright/test`, `playwright` and `playwright-core` are all `1.61.1`, and the real test types live at `node_modules/playwright/types/test.d.ts` (`playwright-core/types/test.d.ts` does not exist in this version). `TraceMode` includes `'retain-on-failure'`; `ScreenshotMode` includes `'only-on-failure'`. The two unions are **not** interchangeable — `'only-on-failure'` is invalid for `trace` and `'retain-on-failure'` is invalid for `screenshot`. `on-first-retry` was excluded on evidence rather than preference: its own doc comment records that it captures only on a retry, and this repository runs at `retries: 0`, so it would capture nothing at all; adding retries purely to make a trace mode work would have hidden the very flakiness a trace exists to explain.

**Why the trace is scoped to CI — the measurement that changed the design.** The slice was planned with both settings unconditional. Measured in the pinned container, interleaved against unmodified `aa84a6f`, no artificial contention:

| configuration      | 36 workers (default)                | `--workers=4`      |
| ------------------ | ----------------------------------- | ------------------ |
| baseline `aa84a6f` | 58.7 s / 59.4 s / 58.9 s            | 240.9 s            |
| trace + screenshot | 72.5 s / 72.4 s / 72.4 s — **+23%** | 308.3 s — **+28%** |
| screenshot only    | 61.1 s / 61.4 s — **+4%**           | —                  |

`retain-on-failure` records a trace for _every_ run and discards the passing ones, so the cost is paid on every passing test. It is consistent at both concurrencies, which rules out contention as the explanation: it is a genuine per-test recording cost. Screenshot capture is nearly free because `only-on-failure` captures nothing while a test is passing.

The decision rested on an asymmetry rather than on cost alone. A **local** failure leaves `test-results/` on disk and can simply be re-run with `npm run e2e -- --trace retain-on-failure` (that CLI override was confirmed present in the installed 1.61.1 CLI, and is exactly how item 32's own instrumentation runs were done). A **CI** failure has no second chance: the container is discarded when the job ends, and the failure may not reproduce locally at all — which is precisely the situation item 115's CI failure and item 32's sighting both created. CI therefore pays the recording cost and ordinary local runs do not.

**The E2E job's timeout was deliberately not raised.** Its two most recent successful runs took **668 s and 678 s** against `timeout-minutes: 20`. Roughly a quarter more on the test-running portion still leaves comfortable headroom. If that job later approaches the limit it should be optimised or sharded; granting it a bigger budget pre-emptively would only hide the growth.

**A stability claim that the evidence does not support, withdrawn.** At 36 workers the three tracing runs each lost a test (344/343/344), which looked like tracing destabilising the suite. Three things refute that reading. At `--workers=4` baseline and tracing lost exactly one test each (344 both). The unmodified `aa84a6f` baseline, run three more times at 36 workers under `CI=1`, went 345/345/**344**, so across six baseline runs in total **two** lost a test. And every failure named a _different_ test — `rideSessionSwitchGuard.spec.ts:654` and `:948`, `mapImageryRecovery.spec.ts:315` — which is item 32's own documented observation that this contention-sensitive class is broader than the one test that item names. The sample cannot separate a tracing effect from that background rate, so **no such attribution is made**. Worth recording alongside it: the configuration actually shipped for local runs, screenshot-only, was the most stable observed at 345/345 across three runs.

**The one CI-branch full-suite run did itself fail — and demonstrated the point of the item.** Run locally with `CI=1` at 36 workers (far heavier than CI's own ~2 workers on a 4-vCPU runner), it lost `rideSessionSwitchGuard.spec.ts:948` and, because the trace branch was active, left a complete `trace.zip`, `test-failed-1.png` and `error-context.md` behind. The error context alone gave the assertion, the locator and a full ARIA snapshot of the page at failure — `Start riding` never appeared — without any re-instrumentation. That is precisely the diagnostic position item 32's investigation did not have.

**Storage, measured.** A passing full-suite run leaves **12 K** in `test-results/` (`.last-run.json` only). One captured failure costs about **1.5 MB** on the CI branch — `trace.zip` 1.4 MB, `test-failed-1.png` 56 K, `error-context.md` 16 K — and **84 K** on the local branch, where the trace is absent. `error-context.md` is Playwright's own default and was already being written before this item.

**The workflow step.**

```yaml
- name: Upload Playwright failure evidence
  if: ${{ failure() && steps.e2e.conclusion == 'failure' }}
  uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
  with:
    name: playwright-failures-${{ github.run_id }}-${{ github.run_attempt }}
    path: test-results/
    if-no-files-found: ignore
    retention-days: 7
```

`failure()` is false on cancellation, and `steps.e2e.conclusion == 'failure'` narrows it to the E2E step itself, so an earlier failure (toolchain check, `npm ci`, build) cannot upload an empty directory. `if-no-files-found: ignore` is not cosmetic — the default is `warn`, and a missing directory must never obscure the real test failure. Only `test-results/` is uploaded: never `dist/`, `node_modules/`, the repository root or unrelated logs. The step exists in the `e2e` job alone; `verify`, `deploy` and `deploy`'s `needs: [verify, e2e]` gate are untouched, and **no `permissions:` block gained anything** — `upload-artifact` uses the Actions runtime token, not `GITHUB_TOKEN`, which its README at that exact commit confirms.

**Pin provenance.** `actions/upload-artifact` was resolved live twice — once while scoping, once immediately before editing — both times `v7.0.1` / `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`, matching item 88's own documented practice and this repository's v7-generation pins. Its `action.yml` at that commit confirms the four inputs used. Dependabot's existing `github-actions` entry picks the new `uses:` up automatically, so `.github/dependabot.yml` needed no change.

**Security and privacy inspection — the gate on enabling the upload.** A deliberate one-assertion failure was induced in `e2e/planning.spec.ts`, chosen because it is the richest sensitive path: it types the routing API key into Settings and exercises the mocked OpenRouteService adapter. The produced `trace.zip`, `test-failed-1.png` and `error-context.md` were then inspected — all 81 files, including the trace's network log, event log and 75 DOM/resource snapshots.

- **Zero real environment-secret values were found.** The search used the _actual values_ of environment variables whose names match key/token/secret/password/credential/auth/session/cookie/private and are at least eight characters — three such variables existed; none of their values appears in any artefact. No value was printed at any point, here or in the logs.
- The **synthetic** `dummy-e2e-key` does appear, in the trace's network log (the mocked request's authorisation header), the trace event log and one DOM snapshot. It is the fixed literal every spec uses; no real key exists in CI, because the key is user-supplied at runtime and, per root `CLAUDE.md`, never baked into the bundle, tests or Actions configuration.
- **The screenshot exposes no key.** The failure occurs on the Planning screen, so the Settings field is not in frame, and that input is `type="password"` by default. One nuance worth carrying forward: masking protects the _screenshot_, not the trace — a trace DOM snapshot serialises an input's value, so a **local** trace taken after a developer entered their own real key would contain it. `test-results` is gitignored, local traces are never committed, and only CI artefacts are uploaded.
- Hosts appearing in the trace: `localhost:4173`, plus `api.heigit.org` and `tiles.openfreemap.org`, both intercepted by the suite's own mocks. No unexpected destination.

The probe was then removed and `e2e/planning.spec.ts` proved byte-identical to its pre-probe state by sha256 and by `git diff --exit-code`.

**Evidence and controls.** Against the shipped configuration: with `CI=1` (as GitHub Actions sets) the controlled failure produces `trace.zip`, `test-failed-1.png` and `error-context.md`; without it, the same failure produces the screenshot and error context but no trace; and `npm run e2e -- --trace retain-on-failure` restores the trace locally on demand. The trace is genuinely inspectable, not merely present — 287 + 8 + 106 events parsed with **0 unparseable**, 48 frame snapshots, 66 screencast frames, 75 resources. (`show-trace` needs a GUI, so no interactive claim is made.) Two controls discriminate independently: removing the screenshot setting leaves the trace but no PNG; forcing the trace off leaves the PNG but no trace.

**What could not be proved honestly, and is not claimed.** GitHub's failure-only upload branch cannot be exercised without pushing a deliberately failing commit, which was not done. **A green CI run is not evidence that the upload step ran.** The step was instead validated structurally by parsing the workflow YAML and asserting every property of it — the step exists in `e2e` only, the condition carries both `failure()` and the step-conclusion guard, the action is SHA-pinned with a version comment, the four inputs are exact, `deploy.needs` is unchanged and no permissions widened — alongside Prettier, which does format `.github/` in this repository. `actionlint` is not installed here and was deliberately **not** fetched: introducing an unverified binary for an optional check would be a worse trade than the parse plus source review.

**First real failure-path use (12 September 2026) — and it worked, discharging the limitation above.** Item 111's first deployment run (CI run `34714031877`) failed its End-to-end job, and this item's `if: failure() && steps.e2e.conclusion == 'failure'` upload fired on exactly the right condition, producing `playwright-failures-34714031877-1` (862,907 bytes) holding precisely `trace.zip`, `test-failed-1.png` and `error-context.md` for the one failed test — nothing else, and nothing from the passing job. That artefact identified the **wrongly activated control**: Playwright's retained log named the resolved locator and the dispatched coordinate `{x: 141.87, y: 553}`, and the ARIA snapshot showed which screen the click actually produced. Without it the failure read as a bare "heading not found" and the diagnosis would have been a guess between five hypotheses; with it, a real production interaction-safety defect was found and corrected under item 95. One practical limitation observed at the same time, and not a defect in this item: downloading the artefact needs an authenticated GitHub client, so an environment with no `gh` and no token gets `401` on the artefact endpoint and `403` on the job-log endpoint, and the artefact has to be supplied by hand.
