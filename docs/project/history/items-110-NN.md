# Completed backlog items 110–

This file continues the 100– numeric range and opens at item 110. It was started when item 110 was completed: adding it to what was then `items-104-NN.md` would have taken that file to 163,015 characters, past the ~150,000-character soft cap documented in [`README.md`](README.md), so that file was closed at item 109 and renamed [`items-104-109.md`](items-104-109.md) instead of growing unbounded. No existing entry was moved, shortened or rewritten by that split — only the filename changed, plus the inbound links that pointed at it. Stable item numbers never change regardless of which file their text lives in: item 110 holds the highest number in the project so far and was nevertheless completed ahead of items 102 and 103, which remain pending.

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
- **At 200% root text nothing about the cue changed**, by design. Pairwise non-intersection with the attribution and the paused toast is asserted **only** in the height-qualified lower-right branch. The over-constrained coexistence at 200% is a **preserved pre-existing limitation** — neither introduced nor fixed by item 115 — and the 200% test asserts what is genuinely achievable there instead: that the top placement is in force, that the cue is horizontally contained and its text untruncated, and that `View climb` remains operable, measured as the part of the action actually on screen (52px of its 56px, against a 44px floor) plus a real click that switches the view. **No claim is made that no map content is obscured at that text size.**
- The repository's own `e2e/ridingClimbView.spec.ts` comment for the short-landscape test previously attributed 200%-portrait numbers ("map 358x206, cue 230x206") to short landscape. That was already wrong before this item and is corrected here with the measured landscape values (map 812×160, cue 144×91, contained in practice); the non-assertion itself is kept rather than tightened, because landscape is explicitly not an acceptance-tested orientation for this project.
- **Item 115 carries automated evidence only** until it is checked on the installed iPhone. Physical Android verification remains separately outstanding.

### CI failure on the first push, and what it changed (12 September 2026)

The first push of this item (`cf5e6e6`, `0.4.30`) **failed CI** — the `End-to-end tests` job, at the `End-to-end test suite` step; `Verify and build` passed and `Deploy` was correctly skipped, so nothing was deployed. The parent run for `3767d6e` had passed, so the failure was this change's own.

**The cause was one of this item's own new assertions, not a defect in the shipped behaviour.** The 200%-enlarged-text climb-cue test asserted that at least 44px of the `View climb` action remained inside the map. That passed on the development host and failed in CI with `Expected: >= 44, Received: 42`.

**Diagnosed by reproducing CI's exact environment, not by guessing.** The pinned container image was already available locally, so the whole suite was run inside `mcr.microsoft.com/playwright:v1.61.1-noble` against the same build. It reproduced precisely: **1 failed, 344 passed**, the same single test. The container's own fonts make the immersive header and status card taller, so at 390x844 and 200% root text the map measures **358x174** there against **358x206** on the host, and more of the cue falls past the map's `overflow: hidden` edge.

**The clipping is pre-existing, and that was measured rather than assumed.** The parent commit `3767d6e` was built in a worktree and probed in the same container: map **358x174**, cue **230x190** at the map's own y+8, action **206x62**, **42px** of it visible, 24px of cue overflowing — **byte-identical to the item 115 build**. Item 115 does not engage its lower-right placement at that size, so this is exactly the behaviour item 57's placement has always had at extreme text scaling.

**What changed, and what deliberately did not.** The assertion was replaced, not relaxed away, with claims that are environment-independent and still meaningful: the action's top edge sits well inside the map, the only thing clipping it is the map's own bottom edge (the clipped amount is strictly less than the cue's total overflow), a real click still switches the view, and — the regression guard that matters — the constrained branch really is the unchanged base rule (`cue.x - map.x ≈ 64`, width still clamped to the control-safe span). **The 2px shortfall against the 44px touch-target floor at 200% root text was not silently fixed**: closing it would mean altering the base placement, which this item deliberately leaves alone, and enlarged browser text is explicitly not an acceptance requirement for this project. It is recorded here and in [`current-status.md`](../current-status.md) as a pre-existing limitation for a later decision, and no new item number has been invented for it.

**A negative control that had to be rebuilt, reported rather than quietly re-run.** Lowering the `@container` threshold to 6rem was meant to prove the new guards catch the lower-right branch leaking into the constrained case. It failed only the short-landscape test — because 6rem at 200% root text is 192px, still above the container's 174px map, so **the control never reached the case it was aimed at**. Rebuilt at 4rem (128px at 200% text) it does: the 200% test then fails on `cue.y - map.y` with `Expected: 8, Received: -64`. Same class of mistake as item 110's control 4 — the test was fine, the control was wrong.

**After the correction the full suite passes in the pinned container: 345 passed, 0 failed**, across all three Playwright projects including `webkit-smoke`. That container run is also the only WebKit evidence this item has, and it covers `smoke.spec.ts` only, not any of the geometry above.

**One unrelated failure was seen and diagnosed, not re-run into submission.** During the post-fix sweep, `src/gpx/parseAcnExtension.test.ts`'s "rejects when the manoeuvre count exceeds MAX_ACN_MANOEUVRES" timed out at 22.7s against Vitest's 20s per-test limit. It is unrelated to item 115: `git diff 3767d6e..HEAD -- src/gpx/` is empty, so the file and everything it exercises are byte-identical to the parent, and the failure is a timeout rather than an assertion. Measured in isolation the file takes 15.3s of test time, nearly all of it that one test building a document with more than `MAX_ACN_MANOEUVRES` manoeuvres — about 30% of headroom against the limit, which concurrent CPU load (several Playwright containers, in this case) is enough to consume. It passed in isolation and in a full-suite run with no competing load, and had already passed twice earlier in the same session. Recorded here as a pre-existing, load-sensitive slow test rather than given a ledger entry or quietly re-run.

**The process lesson, worth carrying forward.** Host-green is not CI-green for anything whose geometry depends on text metrics. The host and the pinned container disagreed by 32px of map height at 200% text on an unchanged build. Any future change that asserts pixel relationships involving rendered text should be run in `mcr.microsoft.com/playwright:v1.61.1-noble` before pushing — it is a single `docker run` against the working tree and takes about a minute for the whole suite.
