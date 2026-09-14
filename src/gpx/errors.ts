export type GpxErrorReason =
  | "empty-file"
  | "too-large"
  | "unsupported-type"
  | "malformed-xml"
  | "no-track-or-route"
  | "invalid-coordinate"
  | "invalid-elevation";

/**
 * What actually went wrong, as data rather than as a sentence.
 *
 * Backlog item 113 stage 3. The rider-facing text used to be the only
 * record of the detail — a size limit, the file's own raw coordinate
 * attributes, the offending elevation text were all interpolated into
 * English prose and then unrecoverable. The domain layer now reports what
 * happened and the presentation layer chooses the sentence.
 *
 * `kind` is deliberately finer than `reason`: three throw sites share the
 * reason `no-track-or-route` but two distinct messages, so `reason` alone
 * could never have reconstructed the text. `reason` is kept exactly as it
 * was — it is asserted by the GPX test suites and is the stable
 * classification callers switch on — and is derived from `kind` below.
 */
export type GpxErrorDetail =
  | { readonly kind: "empty-file" }
  | { readonly kind: "too-large"; readonly limitMb: number }
  | { readonly kind: "unsupported-type" }
  | { readonly kind: "malformed-xml" }
  /** A track or route exists, but yielded no usable points. */
  | { readonly kind: "no-usable-points" }
  /** No track and no route element at all. */
  | { readonly kind: "no-track-or-route" }
  | {
      readonly kind: "invalid-coordinate";
      /** The file's own raw attribute text, or null when absent. */
      readonly longitude: string | null;
      readonly latitude: string | null;
    }
  | { readonly kind: "invalid-elevation"; readonly elevation: string };

const REASON_BY_DETAIL_KIND: Readonly<Record<GpxErrorDetail["kind"], GpxErrorReason>> = {
  "empty-file": "empty-file",
  "too-large": "too-large",
  "unsupported-type": "unsupported-type",
  "malformed-xml": "malformed-xml",
  "no-usable-points": "no-track-or-route",
  "no-track-or-route": "no-track-or-route",
  "invalid-coordinate": "invalid-coordinate",
  "invalid-elevation": "invalid-elevation",
};

export class GpxParseError extends Error {
  readonly reason: GpxErrorReason;
  readonly detail: GpxErrorDetail;

  /**
   * `message` remains English and is still what `Error.message` carries:
   * it is what the diagnostics log records and what any caller that has
   * not been moved onto the catalogue still shows. The rider-facing text
   * comes from `detail` instead — see `src/ui/library/gpxMessages.ts`.
   */
  constructor(detail: GpxErrorDetail, message: string) {
    super(message);
    this.name = "GpxParseError";
    this.detail = detail;
    this.reason = REASON_BY_DETAIL_KIND[detail.kind];
  }
}
