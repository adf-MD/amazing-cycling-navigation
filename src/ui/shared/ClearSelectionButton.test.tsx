import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClearSelectionButton } from "./ClearSelectionButton.tsx";

describe("ClearSelectionButton", () => {
  it("renders a named, focusable button with the shared class", () => {
    render(<ClearSelectionButton onClick={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Clear selection" });
    expect(button).toHaveClass("clear-selection-button");
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ClearSelectionButton onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
