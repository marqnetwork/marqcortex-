/**
 * SCOPE ENGINE — scope-engine-logic.md
 *
 * 8-step scope protection system wired into the Execution Blueprint.
 *
 * STEPS:
 *   Step 1: Scope Baseline Lock        — immutable reference captured at execution creation
 *   Step 2: Scope Drift Detection      — monitors any change against baseline
 *   Step 3: Change Order Auto-generate — auto-builds structured CO from drift event
 *   Step 4: Change Order Flow          — Draft → Internal Review → Client Approval → Snapshot Extension → Execution Update
 *   Step 5: ROI Protection Hook        — triggers recalc on approval, preserves history
 *   Step 6: Hard Guardrails            — blocks silent edits, requires CO before commit
 *   Step 7: Execution Versioning       — execution_version++ on every approved CO
 *   Step 8: UI Behavior                — "outside signed scope" intercept popup
 *
 * HARD GUARDRAILS (Step 6):
 *   Cannot add integration silently
 *   Cannot extend timeline silently
 *   Cannot add agent/automation silently
 *   Cannot modify baseline without change order
 *   System blocks commit until change order created.
 */

import type { ExecutionProject } from './executionEngine';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export type DriftType =
  | 'new_workstream'
  | 'workstream_duration_extended'
  | 'new_integration'
  | 'feature_not_in_baseline'
  | 'task_count_increase'
  | 'timeline_extended'
  | 'cost_changed';

export const DRIFT_TYPE_LABELS: Record<DriftType, string> = {
  new_workstream:               'New Workstream Added',
  workstream_duration_extended: 'Workstream Duration Extended',
  new_integration:              'New Integration Added',
  feature_not_in_baseline:      'Feature Not in Baseline',
  task_count_increase:          'Task Count Increase > Threshold',
  timeline_extended:            'Timeline Extended',
  cost_changed:                 'Cost Changed',
};

export const DRIFT_TYPE_SEVERITY: Record<DriftType, 'low' | 'medium' | 'high'> = {
  new_workstream:               'high',
  workstream_duration_extended: 'medium',
  new_integration:              'high',
  feature_not_in_baseline:      'medium',
  task_count_increase:          'low',
  timeline_extended:            'medium',
  cost_changed:                 'high',
};

/**
 * Step 1 — Scope Baseline Lock.
 * Captured when execution is created. Becomes comparison anchor.
 * Never editable without a change order.
 */
export interface ScopeBaseline {
  execution_id:          string;
  locked_at:             string;
  /** Deterministic hash of scope content. Detects tampering. */
  baseline_hash:         string;
  included_workstreams:  string[];
  included_integrations: string[];
  included_features:     string[];
  excluded_items:        string[];
  timeline_weeks:        number;
  investment_total:      number;
  /** Baseline task count — threshold for drift detection */
  task_count_baseline:   number;
}

/**
 * Step 2 — Scope Drift Event.
 * Logged each time the engine detects deviation from baseline.
 * Execution paused until resolved.
 */
export interface ScopeDriftEvent {
  drift_id:              string;
  execution_id:          string;
  detected_at:           string;
  drift_type:            DriftType;
  description:           string;
  severity:              'low' | 'medium' | 'high';
  scope_drift_detected:  boolean;
  change_order_required: boolean;
  execution_status:      'paused_for_review' | 'active';
  auto_co_id?:           string;
  resolved:              boolean;
  resolved_at?:          string;
  resolved_by?:          string;
}

/**
 * Step 3 — Change Order Impact Analysis.
 * Auto-calculated from drift event. No manual writing needed.
 */
export interface ChangeOrderImpactAnalysis {
  additional_weeks:        number;
  additional_cost:         number;
  roi_adjustment_required: boolean;
  new_timeline_weeks:      number;
  new_investment_total:    number;
}

/**
 * Step 4 — Change Order Flow Steps.
 * Draft → Internal Review → Client Approval → Snapshot Extension → Execution Update → Approved
 * Any step can move to Rejected.
 */
export type ChangeOrderFlowStep =
  | 'draft'
  | 'internal_review'
  | 'client_approval'
  | 'snapshot_extension'
  | 'execution_update'
  | 'approved'
  | 'rejected';

export const CO_FLOW_STEPS: ChangeOrderFlowStep[] = [
  'draft',
  'internal_review',
  'client_approval',
  'snapshot_extension',
  'execution_update',
];

export const CO_FLOW_STEP_LABELS: Record<ChangeOrderFlowStep, string> = {
  draft:              'Draft',
  internal_review:    'Internal Review',
  client_approval:    'Client Approval',
  snapshot_extension: 'Snapshot Extension',
  execution_update:   'Execution Update',
  approved:           'Approved',
  rejected:           'Rejected',
};

export interface COFlowHistoryEntry {
  step:    ChangeOrderFlowStep;
  at:      string;
  by:      string;
  note?:   string;
}

/** Step 3–4 — Scope Change Order (auto-generated, never manually written). */
export interface ScopeChangeOrder {
  change_order_id: string;
  execution_id:    string;
  drift_id:        string;
  drift_type:      DriftType;
  reason:          string;
  impact_analysis: ChangeOrderImpactAnalysis;
  status:          ChangeOrderFlowStep;
  created_at:      string;
  created_by:      string;
  history:         COFlowHistoryEntry[];
  version_before:  number;
  version_after?:  number;
}

/**
 * Step 5 — ROI Protection Record.
 * Old ROI preserved historically. New ROI generated for updated scope.
 */
export interface ROIProtectionRecord {
  co_id:                string;
  triggered_at:         string;
  snapshot_version:     number;
  roi_12m_before:       number;
  roi_12m_after:        number;
  new_baseline_version: number;
  roi_recalc_required:  boolean;
}

/** Step 6 — Guardrail check result. */
export interface GuardrailCheck {
  blocked:  boolean;
  /** Human-readable reasons for block */
  reasons:  string[];
  action:   'create_co' | 'proceed';
  proposed: ProposedScopeChange;
}

/** Input to the scope engine — describes what the user is trying to do. */
export interface ProposedScopeChange {
  description:       string;
  change_type:       DriftType;
  new_workstream?:   string;
  new_integration?:  string;
  new_feature?:      string;
  additional_weeks?: number;
  additional_cost?:  number;
  new_task_count?:   number;
}

/** Full scope engine state — persisted per execution. */
export interface ScopeEngineState {
  execution_id:            string;
  /** Step 7 — increments on every approved CO */
  execution_version:       number;
  linked_snapshot_version: number;
  scope_baseline:          ScopeBaseline;
  drift_log:               ScopeDriftEvent[];
  scope_change_orders:     ScopeChangeOrder[];
  roi_history:             ROIProtectionRecord[];
  /** true when unresolved high-severity drift events exist */
  is_paused:               boolean;
  guardrails_active:       boolean;
  last_checked:            string;
}

/** Output of runScopeEngine */
export interface ScopeEngineResult {
  guardrail:     GuardrailCheck;
  drift_event?:  ScopeDriftEvent;
  change_order?: ScopeChangeOrder;
  state:         ScopeEngineState;
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY
// ════════════════════════════════════════════════════════════════════════════════

let _driftCount = 0;
let _coCount    = 0;

function driftId() { return `DFT-${String(++_driftCount).padStart(4, '0')}`; }
function coScopeId() { return `SCO-${String(++_coCount).padStart(4, '0')}`; }

/** Deterministic djb2 hash — no crypto dep needed. */
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h).toString(16).padStart(8, '0').toUpperCase();
}

export function computeBaselineHash(baseline: Omit<ScopeBaseline, 'baseline_hash'>): string {
  const content = JSON.stringify({
    ws:   [...baseline.included_workstreams].sort(),
    int:  [...baseline.included_integrations].sort(),
    feat: [...baseline.included_features].sort(),
    excl: [...baseline.excluded_items].sort(),
    tw:   baseline.timeline_weeks,
    inv:  baseline.investment_total,
    tc:   baseline.task_count_baseline,
  });
  return `sha256:${djb2(content)}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 1 — BUILD SCOPE BASELINE
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Step 1: Capture immutable scope reference from snapshot.
 * Called when execution is created. Never mutated after lock.
 */
export function buildScopeBaseline(project: ExecutionProject): ScopeBaseline {
  const sb = project.scope_boundaries;
  const partial: Omit<ScopeBaseline, 'baseline_hash'> = {
    execution_id:          project.execution_id,
    locked_at:             project.created_at,
    included_workstreams:  project.workstreams.map(w => w.title),
    included_integrations: sb.integration_points,
    included_features:     sb.scope_included,
    excluded_items:        sb.scope_excluded,
    timeline_weeks:        project.milestones.reduce((max, ms) => Math.max(max, ms.end_week ?? 0), 0) || 12,
    investment_total:      project.baseline.metrics_snapshot.total_investment,
    task_count_baseline:   project.tasks.length,
  };
  return { ...partial, baseline_hash: computeBaselineHash(partial) };
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 2 — SCOPE DRIFT DETECTION
// ════════════════════════════════════════════════════════════════════════════════

const TASK_COUNT_DRIFT_THRESHOLD = 0.2; // 20% increase triggers drift

/**
 * Step 2: Compare a proposed change against the scope baseline.
 * Returns an array of detected drift events.
 * All drift types listed in spec are checked.
 */
export function detectScopeDrift(
  proposed:  ProposedScopeChange,
  baseline:  ScopeBaseline,
): ScopeDriftEvent | null {
  const executionId = baseline.execution_id;
  const now         = new Date().toISOString();

  switch (proposed.change_type) {
    case 'new_workstream':
      return {
        drift_id:              driftId(),
        execution_id:          executionId,
        detected_at:           now,
        drift_type:            'new_workstream',
        description:           `New workstream proposed: "${proposed.new_workstream ?? proposed.description}". Not in baseline (${baseline.included_workstreams.length} workstreams locked).`,
        severity:              DRIFT_TYPE_SEVERITY.new_workstream,
        scope_drift_detected:  true,
        change_order_required: true,
        execution_status:      'paused_for_review',
        resolved:              false,
      };

    case 'new_integration':
      return {
        drift_id:              driftId(),
        execution_id:          executionId,
        detected_at:           now,
        drift_type:            'new_integration',
        description:           `New integration requested: "${proposed.new_integration ?? proposed.description}". Baseline locked ${baseline.included_integrations.length} integration(s). New integrations trigger scope engine.`,
        severity:              DRIFT_TYPE_SEVERITY.new_integration,
        scope_drift_detected:  true,
        change_order_required: true,
        execution_status:      'paused_for_review',
        resolved:              false,
      };

    case 'feature_not_in_baseline':
      return {
        drift_id:              driftId(),
        execution_id:          executionId,
        detected_at:           now,
        drift_type:            'feature_not_in_baseline',
        description:           `Feature requested: "${proposed.new_feature ?? proposed.description}". Not present in baseline feature set (${baseline.included_features.length} features).`,
        severity:              DRIFT_TYPE_SEVERITY.feature_not_in_baseline,
        scope_drift_detected:  true,
        change_order_required: true,
        execution_status:      'paused_for_review',
        resolved:              false,
      };

    case 'timeline_extended': {
      const addWks = proposed.additional_weeks ?? 0;
      return {
        drift_id:              driftId(),
        execution_id:          executionId,
        detected_at:           now,
        drift_type:            'timeline_extended',
        description:           `Timeline extension of +${addWks} week(s) proposed. Baseline: ${baseline.timeline_weeks} weeks → New: ${baseline.timeline_weeks + addWks} weeks.`,
        severity:              DRIFT_TYPE_SEVERITY.timeline_extended,
        scope_drift_detected:  true,
        change_order_required: true,
        execution_status:      'paused_for_review',
        resolved:              false,
      };
    }

    case 'workstream_duration_extended': {
      const addWks = proposed.additional_weeks ?? 0;
      return {
        drift_id:              driftId(),
        execution_id:          executionId,
        detected_at:           now,
        drift_type:            'workstream_duration_extended',
        description:           `Workstream duration extended by +${addWks} week(s). Requires change order to update timeline.`,
        severity:              DRIFT_TYPE_SEVERITY.workstream_duration_extended,
        scope_drift_detected:  true,
        change_order_required: true,
        execution_status:      'paused_for_review',
        resolved:              false,
      };
    }

    case 'cost_changed': {
      const addCost = proposed.additional_cost ?? 0;
      return {
        drift_id:              driftId(),
        execution_id:          executionId,
        detected_at:           now,
        drift_type:            'cost_changed',
        description:           `Investment change of +${addCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} proposed. Baseline: $${baseline.investment_total.toLocaleString()}. ROI recalculation required.`,
        severity:              DRIFT_TYPE_SEVERITY.cost_changed,
        scope_drift_detected:  true,
        change_order_required: true,
        execution_status:      'paused_for_review',
        resolved:              false,
      };
    }

    case 'task_count_increase': {
      const newCount = proposed.new_task_count ?? 0;
      const pct      = newCount > 0 ? ((newCount - baseline.task_count_baseline) / baseline.task_count_baseline) : 0;
      if (pct <= TASK_COUNT_DRIFT_THRESHOLD) return null;
      return {
        drift_id:              driftId(),
        execution_id:          executionId,
        detected_at:           now,
        drift_type:            'task_count_increase',
        description:           `Task count increased by ${Math.round(pct * 100)}% (${baseline.task_count_baseline} → ${newCount}). Threshold: ${TASK_COUNT_DRIFT_THRESHOLD * 100}%.`,
        severity:              DRIFT_TYPE_SEVERITY.task_count_increase,
        scope_drift_detected:  true,
        change_order_required: true,
        execution_status:      'paused_for_review',
        resolved:              false,
      };
    }

    default:
      return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 3 — AUTO-GENERATE CHANGE ORDER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Step 3: When drift detected, auto-generate structured change object.
 * No manual writing needed.
 */
export function autoGenerateChangeOrder(
  drift:           ScopeDriftEvent,
  baseline:        ScopeBaseline,
  proposed:        ProposedScopeChange,
  userId:          string,
  executionVersion: number,
): ScopeChangeOrder {
  const now         = new Date().toISOString();
  const addWks      = proposed.additional_weeks ?? 0;
  const addCost     = proposed.additional_cost ?? 0;
  const needsROI    = addCost > 0 || addWks > 2;
  const id          = coScopeId();

  const impact: ChangeOrderImpactAnalysis = {
    additional_weeks:        addWks,
    additional_cost:         addCost,
    roi_adjustment_required: needsROI,
    new_timeline_weeks:      baseline.timeline_weeks + addWks,
    new_investment_total:    baseline.investment_total + addCost,
  };

  return {
    change_order_id: id,
    execution_id:    drift.execution_id,
    drift_id:        drift.drift_id,
    drift_type:      drift.drift_type,
    reason:          proposed.description,
    impact_analysis: impact,
    status:          'draft',
    created_at:      now,
    created_by:      userId,
    history:         [{ step: 'draft', at: now, by: userId, note: 'Auto-generated from scope drift detection' }],
    version_before:  executionVersion,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 4 — CHANGE ORDER FLOW
// ════════════════════════════════════════════════════════════════════════════════

const CO_FLOW_NEXT: Record<ChangeOrderFlowStep, ChangeOrderFlowStep | null> = {
  draft:              'internal_review',
  internal_review:    'client_approval',
  client_approval:    'snapshot_extension',
  snapshot_extension: 'execution_update',
  execution_update:   'approved',
  approved:           null,
  rejected:           null,
};

/**
 * Step 4: Advance or reject a change order through the flow.
 *   action = 'advance' → moves to next step
 *   action = 'approve' → moves directly to approved (if at execution_update)
 *   action = 'reject'  → moves to rejected (any step)
 */
export function advanceChangeOrderFlow(
  co:     ScopeChangeOrder,
  action: 'advance' | 'approve' | 'reject',
  userId: string,
  note?:  string,
): ScopeChangeOrder {
  const now = new Date().toISOString();

  if (action === 'reject') {
    return {
      ...co,
      status:  'rejected',
      history: [...co.history, { step: 'rejected', at: now, by: userId, note: note ?? 'Change order rejected' }],
    };
  }

  if (action === 'approve' && co.status === 'execution_update') {
    return {
      ...co,
      status:       'approved',
      version_after: co.version_before + 1,
      history: [...co.history, { step: 'approved', at: now, by: userId, note: note ?? 'Final approval' }],
    };
  }

  const next = CO_FLOW_NEXT[co.status];
  if (!next || next === null) return co;

  return {
    ...co,
    status:  next,
    history: [...co.history, { step: next, at: now, by: userId, note }],
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 5 — ROI PROTECTION HOOK
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Step 5: When change order approved:
 *   - Trigger roi_recalc_required
 *   - Increment new_baseline_version
 *   - Preserve old ROI historically
 *   - New projected ROI generated based on updated scope
 *
 * ROI actuals do not modify projected ROI (safety rule from mapping-engine).
 */
export function triggerROIProtectionHook(
  state:        ScopeEngineState,
  co:           ScopeChangeOrder,
  currentROI:   number,
): { state: ScopeEngineState; record: ROIProtectionRecord } {
  const impact   = co.impact_analysis;
  const addCost  = impact.additional_cost;
  const addWks   = impact.additional_weeks;

  // Simplified ROI adjustment: more cost + more time → reduced ROI
  const roiPenalty  = addCost > 0 ? (addCost / state.scope_baseline.investment_total) * currentROI * 0.15 : 0;
  const wksPenalty  = addWks > 0  ? addWks * 2 : 0;
  const newROI      = Math.max(0, currentROI - roiPenalty - wksPenalty);

  const record: ROIProtectionRecord = {
    co_id:                co.change_order_id,
    triggered_at:         new Date().toISOString(),
    snapshot_version:     state.linked_snapshot_version,
    roi_12m_before:       currentROI,
    roi_12m_after:        Math.round(newROI),
    new_baseline_version: state.execution_version + 1,
    roi_recalc_required:  true,
  };

  return {
    state: {
      ...state,
      roi_history: [...state.roi_history, record],
    },
    record,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 6 — HARD GUARDRAILS
// ════════════════════════════════════════════════════════════════════════════════

const GUARDRAIL_RULES: Record<DriftType, string> = {
  new_workstream:               'Cannot add workstream silently. Change order required before commit.',
  workstream_duration_extended: 'Cannot extend workstream duration silently. Timeline change order required.',
  new_integration:              'Cannot add integration silently. New integrations trigger scope engine.',
  feature_not_in_baseline:      'Cannot add features not in signed scope. Change order required.',
  task_count_increase:          'Task count increase exceeds 20% threshold. Change order required.',
  timeline_extended:            'Cannot extend timeline silently. Sponsor sign-off required.',
  cost_changed:                 'Cannot modify investment total without change order. ROI recalculation will be triggered.',
};

/**
 * Step 6: Check hard guardrails before any scope expansion.
 * Returns blocked=true + reasons if the change violates signed scope.
 * System blocks commit until change order created.
 */
export function checkHardGuardrails(
  proposed: ProposedScopeChange,
  state:    ScopeEngineState,
): GuardrailCheck {
  if (!state.guardrails_active) {
    return { blocked: false, reasons: [], action: 'proceed', proposed };
  }

  const rule    = GUARDRAIL_RULES[proposed.change_type];
  const blocked = true; // All scope changes require CO when guardrails active
  const reasons = [
    rule,
    `Scope baseline locked at v${state.execution_version} (${state.scope_baseline.baseline_hash}).`,
    'This change is outside signed scope. A change order must be created and approved.',
  ].filter(Boolean);

  return { blocked, reasons, action: 'create_co', proposed };
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 7 — EXECUTION VERSIONING
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Step 7: Increment execution_version on change order approval.
 * Full traceability preserved.
 */
export function incrementExecutionVersion(state: ScopeEngineState): ScopeEngineState {
  return {
    ...state,
    execution_version: state.execution_version + 1,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// STATE INITIALISER
// ════════════════════════════════════════════════════════════════════════════════

export function initScopeEngineState(project: ExecutionProject): ScopeEngineState {
  const baseline = buildScopeBaseline(project);
  return {
    execution_id:            project.execution_id,
    execution_version:       1,
    linked_snapshot_version: project.version_number,
    scope_baseline:          baseline,
    drift_log:               [],
    scope_change_orders:     [],
    roi_history:             [],
    is_paused:               false,
    guardrails_active:       true,
    last_checked:            new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// FULL PIPELINE — runScopeEngine
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Run the full 6-step scope check for a proposed change:
 *   1. Check guardrails (Step 6)
 *   2. Detect drift (Step 2)
 *   3. Auto-generate CO (Step 3)
 *   4. Update state (pause execution)
 *   Returns { guardrail, drift_event, change_order, state }
 */
export function runScopeEngine(
  state:    ScopeEngineState,
  proposed: ProposedScopeChange,
  userId:   string = 'U-01',
): ScopeEngineResult {
  // Step 6
  const guardrail = checkHardGuardrails(proposed, state);

  if (!guardrail.blocked) {
    return { guardrail, state: { ...state, last_checked: new Date().toISOString() } };
  }

  // Step 2
  const drift = detectScopeDrift(proposed, state.scope_baseline);

  if (!drift) {
    return { guardrail: { ...guardrail, blocked: false, action: 'proceed' }, state };
  }

  // Step 3 — auto-generate CO
  const co = autoGenerateChangeOrder(drift, state.scope_baseline, proposed, userId, state.execution_version);

  // Update state — mark drift as pointing to CO, pause execution
  const driftWithCO: ScopeDriftEvent = { ...drift, auto_co_id: co.change_order_id };

  const newState: ScopeEngineState = {
    ...state,
    is_paused:           drift.severity === 'high',
    drift_log:           [...state.drift_log, driftWithCO],
    scope_change_orders: [...state.scope_change_orders, co],
    last_checked:        new Date().toISOString(),
  };

  return { guardrail, drift_event: driftWithCO, change_order: co, state: newState };
}

// ════════════════════════════════════════════════════════════════════════════════
// PROCESS APPROVED CO — wires Steps 4 + 5 + 7 together
// ════════════════════════════════════════════════════════════════════════════════

export function processApprovedCO(
  state:      ScopeEngineState,
  coId:       string,
  currentROI: number,
  userId:     string = 'U-01',
): ScopeEngineState {
  let co = state.scope_change_orders.find(c => c.change_order_id === coId);
  if (!co) return state;

  // Advance through all remaining flow steps to approved
  let advanced = co;
  while (advanced.status !== 'approved' && advanced.status !== 'rejected') {
    const next = CO_FLOW_NEXT[advanced.status];
    if (!next) break;
    if (next === 'approved') {
      advanced = advanceChangeOrderFlow(advanced, 'approve', userId);
    } else {
      advanced = advanceChangeOrderFlow(advanced, 'advance', userId);
    }
  }

  // Step 5 — ROI protection
  const { state: stateAfterROI, record } = triggerROIProtectionHook(state, advanced, currentROI);

  // Step 7 — version increment
  const versioned = incrementExecutionVersion(stateAfterROI);

  // Resolve drift event
  const drift = versioned.drift_log.find(d => d.drift_id === co!.drift_id);
  const updatedDriftLog = versioned.drift_log.map(d =>
    d.drift_id === co!.drift_id
      ? { ...d, resolved: true, resolved_at: new Date().toISOString(), resolved_by: userId }
      : d
  );

  return {
    ...versioned,
    scope_change_orders: versioned.scope_change_orders.map(c => c.change_order_id === coId ? advanced : c),
    drift_log:           updatedDriftLog,
    is_paused:           updatedDriftLog.some(d => !d.resolved && d.severity === 'high'),
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// MOCK SEED STATE — for ExampleCo demo
// ════════════════════════════════════════════════════════════════════════════════

export function buildMockScopeEngineState(project: ExecutionProject): ScopeEngineState {
  const baseline = buildScopeBaseline(project);
  const now      = new Date();
  const d1: ScopeDriftEvent = {
    drift_id:              'DFT-SEED-01',
    execution_id:          project.execution_id,
    detected_at:           new Date(now.getTime() - 3 * 86400000).toISOString(),
    drift_type:            'new_integration',
    description:           'New integration requested: "Slack notification API". Baseline locked 4 integration(s). New integrations trigger scope engine.',
    severity:              'high',
    scope_drift_detected:  true,
    change_order_required: true,
    execution_status:      'paused_for_review',
    auto_co_id:            'SCO-SEED-01',
    resolved:              false,
  };
  const co1: ScopeChangeOrder = {
    change_order_id: 'SCO-SEED-01',
    execution_id:    project.execution_id,
    drift_id:        'DFT-SEED-01',
    drift_type:      'new_integration',
    reason:          'Client requested all AI-generated alerts route through Slack in addition to email. Not in original scope.',
    impact_analysis: {
      additional_weeks:        0,
      additional_cost:         4200,
      roi_adjustment_required: false,
      new_timeline_weeks:      baseline.timeline_weeks,
      new_investment_total:    baseline.investment_total + 4200,
    },
    status:         'internal_review',
    created_at:     new Date(now.getTime() - 3 * 86400000).toISOString(),
    created_by:     'Account Lead',
    history: [
      { step: 'draft',           at: new Date(now.getTime() - 3 * 86400000).toISOString(), by: 'Account Lead', note: 'Auto-generated from scope drift detection' },
      { step: 'internal_review', at: new Date(now.getTime() - 1 * 86400000).toISOString(), by: 'Account Lead', note: 'Reviewed and ready for client approval' },
    ],
    version_before: 1,
  };
  return {
    execution_id:            project.execution_id,
    execution_version:       1,
    linked_snapshot_version: project.version_number,
    scope_baseline:          baseline,
    drift_log:               [d1],
    scope_change_orders:     [co1],
    roi_history:             [],
    is_paused:               false,
    guardrails_active:       true,
    last_checked:            new Date().toISOString(),
  };
}
