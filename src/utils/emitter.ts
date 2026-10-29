export type Listener<T> = (value: T) => void;

export class Emitter<T = void> {
    private readonly listeners = new Set<Listener<T>>();

    constructor(private readonly onListenerError?: (err: unknown) => void) { }

    subscribe(listener: Listener<T>): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    emit(value: T): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(value);
            } catch (err) {
                this.onListenerError?.(err);
            }
        }
    }

    clear(): void {
        this.listeners.clear();
    }

    get size(): number {
        return this.listeners.size;
    }
}
