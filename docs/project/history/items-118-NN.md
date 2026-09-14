# Completed backlog items 118–

This file continues the 100– numeric range and opens at item 118. It was started when item 118 was completed: adding it to what was then `items-110-NN.md` would have taken that file to 162,614 characters, past the ~150,000-character soft cap documented in [`README.md`](README.md), so that file was closed at item 117 and renamed [`items-110-117.md`](items-110-117.md) instead of growing unbounded. No existing entry was moved, shortened or rewritten by that split — only the filename changed, plus that file's own intro paragraph and the inbound links that pointed at it. Stable item numbers never change regardless of which file their text lives in: item 118 was completed ahead of items 102, 103, 113, 114 and 119, all of which remain pending, so a number is an identifier and never a schedule.

See [`README.md`](README.md) for the full history index, [`../backlog.md`](../backlog.md) for pending specifications, and [`../current-status.md`](../current-status.md) for the manual acceptance ledger.

---

<a id="item-118"></a>

## Item 118 — Keep OpenRouteService key-deletion confirmation inside its Settings card — done

_Category: Interface and accessibility consistency_

118. **Keep OpenRouteService key-deletion confirmation inside its Settings card — done**
     - Origin: the second installed-iPhone report of 13 September 2026, during which item 117 was accepted and item 112's residual missing-key check was closed. The user reported that activating **Delete key** produced a confirmation that appeared visually separate from the OpenRouteService card. Approved correction: expand that same card to contain the confirmation directly beneath the action that opened it.
     - Required outcome: **Delete key** stays inside the card; activating it expands that card; the confirmation never reads as a separate peer card or panel; nothing is deleted without explicit confirmation; **Cancel** closes it, preserves the key and returns focus to **Delete key**; **Confirm** deletes and updates the same card to its no-key state; `alertdialog` semantics, accessible naming, keyboard and Escape behaviour, focus management, storage and secret handling stay intact; item 112's Settings hierarchy is undisturbed; no navigation plumbing; no deliberate scrolling when the confirmation is already visible.

### Ownership: established from source before a number was allocated

This is **not an item 112 regression**, and item 112 is not reopened. `<ConfirmDialog>` was the **last child of `<section className="screen">`** — outside every panel, a peer of both group sections — in all three commits compared:

| Commit                        | OpenRouteService `.panel` closes | `<ConfirmDialog>` opens |
| ----------------------------- | -------------------------------- | ----------------------- |
| `2eca824` (item 112's parent) | line 388                         | line 475                |
| `64ae976` (item 112)          | line 403                         | line 498                |
| `e52e9a8` (current)           | line 403                         | line 498                |

`git diff 64ae976 e52e9a8 -- src/ui/settings/SettingsScreen.tsx` is empty. Item 112 wrapped the four panels in two `.settings-group` sections and demoted their headings from `h2` to `h3`; it never moved the dialog, and the confirmation rendered outside the card's border and background before and after. The classification rests on that — on whether item 112 changed the visual containment, not on whether the same conditional JSX existed somewhere. It did not. Acceptance merely exposed a pre-existing defect, which is why this is item 118 rather than a corrective follow-up.

### Implementation account (13 September 2026, `0.4.36`)

**The defect was worse than misplacement — it moved the viewport.** `ConfirmDialog`'s Cancel button carries `autoFocus`, so React focused it on mount and the browser scrolled it into view. Tapping **Delete key** therefore yanked the page to the very bottom of Settings, past the rest of the OpenRouteService card, the whole `Explanations` group and both of its panels. The correction removes a disorienting scroll jump, not only a misplacement, and it is what made the sharpest fail-first assertion available: the measured gap between the **Delete key** button's bottom edge and the confirmation's top edge.

**Three files, one behaviour.**

`src/ui/shared/ConfirmDialog.tsx` gains an optional `headingLevel?: 2 | 3 | 4`, defaulting to `2`, rendered through a `{ 2: "h2", 3: "h3", 4: "h4" } as const` lookup so the tag stays a real JSX intrinsic with no cast and no widening to `ElementType`. The default leaves all **six** other call sites — `App.tsx`, `PlanningScreen.tsx`, `RidingScreen.tsx` (twice), `FreeRoamScreen.tsx` and `RidingLauncher.tsx` — byte-identical in behaviour. This was chosen over a third hand-rolled copy of the dialog (after `RouteListItem.tsx` and `RouteTagManager.tsx`): the `h2` is the shared component's own defect, which any caller inside a card would inherit, and about eight lines beats thirty-eight plus a third independently testable Escape handler.

**`h4` is load-bearing, for three independent reasons.** The card's own heading is an `h3` (item 112), so a peer `h3` would say "this confirmation is a sibling section of the card" — precisely the peer reading this item exists to kill. `e2e/settings.spec.ts` asserts exactly four `h3`s on the screen. And with no global heading reset anywhere in `src/index.css`, the UA `h2` default of 1.5em rendered the confirmation title at **24px against `.screen-title`'s clamped ~21.45px** — the dialog's title already outsized the page title before this item, wherever it sat. The outline is now monotonic: h1 21.45 / h2 group 20 / h3 panel 18.72 / h4 confirmation 16px.

`src/ui/settings/SettingsScreen.tsx` moves the dialog into the `!showForm` branch's own `stack`, immediately after the row holding **Replace key** and **Delete key**, and changes how the armed state is held. The bare `pendingDelete` boolean is replaced by an identity binding:

```ts
const [armedDeleteSavedAt, setArmedDeleteSavedAt] = useState<string | null>(null);
// ...
const pendingDelete = armedDeleteSavedAt !== null && key?.savedAt === armedDeleteSavedAt;
```

**This is not defensive decoration; it closes a reachable hole the move would otherwise have opened.** `key` comes from a `useLiveQuery`, so another tab can delete or replace the key while this one holds the confirmation open, and the confirmation now lives inside the branch that `showForm` unmounts. `savedAt` is the stored row's own version marker — `saveProviderKey` rewrites it on every save, a **Replace** included — so a mismatch means "the key you armed this against is gone", and the derived boolean disarms on the very next render with no effect and no cleanup path to get wrong. Deliberately `savedAt` and **not** the key itself: an identity token must never put the secret into component state, so this is a better secret-handling posture than the obvious alternative rather than a compromise. The residual race is two saves inside one millisecond, which is narrower than the last-write-wins race the storage row already has.

`handleStartReplace` additionally clears the armed state, because **Replace key** leaves the stored key untouched — the identity would still match, so the confirmation would survive invisibly behind the form and reappear when the edit was cancelled. `RouteListItem`'s own `openRename`/`handlePinClick` precedent states the principle: an open alertdialog is never silently moved aside instead of being resolved.

**Focus, in two directions.** `onCancel` restores focus to **Delete key** synchronously inside the handler, before React processes the batched state update, so focus leaves the dialog while the button is still mounted and the dialog then unmounts unfocused — the ordering `RouteListItem.handleCancelDelete` already uses. No `preventScroll`, because there is no competing deliberate scroll to suppress, and no effect, because `useNow` re-renders this screen on a timer and an effect-based restore would be a standing invitation to steal focus on an unrelated tick. Escape reaches the same handler for free. **On a successful deletion** focus moves to the card's own `h3`, which carries `tabIndex={-1}` for the purpose: confirming unmounts the trigger, so focus would otherwise fall to `<body>`. The heading was chosen over the key field revealed beside it deliberately — auto-focusing a text input raises the software keyboard immediately after a destructive action. The heading is mounted regardless of when the live query re-emits, so this does not race the re-render. **A rejected deletion keeps the pre-item-118 behaviour exactly**: logged, nothing shown, no focus moved.

`src/index.css` adds one rule, `.route-delete-confirm h4 { margin: 0 0 0.25rem; overflow-wrap: anywhere; }`, beside the existing `h2` one. **Deliberately a separate rule rather than widening that selector to `:is(h2, h3, h4)`**: `RouteTagManager` renders an `h3` inside `.route-delete-confirm` and has never been styled by it, so widening would silently restyle the Routes screen. Both declarations are load-bearing — the UA margin for `h4` is `1.33em`, which is 42.6px above the title at a 32px root inside a box whose own padding is 24px there, and `.route-delete-confirm` is a flex item whose `min-width: auto` would otherwise let an unbreakable word push the panel's min-content width past the viewport, the mechanism item 112 measured as 27px of document overflow.

**The visual treatment is unchanged and that was the decision, not an oversight.** `.route-delete-confirm` already carries the same `--colour-bg-elevated` background as `.panel`, so no second surface appears; it has no `box-shadow`, a 6px radius against the card's own, and a 4px danger left accent that keeps the destructive relationship legible without relying on colour alone. That is exactly how the Route Library's per-card delete confirmation and the tag manager's confirmation already read inside their own cards. Spacing is likewise untouched: `.stack`'s 16px gap plus the rule's own `0.5rem` margin gives 24px at ordinary text and 32px at 200%.

### Measured in the pinned container, not derived

At a 390px viewport, `200%` root text, Chromium in the pinned Playwright image:

| Quantity                              | Measured     |
| ------------------------------------- | ------------ |
| `.panel` content box                  | **324px**    |
| `.route-delete-confirm` content box   | **271px**    |
| `OpenRouteService` at the `h4`'s 32px | **256.22px** |
| Title lines                           | 3            |
| `h4` computed `margin-top`            | 0px          |
| Cancel + Delete + gap                 | **269.28px** |
| Document horizontal overflow          | **0**        |

Two of those figures changed how the tests were written. The panel's 324px is item 112's own recorded measurement, independently reproduced here. And the word fits its box by **14.78px** while the two actions fit theirs by **1.72px** — so although both happen to sit on one row in this container, **no test asserts that they do**: a marginally wider font resolution would wrap them, `.route-delete-confirm-actions` handles it, and "full, non-overlapping, ≥44×44px, not clipped" is the contract rather than a particular arrangement. On a real iPhone the system font is SF Pro, whose caps are wider, so a mid-word break of `OpenRouteService` there is plausible; `overflow-wrap: anywhere` contains it legibly, and it is never clipped. That is stated rather than claimed impossible.

### Evidence

**Fail-first, against the current parent.** Nine Vitest failures across `SettingsScreen.test.tsx` and `ConfirmDialog.test.tsx`, and five Playwright failures across `e2e/settings.spec.ts` and `e2e/androidMobileLayout.spec.ts`, all before a line of production code changed. Two further tests written as new evidence turned out to pass on the parent and are therefore recorded as compatibility guards instead — "opening the confirmation deletes nothing" and "a failed deletion keeps the key, moves no focus and adds no error presentation" — rather than being relabelled as proof of the fix. The cross-screen `e2e/diagnostics.spec.ts` guard, which deletes the key through the real Settings interaction and then asserts `Test routing connection` is disabled with its Settings-directed hint restored, likewise passes on the parent by design: it exists to prove the storage seam is genuinely untouched by the move.

Assertions are relationship-based rather than class-based. Containment is proved by the dialog's **nearest owning `section[aria-labelledby]`** resolving to `ors-settings-heading`, by `within(region)` scoping, and by document-coordinate geometry; the `section.panel` count is recorded as supporting evidence only, precisely because a peer rendered as a bare `<div>` would not move it. "The card grows naturally" is proved in the browser by the panel's height increasing by at least the dialog's height **and** the trailing disclosure moving down by at least as much — neither of which an absolutely positioned or overlapping confirmation would do.

**Negative controls — five discriminating outright, and the seventh needed three attempts, two of which did not discriminate at all.**

| Control                                                 | Result                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1. Restore the confirmation as a peer card              | 1 Vitest + 4 Playwright fail, including item 112's own panel-count test                     |
| 2. Second independent panel treatment inside the card   | 1 Playwright failure, on the computed-style clauses **only** — all 49 Vitest tests pass     |
| 3. Bypass explicit confirmation                         | 8 Vitest failures                                                                           |
| 4. Cancel deletes the key                               | Fails on the **storage** clause specifically, proved by a variant that still restores focus |
| 5. No focus restore after Cancel                        | 2 Vitest failures, on `toHaveFocus`                                                         |
| 6. Confirm without removing the key                     | 3 Vitest failures, led by `getProviderKey()` still resolving                                |
| 7a. `flex-wrap: nowrap` on the actions row              | **Did not discriminate** — 11 passed                                                        |
| 7b. `white-space: nowrap` on the new `h4` rule          | 2 Playwright containment failures, Chromium and Android-emulation                           |
| 7c. Remove `overflow-wrap: anywhere` from the `h4` rule | **Did not discriminate** — 11 passed                                                        |

Three of those are worth carrying forward. **Control 2 is the sharpest**: every DOM, role and relationship assertion still passes when the confirmation is given a shadow and its own background, so only computed style catches it — which is exactly why a class assertion may support the visual contract but can never be its sole proof. **Control 7a's failure to discriminate was not predicted**: the design review proposed it as the containment control, but the two actions are flex items with the default `flex-shrink: 1` and a 44px `min-width` floor, so forbidding the wrap makes them shrink into the 1.72px of slack rather than overflow. **Control 7c's failure to discriminate is a property of the current copy, not of the test**: `OpenRouteService` measures 256.22px against 271px available, so removing the safety net changes nothing until the wording, the padding or the font grows — the declaration is kept because the mechanism is real, and the honest statement is that no automated test presently pins it. Reverting `headingLevel={4}` to `2` is likewise **not** caught by the containment tests, because the pre-existing `.route-delete-confirm h2` rule supplies the same `overflow-wrap` and the title simply breaks mid-word; it is caught by the heading-level assertions instead.

**Verification.** `corepack npm run lint`, `corepack npx tsc -b --noEmit`, the full Vitest suite and `corepack npm run build` all clean. The **full Playwright suite ran in the pinned CI container**, including the `webkit-smoke` project, which cannot launch on this development host at all. A production build preceded every Playwright run. `corepack npm run format:check` ran last and `git diff --check` is clean.

### A second defect found while establishing ownership, deliberately not fixed here

Filed as **item 119**, and reproduced rather than inferred. `ConfirmDialog` hardcodes `aria-labelledby="confirm-dialog-title"` on a fixed element id, while `App.tsx` renders the page-level ride-switch dialog above and outside the screen switch and navigating away from Routes deliberately does not clear `pendingRideSwitch` — the documented fallback that stops a mid-prompt navigation making the prompt vanish silently. Arming a switch from a route card, navigating to Settings and opening **Delete key** therefore puts two elements carrying that id in one document. Measured in a real render: two `alertdialog`s, two nodes with that id reading `Switch to "Route B"?` and `Delete OpenRouteService key`, and **both dialogs resolving their accessible name to `Switch to "Route B"?`** — the key-deletion confirmation is announced as the ride-switch prompt. It is pre-existing and unchanged by item 118, which moves where the Settings confirmation renders rather than how it is named, and it is a confirmed accessibility defect rather than a monitored observation. Three related facts are recorded there rather than changed here: `aria-modal="true"` is asserted at all seven call sites while nothing behind the dialog is inert and the primary navigation stays live, which both hand-rolled in-card precedents deliberately omit; `ConfirmDialog` has no `aria-describedby` while both of those precedents do; and Escape only fires while focus is inside the dialog.

### Limitations, stated plainly

This section was written before any device evidence existed; installed-iPhone acceptance has since been recorded below. The 200% figures are browser-root-text measurements in a Chromium container, never iOS Dynamic Type acceptance — ACN has no Dynamic Type opt-in — and the WebKit evidence is desktop WebKit in a container, not installed-iPhone Safari. **No physical-Android result is claimed**; the `android-chrome` project is Chromium emulation. Two behaviours are unchanged and should not be reported as new: `deleteProviderKey()` failing is silent, logged only, with no visible error, unlike the save path's own `saveError`; and focus after a **Replace key** press still falls where it always did, since only the delete path gained a handoff.

#### Installed-iPhone acceptance (13 September 2026): complete, at product level

Stationary, portrait, on the installed Home Screen PWA, in Settings with a key saved, **all six checks were reported positive**:

- **Delete key** expands the OpenRouteService card and the confirmation appears directly beneath it, clearly part of that card rather than a separate panel;
- the confirmation's full wording is readable, and **Cancel** and **Delete** are both fully visible and comfortably tappable;
- **Cancel** closes the confirmation and leaves the key saved;
- **Delete** removes the key and the same card switches to its no-key state with the entry field;
- `Status` then shows `Test routing connection` disabled with its Settings-directed hint;
- nothing scrolls unexpectedly when the confirmation opens.

**No app version or build was read from Status on the device**, so nothing here asserts which build was under test; the deployed context (`0.4.36`, commit `37f6895`) is recorded separately. This is **broad product-level acceptance** of the intended containment and behaviour, never a hand-recreation of the automated boundaries above: no VoiceOver audit, no iOS Dynamic Type result and no physical-Android result is claimed, and the 200% figures stay browser-root-text evidence. The ledger, [`../current-status.md`](../current-status.md), remains authoritative.

Having accepted that, the user then approved a **conditional-reveal refinement** — activating **Delete key** should bring the expanded confirmation and both actions into view when they would otherwise be partly hidden. That is a follow-up to this item, recorded below once implemented; it is **not** a defect report against the behaviour accepted here, and the acceptance above is not retrospectively rewritten as though the refinement had existed.

### Conditional-reveal follow-up (13 September 2026, `0.4.37`)

**Contract.** Activating **Delete key** brings the expanded confirmation and both actions into view when they would otherwise be partly hidden: nothing moves when the whole inset already fits the usable visual viewport; the minimum movement when it fits but is clipped; and, when it cannot fit, the **Cancel**/**Delete** row is prioritised while retaining as much title and warning context as possible. Immediate, never animated, once per arming, and re-evaluated on reopen.

#### Baseline, measured on `37f6895` before a line was written

At 390x844 in the pinned container, across Chromium, WebKit and the Pixel-7 preset — three deliberately seeded starting positions, each opened with a real DOM click so Playwright's own actionability scroll could not contaminate the measurement:

| Fixture                            | Native result, all three engines                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Confirmation already fully visible | `scrollY` unchanged; inset 267.9..495.9 inside a 67..844 band                                                                   |
| **Delete key** 20px above the fold | **619px of native scroll** (WebKit 620), landing the inset's bottom at 456.9 — **379px above** the minimum-movement position    |
| 200% root text                     | `scrollY` clamped at the document end; inset 748px tall with its **top at −270.3**, and 366px of unused space below the actions |
| Application scrolls issued         | **0**, in every fixture                                                                                                         |

Two findings decided the design. First, **the application had no reveal at all** — every visible movement came from the browser's own `autoFocus` scroll on Cancel. Second, that native scroll **over-shoots**: at ordinary text it reveals far more than asked, which is why the honest contract here is "add only the residual", not "take over the scrolling".

#### What was built

A Settings-owned `confirmationRevealScroll.ts`: a pure `computeConfirmationRevealDelta` plus a thin `applyConfirmationReveal` that measures the visible band, asks for a delta and issues at most one `window.scrollBy({ top, left: 0, behavior: "auto" })`, returning the delta so tests assert the decision and not only its effect. `SettingsScreen` gains a `useLayoutEffect` keyed on `pendingDelete`, `ConfirmDialog` an optional `containerRef`, and `App` passes its existing `stickyHeaderRef` down — the same prop `RouteLibrary` and `RouteListItem` already take. **No CSS change, and no change to the inset's styling, wording, deletion semantics or the `savedAt` identity guard.**

Five decisions are worth carrying forward.

**Neither existing reveal helper matched.** `routeCardTopReveal.ts` is explicitly _top_-prioritising — "never sacrificing the top to try to also show the band's bottom" — and scrolls smooth unless reduced motion is set; clause 3 needs the opposite priority and clause 5 forbids smooth. `runWhenViewportSettled` was rejected on two grounds: it waits three stable frames, so the actions would be painted and touchable before anything moved, and **at its one-second cap it abandons without running at all**, which is the opposite of a deterministic reveal. Its own motivating case is unreachable here, since the saved-key branch mounts no text input.

**The cushion is read from a custom property, not from `scroll-margin-bottom`.** Items 95 and 106 read `scroll-margin-bottom` because the browser performs their scroll, so the declaration is genuinely honoured there. Here it would be read purely as a number — and `scroll-margin` is **not inert**: it also feeds the scroll-into-view the focusing steps run for `autoFocus`, so declaring it would have quietly changed the native reveal this code measures and then corrects, leaving two mechanisms interacting through one property. `getComputedStyle(document.documentElement).getPropertyValue("--safe-area-inset-bottom")` has no scrolling effect, and **measurement settled a design review's objection that it would not resolve**: it returns `"0px"` in Chromium, WebKit and the Pixel-7 preset alike, and `"34px"` under the inline root override `index.css` documents for exactly this purpose.

**Bottom-anchoring needs no second ref.** Source inspection confirms `.route-delete-confirm-actions` is the inset's final child, followed only by its own padding, so aligning the inset's bottom to the band guarantees at least as much protection as measuring the buttons — and keeps Cancel's 4px focus ring inside that padding rather than inside the cushion. The browser assertions are still made on the real **Cancel** and **Delete** rectangles. The residual case where the action row alone exceeds the band is unreachable at supported phone-portrait widths and is deliberately not engineered for.

**No mirror ref is needed for "once per arming".** `pendingDelete` is a primitive boolean, so a `useLayoutEffect` keyed on it runs exactly on its false→true and true→false transitions — never on a `useNow` tick, a live-query re-emission or an unrelated control's state change — and a reopen _is_ a fresh false→true transition, which is what makes clause 6 fall out for free. Item 95 needed its `lastSwitchMessageRef` only because its own dependency was an object recreated every render.

**A jsdom-forced correctness guard.** Every rect is all-zero there, so an unguarded delta computes as `0 − (0 + 8) = −8` and would have fired a spurious scroll in every existing Settings component test. An element with no laid-out box cannot be revealed, so a zero-or-negative height returns 0, and that is asserted directly.

#### Evidence

Eleven pure fixture tests, thirteen component tests and seven browser tests. The decisive browser instrument patches `window.scrollBy` and records the deltas the **application** requested: because the reveal scrolls that way and the browser's native focus scroll does not, this separates "the app decided to move" from "the view moved because focus moved", which a raw `scrollY` comparison cannot.

Three browser fixtures carry the discriminating evidence, and one carries a finding worth stating plainly:

- **The browser already satisfies the ordinary clipped case.** Its 619px over-shoot leaves the whole inset inside the band, so the correct application behaviour is to issue **zero** scrolls — the contract's own "avoid a redundant second adjustment when native focus has already made the target visible". That is asserted as an outcome, and it is recorded as a browser behaviour rather than as evidence for this change.
- **A 34px home-indicator inset** — a real iPhone value — creates a gap the browser cannot know about: Cancel stays inside the layout viewport, so the native scroll does nothing, while the inset's bottom sits below the cushioned band. Exactly one application scroll lands it on the band.
- **200% text with a 120px synthetic inset** takes the overflow branch with a wide margin rather than the ~20px that 200% alone would leave. Both actions end inside the band, the warning above them stays visible, and a real `.click()` on Cancel — whose actionability check is the hit-test proof — still works.
- **Scrolling past an oversized confirmation** and reopening produces a single **negative** delta, asserted on the requested movement rather than on net `scrollY`.

Interaction safety reuses item 95's per-frame recorder, re-implemented locally per the no-shared-e2e-helpers convention and scoped to the OpenRouteService card because item 119 means a page-level dialog can legitimately coexist. It is installed before the confirmation opens and stops at the first activation, so the window it covers is exactly "actionable and touchable"; a `MIN_ACTIONABLE_FRAMES` floor of 3 keeps it from passing vacuously.

**Negative controls: seven of eight discriminate, and the eighth does not — stated rather than implied.**

| Control                                                | Result                                     |
| ------------------------------------------------------ | ------------------------------------------ |
| 1. Remove the conditional reveal                       | 6 component tests and 3 browser tests fail |
| 2. Scroll even when already fully visible              | 5 pure and 1 component test fail           |
| 3. Reveal only the title, leaving the actions clipped  | 2 pure and 1 component test fail           |
| 4. Smooth behaviour                                    | 2 component tests fail                     |
| 5. Run the reveal on every render                      | the once-per-arming test fails             |
| 6. Post-paint `useEffect` instead of `useLayoutEffect` | **Did not discriminate** — see below       |
| 7a. Ignore the sticky-header boundary                  | the header-occlusion test fails            |
| 7b. Ignore the visual viewport                         | the visual-viewport test fails             |
| 8. Regress Cancel's focus restoration                  | 2 existing tests fail                      |

**Control 6 did not discriminate at 20x CPU throttling, and did not discriminate at 50x either.** Item 95 exposed a 242px drift the same way, so this was expected to work and does not. The likely reason — reasoned, not proved — is that this reveal is triggered by a **discrete click**, whose passive effects React flushes before yielding to paint, whereas item 95's prompt opened from an asynchronous storage check. `useLayoutEffect` is kept because it guarantees the pre-paint ordering independently of that scheduling detail, but **no test here proves it is load-bearing**, and it should not be described as proved. Two further non-discriminations are recorded for the same reason: under control 1 the stability tests pass **vacuously** — with no reveal, nothing moves — so stability is never a proxy for correctness; and the Android-emulation test is a containment guard that the native scroll also satisfies at the Pixel-7 preset, so the discriminating browser evidence is the three Chromium fixtures.

One consequence is pinned as a stated outcome rather than left to be discovered: after Cancel in the constrained case the restored **Delete key** trigger is asserted to be both focused and fully inside the usable band.

**Verification.** `corepack npm run lint`, `corepack npx tsc -b --noEmit`, **3768/3768 Vitest across 173 files** and `corepack npm run build` all clean; the **full Playwright suite passes 381/381 in the pinned CI container**, including `webkit-smoke`, which cannot launch on this development host. A production build preceded every Playwright run. `corepack npm run format:check` ran last and `git diff --check` is clean.

**Limitations.** Automated evidence only — **no installed-iPhone verification of this refinement is claimed**, and its checklist below has not been run. The 200% and synthetic-inset figures are browser measurements, never iOS Dynamic Type acceptance. WebKit coverage for Settings is a one-off investigation run, because the `webkit-smoke` project matches `smoke.spec.ts` alone; the committed regression coverage is Chromium and the Chromium-emulated Pixel-7 preset. On iOS Safari a programmatic focus on a non-editable element scrolls synchronously, so the keyboard-driven deferral that motivated `viewportSettle.ts` should not apply — but that is reasoning, not measurement, which is why the device check remains the gate.

#### Installed-iPhone acceptance of the refinement — 14 September 2026

**Accepted.** All six stationary portrait checks were reported positive on the installed Home Screen PWA:

- with **Delete key** low enough that the expanded confirmation would not fit without movement, activating it moved the OpenRouteService card only enough to reveal the warning and both actions;
- both actions were stationary the moment they appeared;
- reopening an already fully visible confirmation caused no unnecessary movement;
- at the constrained position both actions remained tappable and the OpenRouteService context remained understandable;
- **Cancel** preserved the key and returned focus to **Delete key**;
- confirmed deletion removed the key, did not open the keyboard, and retained context at the OpenRouteService section.

This is **broad installed-iPhone portrait product-level acceptance** of the refinement's intended behaviour — that each check behaved as described during ordinary use. It is **not** a hand-recreation of the automated boundaries above: no VoiceOver audit, no iOS Dynamic Type result and no physical-Android result is claimed, and the 200%-root-text and synthetic-safe-area figures remain browser measurements. In particular, the three findings recorded above that only automated evidence establishes — the browser's own 619px over-shoot, the 34px-inset gap, and control 6's non-discrimination — are not re-asserted by this acceptance.

**Build context, stated separately from the physical evidence.** The refinement shipped as version `0.4.37` (commit `5bee225`) and was deployed before this report. **No app version or build was read from `Status` on the device during the session**, so nothing here asserts which build was installed; the deployed context is recorded alongside the report rather than as part of it.

With this, item 118 is complete: the shipped same-card containment was accepted on 13 September 2026 and the conditional-reveal refinement on 14 September 2026.
