# Item 145 — Regular and Larger text modes: support range, Larger size, tests and Settings

**Status (13 October 2026): documentation only. The rider set this direction on 13 October 2026, within [item 145](../../project/backlog.md#item-145). The proposal awaits the rider's review, and nothing is implemented.** P1 and P3 from the [device findings](device-zoom-findings.md) stay paused. The queue stays 145 → 142 → 103 → 120. **CI of this proposal's commit:** run 38389244757 on `1ea3008` failed in Verify and build, on a routing test's timestamp collision unrelated to this proposal, and Deploy was skipped. The test-only repair is recorded in [`current-status.md`](../../project/current-status.md). **Update, 14 October 2026:** the rider approved only the active Profile selector's 4 px padding from this proposal, and it shipped in `0.4.70` and was accepted on the installed iPhone the same day ([record](../../project/backlog.md#item-145-selector-slice)). The refused Screen on containment and the nine decisions below stay open; a different design for the refused state is proposed in [refused Screen on](refused-screen-on.md). Four evidence statements were corrected the same day, with no decision changed: the rider's visibility marks, the unmeasured 360×667 corner, the WebKit cost projection and the selector's label positions at 390×844. The marks' geometry was then corrected again, because it had assumed pitch 0.

**The direction, as given:**

- ACN stays responsive across phone sizes. The iPhone 13 is a reference, not the authority.
- **Two app-controlled text modes:**
  - **Regular**, today's presentation;
  - **Larger**, a deliberately designed layout at a chosen enlargement.
- **Ordinary riding is preserved:** as little horizontal and vertical scrolling as possible, the Map/Profile switcher on screen, the ascent visible, and Screen on one tap away.
- **The commitment.** Both modes are supported at the browser's default text size and 100% page zoom, across a documented range of portrait viewports.
  - Further browser text enlargement and page zoom stay available. Their combinations with a mode are not automatically layout requirements.
  - Pinch zoom stays available, and so do the map's own gestures.
- **P1's second selector row** is an undesirable trade-off, and is not to be built for an enlarged-text check.
- **Still unapproved:** E2, E2+N, a hidden ascent, extra Screen on taps and compound-failure exceptions.

**The baseline.**

- `main` was `a04031b`, identical to `origin/main`, with a clean tree.
- Its application is identical to `4164bcc`, the build the 12 October device checks used, and to `677a03e`, the broad phone-accepted build.
- No application, test, CI or version changed.

## Summary

1. **A proposed range, provisional:** portrait CSS viewports from 320 to 440 px wide and from 568 to 956 px tall. It is measured at seven reference sizes, including both corners.
   - 360–440 px wide with at least 667 px of height covers ordinary phones.
   - 320 px wide is where Display Zoom's symptoms reproduce, so it is in scope, not dismissed as zoom.
   - Neither Display Zoom's real viewport nor page zoom's insets was measured.
2. **Regular already falls short in parts of that range**, on today's build at ordinary text:
   - the refused Screen on retry is cut off at every width in German, and up to 375 px in English;
   - the Profile selector overflows at 320 px in German;
   - at 320×568, a failed End loses the rider at an imminent turn, to a degree not quantified;
   - in a location error, the rider is lost at 320×693, and in German at 375×667 after a failed End, to a degree not quantified; at 320×568 the German map and switcher are lost;
   - with a long ride's remaining line, the Screen on toggle would drop below the text in English at 320 px (predicted).
3. **The selector can be fixed without a second row.**
   - 4 px of inline padding lets German keep the equal quarters at 320 px, with about 1.7 px to spare in the CI image's fonts. That spare is too small to predict iOS.
   - Larger keeps the selector's labels at their Regular size.
   - No button moves or resizes. At 390×844 two German labels re-centre, `Gesamt` by 2.4 px and `Anstieg` by 1.0 px; English is unchanged.
4. **The recommended Larger size is 125%:** a 20 px root from the default 16 px.
   - It enlarges text app-wide, but **holds two riding roles at their Regular size**: the Screen on toggle and the Profile selector's labels.
   - From 360 px wide and 667 px tall, it keeps the rider, the four map controls, the attribution and the switcher in every plain and failed-End state measured, with no horizontal scrolling. 360×667 itself is a proposed boundary, not a measured size: 360×780 and 375×667 were measured, and neither verifies that combined lower corner.
   - It costs 30–70 px of map against Regular.
5. **125% does not meet the requirements at 320 px wide.** At 320×693 a failed End at an imminent turn loses the rider, to a degree not quantified, and at 320×568 the rider's disc is clipped to 1 px of its 20 before any failure.
   - **112.5%**, the second candidate, keeps the rider in those states down to 320×693, but is a modest enlargement. Beyond Regular's own conflicts, it adds a few in failure states and at 320×568.
   - Which to choose, and whether Larger's commitment starts at 360 px, is the rider's decision.
6. **Some failure states conflict in both modes**, within the range: a location error and a refused Screen on, with or without a failed End. So would a long ride's remaining line at the narrowest widths (predicted).
   - Containing the refused retry costs 24–26 px.
   - Each conflict is listed for a decision. None is called a rare exception.
7. **The root rule should be relative:** `font-size: 125%` on the root while Larger is chosen.
   - At the default 16 px it gives exactly what a 20 px rule gives.
   - Unlike a px rule, it keeps a browser's default-font-size preference working.
   - Neither rule stops text-only zoom, minimum-font settings or page zoom.
8. **The tests** keep their behaviour, focus, persistence and recovery protections. The 200% layout guarantees are replaced by Larger at the range's edges, the 200% versions become non-blocking diagnostics, and a focused commitment matrix is added. The expected WebKit cost is about +130 s of summed test time.
9. **A Text size card in Settings' Preferences**, with revised English and German explanations. There is no riding-screen notice.

## Contents

- [The proposed support range](#the-proposed-support-range)
- [Method](#method)
- [Regular across the range, today](#regular-across-the-range-today)
- [The Profile selector: padding first](#the-profile-selector-padding-first)
- [Larger: the candidates](#larger-the-candidates)
- [What enlarges](#what-enlarges)
- [Failure states in both modes](#failure-states-in-both-modes)
- [A long remaining line](#a-long-remaining-line)
- [The non-riding screens](#the-non-riding-screens)
- [The root rule: relative or px](#the-root-rule-relative-or-px)
- [Exactly what changes in Regular](#exactly-what-changes-in-regular)
- [Proposed test scope](#proposed-test-scope)
- [Settings: presentation and explanation](#settings-presentation-and-explanation)
- [The findings, kept separate](#the-findings-kept-separate)
- [Recommended next slice](#recommended-next-slice)
- [Decisions for the rider](#decisions-for-the-rider)
- [Limitations](#limitations)
- [Reproducing](#reproducing)

## The proposed support range

**Portrait CSS layout viewports from 320 to 440 px wide and from 568 to 956 px tall, at 100% page zoom and the browser's default text size, in both modes.** This is provisional: the decisions below can narrow it for Larger, or for the shortest heights.

| Reference size | Insets, top / bottom | What it stands for                                                                                                                     |
| -------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 440×956        | 59 / 34 (assumed)    | The largest current iPhones; the range's upper corner                                                                                  |
| 412×839        | 0 / 0 (assumed)      | The `android-chrome` project's Pixel 7                                                                                                 |
| 390×844        | 47 / 34              | The iPhone 13 reference                                                                                                                |
| 375×667        | 20 / 0 (assumed)     | A 4.7-inch, SE-class iPhone: an ordinary smaller phone                                                                                 |
| 360×780        | 0 / 0 (assumed)      | A small Android phone: an ordinary smaller phone                                                                                       |
| 320×693        | 47 / 34              | **Hypothetical:** Display Zoom on a 390-px-class iPhone. Only D3's reproduction of the device symptoms at 320 px points here           |
| 320×568        | 20 / 0 (assumed)     | The range's lower corner. Item 128's informative case; **hypothetically**, Display Zoom on an SE-class iPhone. Probe measurements only |

**Why 320 px wide is included:**

- it is WCAG's reflow width;
- the project already tests at 320 px (items 121, 122 and 128);
- the device's Display Zoom symptoms reproduce in the CI image at 320 px, and not at 340 or 375 px ([D3](device-zoom-findings.md#d3--the-profile-range-selector)).

**Display Zoom is a smaller viewport, not browser zoom.** It is a system setting the rider actually uses. Wherever its real viewport lies inside the range, it is inside the commitment. Its viewport was not measured, and neither were page zoom's insets. 375×812 and 260×563 remain the labelled hypotheses of the device findings.

**Evidence coverage.**

- The probes measured all seven sizes, so the stated range's corners are covered.
- Nothing was measured between them in this slice. In particular, no width between 320 and 360 px was measured, except D3's 340×736 at Regular.
- **320×568 has probe evidence only.** The existing informative tests at that size cover Planning, not riding.

**Outside the commitment (measured and reported, never gating):**

- the 260×563 page-zoom proxy;
- the tests' 200% root text;
- either mode combined with further browser text enlargement or page zoom;
- landscape, whose retained checks stay as item 146 decided.

## Method

**Builds, outside the repository:**

- **Today's build:** the `cdc0529` build already used for item 145, application-identical to `a04031b`.
- **Prototype T, from `a04031b`** (its diff is kept with the evidence; see [Reproducing](#reproducing)):
  - the Larger root rule, `:root[data-text-size="larger"] { --text-scale: 1.25; font-size: calc(var(--text-scale) * 100%) }`;
  - 4 px inline padding on the active Profile selector's buttons, with their labels held at Regular size in Larger;
  - the Screen on toggle held at Regular size in Larger;
  - P3's `max-width: 100%` on the Screen on control.
- **Its twin `Tpx`,** which differs only in using px roots (16 and 20 px).

**The probes, outside the repository:**

- Item 145's probe, in the CI image by digest, at two workers.
- 125% and 112.5% were applied as the inline root size the tests use, with the mode's attribute and scale set on the prototype.
- Separately, a check confirmed that the prototype's own rule gives the same root.
- **Measured:**
  - the visible map, with the rider, the four map controls and the attribution;
  - the switcher;
  - the status card and its toggle;
  - the manoeuvre card;
  - every status and header control, whole on screen and tappable;
  - the document's scrolling;
  - each font role's computed size;
  - the Profile selector's labels against their buttons, and the pane's scrolling.

**The states:**

- an imminent turn on a trusted Planning route;
- an imported GPX in its first ten seconds, with its notice's full sentence;
- free roam;
- a refused Screen on request;
- a location error.

Every run then failed an End and measured again. So "after" is the failed-End state, and after a location error or refused request it is the compound state.

**Conditions:**

- English and German;
- Chromium for the matrix, with WebKit spot checks at 390×844 and 320×693.

**The rider's disc against the visible map** (corrected 14 October 2026). The probe asks whether the rider's disc is wholly inside the visible map.

- **The geometry,** all in viewport px:
  - the disc is the position layer's 8 px circle plus its 2 px stroke. **Corrected:** this first said pitch 0 and a 10 px radius, but the follow camera is tilted 35°. The [refused Screen on](refused-screen-on.md) probe of 14 October 2026 measured the painted disc at 9.4–11.25 px in radius at the follow anchor. Every ✗ and ◐ below holds across that range except Regular's 151 px at 320×568, now marked ?;
  - its centre is the app's own projection of the position at the last camera settle;
  - the visible map is the content area's clipped box.
- **Where the disc is not wholly inside,** the tables mark what the saved records establish:
  - **✗** wholly outside the visible map;
  - **◐** partly clipped at its lower edge;
  - **?** not quantified: the recorded centre predates the map's last resize, so the probe's verdict rests on an earlier position, or the measured radius range leaves the verdict open.

  A 0 px map shows nothing, the rider included. These marks concern the map's edges only: in short maps the attribution can also cover the rider, as the refused Screen on probe found.

- **In the prose,** "hides" means ✗, "clips" ◐, and "loses" any case the probe marked.
- **Map height alone does not decide which.** Established hiding was measured at 3–128 px of map, and established clipping at 131–149 px.
- **The marks read the saved records,** with the disc's radius taken from the 14 October measurement; see [Reproducing](#reproducing).

**WebKit agreed exactly.** At 390×844 and 320×693, in both languages, at 100% and 125% on prototype T, WebKit matched Chromium in every one of the 64 compared states: the map height, the rider, the switcher and the card. The selector's geometry was identical too.

**These are the CI image's fonts, not iOS fonts.** Item 113 showed they do not predict iOS widths.

## Regular across the range, today

**Today's build at ordinary text.** The figures are German map heights in px, before → after a failed End. English is in brackets where shown, and always where its outcome differs. ✗, ◐ and ? are as defined in [Method](#method).

| Size    | Imminent turn     | GPX, first ten seconds | Free roam | Location error                  | Refused Screen on: retry on screen |
| ------- | ----------------- | ---------------------- | --------- | ------------------------------- | ---------------------------------- |
| 320×568 | 168 → 116? (137?) | 203 → 151?             | 382 → 330 | **0, switcher off** (73✗ → 21✗) | 28% (51%); map 53✗ → 1?            |
| 320×693 | 232 → 180         | 267 → 215              | 480 → 428 | 53? → 1? (137? → 85?)           | 28% (51%); map 117✗ → 65?          |
| 360×780 | 400 → 348         | 435 → 383              | 614 → 562 | 305 → 253                       | 45% (83%)                          |
| 375×667 | 288 → 236         | 302 → 250              | 481 → 429 | 172 → 120? (193 → 159)          | 51% (95%); map 173 → 121?          |
| 390×844 | 404 → 352         | 418 → 366              | 631 → 579 | 288 → 236                       | 58% (whole)                        |
| 412×839 | 480 → 428         | 494 → 442              | 673 → 621 | 364 → 312                       | 67% (whole)                        |
| 440×956 | 504 → 452         | 537 → 485              | 731 → 679 | 388 → 336                       | 79% (whole)                        |

In a location error the Follow and North-up controls are hidden by design.

**The selector, in German at 320 px:** `Gesamt` 5 px beyond its button, and the pane scrolls 2 px sideways. English fits.

**The switcher** stayed on screen in every state except the German location error at 320×568.

**What this shows:**

- **At 360×780 and from 390 px wide,** Regular meets the requirements in every state apart from the refused retry.
- **The shorter and narrower sizes have pre-existing ordinary-text conflicts.** These are in-range defects, not zoom effects.

## The Profile selector: padding first

**The calculation.** At 320 px the active pane is 288 px wide, so each equal quarter is 66 px.

- German `Gesamt` is 54.3 px wide in the CI image's fonts. With its 2 px of borders it fits a 66 px quarter with up to 4.85 px of padding a side, so 4 px suffices.
- The global 16 px padding is what overflows today. P1's 8 px would also overflow.

**Prototype T: 4 px inline padding, nothing else.** The equal quarters, the empty fourth track and item 80's geometry with and without Climb are all kept.

| Width  | German: spare to the inner border | English | Horizontal scroll | Button height |
| ------ | --------------------------------- | ------- | ----------------- | ------------- |
| 320 px | 4.8 px (about 1.7 px of slack)    | 9.5 px  | None              | 44 px         |
| 360 px | 9.8 px                            | 14.5 px | None              | 44 px         |
| 390 px | 13.6 px                           | 18.2 px | None              | 44 px         |
| 440 px | 19.8 px                           | 24.5 px | None              | 44 px         |

**What changes and what does not:**

- Button boxes are identical to today's at every width. **Corrected 14 October 2026:** the labels are not all centred today. A label wider than the room 16 px of padding leaves is start-aligned, so with 4 px it moves to the centre: at 390×844 German `Gesamt` by 2.4 px and `Anstieg` by 1.0 px, while English does not move. This was measured with the implementation ([record](../../project/backlog.md#item-145-selector-slice)).
- The selected ring and the −2 px focus outline sit on the border box, which does not change.
- **The slack at 320 px is small.** If iOS's German `Gesamt` is more than about 1.7 px wider than the container's, it spills again by that much. The device check is the test.

**In Larger the labels cannot enlarge at 320 px in one row.** At 125%, `Gesamt` is 67.9 px, wider than the quarter's 64 px interior even with no padding. With 4 px padding, equal quarters hold enlarged labels only from about 368 px wide. So prototype T holds the selector's labels at their Regular 16 px in Larger.

**The alternative**, labels that enlarge where they fit:

- needs a width threshold or content-sized tracks;
- and content-sized tracks would move `2 km` and `10 km` when Climb appears, which item 80 forbids.

It was not prototyped.

**The Profile pane's vertical scrolling.** The default view still fits without scrolling everywhere, except at 320×568 in English at 125% (39 px). The climb view already scrolls at every size today.

## Larger: the candidates

**Uniform 125% on today's build (Phase A)**, with nothing held:

- From 360 px wide, the plain states were fine.
- In English at 320 px, the Screen on toggle dropped below the status text: the card was 165 px, against German's 95. At 320×693 that hid the rider before any failure.
- The selector overflowed at 320–390 px in German and at 320 px in English.
- The refused retry was further off screen.

**So prototype T holds the toggle and the selector's labels at Regular size.** 125% was measured first. Because it conflicted at the narrow end, the second candidate was 112.5%, not 150%.

**Prototype T, imminent turn.** German map heights in px, before → after a failed End. English is in brackets where shown, and always where its outcome differs:

| Size    | Regular    | Larger 112.5% | Larger 125%             |
| ------- | ---------- | ------------- | ----------------------- |
| 320×568 | 168 → 116? | 149◐ → 91?    | 131◐ → 46? (131◐ → 69?) |
| 320×693 | 232 → 180  | 213 → 155     | 195 → 110? (195 → 133?) |
| 360×780 | 400 → 348  | 381 → 323     | 363 → 301               |
| 375×667 | 288 → 236  | 248 → 190     | 230 → 168               |
| 390×844 | 404 → 352  | 364 → 306     | 346 → 284               |
| 412×839 | 480 → 428  | 464 → 406     | 422 → 360               |
| 440×956 | 504 → 452  | 488 → 430     | 473 → 411               |

**The GPX notice's first ten seconds**, before → after a failed End:

| Size    | Regular    | Larger 112.5%           | Larger 125%             |
| ------- | ---------- | ----------------------- | ----------------------- |
| 320×568 | 203 → 151? | 163 → 105? (185 → 127?) | 148◐ → 63? (172 → 110?) |
| 320×693 | 267 → 215  | 227 → 169               | 212 → 127✗ (236 → 174)  |
| 375×667 | 302 → 250  | 284 → 226               | 247 → 185               |

At 360×780 and from 390 px wide, every case is above 300 px.

**Free roam:** at least 296 px everywhere in both modes.

**In every plain and failed-End case above:**

- the switcher stayed on screen;
- the status card kept its toggle beside the text (card 89 px at 112.5%, 95 px at 125%);
- nothing scrolled sideways.

Wherever the rider was shown, the four map controls were whole, and so was the attribution, except at 320×568 in Regular's GPX case after a failed End, where 95% of it showed.

**Reading the two candidates:**

- **125%,** from 360 px wide and 667 px tall: every plain and failed-End state measured keeps the rider, the four map controls and the switcher. That lower corner, 360×667, is proposed, not measured: 360×780 and 375×667 do not verify it together. At 320 px wide it loses the rider after a failed End (320×693, to a degree not quantified), and clips it before any failure (320×568, 1 px of 20 showing).
- **112.5%** keeps the rider in those states down to 320×693. At 320×568, its imminent turn is at the edge: 149 px, which clips 1 px off the rider's disc.
  - **Beyond Regular's own conflicts, it adds** ([below](#failure-states-in-both-modes)):
    - at 320×568, the imminent turn before any failure, the GPX notice after a failed End, and the English switcher in the location-error and refused states;
    - at 320×693, the German switcher partly off screen after a failed End in a location error;
    - at 375×667, the location error before any failed End, in both languages.
- **The enlargement:**
  - 125% raises the status text from 13.6 to 17 px, the instruction from 16 to 20 px and the imminent distance from 28 to 35 px;
  - 112.5% raises them to 15.3, 18 and 31.5 px;
  - at 390 px, 112.5% leaves the header title unchanged, since its `5.5vw` term still wins.

**The recommendation is 125%,** for a Larger mode that is clearly larger. **Its commitment would then start at 360 px wide,** which is the smallest remaining trade-off. In Display Zoom's 320 px band, Regular stays committed, while Larger loses the rider after a failed End and is reported, not promised. That is stated here as a decision, not assumed.

**If Larger must cover 320 px as well,** 112.5% is the size that comes closest to Regular's own conflicts, with the additions above.

## What enlarges

**App-wide:** every rem-based size scales, so Routes, Planning, Settings and Status enlarge with Riding. Spacing, the 44 px floor and the 48 px map controls stay in px.

| Role                                        | Regular      | Larger 112.5%    | Larger 125%   | Note                                                    |
| ------------------------------------------- | ------------ | ---------------- | ------------- | ------------------------------------------------------- |
| Body text, buttons, switcher labels         | 16           | 18               | 20            |                                                         |
| Status label, remaining distance and ascent | 13.6         | 15.3             | 17            |                                                         |
| Turn instruction                            | 16           | 18               | 20            |                                                         |
| Turn distance: normal / near / imminent     | 16 / 20 / 28 | 18 / 22.5 / 31.5 | 20 / 25 / 35  | Not capped                                              |
| Header title, at 390 / 320 px               | 21.45 / 17.6 | 21.45 / 19.8     | 22 / 22       | `clamp(1.1rem, 5.5vw, 1.6rem)`                          |
| Map attribution                             | 11.2         | 12.6             | 14            |                                                         |
| Navigation labels                           | 11.2         | 12.6             | 14            |                                                         |
| **Screen on toggle** (label / state)        | 13.6 / 12    | **13.6 / 12**    | **13.6 / 12** | **Held at Regular**, so it stays beside the status text |
| **Profile selector labels**                 | 16           | **16**           | **16**        | **Held at Regular**, so equal quarters fit at 320 px    |
| The refused Screen on sentence              | 13.6         | 15.3             | 17            | Enlarged: a warning                                     |

All sizes are in px, from the probe's computed styles. The exception is the refused sentence, which follows from its 0.85 rem rule.

**The two held roles are the Larger mode's explicit trade-offs.**

- **The toggle** is a short, bold label inside a 44 px control.
  - Enlarged, it pushed the toggle below the text in English at 320 px, costing 70 px.
  - Held, it stays beside the probe's short line at every width. For a long ride's line, at 125% it holds from 360 px in German and 375 px in English ([below](#a-long-remaining-line)).
- **The selector's labels** cannot enlarge in one row at 320 px.
- **The turn distance is not capped.** It is the most glanceable value, and its line already fits.

## Failure states in both modes

**With prototype T's containment.** The retry is whole on screen in every case.

Map heights in px, German before → after a failed End. English is in brackets where shown, and always where its outcome differs:

| Size    | Location error, Regular     | Location error, 112.5%                       | Location error, 125%       | Refused Screen on, Regular           | Refused, 112.5%           | Refused, 125%                                     |
| ------- | --------------------------- | -------------------------------------------- | -------------------------- | ------------------------------------ | ------------------------- | ------------------------------------------------- |
| 320×568 | 0, switcher off (73✗ → 21✗) | 0, switcher off                              | 0, switcher off            | 27✗ → 0, switcher part off (48✗ → 0) | 5? → 0, switcher part off | 0, switcher off                                   |
| 320×693 | 53? → 1? (137? → 85?)       | 0, switcher part off after the End (49? → 0) | 0, switcher off            | 91✗ → 39? (112✗ → 60?)               | 69✗ → 11?                 | 6✗ → 0, switcher part off after the End (26✗ → 0) |
| 360×780 | 305 → 253                   | 280 → 222                                    | **144? → 82?** (257 → 195) | 259 → 207                            | 237 → 179                 | 217 → 155                                         |
| 375×667 | 172 → 120? (193 → 159)      | 147? → 89?                                   | 97? → 35? (124? → 62?)     | 147◐ → 95✗                           | 104✗ → 46? (128✗ → 70?)   | 84✗ → 22? (111✗ → 49?)                            |
| 390×844 | 288 → 236                   | 263 → 205                                    | 240 → 178                  | 263 → 211                            | 220 → 162                 | 200 → 138◐ (227 → 165)                            |
| 412×839 | 364 → 312                   | 339 → 281                                    | 316 → 254                  | 339 → 287                            | 320 → 262                 | 276 → 214                                         |
| 440×956 | 388 → 336                   | 363 → 305                                    | 340 → 278                  | 363 → 311                            | 344 → 286                 | 327 → 265                                         |

**What these show:**

- **Containment costs 24–26 px in Regular.** It makes the retry whole and tappable everywhere; on today's build, the German retry is 28–79% on screen.
  - Before containment, the refused state already hid the rider at 320 px wide, and lost it after a failed End there and at 375×667, to a degree not quantified.
  - Containment also clips it at 375×667 before any End: 173 → 147 px, with 17 of the disc's 20 px showing.
- **These are not rare exceptions to be waived.** The rider has not approved compound-failure exceptions. Each row with ✗, ◐, ? or a lost switcher inside the commitment is listed under the decisions.
- **No small layout change was found for them.** The larger options recorded in the [device findings](device-zoom-findings.md#the-map-at-150-page-zoom-no-small-change) still apply:
  - the follow anchor and floor taken from the visible region;
  - a height-gated presentation (E2's territory, unapproved);
  - or reporting.

## A long remaining line

The probe's route is short, so its remaining line is short too: German `0,2 km · 0 Hm`. **A long ride's line is wider, and it can push the Screen on toggle below the text, as it does today wherever there is no room beside it.** This was measured from in-place clones of the status lines, with `128,4 km · 2.345 Hm` / `128.4 km · 2,345 m ascent` in place of the probe's line.

**The prediction matches every rendered case.** Across the 72 measured cases, today's build and prototype T at all three sizes, it says exactly where the toggle did and did not drop.

For a long ride's line, the figure in brackets is how far the row is short (wraps) or spare (fits), in px:

| Width             | Regular                            | Larger 112.5%, toggle held | Larger 125%, toggle held | 125%, nothing held (today's build) |
| ----------------- | ---------------------------------- | -------------------------- | ------------------------ | ---------------------------------- |
| 320 px            | German fits; **English wraps** (6) | **English wraps** (27)     | **Both wrap** (5, 48)    | Both wrap (21, 63)                 |
| 360 px            | Fits                               | Fits (English 13 spare)    | **English wraps** (8)    | English wraps (23)                 |
| 375 px            | Fits                               | Fits                       | Fits (English 7 spare)   | English wraps (8)                  |
| 390 px            | Fits                               | Fits                       | Fits                     | Fits (English 7 spare)             |
| 412 px and 440 px | Fits                               | Fits                       | Fits                     | Fits                               |

**Where the toggle drops, the card grows by about 70 px** (measured: 95 → 165 px).

- **Regular at 320 px in English:** a long ride would lose those 70 px. By the imminent-turn figures, that would lose the rider after a failed End at 320×693 (about 110 px).
- **Larger 125% at 360 px in English:** the same drop would still leave about 260 px after a failed End at 360×780.
- **Holding the toggle at Regular size** is what keeps 375 px clear at 125%.

**These are predictions, not rendered layouts.** A long-route fixture would render them in the implementing slice.

## The non-riding screens

Routes (with a long German route name), the Ride launcher, Planning, Settings and Status were measured at 320×568, 375×667 and 390×844, in both languages, at 100%, 112.5% and 125%.

- **No horizontal document overflow anywhere**, and no visible text outside its control. The only measured offenders were the views' visually hidden `h1`s, which are hidden by design.
- **Planning's enlarged layout (item 114) engages at 320×568 and 375×667 in both Larger candidates,** as its onset table predicts (110% at 375×667, 106% at 320 px wide). It stays ordinary at 390×844. Larger therefore uses an automated-only layout on smaller phones.
- **The German `Einstellungen` tab breaks onto a second line at 320 px** in both candidates: the navigation grows 67 → 86–88 px. That is the same label the device found wrapping under Display Zoom; it stays an [input to item 103](device-zoom-findings.md#the-navigation-label).
- **Pages grow longer,** for example Settings in German at 390 px, from 2,071 to 2,395 px at 125%. That is ordinary page scrolling outside riding.

## The root rule: relative or px

**One Chromium preference, measured.** Chromium's default-font-size preference was set with CDP `Page.setFontSizes`, with no inline style. The table gives the root size in px:

| Build and mode                              | Browser default 16 | 24      | 32      |
| ------------------------------------------- | ------------------ | ------- | ------- |
| Today's build                               | 16                 | 24      | 32      |
| T, relative (`125%`): Regular / Larger      | 16 / 20            | 24 / 30 | 32 / 40 |
| Tpx, px (`16px` / `20px`): Regular / Larger | 16 / 20            | 16 / 20 | 16 / 20 |

**What follows:**

- **At the default setting, both rules give exactly today's appearance in Regular,** and the same Larger. So predictability at the commitment's own condition does not need px.
- **A px root bypasses only a browser's default-font-size preference.**
  - It does not prevent text-only zoom (Firefox's "Zoom text only"), minimum-font-size settings or page zoom.
  - It does not prevent pinch zoom or Display Zoom, which act on the viewport.
  - It does not reach Android's or iOS's own text settings in any established way: those were not measured here, and how Android's reach Chrome is unverified.
  - The experiment tested one Chromium preference, not every enlargement mechanism.
- **A relative root keeps that preference working,** on top of either mode. That matches the direction that further browser enlargement stays available, and the proposed Settings copy relies on it.
- **Recommended: the relative rule.** It is `:root[data-text-size="larger"] { font-size: 125% }`, plus a `--text-scale` for the held roles. Regular declares nothing new.
- **If a later decision prefers px,** the twin must match the chosen size: 18 px for 112.5%, 20 px for 125%, 24 px for 150%. The Settings copy would then have to drop its claim that browser enlargement still applies.

## Exactly what changes in Regular

At the default text size and 100% page zoom:

- **The Profile selector's buttons:** 4 px inline padding in the active pane, in place of 16 px.
  - Identical boxes and positions at every width.
  - Labels that today spill now fit, at 320 px in German.
- **The refused Screen on control is kept inside the card.** The retry is whole, for 24–26 px of map while a request is refused. At 375×667 that clips the rider in the refused state before any failed End; after one, the rider is already lost.
- **Nothing else.** Every other state at every size measured identical in map height, card and controls.
- **At 390×844 specifically,** only the refused state changes: 289 → 263 px before a failed End, retry whole.

## Proposed test scope

**No test changes in this slice.** This is the proposal for the implementing slices. The 200% layout tests should not stay blocking, because blocking tests constrain implementation regardless of what the documents call them.

**The current enlarged-text coverage** is about 195 generated cases at 200%, mostly at 390×844, plus about 98 WebKit reruns of smoke specs. Each spec carries its own helpers.

**Measured cost.** In the timing baseline run 37638928929, the cases whose titles name the enlarged condition (a subset) summed:

- 510 s in Chromium, over 135 cases;
- 638 s in WebKit, over 90 cases;
- 1 s in Android.

| Family                                                                                                                                                                                                                                                                                                     | What 200% does there                                                                     | Proposed                                                                                                                                                                                                                                                                                                    | WebKit, summed (baseline → proposed)                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Confirmation and reveal behaviour** (items 95, 118, 124): `clearDraftFailure`, `routeDeleteFailure`, `editCopyConfirmationReveal`, `endRidePausedConfirmationReveal`, `confirmationReveal`, `planningSavedRoute`, `planningWarningMapReveal`, `statusConnectionResultReveal`; Settings' oversize reveals | A lever forcing an oversized or taller-than-band branch: focus, no drift, minimal reveal | **Retain unchanged, blocking.** The behaviour holds at any text size, and 200% is only a way to reach the branch                                                                                                                                                                                            | About 280 s → unchanged                                                           |
| **Behaviour inside enlarged layouts:** the End error's retry (item 139), Planning's retry, location failure and pan (item 114), the notice toggle (item 141), the compact climb action                                                                                                                     | Runs the behaviour inside the enlarged arrangement                                       | **Retain, blocking.** Move the root to Larger where Larger reaches the same arrangement; otherwise keep 200% as the lever                                                                                                                                                                                   | About 40 s → about the same                                                       |
| **Riding layout guarantees** (items 68–115, 139): `ridingMapProfileViews`, `ridingStatusCardRecovery`, `ridingWakeLock`, `ridingSelectedFeatureSummary`, `ridingCamera`'s glyphs, `ridingClimbView`, `mapImageryRecovery`                                                                                  | No overflow, 44 px targets, header and switcher fixed, cue placement                     | **Replace:** the same assertions at Larger, at 360×780 and 390×844, and Regular at 320×693. **The 200% versions become non-blocking diagnostics**                                                                                                                                                           | Chromium-only today → +0                                                          |
| **Planning's enlarged layout** (items 114, 122, 128, 109, 110, 141): the hit grid, collisions, contrast, the North control, the notice's containment                                                                                                                                                       | The only way to engage item 114's layout today                                           | **Replace** the 200% matrix with Larger where it engages (320 px wide and 375×667) and at 390×844, where it must stay ordinary. **Retain** the threshold and switching tests, which use px roots. 200% becomes diagnostic                                                                                   | About 290 s → about 250–290 s                                                     |
| **Navigation and the switcher** (items 112, 113, 121)                                                                                                                                                                                                                                                      | The 200% half of each 100%-plus-200% test                                                | **Adapt:** Larger in place of 200%, at the same six widths; 200% diagnostic                                                                                                                                                                                                                                 | Chromium-only → +0                                                                |
| **Settings, Status and the route library** (items 99–118)                                                                                                                                                                                                                                                  | Containment and 44 px targets                                                            | **Replace** with Larger; 200% diagnostic                                                                                                                                                                                                                                                                    | Chromium-only → +0                                                                |
| **Landscape** (13 tests, including `ridingNextManoeuvre`'s only 200% warning compaction)                                                                                                                                                                                                                   | —                                                                                        | **Retain unchanged**, as item 146 decided                                                                                                                                                                                                                                                                   | Chromium-only → +0                                                                |
| **Android** (`android-chrome`, 46 cases)                                                                                                                                                                                                                                                                   | One 200% confirmation case                                                               | **Retain**                                                                                                                                                                                                                                                                                                  | —                                                                                 |
| **New: the commitment matrix**                                                                                                                                                                                                                                                                             | —                                                                                        | **Add**, in Chromium and WebKit:<ul><li>Regular at 320×693, and at 320×568 if decision 1 commits it;</li><li>Larger at 360×780, 390×844 and 440×956;</li><li>both languages;</li><li>the imminent turn with a failed End, the refused retry, the location error and the selector, about 32 cases.</li></ul> | **About +130 s** (at about 4 s a case, as `endRideFailureHeader` takes in WebKit) |

**Behaviour versus layout.** Every focus, persistence, recovery and lifecycle assertion stays blocking. Only assertions that are guarantees about the enlarged layout move.

**What "diagnostic" means here:**

- the 200% layout cases stay in the repository, tagged, and excluded from the blocking CI run;
- they are run on demand in the pinned container when a change touches those areas;
- **what is given up:** CI's automatic detection of layout regressions at 200% root text. That is the browser default-font-size path beyond the commitment, so someone with a 32 px browser default would no longer be protected by CI;
- if a later approved change makes a 200% expectation fail, that named expectation is retired with its reason, never weakened.

**Departures to name:**

- **Item 146 kept the matrices** because their geometry needs the combinations, "German wrapping, 200 % text, and WebKit's own focus and scroll behaviour" ([item 146](../../project/history/item-146.md#item-146)). This proposal keeps German and WebKit, but replaces 200% with Larger as the gating enlarged condition.
- **`CLAUDE.md`'s item 115 account** calls the automated 200% coverage "the project's enlarged-text evidence". Once the modes ship, that becomes Larger's coverage.
- **`androidMobileLayout.spec.ts`'s comment** says the same, and would need the same revision.

**Expected WebKit cost overall:** about +130 s of summed test time, if the Planning matrix is replaced like for like; trimming it could offset the cost. Its effect on job time depends on which shards the cases fall into, so it needs the actual case allocation and is not projected here (corrected 14 October 2026).

## Settings: presentation and explanation

**Where.** A `Text size` / `Textgröße` card in Settings → Preferences (`Optionen`), directly after Language. It uses the same `aria-pressed` segmented pattern: `Regular` / `Normal` and `Larger` / `Größer`.

**How it applies:**

- app-wide;
- stored in the existing `appPreferences` row, with no schema version change. The language save must then write the whole row;
- applied before first paint by the language bootstrap, through an attribute on `<html>`.

**No riding-screen notice.** The explanation lives in Settings only.

**Review of the working copy:**

> ACN's Regular and Larger text modes are designed for default browser text settings and 100% page zoom. For larger text, use this setting. Additional browser text enlargement or page zoom may affect the layout and reduce the space available for the map.

- **Accurate as written:**
  - it does not imply that browser settings are reset;
  - it does not equate any iOS slider position with a percentage.
- **To improve:**
  - "This setting" is ambiguous when the sentence is read on its own, for example by a screen reader. Name the choice.
  - The first sentence does not say what Larger does: it also rearranges some screens.
  - It is accurate only with the relative root. With a px root, a browser's default-font-size enlargement would no longer apply.
  - Display Zoom is neither browser enlargement nor page zoom, and the copy should not suggest it is unsupported. The draft below does not mention it.
  - **iOS calls Display Zoom's zoomed option "Larger Text"**, and its accessibility text setting "Larger Text" too. An ACN option named `Larger` sits close to both; the explanation keeps them apart by naming the browser.

**Draft, English** (subject to approval):

> **Text size** — Regular | Larger
> Larger makes ACN's text bigger and rearranges some screens to fit. Both sizes are designed for your browser's standard text size and 100% page zoom. Enlarging text or zooming further in your browser's settings can change the layout and leave less room for the map.

**Draft, German** (subject to approval; `100 %` takes item 113's non-breaking space):

> **Textgröße** — Normal | Größer
> „Größer“ zeigt den Text in ACN größer an und ordnet einige Ansichten neu an. Beide Größen sind für die Standardtextgröße des Browsers und 100 % Seitenzoom ausgelegt. Weitere Textvergrößerung oder weiterer Zoom in den Browsereinstellungen können das Layout verändern und weniger Platz für die Karte lassen.

It is to be used only once the modes are implemented and verified.

## The findings, kept separate

These stay recorded findings, independent of the remedies proposed here:

- **The Profile selector overflow** under Display Zoom and page zoom ([D3](device-zoom-findings.md#d3--the-profile-range-selector)).
- **The page-zoom map loss** at the 260×563 proxy ([D4](device-zoom-findings.md#d4--the-route-riding-map-at-the-page-zoom-proxy)). Outside the commitment, but not acceptance.
- **The attribution over the rider** in short maps ([first report](README.md#5-a-pre-existing-conflict-the-attribution-over-the-rider-at-200)).
- **The refused Screen on retry cut off at ordinary text.** It is an in-range Regular defect, independent of enlargement. P3 unchanged is not adopted: in Regular, its containment costs 24–26 px and clips the rider at 375×667. The same rule is evaluated above within the commitment, for decision.
- **The navigation label wrap** stays a proposed input to [item 103](../../project/backlog.md#item-103). Items 113 and 121 are not reopened.

## Recommended next slice

**Update, 14 October 2026:** the rider approved the selector's padding alone. It shipped in `0.4.70` and passed its phone check ([record](../../project/backlog.md#item-145-selector-slice)). The refused retry's containment below stays unapproved, and a different design for the refused state is now proposed in [refused Screen on](refused-screen-on.md). The rest of this section is the 13 October recommendation, unchanged.

**One implementation slice for the selector and the refused retry in Regular**, the two in-range ordinary-text defects:

- the 4 px inline padding in the active Profile pane;
- the refused Screen on control kept inside the card.

It is independent of the text modes, and changes nothing else at ordinary text. **Its evidence:**

- one focused browser test in Chromium and WebKit, in German and English:
  - at 320×693, the labels inside equal quarters with no sideways scroll;
  - item 80's geometry with and without Climb;
  - the refused retry whole and tappable at 390×844 and 360×780;
- a negative control for each;
- a phone check under Display Zoom in German.

**Then, if approved, the modes** as their own slice: the preference, the bootstrap, the Larger rule and the two held roles, and the replaced test families.

That order lets the phone verify the Regular fixes before Larger builds on them. The rider may prefer to combine the two slices.

## Decisions for the rider

1. **The range:** 320–440 × 568–956 px, as proposed, or narrower. In particular, whether 320×568 is committed for Regular, given its pre-existing failed-End and location-error conflicts.
2. **The Larger size:**
   - 125%, with its commitment from 360 px wide, as recommended;
   - or 112.5% across the whole range;
   - or another size.
3. **The two held roles:** the Screen on toggle and the selector's labels at Regular size in Larger.
4. **The in-range conflicts**, in each mode: accept the measured outcome as reported, or ask for a design. No exception is assumed. They are:
   - the location error and the refused Screen on, each with a failed End;
   - the predicted toggle drop for a long ride's line: Regular at 320 px in English, and 125% at 360 px in English.
5. **The refused retry's containment:** adopt it, at 24–26 px of map in that state.
6. **The root rule:** relative, as recommended, or px.
7. **The test scope:** retain, replace and add as tabled, with the 200% layout cases as non-blocking diagnostics, and the named departures from item 146 and `CLAUDE.md`.
8. **The Settings copy:** the English and German drafts, and whether `Larger` / `Größer` should be renamed away from iOS's "Larger Text".
9. **The next slice:** the Regular fixes first, as recommended, or combined with the modes.

## Limitations

- **Container fonts, not iOS fonts.** The selector's 1.7 px of slack at 320 px is the most exposed figure.
- **No native Display Zoom, page zoom or iOS text setting.** The range's sizes are layout viewports at a scale of 1. Several insets are assumed.
- **The long-line wrap is predicted, not rendered.** It is computed from clones measured in place.
- **WebKit was spot-checked only,** at two sizes.
- **Not measured:**
  - sizes between the reference sizes;
  - the climb view's contents;
  - VoiceOver;
  - keyboard focus in WebKit;
  - a physical Android device.
- **No existing test was run against prototype T.** Its geometry was measured against the selectors' existing assertions, as for P1.
- **The CDP experiment covers one Chromium preference.** Firefox's text-only zoom, minimum font sizes and Android's settings were not tested.

## Reproducing

All evidence is outside the repository, in `~/acn-review/item-145/`:

- **Probes:**
  - `probe/probe145e.spec.ts`, with `PROBE_MODE_ATTR` and per-role font sizes added;
  - `probe/screens145.spec.ts`;
  - `probe/rootmode145.spec.ts`.
- **Runner:** `scripts/run_t.sh`.
- **Summaries:** `tsummary.py`, `tcompare.py`, `wrappred.py` and `screens_summary.py`.
- **Builds:** `trees/base`, `trees/candT` (with `candT.diff`) and `trees/candTpx`.
- **Outputs:**
  - `out/40-t-*`, the riding matrix;
  - `out/41-screens-*`, the non-riding screens;
  - `out/42-rootmode-*`, the root rule;
  - `out/43-enlarged-test-timing.txt`, the CI timing estimate.
- **The rider reclassification (14 October 2026),** from the saved records only: `~/acn-review/item-145-selector/rider-class.py` and `rider-cells.py`.
- **Superseded, kept:** two runs whose names record a probe error, `41-screens-base-route-name-error` and `41-screens-base-lang-check-error`, and the first wrap measurement, which measured text alone, as `40-x-superseded-wrap*`.
