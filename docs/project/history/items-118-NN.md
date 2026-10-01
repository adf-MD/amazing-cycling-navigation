# Completed backlog items 118–

This file continues the 100– numeric range and opens at item 118. It was started when item 118 was completed: adding it to what was then `items-110-NN.md` would have taken that file to 162,614 characters, past the ~150,000-character soft cap documented in [`README.md`](README.md), so that file was closed at item 117 and renamed [`items-110-113.md`](items-110-113.md) instead of growing unbounded. No existing entry was moved, shortened or rewritten by that split — only the filename changed, plus that file's own intro paragraph and the inbound links that pointed at it. Stable item numbers never change regardless of which file their text lives in: item 118 was completed ahead of items 102, 103, 113, 114 and 119, all of which remain pending, so a number is an identifier and never a schedule. Item 121 followed, completed in `0.4.44` ahead of items 102, 103, 114, 119 and 120, which remain pending. Item 123 followed, completed in `0.4.46` ahead of items 102, 103, 119 and 120. Item 119 was completed next, in `0.4.47`, and is filed between items 118 and 121 in numeric order; items 102, 103 and 120 remain pending. Item 128 followed, completed in `0.4.50` after item 102; items 103, 120, 122 and 124 remain pending.

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

### Recorder-synchronisation follow-up (1 October 2026, test-only)

CI run [36739426686](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/36739426686) failed "the confirmation's actions are already settled in the first frame a rider can touch" on the `MIN_ACTIONABLE_FRAMES` floor, not on movement. Its retained trace recorded two frames, at about 46.5 ms and 62.9 ms, before Cancel was activated at 69 ms, with both actions at exactly 628.625 px. Both recorder tests now wait, before Cancel, until the recording holds three frames of the open confirmation.

- **How the wait behaves.** It reads the original recording, from before the confirmation opened, and changes nothing in it. It waits for samples, not for stillness. It is capped at 2 s and reports the count it received.
- **What is unchanged:** the three-frame minimum and the 1 px tolerance.
- **Repeated 30 times each in the pinned container: 60/60.** The unrepaired spec also passed 60/60 locally, so the race was not reproduced here; the CI trace is the evidence.
- **A temporary drift control.** A 400 ms entry animation on the confirmation, from 24 px to 0, failed all six runs on the drift assertion ("Cancel moved 2.0px by t=91ms" onwards), after the new wait had passed. **It demonstrates drift detection only.** It does not change the finding above that these tests do not distinguish `useEffect` from `useLayoutEffect`: pre-paint ordering remains unproved.
- **A temporary bounded-failure control.** A recorder stopped after one tick failed both tests at the new wait after 2 s, with `Received: 0`.

No production change and no version bump.

---

<a id="item-119"></a>

## Item 119 — Unique confirmation-dialog titles and truthful overlapping-dialog semantics — done

_Category: Interface and accessibility consistency_

119. **Unique confirmation-dialog titles and truthful overlapping-dialog semantics — done**
     - Origin: the repository investigation that established item 118's ownership, 13 September 2026 — **not** an installed-iPhone observation, and **not** field evidence. See [`current-status.md`](../current-status.md) for the dated record.
     - **This is a confirmed accessibility defect, reproduced in this repository, not a monitored reliability observation.** `ui/shared/ConfirmDialog.tsx` hardcodes `aria-labelledby="confirm-dialog-title"` on a fixed element id. `App.tsx` renders the page-level ride-switch `ConfirmDialog` above and outside the screen switch, and navigating away from Routes deliberately does not clear `pendingRideSwitch` — the documented fallback so a mid-prompt navigation does not make the prompt vanish silently. Arming a switch from a route card, navigating to Settings and opening **Delete key** therefore puts **two** elements carrying that id in one document. Measured in a real render: two `alertdialog`s, two nodes with that id reading `Switch to "Route B"?` and `Delete OpenRouteService key`, and **both dialogs resolving their accessible name to `Switch to "Route B"?`** — so the key-deletion confirmation is announced as the ride-switch prompt.
     - **It is not an item 118 regression, and item 118 is not reopened.** The same hardcoded id and the same reachable path exist before item 118; item 118 changes where the Settings confirmation renders, not how it is named.
     - Scope approved for the eventual implementation:
       - **unique dialog-title ids**, so no two simultaneously rendered confirmations can share one, and each dialog resolves to its own accessible name;
       - **truthful modal semantics** — `ConfirmDialog` asserts `aria-modal="true"` while nothing behind it is inert and the primary navigation stays live, which the two in-card precedents (`RouteListItem.tsx`, `RouteTagManager.tsx`) deliberately omit;
       - the **overlapping-dialog lifecycle** — whether two confirmations should ever be open at once, and if not, which one yields.
     - **The implementation must survey every `ConfirmDialog` call site before choosing a correction**, since a change here reaches riding-critical dialogs: `App.tsx`, `PlanningScreen.tsx`, `RidingScreen.tsx` (two), `FreeRoamScreen.tsx` and `RidingLauncher.tsx`, plus Settings. No particular mechanism — `useId()`, a required prop, a focus trap, or a single-dialog policy — is prescribed here, deliberately.
     - Explicitly rejected directions: removing the documented page-level fallback that keeps a mid-navigation prompt visible; suppressing one dialog merely to make the duplicate id unreachable without addressing naming; and asserting modality that the implementation does not actually enforce.
     - Evidence required when this is implemented: a **fail-first test rendering the real overlapping path** and asserting each dialog's own accessible name, plus compatibility guards proving the six existing call sites are unchanged.
     - Physical acceptance on the installed iPhone Home Screen PWA is required for whatever ships, including a VoiceOver check that each confirmation announces its own title. Physical Android verification is separately outstanding, as for most recent items.

### Decisions made with the rider (30 September 2026)

Each was put to the rider and decided, not assumed.

- **Every confirmation is a named, described, non-modal `role="dialog"`**: the shared `ConfirmDialog` at all seven call sites and the three hand-rolled in-card confirmations. The page stays operable around every one of them — the page-level switch prompt exists precisely because the primary navigation stays live — so none may claim `aria-modal`, and none is an `alertdialog`, which ARIA expects to be modal. Switching only the shared component was offered and rejected, because two coexisting confirmations would then carry different roles.
- **The stale switch prompt is fixed within this item if reproduced**, with a newer ride choice withdrawing the older prompt and the destructive path guarded however it is invoked. The planning review then tightened it twice: the supersession guard must come **before** any busy-state update or storage call, with every later update conditional on the same request still owning the prompt; and a newer ride choice made while an older End and switch is still clearing must never open a ride the clear can then erase — the newer transition waits for the clear and classifies against fresh storage, with clear failure covered too. Possible loss of a newly opened ride was not to be recorded as a limitation.
- **Automated accessibility checks use what the repository already has** — browser-computed names and descriptions through Playwright in Chromium and WebKit, and jest-dom in the unit suite — with no axe dependency for this slice, and tests that do not lock to `alertdialog`.

### Stage 0: measured on the unchanged `0.4.46`

A temporary probe (never committed) ran in the pinned container, Chromium and WebKit agreeing throughout; the in-flight clear was reproduced at unit level against the real App and storage, since IndexedDB's clear is too fast to hold in a browser.

- **The reported overlap, exactly.** Arming a switch on Route B's card, leaving Routes for Settings and opening Delete key left two `alertdialog`s with `aria-modal="true"`, both `aria-labelledby="confirm-dialog-title"`, the id present twice, and **both computing their name as `Switch to "Route B"?`**. Planning's Clear draft produced the same. Inside RidingScreen's paused panel, Edit copy and End ride open together gave the End-ride confirmation the name `Replace your current draft?`.
- **Interaction, recorded as it was.** Focus went to the newest confirmation's Cancel; Escape closed only the dialog holding focus and returned focus to its trigger (Delete key), or to the document body for the switch prompt, whose card trigger had unmounted with Routes; the navigation stayed live with both open.
- **The stale prompt, worse than the code reading suggested.** After the Ride launcher's Resume, the switch prompt stayed on screen **above the immersive riding shell**; its End and switch cleared the resumed ride's stored row and then stuck in `Ending…` with both actions disabled, without opening Route B. RidingScreen's own Start riding left the prompt above the immersive shell the same way.
- **A further lifecycle defect, found while probing.** Returning to Routes silently dropped a pending switch the rider had left Routes with: the Route Library's "target missing" safety net ran while its live query was still `undefined`, saw an empty list and cancelled the switch.
- **The in-flight clear.** Holding the clear and choosing Resume ride classified against the not-yet-cleared row, so Route A resumed (Pause, one location watch) while the switch prompt stayed stuck above it. The resumed screen then re-wrote A's row after the clear, so storage happened to agree with the screen by write order alone, which nothing guaranteed.

### Implementation account (30 September 2026, `0.4.47`)

- **`ConfirmDialog`.** `useId()` supplies `headingId` and `descriptionId` (called before the `open` early return); the root is `role="dialog"` with `aria-labelledby` and `aria-describedby`, and `aria-modal` is gone. Focus (`autoFocus` Cancel), Escape, `headingLevel`, `containerRef`, item 118's reveal and every caller's focus return are unchanged. The doc comment now states why the dialog is non-modal and that several may be open, each acting only on its own subject.
- **The in-card confirmations** in `RouteListItem` (delete, and item 95's switch prompt) and `RouteTagManager` (merge and delete) change role only; their `useId()` naming, focus handling and item 95/106 reveals are untouched. Comments that said "alertdialog", and `RouteTagManager`'s note about the old hardcoded id, were corrected.
- **The overlap policy is independence.** More than one confirmation may be open; each is named and described by itself, Escape and Cancel act on the one holding focus, and none is suppressed to hide an id. The page-level fallback when leaving Routes is kept.
- **The switch prompt yields (`App.tsx`).**
  - A proceed or resume outcome in `requestRouteTransition` or `requestFreeRoamTransition` that opens a ride withdraws every older prompt (`withdrawPromptsOlderThan`).
  - Starting to ride — reported by RidingScreen or FreeRoamScreen through a now-stable `handleRidingActiveChange` — withdraws any prompt and takes a new request id, so an older switch action still in flight cannot open its target over the ride.
  - Every pending-switch action (`confirmPendingSwitch`, the check retry, the free-roam write retry, `returnToPausedRide`) returns before any busy-state update or storage call when it no longer owns its request, withdrawing only its own prompt; every later update goes through `updateOwnPrompt`, which changes the prompt only while the same request still owns it.
  - The clear and the fresh free-roam writes a switch action starts are tracked (`trackSwitchStorageMutation`); a new transition takes its request id at once, then waits for any such mutation to settle before classifying. After a successful clear, Resume ride finds no row and opens Route A as an ordinary pre-ride with no restored progress and no GPS auto-start; after a failed clear it finds A's row and resumes A with its progress. The launcher refresh token is bumped after any successful clear, superseded or not.
- **`RouteLibrary`** reports a missing switch target only once its routes have loaded, so a pending switch returns inside its card when the rider comes back to Routes.

### Findings worth carrying forward

1. **`aria-modal` was never enforced anywhere**, and the page-level switch prompt's whole reason to exist — surviving a navigation away from Routes — depends on the page staying operable. A truthful dialog here is necessarily non-modal.
2. **The stale prompt was a riding-critical defect hiding behind an accessibility item.** It sat above the immersive shell after a resume, and its destructive action cleared the resumed ride's row. The request-id counter already existed; the prompt simply did not follow it.
3. **The in-flight clear had to be closed at the classification, not the prompt.** Guarding the prompt cannot recall a clear already started; making every newer transition wait for it, then read fresh storage, is what keeps screen and storage in agreement.
4. **The Route Library's safety net ran during loading.** An empty list while a live query is still `undefined` is not evidence of a missing target.
5. **Two mechanisms withdraw the prompt on a launcher Resume** — the resumed ride's own start, and the transition's open. Removing either alone was still caught by a different test (below), so each has its own discriminating evidence.
6. **React's `useId()` values come from a counter shared across renders**, so `ConfirmDialog.test.tsx`'s byte-identical comparison of two separate renders now replaces each generated id by its position first.

### Evidence

**Fail-first, against `0.4.46`.**

- **Unit (written before the change):** the role-agnostic overlap test in `App.test.tsx` failed on the Delete-key confirmation's name (`Switch to "Route B"?`); RidingScreen's two-open test and `ConfirmDialog`'s two-instance test failed the same way. Of the eight lifecycle tests, seven failed for their intended reasons — the prompt not withdrawn after a launcher Resume or after riding started, a busy `Ending…` state on a superseded prompt, a resumed ride instead of a pre-ride after the in-flight clear, a stuck prompt after a failed clear, a prompt for Route C instead of opening it, and a pending switch dropped on the return to Routes. One, an older failed clear never replacing a newer prompt, passed on `0.4.46` as well, because the existing post-await request-id checks already prevented it; it is kept as a regression guard.
- **End-to-end:** all eight tests in the new `confirmationDialogs.smoke.spec.ts` fail on `0.4.46` in both engines, but at the new `role="dialog"` requirement, before any name is compared. The naming defect's browser evidence is therefore Stage 0's probe, measured in both engines, and the role-agnostic unit tests.

**New and focused tests.** `confirmationDialogs.smoke.spec.ts` (Chromium and WebKit) checks, on the real overlapping path, each confirmation's browser-computed name and description, unique ids with exactly one target inside the dialog for every `aria-labelledby`/`aria-describedby`, `role="dialog"` without `aria-modal`, focus on opening, Escape and Cancel closing only their own dialog with focus back on Delete key, the navigation staying live and the switch returning inside B's card, End and switch from the Settings fallback opening Route B with the row cleared, a route card's delete confirmation, and the launcher-Resume path. Focused unit tests cover each hand-rolled confirmation's role, name, description, initial focus and Escape. About 340 existing role queries in 33 test files moved from `alertdialog` to `dialog`, and those suites keep covering every single-dialog path (Cancel, Escape, confirmation, navigation).

**Negative controls, every one run.**

| Control                                                          | Caught by                                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The fixed `confirm-dialog-title` id restored                     | the three role-agnostic overlap tests (App, RidingScreen, ConfirmDialog)                                                                                       |
| `aria-modal="true"` restored                                     | the same three                                                                                                                                                 |
| `role="alertdialog"` restored                                    | the same three                                                                                                                                                 |
| Older prompts not withdrawn when a newer transition opens a ride | both in-flight-clear tests (Route A pre-ride, Route C); the launcher-Resume test alone does not discriminate, since riding starting also withdraws (finding 5) |
| The supersession guard removed from End and switch               | the superseded-confirmation test                                                                                                                               |
| The deferral removed                                             | both in-flight-clear tests                                                                                                                                     |
| Riding start no longer withdrawing                               | the RidingScreen Start riding test                                                                                                                             |
| The Route Library loading guard removed                          | the return-to-Routes test                                                                                                                                      |
| Unconditional, non-owner-checked prompt updates                  | **not discriminated**: the existing request-id checks after every await already stop each reachable case, so the owner check is defence in depth               |

**Verification.** `npm run lint`, `npm run typecheck`, `npm test` (**4679/4679 across 202 files**, three full runs), `npm run build`, and the **full Playwright suite in the pinned container (619/619)**, with `npm run format:check` last. The new spec with the switch-guard and Settings specs passed 195/195 at 36 workers (five repeats). One `App.test.tsx` run failed a single test whose name was not captured; it did not recur in 16 isolated runs of that file or 3 full-suite runs, and it is not attributed. Local npm is the pinned `11.16.0`; local Node is `v24.13.0` against `.nvmrc`'s `24.18.0`, and CI is authoritative.

### Limitations, stated plainly

- **VoiceOver was not tested** and is deferred: no claim is made about how iOS announces a non-modal `dialog`, or two at once. The browser-computed names and descriptions are Chromium's and WebKit's, not VoiceOver's.
- **No installed-iPhone evidence exists yet**; the device checks are in [`current-status.md`](../current-status.md).
- **Escape in the page-level switch prompt after leaving Routes leaves focus on the document body**, because the card that opened it has unmounted. This predates item 119 and is unchanged.
- **Two confirmations open at once remain possible by design**, each independent. Whether a rider is ever better served by one yielding to the other was not in scope beyond the stale switch prompt.
- **The owner-conditional updates are defence in depth** (the table above).
- The WebKit coverage is desktop WebKit in a container, and no physical-Android result is claimed.

### Route-session isolation follow-up (30 September 2026, `0.4.48`)

**The device finding.** The installed-iPhone check of `0.4.47` (build `187b752`, reported 30 September 2026) passed the stale-prompt check and the representative confirmations, but with route A paused, a switch to route B armed from Routes and **End and switch pressed from Ride** opened B showing **Resume ride** instead of the fresh **Start riding**. The rider asked for it to be treated as a route-session isolation defect, not button copy, and fixed before item 102. Item 119's device acceptance stays open.

**Reproduced in a browser before any change** (a temporary probe in the pinned container, Chromium and WebKit identical). With A's paused row seeded with a fix and 400 m of progress, opening A from its card, arming B, going to Ride and confirming there:

- opened B with **Resume ride**, A's remaining distance (0.6 km of 1.0 km) and A's stale fix;
- left a stored row with **B's route id and A's `startedAt`, fix, point index and 400 m of progress**;
- after a reload, the Ride launcher offered "You have an unfinished ride on this route. Resume ride" for B.

The same switch confirmed from the Routes card opened B with **Start riding**, left no row, and offered nothing after a reload.

**Cause.** After a Pause, `App.handleRidePaused` deliberately keeps route A's `RidingScreen` mounted under Ride (item 72). The screen was rendered **without a key**, so `openRideTarget(B)` swapped its `route` prop in place — against the "route's identity is stable for the component's lifetime" assumption that `RidingScreen` and `useRideNavigation` both document. The hook's restoration effect, keyed on the route id, found no row for B and reset nothing. Its persistence effect, also keyed on the route id, then ran with A's retained fix and `startedAt` and wrote them under B's id, just after the switch's own clear. Every other entry point was unaffected because leaving the Ride screen unmounts `RidingScreen`.

**The fix.**

- `App.tsx` keys `RidingScreen` by route id, so a different route is always a fresh screen and navigation hook. A route updated in place under the same id is not remounted.
- As defence in depth for stored data, `useRideNavigation` records the route its session belongs to, and its persistence effect and `pause()` refuse to write under any other route id.

**Evidence.**

- **Fail-first.** The App test on the exact path failed on `0.4.47` for want of **Start riding**. The hook test failed with two writes under the new route (the persistence effect and `pause()`). The new browser test on the exact path failed in both engines at **Start riding**. The Routes-card controls passed before and after, as expected.
- **After the fix**, all three assert B's **Start riding** with no **Resume ride**, **no stored row** sampled three times after the switch, and nothing to resume after a reload or remount. That storage assertion is the result observed, not a prerequisite.
- **Negative controls.** Removing the key fails the App test — the guard alone keeps storage clean but not the screen. Removing the guard fails only the hook test, since the key already protects App. Removing both fails both.
- **Verification.** `npm run lint`, `npm run typecheck`, `npm test` (4682/4682), `npm run build`, the full Playwright suite in the pinned container (623/623) and `npm run format:check`.
- **An unrelated, pre-existing flake**, measured rather than assumed. `mapImageryRecovery.spec.ts`'s route-riding reconnection test failed once in the first full run, on its follow-anchor tolerance. Repeating that whole spec ten times at 36 workers, in eight interleaved rounds, it failed **16 of 80 on `0.4.47` and 20 of 80 with this change**. These runs do not establish a regression attributable to `0.4.48`, and no route changes in that test. It is recorded here and not attributed to this follow-up. It is now tracked as unscheduled [item 130](../backlog.md#item-130).

**Limitations.** No installed-iPhone evidence of the fix yet (Session 5 in [`current-status.md`](../current-status.md)); the browser evidence is desktop WebKit and Chromium in a container.

### Installed-iPhone acceptance — reported 30 September 2026

**Accepted.** On the installed Home Screen PWA, version `0.4.48`, build `bf09776` as reported, both remaining overlapping-switch paths passed:

- with a route ride paused and another route's switch prompt armed, **End and switch pressed from Ride** opened the new route fresh, with **Start riding** and none of the paused route's progress — the `0.4.47` finding, corrected on the device;
- with the same prompt armed, the Settings **Delete key** confirmation overlapped it, each Cancel closed only its own confirmation, and the switch prompt returned inside its route card on Routes;
- after each switch, closing and reopening the app offered nothing to resume.

The `0.4.47` check's passes — the stale-prompt check and the representative single confirmations — stand and were not repeated. This is **broad installed-iPhone product-level acceptance**. It does not re-assert the automated measurements above, and the limitations recorded above describe the item as it stood at implementation. **Not claimed:** VoiceOver, which stays deferred, and physical Android. The dated record is in [`current-status.md`](../current-status.md).

---

<a id="item-121"></a>

## Item 121 — Four-destination primary navigation with a Settings/Status switcher — done

_Category: Navigation and information architecture_

121. **Four-destination primary navigation with a Settings/Status switcher — done**
     - Origin: a navigation decision the rider approved before item 113's first installed-iPhone German pass, recorded here on 25 September 2026 together with the evidence from that pass. **This is a new decision, and it explicitly reverses the shared-parent option that item 112's stage-5 gate rejected** ([`history/items-110-113.md#item-112`](items-110-113.md#item-112)). Item 112 rejected a shared parent for Settings and Status because ACN has no router, no URL/history and no focus management on screen transition, and because the failure case would cost an extra tap. The 25 September pass supplied new evidence: German `Einstellungen` wrapped its final `n` onto a second line of the five-tab bar at ordinary text on an iPhone 13, even though `e2e/language.spec.ts` asserts one line in the pinned container. Item 112's other decisions stand: the names `Status` and `Settings`, and Settings' `Preferences`/`Explanations` grouping.
     - Approved scope:
       - a **sticky primary navigation with four destinations**: `Routes / Ride / Plan / Settings` (German `Routen / Fahren / Planen / Einstellungen`);
       - Status reached through a **non-sticky, two-button `Settings / Status` sibling switcher at the top** of both the Settings and Status screens;
       - **the current contents of both screens preserved initially**, with nothing moved between them in this item;
       - **an unfinished OpenRouteService key edit preserved in memory** when switching between the two siblings, so typing a key, checking Status and returning does not lose it. In memory only, never persisted, consistent with the project's key-storage rules.
     - Constraints: no URL router (hash routing only if one becomes unavoidable, per the root rules); the switcher's active state never colour alone; established touch targets; the immersive riding shell keeps replacing the navigation exactly as today. Re-measure whether item 113's `:lang(de) .main-nav-button` containment rule is still needed, rather than assuming it.
     - **Item 103 must not silently absorb this information-architecture change**, and item 102's symbol redesign then works over four destinations. Item 102's "do not restructure navigation destinations" clause is superseded for this item only, by this separate approval. Item 28 is unaffected.
     - Evidence required:
       - English and German at 320–430 px portrait, at ordinary and 200% root text, with no horizontal overflow contributed by the navigation or the switcher;
       - labels inside their controls under the device-width stress item 113's follow-up introduced (a regression guard, not proof of iOS fit);
       - a fail-first test that an unsaved key survives a Settings → Status → Settings round trip;
       - keyboard and screen-reader semantics for the switcher, including focus on switching.
     - Targeted English and German acceptance on the installed iPhone Home Screen PWA follows implementation. Physical Android verification is separately outstanding, as for most recent items.
     - Placed **first** in the approved execution order: after item 113's follow-up and before item 114.

### Decisions made with the rider before implementation (28 September 2026)

The approved plan revised the backlog text above in the following ways. Each point was put to the rider and decided, not assumed.

- **The Settings tab reopens the last-viewed view.** Within one app session it returns to whichever of Settings or Status was last shown. This is held in memory only, so a reload starts at Settings.
  - Tapping it while Status is showing opens Settings.
  - Tapping it while Settings is already showing does nothing, including to the scroll position.
  - Planning's `Open Settings` always opens Settings, because the notice exists to get a key entered.
- **The switcher is sticky and compact**, directly beneath the sticky primary navigation. This revises the backlog's "non-sticky" wording.
- **An interim scroll rule.** The page starts at the top whenever navigation changes the rendered view: on entry from another tab, on a Settings ↔ Status switch, and when the tab is tapped from Status.
  - It does not start at the top for updates within a view: a disclosure, a preference, a live-query refresh, typing, or a re-tap.
  - No other screen's scroll behaviour changes.
  - Item 125 is to replace this with a restored position for each view. A dated note to that effect was added to item 125 in `backlog.md`.
- **The unfinished key edit survives a Settings ↔ Status switch only.**
  - Leaving for another tab discards it, as before, and it is never persisted.
  - The field is masked again on return.
  - An armed Delete-key confirmation is dismissed by a switch, which is item 118's rule that an open confirmation is never silently set aside.
- **A switcher label that cannot fit stacks the two buttons** rather than breaking a word.
- **English `Settings` must fit inside its own tab at 200 %.** Remaining merely inside the viewport was not accepted.
- **Both views' `h1`s are visually hidden but kept** as the semantic first heading.
  - At ordinary size the top of Settings read `Einstellungen` three times: the tab, the switcher and the heading.
  - The selected switcher button already names the view, and hiding the heading returns about 45px, which the sticky rows need.
  - "Heading visible after a reset" therefore means the view's first visible heading: `Preferences`/`Optionen` on Settings, `System status`/`Systemstatus` on Status.
- **A usability gate instead of a percentage cutoff.** The rider rejected an arbitrary 40 %-of-viewport stop rule in favour of three checks. The layout (A: the switcher inside the sticky header) had to pass all of them at 375×667, 390×844 and 430×932, in both languages, at 100 % and 200 %:
  - **U1:** the first visible heading sits below the sticky rows after a reset.
  - **U2:** the key field's label, the field and the Save row fit together above a stand-in for the portrait keyboard. The stand-in is about 260px at 375×667 and 336px otherwise, and it is a proxy, never device acceptance.
  - **U3:** the Delete-key confirmation's actions end up fully visible.

  A responsive alternative (R) was approved in advance for use if A failed. Two conditions were set that stop the work before any code change:
  - an English whole-word fit that no contained layout could achieve;
  - A and R both failing the gate.

### Stage 0: measured on the unchanged parent, in the pinned container, Chromium and WebKit agreeing

Four tabs were simulated by hiding the Status tab. The switcher was simulated by injecting a row through the DOM and CSSOM. All probes were temporary and never committed.

**Navigation fit.**

- **German, ordinary text:** `Einstellungen` stays on one line with four tabs at every width from 320 to 430px. The one exception is 320px under item 113's 12 % width stress.
- **English, 200 %:** `Settings` still stuck out of its own tab. Unstressed it was out by 3.8px at 320px (3.7px in WebKit); stressed, by 8.6, 3.6 and 1.7px at 320, 360 and 375px.
- **Horizontal padding cannot help.** The overhang is measured against the tab's border box, so removing padding changes nothing.
- **The cause is the global `button { min-width: var(--touch-target-min) }`.** It replaces flexbox's content-based minimum with a flat 44px. Restoring `min-width: auto` on the tabs keeps every English label whole, on one line and inside its own tab, from 320 to 430px, at both text sizes, stressed or not.
  - At ordinary text the tabs stay equal-width.
  - The narrowest tab measured is 55px.
  - German is unaffected, because its `overflow-wrap: anywhere` reduces its minimum to one character.
- **Both halves of item 113's `:lang(de)` rule remain load-bearing.**
  - Without the wrap half, German contributes 23px (at 430px) to 50px (at 320px) of overflow at 200 %.
  - Without the padding half, `Einstellungen` wraps at ordinary text at 320px.

**The switcher never stacks** anywhere from 320 to 430px unstressed, even at 200 %. At 320px German the row simply becomes unequal (182/114px). So R, as first defined (release only when stacked), behaved exactly like A.

**The gate.** U1 and U3 passed everywhere, and everything passed at 390×844 and 430×932. U2 failed at 375×667 with 200 % text:

| 375×667, 200 %, keyboard stand-in 260px | Required (Chromium / WebKit) | Available, A | Available, navigation only |
| --------------------------------------- | ---------------------------- | ------------ | -------------------------- |
| English                                 | 273 / 279px                  | 264px        | 324px                      |
| German                                  | 317 / 323px                  | 233px        | 293px                      |

The German shortfall **predates item 121**: today's five-tab app, with no switcher, fails the same check by 24–30px. At 200 % the key form alone is 317px tall: an 88px label, a 91px field row and a 106px Save row. Work stopped here and the measurements went back to the rider, who chose **"release while typing"**:

- R's structure, with the switcher a sticky sibling beneath the header rather than a row inside it;
- a new trigger: the switcher stops sticking while focus is inside the key form;
- English then passes U2 (324px available), and the German shortfall is recorded as pre-existing and not made worse.

**Other Stage 0 findings.**

- **Focus under the header.** Shift+Tab onto a control 20px beneath the sticky header left it there, obscured, in both engines, because it still counts as in view.
- **Fail-first evidence.** The unsaved key was confirmed lost on the parent after a Settings → Status → Settings round trip.

### Implementation account

**Types** (`src/ui/shared/screenTypes.ts`).

- `Screen` is unchanged, so `"diagnostics"` stays Status's internal key, as item 112 established, and nothing is persisted.
- New derived types: `PrimaryDestination = Exclude<Screen, "diagnostics">` and `SettingsSectionView`.
- Pure helpers: `isSettingsSectionView`, `resolveSettingsTabTarget` and `navCurrentState`.

**Navigation** (`MainNavigation.tsx`, `NavIcon.tsx`).

- Four destinations, and `onNavigate` now takes a destination.
- The Settings tab carries `aria-current="page"` on Settings and `"true"` on Status. The section is current, not the page the tab opens.
- The CSS selected state lists both values explicitly, because a bare `[aria-current]` would also match `"false"`.
- The pulse-line Status glyph is removed.

**App** (`src/App.tsx`).

- One `showScreen` wrapper records the last-viewed view. The primary-nav handler resolves the Settings tab through it.
- **One render slot** holds both views. Because `SettingsSection` stays mounted across a switch, the key draft survives and the switcher's DOM node, and so its focus, survives too. Two slots would remount it, and a negative control proves that.
- `handleNavigate`'s free-roam rule and the immersive shell are untouched.

**`src/ui/settings/SettingsSection.tsx`** (new) owns three things:

- the lifted `useProviderKeyDraft` state (`draftKey`, `isEditing`, `saveError`);
- the top reset, a `useLayoutEffect` keyed on the view alone. It reuses item 95's reassertion loop, extracted unchanged to `src/ui/shared/scrollToTopAndSettle.ts`, and the ride hook's own tests still guard it;
- a ResizeObserver that publishes `--app-header-block-size` and `--settings-switcher-block-size` on the root.

`SettingsScreen` takes an optional `keyDraft` and falls back to its own instance of the same hook. That one documented shim keeps its 57 standalone test renders unchanged. Its reveal clears whichever of the header and switcher reaches lower.

**`src/ui/settings/SettingsStatusSwitcher.tsx`** (new).

- A `<nav>` named "Settings and Status" / "Einstellungen und Status", holding two native buttons.
- The buttons reuse `nav.settings` and `nav.status`, so the tab and the switcher cannot disagree, and `nav.status` is not orphaned.
- `aria-current="page"` marks the view showing. Pressing it does nothing, and it is not disabled.
- Visually it takes Map/Profile's selected treatment (never colour alone), is compact (a 44px minimum, `0.875rem` bold), and is sticky beneath the header at z-index 9.
- `.settings-section:has(form:focus-within)` releases it to `position: static`.
- The fit uses `min-width: auto` with `break-word`, never `anywhere`, which would reduce the minimum to one character and stop the stacking.

### Findings worth carrying forward

1. **A root `scroll-padding-top` is unsafe with sticky chrome, for two measured reasons.**
   - The padding covers the sticky rows themselves. Focusing one of their own controls then counts as out of view, and on a click in Chromium the page scrolled 448px.
   - **WebKit answers a scroll-padding change with a scroll-anchoring adjustment.** The first implementation dropped the switcher's height from the padding while the key field had focus. Pressing Save moved focus out of the field, the padding grew by 61px, and WebKit scrolled the page by exactly −61px between the press and the release.

     The release then landed on the field above, and **the key was never saved**. The existing CSP smoke test caught it, failing 6 of 6 in WebKit. Isolation showed that the padding change, not the switcher's position change, caused the jump, and that `overflow-anchor: none` also removed it. Chromium does not adjust.

   The reservation is now a **constant** `scroll-margin-top` on the view's own content (`.settings-section > .screen *`). The release keys on `form:focus-within`, never on the field's own `:focus`, so moving focus to Save changes nothing mid-press.

2. **A first regression test for the lost save did not discriminate.** It centred the field before pressing Save, and in that position the defect does not occur. It passed against the original rules. Rebuilt on the ordinary flow (fill, then press Save) at 390×844 and 375×667, it fails in WebKit against the original rules and passes against the fix.
3. **Headless WebKit defers animation frames until pointer activity.** The section's arrival reset loop can therefore still be pending when a test scrolls programmatically, and it then re-flattens that scroll at the test's next click. A rider's touch or wheel ends the loop at once, and on a device it settles in about 50ms.

   Tests that scroll after arriving first request a few frames (`settleArrival`). Without that, a Chromium test failed by the same race. The loop itself is unchanged: its abort events are still touch, pointer and wheel, not key presses.

4. **A negative control that runs the reset on every render was not caught by the first e2e test.** A native `<details>` and a no-op tab press re-render nothing. Typing does, because the section owns the draft, so the test now types.
5. **An unrelated unit observation, recorded, not attributed.** `App.test.tsx`'s "returns a resumed (still-idle) route screen to the launcher" failed once in 26 runs of four test files under parallel load on this branch. It passed 0 of 10 failures on the Stage 1 baseline, 12 of 12 in isolation, and was never reproduced again. Its path (import, open a route, back to Ride options) touches nothing this item changed.

### Evidence

**Fail-first.**

- Four `SettingsSection.test.tsx` tests failed for their intended reasons before the draft was wired: the draft came back empty, the Replace form closed, and a save error was lost.
- The Stage 0 probe showed the unsaved key lost on the parent in both engines.

**Negative controls, every one run.** Where a control first failed to discriminate, it is reported and the test that was strengthened is named.

| Control                                                   | Caught by                                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| The draft kept local in `SettingsScreen`                  | 5 unit tests (4 section, 1 App); both e2e round trips                                                            |
| Two App slots instead of one                              | the App round trip; 3 e2e tests (both round trips, focus identity)                                               |
| `key={view}` on the switcher                              | 2 unit focus tests; the e2e focus-identity test                                                                  |
| Status restored to the navigation                         | 3 unit tests; 19 e2e tests                                                                                       |
| The German wrap half removed                              | 4 of 6 widths (320–390px): with `min-width: auto`, the German tab can widen to its whole word at 414 and 430px   |
| The German padding half removed                           | 320px only, as measured                                                                                          |
| The English `min-width: auto` removed                     | 4 tests (320–375px)                                                                                              |
| `overflow-wrap: anywhere` on the switcher                 | 5 German widths                                                                                                  |
| The selection rings removed                               | the non-colour `box-shadow` check                                                                                |
| The top reset removed                                     | 2 unit tests; 2 e2e tests                                                                                        |
| The reset run on every render                             | 1 unit test; the e2e test **did not discriminate at first**, and was strengthened with a typing step (finding 4) |
| The last-viewed view ignored                              | 2 unit tests; the e2e restore test                                                                               |
| The scroll margin removed                                 | 3 tests (Chromium spec, Chromium smoke, WebKit smoke)                                                            |
| A root scroll-padding instead                             | the focus-scrolls-the-page smoke test, both engines                                                              |
| The original rules (field-only release plus padding flip) | the WebKit Save smoke, at both sizes (**after** the rebuild in finding 2); the WebKit CSP smoke                  |
| Released on the field's focus only                        | the release test (focus moving to Reveal)                                                                        |
| No release at all                                         | U2 at 375×667 in both languages; the release test                                                                |

**Verification.**

- `corepack npm run lint`, `corepack npm run typecheck`, `corepack npm test` (**4629/4629 across 200 files**) and `corepack npm run build` are clean.
- The **full Playwright suite ran in the pinned container**: **538/538**, including the `webkit-smoke` project and the new `settingsStatusSwitcher.smoke.spec.ts`.
- `corepack npm run format:check` was run last.
- Local npm is the pinned `11.16.0`. Local Node is `v24.13.0` against `.nvmrc`, and CI is authoritative.

### Limitations, stated plainly

- No installed-iPhone evidence exists yet.
  - The container's fonts do not predict iOS widths, so every stressed run is a regression guard.
  - U2's keyboard is a stand-in.
  - Whether iOS keeps the sticky rows visible with the real keyboard up is exactly what the device check must show.
- **The German key form at 375×667 with 200 % text** is 24–30px taller than the space above the stand-in keyboard, with or without the switcher. This predates item 121, which releases the switcher so as to add nothing. No item is allocated.
- **VoiceOver was not audited**, and it stays deferred, as for item 113.
  - A change of `aria-current` on the focused switcher button is not reliably announced.
  - The new view's heading is the next swipe.
- A connection test still in flight when the rider switches away is lost from view and can be started again on return. This already happens through the primary navigation and was not changed.
- Browser-root text scaling is not iOS Dynamic Type evidence.
- The WebKit coverage is desktop WebKit in a container.
- No physical-Android result is claimed.

### Installed-iPhone acceptance — reported 29 September 2026

**Accepted.** Two reports the same day, on an iPhone 13, installed Home Screen PWA, portrait, version `0.4.44`, build `8027c6a` as reported, together cover every required device check:

- all four German tabs fit and stay tappable, which settles the 25 September `Einstellungen` wrap on the device, and the tabs and switcher passed an English spot check;
- the switcher stays beneath the navigation while scrolling without covering content, and the visible headings make sense without the large title;
- the Settings tab reopens the last-viewed view, and opens Settings when tapped from Status; Planning's `Open Settings`, exercised with no key configured, opens Settings directly;
- each newly selected Settings or Status view starts at the top, and re-tapping the tab on Settings keeps its scroll position;
- an unsaved, non-secret placeholder survives Settings → Status → Settings masked, and is discarded by leaving for another tab;
- with the real keyboard open, the key field and controls stay reachable, Show/Hide and dismissal cause no jump, and **a valid key saves on the first tap** and stays saved — the very press WebKit lost under the first implementation (finding 1);
- the switcher scrolls away while the key form has focus and sticks again after it is left;
- `Schlüssel löschen` reveals its confirmation and actions; the rider cancelled.

This is **broad installed-iPhone portrait product-level acceptance**. It does not re-assert the automated measurements above, and the limitations recorded above describe the item as it stood at implementation. **Not claimed:** confirmed deletion, device-language resolution, 200% text or iOS Dynamic Type, the German key form on an SE-sized screen, VoiceOver, physical Android, and — not separately reported — colour-independent selection and whether a disclosure moves the page. **Glove use was removed** from this item's device checklist at the rider's decision, because it depends on the glove and the touchscreen; ordinary tappability passed.

**One open device finding, kept for follow-up and not attributed to this item.** Tapping the key field zoomed the page in and saving did not restore it; no cause is claimed and none has been investigated. The same session observed that Ride and Plan keep the previous screen's scroll offset while Routes arrives at the top — this item's interim reset covers the Settings section only, and that behaviour is [item 125](../backlog.md#item-125)'s. The full record is in [`../current-status.md`](../current-status.md).

---

<a id="item-123"></a>

## Item 123 — A small touch pan can place a Planning waypoint — done

_Category: Planning interaction_

123. **A small touch pan can place a Planning waypoint — done**
     - Origin: item 113's first installed-iPhone pass, 25 September 2026. A pan on the phone sometimes placed a waypoint.
     - **Promoted on 29 September 2026** to the front of the approved execution order (root [`CLAUDE.md`](../../../CLAUDE.md)), immediately before item 119, by the rider's decision. It was unscheduled until then. The motivation is accidental waypoint placement during touch panning or zooming in Planning.
     - **The rider's preferred design direction — to investigate and implement carefully, not a finished specification and not yet implemented:** touch interaction should place waypoints only through the deliberate crosshair placement control, while a desktop mouse keeps direct map-click placement. The work must settle, with evidence:
       - how the pointer type is decided **per interaction** (for example pointer events' `pointerType`), never by device class or by installed PWA versus browser;
       - hybrid devices: a touch-screen laptop, a tablet with a mouse or trackpad, and pen input;
       - that two-finger pinch-zoom and panning never place a waypoint on touch;
       - the empty-list hint `planning.waypoints.empty` ("No waypoints yet. Tap the map or use the crosshair to add one.") in both catalogues, which would no longer be true for touch.
     - Present fact: Planning places a map-tap waypoint from MapLibre's `click` event (`src/map/mapAdapter.ts`'s `onMapTap`), which MapLibre suppresses once a pointer has moved past its click tolerance. A small attempted pan can therefore still register as a tap.
     - **Investigate on the device before changing anything.** Distinguish touch from mouse by pointer type, never by installed PWA versus browser, and keep useful desktop mouse clicks. The crosshair placement control is unaffected by pan jitter. Removing direct map-tap placement for **touch only** is the rider's preferred direction above; direct placement by desktop mouse stays.
     - Evidence required when it is worked on: a device reproduction first, then a real touch-gesture test (item 94's precedent used real two-finger touch gestures) that fails before any change and passes after it, plus a mouse-click control proving desktop placement is unchanged.

### Decisions made with the rider (29 September 2026)

The approved plan settled the open points of the entry above. Each was put to the rider and decided, not assumed.

- **Pen follows touch.** A pen tap on the map never places, moves or inserts a waypoint. A pen pans by direct contact exactly as a finger does, and on iPad the Pencil also arrives through touch events and the browser's tap slop — the mechanism below.
- **The empty-list hint names only the crosshair**: `No waypoints yet. Use the crosshair to add one.` / `Noch keine Wegpunkte. Nutze das Fadenkreuz, um einen Wegpunkt zu setzen.` A version mentioning mouse clicks was offered and not chosen.
- **No time window.** A first plan would have ignored a mouse click made within one second of a finger lifting. The rider rejected it as contradicting the hybrid-device requirement: a mouse must place on its own interaction, even straight after a touch. The distinction had to come from the measured event sequence, and a missing distinction was to be brought back as a trade-off rather than papered over with a timer. None was needed (Stage 1).
- **The device reproduction the entry asks for is the rider's own report.** No new physical reproduction was performed or is claimed. Reproducing the exact small-pan failure in a browser was **not** made a stop gate: it was enough to demonstrate genuine touch delivery and that a touch tap placed a waypoint on the unchanged build, and to report honestly whatever the pan itself did.

### Stage 1: measured on the unchanged `0.4.45`, in the pinned container

A temporary probe (never committed) recorded, in the capture phase on MapLibre's canvas container, every `pointerdown`, `touchstart`, `touchmove`, compatibility `mousedown`/`mouseup` and `click`, with the click's own constructor and `pointerType`, and counted the waypoint markers. Chromium ran as the `android-chrome` project (Pixel 7) with genuine touch through CDP `Input.dispatchTouchEvent`; WebKit ran as Playwright's Linux WebKit with `hasTouch`, whose `touchscreen.tap` is a real touch through WebKit's own pipeline but which cannot pan or pinch.

| Gesture (0.4.45)                                                                | What reached the map                                                                                                                    | Waypoint placed      |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Touch tap, Chromium                                                             | `pointerdown` (touch), `touchstart`, `touchend`, then compatibility `mousedown`, `mouseup` and a `click` whose `pointerType` is `touch` | yes                  |
| Touch tap, WebKit                                                               | the same sequence, but the **`click` reports `pointerType` `mouse`**                                                                    | yes                  |
| Touch movement of 2–14px, Chromium                                              | five `pointermove`, **no `touchmove`**; the camera did not move; a click                                                                | yes                  |
| Touch movement of 16px or more, Chromium                                        | a `touchmove`; the camera moved; no click                                                                                               | no                   |
| Double-tap zoom                                                                 | zoom +1; one click, from the first tap                                                                                                  | yes, one             |
| Double-tap-and-drag zoom                                                        | zoom +0.63; one click, from the first tap                                                                                               | yes, one             |
| Two-finger pinch, small and large; two-finger tap                               | zoom changed; no click                                                                                                                  | no                   |
| Pen tap (CDP mouse event with `pointerType` `pen`)                              | `pointerdown` (pen) … `click` (pen)                                                                                                     | yes                  |
| Touch tap, then a mouse click at once                                           | the touch sequence, then a new `pointerdown` (mouse) before the second click                                                            | yes, both            |
| Mouse double-click, desktop Chromium, Pixel-7 Chromium with a mouse, and WebKit | two `pointerdown` (mouse) and two clicks, then `dblclick`                                                                               | **two**, and zoom +1 |

Four results decided the design:

- **Genuine touch delivery, and touch placement on the parent, were both demonstrated** in both engines — the only gate this stage had.
- **The click itself cannot be trusted to say what it came from**: WebKit labels a touch-generated click `mouse`. The start of the sequence can: a touch tap begins with a touch `pointerdown` and a `touchstart`, and its compatibility mouse events are not pointer events at all, while a real mouse click always begins with its own mouse `pointerdown` and never has a `touchstart`. That is also what separates a mouse click made immediately after a finger lifts.
- **The small pan that both moves the map and places a waypoint was not reproduced.** Chromium withholds `touchmove` inside its ~15px tap slop, and MapLibre pans from touch events, so a sub-slop movement places a waypoint without moving the camera and a larger one pans without any click. Playwright's WebKit cannot pan by touch. The rider's iPhone observation is consistent with WebKit delivering movement inside its own tap tolerance — an inference, not established here.
- **The mouse double-click places two waypoints and zooms.** This is unchanged by item 123 and is recorded as a separate, visible observation in [`current-status.md`](../current-status.md), not as part of this item.

**The mechanism, read from the installed MapLibre 6.6.0 source.** `map_event.ts` suppresses a click only when it lands at least its 3px click tolerance from the preceding `mousedown`; after touch that is the compatibility `mousedown`, delivered at the same point as the click, so the check never fires. The mouse drag handler calls `suppressClick`; `touch_pan.ts` never does. `tap_zoom.ts` cancels only the **second** tap's `touchend`, so the first tap's click always arrives, and two-finger gestures suppress their click. The entry's "present fact" above — that MapLibre suppresses the click once a pointer has moved past its tolerance — therefore holds for a mouse only; it is left as written and corrected here.

### Implementation account (29 September 2026, `0.4.46`)

- **`src/map/mapTapInput.ts` (new).** `MapTapInput` is `"mouse" | "touch" | "pen" | "unknown"`. `trackMapTapInput(target)` listens passively, in the capture phase, on MapLibre's canvas container — where every listener behind a MapLibre click is bound and where the markers live. A `pointerdown` starts a sequence typed by its `pointerType`; a `touchstart` marks its own sequence `touch` (a pen stays `pen`). `classify(click)` returns that sequence's type, and a click with no new sequence since the last classified one (a programmatic or assistive-technology click) is `unknown`. The click's own `pointerType` may withhold placement (`touch`, `pen`) but never grant it. Classification is idempotent per click event, so several listeners always agree.
- **`src/map/mapAdapter.ts`.** `MapLibreLike.onMapTap`'s listener now receives `(coordinate, input)` — a required parameter, so the compiler listed every test double. The adapter creates one shared tracker lazily on the first `onMapTap` and disposes it in `remove()`. Its doc comment, which claimed MapLibre suppresses a click after any real pointer movement, now states the touch facts above.
- **`src/map/MapView.tsx`.** The hit-test priority is unchanged and applies to **every** input: a touch tap still selects a warning or a climb or descent, in Planning and in Riding. Only the fall-through to Planning's placement callback carries the input.
- **`src/ui/planning/`.** `mapTapPlacesWaypoint(input)` is `input === "mouse"`. `PlanningScreen`'s new `handleMapTap` returns before `handlePlacementAt` for any other input, so a touch, pen or unknown tap appends nothing, records no undo entry, triggers no recalculation, and leaves a pending Move or Insert after pending. The crosshair path is untouched. The event-priority comment gained rule 0 and lost its false claim that panning never reaches the tap handler.
- **Copy.** `planning.waypoints.empty` in both catalogues, as decided; the translator comment now forbids "tap the map".

**Behaviour chosen, per input.**

- **Mouse** — including a trackpad, which reports as a mouse, and a mouse on a touch-capable device — places, moves and inserts directly on the map, as before, even immediately after a touch.
- **Touch** never does; the crosshair control does. Touch still selects warnings and route features, which never changes the draft.
- **Pen** follows touch, by the rider's decision.
- **Keyboard** is unchanged: a focused map canvas produces no click from Enter or Space (asserted in both engines), and the crosshair control works by keyboard.
- **Unknown** fails closed. The crosshair control remains reachable to every input and to assistive technology.

### Findings worth carrying forward

1. **WebKit's touch-generated click says it is a mouse click.** Only the sequence distinguishes it, and a negative control that trusted the click's own `pointerType` was caught by the WebKit touch test **alone** — Chromium's click honestly says `touch`, so a Chromium-only suite would have passed a design that fails on WebKit.
2. **Chromium withholds `touchmove` inside its tap slop**, which makes the reported pan-and-place unreproducible there. The automated sub-slop case is the browser reading a small movement as a tap, which is the part of the mechanism a browser here can show.
3. **Planning keeps the previous screen's scroll offset** (item 125's outstanding behaviour). The first fail-first run was invalid for that reason: after the key was entered in Settings, most gestures, and even a mouse click, missed the map, and re-measuring the map at the top of the page cured it. The specs now scroll to the top and re-measure the map before every gesture, and throw unless it is wholly in view.
4. **CDP pacing is load-sensitive.** In a full parallel run, a double tap sent through a separate CDP session per tap once failed to register as a double tap — consistent with drifting outside MapLibre's 500ms window, though that was not measured. Sending the contacts unpaced was worse: 15 of 40 runs at 36 workers misbehaved, either not recognised or with both taps' clicks delivered. One session paced like a finger then passed 40 of 40 and, in the whole-spec stress, 10 of 10. The double-tap-and-drag case stayed load-dependent — its contacts took 3.6–5.6 seconds under that load, and 9 of 40 runs were not recognised — so it is **not automated**; its first tap is an ordinary touch tap, which is.
5. **One missed WebKit tap on a waypoint-row toggle** — a selected waypoint's `Move` did not arm — was seen once, in a run under a negative-control build that could not have caused it. It did not recur in 144 later stress runs of the crosshair tests across all three projects, and no cause is claimed. Every row tap in the specs is now confirmed by the button's `aria-pressed` before the test continues, so a recurrence would be reported where it happens.

### Evidence

**New tests.** Unit: `mapTapInput.test.ts` (12), plus adapter, MapView and Planning cases for every input kind, including touch and pen still selecting a warning and a route feature. End-to-end: `androidPlanningTouchPlacement.spec.ts` (Pixel 7, genuine CDP touch, 8 tests) and `planningTouchPlacement.smoke.spec.ts` (Chromium and WebKit with `hasTouch`, 5 tests each). Every "places nothing" assertion is paired with a page-side recorder proving that the gesture arrived as touch or pen and whether a click reached the map, so a pass cannot mean "no click happened".

**Fail-first, final spec versions against `0.4.45`: 14 of 18 failed, each for its intended reason.**

- Failed: the touch tap, in all three projects (a waypoint was placed); the sub-slop movement; the double-tap zoom; the pen tap; the combined no-change test (2 waypoints became 4); the crosshair test, in all three projects (a touch tap on the map completed the pending Move); and the new hint, in both languages and both engines.
- Passed, as labelled regression guards: the pan beyond the slop, the pinch and two-finger tap (no click even before the change), and the keyboard path in both engines.

**Negative controls, every one run.**

| Control                                                 | Caught by                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Classify by the click's own `pointerType`               | 7 unit tests; the WebKit touch-tap test (Chromium's does not discriminate — finding 1)              |
| Suppress a mouse click within 1s of touch               | 1 unit test; the mouse-straight-after-touch test in all three projects                              |
| Consume the classification destructively, not per click | 2 unit tests (tracker and adapter)                                                                  |
| Filter non-mouse input in MapView before hit-testing    | 5 MapView tests (touch and pen selecting a warning or feature; forwarding)                          |
| Remove Planning's gate                                  | 9 Planning unit tests; all 10 discriminating e2e tests, with the recorder showing the click arrived |
| Gate on a global `navigator.maxTouchPoints` instead     | every hybrid mouse test in all three projects, and the existing `androidPlanning.spec.ts`           |

**Verification.**

- `npm run lint`, `npm run typecheck`, `npm test` (**4665/4665 across 202 files**) and `npm run build` are clean; `npm run format:check` was run last.
- The **full Playwright suite ran in the pinned container**: **611/611**, including the `webkit-smoke` project.
- Stress, at 36 workers: the Android spec 80/80 (ten repeats), the smoke spec 100/100 in both engines (ten repeats).
- Local npm is the pinned `11.16.0`; local Node is `v24.13.0` against `.nvmrc`'s `24.18.0`, and CI is authoritative.

### Limitations, stated plainly

- **No installed-iPhone evidence exists yet**, and no new physical reproduction was made. iOS's event order is assumed from the Pointer Events contract and from desktop WebKit, which agree. If an iPhone ever sent a mouse-typed `pointerdown` for a touch tap's compatibility click with no `touchstart` in that sequence, a touch tap would still place; the device check is the evidence.
- **The pan that both moves the map and places a waypoint was not reproduced** in any engine here (Stage 1). The change removes it by construction, since no touch click places, but that is reasoning, not a reproduction.
- **WebKit coverage is Playwright's Linux WebKit**: real touch taps, but no touch pan, pinch or double tap.
- **Double-tap-and-drag zoom** was measured in Stage 1 only (finding 4).
- **A touch tap on open map now does nothing visible.** The empty-list hint and the control's own label are the only guidance; no extra feedback was added.
- **An assistive-technology click on the canvas** is `unknown` and places nothing. A screen reader whose activation synthesises mouse-typed pointer events could still place at the canvas point it activates; that was not tested.
- **The mouse double-click** still places two waypoints and zooms — a separate observation, deliberately left unchanged (Stage 1).
- **Hybrid hardware** — a touch-screen laptop, an iPad with a trackpad or Pencil — was not tested physically, and no physical-Android result is claimed.

### Installed-iPhone acceptance — reported 30 September 2026

**Accepted.** On an iPhone 13, installed Home Screen PWA, portrait, version `0.4.46`, build `94a4488`, all four device checks passed:

- the empty-draft hint reads correctly in English and German;
- a tap, a small pan, a pinch, a double-tap zoom and a double-tap-and-drag zoom add no waypoint and no Undo entry, both with an empty draft and with a calculated route;
- the crosshair control's Add, Move and Insert after act on the intended waypoint, and tapping the map while Move or Insert after is pending neither completes it nor changes the control's label;
- tapping a Planning warning, and a recognised climb on the Riding map before the ride, still selects it.

This is **broad installed-iPhone portrait product-level acceptance**. It does not re-assert the automated measurements above; in particular the pan that both moves the map and places a waypoint remains unreproduced in a browser, and the device check is the evidence that touch no longer places. **Not claimed:** VoiceOver, landscape, enlarged text, physical Android, an Apple Pencil, or an external mouse or trackpad. The separate mouse double-click observation is unchanged and recorded in [`current-status.md`](../current-status.md).

---

<a id="item-128"></a>

## Item 128 — The imagery banner covers the Planning crosshair at ordinary text — done

_Category: Planning presentation_

128. **The imagery banner covers the Planning crosshair at ordinary text — done**
     - Origin: item 114's Stage 1 onset sweep, 29 September 2026, measured in the pinned Playwright container in Chromium and WebKit, which agreed. **An automated measurement, not an installed-iPhone observation.**
     - **Placed first in the approved execution order on 30 September 2026** (root [`CLAUDE.md`](../../../CLAUDE.md)), by the rider's decision; it was unscheduled until then. It is a measured crosshair-obscuring problem at ordinary text on smaller phones, and the crosshair matters more since [item 123](#item-123) made touch placement go through the crosshair control. **It is still neither resolved nor accepted, and scheduling approves no fix:** the work begins by reproducing it on the current build and comparing a narrowly scoped correction that respects items 108 and 114 and preserves the placement control and the attribution.
     - **What was measured.** At ordinary 100% text, Planning's in-map imagery banner (`.map-status-overlay` at `top: 72px`, `left/right: 64px`, here the fallback message with its `Retry map imagery` button) overlaps the red placement crosshair ring:
       - **375×667** (map 343×300, ring 142–158px below the map's top): English, a banner 88px tall reaching 160px; German, 105px reaching 177px.
       - **320×844** (map 288×380, ring 182–198px): German, 139px reaching 211px. English (105px, reaching 177px) clears it.
       - **390×844 and 430×932** are clear at 100%; the overlap begins at 110% text (German) and 145% (English) respectively.
     - The banner is `pointer-events: none` apart from its Retry button, so it hides the crosshair without blocking taps on the map beneath it. It appears only when map imagery is unavailable.
     - **Item 114 does not reach it.** Item 114 changed only the enlarged-text layout, which engages from about 106–132% text depending on the size, and deliberately left the ordinary layout unchanged; below that threshold the banner stays in the map.
     - Any change must keep item 108's product decision in view — Planning keeps its imagery explanation in the map at ordinary text, and item 114 made an enlarged-text-only exception — and must be measured at 375×667, 320×844 and 390×844 in both languages against the crosshair, the placement control and the attribution.
     - **Design stage, 30 September 2026:** a measured comparison of eight candidate corrections is in [`../design/planning-imagery-banner/README.md`](../../design/planning-imagery-banner/README.md), against `0.4.49`. It reproduces the recorded overlaps exactly, and adds more: Retry sits on the crosshair point; the tile-error state overlaps too; every measured size overlaps, in at least one language, just below item 114's switch; and Planning's own message collides with the banner. It recommends keeping the imagery message in the map at the top and moving Planning's own three messages below the map, **pending the rider's decision**. Nothing is chosen or implemented, and the contract above is unchanged.

### Decisions made with the rider (1 October 2026)

- **C6**, from the measured design comparison in [`../../design/planning-imagery-banner/`](../../design/planning-imagery-banner/README.md). At ordinary text:
  - Planning's imagery message and Retry stay inside the map, which keeps item 108's decision, but take the top slot;
  - Planning's own three messages — Locate failed, clear the selected warning, clear the selected route feature — move below the map.
- **The execution order** was revised the same day to 128 → 124 → 122 → 103 → 120 (root [`CLAUDE.md`](../../../CLAUDE.md)).
- **The known smallest-screen overlap was accepted knowingly.** At 320×568, the map's 280 px height floor, the German fallback banner still overlaps the crosshair by 15 px. That size was an informative case outside the required matrix. The map size was not changed to hide it, and item 122 carries it forward.
- **Approving C6 is not installed-iPhone acceptance.**

### Implementation account (1 October 2026, `0.4.50`)

- **Outcome.** At ordinary text:
  - the imagery message sits at the top of the Planning map, between the two control clusters, and clears the crosshair in every required case;
  - Retry no longer lands on the crosshair point;
  - Planning's own messages appear below the map.

  Item 114's enlarged layout, thresholds and hysteresis are unchanged.

- **`src/ui/planning/PlanningScreen.tsx`.**
  - The in-map `.planning-map-status-overlay` is gone.
  - `.planning-map-below` now renders at every text size and always holds `mapStatusMessages`. The attribution strip and the imagery portal slot stay enlarged-only, and at ordinary text MapView's imagery portal target stays `null`, as before.
  - Because `mapStatusMessages` keeps its child position, Planning's messages are no longer recreated when the layout switches.
- **`src/index.css`.**
  - A Planning-scoped `.planning-map-container .map-status-overlay { top: var(--space-8) }`. Riding's pre-ride overview keeps the base 72 px.
  - `.planning-map-status-overlay` and the base `.planning-map-status-message` rule are retired; the second was wholly overridden by item 114's below-map rule.
  - Four comments that named the retired class, and the 72 px, below-map and enlarged-layout comments, are rewritten.
- **No change** to:
  - map sizing and its rounding and fallback rules;
  - copy, roles or touch targets;
  - imagery timing and recovery;
  - routing or persistence;
  - item 123's placement rules;
  - MapView.
- **Version** `0.4.49` → `0.4.50`, as literal edits with no dependency change.

### Evidence

**New tests.**

- **`e2e/planningImageryBanner.smoke.spec.ts`:** 21 tests, run in Chromium and `webkit-smoke`.
  - **Ordinary text at 375×667, 320×844, 390×844 and 430×932, English and German.** The fallback banner alone, then Locate failed appearing and clearing, then live text just below item 114's switch. The checks:
    - the imagery box clears the ring;
    - the crosshair point and the imagery text reach the map;
    - Retry is on top and at least 44×112;
    - Planning's message is below the map, in view and unclipped;
    - the empty block is 0 px with the next panel 16 px below the map;
    - the map box, the canvas node, the control and the ring are unchanged as the message comes and goes.
  - **Tile-error and delayed** at 375×667 (English and German) and 320×844 (German).
  - **The selected warning and selected feature** at 375×667 and 320×844, in both languages. The feature is selected for real through the elevation chart's own tap path, which does not depend on where the warning selection framed the map, and its details region and exact catalogue string are asserted.
  - **Live switching** across item 114's engage (17), hysteresis (17.1) and release (17.3) ratios. One overlay, one attribution and one canvas throughout, and the same Planning message node across both switches.
  - **Riding's pre-ride overlay** at 72 px.
- **A `PlanningScreen.test.tsx` case:** all three messages render inside `.planning-map-messages` and outside the map.

**Updated, each keeping its guarantee.**

- **`planningEnlargedTextLayout.spec.ts`'s ordinary signature:**
  - asserts Planning's messages are below the map;
  - asserts there is no in-map status overlay;
  - asserts an empty, 0 px below-map block;
  - measures the 16 px gap through that block.
- **`planningPlacementControlLayering.spec.ts`'s chrome lists** check `.map-status-overlay`, MapView's in-map overlay at z-index 5, in place of the retired class.
- **`planningPlacementLabelFit.spec.ts` and `distanceBadges.spec.ts`** lose a dead selector.
- **`androidMapCameraGestureRace.spec.ts`** has a comment updated.

**Fail-first against `0.4.49`'s own built bundle, served from a saved copy.**

- **34 of the new spec's 42 browser runs fail:**
  - every ordinary-text test, in both engines;
  - tile-error at 375×667 in both languages, and at 320×844 in German;
  - the warning and feature tests;
  - both switching tests.
- **The 8 that pass are labelled guards.**
  - The delayed state already cleared the ring at 100%, since it has no Retry: 6 runs.
  - Riding's 72 px: 2 runs.
- **At 390×844 and 430×932** the parent fails first on the empty-block assertion, because the block did not exist there. Their ring overlap appears just below the switch; control 1 shows it.
- **The other two.** The updated ordinary signature fails on the parent, which has no below-map block. The unit case fails on the in-map overlay's presence.

**Negative controls.** Each was rebuilt, run in Chromium and restored byte-for-byte (`cmp`):

| Control                                                          | Result                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Planning's offset back to 72 px                               | 13 of 18 fail on ring overlap: 375×667 in both languages, 320×844 in German, 390×844 and 430×932 just below the switch, tile-error, and the warning case. The 5 that pass are consistent with the measurements: 320×844 English, and delayed |
| 2. Planning's messages back inside the map (the old JSX and CSS) | 6 of 10 fail. A Planning message at top 8 px covers the imagery text and takes pointer events, so the click-through assertion fails first. The tile-error and delayed tests, which have no Planning message, rightly pass                    |
| 3. The 8 px offset applied without Planning scoping              | Riding's 72 px test fails; the Planning test passes                                                                                                                                                                                          |
| 4. `pointer-events: auto` on `.map-status-overlay`               | 9 of 9 fail on click-through                                                                                                                                                                                                                 |
| 5. `.planning-map-below`'s −16 px margin removed                 | The gap reads 32 px in place of 16: 3 ordinary-signature tests and 2 new tests                                                                                                                                                               |

**The design probe re-run on the implemented build.** `capture.mjs` ran with `ITEM128_CANDIDATES=C0`, meaning no prototype override, into a separate results directory. It covered 216 measured cases, plus 16 transition runs and 12 appear/change/clear sequences, in Chromium and WebKit, which agreed in every case. Ring clearance, in px:

| Size    | Fallback, 100% (EN / DE) | With Locate failed or a warning | Just below the switch | Tile-error  | Load-error **layout proxy** | Delayed     |
| ------- | ------------------------ | ------------------------------- | --------------------- | ----------- | --------------------------- | ----------- |
| 375×667 | +46 / +29                | +46 / +29                       | +23 / +23             | +46 / +23   | +46 / +29                   | +77 / +77   |
| 320×844 | +69 / +35                | +69 / +35                       | +66 / +30             | +69 / +52   | +69 / +52                   | +100 / +83  |
| 390×844 | +86 / +69                | +86 / +69                       | +51 / +28             | +86 / +86   | +86 / +69                   | +117 / +117 |
| 430×932 | +106 / +106              | +106 / +106                     | +62 / +62             | +123 / +106 | +123 / +106                 | +154 / +137 |

- **The informative corners:** 375×812 is +76 (EN) and +59 (DE); 320×568 is +19 (EN) and **−15 (DE)**.
- **Transitions:** 80 steps clean.
- **Appear, change and clear:** 12 sequences, with no frame showing a message over the ring and the imagery message at 8 px throughout.
- **The load-error case is a layout proxy only.** It is the fallback banner with the load-error string, and proves neither the production fatal-error state nor its recovery.
- **Screenshots** of the implemented layout are [`implemented-0.4.50.png`](../../design/planning-imagery-banner/images/implemented-0.4.50.png). They are labelled with their build context, and the design-stage sheets beside them are unchanged.

**Verification.**

- On the pinned Node 24.18.0 and npm 11.16.0, run from a checksum-verified tarball rather than the host's 24.13.0:
  - `npm run lint`, `typecheck` and `build`;
  - `npm test`: **4683/4683**.
- **In the pinned Playwright container, by digest:**
  - the new spec 42/42, and 210/210 at `--repeat-each=5`;
  - the affected existing specs 165/165, in their Chromium, `webkit-smoke` and `android-chrome` projects;
  - `planningEnlargedTextLayout*`, the layering and label-fit specs, `distanceBadges`, `mapImageryRecovery`, `mapImageryCameraFraming`, `planning`, `planningWarningRows`, `planningTouchPlacement.smoke`, and the Android Planning and gesture specs.

### Findings worth carrying forward

1. **An empty `.planning-map-below` adds no space,** as 16 − 16 + 0 + 16. That was measured, and control 5 shows the margin is load-bearing. It corrects item 114's comment, which said an empty block would add a gap.
2. **Planning's messages now keep their node across the enlarged-layout switch,** because they no longer move between two containers. Test 4 proves it.
3. **The elevation chart is the deterministic way to select a route feature in a browser.** A projected map tap depends on how the camera was last framed.
4. **A first-failing assertion is not always the one you expect.** Control 2 and the 390/430 fail-first runs each failed on an earlier assertion than the one named in the plan; both are reported as they ran.

### Limitations, stated plainly

- **The smallest screen.** At 320×568 in German, the 280 px floor, the banner still overlaps the crosshair by 15 px, and Retry sits on its point. It is informative and outside the required matrix, and is carried into item 122.
- **The load-error state** is measured as a layout proxy only.
- **The evidence is automated only:** desktop Chromium and desktop WebKit in the pinned container, whose fonts are not iOS's. Browser-root text scaling is not iOS Larger Text.
  - **No installed-iPhone result yet:** its check is pending in [`current-status.md`](../current-status.md).
  - **No physical-Android result** is claimed.
- **Riding's pre-ride overview keeps 72 px.** It was not re-measured here.
- **The Locate-failed message now appears below the map,** some distance from the Locate me button at the top right. It is in view with the map in view, but the device check is the evidence that it is noticed.

### Deployment (1 October 2026)

**Deployment of `0.4.50` was blocked once by a test defect, recorded here rather than folded in silently.**

- **What failed.** Commit `47f8c40`'s CI run [36852150376](https://github.com/adf-MD/amazing-cycling-navigation/actions/runs/36852150376) failed in E2E shard 2, and Deploy was skipped. The failing test was `androidMapCameraGestureRace.spec.ts`'s "Planning (cached-location-framed, two separated waypoints): small pinch survives a retry whose own remote-style attempt also fails…". It failed in its `attemptFailingRecoveryToFallback` helper, at `expect(banner).not.toBeAttached()`.
- **What the retained trace showed.**
  - The retry's style request was attempted and aborted, and the original fallback banner went.
  - A **replacement** banner from the next fallback generation appeared before the locator assertion observed the absence. The `map-fallback-banner` locator matches that replacement too, so the brief gap was missed.
  - At failure the map was ready, with the post-pinch camera.
- **Not attributed to item 128.** The helper and MapView's recovery code were unchanged by item 128, and the failure is not attributed to C6.
- **The repair.** The helper captures the original banner's element handle before the trigger, and then requires, in order:
  - that node's `isConnected` to become false, which stays observable after the replacement appears;
  - a new failed style request;
  - the replacement visible;
  - `data-map-ready="true"`;
  - the existing camera settle.

  Every caller's camera assertions, gestures, triggers and later genuine recovery are unchanged. The helper's comment no longer claims the unmount is synchronous with the trigger, which the test never established.

- **No local reproduction is claimed.**
  - Shard 2 passed 332/332 at two workers before the repair.
  - After it, the whole spec passed 14/14 at two workers, and its three helper users passed 60/60 at `--repeat-each=20`.
  - An ineffective trigger fails at the new identity check after its 15s bound (`Expected: false`, `Received: true`).
- **A separate failure, out of scope here.** A 36-worker local run of shard 2 also failed item 123's double-tap zoom test once; that test has known load sensitivity.

### Installed-iPhone acceptance — reported 1 October 2026

Accepted on `0.4.50`, build `3ebf4ce`, in English and German: all three device checks passed. The report, and exactly what it does and does not assert, are recorded only in [`current-status.md`](../current-status.md). The limitations above describe the item as it stood at implementation; the 320×568 German overlap among them is unchanged by this acceptance.
