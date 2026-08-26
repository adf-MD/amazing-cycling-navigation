import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildFakeWakeLockSource } from "../../test/fixtures/wakeLockSource.ts";
import { RidingWakeLockControl } from "./RidingWakeLockControl.tsx";

const fixedClock = { now: () => 1_000 };

describe("RidingWakeLockControl", () => {
  it("resolves an accessible name of exactly Screen on, with aria-pressed reflecting desired", () => {
    const fake = buildFakeWakeLockSource();
    render(
      <RidingWakeLockControl
        desired={false}
        onToggleDesired={vi.fn()}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Screen on" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("aria-pressed is true when desired is true", () => {
    const fake = buildFakeWakeLockSource();
    render(
      <RidingWakeLockControl
        desired={true}
        onToggleDesired={vi.fn()}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );

    expect(screen.getByRole("button", { name: "Screen on" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows a visible, non-colour On/Off state hidden from assistive tech", () => {
    const fake = buildFakeWakeLockSource();
    const { rerender } = render(
      <RidingWakeLockControl
        desired={false}
        onToggleDesired={vi.fn()}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );

    const offState = screen.getByText("Off");
    expect(offState).toHaveAttribute("aria-hidden", "true");

    rerender(
      <RidingWakeLockControl
        desired={true}
        onToggleDesired={vi.fn()}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );

    const onState = screen.getByText("On");
    expect(onState).toHaveAttribute("aria-hidden", "true");
    // The accessible name still resolves to exactly "Screen on" — the
    // aria-hidden state text is excluded from accname computation.
    expect(screen.getByRole("button", { name: "Screen on" })).toBeInTheDocument();
  });

  it("clicking the toggle calls onToggleDesired with the flipped value exactly once", async () => {
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

    await user.click(screen.getByRole("button", { name: "Screen on" }));

    expect(onToggleDesired).toHaveBeenCalledTimes(1);
    expect(onToggleDesired).toHaveBeenCalledWith(true);
  });

  it("is keyboard operable: Tab focuses it, Enter/Space activates it", async () => {
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

    await user.tab();
    expect(screen.getByRole("button", { name: "Screen on" })).toHaveFocus();

    await user.keyboard(" ");
    expect(onToggleDesired).toHaveBeenCalledWith(true);

    await user.keyboard("{Enter}");
    expect(onToggleDesired).toHaveBeenCalledTimes(2);
    expect(onToggleDesired).toHaveBeenLastCalledWith(true);
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

  it("shows a retry alert on failure, and a successful retry clears it, without flipping desired off", async () => {
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
    // Desired-on stays semantically on through the failure — the toggle
    // never derives its pressed state from the transient status.
    expect(screen.getByRole("button", { name: "Screen on" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const retryButton = screen.getByRole("button", { name: /tap to try again/i });
    await user.click(retryButton);
    await act(async () => {
      fake.instances[1]?.resolveRequest();
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Screen staying awake.");
  });
});
