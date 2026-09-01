import { useEffect, useState } from "react";
import { db } from "./db.ts";

export const STORAGE_PRESSURE_THRESHOLD_RATIO = 0.9;

export type StorageQuotaEstimate =
  | { status: "checking" }
  | { status: "unsupported" }
  | { status: "unavailable" }
  | {
      status: "available";
      usageBytes: number;
      quotaBytes: number;
      usageRatio: number;
      highPressure: boolean;
    };

export type StorageHealth =
  | { status: "checking"; schemaVersion: null }
  | { status: "error"; schemaVersion: null }
  | { status: "ok"; schemaVersion: number; estimate: StorageQuotaEstimate };

export function isHighStoragePressure(usageRatio: number): boolean {
  return usageRatio >= STORAGE_PRESSURE_THRESHOLD_RATIO;
}

export function parseStorageEstimateNumbers(
  usage: number | undefined,
  quota: number | undefined,
): { usageBytes: number; quotaBytes: number } | null {
  if (usage === undefined || quota === undefined) return null;
  if (!Number.isFinite(usage) || !Number.isFinite(quota)) return null;
  if (usage < 0 || quota <= 0) return null;
  return { usageBytes: usage, quotaBytes: quota };
}

/** Two individually finite inputs can still overflow to Infinity on
 * division (e.g. a MAX_VALUE usage against a MIN_VALUE quota) — guarded
 * here so that case is treated as unavailable, not a bogus always-high
 * ratio. */
export function computeUsageRatio(usageBytes: number, quotaBytes: number): number | null {
  const ratio = usageBytes / quotaBytes;
  return Number.isFinite(ratio) ? ratio : null;
}

/** Never rejects — every internal failure (an absent/malformed API, a
 * throwing navigator.storage getter, a rejecting estimate() call, or an
 * unusable result) resolves to "unsupported"/"unavailable" instead, so
 * this is always safe to await outside db.open()'s own try/catch. */
async function fetchStorageEstimate(): Promise<StorageQuotaEstimate> {
  try {
    const storage: StorageManager | undefined = navigator.storage;
    // lib.dom.d.ts declares navigator.storage/estimate as always present,
    // but real browsers vary (a hardened/older engine may lack either) —
    // deliberately defensive despite TypeScript's own overconfident types.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof storage?.estimate !== "function") {
      return { status: "unsupported" };
    }
    const raw = await storage.estimate();
    const parsed = parseStorageEstimateNumbers(raw.usage, raw.quota);
    if (!parsed) return { status: "unavailable" };
    const usageRatio = computeUsageRatio(parsed.usageBytes, parsed.quotaBytes);
    if (usageRatio === null) return { status: "unavailable" };
    return {
      status: "available",
      usageBytes: parsed.usageBytes,
      quotaBytes: parsed.quotaBytes,
      usageRatio,
      highPressure: isHighStoragePressure(usageRatio),
    };
  } catch {
    return { status: "unavailable" };
  }
}

export function useStorageHealth(): StorageHealth {
  const [health, setHealth] = useState<StorageHealth>({
    status: "checking",
    schemaVersion: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      let schemaVersion: number;
      try {
        await db.open();
        schemaVersion = db.verno;
      } catch {
        if (!cancelled) setHealth({ status: "error", schemaVersion: null });
        return;
      }

      if (cancelled) return;
      setHealth({ status: "ok", schemaVersion, estimate: { status: "checking" } });

      const estimate = await fetchStorageEstimate();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TypeScript's flow analysis can't see that the effect's own cleanup may have flipped `cancelled` to true during the `await` above; this check is genuinely load-bearing to avoid a post-unmount state update.
      if (!cancelled) setHealth({ status: "ok", schemaVersion, estimate });
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return health;
}
