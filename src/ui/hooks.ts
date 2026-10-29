import type { App, AppSnapshot } from "../app";
import { useEffect, useReducer, useState } from "../discord/compat";

export function useAppSnapshot(app: App): AppSnapshot {
    const [, force] = useReducer((x: number) => x + 1, 0);
    useEffect(() => app.subscribe(() => force()), [app]);
    return app.getSnapshot();
}

export function useNow(active: boolean, intervalMs = 1000): number {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(timer);
    }, [active, intervalMs]);
    return now;
}

export function useAction(): {
    run: (fn: () => unknown | Promise<unknown>) => Promise<void>;
    pending: boolean;
    error: string | null;
    clearError: () => void;
} {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const run = async (fn: () => unknown | Promise<unknown>) => {
        setPending(true);
        setError(null);
        try {
            await fn();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong.");
        } finally {
            setPending(false);
        }
    };
    return { run, pending, error, clearError: () => setError(null) };
}
