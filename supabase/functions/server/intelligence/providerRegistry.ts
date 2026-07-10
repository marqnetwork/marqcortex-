import type {
  AIProviderAdapter,
  CertificationStatus,
  ProviderConfig,
  ProviderHealth,
  ProviderHealthStatus,
} from './contracts.ts';
import { createProviderError, throwProviderError } from './errors.ts';

interface RegisteredProvider {
  adapter: AIProviderAdapter;
  config: ProviderConfig;
}

const providerRegistry = new Map<string, RegisteredProvider>();

export function registerProvider(
  adapter: AIProviderAdapter,
  options?: {
    certificationStatus?: CertificationStatus;
    healthStatus?: ProviderHealthStatus;
    enabled?: boolean;
  },
): void {
  if (providerRegistry.has(adapter.providerId)) {
    throw new Error(`Duplicate provider registration: ${adapter.providerId}`);
  }
  providerRegistry.set(adapter.providerId, {
    adapter,
    config: {
      providerId: adapter.providerId,
      displayName: adapter.displayName,
      enabled: options?.enabled ?? true,
      certificationStatus: options?.certificationStatus ?? 'Unverified',
      healthStatus: options?.healthStatus ?? 'healthy',
      capabilities: adapter.capabilities,
    },
  });
}

export function getProvider(providerId: string): RegisteredProvider {
  const entry = providerRegistry.get(providerId);
  if (!entry) {
    throwProviderError(
      createProviderError(
        'PROVIDER_NOT_FOUND',
        `Provider not registered: ${providerId}`,
        'registry',
      ),
    );
  }
  return entry!;
}

export function resolveActiveProvider(activeProviderId: string): RegisteredProvider {
  return getProvider(activeProviderId);
}

export function setProviderEnabled(providerId: string, enabled: boolean): void {
  const entry = getProvider(providerId);
  entry.config.enabled = enabled;
  if (!enabled) {
    entry.config.certificationStatus = 'Disabled';
    entry.config.healthStatus = 'unavailable';
  }
}

export function setProviderCertification(
  providerId: string,
  status: CertificationStatus,
): void {
  const entry = getProvider(providerId);
  entry.config.certificationStatus = status;
}

export function setProviderHealth(
  providerId: string,
  status: ProviderHealthStatus,
  reason?: string,
): void {
  const entry = getProvider(providerId);
  entry.config.healthStatus = status;
  if (reason) entry.config.healthStatus = status;
}

export function assertProviderAvailable(providerId: string, requestId: string): AIProviderAdapter {
  const entry = getProvider(providerId);
  if (!entry.config.enabled || entry.config.certificationStatus === 'Disabled') {
    throwProviderError(
      createProviderError(
        'PROVIDER_DISABLED',
        `Provider ${providerId} is disabled`,
        requestId,
        { provider: providerId, retryable: false },
      ),
    );
  }
  if (entry.config.healthStatus === 'unavailable') {
    throwProviderError(
      createProviderError(
        'PROVIDER_UNAVAILABLE',
        `Provider ${providerId} is unavailable`,
        requestId,
        { provider: providerId, retryable: true },
      ),
    );
  }
  return entry.adapter;
}

export function getProviderHealth(providerId: string): ProviderHealth {
  const entry = getProvider(providerId);
  return {
    providerId,
    status: entry.config.healthStatus,
    certificationStatus: entry.config.certificationStatus,
    credentialsConfigured: entry.adapter.checkCredentials(),
    checkedAt: new Date().toISOString(),
  };
}

export function listProviders(): ProviderConfig[] {
  return [...providerRegistry.values()].map((e) => ({ ...e.config }));
}

export function resetProviderRegistryForTests(): void {
  providerRegistry.clear();
}

export function validateRegistryConfiguration(): string[] {
  const issues: string[] = [];
  if (providerRegistry.size === 0) issues.push('No providers registered');
  for (const [id, entry] of providerRegistry) {
    if (!entry.adapter.providerId) issues.push(`Provider ${id} missing providerId`);
    if (!entry.config.enabled && entry.config.certificationStatus === 'Certified') {
      issues.push(`Provider ${id} certified but disabled`);
    }
  }
  return issues;
}
