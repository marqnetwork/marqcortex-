/**
 * Deterministic mock provider.
 *
 * Serves two purposes:
 *
 *   Testing — every control plane behaviour (retry, failover, circuit breaking,
 *   output guard rejection, timeout) needs a provider that produces a chosen
 *   outcome on demand, with no network and no flakiness.
 *
 *   Local development — the platform runs end to end with no vendor credentials,
 *   which keeps API keys off developer machines.
 *
 * Scenarios are selected by a `[[scenario:name]]` directive in the last user
 * message. Deliberately NOT read from request metadata: metadata is
 * caller-controlled and travels through the same envelope in production, so a
 * metadata-driven switch would be a production-reachable behaviour toggle. A
 * directive inside prompt text can only be placed there by a test that
 * constructs the prompt.
 *
 * `productionReady: false` keeps the mock out of production selection even when
 * it is registered: the registry's `validate()` reports a deployment where the
 * mock is the only usable provider.
 */

import type {
  AIProviderAdapter,
  AIProviderCompletion,
  AIProviderDescriptor,
  AIProviderInvocation,
} from '../contracts/provider.ts';
import { AIError } from '../contracts/errors.ts';

export type MockScenario =
  | 'success'
  | 'timeout'
  | 'unavailable'
  | 'rate_limited'
  | 'auth_failed'
  | 'invalid_json'
  | 'missing_fields'
  | 'empty'
  | 'guarantee_language'
  | 'jargon'
  | 'oversized'
  | 'fail_once'
  | 'hang';

const SCENARIO_DIRECTIVE = /\[\[scenario:([a-z_]+)\]\]/;

const MODELS: AIProviderDescriptor['models'] = [
  {
    modelId: 'mock-standard',
    providerId: 'mock',
    capabilities: {
      textGeneration: true,
      structuredOutput: true,
      chatCompletions: true,
      maxOutputTokens: 8_192,
      maxContextTokens: 128_000,
      zeroDataRetention: true,
    },
    promptMicroUsdPer1k: 0,
    completionMicroUsdPer1k: 0,
  },
];

export interface MockProviderOptions {
  /** Forces a scenario regardless of prompt content. Test harness only. */
  readonly forceScenario?: MockScenario;
  /** Priority override, for selection-order tests. */
  readonly priority?: number;
  /** Provider id override, so several mocks can model a multi-vendor estate. */
  readonly providerId?: string;
  /** Credential presence, so "no credentials" paths are testable. */
  readonly credentials?: boolean;
  /**
   * Model this mock as a PAID provider, so the spend ceiling and the
   * real-request kill switch can be exercised without a vendor account.
   *
   * Defaults to false. A mock that billed by default would let a test suite
   * consume the platform's real $9 ledger, which is the exact failure the
   * ceiling exists to prevent.
   */
  readonly billable?: boolean;
  /** Per-1k token prices, so a test can drive the ledger to a known figure. */
  readonly pricing?: { promptMicroUsdPer1k: number; completionMicroUsdPer1k: number };
  /** Declare the mock production-ready, for health and selection tests. */
  readonly productionReady?: boolean;
}

export interface MockProviderHandle extends AIProviderAdapter {
  /** Invocations received, in order. Lets tests assert on failover behaviour. */
  readonly calls: AIProviderInvocation[];
  /** Change the forced scenario between calls. */
  setScenario(scenario: MockScenario | undefined): void;
}

export function createMockProvider(options: MockProviderOptions = {}): MockProviderHandle {
  const providerId = options.providerId ?? 'mock';
  const calls: AIProviderInvocation[] = [];
  let forced = options.forceScenario;
  let failuresEmitted = 0;

  const descriptor: AIProviderDescriptor = {
    providerId,
    displayName: `Mock Provider (${providerId})`,
    priority: options.priority ?? 900,
    models: MODELS.map((model) => ({
      ...model,
      providerId,
      promptMicroUsdPer1k: options.pricing?.promptMicroUsdPer1k ?? model.promptMicroUsdPer1k,
      completionMicroUsdPer1k:
        options.pricing?.completionMicroUsdPer1k ?? model.completionMicroUsdPer1k,
    })),
    productionReady: options.productionReady ?? false,
    // Synthetic completions, no vendor call, no cost. Safe under the kill
    // switch unless a test explicitly asks for a billable mock.
    billable: options.billable ?? false,
  };

  return {
    descriptor,
    calls,

    setScenario(scenario) {
      forced = scenario;
      failuresEmitted = 0;
    },

    hasCredentials() {
      return options.credentials ?? true;
    },

    async invoke(invocation: AIProviderInvocation): Promise<AIProviderCompletion> {
      calls.push(invocation);
      const scenario = forced ?? scenarioFromPrompt(invocation);

      switch (scenario) {
        case 'timeout':
          throw new AIError('PROVIDER_TIMEOUT', 'The AI provider did not respond in time.', {
            providerId,
            diagnostics: 'mock scenario: timeout',
          });
        case 'unavailable':
          throw new AIError('PROVIDER_UNAVAILABLE', 'The AI provider is temporarily unavailable.', {
            providerId,
            diagnostics: 'mock scenario: unavailable',
          });
        case 'rate_limited':
          throw new AIError('PROVIDER_RATE_LIMITED', 'The AI provider is rate limiting this platform.', {
            providerId,
            diagnostics: 'mock scenario: rate limited',
            retryAfterSeconds: 1,
          });
        case 'auth_failed':
          throw new AIError('PROVIDER_AUTH_FAILED', 'The AI provider rejected the platform credential.', {
            providerId,
            diagnostics: 'mock scenario: auth failed',
          });
        case 'fail_once':
          // Fails the first attempt only, so retry success is observable.
          if (failuresEmitted === 0) {
            failuresEmitted += 1;
            throw new AIError('PROVIDER_UNAVAILABLE', 'The AI provider is temporarily unavailable.', {
              providerId,
              diagnostics: 'mock scenario: fail_once (first attempt)',
            });
          }
          break;
        case 'hang':
          // Never settles on its own; the caller's deadline resolves it. Used to
          // prove timeout handling without depending on a real slow network.
          await new Promise<void>((_resolve, reject) => {
            invocation.signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          });
          break;
        default:
          break;
      }

      const content = renderContent(scenario, invocation);
      return {
        content,
        modelId: invocation.modelId,
        usage: {
          promptTokens: estimateTokens(invocation),
          completionTokens: Math.ceil(content.length / 4),
          totalTokens: estimateTokens(invocation) + Math.ceil(content.length / 4),
        },
        finishReason: 'stop',
      };
    },
  };
}

function scenarioFromPrompt(invocation: AIProviderInvocation): MockScenario {
  for (const message of invocation.generation.messages) {
    if (message.role === 'system') continue;
    const match = message.content.match(SCENARIO_DIRECTIVE);
    if (match) return match[1] as MockScenario;
  }
  return 'success';
}

function estimateTokens(invocation: AIProviderInvocation): number {
  const characters = invocation.generation.messages.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  return Math.ceil(characters / 4);
}

function renderContent(scenario: MockScenario, invocation: AIProviderInvocation): string {
  const wantsJson = invocation.generation.responseFormat === 'json_object';

  switch (scenario) {
    case 'empty':
      return '   ';
    case 'invalid_json':
      return 'not json at all {{{';
    case 'missing_fields':
      return JSON.stringify({ unrelated: true });
    case 'guarantee_language':
      return wantsJson
        ? JSON.stringify({ ...structuredBody(invocation), diff_summary: 'We guarantee ROI of 40%.' })
        : 'This engagement offers guaranteed ROI within two quarters.';
    case 'jargon':
      return wantsJson
        ? JSON.stringify({ ...structuredBody(invocation), diff_summary: 'Streamline and optimize the workflow.' })
        : 'We will optimize and streamline the operating model.';
    case 'oversized':
      return 'x'.repeat(200_000);
    default:
      return wantsJson
        ? JSON.stringify(structuredBody(invocation))
        : `Deterministic mock narrative. The deterministic engine produced these figures; this text explains them without changing any of them.`;
  }
}

/**
 * A structured body wide enough to satisfy every JSON feature's required
 * fields, so one mock serves the whole catalog without per-feature branching.
 */
function structuredBody(invocation: AIProviderInvocation): Record<string, unknown> {
  return {
    proposed_content: { text: 'Deterministic mock content for the requested section.' },
    diff_summary: 'Mock revision applied to the narrative only.',
    // AI-01 Batch 3A: the agent step feature's contract. Kept here with every
    // other feature's fields for the reason stated above — one mock serves the
    // whole catalog, and a per-feature branch is how a mock starts encoding
    // assumptions the real providers do not share.
    result: { finding: 'Deterministic mock result for the requested objective.' },
    summary: 'Mock agent step completed.',
    intent: 'rewrite_tone',
    intent_label: 'Rewrite tone',
    targets: [],
    skipped: [],
    roi_recalc_required: false,
    urgencyLevel: 6,
    impactPotential: 7,
    readinessScore: 'Medium',
    confidenceScore: 'Medium',
    primaryPainSignal: 'Manual handoffs are creating avoidable rework.',
    aiScore: 72,
    qualityScore: 68,
    priority: 'medium',
    coreProblems: [
      {
        title: 'Manual intake handoffs',
        whatsbroken: 'Intake is re-keyed between three systems.',
        whyBreaking: 'No shared record of truth between intake and delivery.',
        whatBreaksNext: 'Delivery slips as volume grows.',
        urgencyScore: 7,
      },
    ],
    pillarHeatmap: {
      operationsExecution: 2,
      revenueGrowth: 3,
      systemsAutomation: 1,
      aiReadinessGovernance: 2,
    },
    riskFlags: [],
    recommendation: {
      primaryService: 'operations-audit',
      primaryServiceLabel: 'Operations Audit',
      reasoning: 'The submission points to process instability before tooling.',
      notRecommended: [],
      focusAreas: ['Intake mapping'],
      suggestedTimeline: '8-12 weeks',
    },
    roiEstimate: {
      hoursSavedPerMonth: { conservative: 40, aggressive: 80 },
      costAvoidedPerMonth: { conservative: 4_000, aggressive: 9_000 },
      revenueLeakageReduced: { conservative: 2_000, aggressive: 6_000 },
      operationalRiskReduction: 'medium',
    },
    callPrep: {
      suggestedAgenda: ['Confirm intake volumes'],
      keyQuestionsToValidate: ['Who owns intake today?'],
      expectedObjections: [],
      doNotPitchYetWarnings: [],
      expansionSignalsToListenFor: [],
    },
    analysisNotes: `Mock analysis for request ${invocation.requestId}.`,
    narrative: 'Mock narrative body.',
  };
}
