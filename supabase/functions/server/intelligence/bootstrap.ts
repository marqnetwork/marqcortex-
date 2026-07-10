import { registerProvider } from './providerRegistry.ts';
import { initializeModelRegistry } from './modelRegistry.ts';
import { createOpenAIAdapter } from './providers/openaiAdapter.ts';
import { createMockProvider } from './providers/mockProvider.ts';
import { certifyRegisteredProviders } from './certification.ts';

let bootstrapped = false;

export function bootstrapIntelligenceStack(): void {
  if (bootstrapped) return;
  registerProvider(createOpenAIAdapter(), { certificationStatus: 'Unverified' });
  registerProvider(createMockProvider(), { certificationStatus: 'Testing' });
  initializeModelRegistry('openai');
  certifyRegisteredProviders();
  bootstrapped = true;
}

export function resetIntelligenceStackForTests(): void {
  bootstrapped = false;
}

// Auto-bootstrap in Edge runtime
bootstrapIntelligenceStack();
