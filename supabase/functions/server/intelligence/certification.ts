import type { CertificationStatus } from './contracts.ts';
import {
  getProviderHealth,
  setProviderCertification,
  listProviders,
} from './providerRegistry.ts';

export interface CertificationCheckResult {
  providerId: string;
  status: CertificationStatus;
  passed: boolean;
  checks: { name: string; passed: boolean; detail?: string }[];
}

export function runCertificationChecks(providerId: string): CertificationCheckResult {
  const health = getProviderHealth(providerId);
  const checks = [
    {
      name: 'credentials_or_mock',
      passed: health.credentialsConfigured || providerId === 'mock',
      detail: health.credentialsConfigured ? 'configured' : 'mock provider',
    },
    {
      name: 'not_disabled',
      passed: health.certificationStatus !== 'Disabled',
    },
    {
      name: 'health_available',
      passed: health.status !== 'unavailable' || providerId === 'mock',
    },
  ];
  const passed = checks.every((c) => c.passed);
  const status: CertificationStatus = passed
    ? providerId === 'mock'
      ? 'Testing'
      : 'Certified'
    : 'Degraded';
  setProviderCertification(providerId, status);
  return { providerId, status, passed, checks };
}

export function certifyRegisteredProviders(): CertificationCheckResult[] {
  return listProviders().map((p) => runCertificationChecks(p.providerId));
}
