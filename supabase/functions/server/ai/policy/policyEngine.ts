/**
 * Policy Engine.
 *
 * Decides whether a fully-identified request is allowed to execute. It answers
 * a different question from the AI Guard: the guard establishes *who is asking*
 * and *whether the payload is acceptable*; the policy engine decides *whether
 * this actor may run this feature right now*.
 *
 * Rules are evaluated in a fixed order, cheapest and most absolute first, and
 * the ordered list of rule names is recorded on the decision. That list goes
 * into the audit record, so a denial is explainable after the fact without
 * re-running anything — which is what an enterprise compliance review asks for.
 *
 * The engine is pure: same inputs, same decision, no I/O.
 */

import type {
  AIBudgetPolicy,
  AIFeatureDescriptor,
  AIPolicyDecision,
} from '../contracts/policy.ts';
import type { AIRequestContext } from '../contracts/request.ts';
import type { BudgetEngine, BudgetVerdict } from './budget.ts';
import { AIError } from '../contracts/errors.ts';

export interface PolicyEvaluation {
  readonly decision: AIPolicyDecision;
  readonly budget: BudgetVerdict;
}

export interface PolicyEngine {
  evaluate(context: AIRequestContext, descriptor: AIFeatureDescriptor): PolicyEvaluation;
  /** Evaluate and throw the mapped `AIError` on denial. */
  enforce(context: AIRequestContext, descriptor: AIFeatureDescriptor): PolicyEvaluation;
}

const RULES = [
  'feature.enabled',
  'actor.type_allowed',
  'channel.allowed',
  'capability.granted',
  'budget.available',
] as const;

export function createPolicyEngine(
  budgetEngine: BudgetEngine,
  budgetPolicy: AIBudgetPolicy,
): PolicyEngine {
  function evaluate(
    context: AIRequestContext,
    descriptor: AIFeatureDescriptor,
  ): PolicyEvaluation {
    const evaluated: string[] = [];
    const allowedBudget: BudgetVerdict = { allowed: true, thresholdReached: false };

    evaluated.push(RULES[0]);
    if (!descriptor.enabled) {
      return {
        decision: {
          effect: 'deny',
          evaluated,
          violation: {
            rule: RULES[0],
            detail: `feature ${descriptor.featureId} is disabled`,
          },
        },
        budget: allowedBudget,
      };
    }

    evaluated.push(RULES[1]);
    if (!descriptor.allowedActorTypes.includes(context.actor.actorType)) {
      return {
        decision: {
          effect: 'deny',
          evaluated,
          violation: {
            rule: RULES[1],
            detail: `actor type ${context.actor.actorType} may not invoke ${descriptor.featureId}`,
          },
        },
        budget: allowedBudget,
      };
    }

    evaluated.push(RULES[2]);
    if (!descriptor.allowedChannels.includes(context.channel)) {
      return {
        decision: {
          effect: 'deny',
          evaluated,
          violation: {
            rule: RULES[2],
            detail: `channel ${context.channel} may not invoke ${descriptor.featureId}`,
          },
        },
        budget: allowedBudget,
      };
    }

    evaluated.push(RULES[3]);
    if (!context.actor.capabilities.includes(descriptor.capability)) {
      return {
        decision: {
          effect: 'deny',
          evaluated,
          violation: {
            rule: RULES[3],
            detail: `capability ${descriptor.capability} is not granted`,
          },
        },
        budget: allowedBudget,
      };
    }

    evaluated.push(RULES[4]);
    const budget = budgetEngine.authorize(
      context.organization.organizationId,
      context.actor.actorId,
      budgetPolicy,
    );
    if (!budget.allowed) {
      return {
        decision: {
          effect: 'deny',
          evaluated,
          violation: {
            rule: RULES[4],
            detail: `budget exhausted for ${budget.scope ?? 'unknown scope'}`,
          },
        },
        budget,
      };
    }

    return { decision: { effect: 'allow', evaluated }, budget };
  }

  return {
    evaluate,
    enforce(context, descriptor) {
      const evaluation = evaluate(context, descriptor);
      if (evaluation.decision.effect === 'allow') return evaluation;
      throw policyErrorFor(evaluation.decision, descriptor);
    },
  };
}

/**
 * Map a denial to its error code. The caller-facing message never repeats the
 * violation detail — that would tell an unauthorized caller exactly which
 * capability to go looking for. The detail goes to diagnostics and audit.
 *
 * Exported so a caller that needs the decision for its audit trail can evaluate
 * once and raise the mapped error itself, rather than evaluating twice.
 */
export function policyErrorFor(decision: AIPolicyDecision, descriptor: AIFeatureDescriptor): AIError {
  const detail = decision.violation?.detail ?? 'policy denied';
  switch (decision.violation?.rule) {
    case 'feature.enabled':
      return new AIError('FEATURE_DISABLED', 'This AI feature is currently unavailable.', {
        diagnostics: detail,
      });
    case 'capability.granted':
      return new AIError('CAPABILITY_DENIED', 'Your account is not permitted to use this AI feature.', {
        diagnostics: detail,
      });
    case 'budget.available':
      return new AIError('BUDGET_EXCEEDED', 'The AI budget for this period has been reached.', {
        diagnostics: detail,
      });
    case 'actor.type_allowed':
    case 'channel.allowed':
      return new AIError('FORBIDDEN', 'This AI feature is not available from this context.', {
        diagnostics: detail,
      });
    default:
      return new AIError('POLICY_DENIED', 'This AI request was denied by platform policy.', {
        diagnostics: `${descriptor.featureId}: ${detail}`,
      });
  }
}
