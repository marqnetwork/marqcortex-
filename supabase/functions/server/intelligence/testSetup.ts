/**
 * Test harness for Intelligence Gateway (Node 22+ runner).
 */
import { setEnvReaderForTests } from './env.ts';
import { resetProviderRegistryForTests, registerProvider } from './providerRegistry.ts';
import { resetModelRegistryForTests, initializeModelRegistry } from './modelRegistry.ts';
import { resetTelemetryForTests } from './telemetry.ts';
import { createMockProvider } from './providers/mockProvider.ts';
import { createOpenAIAdapter, resetFetchImplementation } from './providers/openaiAdapter.ts';
import { resetIntelligenceStackForTests } from './bootstrap.ts';

export function setupMockIntelligenceTestEnv(env: Record<string, string> = {}): void {
  resetIntelligenceStackForTests();
  resetProviderRegistryForTests();
  resetModelRegistryForTests();
  resetTelemetryForTests();
  resetFetchImplementation();
  setEnvReaderForTests((key) => env[key]);
  registerProvider(createMockProvider(), { certificationStatus: 'Testing' });
  registerProvider(createOpenAIAdapter(), { certificationStatus: 'Unverified' });
  initializeModelRegistry('mock');
}

export function teardownIntelligenceTestEnv(): void {
  setEnvReaderForTests(null);
  resetIntelligenceStackForTests();
  resetProviderRegistryForTests();
  resetModelRegistryForTests();
  resetTelemetryForTests();
  resetFetchImplementation();
}
