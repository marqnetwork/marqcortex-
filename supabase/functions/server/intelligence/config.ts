import { readEnv, readEnvBool } from './env.ts';
import type { RetryPolicy, TimeoutPolicy } from './contracts.ts';

export interface IntelligenceRuntimeConfig {
  activeProviderId: string;
  timeout: TimeoutPolicy;
  retry: RetryPolicy;
  useGatewayNarrative: boolean;
  useGatewayAnalysis: boolean;
  useGatewayChat: boolean;
  useGatewayBlockAssist: boolean;
  useGatewayCopilot: boolean;
  modelNarrative: string;
  modelAnalysis: string;
  modelChat: string;
  modelBlockAssist: string;
  modelCopilot: string;
}

export function getIntelligenceConfig(): IntelligenceRuntimeConfig {
  return {
    activeProviderId: readEnv('INTELLIGENCE_PROVIDER') ?? 'openai',
    timeout: {
      timeoutMs: parseInt(readEnv('INTELLIGENCE_TIMEOUT_MS') ?? '30000', 10),
    },
    retry: {
      maxRetries: parseInt(readEnv('INTELLIGENCE_MAX_RETRIES') ?? '1', 10),
      retryDelayMs: parseInt(readEnv('INTELLIGENCE_RETRY_DELAY_MS') ?? '250', 10),
    },
    useGatewayNarrative: readEnvBool('INTELLIGENCE_USE_GATEWAY_NARRATIVE', true),
    useGatewayAnalysis: readEnvBool('INTELLIGENCE_USE_GATEWAY_ANALYSIS', true),
    useGatewayChat: readEnvBool('INTELLIGENCE_USE_GATEWAY_CHAT', true),
    useGatewayBlockAssist: readEnvBool('INTELLIGENCE_USE_GATEWAY_BLOCK_ASSIST', true),
    useGatewayCopilot: readEnvBool('INTELLIGENCE_USE_GATEWAY_COPILOT', true),
    modelNarrative: readEnv('INTELLIGENCE_MODEL_NARRATIVE') ?? 'gpt-4o-mini',
    modelAnalysis: readEnv('INTELLIGENCE_MODEL_ANALYSIS') ?? 'gpt-4o-mini',
    modelChat: readEnv('INTELLIGENCE_MODEL_CHAT') ?? 'gpt-4o-mini',
    modelBlockAssist: readEnv('INTELLIGENCE_MODEL_BLOCK_ASSIST') ?? 'gpt-4o-mini',
    modelCopilot: readEnv('INTELLIGENCE_MODEL_COPILOT') ?? 'gpt-4o-mini',
  };
}

export function isGatewayEnabledForFeature(
  feature: 'narrative' | 'analysis' | 'chat' | 'block_assist' | 'copilot',
): boolean {
  const cfg = getIntelligenceConfig();
  switch (feature) {
    case 'narrative': return cfg.useGatewayNarrative;
    case 'analysis': return cfg.useGatewayAnalysis;
    case 'chat': return cfg.useGatewayChat;
    case 'block_assist': return cfg.useGatewayBlockAssist;
    case 'copilot': return cfg.useGatewayCopilot;
  }
}
