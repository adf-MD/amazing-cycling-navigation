import { expect, test, type Page } from "@playwright/test";

// Backlog item 124, decision 4 of 3 October 2026: an unconfirmed ride-screen
// confirmation closes quietly when Start riding, Resume ride or Pause
// succeeds, and never reappears in the context it was not opened in.
//
// "Quietly" is judged against a paired control: the same transition, from
// the same starting state and position, with no confirmation open. A ride
// transition changes the page's layout — the fixed riding shell replaces the
// paused screen, or the reverse — and the browser may clamp or keep the
// scroll position as it does so; whatever it does, it does to both. So the
// assertions compare, and never demand that the transition itself leaves the
// page where it was:
// - [behaviour] no confirmation in the new context; focus ends where the
//   control's did, never on a confirmation's control or on the trigger the
//   confirmation came from; and the transition moves the page exactly as
//   far as the control's did;
// - [implementation] the app made the same scroll calls and the same
//   focus calls as in the control — none extra for a confirmation.
//
// It reads the recorders each spec installs as `window.__acn`: the app's
// own scroll calls, and the focus calls made by script that moved focus.

interface ProbeFixture {
  scrolls: string[];
  focusCalls: { text: string; dialogTitle: string | null }[];
}
type ProbeWindow = Window & { __acn: ProbeFixture };

/** What a ride transition leaves: the page's position, every open
 * confirmation's title, and where focus is. */
export interface TransitionView {
  scrollY: number;
  maxScrollY: number;
  dialogs: string[];
  /** "body", or the focused element's tag and text, with the title of the
   * confirmation it sits in. */
  focus: string;
}

export interface Transition {
  before: TransitionView;
  after: TransitionView;
  /** The app's own scroll calls during the transition. */
  scrolls: string[];
  /** The focus calls made by script during the transition, as "text" or
   * "text in title". */
  focusCalls: string[];
}

export function readTransitionView(page: Page): Promise<TransitionView> {
  return page.evaluate(() => {
    const titleOf = (dialog: Element | null) =>
      dialog?.querySelector("h2, h3, h4")?.textContent.trim() ?? null;
    const scroller = document.scrollingElement ?? document.documentElement;
    const active = document.activeElement;
    let focus = "body";
    if (active !== null && active !== document.body) {
      const title = titleOf(active.closest('[role="dialog"]'));
      focus = `${active.tagName}:${active.textContent.trim().slice(0, 40)}${
        title === null ? "" : ` in "${title}"`
      }`;
    }
    return {
      scrollY: window.scrollY,
      maxScrollY: scroller.scrollHeight - scroller.clientHeight,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map(
        (dialog) => titleOf(dialog) ?? "",
      ),
      focus,
    };
  });
}

/** Clears the recorders, performs `act`, waits for `settled`, and returns
 * the views either side with what the app did in between. */
export async function measureTransition(
  page: Page,
  act: () => Promise<void>,
  settled: () => Promise<void>,
): Promise<Transition> {
  await page.evaluate(() => {
    const fixture = (window as unknown as ProbeWindow).__acn;
    fixture.scrolls = [];
    fixture.focusCalls = [];
  });
  const before = await readTransitionView(page);
  await act();
  await settled();
  const after = await readTransitionView(page);
  const recorded = await page.evaluate(() => {
    const fixture = (window as unknown as ProbeWindow).__acn;
    return {
      scrolls: [...fixture.scrolls],
      focusCalls: fixture.focusCalls.map((call) =>
        call.dialogTitle === null ? call.text : `${call.text} in "${call.dialogTitle}"`,
      ),
    };
  });
  return { before, after, ...recorded };
}

/**
 * Judges a transition made with an unconfirmed confirmation open against
 * the same transition made without one. `confirmationTitle` is the
 * confirmation that was open — or null for a later transition, where the
 * point is that nothing reappears; `notFocused` are the visible texts focus
 * must not land on: Cancel, and the triggers a confirmation comes from.
 */
export function expectQuietTransition(
  label: string,
  control: Transition,
  affected: Transition,
  confirmationTitle: string | null,
  notFocused: readonly string[],
): void {
  test.info().annotations.push({
    type: label,
    description: JSON.stringify({ control, affected }),
  });
  if (confirmationTitle !== null) {
    expect(
      affected.before.dialogs,
      `${label}: the confirmation was open before the transition`,
    ).toContain(confirmationTitle);
  }
  expect(
    control.before.dialogs,
    `${label}: no confirmation was open in the control`,
  ).toEqual([]);
  expect(
    Math.abs(affected.before.scrollY - control.before.scrollY),
    `${label}: the same starting position as the control`,
  ).toBeLessThanOrEqual(1);

  expect
    .soft(affected.after.dialogs, `[behaviour] ${label}: no confirmation after it`)
    .toEqual([]);
  expect
    .soft(
      affected.after.focus,
      `[behaviour] ${label}: focus ends where the control's did`,
    )
    .toBe(control.after.focus);
  const onConfirmationOrTrigger =
    affected.after.focus.includes(' in "') ||
    notFocused.some((text) => affected.after.focus === `BUTTON:${text}`);
  expect
    .soft(
      onConfirmationOrTrigger,
      `[behaviour] ${label}: focus is not on a confirmation or its trigger (${affected.after.focus})`,
    )
    .toBe(false);
  const moved = affected.after.scrollY - affected.before.scrollY;
  const controlMoved = control.after.scrollY - control.before.scrollY;
  expect
    .soft(
      Math.abs(moved - controlMoved),
      `[behaviour] ${label}: the page moved as the control's did (${moved.toFixed(1)} against ${controlMoved.toFixed(1)} px)`,
    )
    .toBeLessThanOrEqual(1);

  expect
    .soft(
      affected.scrolls,
      `[implementation] ${label}: no scroll call beyond the control's`,
    )
    .toEqual(control.scrolls);
  expect
    .soft(
      affected.focusCalls,
      `[implementation] ${label}: no focus call beyond the control's`,
    )
    .toEqual(control.focusCalls);
}
