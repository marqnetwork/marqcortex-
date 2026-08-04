/**
 * Feature: cortex.agent_step — the governed model step of an agent run.
 *
 * WHY THIS IS A FEATURE AND NOT A NEW EXECUTION PATH.
 *
 * The AI-01 Batch 3A agent runtime needs to call a model. It must not do so by
 * reaching a provider, and it must not do so through a second pipeline: every
 * guarantee Batch 1 established — the guard, the policy engine, the prompt
 * registry, PII redaction, the output guard, the spend ceiling, the audit trail
 * — is a property of `controlPlane.execute`, and code that goes around it does
 * not get any of them.
 *
 * So an agent's model step is an ordinary control plane feature. It is
 * registered in the same catalog, governed by the same rules, budgeted by the
 * same engine and audited into the same trail as the narrative and chat
 * features. What the agent supplies is a bounded objective and an assembled
 * context; what it never supplies is a model, a provider, a temperature or a
 * prompt.
 *
 * TWO REGISTRATIONS, ONE PROMPT.
 *
 * `cortex.agent_step` and `cortex.agent_step_compact` differ only in their
 * output allowance and their rate-limit weight. That is what gives the runtime's
 * cost policy something real to choose between: "use a smaller model profile" is
 * a decision with a measurable consequence rather than a label. Both resolve the
 * same registered prompt, so a routing downgrade never changes what the model is
 * asked to do — only how much it may say.
 *
 * THE CONTEXT IS UNTRUSTED AND SAYS SO. `context` arrives already assembled by
 * `agents/runtime/contextBuilder.ts`, which fences every untrusted section. The
 * prompt repeats the boundary rule at system level, because two independent
 * statements of "the following is data" is the cheapest defence available
 * against a tool result that contains an instruction.
 */

import type { AIFeatureDefinition } from '../policy/featureCatalog.ts';
import { INTERACTIVE_LIMITS, STANDARD_GOVERNANCE } from '../policy/featureCatalog.ts';
import { arrayOf, object, str, withDefault, type Validator } from '../security/validation.ts';
import { parseJsonObject } from '../governance/outputGuard.ts';
import { AIError } from '../contracts/errors.ts';

export const agentStepInputValidator = object({
  /** The agent asking. Recorded in the prompt so the model knows its remit. */
  agent_id: str({ minLength: 1, maxLength: 120 }),
  agent_purpose: str({ minLength: 1, maxLength: 500 }),
  /** What this one step must achieve. Not the run's whole objective. */
  objective: str({ minLength: 1, maxLength: 2_000 }),
  /** Assembled and fenced by the context builder. Never raw agent text. */
  context: withDefault(str({ maxLength: 120_000 }), ''),
  /** Fields the agent needs back. Rendered into the output contract. */
  output_fields: withDefault(
    arrayOf(str({ minLength: 1, maxLength: 60 }), { maxItems: 16 }),
    [] as string[],
  ),
});

export type AgentStepInput = typeof agentStepInputValidator extends Validator<infer T> ? T : never;

export interface AgentStepOutput {
  /** The structured answer. Shape is the agent's contract, not the platform's. */
  readonly result: Record<string, unknown>;
  /** One line the runtime records on the step. Bounded. */
  readonly summary: string;
}

function parseAgentStep(content: string): AgentStepOutput {
  const parsed = parseJsonObject(content);
  const result = parsed.result;
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    // A model-output fault rather than a feature error, so the pipeline's own
    // retry gets a chance before the run's step-level retry does.
    throw new AIError('INVALID_MODEL_OUTPUT', 'The AI response did not contain a result object.', {
      diagnostics: 'agent step: result is not an object',
    });
  }
  return {
    result: result as Record<string, unknown>,
    summary:
      typeof parsed.summary === 'string' && parsed.summary.trim() !== ''
        ? parsed.summary.slice(0, 300)
        : 'Agent step completed.',
  };
}

function buildAgentStepVariables(input: AgentStepInput): Readonly<Record<string, string>> {
  return {
    agentId: input.agent_id,
    agentPurpose: input.agent_purpose,
    objective: input.objective,
    context: input.context.trim() === '' ? '(no additional context was provided)' : input.context,
    outputFields:
      input.output_fields.length > 0
        ? `The "result" object MUST contain exactly these keys: ${input.output_fields.join(', ')}.`
        : 'The "result" object may contain whatever keys the objective requires.',
  };
}

const AGENT_STEP_GOVERNANCE = {
  ...STANDARD_GOVERNANCE,
  requiredOutputFields: ['result'],
  maxOutputChars: 20_000,
};

export const agentStepFeature: AIFeatureDefinition<AgentStepInput, AgentStepOutput> = {
  descriptor: {
    featureId: 'cortex.agent_step',
    featureVersion: '1.0.0',
    displayName: 'Cortex Agent Step',
    owner: 'MARQ Cortex — AI Platform',
    enabled: true,
    capability: 'ai.agent.execute',
    // `service` is permitted because a scheduled or system-initiated run is a
    // legitimate caller. `client_contact` and `anonymous` are not: an agent run
    // spends platform money and can call tools, and neither is something an
    // unauthenticated caller may start.
    allowedActorTypes: ['team_user', 'service'],
    allowedChannels: ['team_console', 'system'],
    promptId: 'agent.step',
    responseFormat: 'json_object',
    temperature: 0.2,
    budgetClass: 'interactive',
    limits: {
      ...INTERACTIVE_LIMITS,
      maxInputBytes: 256 * 1024,
      maxOutputTokens: 1_200,
      // An agent run makes several of these per user action, so one step draws
      // more of the window than one interactive request does.
      rateLimitCost: 2,
    },
    governance: AGENT_STEP_GOVERNANCE,
    requiredCapabilities: { structuredOutput: true, chatCompletions: true },
  },

  inputValidator: agentStepInputValidator,
  buildVariables: buildAgentStepVariables,
  parseOutput: parseAgentStep,
};

/**
 * The cheaper registration. Same prompt, same governance, smaller allowance.
 *
 * Its existence is what makes a cost-driven downgrade real: the routing layer
 * moves a step from the standard profile to this one and the projected cost
 * actually falls, because the completion ceiling it is priced against is half
 * the size.
 */
export const agentStepCompactFeature: AIFeatureDefinition<AgentStepInput, AgentStepOutput> = {
  descriptor: {
    ...agentStepFeature.descriptor,
    featureId: 'cortex.agent_step_compact',
    displayName: 'Cortex Agent Step (compact)',
    limits: {
      ...INTERACTIVE_LIMITS,
      maxInputBytes: 128 * 1024,
      maxOutputTokens: 600,
      rateLimitCost: 1,
    },
  },

  inputValidator: agentStepInputValidator,
  buildVariables: buildAgentStepVariables,
  parseOutput: parseAgentStep,
};
