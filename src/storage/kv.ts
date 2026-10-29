export interface KeyValueStore {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
    destroy(): Promise<DestroyResult>;
}

export interface DestroyResult {
    containerRemoved: boolean;
}

export class MemoryStore implements KeyValueStore {
    readonly data = new Map<string, unknown>();

    async get(key: string): Promise<unknown> {
        return structuredClone(this.data.get(key));
    }

    async set(key: string, value: unknown): Promise<void> {
        this.data.set(key, structuredClone(value));
    }

    async delete(key: string): Promise<void> {
        this.data.delete(key);
    }

    async keys(): Promise<string[]> {
        return [...this.data.keys()];
    }

    async destroy(): Promise<DestroyResult> {
        this.data.clear();
        return { containerRemoved: true };
    }
}
