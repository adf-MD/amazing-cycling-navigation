import { useTranslate } from "../../i18n/useTranslate.ts";

/**
 * The untrusted-GPX-import trust notice (backlog item 97), shown throughout
 * an active ride on a route with no trusted manoeuvre metadata and
 * source.kind === "gpx-import" (see domain/manoeuvreTrust.ts's
 * hasTrustedManoeuvres — the caller decides trust and gpx-import-ness; this
 * component is presentational only).
 *
 * Item 145 (approved by the rider on 15 October 2026) replaced item 97's
 * ten-second full paragraph, compact "No turn cues" button and expandable
 * explanation with this one concise, non-interactive status: "No turn
 * guidance available." / "Keine Abbiegehinweise verfügbar.". It is shown
 * from the start of the ride episode and keeps the same element and text
 * for as long as it is relevant: there is no timer, no state and nothing to
 * expand.
 *
 * RidingScreen renders it once per ride episode (while
 * nav.geolocationStatus !== "idle"), outside the Map-only
 * .ride-content-area toggle, so a Map<->Profile switch or a GPS update
 * never remounts it or changes its text. Whether a screen reader announces
 * the status once, as intended, is unverified on the device (VoiceOver).
 */
export function RidingUntrustedGpxNotice() {
  const { t } = useTranslate();
  return (
    <p role="status" className="status-row">
      {t("riding.untrustedGpx")}
    </p>
  );
}
