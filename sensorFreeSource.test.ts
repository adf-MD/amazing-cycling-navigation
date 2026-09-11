import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Backlog item 110's "no new sensor subscription" check, automated.
 *
 * The item's approved contract derives the north-up control's arrow from
 * the map camera's own bearing and explicitly does NOT approve compass,
 * device-orientation or heading-sensor tracking — which would be a
 * genuinely new capability, a new permission prompt, and a real battery
 * cost on a phone mounted on a bicycle. Before item 110 this was a manual
 * repository-wide search recorded in the backlog; this is the same check,
 * run by CI.
 *
 * Deliberately narrow: it names the three concrete orientation APIs a
 * compass implementation would actually have to reach for. It is NOT a
 * ban on generic capability plumbing such as `requestPermission`, which
 * could legitimately support an unrelated feature later — a guard that
 * fires on unrelated work gets weakened or deleted, and then guards
 * nothing at all.
 *
 * It is a plain literal-token scan, so it cannot tell a real call from a
 * comment mentioning the API by name. That is a deliberate trade for a
 * guard with no parser to go wrong: source files that need to discuss
 * these APIs hyphenate them instead (see NorthArrowIcon.tsx), and a
 * failure here should be read as "something names this API", not
 * automatically as "something calls it".
 */
const FORBIDDEN_ORIENTATION_APIS = [
  "deviceorientation",
  "DeviceOrientationEvent",
  "AbsoluteOrientationSensor",
] as const;

const SCANNED_ROOTS = ["src", "e2e"] as const;
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".css"] as const;

function collectSourceFiles(directory: string, into: string[]): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(path, into);
    } else if (SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      into.push(path);
    }
  }
  return into;
}

describe("no device-orientation or compass sensor in application source", () => {
  const files = SCANNED_ROOTS.flatMap((root) => collectSourceFiles(root, []));

  // A guard that scans nothing always passes. Prove it found the real
  // tree before trusting anything it reports.
  it("scans the real application and end-to-end source trees", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(join("src", "ui", "shared", "NorthArrowIcon.tsx"));
    expect(files).toContain(join("src", "ui", "riding", "useRideCamera.ts"));
    expect(files).toContain(join("src", "map", "mapAdapter.ts"));
  });

  it.each(FORBIDDEN_ORIENTATION_APIS)("does not reference %s anywhere", (api) => {
    const offenders = files.filter((file) => readFileSync(file, "utf8").includes(api));

    expect(offenders.map((file) => relative(".", file))).toEqual([]);
  });

  // The positive half: the north-up control's orientation really does come
  // from the map camera, so there is nothing a sensor would be needed for.
  it("derives the north arrow from the map camera's own settled bearing", () => {
    const icon = readFileSync(join("src", "ui", "shared", "NorthArrowIcon.tsx"), "utf8");

    expect(icon).toContain("bearingDegrees");
    expect(icon).not.toContain("addEventListener");
    expect(icon).not.toContain("requestAnimationFrame");
    expect(icon).not.toContain("setInterval");
  });
});
