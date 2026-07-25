import type {
  StoredProviderKey,
  StoredProviderKeyVerification,
} from "../../storage/db.ts";

export interface ProviderKeyStatus {
  headline: string;
}

/** Fixed to UTC so this is deterministic in tests regardless of the
 * environment's local timezone/locale, at the small cost of always
 * showing UTC rather than the rider's own local time. */
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

function formatTimestamp(iso: string): string {
  return `${DATE_TIME_FORMATTER.format(new Date(iso))} UTC`;
}

/**
 * Describes the stored key's status for display in Settings. Every
 * message describing a verification outcome is deliberately phrased as a
 * historical fact ("when last checked", "last verified") rather than a
 * live assertion about the provider's current state — a reload doesn't
 * re-check anything, only an explicit routing attempt does (see
 * src/ui/planning/usePlanningRoute.ts). Current offline state is shown
 * separately by the caller, via the existing useOnlineStatus() hook —
 * never folded into this wording.
 */
export function describeProviderKeyStatus(
  key: StoredProviderKey | undefined,
  verification: StoredProviderKeyVerification | undefined,
  nowMs: number,
): ProviderKeyStatus {
  if (!key) {
    return { headline: "No key configured" };
  }
  if (!verification) {
    return { headline: "Key saved on this device, not yet verified" };
  }

  const checkedAt = formatTimestamp(verification.checkedAt);

  switch (verification.outcome) {
    case "verified":
      return { headline: `Key last verified ${checkedAt}` };
    case "rejected":
      return { headline: `Key was rejected when last checked ${checkedAt}` };
    case "quota-limited": {
      const resetAt = verification.rateLimitResetAt;
      if (resetAt && new Date(resetAt).getTime() > nowMs) {
        return { headline: `Quota reached, retry after ${formatTimestamp(resetAt)}` };
      }
      return {
        headline: `Quota was reached when last checked ${checkedAt} — you can try again`,
      };
    }
    case "unavailable":
      return { headline: `Provider was unavailable when last checked ${checkedAt}` };
  }
}
