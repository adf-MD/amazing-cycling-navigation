import type { Translator } from "../i18n/translate.ts";
import type { RoutingError, RoutingErrorReason } from "./openRouteServiceErrors.ts";
import type { ProviderKeyOutcome } from "../storage/db.ts";

/**
 * Shared, provider-independent presentation logic for a RoutingError:
 * the user-facing message (describeRoutingError) and the coarse key-
 * verification outcome it implies (mapErrorReasonToOutcome). Lives in the
 * routing layer, not a React hook, so both usePlanningRoute.ts (Planning's
 * live recalculation) and routingConnectionTest.ts (the deliberate
 * Diagnostics connection test) can share one definition rather than two
 * independently-maintained copies. Only imports RoutingError/
 * RoutingErrorReason plus the ProviderKeyOutcome *type* (no runtime
 * storage/ dependency) from storage/db.ts — actually recording an outcome
 * remains the caller's responsibility, matching how openRouteServiceAdapter.ts
 * itself deliberately never imports storage/.
 */

/** Maps an adapter error reason to the coarse, provider-independent
 * outcome persisted for Settings — null means "not informative about the
 * key's own validity", so nothing is recorded (see RoutingError's own
 * doc comment for the full reasoning). A transport failure, timeout,
 * offline condition or provider outage never implies the key itself is
 * bad — all three map to "unavailable", never "rejected". */
export function mapErrorReasonToOutcome(
  reason: RoutingErrorReason,
): ProviderKeyOutcome | null {
  switch (reason) {
    case "unauthorized":
      return "rejected";
    case "forbidden":
    case "rate-limited":
      return "quota-limited";
    case "offline":
    case "transport-failure":
    case "timeout":
    case "provider-unavailable":
      return "unavailable";
    case "no-route-found":
    case "no-routable-point":
      // A well-formed error response proves the key and connection both
      // work — only the waypoints are the problem, not the provider.
      return "verified";
    // Local syntax or request-construction problems — the provider was
    // never reached, so none of these say anything about whether the key
    // itself would be accepted. Explicitly uninformative, never folded
    // into "unavailable" (which implies a genuine connectivity attempt).
    case "invalid-header-value":
    case "header-construction-failure":
    case "invalid-request-construction":
    case "fetch-invocation-failure":
      return null;
    default:
      return null;
  }
}

/** Appended to a message when the provider supplied a numeric error code
 * — a safe, concrete diagnostic detail (never the accompanying message
 * text; see RoutingError's own doc comment). */
function formatProviderCode(translator: Translator, error: RoutingError): string {
  return error.providerErrorCode !== undefined
    ? translator.t("routingError.providerCodeSuffix", {
        code: error.providerErrorCode,
      })
    : "";
}

function formatHttpStatus(translator: Translator, error: RoutingError): string {
  return error.httpStatus !== undefined
    ? String(error.httpStatus)
    : translator.t("routingError.unknownStatus");
}

/**
 * The rider-facing sentence for a routing failure.
 *
 * Backlog item 113 stage 3: the translator is an explicit parameter, not a
 * context read, and that is load-bearing beyond purity. This one function
 * serves two surfaces with different language requirements — Planning,
 * which follows the rider's chosen language, and the Status screen's
 * copyable connection-test report, which stays English so it can be
 * shared for support (approved decision R4). The report keeps that
 * property by passing the English translator explicitly, so it is English
 * **by construction** rather than by nobody having localised it yet.
 */
export function describeRoutingError(
  translator: Translator,
  error: RoutingError,
): string {
  switch (error.reason) {
    case "no-api-key":
      return translator.t("routingError.noApiKey");
    case "invalid-header-value":
      return translator.t("routingError.invalidHeaderValue");
    case "header-construction-failure":
    case "invalid-request-construction":
    case "fetch-invocation-failure":
      return translator.t("routingError.requestNotSent");
    case "unauthorized":
      return translator.t("routingError.unauthorized");
    case "forbidden":
      return translator.t("routingError.forbidden");
    case "rate-limited":
      return translator.t("routingError.rateLimited");
    case "offline":
      return translator.t("routingError.offline");
    case "transport-failure":
      return translator.t("routingError.transportFailure");
    case "timeout":
      return translator.t("routingError.timeout");
    case "no-route-found":
      return `${translator.t("routingError.noRouteFound")}${formatProviderCode(translator, error)}`;
    case "no-routable-point":
      return `${translator.t("routingError.noRoutablePoint")}${formatProviderCode(translator, error)}`;
    case "provider-unavailable":
      return translator.t("routingError.providerUnavailable", {
        status: formatHttpStatus(translator, error),
      });
    case "provider-error":
      return `${translator.t("routingError.providerError", {
        status: formatHttpStatus(translator, error),
      })}${formatProviderCode(translator, error)}`;
    case "malformed-response":
    case "no-geometry":
    case "unknown":
      return translator.t("routingError.unusableResponse");
    case "leg-stitching-failed":
      return translator.t("routingError.legStitchingFailed");
  }
}
