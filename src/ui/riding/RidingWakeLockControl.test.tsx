import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildFakeWakeLockSource } from "../../test/fixtures/wakeLockSource.ts";
import { RidingWakeLockControl } from "./RidingWakeLockControl.tsx";

const fixedClock = { now: () => 1_000 };

describe("RidingWakeLockControl", () => {
  it("renders the checkbox unchecked by default and keeps the explanation hidden until opened", () => {
    const fake = buildFakeWakeLockSource();
    render(
      <RidingWakeLockControl
        desired={false}
        onToggleDesired={vi.fn()}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /keep screen on/i })).not.toBeChecked();
    expect(
      screen.queryByText(
        "Keeps the display on while Riding mode is visible. This may increase battery use.",
      ),
    ).not.toBeInTheDocument();
  });

  it("checked reflects the desired prop", () => {
    const fake = buildFakeWakeLockSource();
    render(
      <RidingWakeLockControl
        desired={true}
        onToggleDesired={vi.fn()}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /keep screen on/i })).toBeChecked();
  });

  it("keeps the checkbox deliberately small, with its enclosing label carrying the real touch target", () => {
    const fake = buildFakeWakeLockSource();
    render(
      <RidingWakeLockControl
        desired={false}
        onToggleDesired={vi.fn()}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /keep screen on/i });
    expect(checkbox).toHaveClass("wake-lock-checkbox");
    expect(checkbox.closest("label")).toHaveClass("wake-lock-label");
  });

  it("clicking the checkbox calls onToggleDesired with the new value", async () => {
    const user = userEvent.setup();
    const fake = buildFakeWakeLockSource();
    const onToggleDesired = vi.fn();
    render(
      <RidingWakeLockControl
        desired={false}
        onToggleDesired={onToggleDesired}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /keep screen on/i }));

    expect(onToggleDesired).toHaveBeenCalledWith(true);
  });

  it("mounts a status announcement once the lock is actually active, visually hidden rather than a visible success line", async () => {
    const fake = buildFakeWakeLockSource();
    render(
      <RidingWakeLockControl
        desired={true}
        onToggleDesired={vi.fn()}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );

    expect(screen.queryByText("Screen staying awake.")).not.toBeInTheDocument();

    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Screen staying awake.");
    expect(status).toHaveClass("visually-hidden");
  });

  it("shows a retry alert on failure, and a successful retry clears it", async () => {
    const user = userEvent.setup();
    const fake = buildFakeWakeLockSource();
    render(
      <RidingWakeLockControl
        desired={true}
        onToggleDesired={vi.fn()}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );

    await act(async () => {
      fake.instances[0]?.rejectRequest(new Error("denied"));
      await Promise.resolve();
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The screen could not be kept awake.");
    const retryButton = screen.getByRole("button", { name: /tap to try again/i });

    await user.click(retryButton);
    await act(async () => {
      fake.instances[1]?.resolveRequest();
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Screen staying awake.");
  });

  it("checkbox, info button and retry button are reachable and operable by keyboard", async () => {
    const user = userEvent.setup();
    const fake = buildFakeWakeLockSource();
    const onToggleDesired = vi.fn();
    render(
      <RidingWakeLockControl
        desired={true}
        onToggleDesired={onToggleDesired}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );

    await act(async () => {
      fake.instances[0]?.rejectRequest(new Error("denied"));
      await Promise.resolve();
    });

    await user.tab();
    expect(screen.getByRole("checkbox", { name: /keep screen on/i })).toHaveFocus();
    await user.keyboard(" ");
    expect(onToggleDesired).toHaveBeenCalledWith(false);

    await user.tab();
    expect(screen.getByRole("button", { name: "About Keep screen on" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: /tap to try again/i })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(fake.requestSpy).toHaveBeenCalledTimes(2);
  });

  describe("information popover", () => {
    function renderControl() {
      const fake = buildFakeWakeLockSource();
      render(
        <RidingWakeLockControl
          desired={false}
          onToggleDesired={vi.fn()}
          wakeLockSource={fake.source}
          clock={fixedClock}
        />,
      );
      return fake;
    }

    it("opens on click, exposing aria-expanded and aria-controls correctly", async () => {
      const user = userEvent.setup();
      renderControl();

      const infoButton = screen.getByRole("button", { name: "About Keep screen on" });
      expect(infoButton).toHaveAttribute("aria-expanded", "false");

      await user.click(infoButton);

      expect(infoButton).toHaveAttribute("aria-expanded", "true");
      const popover = screen.getByRole("note");
      expect(popover).toHaveAttribute("id", infoButton.getAttribute("aria-controls"));
      expect(
        screen.getByText(
          "Keeps the display on while Riding mode is visible. This may increase battery use.",
        ),
      ).toBeInTheDocument();
    });

    it("closes when the info button is clicked again", async () => {
      const user = userEvent.setup();
      renderControl();

      const infoButton = screen.getByRole("button", { name: "About Keep screen on" });
      await user.click(infoButton);
      expect(screen.getByRole("note")).toBeInTheDocument();

      await user.click(infoButton);

      expect(screen.queryByRole("note")).not.toBeInTheDocument();
      expect(infoButton).toHaveAttribute("aria-expanded", "false");
    });

    it("closes via its own Close button and returns focus to the info button", async () => {
      const user = userEvent.setup();
      renderControl();

      const infoButton = screen.getByRole("button", { name: "About Keep screen on" });
      await user.click(infoButton);
      await user.click(screen.getByRole("button", { name: "Close" }));

      expect(screen.queryByRole("note")).not.toBeInTheDocument();
      expect(infoButton).toHaveFocus();
    });

    it("closes on Escape and returns focus to the info button", async () => {
      const user = userEvent.setup();
      renderControl();

      const infoButton = screen.getByRole("button", { name: "About Keep screen on" });
      await user.click(infoButton);

      await user.keyboard("{Escape}");

      expect(screen.queryByRole("note")).not.toBeInTheDocument();
      expect(infoButton).toHaveFocus();
    });

    it("closes on an outside click, but not on a click inside the popover", async () => {
      const user = userEvent.setup();
      renderControl();
      const outsideButton = document.createElement("button");
      outsideButton.textContent = "outside";
      document.body.appendChild(outsideButton);

      const infoButton = screen.getByRole("button", { name: "About Keep screen on" });
      await user.click(infoButton);

      await user.click(screen.getByText(/keeps the display on/i));
      expect(screen.getByRole("note")).toBeInTheDocument();

      await user.click(outsideButton);
      expect(screen.queryByRole("note")).not.toBeInTheDocument();

      outsideButton.remove();
    });

    it("does not toggle the checkbox when opening or interacting with the popover", async () => {
      const user = userEvent.setup();
      const onToggleDesired = vi.fn();
      const fake = buildFakeWakeLockSource();
      render(
        <RidingWakeLockControl
          desired={false}
          onToggleDesired={onToggleDesired}
          wakeLockSource={fake.source}
          clock={fixedClock}
        />,
      );

      await user.click(screen.getByRole("button", { name: "About Keep screen on" }));
      await user.click(screen.getByText(/keeps the display on/i));

      expect(onToggleDesired).not.toHaveBeenCalled();
    });

    it("leaves the checkbox and retry button fully operable while the popover is open", async () => {
      const user = userEvent.setup();
      const onToggleDesired = vi.fn();
      const fake = buildFakeWakeLockSource();
      render(
        <RidingWakeLockControl
          desired={true}
          onToggleDesired={onToggleDesired}
          wakeLockSource={fake.source}
          clock={fixedClock}
        />,
      );

      await act(async () => {
        fake.instances[0]?.rejectRequest(new Error("denied"));
        await Promise.resolve();
      });

      await user.click(screen.getByRole("button", { name: "About Keep screen on" }));

      await user.click(screen.getByRole("checkbox", { name: /keep screen on/i }));
      expect(onToggleDesired).toHaveBeenCalledWith(false);
      expect(screen.getByRole("note")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /tap to try again/i }));
      expect(fake.requestSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("note")).toBeInTheDocument();
    });

    it("cleans up its listeners on unmount without error", async () => {
      const user = userEvent.setup();
      const fake = buildFakeWakeLockSource();
      const { unmount } = render(
        <RidingWakeLockControl
          desired={false}
          onToggleDesired={vi.fn()}
          wakeLockSource={fake.source}
          clock={fixedClock}
        />,
      );

      await user.click(screen.getByRole("button", { name: "About Keep screen on" }));
      expect(() => {
        unmount();
      }).not.toThrow();
    });
  });
});
