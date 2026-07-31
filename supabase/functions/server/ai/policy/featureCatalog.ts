/**
 * Feature Catalog.
 *
 * The catalog is the single place that answers "what AI capabilities does this
 * platform have, and how is each one governed?". A feature definition binds:
 *
 *   descriptor      — declarative governance (owner, capability, limits, rules)
 *   inputValidator  — the exact shape the guard accepts from callers
 *   buildVariables  — validated input → prompt variables (no free-form strings)
 *   parseOutput     — raw model content → the feature's typed output
 *   applyFactLock   — deterministic restoration of authoritative fields
 *
 * A feature cannot execute unless it is registered here, and registration is
 * data. New AI capabilities are added by writing a definition — never by adding
 * a branch to the execution path.
 */

import type { AIFeatureDescriptor } from '../contracts/policy.ts';
import type { AIMessage, AIRequestContext } from '../contracts/request.ts';
import type { Validator } from '../security/validation.ts';
import { AIError } from '../contracts/errors.ts';

export interface FactLockOutcome<TOutput> {
  readonly output: TOutput;
  /** Fields the model changed and the platform put back. */
  readonly restored: readonly string[];
}

export interface AIFeatureDefinition<TInput = unknown, TOutput = unknown> {
  readonly descriptor: AIFeatureDescriptor;
  readonly inputValidator: Validator<TInput>;
  /**
   * Select the prompt for this invocation. Defaults to `descriptor.promptId`.
   * Implemented only by features whose input selects between sibling prompts
   * (the narrative feature picks one of three explanation prompts); the
   * returned id must still resolve in the prompt registry.
   */
  resolvePromptId?(input: TInput): string;
  /** Prompt variables. Values are interpolated into the registered template. */
  buildVariables(input: TInput, context: AIRequestContext): Readonly<Record<string, string>>;
  /**
   * Extra conversation turns appended after the rendered prompt — used by chat,
   * where prior turns are data rather than template content.
   */
  buildConversation?(input: TInput): readonly AIMessage[];
  /** Turn raw model content into the feature's output contract. */
  parseOutput(content: string, input: TInput): TOutput;
  /** Restore authoritative values the model must never decide. */
  applyFactLock?(output: TOutput, input: TInput): FactLockOutcome<TOutput>;
}

export interface FeatureCatalog {
  register(definition: AIFeatureDefinition<never, never>): void;
  /** Throws FEATURE_NOT_FOUND rather than returning undefined. */
  require(featureId: string): AIFeatureDefinition<unknown, unknown>;
  get(featureId: string): AIFeatureDefinition<unknown, unknown> | undefined;
  list(): readonly AIFeatureDescriptor[];
  size(): number;
  clear(): void;
}

export function createFeatureCatalog(): FeatureCatalog {
  const definitions = new Map<string, AIFeatureDefinition<unknown, unknown>>();

  return {
    register(definition) {
      const typed = definition as unknown as AIFeatureDefinition<unknown, unknown>;
      const { featureId } = typed.descriptor;
      if (definitions.has(featureId)) {
        throw new AIError('INTERNAL_ERROR', 'AI feature is already registered.', {
          diagnostics: `duplicate feature registration: ${featureId}`,
        });
      }
      validateDescriptor(typed.descriptor);
      definitions.set(featureId, typed);
    },

    require(featureId) {
      const definition = definitions.get(featureId);
      if (!definition) {
        throw new AIError('FEATURE_NOT_FOUND', 'Unknown AI feature.', {
          diagnostics: `featureId=${featureId}`,
        });
      }
      return definition;
    },

    get(featureId) {
      return definitions.get(featureId);
    },

    list() {
      return [...definitions.values()]
        .map((d) => d.descriptor)
        .sort((a, b) => a.featureId.localeCompare(b.featureId));
    },

    size() {
      return definitions.size;
    },

    clear() {
      definitions.clear();
    },
  };
}

/**
 * Reject a descriptor that would be unsafe at runtime. Catching this at
 * registration means a misconfigured feature fails at bootstrap — loudly, on
 * every instance — instead of at 3am on one request.
 */
function validateDescriptor(descriptor: AIFeatureDescriptor): void {
  const problems: string[] = [];
  if (!descriptor.featureId.trim()) problems.push('featureId is empty');
  if (!descriptor.featureVersion.trim()) problems.push('featureVersion is empty');
  if (!descriptor.owner.trim()) problems.push('owner is empty');
  if (!descriptor.promptId.trim()) problems.push('promptId is empty');
  if (descriptor.allowedActorTypes.length === 0) problems.push('allowedActorTypes is empty');
  if (descriptor.allowedChannels.length === 0) problems.push('allowedChannels is empty');
  if (descriptor.temperature < 0 || descriptor.temperature > 2) {
    problems.push('temperature is outside 0–2');
  }
  if (descriptor.limits.maxAttempts < 1) problems.push('maxAttempts must be at least 1');
  if (descriptor.limits.timeoutMs < 1_000) problems.push('timeoutMs must be at least 1000');
  if (descriptor.limits.maxInputBytes < 1) problems.push('maxInputBytes must be positive');
  if (descriptor.limits.maxOutputTokens < 1) problems.push('maxOutputTokens must be positive');
  if (descriptor.limits.perActor.limit < 1) problems.push('perActor limit must be positive');
  if (descriptor.limits.perOrganization.limit < descriptor.limits.perActor.limit) {
    problems.push('perOrganization limit must be at least the perActor limit');
  }
  if (descriptor.responseFormat === 'json_object' && !descriptor.requiredCapabilities.structuredOutput) {
    problems.push('json_object features must require structuredOutput');
  }
  if (problems.length > 0) {
    throw new AIError('INTERNAL_ERROR', 'AI feature descriptor is invalid.', {
      diagnostics: `${descriptor.featureId}: ${problems.join('; ')}`,
    });
  }
}

// ── Shared limit presets ────────────────────────────────────────────────────
//
// Presets keep governance consistent across features and make an outlier
// obvious in review: a feature that does not use a preset is stating that it is
// genuinely different.

export const INTERACTIVE_LIMITS = {
  perActor: { limit: 30, windowMs: 60_000 },
  perOrganization: { limit: 300, windowMs: 60_000 },
  maxInputBytes: 64 * 1024,
  maxOutputTokens: 1_200,
  timeoutMs: 30_000,
  maxAttempts: 2,
} as const;

export const HEAVY_LIMITS = {
  perActor: { limit: 10, windowMs: 60_000 },
  perOrganization: { limit: 120, windowMs: 60_000 },
  maxInputBytes: 256 * 1024,
  maxOutputTokens: 2_500,
  timeoutMs: 60_000,
  maxAttempts: 2,
} as const;

export const STANDARD_GOVERNANCE = {
  redactInput: true,
  forbidGuaranteeLanguage: true,
  enforceToneBans: true,
  enforceResponseFormat: true,
  requiredOutputFields: [] as readonly string[],
  factLockedFields: [] as readonly string[],
  maxOutputChars: 24_000,
} as const;
