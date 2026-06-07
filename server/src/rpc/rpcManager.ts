import { EventEmitter } from 'events';
import { Connection } from '@solana/web3.js';

export interface RPCProviderConfig {
  id: string;
  label: string;
  httpUrl: string;
  wsUrl: string;
}

export interface RPCProviderHealth {
  id: string;
  label: string;
  isActive: boolean;
  recentFailures: number;
  reconnectCount: number;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  lastSuccessfulSlot: number | null;
}

export interface RPCHealthSnapshot {
  activeProvider: RPCProviderHealth;
  providers: RPCProviderHealth[];
  degradedMode: boolean;
  healthState: 'HEALTHY' | 'DEGRADED' | 'FALLBACK';
}

interface ProviderState extends RPCProviderConfig {
  connection: Connection;
  failureTimestamps: number[];
  reconnectCount: number;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  lastSuccessfulSlot: number | null;
}

const FAILURE_WINDOW_MS = 60_000;
const FAILURE_THRESHOLD = 3;

export class RPCManager extends EventEmitter {
  private readonly providers: ProviderState[];
  private activeIndex = 0;

  constructor(configs: RPCProviderConfig[]) {
    super();

    if (!configs.length) {
      throw new Error('RPCManager requires at least one provider');
    }

    this.providers = dedupeProviders(configs).map((config) => ({
      ...config,
      connection: new Connection(config.httpUrl, {
        commitment: 'confirmed',
        wsEndpoint: config.wsUrl,
      }),
      failureTimestamps: [],
      reconnectCount: 0,
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastFailureReason: null,
      lastSuccessfulSlot: null,
    }));
  }

  getHttpConnection(): Connection {
    return this.providers[this.activeIndex]!.connection;
  }

  getWsConnection(): { url: string; provider: RPCProviderHealth } {
    const provider = this.providers[this.activeIndex]!;
    return {
      url: provider.wsUrl,
      provider: this.toHealth(provider),
    };
  }

  getCurrentProvider(): RPCProviderHealth {
    return this.toHealth(this.providers[this.activeIndex]!);
  }

  getHealthSnapshot(): RPCHealthSnapshot {
    const activeProvider = this.getCurrentProvider();
    return {
      activeProvider,
      providers: this.providers.map((provider) => this.toHealth(provider)),
      degradedMode: this.activeIndex > 0,
      healthState: this.activeIndex === 0
        ? activeProvider.recentFailures > 0
          ? 'DEGRADED'
          : 'HEALTHY'
        : 'FALLBACK',
    };
  }

  markProviderSuccess(slot?: number, providerId?: string): void {
    const provider = this.resolveProvider(providerId);
    const hadFailures = provider.consecutiveFailures > 0 || provider.failureTimestamps.length > 0;
    const previousSlot = provider.lastSuccessfulSlot;
    provider.consecutiveFailures = 0;
    provider.failureTimestamps = provider.failureTimestamps.filter(
      (timestamp) => timestamp >= Date.now() - FAILURE_WINDOW_MS,
    );
    if (slot !== undefined) {
      provider.lastSuccessfulSlot = Math.max(
        provider.lastSuccessfulSlot ?? 0,
        slot,
      );
    }
    if (hadFailures || (previousSlot === null && provider.lastSuccessfulSlot !== null)) {
      this.emit('health', this.getHealthSnapshot());
    }
  }

  recordReconnect(providerId?: string): void {
    const provider = this.resolveProvider(providerId);
    provider.reconnectCount += 1;
    this.emit('health', this.getHealthSnapshot());
  }

  markProviderFailure(
    reason: string,
    options: {
      providerId?: string;
      rateLimited?: boolean;
    } = {},
  ): RPCProviderHealth {
    const provider = this.resolveProvider(options.providerId);
    const now = Date.now();

    provider.failureTimestamps = provider.failureTimestamps.filter(
      (timestamp) => timestamp >= now - FAILURE_WINDOW_MS,
    );
    provider.failureTimestamps.push(now);
    provider.consecutiveFailures += 1;
    provider.lastFailureAt = now;
    provider.lastFailureReason = reason;

    const isActive = provider.id === this.providers[this.activeIndex]!.id;
    const shouldFailover = isActive && (
      options.rateLimited === true ||
      provider.consecutiveFailures >= FAILURE_THRESHOLD ||
      provider.failureTimestamps.length >= FAILURE_THRESHOLD
    );

    if (shouldFailover && this.activeIndex < this.providers.length - 1) {
      this.activeIndex += 1;
      this.emit('providerChanged', this.getHealthSnapshot());
    } else {
      this.emit('health', this.getHealthSnapshot());
    }

    return this.getCurrentProvider();
  }

  private resolveProvider(providerId?: string): ProviderState {
    if (!providerId) return this.providers[this.activeIndex]!;
    return this.providers.find((provider) => provider.id === providerId)
      ?? this.providers[this.activeIndex]!;
  }

  private toHealth(provider: ProviderState): RPCProviderHealth {
    const now = Date.now();
    return {
      id: provider.id,
      label: provider.label,
      isActive: provider.id === this.providers[this.activeIndex]!.id,
      recentFailures: provider.failureTimestamps.filter(
        (timestamp) => timestamp >= now - FAILURE_WINDOW_MS,
      ).length,
      reconnectCount: provider.reconnectCount,
      consecutiveFailures: provider.consecutiveFailures,
      lastFailureAt: provider.lastFailureAt,
      lastFailureReason: provider.lastFailureReason,
      lastSuccessfulSlot: provider.lastSuccessfulSlot,
    };
  }
}

function dedupeProviders(configs: RPCProviderConfig[]): RPCProviderConfig[] {
  const seen = new Set<string>();
  const deduped: RPCProviderConfig[] = [];

  for (const config of configs) {
    const key = `${config.httpUrl}|${config.wsUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(config);
  }

  return deduped;
}
