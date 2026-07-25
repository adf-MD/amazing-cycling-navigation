import { describe, expect, it } from "vitest";
import { describeProviderKeyStatus } from "./providerKeyStatus.ts";
import type {
  StoredProviderKey,
  StoredProviderKeyVerification,
} from "../../storage/db.ts";

const NOW_MS = Date.parse("2026-07-23T12:00:00.000Z");

const key: StoredProviderKey = {
  id: "openrouteservice",
  apiKey: "dummy-test-key",
  savedAt: "2026-07-01T00:00:00.000Z",
};

function verification(
  overrides: Partial<StoredProviderKeyVerification> = {},
): StoredProviderKeyVerification {
  return {
    id: "openrouteservice",
    outcome: "verified",
    checkedAt: "2026-07-23T10:00:00.000Z",
    rateLimitResetAt: null,
    ...overrides,
  };
}

describe("describeProviderKeyStatus", () => {
  it("no key configured", () => {
    expect(describeProviderKeyStatus(undefined, undefined, NOW_MS)).toEqual({
      headline: "No key configured",
    });
  });

  it("key saved, never verified", () => {
    expect(describeProviderKeyStatus(key, undefined, NOW_MS)).toEqual({
      headline: "Key saved on this device, not yet verified",
    });
  });

  it("key last verified successfully", () => {
    const status = describeProviderKeyStatus(
      key,
      verification({ outcome: "verified" }),
      NOW_MS,
    );
    expect(status.headline).toContain("Key last verified");
    expect(status.headline).toContain("23 Jul 2026");
  });

  it("key was rejected when last checked", () => {
    const status = describeProviderKeyStatus(
      key,
      verification({ outcome: "rejected" }),
      NOW_MS,
    );
    expect(status.headline).toContain("Key was rejected when last checked");
    expect(status.headline).not.toMatch(/^Key is rejected/);
  });

  it("quota reached with a reset time still in the future", () => {
    const status = describeProviderKeyStatus(
      key,
      verification({
        outcome: "quota-limited",
        rateLimitResetAt: "2026-07-23T13:00:00.000Z", // 1 hour after NOW_MS
      }),
      NOW_MS,
    );
    expect(status.headline).toContain("Quota reached, retry after");
    expect(status.headline).toContain("23 Jul 2026");
  });

  it("quota reached with a reset time already passed does not claim it is still exhausted", () => {
    const status = describeProviderKeyStatus(
      key,
      verification({
        outcome: "quota-limited",
        rateLimitResetAt: "2026-07-23T11:00:00.000Z", // 1 hour before NOW_MS
      }),
      NOW_MS,
    );
    expect(status.headline).toContain("Quota was reached when last checked");
    expect(status.headline).toContain("you can try again");
    expect(status.headline).not.toContain("retry after");
  });

  it("quota reached with no reset time at all", () => {
    const status = describeProviderKeyStatus(
      key,
      verification({ outcome: "quota-limited", rateLimitResetAt: null }),
      NOW_MS,
    );
    expect(status.headline).toContain("Quota was reached when last checked");
    expect(status.headline).toContain("you can try again");
  });

  it("provider was unavailable when last checked, never claims current unavailability", () => {
    const status = describeProviderKeyStatus(
      key,
      verification({ outcome: "unavailable" }),
      NOW_MS,
    );
    expect(status.headline).toContain("Provider was unavailable when last checked");
    expect(status.headline).not.toMatch(/^Provider is unavailable/);
  });
});
