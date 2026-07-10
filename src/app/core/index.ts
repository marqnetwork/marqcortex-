/**
 * CORTEX CORE — PIPELINE ORCHESTRATOR
 *
 * Single entry point for the 4-module engine pipeline:
 *   InputNormalizer → ScoringEngine → DecisionEngine → TemplateAssembler
 *
 * UI calls runCortexEngine() and reads only the CortexEnginePayload.
 * No UI logic outside this structure.
 *
 * CRITICAL RULE: Math decides priority. LLM only explains decisions.
 */

import type { AnnotatedResponse } from '@/app/utils/questionRegistry';
import type { CortexEnginePayload } from './types';
import { normalizeInput } from './inputNormalizer';
import { scoreDomains, applyIndustryAdjustment } from './scoringEngine';
import { makeDecision } from './decisionEngine';
import { assemblePayload } from './templateAssembler';
import { buildPortfolioROI, computeSensitivityAnalysis } from './roiEngine';
import { validateDependencies, getExecutionOrder } from './dependencyEngine';
import { computeCostModel, validatePortfolioGovernance } from './costEngine';
import { createInitialPortfolioState, applyChangeRequest, revertToVersion, getVersionHistory, getVersionDiff, parseChatToChangeRequest } from './versionEngine';
import { computeRecommendationCashflow, buildPortfolioCashflow, resolvePaybackMonths } from './cashflowEngine';
import { computeDCF, isDCFModel, getEffectiveDiscountRate, extendNetCashFlows } from './dcfEngine';
import { computeIRR, isIRRModel, getIRRStatusLabel } from './irrEngine';
import { runMonteCarloSimulation, isMonteCarloModel } from './monteCarloEngine';
import { buildScenarioModel, isScenarioModel, getScenarioGainTier, applyRampShift, applyScenarioToCashflow, getActiveScenarioCashflow, SCENARIO_PRESETS } from './scenarioEngine';

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE INPUT
// ═══════════════════════════════════════════════════════════════════════════════

export interface CortexEngineInput {
  answers: Record<number | string, string | number>;
  annotatedResponses: AnnotatedResponse[];
  company: string;
  industry: string;
  employeeEstimate: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: runCortexEngine
// ═══════════════════════════════════════════════════════════════════════════════

export function runCortexEngine(input: CortexEngineInput): CortexEnginePayload {
  // 1. Normalize
  const diagnostics = normalizeInput({
    answers: input.answers,
    annotatedResponses: input.annotatedResponses,
    company: input.company,
    industry: input.industry,
    employeeEstimate: input.employeeEstimate,
  });

  // 2. Score
  let scores = scoreDomains(diagnostics);
  scores = applyIndustryAdjustment(scores, input.industry);

  // 3. Decide (math, not LLM)
  const decision = makeDecision(scores, diagnostics);

  // 4. Assemble final payload
  const payload = assemblePayload(diagnostics, scores, decision);

  return payload;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS for convenience
// ═══════════════════════════════════════════════════════════════════════════════

export type { CortexEnginePayload } from './types';
export type { NormalizedDiagnostics, DomainScores, DecisionOutput, SprintTemplateId, RecommendationV2, BusinessTransformationPortfolio, DecisionTransparency, FeasibilityScore, EvidenceStrength, ROIEligibility, DepartmentKey, DepartmentScanScore, RecommendationROI, PortfolioROIModel, PortfolioState, PortfolioAssumptions, PortfolioConstraints, ChangeRequest, ChangeRequestType, VersionRecord, DeltaLogEntry, RecalcResult, DependencyValidationResult, CostModel, CostBreakdown, InvestmentEstimate } from './types';
export { getSprintTemplate, getAllSprintTemplates } from './sprintTemplates';
export { normalizeInput } from './inputNormalizer';
export { scoreDomains, applyIndustryAdjustment } from './scoringEngine';
export { makeDecision } from './decisionEngine';
export { assemblePayload } from './templateAssembler';
export { buildPortfolioROI, computeSensitivityAnalysis } from './roiEngine';
export type { SensitivityResult } from './roiEngine';
export { validateDependencies, getExecutionOrder } from './dependencyEngine';
export { computeCostModel, validatePortfolioGovernance } from './costEngine';
export { createInitialPortfolioState, applyChangeRequest, revertToVersion, getVersionHistory, getVersionDiff, parseChatToChangeRequest } from './versionEngine';
export { computeRecommendationCashflow, buildPortfolioCashflow, resolvePaybackMonths } from './cashflowEngine';
export type { RecommendationCashflow, PortfolioCashflow, MonthlyProjection } from './types';
export { computeDCF, isDCFModel, getEffectiveDiscountRate, extendNetCashFlows } from './dcfEngine';
export type { DCFModel, DCFFailure, DCFProjectionEntry } from './types';
export { computeIRR, isIRRModel, getIRRStatusLabel } from './irrEngine';
export type { IRRModel, IRRFailure } from './types';
export { runMonteCarloSimulation, isMonteCarloModel } from './monteCarloEngine';
export type { MonteCarloModel, MonteCarloFailure, MonteCarloRandomizedInput, MonteCarloROIStat, MonteCarloPaybackStat, MonteCarloNPVStat } from './types';
export { buildScenarioModel, isScenarioModel, getScenarioGainTier, applyRampShift, applyScenarioToCashflow, getActiveScenarioCashflow, SCENARIO_PRESETS } from './scenarioEngine';
export type { ScenarioKey, ScenarioPreset, ScenarioOutput, ScenarioModel, ScenarioRealizationFactors } from './types';