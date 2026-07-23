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
});
