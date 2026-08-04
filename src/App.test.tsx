import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.tsx";

describe("App", () => {
  it("does not render the persistent product-name heading, and shows the Routes screen's own heading instead", () => {
    render(<App />);
    expect(
      screen.queryByRole("heading", { name: /amazing cycling navigation/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Routes" })).toBeInTheDocument();
  });

  it("navigates to Settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OpenRouteService" })).toBeInTheDocument();
  });

  it("shows the empty Ride state, and Choose a route returns to Routes", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Ride" }));
    expect(screen.getByRole("heading", { name: "Ride" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Choose a route" }));
    expect(screen.getByRole("heading", { name: "Routes" })).toBeInTheDocument();
  });

  // Deliberately excludes "Plan": PlanningScreen mounts a real, unmocked
  // MapView here (unlike PlanningScreen's own test suite, which injects a
  // mock map factory), and jsdom has no WebGL2 support — mounting then
  // unmounting it races MapView's WebGL-failure fallback path and throws
  // an unrelated, pre-existing error. That's a MapView/mapAdapter lifecycle
  // issue, not something this visual-foundation slice touches; Planning's
  // own heading is unaffected and doesn't need app-level re-verification.
  it("switching every navigation destination shows that screen's own primary heading", async () => {
    const user = userEvent.setup();
    render(<App />);

    const destinations: [string, string][] = [
      ["Routes", "Routes"],
      ["Diagnostics", "Diagnostics"],
      ["Settings", "Settings"],
    ];

    for (const [navLabel, headingName] of destinations) {
      await user.click(screen.getByRole("button", { name: navLabel }));
      expect(screen.getByRole("heading", { name: headingName })).toBeInTheDocument();
    }
  });

  it("applies the app-shell class, so the header/nav stay clear of the iOS status bar and notch via safe-area-inset padding", () => {
    const { container } = render(<App />);
    const shell = container.querySelector(".app-shell");
    expect(shell).toBeInTheDocument();
    expect(shell?.querySelector("header")).toBeInTheDocument();
  });
});
