/**
 * Whether the rider has stayed with an operation while it runs (backlog
 * item 124). A failure may return focus to the operation's control, and
 * reveal it, only while this is still armed: the rider's own decision is
 * that focus and page position are left alone once they have moved
 * elsewhere. Two callers, each arming one guard per attempt:
 *
 * - D-06, Edit copy (RidingScreen.tsx): its area is the Edit copy group —
 *   the button, its hint, its error and its confirmation.
 * - D-01, Clear draft (PlanningScreen.tsx): its area is whichever of the
 *   confirmation and the button's own row is mounted, since the two swap in
 *   place.
 *
 * Armed when an attempt begins, and disarmed by rider input that means
 * they have moved on:
 *
 * - a `pointerdown` outside the area (a tap or click elsewhere, including
 *   on blank space, which would otherwise leave focus on `<body>` and look
 *   like waiting);
 * - any `keydown` except Escape inside the area (Escape there is the
 *   refused attempt to cancel, which is still this interaction; Tab, Space
 *   and the arrow keys move focus or scroll the page);
 * - any `wheel` or `touchmove`, wherever it starts: both scroll the page.
 *
 * `pointerdown` inside the area (a repeated tap on the disabled actions)
 * does not disarm it. The same capture-phase, passive listeners as item 124
 * slice 3's saved-message reveal guard in PlanningScreen.tsx, so nothing the
 * page does with an event can hide it from the guard, and nothing here can
 * delay scrolling.
 *
 * Its owner calls `detach()` once the decision has been made, or the
 * attempt has ended, or the rider has left the screen; a detached guard
 * reads as disarmed.
 */
export interface OperationInteractionGuard {
  readonly armed: boolean;
  detach(): void;
}

const ALWAYS_MOVED_ON = ["wheel", "touchmove"] as const;

export function armOperationInteractionGuard(
  getArea: () => Element | null,
): OperationInteractionGuard {
  let armed = true;
  let attached = true;
  const isInsideArea = (target: EventTarget | null): boolean => {
    const area = getArea();
    return area !== null && target instanceof Node && area.contains(target);
  };
  const disarm = () => {
    armed = false;
  };
  const onPointerDown = (event: Event) => {
    if (!isInsideArea(event.target)) disarm();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && isInsideArea(event.target)) return;
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
