import type { EncryptedEnvelope, Language, ProtectedKeyBundle } from './types';

const DATABASE = 'codexpulse-v1';
const STORE = 'secure';
const LANGUAGE_KEY = 'codexpulse-language';

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error('STORAGE_ABORT'));
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export const secureStorage = {
  get<T>(key: string) { return transaction<T | undefined>('readonly', (store) => store.get(key)); },
  set<T>(key: string, value: T) { return transaction<IDBValidKey>('readwrite', (store) => store.put(value, key)); },
  remove(key: string) { return transaction<undefined>('readwrite', (store) => store.delete(key)); },
  async setMany(entries: [string, unknown][]) {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('STORAGE_ABORT'));
        tx.onerror = () => reject(tx.error);
        for (const [key, value] of entries) tx.objectStore(STORE).put(value, key);
      });
    } finally { database.close(); }
  },
  async clear() {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE, 'readwrite');
        const request = tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('STORAGE_ABORT'));
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  },
};

export const storageKeys = {
  protectedKey: 'protected-key',
  snapshot: 'snapshot-envelope',
  localVault: 'local-vault',
  failedUnlocks: 'failed-unlocks',
} as const;

export async function loadProtectedKey() {
  return secureStorage.get<ProtectedKeyBundle>(storageKeys.protectedKey);
}

export async function loadCachedEnvelope() {
  return secureStorage.get<EncryptedEnvelope>(storageKeys.snapshot);
}

export function preferredLanguage(): Language {
  const stored = localStorage.getItem(LANGUAGE_KEY);
  if (stored === 'hu' || stored === 'en') return stored;
  return navigator.language.toLowerCase().startsWith('hu') ? 'hu' : 'en';
}

export function saveLanguage(language: Language) {
  localStorage.setItem(LANGUAGE_KEY, language);
  document.documentElement.lang = language;
}
