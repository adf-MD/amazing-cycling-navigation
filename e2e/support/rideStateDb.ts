import type { Page } from "@playwright/test";

// Must match src/storage/db.ts's AcnDatabase constructor default — there's
// nothing to import across the app/e2e boundary here, so this is a
// deliberate local literal, not a shared constant.
const INDEXED_DB_NAME = "amazing-cycling-navigation";

function toIndexedDbError(error: DOMException | null): Error {
  return error ?? new Error("IndexedDB request failed");
}

/**
 * Reads a saved route's id by its exact name from the real `routes`
 * IndexedDB object store (via its `name` index). Returns null when no
 * route with that name has been persisted yet.
 *
 * A deterministic building block only — no assertions or polling policy
 * here. Originally introduced (and deliberately kept local to one spec
 * file) by the Android reload-recovery hardening commit; extracted here
 * once a third and fourth spec needed the identical mechanism — see
 * CLAUDE.md's own item 25 for the full history. Callers own their own
 * expect.poll(...) and exact expected shape.
 */
export async function readSavedRouteId(page: Page, name: string): Promise<string | null> {
  return page.evaluate<string | null, { dbName: string; routeName: string }>(
    ({ dbName, routeName }) =>
      new Promise((resolve, reject) => {
        const openRequest = indexedDB.open(dbName);
        openRequest.onerror = () => {
          reject(toIndexedDbError(openRequest.error));
        };
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const transaction = database.transaction("routes", "readonly");
          const store = transaction.objectStore("routes");
          const getRequest = store.index("name").get(routeName);
          getRequest.onsuccess = () => {
            const result = getRequest.result as { id: string } | undefined;
            database.close();
            resolve(result?.id ?? null);
          };
          getRequest.onerror = () => {
            database.close();
            reject(toIndexedDbError(getRequest.error));
          };
        };
      }),
    { dbName: INDEXED_DB_NAME, routeName: name },
  );
}

/**
 * Reads the singleton `rideState` "active" row directly from IndexedDB,
 * bypassing the UI entirely. Returns null when no active ride state row
 * exists (including once useRideNavigation.ts's finish() has cleared it).
 *
 * A deterministic building block only — no assertions or polling policy
 * here; see each spec's own local wait helper for its scenario-specific
 * postcondition (a particular field reaching a value, or the row's own
 * absence).
 */
export async function readActiveRideStateRow(
  page: Page,
): Promise<Record<string, unknown> | null> {
  return page.evaluate<Record<string, unknown> | null, string>(
    (dbName) =>
      new Promise((resolve, reject) => {
        const openRequest = indexedDB.open(dbName);
        openRequest.onerror = () => {
          reject(toIndexedDbError(openRequest.error));
        };
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const transaction = database.transaction("rideState", "readonly");
          const store = transaction.objectStore("rideState");
          const getRequest = store.get("active");
          getRequest.onsuccess = () => {
            const result = getRequest.result as Record<string, unknown> | undefined;
            database.close();
            resolve(result ?? null);
          };
          getRequest.onerror = () => {
            database.close();
            reject(toIndexedDbError(getRequest.error));
          };
        };
      }),
    INDEXED_DB_NAME,
  );
}

/**
 * Writes a row directly into the singleton `rideState` "active" row,
 * bypassing the UI entirely. Used to construct backlog item 73's "storage
 * changed after the launcher's own hydration already ran" scenarios
 * deterministically, within a single browser context/tab — there is no
 * other honest way to expose a stale-launcher-view attempt through the
 * real UI, since the app itself never writes a conflicting row behind its
 * own back. Mirrors readActiveRideStateRow's own IndexedDB-transaction
 * structure exactly.
 */
export async function writeActiveRideStateRow(
  page: Page,
  row: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ({ dbName, row }: { dbName: string; row: Record<string, unknown> }) =>
      new Promise<void>((resolve, reject) => {
        const openRequest = indexedDB.open(dbName);
        openRequest.onerror = () => {
          reject(toIndexedDbError(openRequest.error));
        };
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const transaction = database.transaction("rideState", "readwrite");
          const store = transaction.objectStore("rideState");
          const putRequest = store.put(row);
          putRequest.onsuccess = () => {
            database.close();
            resolve();
          };
          putRequest.onerror = () => {
            database.close();
            reject(toIndexedDbError(putRequest.error));
          };
        };
      }),
    { dbName: INDEXED_DB_NAME, row },
  );
}

/**
 * Reads the singleton `planningDrafts` "draft" row directly from
 * IndexedDB, bypassing the UI entirely. Returns null when no draft row
 * exists (including once handleSave's own clearDraft() has resolved) —
 * used to prove the Save-versus-autosave draft race (CLAUDE.md backlog
 * item 30) stays closed: a resurrected draft would show up here as a
 * non-null row even when the UI has already navigated away from Planning.
 *
 * A deterministic building block only — no assertions or polling policy
 * here; mirrors readActiveRideStateRow exactly, extended for a third store
 * per this file's own established precedent (see CLAUDE.md item 25).
 */
export async function readPlanningDraftRow(
  page: Page,
): Promise<Record<string, unknown> | null> {
  return page.evaluate<Record<string, unknown> | null, string>(
    (dbName) =>
      new Promise((resolve, reject) => {
        const openRequest = indexedDB.open(dbName);
        openRequest.onerror = () => {
          reject(toIndexedDbError(openRequest.error));
        };
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const transaction = database.transaction("planningDrafts", "readonly");
          const store = transaction.objectStore("planningDrafts");
          const getRequest = store.get("draft");
          getRequest.onsuccess = () => {
            const result = getRequest.result as Record<string, unknown> | undefined;
            database.close();
            resolve(result ?? null);
          };
          getRequest.onerror = () => {
            database.close();
            reject(toIndexedDbError(getRequest.error));
          };
        };
      }),
    INDEXED_DB_NAME,
  );
}
