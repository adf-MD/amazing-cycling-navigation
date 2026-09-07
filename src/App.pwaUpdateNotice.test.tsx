import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PwaUpdateState } from "./pwa/registerSW.ts";

// vi.mock factories are hoisted above imports, so a plain top-level const
// referenced inside one would be used before its own initialisation — the
// mock functions must be created through vi.hoisted instead.
const { mockUsePwaUpdate } = vi.hoisted(() => ({
  mockUsePwaUpdate: vi.fn(),
}));

vi.mock("./pwa/registerSW.ts", () => ({
  usePwaUpdate: mockUsePwaUpdate,
}));

// Imported only after the mock above is registered, matching this
// repository's other module-mocked App-level test files.
const { default: App } = await import("./App.tsx");

describe("App PWA update notice", () => {
  it("never renders the retired offline-ready notice, even when the underlying state still reports it", () => {
    const updateNow = vi.fn();
    const dismiss = vi.fn();
    // The mocked return value deliberately includes an offlineReady field
    // the narrowed PwaUpdateState no longer declares (a plain vi.mock
    // factory object literal isn't excess-property-checked against the
    // real module's type) — this keeps the assertion below fail-first: it
    // genuinely failed against the unmodified App.tsx, which still read
    // offlineReady and rendered the notice from it.
    mockUsePwaUpdate.mockReturnValue({
      needRefresh: false,
      updateNow,
      dismiss,
      offlineReady: true,
    } satisfies PwaUpdateState & { offlineReady: boolean });

    render(<App />);

    expect(screen.queryByText("Ready to work offline.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("still renders the deferred update-ready notice and its actions", async () => {
    const user = userEvent.setup();
    const updateNow = vi.fn();
    const dismiss = vi.fn();
    mockUsePwaUpdate.mockReturnValue({
      needRefresh: true,
      updateNow,
      dismiss,
    } satisfies PwaUpdateState);

    render(<App />);

    expect(screen.getByText("An update is ready.")).toBeInTheDocument();
    const updateButton = screen.getByRole("button", { name: "Update now" });
    const laterButton = screen.getByRole("button", { name: "Later" });

    await user.click(updateButton);
    expect(updateNow).toHaveBeenCalledTimes(1);

    await user.click(laterButton);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
