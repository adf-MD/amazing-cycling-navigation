import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingRouteCompletionPanel } from "./RidingRouteCompletionPanel.tsx";

describe("RidingRouteCompletionPanel", () => {
  it("shows the status text and both actions", () => {
    render(
      <RidingRouteCompletionPanel
        onFinish={vi.fn()}
        onKeepRiding={vi.fn()}
        isFinishing={false}
        error={null}
        finishButtonRef={createRef<HTMLButtonElement>()}
      />,
    );

    expect(screen.getByText("Route complete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish ride" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep riding" })).toBeInTheDocument();
  });

  it("calls onFinish/onKeepRiding on click", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    const onKeepRiding = vi.fn();

    render(
      <RidingRouteCompletionPanel
        onFinish={onFinish}
        onKeepRiding={onKeepRiding}
        isFinishing={false}
        error={null}
        finishButtonRef={createRef<HTMLButtonElement>()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Finish ride" }));
    expect(onFinish).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Keep riding" }));
    expect(onKeepRiding).toHaveBeenCalledOnce();
  });

  it("isFinishing disables both buttons and swaps the Finish-ride label", () => {
    render(
      <RidingRouteCompletionPanel
        onFinish={vi.fn()}
        onKeepRiding={vi.fn()}
        isFinishing
        error={null}
        finishButtonRef={createRef<HTMLButtonElement>()}
      />,
    );

    const finishButton = screen.getByRole("button", { name: "Finishing ride…" });
    expect(finishButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep riding" })).toBeDisabled();
  });

  it("renders an accessible error message when provided", () => {
    render(
      <RidingRouteCompletionPanel
        onFinish={vi.fn()}
        onKeepRiding={vi.fn()}
        isFinishing={false}
        error="Finish ride could not be completed on this device. Try again."
        finishButtonRef={createRef<HTMLButtonElement>()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Finish ride could not be completed on this device. Try again.",
    );
  });

  it("attaches finishButtonRef to the Finish-ride button", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <RidingRouteCompletionPanel
        onFinish={vi.fn()}
        onKeepRiding={vi.fn()}
        isFinishing={false}
        error={null}
        finishButtonRef={ref}
      />,
    );

    expect(ref.current).toBe(screen.getByRole("button", { name: "Finish ride" }));
  });
});
