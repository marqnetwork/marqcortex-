/**
 * Provider-neutral Intelligence Gateway contracts.
 * No provider-specific types. Server-side only.
 */

export type CertificationStatus =
  | 'Unverified'
  | 'Testing'
  | 'Certified'
  | 'Degraded'
  | 'Disabled';

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unavailable';

export type IntelligenceFeature =
  | 'narrative'
  | 'analysis'
  | 'chat'
  | 'block_assist'
  | 'copilot';

export type ResponseFormat = 'text' | 'json_object';

export type ProviderErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'MISSING_CREDENTIALS'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'INVALID_OUTPUT'
  | 'VALIDATION_FAILED'
  | 'PROVIDER_DISABLED'
  | 'CAPABILITY_MISMATCH'
  | 'PROVIDER_NOT_FOUND'
  | 'MODEL_NOT_FOUND'
  | 'UNKNOWN';

export interface ModelCapabilities {
  textGeneration: boolean;
  structuredOutput: boolean;
  chatCompletions: boolean;
  maxOutputTokens?: number;
}

export interface ProviderModelConfig {
  profileId: string;
  providerId: string;
  modelId: string;
  capabilities: ModelCapabilities;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
}

export interface ProviderConfig {
  providerId: string;
  displayName: string;
  enabled: boolean;
  certificationStatus: CertificationStatus;
  healthStatus: ProviderHealthStatus;
  capabilities: ModelCapabilities;
}

export interface ProviderHealth {
  providerId: string;
  status: ProviderHealthStatus;
  certificationStatus: CertificationStatus;
  credentialsConfigured: boolean;
  reason?: string;
  checkedAt: string;
}

export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface RetryPolicy {
  maxRetries: number;
  retryDelayMs: number;
}

export interface TimeoutPolicy {
  timeoutMs: number;
}

export interface StructuredOutputMetadata {
  format: ResponseFormat;
  requiredFields?: string[];
}

export interface NormalizedAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface NormalizedAIRequest {
  requestId: string;
  feature: IntelligenceFeature;
  messages: NormalizedAIMessage[];
  modelProfile: string;
  responseFormat: ResponseFormat;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, string>;
  structuredOutput?: StructuredOutputMetadata;
}

export interface NormalizedAIResponse {
  requestId: string;
  content: string;
  model: string;
  provider: string;
  usage?: ProviderUsage;
  finishReason?: string;
  generatedAt: string;
  attempt: number;
}

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  requestId: string;
  provider?: string;
  retryable: boolean;
  diagnostics?: string;
}

export interface ProviderInvokeContext {
  request: NormalizedAIRequest;
  resolvedModelId: string;
  providerId: string;
  attempt: number;
  signal?: AbortSignal;
}

export interface AIProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;
  checkCredentials(): boolean;
  generate(ctx: ProviderInvokeContext): Promise<NormalizedAIResponse>;
}

export interface TelemetryRecord {
  requestId: string;
  feature: IntelligenceFeature;
  provider: string;
  model: string;
  attempt: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  outcome: 'success' | 'error';
  errorCode?: ProviderErrorCode;
  timestamp: string;
}
