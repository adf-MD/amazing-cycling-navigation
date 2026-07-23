export type GpxErrorReason =
  | "empty-file"
  | "too-large"
  | "unsupported-type"
  | "malformed-xml"
  | "no-track-or-route"
  | "invalid-coordinate"
  | "invalid-elevation";

export class GpxParseError extends Error {
  readonly reason: GpxErrorReason;

  constructor(reason: GpxErrorReason, message: string) {
    super(message);
    this.name = "GpxParseError";
    this.reason = reason;
  }
}
