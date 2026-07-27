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
    default:
      return null;
  }
}

/** Appended to a message when the provider supplied a numeric error code
 * — a safe, concrete diagnostic detail (never the accompanying message
 * text; see RoutingError's own doc comment). */
function formatProviderCode(error: RoutingError): string {
  return error.providerErrorCode !== undefined
    ? ` (provider code ${String(error.providerErrorCode)})`
    : "";
}

function formatHttpStatus(error: RoutingError): string {
  return error.httpStatus !== undefined ? String(error.httpStatus) : "error";
}

export function describeRoutingError(error: RoutingError): string {
  switch (error.reason) {
    case "no-api-key":
      return "Road routing requires your personal OpenRouteService key.";
    case "unauthorized":
      return "Your OpenRouteService key was rejected. Check it in Settings.";
    case "forbidden":
      return "Access was denied — check your OpenRouteService account, permissions or daily quota in Settings.";
    case "rate-limited":
      return "The routing rate limit was reached. Try again shortly.";
    case "offline":
      return "You are offline. Connect to calculate a route.";
    case "transport-failure":
      return "The routing provider could not be reached. OpenRouteService may be temporarily unavailable, or the browser or network may have blocked the request. Try again later.";
    case "timeout":
      return "The routing request timed out. Try again.";
    case "no-route-found":
      return `No cycling route could be found between these waypoints — they may be separated by water, a barrier, or a gap in rideable roads. Your key and connection to OpenRouteService are working; try adjusting the route.${formatProviderCode(error)}`;
    case "no-routable-point":
      return `One of your waypoints is too far from a usable road for cycling. Try moving it closer to a street or cycle path. Your key and connection to OpenRouteService are working.${formatProviderCode(error)}`;
    case "provider-unavailable":
      return `OpenRouteService is temporarily unavailable (HTTP ${formatHttpStatus(error)}). Your waypoints have been retained. Try again later.`;
    case "provider-error":
      return `The routing provider returned an unexpected error (HTTP ${formatHttpStatus(error)}).${formatProviderCode(error)}`;
    case "malformed-response":
    case "no-geometry":
    case "unknown":
      return "The routing provider returned an unusable response. Try again.";
  }
}
