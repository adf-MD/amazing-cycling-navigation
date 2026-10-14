# Item 145 — the refused Screen on state: a design proposal

**Status (14 October 2026): the rider approved candidate B for the retry correction, with the wording "Try again" / "Erneut versuchen". It is implemented for `0.4.71` ([record](../../project/backlog.md#item-145-refused-screen-on-slice)), with CI, deployment and the phone check pending. Measured with the probe below, the implemented build is box for box identical to B's prototype in all 92 snapshots. The four cases under [What remains in conflict](#what-remains-in-conflict) stay open: their partial or complete loss of the rider is not accepted.** It is part of [item 145](../../project/backlog.md#item-145). The queue stays 145 → 142 → 103 → 120. The containment measured earlier (P3, in the [text-mode proposal](text-modes-proposal.md#failure-states-in-both-modes)) is not approved and is not proposed here.

**What this rests on.**

- **The refusal was simulated in the browser:** a wake-lock stub rejected the request. No refusal has been seen on the installed iPhone. How often iOS refuses, and how the state clips on a physical iPhone, are not established.
- **The rider's phone check of 14 October 2026 did not exercise this state.**
- **The measurements:**
  - the CI image, by digest, in Chromium and WebKit;
  - at ordinary root text, in English and German;
  - at three reference sizes, 390×844, 375×667 and 320×693, with assumed safe-area insets of 47/34, 20/0 and 47/34 px. These are reference cases, not a support range;
  - route riding on a trusted route 60 m before a left turn, with its manoeuvre card;
  - free roam at 375×667 in German.
- **The builds:** today's `0.4.70` (`5209fe7`) and two prototypes built from it, all outside the repository.

## Today

When Screen on is refused, the card shows "The screen could not be kept awake." / "Das Display konnte nicht an bleiben." and a retry, "Tap to try again" / "Tippe, um es erneut zu versuchen".

- **Why it overflows:** the message and retry sit inside the Screen on control's own column. On one line they make that column wider than the card, so it drops below the status text and runs off the right edge.
- **The cost:** Screen on becomes a full-width bar, and the card grows from 80 to 195 px.
- **How much of the retry is on screen:**

  | Size    | German | English |
  | ------- | ------ | ------- |
  | 390×844 | 58%    | 100%    |
  | 375×667 | 51%    | 95%     |
  | 320×693 | 28%    | 51%     |

- **What the rider can still do:** tapping the visible part works, in both engines. Its label is cut wherever less than all of it shows.

## The constraints

- the retry wholly visible, readable and operable;
- the rider, the applicable map controls, the attribution and the Map/Profile switcher preserved;
- the remaining ascent visible;
- Screen on directly accessible, with no disclosure or extra tap;
- the ordinary, non-refused presentation unchanged;
- the accepted single-row Profile selector unchanged;
- no new scrolling to reach a riding or recovery control;
- not solved by taking more map height.

## Two candidates

Both apply only while the failure row exists, and both leave the DOM, the reading order and the roles unchanged.

**A — a full-width refused row; layout only.**

- The control's wrapper stops being a box (`display: contents`, selected with `:has()`), so Screen on stays beside the status text exactly as in the ordinary state.
- The message and retry take a full-width line of the card, side by side where both fit: item 115's one-row pattern, with the message `flex: 1 1 0; min-width: 14ch`.

```css
.ride-wake-lock-control:has(> .wake-lock-failure-row) {
  display: contents;
}
.ride-wake-lock-control:has(> .wake-lock-failure-row) > .wake-lock-toggle {
  flex: 0 0 auto;
}
.ride-wake-lock-control > .wake-lock-failure-row {
  flex: 1 1 100%;
  margin-top: 0;
}
.wake-lock-failure-row p {
  flex: 1 1 0;
  min-width: 14ch;
}
.wake-lock-failure-row button {
  flex: 0 1 auto;
  max-width: 100%;
}
```

- **English:** "Tap to try again" fits beside the message, so the row is 44 px.
- **German:** the long label goes under the message, so the row takes two lines.

**B — A, with the shorter retry label.**

- The retry reads the existing `ride.tryAgain`, "Try again" / "Erneut versuchen", which the geolocation error row already uses.
- German then fits on one 44 px row as English does, and in English B is identical to A.
- **Its cost is a copy decision.** Implementing it would also update `e2e/androidRiding.spec.ts` and `src/ui/riding/ridingCopyMigration.test.ts`, which name the old label, and retire `wakeLock.retry`.

Free roam takes the same rules.

![375×667, German, route riding. Today, A and B, refused and then refused with a failed End ride. Today the Screen on bar drops below the status text and the retry runs off the card; in both candidates Screen on stays beside the text and the retry is whole, and B's retry fits beside the message.](images/07-refused-screen-on-375x667-german.png)

## Measured

**The values are card height / visible map, in px, with the rider's disc.** Chromium; WebKit gave the same card and map heights in every case, and rider percentages within 2 points.

- **The rider's disc:** "whole" means wholly visible. A percentage is how much of the disc is visible inside the map and not under an overlay. "Hidden" means none of it.
- **Where English differs** from German, it is in brackets. In English, A and B are identical everywhere.

| Size    | State                                    | Today                                 | A                                            | B                                            |
| ------- | ---------------------------------------- | ------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| 390×844 | refused                                  | 195 / 289, whole                      | 158 / 326, whole (132 / 352)                 | 132 / 352, whole                             |
| 390×844 | refused, then a failed End               | 195 / 237, whole (195 / 255)          | 158 / 274, whole (132 / 318)                 | 132 / 300, whole (132 / 318)                 |
| 375×667 | refused                                  | 195 / 173, 80%                        | 158 / 210, whole (132 / 236)                 | 132 / 236, whole                             |
| 375×667 | refused, then a failed End               | 195 / 121, hidden (195 / 139, 29–31%) | 158 / 158, **64%** (132 / 202, whole)        | 132 / 184, **93–95%** (132 / 202, whole)     |
| 320×693 | refused                                  | 195 / 117, hidden (195 / 138, 9–13%)  | 158 / 154, **9–13%** (132 / 201, whole)      | 132 / 180, **70–72%** (132 / 201, whole)     |
| 320×693 | refused, then a failed End               | 195 / 65, hidden (195 / 86, hidden)   | 158 / 102, **hidden** (132 / 149, **9–13%**) | 132 / 128, **hidden** (132 / 149, **9–13%**) |
| 320×693 | for reference: a failed End, not refused | 80 / 180, 70–72% (80 / 201, whole)    | identical to today                           | identical to today                           |

**What the percentages mean:** where the rider is short of whole, the attribution strip over it, the map's lower edge, or both cut it; the conflicts below name which. The disc's radius is measured from its paint: 9.4–11.25 px across both engines, at the camera's 35° tilt. A range shown reflects that radius range.

**In every candidate case, in both engines:**

- the retry is wholly on screen, its label whole, 44 px tall;
- a pointer tap where it shows and an ordinary click both reach it, with no scrolling;
- Screen on stays beside the status text, pressed and 44 px or more, with its accessible name;
- the remaining ascent is whole, the switcher is wholly on screen and operable, and no page overflows;
- the refusal's alert is present, as before;
- in the refused state, Tab moves from Screen on to the retry, the Profile selector keeps one row with no sideways scroll, and the card is unchanged on return to Map;
- after a successful retry, the layout equals the ordinary Screen on state: with or without the failed End, box for box, across 158 comparisons including free roam;
- with Screen on off or on, and with an ordinary failed End, both candidates equal today, box for box.

**Free roam, 375×667 German, refused:**

| Build | Card   | Visible map |
| ----- | ------ | ----------- |
| Today | 173 px | 381 px      |
| A     | 151 px | 403 px      |
| B     | 125 px | 429 px      |

- **Today** shows 51% of the retry, with Screen on below the text.
- **In both candidates** the retry is whole and operable without scrolling, and Screen on stays beside the detail line.
- **The rider is whole in all three builds.**
- **Off, on and recovered are identical to today**, in both engines.
- Free roam has no Map/Profile switcher or ascent line.

## What remains in conflict

Four reference cases keep the rider short of whole even with B, and A adds two more:

| Size, language   | State                      | B                                          | A      | Today  |
| ---------------- | -------------------------- | ------------------------------------------ | ------ | ------ |
| 320×693, German  | refused                    | 70–72%, under the attribution              | 9–13%  | hidden |
| 375×667, German  | refused, then a failed End | 93–95%, under the attribution              | 64%    | hidden |
| 320×693, German  | refused, then a failed End | hidden by the map edge; attribution hidden | hidden | hidden |
| 320×693, English | refused, then a failed End | 9–13%; attribution 84% visible             | 9–13%  | hidden |

**None of these is introduced by a candidate.** Each is better than today, and none worsens any other measured state, but **neither of the two investigated arrangements resolves every case.** The remaining problem has two parts:

- **The attribution covers the rider in short maps, and that is pre-existing.** The ordinary failed End at 320×693 in German already leaves only 70–72% of the rider visible. B's refused state there is exactly that, because its refused row costs the same 52 px as a failed End's German error row.
- **Two failure rows together leave too little map at these sizes.** A refused row needs at least a 44 px retry, so it cannot cost less than about 48 px. From the recorded anchor and attribution boxes, the rider would clear the attribution with about 12–16 px more map at 320×693 German (refused) and 8–12 px more at 375×667 German (refused, then a failed End). With a failed End at 320×693, the map element is already at its 160 px floor, with only 128 px of it visible in German, and the rider falls outside the visible map.

**They need designing together.** Moving the attribution alone cannot recover a rider who is outside the visible map. A subsequent design must consider the rider's position within the visible map, the map's 160 px floor and the overlays' placement together.

The applicable map controls stayed whole in every B case. A's taller German row cuts the lower map controls at 320×693 after a failed End (79% visible). The attribution is clipped in the compound 320×693 cases in all three builds.

## Recommendation

**B was the preferred design**, on these conditions:

- **What it achieves, in every reference case:** the retry is whole, readable and operable, Screen on stays where it is, the ascent and switcher stay in view, and the ordinary and recovered layouts are unchanged.
- **The map:** it gives back 63 px in German's refused state against today (37 px with A), and costs 52 px against the ordinary state: as much as a failed End's error row in German, against 34 px in English.
- **Over A,** it keeps 26 px more map in German, which lifts the rider from 9–13% to 70–72% at 320×693 refused and from 64% to 93–95% at 375×667 after a failed End.

**It does not meet every constraint.** The four cases above still lose part or all of the rider. B was therefore not recommended as a complete solution, and it needed the decision below.

**The decision needed before implementation.** On 14 October 2026 the rider approved B and its wording for the retry correction (point 1), and kept the four cases open (point 2):

1. **The copy:** B's "Try again" / "Erneut versuchen", or A's layout with today's label at 26 px more map in German.
2. **The four remaining cases:** a refused Screen on in German at 320×693, and a refused Screen on together with a failed End at 375×667 German and 320×693 in both languages.
   - **Accept** that the rider can be partly or wholly hidden there, as the ordinary failed End already leaves it 70–72% visible at 320×693 German; or
   - **ask for a separate design** for the attribution over the rider in short maps, an already-recorded item 145 finding.

   No exception is assumed, and neither of the two investigated arrangements resolves them.

## Limitations

- **The refusal is simulated;** its frequency is unknown, and nothing here is device evidence.
- **The CI image's fonts are not iOS fonts.** German's one-row fit in B was measured there only.
- **Desktop Chromium and WebKit, not Safari on iOS.** `display: contents` and `:has()` behave as measured in both engines; VoiceOver on an iPhone was not tested. Accessible names, the alert and Tab order were checked in the browser only.
- **One riding fixture,** a route with an imminent turn, and three sizes. The text-mode proposal's other states were not repeated.
- **The rider's percentages** use the measured radius range and the overlays' boxes. Every one of the 276 snapshots had an established settle, and paint agreed with the geometry in all of them.

## Reproducing

Everything is outside the repository, in `~/acn-review/item-145-retry/`:

- **The probe:** `probe/retry145.spec.ts` and its config, run with `run.sh <name> <build>` in the CI image.
- **The builds:** `trees/base`, `trees/candA` and `trees/candB`, with `candA.diff` and `candB.diff`.
- **Outputs:**
  - `out/10-matrix-*`, the matrix;
  - `out/11-free-*`, the free-roam rerun;
  - `out/table-*.txt` and `out/equivalence.txt`.
- **Scripts:** `scripts/analyse.py`, `table.py`, `equivalence.py` and `compose.py`.
- **The rider method.** The follow camera is tilted 35°, and it ignores fixes that move less than 3 m, so a smaller nudge leaves a stale anchor. Each measurement therefore uses a fresh fix 4 m on, while the turn still reads "60 m" and the remaining line "0.3 km". The painted disc's radius is measured, 9.4–11.25 px, not taken as a fixed 10 px. A settle is proven by `data-camera-center` changing, followed by a stable window. The anchor must sit at the follow point and the canvas match its container in CSS px. Paint is then checked around the anchor.
