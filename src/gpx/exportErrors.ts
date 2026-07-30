export type GpxExportErrorReason = "crypto-unavailable";

export class GpxExportError extends Error {
  readonly reason: GpxExportErrorReason;

  constructor(reason: GpxExportErrorReason, message: string) {
    super(message);
    this.name = "GpxExportError";
    this.reason = reason;
  }
}
