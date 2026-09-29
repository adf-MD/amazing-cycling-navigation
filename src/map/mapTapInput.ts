/**
 * How the interaction behind one map click began (backlog item 123). It is
 * decided per click, from the pointer sequence that produced that click —
 * never from the device, the user agent, a "has touch" capability, or
 * whether the app is installed — so a mouse on a touch-screen laptop or a
 * tablet still reports "mouse" for its own clicks.
 *
 * Why the sequence and not the click itself: a touch tap ends in
 * compatibility mouse events (mousedown, mouseup, click) that are not
 * pointer events at all, and measured on Playwright's WebKit the click
 * that follows a genuine touch tap reports its own `pointerType` as
 * "mouse". What does reliably tell the two apart is the start of the
 * sequence: a touch tap begins with a `pointerdown` of type "touch" plus a
 * `touchstart`, while a real mouse click always begins with its own
 * `pointerdown` of type "mouse" and never has a `touchstart`. So a mouse
 * click made immediately after a finger lifts is still "mouse".
 */
export type MapTapInput = "mouse" | "touch" | "pen" | "unknown";

export function mapTapInputFromPointerType(pointerType: unknown): MapTapInput {
  return pointerType === "mouse" || pointerType === "touch" || pointerType === "pen"
    ? pointerType
    : "unknown";
}

export interface MapTapInputTracker {
  /** Classifies one DOM click. Idempotent per click event, so any number
   * of listeners asking about the same click get the same answer; a click
   * with no new pointer sequence since the last classified click (a
   * programmatic or assistive-technology click) is "unknown". */
  classify(click: Event): MapTapInput;
  dispose(): void;
}

function readPointerType(event: Event): unknown {
  return "pointerType" in event ? event.pointerType : undefined;
}

/** Watches `target` — MapLibre's canvas container, where every listener
 * behind a MapLibre click is bound — in the capture phase, so each
 * sequence is seen before MapLibre's own handlers run. */
export function trackMapTapInput(target: EventTarget): MapTapInputTracker {
  let sequence: MapTapInput | null = null;
  const classified = new WeakMap<Event, MapTapInput>();

  const onPointerDown = (event: Event) => {
    sequence = mapTapInputFromPointerType(readPointerType(event));
  };
  // A touchstart only ever comes from a contact on the screen, so it marks
  // its own sequence as touch even if that sequence's pointerdown was
  // missing or mislabelled. A pen keeps "pen" (iOS reports an Apple Pencil
  // through touch events as well).
  const onTouchStart = () => {
    sequence = sequence === "pen" ? "pen" : "touch";
  };

  const options = { capture: true, passive: true } as const;
  target.addEventListener("pointerdown", onPointerDown, options);
  target.addEventListener("touchstart", onTouchStart, options);

  return {
    classify(click) {
      const known = classified.get(click);
      if (known !== undefined) return known;
      let input = sequence ?? "unknown";
      sequence = null;
      // The click's own pointerType may only ever withhold placement,
      // never grant it (see above: WebKit's touch-generated click says
      // "mouse").
      const own = mapTapInputFromPointerType(readPointerType(click));
      if (own === "touch" || own === "pen") input = own;
      classified.set(click, input);
      return input;
    },
    dispose() {
      target.removeEventListener("pointerdown", onPointerDown, options);
      target.removeEventListener("touchstart", onTouchStart, options);
    },
  };
}
