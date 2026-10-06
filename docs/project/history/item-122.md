# Item 122 — Planning map area on a phone

**Recorded in its own file for size only.** Item 122 belongs in [`items-118-131.md`](items-118-131.md), between items 121 and 123, where a pointer keeps the numeric order. That file holds about 137,600 characters and is closed at item 131, and this record would take it past the ~150,000-character soft cap documented in [`README.md`](README.md). This is the only record of item 122, not a second one.

See [`README.md`](README.md) for the full history index, [`../backlog.md`](../backlog.md) for pending specifications, and [`../current-status.md`](../current-status.md) for the manual acceptance ledger.

---

<a id="item-122"></a>

## Item 122 — Planning map area on a phone — done

_Category: Planning layout_

122. **Planning map area on a phone — design stage first**
     - Origin: item 113's first installed-iPhone pass, 25 September 2026. The Planning map felt too small for planning compared with free roam's map.
     - **Scheduled on 1 October 2026**, second in the approved execution order (root [`CLAUDE.md`](../../../CLAUDE.md)), after item 124 and before items 103 and 120, by the rider's decision; it was unscheduled until then. **Scheduling approves its investigation and design stage only** — no dimensions, expansion behaviour or implementation. Nothing about a new size is approved by this entry.
     - Present fact: `.planning-map-container` is `clamp(280px, round(nearest, 44dvh, 20px), 460px)` behind an `@supports` fallback chain. The 20 px rounding is load-bearing: a fractional map-container height once left MapLibre's drag-rotate/pitch handler permanently active with no end event. That was found in CI during the interface migration's fifth slice, and it recurred in Planning ([`history/interface-accessibility-migration.md`](interface-accessibility-migration.md)).
     - Any change must be **measured and tested as its own alternative**. That covers the gesture end events at the new heights; the waypoint list, profile, warnings and save controls remaining reachable; item 114's attribution/placement-control relationship; and the ordinary 390 px presentation. It must not be folded into item 103 or any other styling work.
     - **Coordinate with item 128** (shipped `0.4.50`, [`history/items-118-131.md`](items-118-131.md#item-128)): its C6 layout was verified at the current map dimensions. Every proposed map size must rerun item 128's crosshair, imagery-message, Retry, placement-control and attribution checks — `e2e/planningImageryBanner.smoke.spec.ts` and the probe in [`../design/planning-imagery-banner/`](../../design/planning-imagery-banner/README.md) — and report the 280 px-floor case at 320×568, where German still overlaps the crosshair by 15 px.
     - **Coordinated with [item 141](items-132-NN.md#item-141) (5 October 2026),** the compact Edit copy notice: the notice above the map takes first-screen height from the map and **Calculate route**, so its design is considered with this item's layout decision. Neither item is scheduled for implementation by this. The combined proposal — the compact notice with maps of 500, 480 and 420 px — is in [the follow-up report](../../design/planning-map-area/copy-notice-and-map-size.md) (5 October 2026), awaiting the rider's decision.
     - **Final decisions, 5 October 2026** ([record](../../design/planning-map-area/copy-notice-and-map-size.md#final-design-decisions-5-october-2026)). These are design approvals, not device acceptance:
       - Calculate route directly below the map, before the editing actions;
       - the 480 px rule, `clamp(340px, round(nearest, 56dvh, 20px), 560px)`, with its fallback tiers;
       - today's height in the enlarged layout, without the wider direction-dependent switching range.

       It is to be implemented after item 141, once item 141 has its installed-iPhone acceptance. Item 141 shipped in `0.4.63` on 5 October 2026, and its visual and functional checks were accepted on the installed iPhone the same day (VoiceOver not checked), so item 122's implementation is next.

     - **Calculate-first comparison, 5 October 2026** ([record](../../design/planning-map-area/copy-notice-and-map-size.md#approved-direction-and-the-calculate-first-comparison-5-october-2026)). With Calculate route directly below the map, 480 px is the nearest height to the preferred 500 px that keeps Calculate inside the usable band in every measured 390×844 case with synthetic insets. 500 px misses an estimated copy by 5 px. The action order and the height await the rider's final decision.
     - **Investigation and design stage completed on 4 October 2026** ([report](../../design/planning-map-area/README.md)). It recommends a larger default map at ordinary text (C1), compares an on-demand expanded mode (C2) and a map sized to the fold (C1L), and lists the decisions needed. Nothing is implemented; the rider's layout decision is awaited.

### Implementation account (5 October 2026, `0.4.64`)

The rider's [final design decisions](../../design/planning-map-area/copy-notice-and-map-size.md#final-design-decisions-5-october-2026) of 5 October 2026, refined the same day during planning. Item 141's compact notice, accepted on the installed iPhone the same day, is unchanged.

**What the rider now sees** at 390×844 with an ordinary draft:

- **The map** is 358×480, where it was 358×380.
- **Calculate route** sits directly below it.
- **The editing actions** follow Calculate: Undo, Redo, Return to start and Reverse route, plus Deselect waypoint when a waypoint is selected.
- **Below the editing actions** come Calculate's routing error and stale-route note, when shown, and then the key-verification line.
- **The rest of the page** keeps its order.
- **At enlarged text,** item 114's layout keeps the map's earlier height and its accepted presentation.

**The rider's refinement during planning.** The approved order put Calculate's routing error and stale-route note with it, above the editing row.

- **The problem:** on a calculated route, any edit marks the route stale in that same render, and the automatic recalculation follows 900 ms later. The note would therefore have pushed the editing row down until the recalculation finished.
- **The decision:** the messages follow the editing row, so it never moves when they appear or clear. They are still directly after the actions they explain, and before the key line.

**`src/index.css`:**

- **The ordinary map:**
  - a `480px` fallback;
  - `clamp(340px, 56dvh, 560px)`;
  - `clamp(340px, round(nearest, 56dvh, 20px), 560px)`, which keeps the load-bearing 20 px snap.
- **One shared rule** gives `.planning-map-container--enlarged-text` and the new `.planning-map-size-reference` the earlier tiers: `340px`, `clamp(280px, 44dvh, 460px)` and the `round()` tier.
- **The reference** is an absolutely positioned, `visibility: hidden`, `aria-hidden` box inside the map container.
- **The built CSS** keeps the tier order in both rules; the minifier only drops the default `nearest`.
- **The old `.planning-calculate-actions` rule** became `.planning-calculate-status`, holding the messages and the key line.

**`src/ui/planning/PlanningScreen.tsx`:**

- **The panel order:** Calculate is the actions panel's first child, then the editing `role="group"` row, then a status group. The status group holds the routing error, the stale note and the key line, and is rendered only when it has content. The routing `<details>`, the Clear draft slot and the focus park are unchanged.
- **The guard:** `useEnlargedTextLayout` now reads the size reference, and the dead `mapContainerRef` is gone.
- **Unchanged:** labels, handlers, enabled states, roles and the copy notice.

**The guard, and why it reads a reference.** Measured against the live map, the switch would engage against the taller ordinary map and release against the shorter enlarged one. At 375×667 that is about 126% against 108.7%. The reference always has the enlarged layout's height and the map's width, so the switch decides at item 114's accepted points.

- **What `enlargedTextLayout.ts` keeps:** the 17 and 17.25 thresholds and its onset table.
- **What `useEnlargedTextLayout.ts` adds:** back whatever width a classic scrollbar takes (see below).

**Measured** in the CI image by digest, in Chromium and WebKit, with identical numbers in both engines. "Synthetic" insets are assumptions, not readings from the rider's phone.

| 390×844                                   | Map     | Calculate's margin in the usable band |
| ----------------------------------------- | ------- | ------------------------------------: |
| Ordinary draft, synthetic 47/34           | 358×480 |                                +70 px |
| Estimated copy (notice closed), 47/34     | 358×480 |                                +15 px |
| Either, waypoint selected                 | 358×480 |                 unchanged (+70 / +15) |
| Ordinary, zero insets, waypoint selected  | 358×480 |                               +151 px |
| Estimated, zero insets, waypoint selected | 358×480 |                                +96 px |

- **The same in English and German.**
- **375×667, German, an estimated copy, synthetic 20/0:** a 343×380 map, with Calculate **1 px short** of the band. The editing row is reachable by scrolling.
- **320×568, German, ordinary text:** item 114's switch is inactive, the map is 288×340 (the reference is 288×280), and the imagery message clears the crosshair.
- **Copy panel open (estimated, 390×844):** Calculate, the editing row, the waypoint list, the routing options and Save are each reachable inside the band.
- **Every map and reference height checked was a multiple of 20.**

**The rider's stopping check, the multi-section recalculation.** The setup:

- a routed three-waypoint draft;
- its middle waypoint moved, so two legs recalculate automatically;
- the provider's answer held, so the label read "Calculating 2 route sections…" / "2 Routenabschnitte werden berechnet…".

Each combination was measured before, with the stale note shown, during, and after.

- **390×844, English and German, both engines:** the editing row stayed at 748 px throughout, and Calculate stayed 44 px tall. **The stopping condition did not apply.**
- **375×667 and 320×568, German only:**
  - **the shift:** the label wraps to two lines, so Calculate grows from 44 to 60 px and the editing row moves down **16 px** while the calculation runs, then returns;
  - **the risk:** Undo, Return to start, Reverse route and Deselect waypoint stay enabled meanwhile, so a tap in that window could miss;
  - **its status:** **a limitation for device review on smaller phones, not accepted.**
- **English** does not wrap at any of the three sizes.
- **Two quick Undo taps,** after two placed waypoints, each recalculated, in all six combinations and both engines:
  - both history changes were applied, and the stored draft returned to its earlier three waypoints;
  - the second tap landed on Undo;
  - the editing row did not move when the stale note appeared or when it cleared.

**Item 114's switch,** at 375×667 (German, height-governed) and 390×844 (English, width-governed). Root sizes were derived from the reference's smaller side, approached from both directions, then 200% and back.

- **The points:** at side ÷ 16.9 the layout is enlarged, at side ÷ 17.3 it is ordinary, and at side ÷ 17.1 it keeps the state it came from.
  - **At 375×667** it engages at 17.751 px (≈111%). The live-map guard would not have engaged until ≈126%.
  - **At 390×844** it engages at 21.183 px.
- **The flips:** exactly one class change per crossing, and none otherwise.
- **The heights:** the map is 380/300 px (375×667) or 480/380 px (390×844); the reference never changes.

**A feedback path found and fixed: classic desktop scrollbars.** The reference takes the map's width, which a classic (non-overlay) scrollbar narrows by about 15 px — more than the 0.25 rem hysteresis. Engaging now shortens the map, which can make the page stop scrolling.

- **Measured** in Chromium with its scrollbars shown, at 400 px wide with a 21 px root (353 px engages, 368 px releases), sweeping the window height: the layout flipped **continuously** at 2003–2023 px, with 21–25 class changes in 800 ms.
- **Rejected:** `scrollbar-gutter: stable` on the page. Headless Chromium reserves the gutter even with its scrollbars hidden, and that narrowed every desktop Chromium test layout by 15 px (288 → 273 px at 320 wide), failing 12 tests.
- **The contained fix:** `useEnlargedTextLayout` adds back `innerWidth − clientWidth`, the width a classic scrollbar takes, so the width input is the same with or without one. Overlay scrollbars, as on the iPhone and in the test containers, take none, so nothing changes there; jsdom reports no client width.
- **After the fix:** the same sweep settles at every height with no class changes, `e2e/planningEnlargedTextScrollbar.spec.ts`.
- **A consequence, stated plainly:** on a desktop browser with classic scrollbars, the switch now reads the width as if no scrollbar were shown. While the page scrolls, it engages about 15 px of width later than `0.4.63` did. That is the basis on which item 114's thresholds were measured, in scrollbar-less containers.

### Evidence — automated only

- **Unit tests,** 239 of 239, all passing:
  - `PlanningScreen.test.tsx`, `.clearDraft`, `.reverseRoute`, `.savedRoute` and `enlargedTextLayout.test.ts`;
  - **new: the panel order,** including where the routing error and stale note sit;
  - **new: the guard's wiring.** A reference stubbed at 343×300 and the container at 343×380, with a 17.8 px root, engage the enlarged layout; reading the container would not.
- **Browser tests,** in the pinned container by digest, against the fresh build:
  - **the new `planningMapArea.smoke.spec.ts`,** 15 cases in Chromium and WebKit;
  - **the new `planningEnlargedTextScrollbar.spec.ts`,** Chromium only;
  - **the affected set,** 19 spec files in their own projects: **298 passed, 4 skipped by design**.
- **Premise tests updated deliberately,** each with its reason:
  - the keyboard proxy now asserts the reference at its 280 px floor and the ordinary map at 340 px;
  - the imagery spec derives its switch points from the reference, adds the 320×568 floor case, and compares the enlarged map with the reference;
  - the two tall-window tests gained 100 px of viewport for the map's taller ceiling (1900 → 2000, 1800 → 1900);
  - two stale comments were corrected.
- **Static:** lint, typecheck and the production build pass.
- **Not run locally:** the full unit and browser suites, which CI runs. Planning specs outside the affected set rely on the design stage's C1 run (the same 56dvh rule) and CI.

### Limitations, stated plainly

- **Not an iPhone measurement.** The insets are assumed and the container's fonts are not iOS's, so Calculate's visibility on the rider's installed phone is not established. On smaller phones, reaching Calculate may need a scroll.
- **The German multi-section shift.** On 375- and 320-wide phones, German's label wraps during a multi-section recalculation, and the editing row moves 16 px while it runs. That is not accepted, and is listed for device review.
- **Gestures:** no fault observed, which is not proof. The pan, rotate and pitch drags complete at 480 and 340 px, but there is no positive control, because e2e cannot reach the MapLibre instance; the design stage's limitation stands.
- **Desktop classic scrollbars:** the switch's width basis changed on such browsers, as above.
- **Not established:** VoiceOver, iOS Larger Text (browser text scaling only) and physical Android.

### CI and deployment

**The first push, `e1e70cf`: run 37331241189.** Verify and build, and End-to-end shards 1, 2 and 4 passed. **Shard 3 failed** on two Chromium tests in `e2e/routeFeatureColouring.spec.ts`, so Deploy was skipped and the live site stayed `0.4.63`; the shard's other 283 tests passed.

- **The setup:** both tests tapped the map at a fixed `{x: 950, y: 150}` after Calculate route had fitted the camera to the mocked route, a horizontal line.
- **The cause:** item 122 makes the map 400 px tall at the default 1280×720 viewport, where it was 320 px, so the fitted line moved from y≈160 to y≈200. Reproduced in the CI image, the painted line ran at map-relative rows 195–204 in the tapped column.
- **The effect:** the old tap was 10 px from the line before, inside the map's ±14 px tap tolerance (`MAP_FEATURE_TAP_HIT_TOLERANCE_PX`). It now landed about 50 px above the line, where a mouse click placed a third waypoint instead of selecting the climb or the warning. The failure screenshots show the new marker at the tap point, and the recalculation of the now-stale route failing against the fixed mock.
- **The application's selection path was not at fault.**
- **The test-only correction,** in the following commit:
  - it asserts the camera is centred on the route's latitude, then taps the map's vertical centre with the same real click;
  - the climb-details, warning-priority and clearing assertions are unchanged;
  - no version change.

**The corrected head, `0c69101`: run [37334772213](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/37334772213).** Verify and build, all four End-to-end shards and Deploy succeeded.

- Verify and build took 309 s.
- The shards took 674, 856, 524 and 745 s (shards 1 to 4). The longest was 344 s under the 1,200 s limit.
- Deploy took 16 s.

The live site then served `0.4.64` with build `0c69101`.

### Installed-iPhone acceptance (reported 5 October 2026)

**Accepted** on the installed iPhone, in English and German: Session 5's six visual and functional checks, at product level.

- **The build** was deployed `0.4.64` (`0c69101`). That is the deployed context: no version, build, phone model, iOS version or viewport was reported from the device, and no measurement was made on it.
- **The verbatim report,** and what it does not establish, is in [`current-status.md`](../current-status.md#installed-iphone-acceptance-of-0464-build-0c69101-item-122-reported-5-october-2026).
- **The German multi-section shift is neither resolved nor accepted.** On 375- and 320-wide layouts German's multi-section Calculate label wraps and the enabled editing buttons move down 16 px while such a recalculation runs; the report does not cover it, and it stays a recorded limitation.
- **VoiceOver and physical Android** were not checked and stay untested.
- **Item 135's focus limitations** are separate and unchanged.

Item 140 follows, under the execution order the rider revised the same day.
