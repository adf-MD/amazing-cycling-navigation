import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteLibrary } from "./RouteLibrary.tsx";
import { db } from "../../storage/db.ts";
import { multiTrackGpx, trackWithElevationGpx } from "../../test/fixtures/gpx.ts";

function buildGpxFile(name: string, content: string): File {
  return new File([content], name, { type: "application/gpx+xml" });
}

async function importFixture(
  user: ReturnType<typeof userEvent.setup>,
  name = "Evening Ride.gpx",
) {
  const file = buildGpxFile(name, trackWithElevationGpx);
  await user.upload(screen.getByLabelText("Import GPX file"), file);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Evening Ride" })).toBeInTheDocument();
  });
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

describe("RouteLibrary", () => {
  it("shows an empty state before any route is imported", async () => {
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/no routes saved yet/i)).toBeInTheDocument();
    });
  });

  it("imports a GPX file and lists it with its distance", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await waitFor(() => screen.getByText(/no routes saved yet/i));

    await importFixture(user);

    expect(screen.getByText(/km/)).toBeInTheDocument();
  });

  it("surfaces a notice when a multi-track file only imports the first track", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await waitFor(() => screen.getByText(/no routes saved yet/i));

    const file = buildGpxFile("multi.gpx", multiTrackGpx);
    await user.upload(screen.getByLabelText("Import GPX file"), file);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/2 tracks/);
    });
  });

  it("shows an explicit error for an invalid file without adding a route", async () => {
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await waitFor(() => screen.getByText(/no routes saved yet/i));

    // The input's accept=".gpx" is only a picker hint (userEvent.upload
    // itself enforces it, so it can't be used to reach this path) — this
    // exercises the app's own validateGpxFile defence-in-depth for a file
    // that reaches the change handler despite that hint, e.g. a renamed
    // extension.
    const file = buildGpxFile("notes.txt", trackWithElevationGpx);
    const input = screen.getByLabelText("Import GPX file");
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/no routes saved yet/i)).toBeInTheDocument();
  });

  it("renames a route through the list item", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user);

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Route name");
    await user.clear(input);
    await user.type(input, "Renamed loop");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Renamed loop" })).toBeInTheDocument();
    });
  });

  it("opens a route when its name is clicked", async () => {
    const user = userEvent.setup();
    const onOpenRoute = vi.fn();
    render(<RouteLibrary onOpenRoute={onOpenRoute} />);
    await importFixture(user);

    await user.click(screen.getByRole("button", { name: "Evening Ride" }));

    expect(onOpenRoute).toHaveBeenCalledOnce();
    const [openedRoute] = onOpenRoute.mock.calls[0] as [{ name: string }];
    expect(openedRoute.name).toBe("Evening Ride");
  });

  it("exports a route by triggering a file download", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user);

    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(clickSpy).toHaveBeenCalledOnce();

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("deletes a route only after confirmation", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Evening Ride" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(screen.getByText(/no routes saved yet/i)).toBeInTheDocument();
    });
  });
});
