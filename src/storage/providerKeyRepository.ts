import {
  db,
  type ProviderKeyOutcome,
  type StoredProviderKey,
  type StoredProviderKeyVerification,
} from "./db.ts";
import { isValidHttpHeaderValue, normaliseApiKey } from "../platform/apiKeyValidation.ts";

const PROVIDER_KEY_ID = "openrouteservice";

/** Thrown by saveProviderKey when the normalised key still contains a
 * character that cannot be sent in an HTTP header (e.g. an embedded line
 * break) — a local syntax problem, never a claim about whether the
 * provider would accept the key. The key itself is never included in this
 * error's message. */
export class InvalidApiKeyError extends Error {
  constructor() {
    super("The key contains a character that cannot be used in a request header.");
    this.name = "InvalidApiKeyError";
  }
}

export async function getProviderKey(): Promise<StoredProviderKey | undefined> {
  const stored = await db.providerKeys.get(PROVIDER_KEY_ID);
  if (!stored) return stored;
  // Normalises a key saved by an older build (before this validation
  // existed) on every read, so the user never needs to re-save it merely
  // to pick up trimming.
  return { ...stored, apiKey: normaliseApiKey(stored.apiKey) };
}

/**
 * Saves (or, for "Replace key", overwrites) the stored key. Always clears
 * any previous verification outcome in the same transaction — a freshly
 * (re)saved key must never inherit a previous key's "rejected"/"quota-
 * limited" status. Throws InvalidApiKeyError, before writing anything,
 * if the normalised key isn't a syntactically usable header value — this
 * is purely a format check; it says nothing about whether the provider
 * would accept the key (see openRouteServiceErrors.ts's "unauthorized"
 * reason for that, a completely separate path).
 */
export async function saveProviderKey(apiKey: string): Promise<void> {
  const normalised = normaliseApiKey(apiKey);
  if (!isValidHttpHeaderValue(normalised)) {
    throw new InvalidApiKeyError();
  }
  await db.transaction("rw", db.providerKeys, db.providerKeyVerifications, async () => {
    await db.providerKeys.put({
      id: PROVIDER_KEY_ID,
      apiKey: normalised,
      savedAt: new Date().toISOString(),
    });
    await db.providerKeyVerifications.delete(PROVIDER_KEY_ID);
  });
}

export async function deleteProviderKey(): Promise<void> {
  await db.transaction("rw", db.providerKeys, db.providerKeyVerifications, async () => {
    await db.providerKeys.delete(PROVIDER_KEY_ID);
    await db.providerKeyVerifications.delete(PROVIDER_KEY_ID);
  });
}

export async function getProviderKeyVerification(): Promise<
  StoredProviderKeyVerification | undefined
> {
  return db.providerKeyVerifications.get(PROVIDER_KEY_ID);
}

/**
 * Records the outcome of an explicit, deliberate routing attempt (never an
 * automatic background check). No-ops if the key has since been deleted —
 * there is nothing meaningful to attach the outcome to.
 */
export async function recordProviderKeyVerification(
  outcome: ProviderKeyOutcome,
  rateLimitResetAt: string | null = null,
): Promise<void> {
  const key = await db.providerKeys.get(PROVIDER_KEY_ID);
  if (!key) return;
  await db.providerKeyVerifications.put({
    id: PROVIDER_KEY_ID,
    outcome,
    checkedAt: new Date().toISOString(),
    rateLimitResetAt,
  });
}
