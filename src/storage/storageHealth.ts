import { useEffect, useState } from "react";
import { db } from "./db.ts";

export interface StorageHealth {
  status: "checking" | "ok" | "error";
  schemaVersion: number | null;
}

export function useStorageHealth(): StorageHealth {
  const [health, setHealth] = useState<StorageHealth>({
    status: "checking",
    schemaVersion: null,
  });

  useEffect(() => {
    let cancelled = false;
    db.open()
      .then(() => {
        if (!cancelled) setHealth({ status: "ok", schemaVersion: db.verno });
      })
      .catch(() => {
        if (!cancelled) setHealth({ status: "error", schemaVersion: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return health;
}
