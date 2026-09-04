// Backlog item 97: component-level proof of the untrusted-GPX trust notice's
// own presentation/disclosure state machine, in isolation from RidingScreen's
// mount/unmount lifecycle (see RidingScreen.untrustedGpxNotice.test.tsx for
// that boundary proof). Uses this codebase's established fake-timer idiom
// (MapView.test.tsx's item-96 grace-period tests: vi.useFakeTimers() / try /
// act(() => vi.advanceTimersByTime(n)) / finally vi.useRealTimers()) and
// fireEvent rather than userEvent for clicks made while fake timers are
// active — this repo has no precedent combining userEvent with fake timers.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RidingUntrustedGpxNotice } from "./RidingUntrustedGpxNotice.tsx";

const FULL_WARNING_TEXT =
  "No trusted turn information is available for this imported GPX. Follow the route line on the map.";

describe("RidingUntrustedGpxNotice", () => {
  it("shows the exact full warning with a single role=status on mount", () => {
    render(<RidingUntrustedGpxNotice />);
    const statusElements = screen.getAllByRole("status");
    expect(statusElements).toHaveLength(1);
    expect(statusElements[0]).toHaveTextContent(FULL_WARNING_TEXT);
    expect(screen.queryByRole("button", { name: "No turn cues" })).toBeNull();
  });

  it("keeps the full warning 1ms before the ten-second grace elapses", () => {
    vi.useFakeTimers();
    try {
      render(<RidingUntrustedGpxNotice />);
      act(() => {
        vi.advanceTimersByTime(9_999);
      });
      expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "No turn cues" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses to the compact 'No turn cues' button once the full ten seconds elapse", () => {
    vi.useFakeTimers();
    try {
      render(<RidingUntrustedGpxNotice />);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.queryByText(FULL_WARNING_TEXT)).toBeNull();
      const button = screen.getByRole("button", { name: "No turn cues" });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("aria-expanded", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reveals the exact full explanation without a fresh live region when activated, and collapses again on a second activation without unmounting the button", () => {
    vi.useFakeTimers();
    try {
      render(<RidingUntrustedGpxNotice />);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      const button = screen.getByRole("button", { name: "No turn cues" });

      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
      const explanation = screen.getByText(FULL_WARNING_TEXT);
      expect(explanation).not.toHaveAttribute("role");
      expect(screen.queryAllByRole("status")).toHaveLength(0);
      expect(button).toHaveAttribute("aria-controls", explanation.getAttribute("id"));

      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText(FULL_WARNING_TEXT)).toBeNull();
      // The same button element persists across both clicks — focus is
      // never lost, since nothing here ever unmounts the toggle itself.
      expect(screen.getByRole("button", { name: "No turn cues" })).toBe(button);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the explanation open well beyond another ten seconds once expanded, with no re-arming", () => {
    vi.useFakeTimers();
    try {
      render(<RidingUntrustedGpxNotice />);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      fireEvent.click(screen.getByRole("button", { name: "No turn cues" }));
      expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "No turn cues" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the pending timer on unmount so a stale callback cannot affect a later mount", () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    try {
      const { unmount } = render(<RidingUntrustedGpxNotice />);
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      unmount();
      expect(clearTimeoutSpy).toHaveBeenCalled();

      // Advancing time well past the original deadline after unmount must
      // not throw or otherwise leak into a later, unrelated render.
      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      render(<RidingUntrustedGpxNotice />);
      expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "No turn cues" })).toBeNull();
    } finally {
      vi.useRealTimers();
      clearTimeoutSpy.mockRestore();
    }
  });

  it("never uses role=alert", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<RidingUntrustedGpxNotice />);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(container.querySelector('[role="alert"]')).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "No turn cues" }));
      expect(container.querySelector('[role="alert"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
