/**
 * Token intelligence (AI-01 Batch 3A).
 *
 * Three jobs, in the order a step performs them:
 *
 *   ESTIMATE, BEFORE. What will this step cost in tokens? The answer decides
 *   whether the step happens at all — a run projected to cross its token
 *   ceiling is refused BEFORE the control plane is called, so the ceiling holds
 *   without a vendor request having been made. That ordering is the whole point:
 *   a limit enforced after the call is an accounting entry, not a control.
 *
 *   RECONCILE, AFTER. The provider reports what it actually used. The variance
 *   between estimate and actual is recorded rather than discarded, because a
 *   systematically low estimator is a control that will eventually fail open,
 *   and the only way to know is to keep the difference.
 *
 *   ATTRIBUTE. Every measured token lands on one row keyed by organization,
 *   actor, run, workflow, agent, feature, provider and model. Those are exactly
 *   the dimensions an invoice reconciliation and a per-tenant cost report need,
 *   and deriving them later from logs is the thing nobody ever gets to do.
 *
 * PROVIDER-NEUTRAL BY CONSTRUCTION. Nothing here knows a vendor's usage field
 * names. The runtime consumes `AITokenUsage` — the platform's own contract from
 * Batch 1 — and the provider adapters are what translate a vendor's shape into
 * it. A second translation here would be a second thing to update per vendor.
 *
 * ESTIMATION IS DELIBERATELY PESSIMISTIC. Four bytes per token is the
 * conventional English-text ratio and is used identically in `policy/spendGuard.ts`;
 * completion tokens are estimated at the profile's full allowance rather than at
 * a guess about what the model will actually emit. Over-estimating costs a
 * little headroom; under-estimating lets a ceiling be crossed.
 */

import type { AITokenUsage } from '../../contracts/request.ts';
import type { AgentLimits } from '../contracts/agent.ts';
import type { AgentTokenLedger, AgentUsageAttribution } from '../contracts/runtime.ts';

/** Bytes of text per prompt token. Sizing only — billing uses reported usage. */
export const BYTES_PER_TOKEN = 4;

/** Rows an attribution ledger keeps. Bounded so a record cannot grow forever. */
const MAX_ATTRIBUTION_ROWS = 32;

export interface TokenEstimate {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export function emptyTokenLedger(): AgentTokenLedger {
  return {
    estimatedPromptTokens: 0,
    estimatedCompletionTokens: 0,
    estimatedTotalTokens: 0,
    actualPromptTokens: 0,
    actualCompletionTokens: 0,
    cachedTokens: 0,
    actualTotalTokens: 0,
    reconciliationVarianceTokens: 0,
    attribution: [],
  };
}

/** Prompt tokens implied by a body of text. */
export function estimatePromptTokens(text: string): number {
  const bytes =
    typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length;
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

/**
 * Estimate for one model step.
 *
 * `agentEstimate` is the agent's own opinion, and the LARGER of the two wins.
 * An agent that under-estimates cannot buy itself headroom, and an agent that
 * over-estimates is taken at its word — the conservative direction in both
 * cases, which is the only safe way to accept a number from the component whose
 * authority this batch is limiting.
 */
export function estimateModelStep(input: {
  readonly promptText: string;
  readonly maxCompletionTokens: number;
  readonly agentEstimate?: { promptTokens?: number; completionTokens?: number };
}): TokenEstimate {
  const promptTokens = Math.max(
    estimatePromptTokens(input.promptText),
    Math.max(0, Math.floor(input.agentEstimate?.promptTokens ?? 0)),
  );
  const completionTokens = Math.max(
    input.maxCompletionTokens,
    Math.max(0, Math.floor(input.agentEstimate?.completionTokens ?? 0)),
  );
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

export interface TokenPreflightAccepted {
  readonly ok: true;
  readonly estimate: TokenEstimate;
}

export interface TokenPreflightRefusal {
  readonly ok: false;
  readonly estimate: TokenEstimate;
  /** Which ceiling the step would cross. */
  readonly limit: 'prompt' | 'completion' | 'total';
  readonly diagnostics: string;
  /**
   * Tokens the prompt would have to shed for the step to fit, when the prompt
   * is what does not fit. Zero when trimming cannot help — the completion
   * allowance or the total is the binding constraint.
   */
  readonly reduceContextBy: number;
}

export type TokenPreflightDecision = TokenPreflightAccepted | TokenPreflightRefusal;

/**
 * Narrow a decision to its refusal.
 *
 * A user-defined type guard rather than a bare `!decision.ok`, for the same
 * reason `policy/spendLedger.ts` has `isSpendDenied`: discriminating a union on
 * a boolean literal needs `strictNullChecks`, which the repository's Node/test
 * boundary does not enable. The guard narrows identically under both toolchains.
 */
export function isTokenPreflightRefused(
  decision: TokenPreflightDecision,
): decision is TokenPreflightRefusal {
  return decision.ok === false;
}

/**
 * Would this step cross a token ceiling? Called before every model call.
 *
 * The answer distinguishes "trim the context and this fits" from "no amount of
 * trimming helps", because the first is a recoverable decision the orchestrator
 * can act on and the second is the end of the run.
 */
export function tokenPreflight(input: {
  readonly ledger: AgentTokenLedger;
  readonly limits: AgentLimits;
  readonly estimate: TokenEstimate;
}): TokenPreflightDecision {
  const { ledger, limits, estimate } = input;

  const projectedPrompt = ledger.actualPromptTokens + estimate.promptTokens;
  const projectedCompletion = ledger.actualCompletionTokens + estimate.completionTokens;
  const projectedTotal = ledger.actualTotalTokens + estimate.totalTokens;

  if (projectedPrompt > limits.maxPromptTokens) {
    return {
      ok: false,
      estimate,
      limit: 'prompt',
      diagnostics: `projected prompt tokens ${projectedPrompt} exceed limit ${limits.maxPromptTokens}`,
      reduceContextBy: projectedPrompt - limits.maxPromptTokens,
    };
  }
  if (projectedCompletion > limits.maxCompletionTokens) {
    return {
      ok: false,
      estimate,
      limit: 'completion',
      diagnostics: `projected completion tokens ${projectedCompletion} exceed limit ${limits.maxCompletionTokens}`,
      reduceContextBy: 0,
    };
  }
  if (projectedTotal > limits.maxTotalTokens) {
    const overshoot = projectedTotal - limits.maxTotalTokens;
    // Trimming the prompt helps only if the prompt is large enough to give the
    // overshoot back. Otherwise the completion allowance is what does not fit.
    return {
      ok: false,
      estimate,
      limit: 'total',
      diagnostics: `projected total tokens ${projectedTotal} exceed limit ${limits.maxTotalTokens}`,
      reduceContextBy: estimate.promptTokens > overshoot ? overshoot : 0,
    };
  }

  return { ok: true, estimate };
}

/** Fold a step's ESTIMATE into the ledger. Called before the step runs. */
export function recordEstimate(ledger: AgentTokenLedger, estimate: TokenEstimate): AgentTokenLedger {
  return {
    ...ledger,
    estimatedPromptTokens: ledger.estimatedPromptTokens + estimate.promptTokens,
    estimatedCompletionTokens: ledger.estimatedCompletionTokens + estimate.completionTokens,
    estimatedTotalTokens: ledger.estimatedTotalTokens + estimate.totalTokens,
  };
}

export interface UsageAttributionKey {
  readonly agentId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly feature: string;
}

/**
 * Fold measured usage into the ledger and reconcile it against the estimate.
 *
 * The attribution row is merged by its full key, so repeated calls to the same
 * (agent, provider, model, feature) accumulate rather than multiplying rows.
 * Past `MAX_ATTRIBUTION_ROWS` distinct keys the totals still accumulate on the
 * ledger itself and further rows are dropped — a bounded record that under-
 * reports its own breakdown is better than an unbounded one that cannot be
 * written at all, and a run cannot legitimately reach 32 distinct keys inside
 * its 64-step ceiling without something already having gone wrong.
 */
export function reconcileUsage(
  ledger: AgentTokenLedger,
  input: {
    readonly estimate: TokenEstimate;
    readonly usage: AITokenUsage;
    readonly cachedTokens?: number;
    readonly costMicroUsd: number;
    readonly key: UsageAttributionKey;
  },
): AgentTokenLedger {
  const cached = Math.max(0, Math.floor(input.cachedTokens ?? 0));
  const variance = input.usage.totalTokens - input.estimate.totalTokens;

  const existing = ledger.attribution.find(
    (row) =>
      row.agentId === input.key.agentId &&
      row.providerId === input.key.providerId &&
      row.modelId === input.key.modelId &&
      row.feature === input.key.feature,
  );

  let attribution: readonly AgentUsageAttribution[];
  if (existing) {
    attribution = ledger.attribution.map((row) =>
      row === existing
        ? {
            ...row,
            promptTokens: row.promptTokens + input.usage.promptTokens,
            completionTokens: row.completionTokens + input.usage.completionTokens,
            cachedTokens: row.cachedTokens + cached,
            totalTokens: row.totalTokens + input.usage.totalTokens,
            costMicroUsd: row.costMicroUsd + input.costMicroUsd,
            calls: row.calls + 1,
          }
        : row,
    );
  } else if (ledger.attribution.length < MAX_ATTRIBUTION_ROWS) {
    attribution = [
      ...ledger.attribution,
      {
        ...input.key,
        promptTokens: input.usage.promptTokens,
        completionTokens: input.usage.completionTokens,
        cachedTokens: cached,
        totalTokens: input.usage.totalTokens,
        costMicroUsd: input.costMicroUsd,
        calls: 1,
      },
    ];
  } else {
    attribution = ledger.attribution;
  }

  return {
    ...ledger,
    actualPromptTokens: ledger.actualPromptTokens + input.usage.promptTokens,
    actualCompletionTokens: ledger.actualCompletionTokens + input.usage.completionTokens,
    cachedTokens: ledger.cachedTokens + cached,
    actualTotalTokens: ledger.actualTotalTokens + input.usage.totalTokens,
    reconciliationVarianceTokens: ledger.reconciliationVarianceTokens + variance,
    attribution,
  };
}
