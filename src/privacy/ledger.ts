import { Emitter } from "../utils/emitter";

export type RouteName = "searchChannel" | "searchGuild" | "channelHistory" | "deleteMessage";

export type Destination = "discord-api";

export interface LedgerSnapshot {
    discordApi: Record<RouteName, number>;
    externalConnections: number;
    blockedRequests: number;
    killSwitchRefusals: number;
    sessionStartedAt: number;
}

export class NetworkLedger {
    private discordApi: Record<RouteName, number> = { searchChannel: 0, searchGuild: 0, channelHistory: 0, deleteMessage: 0 };
    private byDestination = new Map<string, number>();
    private blocked = 0;
    private killSwitchRefusals = 0;
    private readonly sessionStartedAt: number;
    private readonly emitter = new Emitter<void>();

    constructor(now = Date.now()) {
        this.sessionStartedAt = now;
    }

    recordAllowed(route: RouteName, destination: Destination): void {
        this.discordApi[route]++;
        this.byDestination.set(destination, (this.byDestination.get(destination) ?? 0) + 1);
        this.emitter.emit();
    }

    recordBlocked(): void {
        this.blocked++;
        this.emitter.emit();
    }

    recordKillSwitchRefusal(): void {
        this.killSwitchRefusals++;
        this.emitter.emit();
    }

    snapshot(): LedgerSnapshot {
        let external = 0;
        for (const [destination, count] of this.byDestination) {
            if (destination !== "discord-api") external += count;
        }
        return {
            discordApi: { ...this.discordApi },
            externalConnections: external,
            blockedRequests: this.blocked,
            killSwitchRefusals: this.killSwitchRefusals,
            sessionStartedAt: this.sessionStartedAt
        };
    }

    subscribe(listener: () => void): () => void {
        return this.emitter.subscribe(listener);
    }

    dispose(): void {
        this.emitter.clear();
    }
}
