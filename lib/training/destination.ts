/*
 * Training destination — the user's chosen on-disk folder that Cortex writes the
 * aggregated training corpus into. This is the "stub of your own AI": every
 * captured exchange, formatted as fine-tuning JSONL, lands in ONE folder you own.
 *
 * Why this shape (least friction + max control, given the browser sandbox):
 *  - A browser extension CANNOT silently write to disk or watch a folder. The
 *    File System Access API is the only sandbox-legal way to get a durable,
 *    user-granted handle to a real directory — no localhost server, no second
 *    process, nothing leaves the machine.
 *  - You pick the folder ONCE; Chrome remembers the handle (persisted in
 *    IndexedDB). Writes happen on demand (a "Sync" click, or after capture).
 *    Chrome may re-ask permission after a restart — a security boundary we
 *    surface honestly rather than pretend around.
 *  - Must run in a WINDOW context (popup/options): showDirectoryPicker and
 *    permission prompts need a user gesture and aren't available in the worker.
 */

const DB_NAME = 'cortex-training';
const STORE = 'handles';
const HANDLE_KEY = 'destination';

/** Minimal shape of the File System Access bits we use (TS lib gaps). */
type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
};

/** Is the File System Access API available in this browser/context? */
export function fsAccessAvailable(): boolean {
  return typeof (globalThis as any).showDirectoryPicker === 'function';
}

// --- tiny IDB wrapper just for the directory handle ------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = () => resolve(r.result as T | undefined);
        r.onerror = () => reject(r.error);
      }),
  );
}

function idbSet(key: string, val: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function idbDel(key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

// --- public API ------------------------------------------------------------

/** Prompt the user to choose a training folder; persists the handle. */
export async function pickTrainingFolder(): Promise<DirHandle> {
  const handle = (await (globalThis as any).showDirectoryPicker({
    id: 'cortex-training',
    mode: 'readwrite',
  })) as DirHandle;
  await idbSet(HANDLE_KEY, handle);
  return handle;
}

/** The stored handle, or null if none chosen yet. Does NOT check permission. */
export async function getTrainingFolder(): Promise<DirHandle | null> {
  return (await idbGet<DirHandle>(HANDLE_KEY)) ?? null;
}

/** Forget the chosen folder (does not touch any files already written). */
export async function clearTrainingFolder(): Promise<void> {
  await idbDel(HANDLE_KEY);
}

/**
 * Ensure we hold readwrite permission on the handle, re-prompting if Chrome
 * dropped it (e.g. across a restart). Returns false if the user declines.
 */
export async function ensurePermission(handle: DirHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  return (await handle.requestPermission?.(opts)) === 'granted';
}

/** Write (overwrite) a file in the chosen folder. Returns the bytes written. */
export async function writeToFolder(
  handle: DirHandle,
  filename: string,
  contents: string,
): Promise<number> {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await (fileHandle as any).createWritable();
  await writable.write(contents);
  await writable.close();
  return contents.length;
}
