import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildFakeWakeLockSource } from "../../test/fixtures/wakeLockSource.ts";
import { RidingWakeLockControl } from "./RidingWakeLockControl.tsx";

const fixedClock = { now: () => 1_000 };

describe("RidingWakeLockControl", () => {
  it("renders the checkbox unchecked by default and always shows the explanatory sentence", () => {
    const fake = buildFakeWakeLockSource();
    render(
      <RidingWakeLockControl
        desired={false}
        onToggleDesired={vi.fn()}
        wakeLockSource={fake.source}
        clock={fixedClock}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: /keep screen awake/i }),
    ).not.toBeChecked();
    expect(
      screen.getByText(
        "Keeps the display on while Riding mode is visible. This may increase battery use.",
      ),
    ).toBeInTheDocument();
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

    expect(screen.getByRole("checkbox", { name: /keep screen awake/i })).toBeChecked();
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

    await user.click(screen.getByRole("checkbox", { name: /keep screen awake/i }));

    expect(onToggleDesired).toHaveBeenCalledWith(true);
  });

  it("shows 'Screen staying awake.' only once the lock is actually active", async () => {
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

  it("checkbox and retry button are reachable and operable by keyboard", async () => {
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
    expect(screen.getByRole("checkbox", { name: /keep screen awake/i })).toHaveFocus();
    await user.keyboard(" ");
    expect(onToggleDesired).toHaveBeenCalledWith(false);

    await user.tab();
    expect(screen.getByRole("button", { name: /tap to try again/i })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(fake.requestSpy).toHaveBeenCalledTimes(2);
  });
});
