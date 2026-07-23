import { GpxParseError } from "./errors.ts";
import { MAX_GPX_FILE_SIZE_BYTES } from "./constants.ts";

export function validateGpxFile(file: File): void {
  if (file.size === 0) {
    throw new GpxParseError("empty-file", "The selected file is empty.");
  }
  if (file.size > MAX_GPX_FILE_SIZE_BYTES) {
    const limitMb = MAX_GPX_FILE_SIZE_BYTES / (1024 * 1024);
    throw new GpxParseError(
      "too-large",
      `The selected file is larger than the ${String(limitMb)} MB limit.`,
    );
  }
  if (!file.name.toLowerCase().endsWith(".gpx")) {
    throw new GpxParseError("unsupported-type", "Only .gpx files are supported.");
  }
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}
