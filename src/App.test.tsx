import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App.tsx";

describe("App", () => {
  it("renders the app heading", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: /amazing cycling navigation/i }),
    ).toBeInTheDocument();
  });

  it("applies the app-shell class, so the header/nav stay clear of the iOS status bar and notch via safe-area-inset padding", () => {
    const { container } = render(<App />);
    const shell = container.querySelector(".app-shell");
    expect(shell).toBeInTheDocument();
    expect(shell?.querySelector("header")).toBeInTheDocument();
  });
});
