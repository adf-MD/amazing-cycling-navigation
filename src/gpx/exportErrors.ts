export type GpxExportErrorReason = "crypto-unavailable";

/** Typed detail, mirroring GpxParseError — see that file for the reasoning.
 * A single member today; declared as an interface so adding a second is an
 * ordinary widening rather than a restructure. */
export interface GpxExportErrorDetail {
  readonly kind: "crypto-unavailable";
}

export class GpxExportError extends Error {
  readonly reason: GpxExportErrorReason;
  readonly detail: GpxExportErrorDetail;

  constructor(detail: GpxExportErrorDetail, message: string) {
    super(message);
    this.name = "GpxExportError";
    this.detail = detail;
    this.reason = detail.kind;
  }
}
