import { describe, expect, it } from "vitest";
import {
  describeDeleteConfirmation,
  describeMergeConfirmation,
  describeTagLifecyclePreview,
  describeTagLifecycleSuccess,
} from "./tagLifecycleMessages.ts";

describe("describeTagLifecyclePreview", () => {
  it("states the scope before a new name has been typed", () => {
    expect(
      describeTagLifecyclePreview({
        sourceTag: "Gravel",
        targetTag: null,
        isMerge: false,
        routeCount: 4,
      }),
    ).toBe("Rename “Gravel” on 4 routes.");
  });

  it("names both tags for a plain rename", () => {
    expect(
      describeTagLifecyclePreview({
        sourceTag: "Gravel",
        targetTag: "Trail",
        isMerge: false,
        routeCount: 1,
      }),
    ).toBe("Rename “Gravel” to “Trail” on 1 route.");
  });

  it("signposts a merge before it is submitted", () => {
    expect(
      describeTagLifecyclePreview({
        sourceTag: "Gravel",
        targetTag: "Road",
        isMerge: true,
        routeCount: 6,
      }),
    ).toBe("Merge “Gravel” into “Road” on 6 routes.");
  });
});

describe("describeMergeConfirmation", () => {
  it("names both tags and the affected route count", () => {
    const confirmation = describeMergeConfirmation("Gravel", "Road", 4);
    expect(confirmation.title).toBe("Merge “Gravel” into “Road”?");
    expect(confirmation.message).toContain("4 routes");
    expect(confirmation.message).toContain("“Gravel” will no longer exist");
    expect(confirmation.message).toContain("No route is deleted.");
    expect(confirmation.confirmLabel).toBe("Merge tags");
  });
});

describe("describeDeleteConfirmation", () => {
  it("names the tag, the count, and that the routes survive", () => {
    const confirmation = describeDeleteConfirmation("Gravel", 1);
    expect(confirmation.title).toBe("Delete the tag “Gravel”?");
    expect(confirmation.message).toContain("removed from 1 route.");
    expect(confirmation.message).toContain("routes themselves are not deleted");
    expect(confirmation.confirmLabel).toBe("Delete tag");
  });
});

describe("describeTagLifecycleSuccess", () => {
  it("reports a rename with the repository's own affected-route count", () => {
    expect(
      describeTagLifecycleSuccess(
        { kind: "rename", sourceTag: "Gravel", targetTag: "Trail", merged: false },
        3,
      ),
    ).toBe("Renamed “Gravel” to “Trail” on 3 routes.");
  });

  it("reports a merge distinctly from a rename", () => {
    expect(
      describeTagLifecycleSuccess(
        { kind: "rename", sourceTag: "Gravel", targetTag: "Road", merged: true },
        2,
      ),
    ).toBe("Merged “Gravel” into “Road” on 2 routes.");
  });

  it("reassures that routes survive a delete", () => {
    expect(describeTagLifecycleSuccess({ kind: "delete", sourceTag: "Gravel" }, 1)).toBe(
      "Deleted “Gravel” from 1 route. Those routes are still saved.",
    );
  });

  it("explains a stale source rather than claiming a change", () => {
    expect(
      describeTagLifecycleSuccess(
        { kind: "rename", sourceTag: "Gravel", targetTag: "Trail", merged: false },
        0,
      ),
    ).toBe("“Gravel” is no longer used by any route, so nothing changed.");
    expect(describeTagLifecycleSuccess({ kind: "delete", sourceTag: "Gravel" }, 0)).toBe(
      "“Gravel” is no longer used by any route, so nothing changed.",
    );
  });
});
