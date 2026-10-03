import { vi } from "vitest";
import { db } from "../storage/db.ts";

/**
 * A real IndexedDB hold for component and repository tests (backlog item
 * 124, D-02): the test's own `readwrite` transaction on one of the app's
 * stores, kept alive by chained reads, so the app's write to that store
 * queues behind it and stays pending until `release()`. Unlike a mocked
 * repository call, this reaches Dexie's own transaction and live-query
 * machinery — which is where D-02's optimistic disappearance lived.
 *
 * Rules worth knowing before using it:
 * - **Hold after the screen has loaded.** fake-indexeddb, like a browser,
 *   blocks any transaction overlapping a running readwrite one, so a live
 *   query's first read made after the hold waits behind it. So does every
 *   read made after the app's own write has queued.
 * - **Never read the held store from the test while held.** Use a read made
 *   before the hold, or after `release()`.
 * - **Real timers only.** fake-indexeddb schedules through the real
 *   `setImmediate`; fake timers would stall the hold.
 * - Bounded by a deadline, and `releaseAllIdbHolds()` belongs in the test
 *   file's `afterEach`, so a failed test never leaves a hold behind.
 *
 * With `captureDeletes`, the app's `delete` requests on the store are
 * recorded with their transactions, so `release({ abortCapturedDeletes })`
 * can abort the app's queued transaction — a failure that arrives after the
 * rider has done something else. These are synthetic, like the browser
 * fixtures in the e2e specs: they show what the interface does once a write
 * is pending or fails, not that such failures happen on a device.
 */
export interface IdbHold {
  /** The app's delete requests recorded so far (`captureDeletes` only). */
  readonly capturedDeleteCount: number;
  release(options?: { abortCapturedDeletes?: boolean }): Promise<void>;
}

const HOLD_DEADLINE_MS = 10_000;
const HOLD_KEY = "acn-test-hold";

const activeHolds = new Set<IdbHold>();

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 5);
  });
}

export async function holdIdbStore(
  storeName: string,
  options: { captureDeletes?: boolean } = {},
): Promise<IdbHold> {
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(db.name);
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("could not open the test hold's connection"));
    };
  });
  const holdTransaction = connection.transaction(storeName, "readwrite");
  const store = holdTransaction.objectStore(storeName);
  const deadline = Date.now() + HOLD_DEADLINE_MS;
  let stop = false;
  let finished = false;
  holdTransaction.oncomplete = () => {
    finished = true;
    connection.close();
  };
  holdTransaction.onabort = () => {
    finished = true;
    connection.close();
  };

  const captured: IDBTransaction[] = [];
  if (options.captureDeletes) {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalDelete = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
      this: IDBObjectStore,
      query: IDBValidKey | IDBKeyRange,
    ) {
      if (this.name === storeName && this.transaction !== holdTransaction) {
        captured.push(this.transaction);
      }
      return originalDelete.call(this, query);
    });
  }

  await new Promise<void>((resolve) => {
    let started = false;
    const loop = () => {
      const request = store.get(HOLD_KEY);
      request.onsuccess = () => {
        if (!started) {
          started = true;
          resolve();
        }
        if (!stop && Date.now() < deadline) loop();
      };
    };
    loop();
  });

  const hold: IdbHold = {
    get capturedDeleteCount() {
      return captured.length;
    },
    async release(releaseOptions = {}) {
      activeHolds.delete(hold);
      if (releaseOptions.abortCapturedDeletes) {
        for (const transaction of captured) {
          try {
            transaction.abort();
          } catch {
            // Already finished: nothing to abort.
          }
        }
      }
      stop = true;
      while (!finished) await nextTask();
    },
  };
  activeHolds.add(hold);
  return hold;
}

/** Releases every hold still active — for `afterEach`. */
export async function releaseAllIdbHolds(): Promise<void> {
  for (const hold of [...activeHolds]) await hold.release();
}
