/**
 * CORTEX CORE — VERSION ENGINE
 *
 * Chat Recalculation + Version Control.
 *
 * Core Principle:
 *   Chat never edits outputs directly.
 *   Chat only edits inputs/assumptions/constraints.
 *   Then the pipeline re-runs deterministically.
 *
 * Pipeline: Validate → Patch → Scoring → Portfolio → Feasibility → Confidence → ROI → Narrative → Commit
 *
 * Every recalculation increments version. Never overwrite. Store ≥ 25 versions.
 */

import type {
  PortfolioState,
  PortfolioAssumptions,
  PortfolioConstraints,
  ChangeRequest,
  ChangeRequestEntry,
  DeltaLogEntry,
  VersionRecord,
  RecalcFlags,
  RecalcResult,
  CortexEnginePayload,
} from './types';
import { annotateResponses } from '@/app/utils/questionRegistry';

// Import pipeline modules directly to avoid circular dependency with index.ts
import { normalizeInput } from './inputNormalizer';
import { scoreDomains, applyIndustryAdjustment } from './scoringEngine';
import { makeDecision } from './decisionEngine';
import { assemblePayload } from './templateAssembler';
import { buildPortfolioROI } from './roiEngine';
import { isDCFModel } from './dcfEngine';
import { isIRRModel } from './irrEngine';

// ════════════════════════════════════════════════════════════════════════════════
// ALLOWED PATHS — Chat can only edit these. No silent edits.
// ════════════════════════════════════════════════════════════════════════════════

const ALLOWED_ASSUMPTION_PATHS = [
  'monthly_revenue', 'avg_order_value', 'monthly_orders',
  'support_tickets_per_week', 'avg_response_time_hours',
  'labor_cost_per_hour', 'refund_rate_percent', 'conversion_rate_percent',
  'gross_margin_percent',
  'discount_rate_percent',  // finance_v1_dcf §1 — §9: changes here require finance_recalc
];

const ALLOWED_CONSTRAINT_PATHS = [
  'max_roi_display_percent', 'roi_must_be_range', 'confidence_floor_for_roi',
  'max_recommendations', 'no_claims_without_assumptions',
];

const MAX_HISTORY_LENGTH = 25;

// ════════════════════════════════════════════════════════════════════════════════
// 1️⃣ CREATE INITIAL PORTFOLIO STATE
// ════════════════════════════════════════════════════════════════════════════════

export function createInitialPortfolioState(
  leadId: string,
  company: string,
  industry: string,
  employeeEstimate: number,
  answers: Record<string, string>,
  enginePayload: CortexEnginePayload | null,
): PortfolioState {
  const now = new Date().toISOString();
  const assumptions = deriveAssumptions(industry, employeeEstimate);

  const initialVersion: VersionRecord = {
    version: 'v1',
    previous_version: null,
    timestamp: now,
    actor: 'system',
    source: 'initial',
    delta_log: [],
    recalc: {
      scoring: true,
      portfolio: true,
      feasibility: true,
      confidence: true,
      roi: true,
      cortex_narrative: true,
    },
    summary: 'Initial diagnostic analysis complete.',
  };

  return {
    portfolio_id: `ptf-${leadId}-${Date.now().toString(36)}`,
    lead_id: leadId,
    current_version: 'v1',
    created_at: now,
    updated_at: now,
    active_scenario: 'expected',      // finance_v4_scenarios §5: default scenario
    inputs: {
      business_snapshot: { company, industry, employee_estimate: employeeEstimate },
      answers,
      assumptions,
      constraints: { ...getDefaultConstraints() },
    },
    outputs: {
      diagnostic: enginePayload,
      recommendations: enginePayload?.portfolio?.recommendations ?? [],
      portfolio: enginePayload?.portfolio ?? null,
      roi: enginePayload?.roi_model ?? null,
      decision_transparency: enginePayload?.decision_transparency ?? null,
    },
    history: [initialVersion],
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// 2️⃣ APPLY CHANGE REQUEST — The heart of the system
// ════════════════════════════════════════════════════════════════════════════════
// Validate → Patch → Run Engines → Commit Version → Return UI Payload

export function applyChangeRequest(
  state: PortfolioState,
  request: ChangeRequest,
  actor: 'team_user' | 'system' = 'team_user',
  source: 'chat' | 'manual_edit' | 'auto' = 'chat',
): RecalcResult {
  // §0 — RequestExplanation: no recalculation
  if (request.type === 'RequestExplanation') {
    return {
      success: true,
      new_version: state.current_version,
      summary: 'No recalculation needed — explanation request only.',
      changed_sections: [],
      state,
    };
  }

  // §0 — ApproveVersion: lock current version
  if (request.type === 'ApproveVersion') {
    const approvedState = deepClone(state);
    const latestHistory = approvedState.history[0];
    if (latestHistory) {
      latestHistory.is_approved = true;
      latestHistory.locked_for_export = true; // §7 — locked_for_export
    }
    return {
      success: true,
      new_version: state.current_version,
      summary: `Version ${state.current_version} approved and locked for proposal/export. Further edits require creating a new working version.`,
      changed_sections: [],
      state: approvedState,
    };
  }

  // §0 — SwitchScenario: update active scenario, bump version, rebuild ROI (finance_v4_scenarios §5)
  if (request.type === 'SwitchScenario') {
    const scenarioChange = request.changes[0];
    const newScenario = scenarioChange?.value as import('./types').ScenarioKey | undefined;
    if (!newScenario) {
      return { success: false, new_version: state.current_version, summary: 'SwitchScenario requires a scenario value.', changed_sections: [], state };
    }

    const draft = deepClone(state);
    const oldScenario = draft.active_scenario ?? 'expected';
    draft.active_scenario = newScenario;

    // Rebuild ROI under new scenario using existing portfolio
    if (draft.outputs.portfolio && draft.inputs.assumptions) {
      try {
        draft.outputs.roi = buildPortfolioROI(
          draft.outputs.portfolio,
          draft.inputs.business_snapshot.employee_estimate,
          draft.inputs.assumptions,
          draft.inputs.constraints.max_roi_display_percent,
          newScenario,
        );
      } catch (err) {
        console.log('[VersionEngine] SwitchScenario ROI rebuild error:', err);
      }
    }

    const newVersionNum = extractVersionNumber(state.current_version) + 1;
    const newVersionStr = `v${newVersionNum}`;
    const oldROI = state.outputs.roi?.portfolio_totals?.total_adjusted_roi_percent ?? null;
    const newROI = draft.outputs.roi?.portfolio_totals?.total_adjusted_roi_percent ?? 0;

    const versionRecord: VersionRecord = {
      version: newVersionStr,
      previous_version: state.current_version,
      timestamp: new Date().toISOString(),
      actor,
      source: 'manual_edit',
      delta_log: [{ path: 'active_scenario', old: oldScenario, new_value: newScenario, reason: scenarioChange?.reason ?? `Scenario switched to ${newScenario}` }],
      recalc: { scoring: false, portfolio: false, feasibility: false, confidence: false, roi: true, cortex_narrative: false },
      summary: `Scenario switched: ${oldScenario} → ${newScenario}. ROI recalculated under ${newScenario} realization factors and ramp curve.`,
      roi_recalculated: true,
      scenario_switched: true,
      scenario_delta_summary: {
        scenario_old: oldScenario,
        scenario_new: newScenario,
        roi_old: oldROI,
        roi_new: newROI,
        npv_old: state.outputs.roi?.dcf_model && 'npv' in state.outputs.roi.dcf_model ? state.outputs.roi.dcf_model.npv : null,
        npv_new: draft.outputs.roi?.dcf_model && 'npv' in draft.outputs.roi.dcf_model ? draft.outputs.roi.dcf_model.npv : 0,
        payback_old: state.outputs.roi?.portfolio_payback_months ?? null,
        payback_new: draft.outputs.roi?.portfolio_payback_months ?? null,
      },
    };

    draft.current_version = newVersionStr;
    draft.updated_at = versionRecord.timestamp;
    draft.history = [versionRecord, ...draft.history].slice(0, MAX_HISTORY_LENGTH);

    return {
      success: true,
      new_version: newVersionStr,
      summary: versionRecord.summary,
      changed_sections: ['roi'],
      state: draft,
    };
  }

  // §1 — Validate ChangeRequest
  const validation = validateChangeRequest(request, state);
  if (!validation.valid) {
    return {
      success: false,
      new_version: state.current_version,
      summary: `Validation failed: ${validation.errors.join('; ')}`,
      changed_sections: [],
      state,
      error: validation.errors.join('; '),
    };
  }

  // §2 — Create draft state and apply patches
  const draft = deepClone(state);
  const deltaLog: DeltaLogEntry[] = [];
  const changedSections = new Set<'scoring' | 'portfolio' | 'feasibility' | 'confidence' | 'roi' | 'narrative'>();
  let financeRecalcRequired = false; // finance_v1_dcf §9

  for (const change of request.changes) {
    const applied = applyPatch(draft, change, deltaLog);
    if (applied) {
      // Determine which engines need re-running based on what changed
      if (change.path.startsWith('inputs.assumptions.')) {
        // finance_v1_dcf §9: discount_rate changes require finance_recalc
        if (change.path === 'inputs.assumptions.discount_rate_percent') {
          financeRecalcRequired = true;
          // DCF-only change — only ROI layer needs recalc (not full scoring)
          changedSections.add('roi');
        } else {
          changedSections.add('scoring');
          changedSections.add('portfolio');
          changedSections.add('feasibility');
          changedSections.add('confidence');
          changedSections.add('roi');
          changedSections.add('narrative');
          // §9: gain/investment changes also require finance_recalc
          financeRecalcRequired = true;
        }
      } else if (change.path.startsWith('inputs.constraints.')) {
        changedSections.add('roi');
        changedSections.add('portfolio');
      } else if (change.path.startsWith('inputs.answers.')) {
        changedSections.add('scoring');
        changedSections.add('portfolio');
        changedSections.add('feasibility');
        changedSections.add('confidence');
        changedSections.add('roi');
        changedSections.add('narrative');
        // §9: any answer change may shift gain/investment → finance_recalc
        financeRecalcRequired = true;
      }
    }
  }

  // §3 — Run Engines (deterministic recalculation)
  const recalcFlags: RecalcFlags = {
    scoring: changedSections.has('scoring'),
    portfolio: changedSections.has('portfolio'),
    feasibility: changedSections.has('feasibility'),
    confidence: changedSections.has('confidence'),
    roi: changedSections.has('roi'),
    cortex_narrative: changedSections.has('narrative'),
  };

  if (changedSections.has('scoring')) {
    try {
      const newPayload = runRecalculation(draft);
      if (newPayload) {
        draft.outputs.diagnostic = newPayload;
        draft.outputs.recommendations = newPayload.portfolio?.recommendations ?? draft.outputs.recommendations;
        draft.outputs.portfolio = newPayload.portfolio ?? draft.outputs.portfolio;
        draft.outputs.roi = newPayload.roi_model ?? draft.outputs.roi;
        draft.outputs.decision_transparency = newPayload.decision_transparency ?? draft.outputs.decision_transparency;

        // Increment calc_version on all recommendations
        const versionNum = extractVersionNumber(state.current_version) + 1;
        draft.outputs.recommendations = draft.outputs.recommendations.map(rec => ({
          ...rec,
          calc_version: versionNum,
        }));
      }
    } catch (err) {
      console.log('[VersionEngine] Recalculation error:', err);
      // Partial failure — ROI may become not_calculable
    }
  }

  // §4 — Apply constraint caps to ROI
  if (draft.outputs.roi && changedSections.has('roi')) {
    applyROIConstraints(draft);
  }

  // §5 — Compute ROI delta for trust/transparency (roi-system-integration-spec §4+§5)
  const roiRecalculated = changedSections.has('roi') && !!draft.outputs.roi;
  const roiDeltaSummary = computeROIDelta(state, draft, roiRecalculated);

  // finance_v1_dcf — Compute DCF delta when ROI was recalculated or rate changed
  const dcfDeltaSummary = computeDCFDelta(state, draft, roiRecalculated || financeRecalcRequired);

  // finance_v2_dcf_irr — Compute IRR delta when ROI or cash flow changed
  const irrDeltaSummary = computeIRRDelta(state, draft, roiRecalculated || financeRecalcRequired);

  // §5 — Commit Version
  const newVersionNum = extractVersionNumber(state.current_version) + 1;
  const newVersionStr = `v${newVersionNum}`;

  const versionRecord: VersionRecord = {
    version: newVersionStr,
    previous_version: state.current_version,
    timestamp: new Date().toISOString(),
    actor,
    source,
    delta_log: deltaLog,
    recalc: recalcFlags,
    summary: buildVersionSummary(request, deltaLog, changedSections),
    roi_recalculated: roiRecalculated,
    roi_delta_summary: roiDeltaSummary ?? undefined,
    // finance_v1_dcf §9: flag if discount_rate, timeline, gain, or investment changed
    finance_recalc_required: financeRecalcRequired || roiRecalculated || undefined,
    dcf_delta_summary: dcfDeltaSummary ?? undefined,
    irr_delta_summary: irrDeltaSummary ?? undefined,
  };

  draft.current_version = newVersionStr;
  draft.updated_at = versionRecord.timestamp;
  draft.history = [versionRecord, ...draft.history].slice(0, MAX_HISTORY_LENGTH);

  return {
    success: true,
    new_version: newVersionStr,
    summary: versionRecord.summary,
    changed_sections: Array.from(changedSections),
    state: draft,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// 3️⃣ REVERT TO VERSION
// ════════════════════════════════════════════════════════════════════════════════

export function revertToVersion(
  state: PortfolioState,
  targetVersion: string,
): RecalcResult {
  const targetIdx = state.history.findIndex(v => v.version === targetVersion);
  if (targetIdx < 0) {
    return {
      success: false,
      new_version: state.current_version,
      summary: `Version ${targetVersion} not found in history.`,
      changed_sections: [],
      state,
      error: `Version ${targetVersion} not found`,
    };
  }

  // Create a "revert" change request that undoes all deltas between current and target
  const reverseDelta: DeltaLogEntry[] = [];
  for (let i = 0; i < targetIdx; i++) {
    const ver = state.history[i];
    for (const d of ver.delta_log) {
      reverseDelta.push({
        path: d.path,
        old: d.new_value,
        new_value: d.old ?? 0,
        reason: `Reverted from ${ver.version} back to ${targetVersion}`,
      });
    }
  }

  // Apply reversed deltas
  const draft = deepClone(state);
  for (const d of reverseDelta) {
    setNestedValue(draft, d.path, d.new_value);
  }

  // Re-run full pipeline
  try {
    const newPayload = runRecalculation(draft);
    if (newPayload) {
      draft.outputs.diagnostic = newPayload;
      draft.outputs.recommendations = newPayload.portfolio?.recommendations ?? [];
      draft.outputs.portfolio = newPayload.portfolio ?? null;
      draft.outputs.roi = newPayload.roi_model ?? null;
      draft.outputs.decision_transparency = newPayload.decision_transparency ?? null;
    }
  } catch (err) {
    console.log('[VersionEngine] Revert recalculation error:', err);
  }

  const newVersionNum = extractVersionNumber(state.current_version) + 1;
  const newVersionStr = `v${newVersionNum}`;

  const revertRecord: VersionRecord = {
    version: newVersionStr,
    previous_version: state.current_version,
    timestamp: new Date().toISOString(),
    actor: 'team_user',
    source: 'manual_edit',
    delta_log: reverseDelta,
    recalc: { scoring: true, portfolio: true, feasibility: true, confidence: true, roi: true, cortex_narrative: true },
    summary: `Reverted to ${targetVersion}. Full pipeline recalculated.`,
  };

  draft.current_version = newVersionStr;
  draft.updated_at = revertRecord.timestamp;
  draft.history = [revertRecord, ...draft.history].slice(0, MAX_HISTORY_LENGTH);

  return {
    success: true,
    new_version: newVersionStr,
    summary: revertRecord.summary,
    changed_sections: ['scoring', 'portfolio', 'feasibility', 'confidence', 'roi', 'narrative'],
    state: draft,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// 4️⃣ GET VERSION HISTORY
// ════════════════════════════════════════════════════════════════════════════════

export function getVersionHistory(state: PortfolioState): VersionRecord[] {
  return state.history;
}

export function getVersionDiff(state: PortfolioState, version: string): DeltaLogEntry[] {
  const record = state.history.find(v => v.version === version);
  return record?.delta_log ?? [];
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: VALIDATION
// ════════════════════════════════════════════════════════════════════════════════

function validateChangeRequest(
  request: ChangeRequest,
  state: PortfolioState,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check approved version is not being edited
  const latest = state.history[0];
  if (latest?.is_approved && request.type !== 'RequestExplanation') {
    errors.push(`Version ${state.current_version} is approved/locked. Create a new version or unlock first.`);
  }

  for (const change of request.changes) {
    // Validate paths
    if (request.type === 'UpdateAssumption') {
      const key = change.path.replace('inputs.assumptions.', '');
      if (!ALLOWED_ASSUMPTION_PATHS.includes(key) && !change.path.startsWith('inputs.assumptions.')) {
        errors.push(`Invalid assumption path: ${change.path}`);
      }
      if (typeof change.value === 'number' && change.value < 0) {
        errors.push(`Assumption "${key}" cannot be negative (got ${change.value})`);
      }
    }

    if (request.type === 'UpdateConstraint') {
      const key = change.path.replace('inputs.constraints.', '');
      if (!ALLOWED_CONSTRAINT_PATHS.includes(key)) {
        errors.push(`Invalid constraint path: ${change.path}`);
      }
    }

    if (request.type === 'ClarifyAnswer') {
      if (!change.path.startsWith('inputs.answers.')) {
        errors.push(`ClarifyAnswer path must start with "inputs.answers.": ${change.path}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL: PATCHING
// ════════════════════════════════════════════════════════════════════════════════

function applyPatch(
  state: PortfolioState,
  change: ChangeRequestEntry,
  deltaLog: DeltaLogEntry[],
): boolean {
  const oldValue = getNestedValue(state, change.path);
  if (oldValue === change.value) return false; // No change

  setNestedValue(state, change.path, change.value);
  deltaLog.push({
    path: change.path,
    old: oldValue ?? null,
    new_value: change.value,
    reason: change.reason,
  });
  return true;
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((curr, key) => curr?.[key], obj);
}

function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce((curr, key) => {
    if (curr[key] === undefined) curr[key] = {};
    return curr[key];
  }, obj);
  target[last] = value;
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: RECALCULATION PIPELINE
// ════════════════════════════════════════════════════════════════════════════════

function runRecalculation(draft: PortfolioState): CortexEnginePayload | null {
  const { answers, business_snapshot, assumptions } = draft.inputs;
  const annotated = annotateResponses(answers as any, business_snapshot.industry);

  if (annotated.length < 3) return null;

  try {
    // Re-run the full 4-module pipeline: Normalize → Score → Decide → Assemble
    const diagnostics = normalizeInput({
      answers,
      annotatedResponses: annotated,
      company: business_snapshot.company,
      industry: business_snapshot.industry,
      employeeEstimate: business_snapshot.employee_estimate,
    });

    let scores = scoreDomains(diagnostics);
    scores = applyIndustryAdjustment(scores, business_snapshot.industry);

    const decision = makeDecision(scores, diagnostics);

    // finance_v4_scenarios §3 + ROI Assumptions: pass both through to assemblePayload
    return assemblePayload(diagnostics, scores, decision, assumptions, draft.active_scenario ?? 'expected');
  } catch (err) {
    console.log('[VersionEngine] Engine pipeline error:', err);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: ROI CONSTRAINT ENFORCEMENT
// ════════════════════════════════════════════════════════════════════════════════

function applyROIConstraints(draft: PortfolioState): void {
  const constraints = draft.inputs.constraints;
  const roi = draft.outputs.roi;
  if (!roi) return;

  // Hard cap display ROI
  const cap = constraints.max_roi_display_percent;
  for (const recROI of roi.recommendation_rois) {
    if (recROI.adjusted_roi_percent > cap) {
      recROI.display.adjusted_roi_label = `${cap}%+`;
      recROI.display.assumptions.push(`ROI capped at ${cap}% (calculated ${recROI.adjusted_roi_percent}%)`);
    }
  }

  // Confidence floor: lock ROI if below threshold
  const floor = constraints.confidence_floor_for_roi;
  for (const recROI of roi.recommendation_rois) {
    if (recROI.inputs.confidence_score < floor && recROI.is_roi_eligible) {
      recROI.is_roi_eligible = false;
      recROI.roi_locked_reason = `Confidence ${recROI.inputs.confidence_score} below floor ${floor}`;
      recROI.display.gain_90d = 'ROI Not Calculable Yet';
      recROI.display.gain_12mo = 'ROI Not Calculable Yet';
      recROI.display.adjusted_roi_label = 'Locked';
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: ROI DELTA COMPUTATION
// ════════════════════════════════════════════════════════════════════════════════

function computeROIDelta(
  oldState: PortfolioState,
  newState: PortfolioState,
  roiRecalculated: boolean,
): VersionRecord['roi_delta_summary'] | null {
  if (!roiRecalculated) return null;

  const oldROI = oldState.outputs.roi;
  const newROI = newState.outputs.roi;
  if (!oldROI || !newROI) return null;

  const oldPortROI = oldROI.portfolio_totals.total_adjusted_roi_percent ?? 0;
  const newPortROI = newROI.portfolio_totals.total_adjusted_roi_percent ?? 0;
  const oldGain = oldROI.portfolio_totals.total_adjusted_gain_12mo ?? 0;
  const newGain = newROI.portfolio_totals.total_adjusted_gain_12mo ?? 0;
  const oldPayback = oldROI.portfolio_payback_months ?? 0;
  const newPayback = newROI.portfolio_payback_months ?? 0;

  return {
    portfolio_roi_old: oldPortROI,
    portfolio_roi_new: newPortROI,
    delta_percent: newPortROI - oldPortROI,
    gain_old: oldGain,
    gain_new: newGain,
    gain_delta: newGain - oldGain,
    payback_old: oldPayback,
    payback_new: newPayback,
    payback_delta: newPayback - oldPayback,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: DCF DELTA COMPUTATION
// ════════════════════════════════════════════════════════════════════════════════

function computeDCFDelta(
  oldState: PortfolioState,
  newState: PortfolioState,
  dcfRecalculated: boolean,
): VersionRecord['dcf_delta_summary'] | null {
  if (!dcfRecalculated) return null;

  const oldROI = oldState.outputs.roi;
  const newROI = newState.outputs.roi;
  if (!oldROI || !newROI) return null;

  const oldDCFResult = oldROI.dcf_model;
  const newDCFResult = newROI.dcf_model;
  if (!oldDCFResult || !newDCFResult) return null;
  if (!isDCFModel(oldDCFResult) || !isDCFModel(newDCFResult)) return null;

  const npvOld = oldDCFResult.npv ?? 0;
  const npvNew = newDCFResult.npv ?? 0;
  const rateOld = oldDCFResult.discount_rate_percent ?? 12;
  const rateNew = newDCFResult.discount_rate_percent ?? 12;
  const pbOld = oldDCFResult.discounted_payback_month;
  const pbNew = newDCFResult.discounted_payback_month;
  const pbDelta = (pbOld !== null && pbNew !== null) ? pbNew - pbOld : null;

  return {
    npv_old: npvOld,
    npv_new: npvNew,
    npv_delta: npvNew - npvOld,
    discount_rate_old: rateOld,
    discount_rate_new: rateNew,
    discounted_payback_old: pbOld,
    discounted_payback_new: pbNew,
    payback_delta: pbDelta,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: IRR DELTA COMPUTATION
// ════════════════════════════════════════════════════════════════════════════════

function computeIRRDelta(
  oldState: PortfolioState,
  newState: PortfolioState,
  financeRecalculated: boolean,
): VersionRecord['irr_delta_summary'] | null {
  if (!financeRecalculated) return null;

  const oldROI = oldState.outputs.roi;
  const newROI = newState.outputs.roi;
  if (!oldROI || !newROI) return null;

  const oldIRRResult = oldROI.irr_model;
  const newIRRResult = newROI.irr_model;

  const oldAnnual = oldIRRResult && isIRRModel(oldIRRResult) ? oldIRRResult.irr_percent_annual : null;
  const newAnnual = newIRRResult && isIRRModel(newIRRResult) ? newIRRResult.irr_percent_annual : null;

  const irrDelta = (oldAnnual !== null && newAnnual !== null)
    ? parseFloat((newAnnual - oldAnnual).toFixed(2))
    : null;

  const statusOld = oldIRRResult
    ? (isIRRModel(oldIRRResult) ? 'converged' : oldIRRResult.status)
    : 'not_computed';
  const statusNew = newIRRResult
    ? (isIRRModel(newIRRResult) ? 'converged' : newIRRResult.status)
    : 'not_computed';

  return {
    irr_annual_old: oldAnnual,
    irr_annual_new: newAnnual,
    irr_delta:      irrDelta,
    status_old:     statusOld,
    status_new:     statusNew,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function extractVersionNumber(version: string): number {
  const match = version.match(/v(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function getDefaultConstraints(): PortfolioConstraints {
  return {
    max_roi_display_percent: 350,
    roi_must_be_range: true,
    confidence_floor_for_roi: 60,
    max_recommendations: 7,
    no_claims_without_assumptions: true,
  };
}

function deriveAssumptions(industry: string, employeeEstimate: number): PortfolioAssumptions {
  const isEcom = industry.toLowerCase().includes('commerce') || industry.toLowerCase().includes('dtc');
  const isSaaS = industry.toLowerCase().includes('saas') || industry.toLowerCase().includes('software');
  const emp = employeeEstimate;

  return {
    monthly_revenue: isEcom ? emp * 5000 : isSaaS ? emp * 8000 : emp * 4000,
    avg_order_value: isEcom ? 85 : isSaaS ? 120 : 65,
    monthly_orders: isEcom ? Math.round(emp * 60) : isSaaS ? Math.round(emp * 30) : Math.round(emp * 40),
    support_tickets_per_week: Math.round(emp * 4),
    avg_response_time_hours: emp > 100 ? 12 : emp > 50 ? 18 : 30,
    labor_cost_per_hour: emp > 200 ? 45 : emp > 50 ? 35 : 25,
    refund_rate_percent: isEcom ? 3.8 : 1.5,
    conversion_rate_percent: isEcom ? 2.1 : isSaaS ? 3.5 : 2.8,
    gross_margin_percent: isEcom ? 42 : isSaaS ? 75 : 50,
    discount_rate_percent: 12, // finance_v1_dcf §1: default 12%
  };
}

function buildVersionSummary(
  request: ChangeRequest,
  deltaLog: DeltaLogEntry[],
  changedSections: Set<string>,
): string {
  const changeCount = deltaLog.length;
  const sectionList = Array.from(changedSections).join(', ');
  const reasons = deltaLog.map(d => d.reason).filter(Boolean);
  const reasonSnippet = reasons.length > 0 ? reasons[0] : 'Values updated';

  switch (request.type) {
    case 'UpdateAssumption':
      return `${changeCount} assumption${changeCount > 1 ? 's' : ''} updated: ${reasonSnippet}. Recalculated: ${sectionList}.`;
    case 'UpdateConstraint':
      return `Constraint updated: ${reasonSnippet}. Recalculated: ${sectionList}.`;
    case 'UpdatePriorityPreference':
      return `Priority preference noted: ${request.preference_note || reasonSnippet}. ${sectionList ? `Recalculated: ${sectionList}.` : ''}`;
    case 'ClarifyAnswer':
      return `Answer clarified: ${reasonSnippet}. Full pipeline recalculated: ${sectionList}.`;
    default:
      return `${changeCount} change${changeCount > 1 ? 's' : ''} applied. Recalculated: ${sectionList}.`;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// 5️⃣ PARSE CHAT MESSAGE → CHANGE REQUEST
// ════════════════════════════════════════════════════════════════════════════════
// This is the "mock mode" parser. In production, GPT-4o-mini would extract
// structured ChangeRequest JSON from natural language. For now, deterministic.

export function parseChatToChangeRequest(message: string): ChangeRequest | null {
  const lower = message.toLowerCase().trim();

  // Pattern: "set X to Y" / "change X to Y" / "update X to Y"
  const setMatch = lower.match(/(?:set|change|update)\s+(.+?)\s+to\s+([0-9,.]+)/);
  if (setMatch) {
    const field = matchAssumptionField(setMatch[1]);
    const value = parseFloat(setMatch[2].replace(/,/g, ''));
    if (field && !isNaN(value)) {
      return {
        type: 'UpdateAssumption',
        changes: [{
          path: `inputs.assumptions.${field}`,
          value,
          reason: `User requested: "${message}"`,
        }],
      };
    }
  }

  // Pattern: numbers followed by tickets/orders/revenue
  const numericMatch = lower.match(/(\d+[,.]?\d*)\s*(tickets?|orders?|revenue|margin|conversion|refund)/);
  if (numericMatch) {
    const value = parseFloat(numericMatch[1].replace(/,/g, ''));
    const fieldMap: Record<string, string> = {
      ticket: 'support_tickets_per_week',
      tickets: 'support_tickets_per_week',
      order: 'monthly_orders',
      orders: 'monthly_orders',
      revenue: 'monthly_revenue',
      margin: 'gross_margin_percent',
      conversion: 'conversion_rate_percent',
      refund: 'refund_rate_percent',
    };
    const field = fieldMap[numericMatch[2]];
    if (field && !isNaN(value)) {
      return {
        type: 'UpdateAssumption',
        changes: [{
          path: `inputs.assumptions.${field}`,
          value,
          reason: `User mentioned: "${message}"`,
        }],
      };
    }
  }

  // "Approve" / "lock" / "finalize"
  if (lower.includes('approve') || lower.includes('lock') || lower.includes('finalize')) {
    return { type: 'ApproveVersion', changes: [] };
  }

  // "Why" / "explain" / "how"
  if (lower.startsWith('why') || lower.startsWith('explain') || lower.startsWith('how')) {
    return { type: 'RequestExplanation', changes: [] };
  }

  // "Focus on X first" / "prioritize X"
  if (lower.includes('focus on') || lower.includes('prioritize')) {
    return {
      type: 'UpdatePriorityPreference',
      changes: [],
      preference_note: message,
    };
  }

  return null; // Unrecognized — chat should ask clarifying question
}

function matchAssumptionField(text: string): string | null {
  const cleaned = text.trim().toLowerCase();
  const aliases: Record<string, string> = {
    'revenue': 'monthly_revenue',
    'monthly revenue': 'monthly_revenue',
    'order value': 'avg_order_value',
    'aov': 'avg_order_value',
    'orders': 'monthly_orders',
    'monthly orders': 'monthly_orders',
    'tickets': 'support_tickets_per_week',
    'support tickets': 'support_tickets_per_week',
    'tickets per week': 'support_tickets_per_week',
    'response time': 'avg_response_time_hours',
    'labor cost': 'labor_cost_per_hour',
    'hourly rate': 'labor_cost_per_hour',
    'refund rate': 'refund_rate_percent',
    'conversion rate': 'conversion_rate_percent',
    'conversion': 'conversion_rate_percent',
    'margin': 'gross_margin_percent',
    'gross margin': 'gross_margin_percent',
  };
  return aliases[cleaned] || (ALLOWED_ASSUMPTION_PATHS.includes(cleaned) ? cleaned : null);
}