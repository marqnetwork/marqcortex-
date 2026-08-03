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

/**
 * Rule names, in evaluation order. Named rather than positional: the ordered
 * list ends up on the audit record, and an index shift when a rule is inserted
 * would silently relabel every denial recorded after it.
 */
const RULE = {
  platform: 'platform.ai_enabled',
  feature: 'feature.enabled',
  actorType: 'actor.type_allowed',
  channel: 'channel.allowed',
  capability: 'capability.granted',
  budget: 'budget.available',
} as const;

/**
 * The platform-wide administrative posture, read live.
 *
 * A function rather than a value because an administrator's change has to take
 * effect on the very next request — an emergency kill switch that waits for an
 * isolate to recycle is not a kill switch. The policy engine stays pure: it
 * still computes a decision from its inputs, it just reads one of them at
 * evaluation time.
 */
export interface PlatformAIState {
  readonly enabled: boolean;
  /** Reason recorded when the master switch or emergency stop is engaged. */
  readonly haltReason?: string;
}

const PERMITTED: PlatformAIState = { enabled: true };

export function createPolicyEngine(
  budgetEngine: BudgetEngine,
  budgetPolicy: AIBudgetPolicy,
  platformState: () => PlatformAIState = () => PERMITTED,
): PolicyEngine {
  function evaluate(
    context: AIRequestContext,
    descriptor: AIFeatureDescriptor,
  ): PolicyEvaluation {
    const evaluated: string[] = [];
    const allowedBudget: BudgetVerdict = { allowed: true, thresholdReached: false };

    // Evaluated first, before anything feature-specific. When an administrator
    // has stopped AI, WHY the request would otherwise have been refused is not
    // interesting, and evaluating further rules would put misleading detail on
    // the audit record for an incident.
    evaluated.push(RULE.platform);
    const platform = platformState();
    if (!platform.enabled) {
      return {
        decision: {
          effect: 'deny',
          evaluated,
          violation: {
            rule: RULE.platform,
            detail: platform.haltReason ?? 'AI is administratively disabled',
          },
        },
        budget: allowedBudget,
      };
    }

    evaluated.push(RULE.feature);
    if (!descriptor.enabled) {
      return {
        decision: {
          effect: 'deny',
          evaluated,
          violation: {
            rule: RULE.feature,
            detail: `feature ${descriptor.featureId} is disabled`,
          },
        },
        budget: allowedBudget,
      };
    }

    evaluated.push(RULE.actorType);
    if (!descriptor.allowedActorTypes.includes(context.actor.actorType)) {
      return {
        decision: {
          effect: 'deny',
          evaluated,
          violation: {
            rule: RULE.actorType,
            detail: `actor type ${context.actor.actorType} may not invoke ${descriptor.featureId}`,
          },
        },
        budget: allowedBudget,
      };
    }

    evaluated.push(RULE.channel);
    if (!descriptor.allowedChannels.includes(context.channel)) {
      return {
        decision: {
          effect: 'deny',
          evaluated,
          violation: {
            rule: RULE.channel,
            detail: `channel ${context.channel} may not invoke ${descriptor.featureId}`,
          },
        },
        budget: allowedBudget,
      };
    }

    evaluated.push(RULE.capability);
    if (!context.actor.capabilities.includes(descriptor.capability)) {
      return {
        decision: {
          effect: 'deny',
          evaluated,
          violation: {
            rule: RULE.capability,
            detail: `capability ${descriptor.capability} is not granted`,
          },
        },
        budget: allowedBudget,
      };
    }

    evaluated.push(RULE.budget);
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
            rule: RULE.budget,
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
    case 'platform.ai_enabled':
      // The caller-facing message says AI is paused, not why. The reason an
      // administrator gave for an emergency stop is operational information
      // and goes to diagnostics and the audit trail.
      return new AIError('AI_DISABLED', 'AI is currently paused by an administrator.', {
        diagnostics: detail,
      });
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
