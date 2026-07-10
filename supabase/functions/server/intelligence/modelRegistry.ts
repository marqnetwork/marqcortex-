import { readEnv } from './env.ts';
import type { ProviderModelConfig, IntelligenceFeature } from './contracts.ts';
import { getIntelligenceConfig } from './config.ts';

const DEFAULT_CAPABILITIES = {
  textGeneration: true,
  structuredOutput: true,
  chatCompletions: true,
  maxOutputTokens: 4096,
};

const PROFILE_BY_FEATURE: Record<IntelligenceFeature, string> = {
  narrative: 'narrative-default',
  analysis: 'analysis-default',
  chat: 'chat-default',
  block_assist: 'block-default',
  copilot: 'copilot-default',
};

function modelForProfile(profileId: string): string {
  const cfg = getIntelligenceConfig();
  switch (profileId) {
    case 'narrative-default': return cfg.modelNarrative;
    case 'analysis-default': return cfg.modelAnalysis;
    case 'chat-default': return cfg.modelChat;
    case 'block-default': return cfg.modelBlockAssist;
    case 'copilot-default': return cfg.modelCopilot;
    default: return cfg.modelNarrative;
  }
}

const modelRegistry = new Map<string, ProviderModelConfig>();

export function registerModel(config: ProviderModelConfig): void {
  if (modelRegistry.has(config.profileId)) {
    throw new Error(`Duplicate model profile registration: ${config.profileId}`);
  }
  modelRegistry.set(config.profileId, config);
}

export function resolveModelProfile(
  profileId: string,
  providerId: string,
): ProviderModelConfig {
  const existing = modelRegistry.get(profileId);
  if (existing && existing.providerId === providerId) {
    return existing;
  }
  const modelId = modelForProfile(profileId);
  return {
    profileId,
    providerId,
    modelId,
    capabilities: { ...DEFAULT_CAPABILITIES },
  };
}

export function resolveModelForFeature(
  feature: IntelligenceFeature,
  providerId: string,
): ProviderModelConfig {
  const profileId = PROFILE_BY_FEATURE[feature];
  return resolveModelProfile(profileId, providerId);
}

export function initializeModelRegistry(providerId: string): void {
  modelRegistry.clear();
  const profiles = [
    'narrative-default',
    'analysis-default',
    'chat-default',
    'block-default',
    'copilot-default',
  ];
  for (const profileId of profiles) {
    registerModel({
      profileId,
      providerId,
      modelId: modelForProfile(profileId),
      capabilities: { ...DEFAULT_CAPABILITIES },
      defaultTemperature: profileId === 'chat-default' ? 0.7 : 0.4,
      defaultMaxTokens: profileId === 'analysis-default' ? 2500 : 800,
    });
  }
}

export function resetModelRegistryForTests(): void {
  modelRegistry.clear();
}

export function getRegisteredModelProfiles(): string[] {
  return [...modelRegistry.keys()];
}
