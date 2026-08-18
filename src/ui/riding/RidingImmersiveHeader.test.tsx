import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingImmersiveHeader } from "./RidingImmersiveHeader.tsx";

describe("RidingImmersiveHeader", () => {
  it("renders Pause, the title, and the End-action slot", () => {
    render(
      <RidingImmersiveHeader
        title="Evening loop"
        pauseLabel="Pause"
        onPause={() => undefined}
        pauseDisabled={false}
        endAction={<button type="button">End ride</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Evening loop" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
  });

  it("calls onPause when Pause is clicked", async () => {
    const onPause = vi.fn();
    const user = userEvent.setup();
    render(
      <RidingImmersiveHeader
        title="Evening loop"
        pauseLabel="Pause"
        onPause={onPause}
        pauseDisabled={false}
        endAction={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(onPause).toHaveBeenCalledOnce();
  });

  it("disables Pause and shows a pending label while pauseDisabled/pauseLabel reflect an in-flight pause", () => {
    render(
      <RidingImmersiveHeader
        title="Evening loop"
        pauseLabel="Pausing…"
        onPause={() => undefined}
        pauseDisabled={true}
        endAction={null}
      />,
    );

    const pauseButton = screen.getByRole("button", { name: "Pausing…" });
    expect(pauseButton).toBeDisabled();
  });

  it("keeps the full title as the accessible name even though it is visually truncated", () => {
    const longTitle =
      "A genuinely very long route name that would overflow a compact single-line header bar";
    render(
      <RidingImmersiveHeader
        title={longTitle}
        pauseLabel="Pause"
        onPause={() => undefined}
        pauseDisabled={false}
        endAction={null}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(longTitle);
    expect(heading).toHaveAttribute("title", longTitle);
    expect(heading).toHaveClass("riding-immersive-header-title");
  });

  it("renders whatever arbitrary content is passed as the End-action slot", () => {
    render(
      <RidingImmersiveHeader
        title="Evening loop"
        pauseLabel="Pause"
        onPause={() => undefined}
        pauseDisabled={false}
        endAction={<p role="alert">Something went wrong</p>}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("renders exactly one h1 regardless of state", () => {
    render(
      <RidingImmersiveHeader
        title="Free roam"
        pauseLabel="Pause"
        onPause={() => undefined}
        pauseDisabled={false}
        endAction={null}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("forwards pauseButtonRef to the Pause button element", () => {
    let buttonElement: HTMLButtonElement | null = null;
    render(
      <RidingImmersiveHeader
        title="Evening loop"
        pauseLabel="Pause"
        onPause={() => undefined}
        pauseDisabled={false}
        pauseButtonRef={(node) => {
          buttonElement = node;
        }}
        endAction={null}
      />,
    );

    expect(buttonElement).not.toBeNull();
    expect(buttonElement).toBe(screen.getByRole("button", { name: "Pause" }));
  });
});
