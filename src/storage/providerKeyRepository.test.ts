import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import {
  deleteProviderKey,
  getProviderKey,
  getProviderKeyVerification,
  recordProviderKeyVerification,
  saveProviderKey,
} from "./providerKeyRepository.ts";

const DUMMY_KEY = "test-dummy-key-not-real-0000";

beforeEach(async () => {
  await db.providerKeys.clear();
  await db.providerKeyVerifications.clear();
});

describe("providerKeyRepository", () => {
  it("returns undefined when no key has been saved", async () => {
    await expect(getProviderKey()).resolves.toBeUndefined();
  });

  it("saves a key, retrievable afterwards", async () => {
    await saveProviderKey(DUMMY_KEY);

    const stored = await getProviderKey();
    expect(stored?.apiKey).toBe(DUMMY_KEY);
    expect(stored?.savedAt).toEqual(expect.any(String));
  });

  it("replacing the key overwrites the previous value", async () => {
    await saveProviderKey(DUMMY_KEY);
    await saveProviderKey("a-different-dummy-key");

    const stored = await getProviderKey();
    expect(stored?.apiKey).toBe("a-different-dummy-key");
  });

  it("replacing the key clears any previous verification outcome", async () => {
    await saveProviderKey(DUMMY_KEY);
    await recordProviderKeyVerification("rejected");
    await expect(getProviderKeyVerification()).resolves.toMatchObject({
      outcome: "rejected",
    });

    await saveProviderKey("a-different-dummy-key");

    await expect(getProviderKeyVerification()).resolves.toBeUndefined();
  });

  it("deleting the key removes both the key and its verification row", async () => {
    await saveProviderKey(DUMMY_KEY);
    await recordProviderKeyVerification("verified");

    await deleteProviderKey();

    await expect(getProviderKey()).resolves.toBeUndefined();
    await expect(getProviderKeyVerification()).resolves.toBeUndefined();
  });

  it("records a verification outcome with a rate-limit reset time", async () => {
    await saveProviderKey(DUMMY_KEY);

    await recordProviderKeyVerification("quota-limited", "2026-02-01T00:00:00.000Z");

    await expect(getProviderKeyVerification()).resolves.toMatchObject({
      outcome: "quota-limited",
      rateLimitResetAt: "2026-02-01T00:00:00.000Z",
    });
  });

  it("recording an outcome with no key saved is a no-op, not an error", async () => {
    await expect(recordProviderKeyVerification("verified")).resolves.toBeUndefined();
    await expect(getProviderKeyVerification()).resolves.toBeUndefined();
  });
});
