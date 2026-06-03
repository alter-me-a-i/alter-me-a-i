/*
 * Thin promise wrapper over IndexedDB. Zero dependencies — for a tool whose
 * whole pitch is "audit every line, nothing hidden", we don't pull a DB lib.
 *
 * A stored record keeps coarse metadata (id, ts, type) in the clear so we can
 * index and sort without decrypting, and keeps the full event — including the
 * sensitive bits (url, prompt text, etc.) — inside the encrypted `data` blob.
 */

import type { EventType } from './types';

const DB_NAME = 'alter-me-a-i';
const DB_VERSION = 1;
const STORE = 'events';

export interface StoredRecord {
  id: string;
  ts: number;
  type: EventType;
  /** Encrypted AlterMeAIEvent: AES-GCM iv + ciphertext. */
  iv: Uint8Array;
  ct: Uint8Array;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('ts', 'ts');
        os.createIndex('type', 'type');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(db: IDBDatabase, rec: StoredRecord): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(rec);
  await txDone(tx);
}

/** Read records newest-first, optionally filtered by type and time window. */
export async function readAll(
  db: IDBDatabase,
  opts: { type?: EventType; since?: number; until?: number; limit?: number } = {},
): Promise<StoredRecord[]> {
  const tx = db.transaction(STORE, 'readonly');
  const index = tx.objectStore(STORE).index('ts');
  const out: StoredRecord[] = [];
  const range =
    opts.since != null || opts.until != null
      ? IDBKeyRange.bound(
          opts.since ?? -Infinity,
          opts.until ?? Infinity,
        )
      : undefined;

  await new Promise<void>((resolve, reject) => {
    const cursorReq = index.openCursor(range, 'prev'); // descending by ts
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return resolve();
      const rec = cursor.value as StoredRecord;
      if (!opts.type || rec.type === opts.type) {
        out.push(rec);
        if (opts.limit && out.length >= opts.limit) return resolve();
      }
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
  return out;
}

export async function countAll(db: IDBDatabase): Promise<number> {
  const tx = db.transaction(STORE, 'readonly');
  return promisify(tx.objectStore(STORE).count());
}

export async function clear(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await txDone(tx);
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
