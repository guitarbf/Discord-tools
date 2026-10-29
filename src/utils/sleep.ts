export class AbortedError extends Error {
    override name = "AbortedError";
    constructor(message = "Operation aborted") {
        super(message);
    }
}

export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

export const sleep: SleepFn = (ms, signal) =>
    new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new AbortedError());
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(new AbortedError());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, Math.max(0, ms));
        signal?.addEventListener("abort", onAbort, { once: true });
    });
