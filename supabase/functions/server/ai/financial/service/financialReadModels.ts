/**
 * Financial read models (AI-01 Batch 3B, Part 6C).
 *
 * ── SERVICE LEVEL, NOT SURFACE LEVEL ───────────────────────────────────────
 *
 * These are the internal query surfaces a later Admin UI and HTTP layer will
 * call. They return VALUES. There is no route, no response, no serialisation, no
 * console projection — Part 6C ships the numbers and Part 6D can ship the
 * surface, so the accounting and its presentation get separate reviews.
 *
 * ── TENANCY IS A PARAMETER, NOT A FILTER APPLIED LATER ────────────────────
 *
 * Every read takes a `FinancialReadScope` carrying an organization, and the
 * store's query cannot be formed without one. A cross-tenant financial read is
 * not something these functions refuse — it is something they cannot express.
 *
 * The one exception is the platform-wide aggregate, and it takes explicit
 * `PlatformFinancialAuthority` the caller obtained from the existing
 * administration RBAC. This module CHECKS that evidence and can never produce
 * it, which is the same discipline the Part 6B eligibility gate uses for
 * authorization: the component that reports on money must not also be the
 * component that decides who may see it.
 *
 * ── EVERY MODEL CARRIES ITS COVERAGE AND ITS TRUNCATION ───────────────────
 *
 * A total computed over a silently truncated scan is the one kind of wrong
 * number that looks exactly like a right one, so `truncated` travels with every
 * result alongside settlement coverage. Both say the same thing in different
 * dimensions: here is the figure, and here is how much of the world it saw.
 */

import type { FinancialEvent } from '../contracts/event.ts';
import type { AttributionDimension } from '../contracts/attribution.ts';
import type {
  FinancialTotals,
  FinancialWindow,
  SettlementCoverage,
} from '../contracts/report.ts';
import { assertWindow } from '../contracts/report.ts';
import type { FinancialEventStore } from '../persistence/ports.ts';
import { foldTotals, settlementCoverage } from '../engine/settlement.ts';
import type { AttributionAggregate } from '../engine/attributionEngine.ts';
import {
  aggregateBy,
  assertSavingsBreakdownBalances,
  savingsByCategory,
} from '../engine/attributionEngine.ts';
import type { TargetProgress } from '../engine/targetProgress.ts';
import { assessTargetProgress } from '../engine/targetProgress.ts';
import type { OutcomeEconomics } from '../engine/outcomeEconomics.ts';
import { analyzeOutcomes } from '../engine/outcomeEconomics.ts';
import type { WasteEvidence, WasteReport } from '../engine/wasteAnalysis.ts';
import { analyzeWaste } from '../engine/wasteAnalysis.ts';
import type { BurnProjection } from '../engine/burnRate.ts';
import { projectBurn } from '../engine/burnRate.ts';
import type { OptimizationScore, OptimizationQualityEvidence } from '../engine/optimizationScore.ts';
import { scoreOptimization } from '../engine/optimizationScore.ts';
import { financialFailure } from '../contracts/failures.ts';

/** Who is asking, and for which tenant. Required on every read. */
export interface FinancialReadScope {
  readonly organizationId: string;
  readonly window: FinancialWindow;
  readonly workflowId?: string;
  readonly workflowRunId?: string;
  readonly agentId?: string;
}

/**
 * Evidence that the caller holds platform-wide financial authority.
 *
 * Obtained from the existing administration RBAC. This module verifies that the
 * evidence is present and names itself; it has no path by which it could GRANT
 * the authority, and holds no RBAC module that could.
 */
export interface PlatformFinancialAuthority {
  readonly granted: boolean;
  /** The identity of the RBAC verdict. Recorded on the result. */
  readonly authorizationEvidenceId: string;
}

function assertScope(scope: FinancialReadScope): void {
  if (typeof scope.organizationId !== 'string' || scope.organizationId === '') {
    throw financialFailure(
      'financial_tenant_mismatch',
      'A financial read must name the organization it is for.',
    );
  }
  assertWindow(scope.window);
}

async function loadEvents(
  store: FinancialEventStore,
  scope: FinancialReadScope,
): Promise<{ events: readonly FinancialEvent[]; truncated: boolean }> {
  assertScope(scope);
  const page = await store.list({
    organizationId: scope.organizationId,
    window: scope.window,
    ...(scope.workflowId === undefined ? {} : { workflowId: scope.workflowId }),
    ...(scope.workflowRunId === undefined ? {} : { workflowRunId: scope.workflowRunId }),
    ...(scope.agentId === undefined ? {} : { agentId: scope.agentId }),
  });
  // Belt and braces: the query is org-scoped and the rows are checked anyway. A
  // row disagreeing with the tenant it was read for is corrupt, not a permitted
  // cross-tenant read, and summing it would put another tenant's money in this
  // tenant's report.
  for (const event of page.events) {
    if (event.organizationId !== scope.organizationId) {
      throw financialFailure(
        'financial_tenant_mismatch',
        'A stored financial event does not belong to the organization it was read for.',
        { diagnostics: `${event.eventId} belongs to another organization` },
      );
    }
  }
  return { events: page.events, truncated: page.truncated };
}

export interface FinancialSummary {
  readonly organizationId: string;
  readonly window: FinancialWindow;
  readonly totals: FinancialTotals;
  readonly coverage: SettlementCoverage;
  readonly savingsByCategoryMicroUsd: Readonly<
    Record<string, { readonly microUsd: number; readonly tokens: number }>
  >;
  /** True when the scan hit its ceiling. Every total here is then a floor. */
  readonly truncated: boolean;
}

export async function financialSummary(
  store: FinancialEventStore,
  scope: FinancialReadScope,
): Promise<FinancialSummary> {
  const { events, truncated } = await loadEvents(store, scope);
  // Reconciled before it is returned. An unbalanced breakdown must not reach a
  // caller, whatever it would have looked like.
  assertSavingsBreakdownBalances(events);
  return {
    organizationId: scope.organizationId,
    window: scope.window,
    totals: foldTotals(events),
    coverage: settlementCoverage(events),
    savingsByCategoryMicroUsd: savingsByCategory(events),
    truncated,
  };
}

export async function targetProgress(
  store: FinancialEventStore,
  scope: FinancialReadScope,
): Promise<TargetProgress & { readonly truncated: boolean }> {
  const { events, truncated } = await loadEvents(store, scope);
  return { ...assessTargetProgress(events), truncated };
}

export async function costByDimension(
  store: FinancialEventStore,
  scope: FinancialReadScope,
  dimension: AttributionDimension,
): Promise<AttributionAggregate & { readonly truncated: boolean }> {
  const { events, truncated } = await loadEvents(store, scope);
  return { ...aggregateBy(events, dimension), truncated };
}

export async function outcomeEconomics(
  store: FinancialEventStore,
  scope: FinancialReadScope,
): Promise<OutcomeEconomics & { readonly truncated: boolean }> {
  const { events, truncated } = await loadEvents(store, scope);
  return { ...analyzeOutcomes(events), truncated };
}

export async function wasteReport(
  store: FinancialEventStore,
  scope: FinancialReadScope,
  evidence: WasteEvidence = {},
): Promise<WasteReport & { readonly truncated: boolean }> {
  const { events, truncated } = await loadEvents(store, scope);
  return { ...analyzeWaste(events, evidence), truncated };
}

export async function burnProjection(
  store: FinancialEventStore,
  scope: FinancialReadScope,
): Promise<BurnProjection & { readonly truncated: boolean }> {
  const { events, truncated } = await loadEvents(store, scope);
  return { ...projectBurn(events, scope.window), truncated };
}

export async function optimizationScore(
  store: FinancialEventStore,
  scope: FinancialReadScope,
  quality: OptimizationQualityEvidence = {},
  waste: WasteEvidence = {},
): Promise<OptimizationScore & { readonly truncated: boolean }> {
  const { events, truncated } = await loadEvents(store, scope);
  return { ...scoreOptimization({ events, quality, waste }), truncated };
}

/** Reuse economics, read from the events rather than from a second ledger. */
export interface ReuseEconomicsView {
  readonly avoidedCalls: number;
  readonly exactAvoidedCalls: number;
  readonly semanticAvoidedCalls: number;
  readonly tokensAvoided: number;
  readonly realizedSavingsFromReuseMicroUsd: number;
  readonly eligibleOperations: number;
  readonly avoidanceRatePercent: number;
  readonly truncated: boolean;
}

export async function reuseEconomics(
  store: FinancialEventStore,
  scope: FinancialReadScope,
): Promise<ReuseEconomicsView> {
  const { events, truncated } = await loadEvents(store, scope);
  const avoided = events.filter((event) => event.eventType === 'avoided_call');
  const eligible = events.filter((event) => event.eventType !== 'refused');
  const byCategory = savingsByCategory(events);

  return {
    avoidedCalls: avoided.length,
    exactAvoidedCalls: avoided.filter((event) => event.reuseType === 'exact').length,
    semanticAvoidedCalls: avoided.filter((event) => event.reuseType === 'semantic').length,
    tokensAvoided: avoided.reduce((total, event) => total + event.tokensAvoided, 0),
    // Read from Part 6A's `reuse` category, not re-derived from the avoided
    // events' baselines. Two derivations of one figure are two figures.
    realizedSavingsFromReuseMicroUsd: byCategory.reuse?.microUsd ?? 0,
    eligibleOperations: eligible.length,
    avoidanceRatePercent:
      eligible.length === 0
        ? 0
        : Math.round((avoided.length / eligible.length) * 1000) / 10,
    truncated,
  };
}

/**
 * A platform-wide summary across several tenants.
 *
 * Requires explicit platform authority the caller already established, and reads
 * each tenant through its own scoped query — so the aggregate is a sum of
 * tenant-scoped reads rather than an unscoped one. There is no query in this
 * tree that spans organizations, and that is what makes the isolation
 * structural rather than procedural.
 */
export interface PlatformFinancialSummary {
  readonly authorizationEvidenceId: string;
  readonly organizations: number;
  readonly totals: FinancialTotals;
  readonly coverage: SettlementCoverage;
  readonly truncated: boolean;
}

export async function platformFinancialSummary(
  store: FinancialEventStore,
  authority: PlatformFinancialAuthority,
  organizationIds: readonly string[],
  window: FinancialWindow,
): Promise<PlatformFinancialSummary> {
  if (!authority.granted || authority.authorizationEvidenceId === '') {
    // Fails closed, and it refuses rather than returning an empty aggregate: an
    // empty financial report is indistinguishable from a quiet month, and a
    // caller would read the wrong meaning into it.
    throw financialFailure(
      'financial_authority_required',
      'A platform-wide financial read requires platform authority.',
      { diagnostics: `granted=${String(authority.granted)}` },
    );
  }
  assertWindow(window);

  const collected: FinancialEvent[] = [];
  let truncated = false;
  for (const organizationId of [...organizationIds].sort()) {
    const page = await loadEvents(store, { organizationId, window });
    collected.push(...page.events);
    truncated = truncated || page.truncated;
  }

  return {
    authorizationEvidenceId: authority.authorizationEvidenceId,
    organizations: new Set(organizationIds).size,
    totals: foldTotals(collected),
    coverage: settlementCoverage(collected),
    truncated,
  };
}
