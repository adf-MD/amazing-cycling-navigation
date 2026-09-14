import type { GpxErrorDetail } from "../../gpx/errors.ts";
import { GpxParseError } from "../../gpx/errors.ts";
import type { GpxExportErrorDetail } from "../../gpx/exportErrors.ts";
import { GpxExportError } from "../../gpx/exportErrors.ts";
import type { GpxImportNotice } from "../../gpx/parseGpx.ts";
import type { ParameterlessMessageKey, Translator } from "../../i18n/translate.ts";

/**
 * Rider-facing sentences for GPX outcomes, chosen from the typed detail
 * the `gpx` layer now reports.
 *
 * Backlog item 113 stage 3. Previously the domain layer wrote the English
 * sentence and the UI rendered `error.message` opaquely, which meant the
 * interpolated parts — a size limit, the file's own raw coordinate text,
 * a track count — existed only inside that sentence and could not be
 * re-expressed in another language. The domain now reports what happened;
 * this chooses how to say it.
 *
 * Pure, with the translator passed explicitly.
 */

export function describeGpxErrorDetail(
  translator: Translator,
  detail: GpxErrorDetail,
): string {
  switch (detail.kind) {
    case "empty-file":
      return translator.t("gpx.error.emptyFile");
    case "too-large":
      return translator.t("gpx.error.tooLarge", { limitMb: detail.limitMb });
    case "unsupported-type":
      return translator.t("gpx.error.unsupportedType");
    case "malformed-xml":
      return translator.t("gpx.error.malformedXml");
    case "no-usable-points":
      return translator.t("gpx.error.noUsablePoints");
    case "no-track-or-route":
      return translator.t("gpx.error.noTrackOrRoute");
    case "invalid-coordinate": {
      // The file's own attribute text, reproduced exactly — including
      // whatever punctuation it contains, which the message formatter
      // treats as data rather than as placeholder syntax.
      const missing = translator.t("gpx.error.missingAttribute");
      return translator.t("gpx.error.invalidCoordinate", {
        longitude: detail.longitude ?? missing,
        latitude: detail.latitude ?? missing,
      });
    }
    case "invalid-elevation":
      return translator.t("gpx.error.invalidElevation", {
        elevation: detail.elevation,
      });
  }
}

const GPX_EXPORT_ERROR_KEYS: Readonly<
  Record<GpxExportErrorDetail["kind"], ParameterlessMessageKey>
> = {
  "crypto-unavailable": "gpx.error.cryptoUnavailable",
};

export function describeGpxExportErrorDetail(
  translator: Translator,
  detail: GpxExportErrorDetail,
): string {
  // A lookup rather than a switch: with one kind today a switch is
  // provably exhaustive and the compiler rightly calls its only case
  // redundant, while this stays honest and gains a second kind for free.
  return translator.t(GPX_EXPORT_ERROR_KEYS[detail.kind]);
}

export function describeGpxImportNotice(
  translator: Translator,
  notice: GpxImportNotice,
): string {
  switch (notice.kind) {
    case "multiple-tracks-first-used":
      return translator.plural("gpx.notice.multipleTracks", notice.count);
    case "multiple-routes-first-used":
      return translator.plural("gpx.notice.multipleRoutes", notice.count);
    case "acn-extension-rejected":
      return translator.t("gpx.notice.acnExtensionRejected");
    case "acn-planning-extension-rejected":
      return translator.t("gpx.notice.acnPlanningExtensionRejected");
  }
}

/**
 * The rider-facing sentence for anything thrown while importing, with a
 * caller-supplied fallback for a failure that is not a GPX error at all.
 */
export function describeGpxImportFailure(
  translator: Translator,
  error: unknown,
  fallback: string,
): string {
  return error instanceof GpxParseError
    ? describeGpxErrorDetail(translator, error.detail)
    : fallback;
}

export function describeGpxExportFailure(
  translator: Translator,
  error: unknown,
  fallback: string,
): string {
  return error instanceof GpxExportError
    ? describeGpxExportErrorDetail(translator, error.detail)
    : fallback;
}
