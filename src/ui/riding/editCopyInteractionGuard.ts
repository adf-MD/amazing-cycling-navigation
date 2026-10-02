/**
 * Whether the rider has stayed with an Edit copy attempt while it runs
 * (backlog item 124, inventory case D-06). A failure may return focus to
 * Edit copy, and reveal it, only while this is still armed: the rider's own
 * decision is that focus and page position are left alone once they have
 * moved elsewhere.
 *
 * Armed when an attempt begins — the Edit copy press, which covers the
 * preliminary draft check as well as the write, or Replace and edit — and
 * disarmed by rider input that means they have moved on:
 *
 * - a `pointerdown` outside the Edit copy group (a tap or click elsewhere,
 *   including on blank space, which would otherwise leave focus on
 *   `<body>` and look like waiting);
 * - any `keydown` except Escape inside the group (Escape there is the
 *   refused attempt to cancel, which is still this interaction; Tab, Space
 *   and the arrow keys move focus or scroll the page);
 * - any `wheel` or `touchmove`, wherever it starts: both scroll the page.
 *
 * `pointerdown` inside the group (a repeated tap on the disabled actions)
 * does not disarm it. The same capture-phase, passive listeners as item 124
 * slice 3's saved-message reveal guard in PlanningScreen.tsx, so nothing the
 * page does with an event can hide it from the guard, and nothing here can
 * delay scrolling.
 *
 * Its owner calls `detach()` once the decision has been made, or the
 * attempt has ended, or the rider has left the screen; a detached guard
 * reads as disarmed.
 */
export interface EditCopyInteractionGuard {
  readonly armed: boolean;
  detach(): void;
}

const ALWAYS_MOVED_ON = ["wheel", "touchmove"] as const;

export function armEditCopyInteractionGuard(
  getGroup: () => Element | null,
): EditCopyInteractionGuard {
  let armed = true;
  let attached = true;
  const isInsideGroup = (target: EventTarget | null): boolean => {
    const group = getGroup();
    return group !== null && target instanceof Node && group.contains(target);
  };
  const disarm = () => {
    armed = false;
  };
  const onPointerDown = (event: Event) => {
    if (!isInsideGroup(event.target)) disarm();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && isInsideGroup(event.target)) return;
    disarm();
  };

  const options = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", onPointerDown, options);
  window.addEventListener("keydown", onKeyDown, options);
  for (const type of ALWAYS_MOVED_ON) window.addEventListener(type, disarm, options);

  return {
    get armed() {
      return armed;
    },
    detach() {
      armed = false;
      if (!attached) return;
      attached = false;
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      for (const type of ALWAYS_MOVED_ON) {
        window.removeEventListener(type, disarm, { capture: true });
      }
    },
  };
}
