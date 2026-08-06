import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Screen } from "./MainNavigation.tsx";
import { useResetScrollForNewRideContent } from "./useResetScrollForNewRideContent.ts";

function installScrollToSpy() {
  window.scrollY = 0;
  return vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
    const [a, b] = args;
    if (typeof a === "object" && a !== null && "top" in a) {
      const top = (a as ScrollToOptions).top;
      if (typeof top === "number") window.scrollY = top;
    } else if (typeof b === "number") {
      window.scrollY = b;
    }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useResetScrollForNewRideContent", () => {
  it("never scrolls while screen is not riding, even after a bump", () => {
    const spy = installScrollToSpy();
    const { result } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      {
        initialProps: { screen: "library" },
      },
    );

    act(() => {
      result.current();
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("scrolls to the top exactly once when a bump is followed by screen becoming riding", () => {
    const spy = installScrollToSpy();
    const { result, rerender } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      { initialProps: { screen: "library" } },
    );

    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });
  });

  it("does not re-fire on a plain screen bounce back to riding without a new bump — mirrors a nav-tab return to an already-open ride", () => {
    const spy = installScrollToSpy();
    const { result, rerender } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      { initialProps: { screen: "library" } },
    );

    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });
    expect(spy).toHaveBeenCalledTimes(1);

    rerender({ screen: "diagnostics" });
    rerender({ screen: "riding" });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("fires again on a second bump — the mechanism handleRouteSaved shares with handleOpenRoute", () => {
    const spy = installScrollToSpy();
    const { result, rerender } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      { initialProps: { screen: "library" } },
    );

    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });
    expect(spy).toHaveBeenCalledTimes(1);

    rerender({ screen: "library" });
    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
