import { Emitter } from "../utils/emitter";

export class KillSwitch {
    private engagedAt: number | null = null;
    private readonly emitter = new Emitter<boolean>();
    private readonly aborters = new Set<AbortController>();

    get engaged(): boolean {
        return this.engagedAt !== null;
    }

    get engagedSince(): number | null {
        return this.engagedAt;
    }

    register(controller: AbortController): () => void {
        this.aborters.add(controller);
        if (this.engaged) controller.abort();
        return () => {
            this.aborters.delete(controller);
        };
    }

    engage(now = Date.now()): void {
        if (this.engagedAt === null) this.engagedAt = now;
        for (const controller of this.aborters) controller.abort();
        this.aborters.clear();
        this.emitter.emit(true);
    }

    rearm(): void {
        if (this.engagedAt === null) return;
        this.engagedAt = null;
        this.emitter.emit(false);
    }

    subscribe(listener: (engaged: boolean) => void): () => void {
        return this.emitter.subscribe(listener);
    }

    dispose(): void {
        this.aborters.clear();
        this.emitter.clear();
    }
}
