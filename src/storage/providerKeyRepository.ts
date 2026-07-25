import {
  db,
  type ProviderKeyOutcome,
  type StoredProviderKey,
  type StoredProviderKeyVerification,
} from "./db.ts";

const PROVIDER_KEY_ID = "openrouteservice";

export async function getProviderKey(): Promise<StoredProviderKey | undefined> {
  return db.providerKeys.get(PROVIDER_KEY_ID);
}

/**
 * Saves (or, for "Replace key", overwrites) the stored key. Always clears
 * any previous verification outcome in the same transaction — a freshly
 * (re)saved key must never inherit a previous key's "rejected"/"quota-
 * limited" status.
 */
export async function saveProviderKey(apiKey: string): Promise<void> {
  await db.transaction("rw", db.providerKeys, db.providerKeyVerifications, async () => {
    await db.providerKeys.put({
      id: PROVIDER_KEY_ID,
      apiKey,
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
