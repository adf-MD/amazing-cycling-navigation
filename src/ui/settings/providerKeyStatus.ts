import type {
  StoredProviderKey,
  StoredProviderKeyVerification,
} from "../../storage/db.ts";
import type { Translator } from "../../i18n/translate.ts";

export interface ProviderKeyStatus {
  headline: string;
}

/** Fixed to UTC so this is deterministic in tests regardless of the
 * environment's local timezone, at the small cost of always showing UTC
 * rather than the rider's own local time.
 *
 * Backlog item 113 stage 5: the *locale* now comes from the translator
 * while the *time zone* stays pinned to UTC. Those are two separate
 * promises and only the first is the rider's to change — a German
 * interface should read the date in German, but silently swapping UTC for
 * local time would make every stored verification record mean something
 * different. For English the locale resolves to `en-GB`, exactly the
 * literal this replaces, so the output is byte-identical. */
function formatTimestamp(translator: Translator, iso: string): string {
  return translator.t("providerKey.utcTimestamp", {
    timestamp: new Intl.DateTimeFormat(translator.locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(iso)),
  });
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
  translator: Translator,
  key: StoredProviderKey | undefined,
  verification: StoredProviderKeyVerification | undefined,
  nowMs: number,
): ProviderKeyStatus {
  if (!key) {
    return { headline: translator.t("providerKey.none") };
  }
  if (!verification) {
    return { headline: translator.t("providerKey.unverified") };
  }

  const checkedAt = formatTimestamp(translator, verification.checkedAt);

  switch (verification.outcome) {
    case "verified":
      return { headline: translator.t("providerKey.verified", { checkedAt }) };
    case "rejected":
      return { headline: translator.t("providerKey.rejected", { checkedAt }) };
    case "quota-limited": {
      const resetAt = verification.rateLimitResetAt;
      if (resetAt && new Date(resetAt).getTime() > nowMs) {
        return {
          headline: translator.t("providerKey.quotaRetryAfter", {
            resetAt: formatTimestamp(translator, resetAt),
          }),
        };
      }
      return { headline: translator.t("providerKey.quotaReached", { checkedAt }) };
    }
    case "unavailable":
      return { headline: translator.t("providerKey.unavailable", { checkedAt }) };
  }
}
