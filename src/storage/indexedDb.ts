import type { DestroyResult, KeyValueStore } from "./kv";

export const DATABASE_NAME = "PrivacyCleanupAddon";
const STORE_NAME = "kv";
const DELETE_TIMEOUT_MS = 5000;

function promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
}

export class IndexedDbStore implements KeyValueStore {
    private db: Promise<IDBDatabase> | null = null;

    constructor(private readonly factory: IDBFactory = indexedDB, private readonly name = DATABASE_NAME) { }

    private open(): Promise<IDBDatabase> {
        if (!this.db) {
            this.db = new Promise<IDBDatabase>((resolve, reject) => {
                const request = this.factory.open(this.name, 1);
                request.onupgradeneeded = () => {
                    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
                };
                request.onsuccess = () => {
                    const db = request.result;
                    db.onversionchange = () => {
                        db.close();
                        this.db = null;
                    };
                    resolve(db);
                };
                request.onerror = () => {
                    this.db = null;
                    reject(request.error ?? new Error("Could not open local storage"));
                };
            });
        }
        return this.db;
    }

    private async tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
        const db = await this.open();
        return promisify(fn(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)));
    }

    async get(key: string): Promise<unknown> {
        return this.tx("readonly", s => s.get(key));
    }

    async set(key: string, value: unknown): Promise<void> {
        await this.tx("readwrite", s => s.put(value, key));
    }

    async delete(key: string): Promise<void> {
        await this.tx("readwrite", s => s.delete(key));
    }

    async keys(): Promise<string[]> {
        const keys = await this.tx("readonly", s => s.getAllKeys());
        return keys.map(k => String(k));
    }

    async destroy(): Promise<DestroyResult> {
        await this.tx("readwrite", s => s.clear());
        const db = await this.db;
        db?.close();
        this.db = null;
        const removed = await new Promise<boolean>(resolve => {
            const request = this.factory.deleteDatabase(this.name);
            const timer = setTimeout(() => resolve(false), DELETE_TIMEOUT_MS);
            request.onsuccess = () => {
                clearTimeout(timer);
                resolve(true);
            };
            request.onerror = () => {
                clearTimeout(timer);
                resolve(false);
            };
        });
        return { containerRemoved: removed };
    }
}
