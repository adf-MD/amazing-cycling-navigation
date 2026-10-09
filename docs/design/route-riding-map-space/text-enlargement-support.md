# Item 145 — Text enlargement: mechanisms, evidence and a proposed support policy

**Status (9 October 2026): the rider authorised this investigation the same day, within [item 145](../../project/backlog.md#item-145), and it is complete. The recommended support policy and every product change await the rider's review; nothing is implemented.**

E2, E2+N, hiding the remaining ascent and the extra Screen on taps all remain unapproved. The companion reports are [Riding information priorities](information-priorities.md) and [the first report](README.md).

- **The baseline:** `981bc4d`. Its application files are identical to `cdc0529` and to `677a03e`, the build accepted on the installed iPhone. The diagnostics here used the `cdc0529` build already used for item 145.
- **What did not change:** no application, test, CI or version.

**The question.** Before a riding-layout change is chosen, establish three things:

- which text-enlargement mechanisms riders can actually use on ACN's documented environments;
- what the tests' "200% text" represents;
- what presentation ACN should promise.

**Ordinary-text riding on the installed iPhone 13 is the primary reference:** as little interaction and scrolling as possible, and the Map/Profile switcher visible.

## Summary

1. **On the installed iPhone, no text-enlargement mechanism is known to reach ACN's layout.**
   - ACN uses no Dynamic Type text style, and WebKit's documented route for Dynamic Type in web content is `font: -apple-system-body` and its siblings ([WebKit, 2015](https://webkit.org/blog/3709/using-the-system-font-in-web-content/)). So iOS Larger Text is not expected to resize ACN.
   - That is a conclusion from source inspection on 9 September 2026, with one inconclusive device attempt, and it **remains unverified on iOS 26**.
   - Display Zoom, Safari's Page Zoom setting and the per-app Text Size are each documented by Apple. Whether any of them changes ACN in the installed Home Screen app is **undocumented and unverified**.
2. **Visual magnification is available, but changes no layout.** iOS Zoom (the system magnifier) and the visual-viewport scale ("pinch zoom", which a focused text field can also trigger) both enlarge what is shown without changing the layout. On the installed iPhone, a focus zoom has been observed. A deliberate pinch zoom in the installed app is **unverified**.
3. **The tests' 200% root font represents a browser's own text-size preference, and nothing else.** In Chromium, a 32 px default font size, set through the browser's own preference, laid out the riding screen identically to the tests' inline 200% root. It does **not** represent page zoom, which narrows the layout viewport, nor magnification, which changes only the visual scale.
4. **Page zoom is the harsher condition.** A smaller-viewport proxy at ordinary text: 260×563 CSS px (150% zoom) leaves a Planning route 137 px of map before any failure. At 195×422 (200% zoom) it leaves 0 px, and the switcher is off screen. This is a constrained-layout diagnostic only, not native zoom.
5. **WCAG 1.4.4 is about text resizing without loss of content or functionality,** and holds that scaling is "primarily a user agent responsibility" ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)). ACN's requirement that the switcher stays on screen during riding, without scrolling, is a **stronger product requirement**, not a WCAG one. No conformance is claimed.

**Recommendation in brief:**

- keep the ordinary-text, installed-iPhone riding contract as the primary acceptance target, **unchanged and undisclosed**;
- keep 200% root text as an automated acceptance condition for **no loss of content or functionality, and the switcher on screen**;
- treat page-zoom proxies, 250% and compound failure states as diagnostics;
- support visual magnification by never blocking it;
- verify the iPhone mechanisms with one short stationary check before deciding whether Dynamic Type is wanted at all.

The smallest remaining design investigation is a constrained-space presentation that engages **only** when text is enlarged, measured for wrapping regressions. Its decisions are listed [below](#decisions-for-the-rider).

## Contents

- [Sources](#sources)
- [What the implementation does](#what-the-implementation-does)
- [The mechanisms](#the-mechanisms)
- [The Larger Text claim, revisited](#the-larger-text-claim-revisited)
- [What the 200% tests represent](#what-the-200-tests-represent)
- [Recommended support policy](#recommended-support-policy)
- [Carried forward, unresolved](#carried-forward-unresolved)
- [The smallest remaining design investigation](#the-smallest-remaining-design-investigation)
- [Stationary check on the installed iPhone](#stationary-check-on-the-installed-iphone)
- [Decisions for the rider](#decisions-for-the-rider)
- [Limitations](#limitations)
- [Reproducing](#reproducing)

## Sources

Fetched on 9 October 2026. Dated extracts are kept outside the repository (see [Reproducing](#reproducing)).

- **W3C:**
  - [Understanding SC 1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html);
  - [Understanding SC 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
- **CSSWG:** [CSSOM View](https://drafts.csswg.org/cssom-view/), on page zoom and the visual viewport's scale factor.
- **WebKit:** [Using the System Font in Web Content](https://webkit.org/blog/3709/using-the-system-font-in-web-content/) (2015). It documents a Dynamic Type integration method; it does not describe every behaviour of current iOS.
- **Apple iPhone User Guide, iOS 26:**
  - [Make text easier to read](https://support.apple.com/en-gb/guide/iphone/iph3c076905a/26.0/ios/26.0);
  - [Adjust display and text settings](https://support.apple.com/en-gb/guide/iphone/iphd6804774e/26.0/ios/26.0);
  - [Customise Safari settings](https://support.apple.com/en-gb/guide/iphone/iphb3100d149/26.0/ios/26.0);
  - [Zoom in on the iPhone screen](https://support.apple.com/en-gb/guide/iphone/iph3e2e367e/26.0/ios/26.0).
- **Google:**
  - [Chrome for Android zoom](https://support.google.com/chrome/answer/96810?hl=en-GB&co=GENIE.Platform%3DAndroid);
  - [Page Zoom for Chrome on Android](https://support.google.com/accessibility/android/answer/13532420?hl=en-GB);
  - [Android text and display settings](https://support.google.com/accessibility/android/answer/11183305?hl=en).
- **MDN:**
  - [viewport meta](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport);
  - [`text-size-adjust`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-size-adjust).

## What the implementation does

All from source at `981bc4d`.

**The viewport (`index.html`).** `width=device-width, initial-scale=1, viewport-fit=cover`. It sets no `maximum-scale`, `user-scalable` or `interactive-widget`; MDN notes that iOS 10 and later ignore the first two by default anyway. Nothing calls `preventDefault()` on a gesture. MapLibre's own stylesheet gives the map canvas `touch-action: none`, so a pinch on the map zooms the map, not the page.

**The manifest.** `display: standalone`, with no orientation.

**Text:**

- no root `font-size` and no `text-size-adjust`;
- the font family is `system-ui, -apple-system, …`;
- no `font: -apple-system-*` text style anywhere;
- every font size is in rem, except `.screen-title`'s `clamp(1.1rem, 5.5vw, 1.6rem)` and the elevation chart's SVG-unit labels;
- spacing tokens, the 44 px touch-target floor and the 48 px map controls are in px.

So text follows the browser's root font size, while spacing and controls do not.

**Layout responses to text size:**

- item 114's Planning switch, a ratio of map size to root font, documented as also catching page zoom;
- the climb cue's `@container` thresholds, which are in rem.

**No in-app text-size control exists.** Nothing in Settings or the app preferences sets a text size.

## The mechanisms

"Installed" means the iPhone 13 Home Screen app, the primary riding device (iOS 26.6.1, recorded 25 September 2026). Android 10 or later with current Chrome is documented as supported (item 25), with no physical verification. **Desktop has no documented support policy and is left unspecified here.**

| Mechanism                                                                                                 | Who can turn it on, and where                                                                                                                   | What it changes                                                                                                                                                                                                         | Implementation and documentation evidence                                                                                            | Physical and automated evidence                                                                                                                                                                         | Unverified                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **iOS Larger Text and Text Size**, with Larger Accessibility Sizes and Control Center's per-app Text Size | Any iPhone user, system-wide (Settings → Accessibility → Display & Text Size; or Display & Brightness → Text Size); per app from Control Center | Text in "supported apps" (Apple). For web content, WebKit documents the `font: -apple-system-*` text styles as the Dynamic Type route                                                                                   | ACN uses no such style. Apple's guide does not say whether a Home Screen web app is a "supported app"                                | One device attempt (9 September 2026, `0.4.19`) reported only as "I think confirmed". None since: Larger Text was off in the 25 September session. No automated equivalent                              | Whether current iOS 26 WebKit changes ACN's text by any route: Larger Text, the per-app Text Size, or Accessibility Sizes |
| **iOS Display Zoom** ("Larger Text" view)                                                                 | iPhone users on supported models (Display & Brightness → Display Zoom → Use Zoomed)                                                             | Apple: enlarges text "as well as interface elements like icons and buttons". For a web app, a narrower CSS layout viewport is expected but undocumented                                                                 | Apple's guide                                                                                                                        | None. The tests at 375×667 and 320 px widths stand in for narrower viewports in general, not for this mode                                                                                              | Whether it changes ACN's layout viewport, by how much, and whether the riding contract holds                              |
| **Safari's page-menu text size and the Safari Page Zoom setting**                                         | In Safari: the Page Menu at the search field. The iOS 26 guide calls it the "font size"; the newer guide says "Page Zoom".                      | Apple: text size per website                                                                                                                                                                                            | Apple's guide. A Home Screen web app shows no Safari page menu; whether the Safari Page Zoom setting applies to it is not documented | None                                                                                                                                                                                                    | Whether either reaches the installed app, and whether it zooms the page or only the text                                  |
| **Visual-viewport scale** ("pinch zoom"; the focus zoom on a text field)                                  | Any browser. In the installed app: observed as a focus zoom                                                                                     | CSSOM View: a "scale factor which acts like a magnifying glass and does not affect the initial viewport". It is "often referred to as pinch-zoom", but can come from other means, such as zooming in on a focused input | ACN blocks nothing. On the map, a pinch zooms the map instead                                                                        | Installed app, item 121 (29 September 2026): tapping the key field enlarged the page, and "the rider had to zoom out manually". Automated: a two-finger map gesture test records `visualViewport.scale` | A deliberate pinch zoom-in on the installed app's screens                                                                 |
| **iOS Zoom** (the magnifier)                                                                              | Any iPhone user, system-wide (Accessibility → Zoom)                                                                                             | Full-screen or window magnification. No layout change                                                                                                                                                                   | Apple's guide                                                                                                                        | None needed                                                                                                                                                                                             | —                                                                                                                         |
| **Android Font size and Display size**                                                                    | Android users, system-wide (Font size up to 200%)                                                                                               | Native-app text in sp units; display density                                                                                                                                                                            | Google's guide. How Chrome and an installed web app apply them is not covered by the fetched documentation                           | None: no physical Android                                                                                                                                                                               | Whether either changes ACN in Chrome or as an installed app, and how                                                      |
| **Chrome for Android Default zoom, Page Zoom and Force-enable zoom**                                      | In Chrome (Settings → Accessibility; per-site Zoom)                                                                                             | Google: makes "everything on a web page larger or smaller". Page zoom narrows the layout viewport                                                                                                                       | Google's guides                                                                                                                      | Pixel 7 emulation never applies them. Diagnostic D2 is a viewport proxy (below)                                                                                                                         | Whether they apply to an installed web app, and the real result on a device                                               |
| **Desktop page zoom and default font size**                                                               | Desktop browsers (zoom; font-size preference)                                                                                                   | Page zoom: the layout viewport. Font size: the root font                                                                                                                                                                | Chrome's help, Chromium behaviour                                                                                                    | D1: Chromium's default-font preference matches the tests' 200% exactly. D2: viewport proxy                                                                                                              | Any desktop support policy (unspecified)                                                                                  |
| **The tests' scripted root font** (`document.documentElement.style.fontSize = "200%"`)                    | Tests only                                                                                                                                      | The root font size (rem) only: no layout-viewport, scale or device-pixel change                                                                                                                                         | About 100 tests in 40 of 91 spec files                                                                                               | Chromium and WebKit in the CI image                                                                                                                                                                     | —                                                                                                                         |

## The Larger Text claim, revisited

**The claim**, in `current-status.md`'s reading note: "ACN has no Dynamic Type opt-in, so the system setting does not resize this application at all … Do not re-add it as a manual check."

**Its exact basis.** Commit `fa0ad86` (9 September 2026, item 100 stage 4B's field test on `0.4.19`) recorded:

- the rider had raised Larger Text and reported the result only as "I think confirmed", asking whether anything besides the tags had changed size;
- **source inspection** found no Dynamic Type opt-in, so the setting was "**not expected** to resize the app's own text".

An hour later, `1adf130` stated it as certainty, "the iOS Larger Text mechanism does not resize this application at all", and classified it as non-blocking. `3767d6e` (12 September) made it the standing reading note, and removed the source-inspection paragraph that held the original hedge.

**Its tested scope:**

- that single inconclusive attempt, on `0.4.19`;
- nothing since. The 25 September session records Larger Text and Bold Text off on the iPhone 13, iOS 26.6.1;
- nothing automated, since desktop browsers cannot emulate it.

**What it establishes.** Given WebKit's documented integration method, ACN's text is not expected to follow Larger Text.

**What it does not establish:**

- what current iOS 26 actually does with the installed app;
- whether the per-app Text Size, Accessibility Sizes, Display Zoom or Safari's Page Zoom setting reach it;
- **that every enlargement mechanism is unavailable.** Visual magnification plainly is available.

The reading note in `current-status.md` is qualified accordingly by this commit.

## What the 200% tests represent

**D1: the tests' inline root against a browser's own font-size preference** (a paired experiment).

- **Setup:** the same build, fixture and Chromium configuration (390×844), in three modes:
  - no enlargement;
  - the tests' inline `style.fontSize = "200%"`;
  - Chromium's own default-font-size preference set to 32 px, through CDP `Page.setFontSizes`, which sets the browser's standard font size for the page. There is no inline style in that mode.
- **Cases:** route riding (the Planning route) and free roam, in English and German, before and after a failed End.

**Results:**

- **The baseline root was 16 px,** so 32 px is 200%.
- **Every measured layout value was identical between the two enlarged modes:** each column row, the map region, the status card's rows, the header controls, the error's lines, the map controls and the attribution. In German route riding, for example, the map went 230 → 106 px after a failed End in both.
- **The only differences were the rider's position, by up to 7 px,** which is follow-camera timing, not layout.
- **So in Chromium the tests' method lays out the riding screen exactly as a user's 32 px default font would.**
- **Two qualifications:**
  - rem-based media queries would differ between the two, and ACN has none;
  - how Android's user-facing text settings reach Chrome is unverified, so this result is not a claim about Android.

**D2: a smaller layout viewport** as a constrained-layout proxy for page zoom.

- **Setup:** at ordinary text, CSS viewports of 260×563 (390×844 at 150%) and 195×422 (at 200%), Chromium. The layout viewport and visual viewport were equal, at scale 1. No synthetic safe-area insets were applied (all four read 0 px); the installed iPhone's real insets would leave less room.
- **What it does not reproduce:** the device pixel ratio, real browser zoom behaviour, or a visual zoom.

| Case, after a failed End unless stated | 260×563                                                                               | 195×422                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Planning route, before any failure     | map 137 px; rider not fully in view; 55% of the attribution; switcher on screen       | **map 0 px; switcher off screen**                                |
| Planning route                         | map 67 (German) / 85 (English); Zoom out and Follow partly hidden; switcher on screen | map 0; switcher off screen; the error's lines not wholly visible |
| Free roam                              | map 279 (German) / 297 (English); rider and controls in view                          | map 120 / 138; rider not in view; the error not wholly visible   |

Pause and End ride stayed 44 px and tappable throughout. At 195 px wide, the title is 16 px.

**These figures show what a narrow layout costs ACN's riding screen. They do not show what any particular phone browser's zoom does,** and no iPhone zoom policy is derived from them.

**Magnification** (pinch, focus zoom, iOS Zoom) changes the visual scale only. The layout, and so the riding contract, is unchanged by it. The tests' root-font method does not represent it, and need not.

**The WCAG 200% benchmark.**

- **SC 1.4.4:** "text can be resized without assistive technology up to 200 percent without loss of content or functionality". The scaling is "primarily a user agent responsibility", through "zoom (of the entire page's content), magnification, text-only resizing, and allowing the user to configure a size for rendered text". The author's part is "content that does not prevent the user agent from scaling the content effectively".
- **SC 1.4.10, Reflow:** asks for no two-dimensional scrolling at 320 CSS px wide, the equivalent of 1280 px at 400% zoom. It exempts content that "require[s] two-dimensional layout", such as maps.
- **ACN's own requirement goes further.** During riding, without scrolling, the switcher stays on screen, and the map stays useful. That is a product requirement for a mounted phone, not a WCAG requirement.
- **These tests support no conformance claim.**

## Recommended support policy

A proposal for the rider's decision. **Nothing in it is approved.**

| Level                                | Condition                                                                                            | Contract                                                                                                                                                                                                                                                                                                                                                                                                              | Evidence                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **A — primary acceptance**           | Installed iPhone 13, portrait, ordinary text (iOS default text size, Display Zoom standard, no zoom) | The full riding contract: no scrolling; the switcher always visible; the map with the rider, the attribution and its controls; warnings and recovery visible; **today's information at a glance**, including the remaining ascent, GPS accuracy and freshness, and one-tap Screen on                                                                                                                                  | The installed-iPhone checks, plus automated tests at 390×844 |
| **B — enlarged-text acceptance**     | 200% root text (the tests' method; equivalent in Chromium to a 32 px default font)                   | **No loss of content or functionality:** <ul><li>text whole and readable;</li><li>every control and recovery action on screen, tappable and at least 44 px;</li><li>warnings visible;</li><li>**the switcher on screen** in every riding state that is not a compound failure.</li></ul> The map's usefulness (rider, attribution, controls) is measured and reported, not gating, unless the rider decides otherwise | Automated, Chromium and WebKit, English and German           |
| **C — diagnostics**                  | Page-zoom viewport proxies; 250%; compound failure states; landscape; intermediate sizes             | Measured and recorded, never gating. **Exception:** a change that introduces a size or wrapping boundary must be checked at intermediate sizes (B's lesson)                                                                                                                                                                                                                                                           | Automated, as needed                                         |
| **Magnification**                    | Pinch or focus zoom; iOS Zoom                                                                        | Never blocked: no `user-scalable=no` or `maximum-scale`, and no gesture prevention outside the map                                                                                                                                                                                                                                                                                                                    | Implementation; one physical observation                     |
| **iOS Larger Text and Dynamic Type** | —                                                                                                    | Not a support target. Adopting Dynamic Type would be a separate product decision, with broad layout consequences                                                                                                                                                                                                                                                                                                      | First, the stationary check below                            |
| **Display Zoom; Android; desktop**   | —                                                                                                    | Display Zoom: decided after the stationary check. Android: physical verification outstanding (item 25). Desktop: left unspecified                                                                                                                                                                                                                                                                                     | —                                                            |

**What stays visible, and what could be disclosed:**

- **At ordinary text, nothing moves behind a disclosure.** E2's 11–18 px gain does not justify hiding the ascent or making Screen on take three taps.
- **At enlarged text, a constrained-space presentation is a candidate, not an approved solution.** It would keep visible:
  - the status label;
  - the remaining distance;
  - a compact GPS accuracy;
  - a stale fix's age;
  - Offline;
  - every warning and recovery action;
  - the switcher.

  The remaining ascent, "Online" and the Screen on control would be offered on request. Enlarged text is never shrunk to make a test pass.

**Warnings and recovery** are never inside a closed panel. Today's clipped Screen on retry at German 200% is a defect against level B however E2 is decided.

**The switcher requirement:**

- **Ordinary text:** met in every measured state.
- **200%:** met in every measured state except the compound ones. Today, in German on a Planning route, a location error loses it even before an End fails, and an imagery error loses it once an End also fails. E2 would leave only the location error, with its frozen instruction, and a failed End.

Whether compound states fall under level B is a decision. Their frequency is unknown, and calling them rare does not make them an accepted exception.

**What each alternative would cost:**

- **Downgrading 200% root text to a diagnostic** would drop the only automated guarantee for people who use a browser's text-size preference, along with the project's enlarged-text regression coverage.
- **Making page-zoom proxies an acceptance condition** would hold the riding screen to a 195 px layout, which today loses the map and the switcher. Not recommended.
- **Dropping intermediate-size checks** would hide boundary regressions like B's.

## Carried forward, unresolved

These are carried forward unchanged from the [information-priorities report](information-priorities.md):

- **German's first ten seconds of an imported GPX** lie outside E2's 209–377 px range: 145 px with E2, 341 px with E2+N.
- **The compound location error, frozen instruction and failed End state** still loses the switcher with E2. Its frequency is unknown, and it is not an accepted exception.
- **The attribution over the rider** at 200%, whenever the map is under about 280 px.
- **Today's clipped Screen on retry** at German 200%.
- **Map loss while Details is open,** at 175–200%.
- **Unverified:** VoiceOver, and every physical-device behaviour, Android included.

## The smallest remaining design investigation

**Proposed, not started:** an enlarged-text-only constrained presentation.

- **What it is:** E2's summary and details, engaged only when the riding column's size relative to the root font crosses a threshold, as item 114's Planning switch does, so that ordinary text is unchanged.
- **Measured at:**
  - 100, 125, 150, 175 and 200%;
  - in English and German;
  - in Chromium and WebKit;
  - for its own boundary and wrapping behaviour, the switcher, the map, the rider and the warnings.
- **Together with:**
  - a bounded look at the compound state's 294 px frozen instruction;
  - a repair of the clipped Screen on retry.
- **If the stationary check shows** that some iPhone mechanism does reach ACN, its condition is added to this investigation.

## Stationary check on the installed iPhone

On the installed ACN Home Screen app, in portrait. **Note each setting before changing it, and put it back afterwards.** Desktop WebKit does not substitute for any of these.

1. **Larger Text.** Settings → Accessibility → Display & Text Size → Larger Text.
   - Note the slider, then drag it to its largest standard step, with Larger Accessibility Sizes left off.
   - Open ACN: Routes, and a route's Ride screen. Does any ACN text look larger than before?
   - Restore the slider.
2. **Text Size for ACN only**, if Control Center has the Text Size control.
   - With ACN open, open Control Center, choose the setting for ACN only, and enlarge it.
   - Does ACN's text change?
   - Restore it.
3. **Display Zoom.** Settings → Display & Brightness → Display Zoom → Larger Text → Use Zoomed. The phone redraws its screen.
   - Open ACN and start free roam: is the riding screen larger, and is everything still on screen?
   - End free roam.
   - Restore Default.
4. **Safari's Page Zoom setting.** Under Settings → Apps → Safari, note Page Zoom and set it to 150%.
   - Does the installed ACN change?
   - Restore it.
5. **Pinch zoom.** On the Routes screen (not on a map), spread two fingers.
   - Does the page magnify?
   - Pinch back to normal size.

Report, for each step: "changed", "did not change" or "could not find the setting". No phone model or iOS version is assumed beyond the recorded iPhone 13 on iOS 26.6.1.

## Decisions for the rider

1. **Adopt the support-policy levels A, B and C** as proposed, or amend them. In particular:
   - whether level B's switcher requirement covers compound failure states;
   - whether the map's usefulness at 200% gates acceptance or is only reported.
2. **Run the stationary check,** and decide afterwards whether any iPhone mechanism that reaches ACN becomes a support target.
3. **Dynamic Type:** confirm that it stays out of scope, or ask for an investigation of opting in. That would change the riding layout at every iOS text size.
4. **The next design investigation:** approve the enlarged-text-only constrained presentation, with the compound state and the clipped retry, or choose a different scope.
5. **The current-status reading note** on Larger Text: keep it as now qualified, or change it after the stationary check.
6. **Android and desktop:** leave the support policy unspecified for now, or set one.

## Limitations

- **Every automated figure is desktop Chromium** in the CI image, at 390×844 or the stated proxy viewports. No WebKit diagnostic was run for this report.
- **D1 is Chromium only.** Safari's text zoom and Android Chrome were not represented.
- **D2 is a layout-viewport proxy** without device pixel ratio, safe-area insets or real zoom behaviour.
- **The official documentation was read on 9 October 2026.** It describes current versions, and may differ from the rider's iOS 26.6.1 in detail.
- **No physical device was used** for this report.

## Reproducing

The evidence is outside the repository: `~/acn-review/item-145/`.

- **`sources/`:** dated extracts of every source above, with URLs.
- **`out/20-d1-default`, `20-d1-inline`, `20-d1-cdp`:** D1.
- **`out/21-d2-viewport-260x563`, `21-d2-viewport-195x422`:** D2.
- **`probe/probe145e.spec.ts`:** the probe. `PROBE_FONT_MODE` selects default, inline or CDP; `PROBE_VIEWPORT` sets the viewport.
- **`run.sh`:** runs the CI image by digest.
- **`scripts/fetch_sources.py`:** fetches the sources.
