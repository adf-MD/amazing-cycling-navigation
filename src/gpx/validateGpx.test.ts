import { describe, expect, it } from "vitest";
import { GpxParseError } from "./errors.ts";
import { isValidLatitude, isValidLongitude, validateGpxFile } from "./validateGpx.ts";
import { MAX_GPX_FILE_SIZE_BYTES } from "./constants.ts";

function buildFile(name: string, sizeBytes: number): File {
  const bytes = sizeBytes > 0 ? new Uint8Array(sizeBytes) : new Uint8Array(0);
  return new File([bytes], name, { type: "application/gpx+xml" });
}

describe("validateGpxFile", () => {
  it("accepts a well-formed .gpx file within the size limit", () => {
    expect(() => {
      validateGpxFile(buildFile("ride.gpx", 1024));
    }).not.toThrow();
  });

  it("rejects an empty file", () => {
    expect(() => {
      validateGpxFile(buildFile("ride.gpx", 0));
    }).toThrow(GpxParseError);
    try {
      validateGpxFile(buildFile("ride.gpx", 0));
    } catch (error) {
      expect((error as GpxParseError).reason).toBe("empty-file");
    }
  });

  it("rejects a file over the size limit", () => {
    expect(() => {
      validateGpxFile(buildFile("ride.gpx", MAX_GPX_FILE_SIZE_BYTES + 1));
    }).toThrow(GpxParseError);
    try {
      validateGpxFile(buildFile("ride.gpx", MAX_GPX_FILE_SIZE_BYTES + 1));
    } catch (error) {
      expect((error as GpxParseError).reason).toBe("too-large");
    }
  });

  it("rejects a non-.gpx extension", () => {
    expect(() => {
      validateGpxFile(buildFile("ride.txt", 1024));
    }).toThrow(GpxParseError);
    try {
      validateGpxFile(buildFile("ride.txt", 1024));
    } catch (error) {
      expect((error as GpxParseError).reason).toBe("unsupported-type");
    }
  });
});

describe("isValidLongitude", () => {
  it.each([
    [-180, true],
    [180, true],
    [0, true],
    [-180.001, false],
    [180.001, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ])("longitude %p -> %p", (value, expected) => {
    expect(isValidLongitude(value)).toBe(expected);
  });
});

describe("isValidLatitude", () => {
  it.each([
    [-90, true],
    [90, true],
    [0, true],
    [-90.001, false],
    [90.001, false],
    [Number.NaN, false],
    [Number.NEGATIVE_INFINITY, false],
  ])("latitude %p -> %p", (value, expected) => {
    expect(isValidLatitude(value)).toBe(expected);
  });
});

/** Runs `act` and returns the GpxParseError it threw, failing otherwise. */
function captureParseError(act: () => void): GpxParseError {
  let captured: unknown;
  try {
    act();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(GpxParseError);
  return captured as GpxParseError;
}

describe("typed error detail (backlog item 113 stage 3)", () => {
  it("reports the real size limit as data, not only inside the sentence", () => {
    // The describer's own test builds a detail by hand, so it cannot
    // notice a producer that supplies the wrong number. This closes that
    // gap at the source: the limit must be the module's actual constant.
    const oversized = new File([new Uint8Array(MAX_GPX_FILE_SIZE_BYTES + 1)], "big.gpx");
    const error = captureParseError(() => {
      validateGpxFile(oversized);
    });
    expect(error.detail.kind).toBe("too-large");
    if (error.detail.kind !== "too-large") return;
    expect(error.detail.limitMb).toBe(MAX_GPX_FILE_SIZE_BYTES / (1024 * 1024));
    expect(error.detail.limitMb).toBeGreaterThan(0);
  });

  it("carries a typed detail for every other validation outcome", () => {
    const cases: readonly (readonly [File, string])[] = [
      [new File([], "empty.gpx"), "empty-file"],
      [new File(["<gpx/>"], "notes.txt"), "unsupported-type"],
    ];
    for (const [file, expectedKind] of cases) {
      const error = captureParseError(() => {
        validateGpxFile(file);
      });
      expect(error.detail.kind).toBe(expectedKind);
    }
  });
});
