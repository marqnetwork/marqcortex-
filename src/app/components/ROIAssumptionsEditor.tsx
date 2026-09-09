/**
 * ROI ASSUMPTIONS EDITOR
 *
 * Architecture spec from roi-assumptions-editor.md:
 *   1. Assumption Table — Variable, Current Value, Editable Field, Source, Sensitivity, Version
 *   2. Validation Rules — Hard logic (percent 0-100, positive revenue, no negatives, margin cap 90%)
 *   3. Edit → ChangeRequest Trigger — Auto-generates UpdateAssumption + full recalc
 *   4. Sensitivity Preview — Shows estimated ROI impact before applying
 *   5. Audit Panel — What changed, who, what version, ROI delta
 *
 * Single source of truth for editable business assumptions.
 * Math decides priority. LLM only explains decisions.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  DollarSign, Edit3, Shield, AlertTriangle, CheckCircle2, Clock,
  ChevronDown, ChevronRight, Zap, RotateCcw, ArrowRight, Save,
  Info, Lock, Activity, GitBranch, Eye, X,
} from 'lucide-react';
import { applyChangeRequest } from '@/app/core/versionEngine';
import type {
  PortfolioState, PortfolioAssumptions, ChangeRequest, RecalcResult,
} from '@/app/core/types';
import type { ROIAnalysisData } from '@/app/components/ROIExecutiveDashboard';
import {
  brand,
  status as STATUS,
} from '@/app/lib/tokens';


// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

type AssumptionSource = 'User' | 'Estimated' | 'Confirmed';
type SensitivityLevel = 'High' | 'Medium' | 'Low';

interface AssumptionRow {
  key: string;
  label: string;
  currentValue: number;
  editedValue: number;
  source: AssumptionSource;
  sensitivity: SensitivityLevel;
  lastUpdatedVersion: string;
  unit: 'currency' | 'percent' | 'count' | 'hours' | 'currency_hourly';
  min: number;
  max: number;
  description: string;
}

interface ValidationError {
  key: string;
  message: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// ASSUMPTION METADATA — Defines all editable assumptions
// ════════════════════════════════════════════════════════════════════════════════

const ASSUMPTION_META: Record<string, {
  label: string;
  unit: AssumptionRow['unit'];
  min: number;
  max: number;
  description: string;
  defaultSource: AssumptionSource;
}> = {
  monthly_revenue: {
    label: 'Monthly Revenue',
    unit: 'currency',
    min: 0,
    max: 50000000,
    description: 'Total monthly revenue before expenses',
    defaultSource: 'Confirmed',
  },
  avg_order_value: {
    label: 'Avg Order Value',
    unit: 'currency',
    min: 0,
    max: 100000,
    description: 'Average value per transaction/order',
    defaultSource: 'Estimated',
  },
  monthly_orders: {
    label: 'Monthly Orders',
    unit: 'count',
    min: 0,
    max: 10000000,
    description: 'Number of orders/transactions per month',
    defaultSource: 'Estimated',
  },
  support_tickets_per_week: {
    label: 'Support Tickets / Week',
    unit: 'count',
    min: 0,
    max: 100000,
    description: 'Customer support tickets received per week',
    defaultSource: 'Estimated',
  },
  avg_response_time_hours: {
    label: 'Avg Response Time',
    unit: 'hours',
    min: 0,
    max: 168,
    description: 'Average time to first response (hours)',
    defaultSource: 'Estimated',
  },
  labor_cost_per_hour: {
    label: 'Labor Cost / Hour',
    unit: 'currency_hourly',
    min: 0,
    max: 500,
    description: 'Fully loaded cost per labor hour',
    defaultSource: 'Confirmed',
  },
  refund_rate_percent: {
    label: 'Refund Rate',
    unit: 'percent',
    min: 0,
    max: 100,
    description: 'Percentage of orders refunded',
    defaultSource: 'Estimated',
  },
  conversion_rate_percent: {
    label: 'Conversion Rate',
    unit: 'percent',
    min: 0,
    max: 100,
    description: 'Visitor-to-customer conversion rate',
    defaultSource: 'Estimated',
  },
  gross_margin_percent: {
    label: 'Gross Margin',
    unit: 'percent',
    min: 0,
    max: 90,
    description: 'Gross margin percentage (capped at 90%)',
    defaultSource: 'Estimated',
  },
  discount_rate_percent: {
    label: 'Discount Rate (WACC)',
    unit: 'percent',
    min: 0,
    max: 40,
    description: 'Annual hurdle rate for DCF / NPV calculation (finance_v1_dcf §1)',
    defaultSource: 'Estimated',
  },
};

// Sensitivity mapping from roi-analysis.json sensitivity_analysis
function getSensitivity(key: string, sensitivity?: ROIAnalysisData['sensitivity_analysis']): SensitivityLevel {
  if (!sensitivity) return 'Medium';
  // discount_rate_percent only affects DCF/NPV — always Medium (never High for base ROI)
  if (key === 'discount_rate_percent') return 'Medium';
  if (key === sensitivity.most_sensitive_variable) return 'High';
  if (key === sensitivity.second_most_sensitive) return 'High';
  if (key === sensitivity.third_most_sensitive) return 'Medium';
  return 'Low';
}

// Determine source from version history
function getSource(key: string, state?: PortfolioState): AssumptionSource {
  if (!state) return ASSUMPTION_META[key]?.defaultSource ?? 'Estimated';
  // If any version history entry changed this assumption, it's user-confirmed
  for (const v of state.history) {
    for (const d of v.delta_log) {
      if (d.path === `inputs.assumptions.${key}`) {
        return v.actor === 'team_user' ? 'Confirmed' : 'User';
      }
    }
  }
  return ASSUMPTION_META[key]?.defaultSource ?? 'Estimated';
}

// Find last version that changed this assumption
function getLastVersion(key: string, state?: PortfolioState): string {
  if (!state) return 'v1';
  for (const v of state.history) {
    for (const d of v.delta_log) {
      if (d.path === `inputs.assumptions.${key}`) {
        return v.version;
      }
    }
  }
  return state.history[state.history.length - 1]?.version ?? 'v1';
}

// ════════════════════════════════════════════════════════════════════════════════
// VALIDATION RULES
// ════════════════════════════════════════════════════════════════════════════════

function validateAssumption(key: string, value: number): ValidationError | null {
  const meta = ASSUMPTION_META[key];
  if (!meta) return null;

  if (meta.unit === 'percent') {
    if (value < 0 || value > 100) {
      return { key, message: `${meta.label} must be 0–100%` };
    }
    if (key === 'gross_margin_percent' && value > 90) {
      return { key, message: `Gross margin capped at 90% — unrealistic above this threshold` };
    }
  }

  if (meta.unit === 'currency' && value < 0) {
    return { key, message: `${meta.label} must be positive` };
  }

  if (meta.unit === 'count' && value < 0) {
    return { key, message: `${meta.label} cannot be negative` };
  }

  if (meta.unit === 'hours' && value < 0) {
    return { key, message: `${meta.label} cannot be negative` };
  }

  if (meta.unit === 'currency_hourly' && value < 0) {
    return { key, message: `${meta.label} must be positive` };
  }

  // finance_v1_dcf §1: Discount rate must be 0–40%, never negative
  if (key === 'discount_rate_percent') {
    if (value < 0) return { key, message: 'Discount rate cannot be negative (§1)' };
    if (value > 40) return { key, message: 'Discount rate capped at 40% — use the DCF Panel slider for DCF recalculation' };
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════════════
// SENSITIVITY ESTIMATION — Rough impact preview before applying
// ════════════════════════════════════════════════════════════════════════════════

function estimateSensitivityImpact(
  key: string,
  oldValue: number,
  newValue: number,
  sensitivity: SensitivityLevel,
): string | null {
  if (oldValue === newValue || oldValue === 0) return null;

  // finance_v1_dcf §9: discount_rate_percent only affects DCF/NPV, not base ROI
  if (key === 'discount_rate_percent') {
    const dir = newValue > oldValue ? 'decrease' : 'increase';
    const spread = Math.abs(newValue - oldValue);
    return `Changing discount rate by ${spread}% will ${dir} NPV and may shift discounted payback by 1–3 months. Base ROI is unaffected (§7).`;
  }

  const changePct = ((newValue - oldValue) / oldValue) * 100;
  const direction = changePct > 0 ? 'increase' : 'decrease';
  const absChangePct = Math.abs(changePct).toFixed(0);

  // Rough sensitivity multipliers
  const multiplier = sensitivity === 'High' ? 0.8 : sensitivity === 'Medium' ? 0.5 : 0.2;
  const impactLow = Math.abs(changePct * multiplier * 0.7).toFixed(0);
  const impactHigh = Math.abs(changePct * multiplier * 1.3).toFixed(0);

  const label = ASSUMPTION_META[key]?.label ?? key.replace(/_/g, ' ');
  return `Changing ${label} by ${absChangePct}% may ${direction} portfolio ROI by ~${impactLow}–${impactHigh}%.`;
}

// ════════════════════════════════════════════════════════════════════════════════
// PROPS
// ════════════════════════════════════════════════════════════════════════════════

interface ROIAssumptionsEditorProps {
  portfolioState?: PortfolioState;
  sensitivityData?: ROIAnalysisData['sensitivity_analysis'];
  onPortfolioUpdate?: (newState: PortfolioState, result: RecalcResult) => void;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════════

export function ROIAssumptionsEditor({
  portfolioState,
  sensitivityData,
  onPortfolioUpdate,
}: ROIAssumptionsEditorProps) {
  const assumptions: PortfolioAssumptions | undefined = portfolioState?.inputs?.assumptions;

  // Build assumption rows from current state
  const rows: AssumptionRow[] = useMemo(() => {
    if (!assumptions) return [];
    return Object.keys(ASSUMPTION_META).map(key => {
      const meta = ASSUMPTION_META[key];
      const currentValue = (assumptions as any)[key] ?? 0;
      return {
        key,
        label: meta.label,
        currentValue,
        editedValue: currentValue,
        source: getSource(key, portfolioState),
        sensitivity: getSensitivity(key, sensitivityData),
        lastUpdatedVersion: getLastVersion(key, portfolioState),
        unit: meta.unit,
        min: meta.min,
        max: meta.max,
        description: meta.description,
      };
    });
  }, [assumptions, portfolioState, sensitivityData]);

  const [editedRows, setEditedRows] = useState<Record<string, number>>({});
  const [showAudit, setShowAudit] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [applyResult, setApplyResult] = useState<RecalcResult | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  // §9 — Performance Safeguard: 10-second debounce for rapid edits
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debounceCountdown, setDebounceCountdown] = useState(0);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // §7 — Lock detection
  const isLocked = portfolioState?.history[0]?.locked_for_export === true
    || portfolioState?.history[0]?.is_approved === true;

  // Merge edited values
  const currentRows = useMemo(() =>
    rows.map(r => ({
      ...r,
      editedValue: editedRows[r.key] !== undefined ? editedRows[r.key] : r.currentValue,
    })),
    [rows, editedRows],
  );

  // Changed rows
  const changedRows = useMemo(
    () => currentRows.filter(r => r.editedValue !== r.currentValue),
    [currentRows],
  );

  // Validation
  const validationErrors = useMemo(() => {
    const errors: ValidationError[] = [];
    for (const row of currentRows) {
      if (row.editedValue !== row.currentValue) {
        const err = validateAssumption(row.key, row.editedValue);
        if (err) errors.push(err);
      }
    }
    return errors;
  }, [currentRows]);

  const hasChanges = changedRows.length > 0;
  const hasErrors = validationErrors.length > 0;
  const canApply = hasChanges && !hasErrors && !!portfolioState && !!onPortfolioUpdate;

  // Sensitivity previews
  const previews = useMemo(() => {
    return changedRows
      .map(r => estimateSensitivityImpact(r.key, r.currentValue, r.editedValue, r.sensitivity))
      .filter(Boolean) as string[];
  }, [changedRows]);

  const handleEdit = useCallback((key: string, value: number) => {
    setEditedRows(prev => ({ ...prev, [key]: value }));
    setApplyResult(null);

    // §9 — Performance Safeguard: 10-second debounce for rapid edits
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    setDebounceCountdown(10);
    countdownIntervalRef.current = setInterval(() => {
      setDebounceCountdown(prev => prev - 1);
    }, 1000);
    debounceTimerRef.current = setTimeout(() => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      setDebounceCountdown(0);
    }, 10000);
  }, []);

  const handleReset = useCallback(() => {
    setEditedRows({});
    setApplyResult(null);
    setShowPreview(false);
  }, []);

  const handleApply = useCallback(() => {
    if (!portfolioState || !onPortfolioUpdate || !canApply) return;
    setIsApplying(true);

    const changeRequest: ChangeRequest = {
      type: 'UpdateAssumption',
      changes: changedRows.map(r => ({
        path: `inputs.assumptions.${r.key}`,
        value: r.editedValue,
        reason: `Manual edit: ${r.label} changed from ${r.currentValue} to ${r.editedValue}`,
      })),
    };

    const result = applyChangeRequest(portfolioState, changeRequest, 'team_user', 'manual_edit');

    if (result.success) {
      onPortfolioUpdate(result.state, result);
      setApplyResult(result);
      setEditedRows({});
      setShowPreview(false);
    } else {
      setApplyResult(result);
    }

    setIsApplying(false);
  }, [portfolioState, onPortfolioUpdate, canApply, changedRows]);

  if (!portfolioState || !assumptions) {
    return (
      <div className="bg-white/[0.02] border border-cortex-subtle rounded-cortex-md p-6 text-center">
        <Lock className="size-6 text-cortex-faint mx-auto mb-2" />
        <p className="text-sm text-cortex-muted">Portfolio state not available. Assumptions editor requires an active diagnostic.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Edit3 className="size-5 text-cortex-warning" />
          Financial Assumptions (Editable)
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cortex-control border border-cortex-default text-cortex-muted">
            {portfolioState.current_version}
          </span>
          {hasChanges && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1 px-2.5 py-1 rounded-cortex-sm text-[11px] font-medium text-cortex-muted hover:text-white bg-cortex-control hover:bg-cortex-control-hover transition-all"
            >
              <RotateCcw className="size-3" />
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="text-xs text-cortex-muted -mt-3">
        The only place team members can change numbers that affect ROI. Every edit creates a new version.
      </div>

      {/* §7 — Lock Warning */}
      {isLocked && (
        <div className="bg-cortex-warning/8 border border-cortex-warning/20 rounded-cortex-md p-4 flex items-start gap-3">
          <Lock className="size-4 text-cortex-warning flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-cortex-warning">Version Locked for Export</h4>
            <p className="text-[11px] text-cortex-muted mt-0.5">
              {portfolioState.current_version} is approved and locked. Editing will create a new working version.
              No silent changes after approval.
            </p>
          </div>
        </div>
      )}

      {/* §9 — Debounce Indicator */}
      {debounceCountdown > 0 && hasChanges && (
        <div className="flex items-center gap-2 text-[11px] text-cortex-muted">
          <Activity className="size-3 animate-pulse text-cortex-accent" />
          <span>Batching edits... ready in {debounceCountdown}s</span>
          <div className="flex-1 h-1 bg-cortex-control rounded-full overflow-hidden">
            <div
              className="h-full bg-cortex-accent/40 rounded-full transition-all duration-1000"
              style={{ width: `${(1 - debounceCountdown / 10) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1: ASSUMPTION TABLE
          ══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-cortex-default">
              <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-cortex-muted">Variable</th>
              <th className="text-right px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-cortex-muted">Current</th>
              <th className="text-right px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-cortex-muted w-32">Edit</th>
              <th className="text-center px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-cortex-muted">Source</th>
              <th className="text-center px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-cortex-muted">Sensitivity</th>
              <th className="text-center px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-cortex-muted">Version</th>
            </tr>
          </thead>
          <tbody>
            {currentRows.map(row => {
              const isChanged = row.editedValue !== row.currentValue;
              const error = validationErrors.find(e => e.key === row.key);
              return (
                <AssumptionTableRow
                  key={row.key}
                  row={row}
                  isChanged={isChanged}
                  error={error}
                  onEdit={handleEdit}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 2: VALIDATION ERRORS
          ══════════════════════════════════════════════════════════════════════ */}
      {validationErrors.length > 0 && (
        <div className="bg-cortex-danger/8 border border-cortex-danger/20 rounded-cortex-md p-4">
          <h4 className="text-xs font-bold text-cortex-danger flex items-center gap-2 mb-2">
            <AlertTriangle className="size-3.5" />
            Validation Errors — Recalculation Blocked
          </h4>
          <div className="space-y-1">
            {validationErrors.map(err => (
              <div key={err.key} className="text-[11px] text-cortex-danger/80 flex items-center gap-2">
                <X className="size-3 flex-shrink-0" />
                {err.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 4: SENSITIVITY PREVIEW (Before Apply)
          ══════════════════════════════════════════════════════════════════════ */}
      {hasChanges && previews.length > 0 && (
        <div className="bg-gradient-to-r from-cortex-accent/8 to-cortex-accent-alt/5 border border-cortex-accent/20 rounded-cortex-md p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="size-4 text-cortex-accent" />
            <h4 className="text-xs font-bold text-cortex-accent">Sensitivity Preview</h4>
            <span className="text-[9px] text-cortex-faint">Estimated impact before applying</span>
          </div>
          <div className="space-y-1.5">
            {previews.map((preview, idx) => (
              <div key={idx} className="text-[11px] text-cortex-muted flex items-start gap-2">
                <Info className="size-3 text-cortex-accent flex-shrink-0 mt-0.5" />
                {preview}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 3: APPLY CHANGES BUTTON
          ══════════════════════════════════════════════════════════════════════ */}
      {hasChanges && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-cortex-sm text-sm font-medium bg-cortex-control text-cortex-muted hover:bg-cortex-control-hover hover:text-white transition-all"
          >
            <Eye className="size-4" />
            Preview Changes ({changedRows.length})
          </button>
          <button
            onClick={handleApply}
            disabled={!canApply || isApplying}
            className={`flex items-center gap-1.5 px-5 py-2.5 rounded-cortex-sm text-sm font-bold transition-all ${
              canApply
                ? 'bg-cortex-success hover:bg-cortex-success-deep text-white'
                : 'bg-gray-800 text-cortex-faint cursor-not-allowed'
            }`}
          >
            {isApplying ? (
              <span className="flex items-center gap-1.5">
                <Activity className="size-4 animate-spin" />
                Recalculating...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Save className="size-4" />
                Apply & Recalculate
              </span>
            )}
          </button>
          {hasErrors && (
            <span className="text-[11px] text-cortex-danger font-medium flex items-center gap-1">
              <AlertTriangle className="size-3" />
              Fix validation errors first
            </span>
          )}
        </div>
      )}

      {/* Preview detail */}
      {showPreview && changedRows.length > 0 && (
        <div className="bg-cortex-raised border border-cortex-accent/20 rounded-cortex-md p-4">
          <h4 className="text-xs font-bold text-cortex-accent mb-3 flex items-center gap-2">
            <Edit3 className="size-3.5" />
            Pending Changes
          </h4>
          <div className="space-y-2">
            {changedRows.map(row => (
              <div key={row.key} className="flex items-center gap-3 text-xs bg-black/20 rounded-cortex-sm px-3 py-2">
                <span className="font-bold text-white w-40">{row.label}</span>
                <span className="text-cortex-muted">{formatValue(row.currentValue, row.unit)}</span>
                <ArrowRight className="size-3 text-cortex-accent" />
                <span className="text-cortex-accent font-bold">{formatValue(row.editedValue, row.unit)}</span>
                <span className="text-cortex-faint ml-auto text-[10px]">
                  {((row.editedValue - row.currentValue) / (row.currentValue || 1) * 100).toFixed(1)}% change
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[9px] text-cortex-faint">
            This will generate an UpdateAssumption ChangeRequest and trigger full recalculation pipeline:
            Scoring → Portfolio → Feasibility → Confidence → ROI → Narrative
          </div>
        </div>
      )}

      {/* Apply result */}
      {applyResult && (
        <div className={`rounded-cortex-md p-4 ${applyResult.success ? 'bg-cortex-success/8 border border-cortex-success/20' : 'bg-cortex-danger/8 border border-cortex-danger/20'}`}>
          <div className="flex items-center gap-2 mb-1">
            {applyResult.success
              ? <CheckCircle2 className="size-4 text-cortex-success" />
              : <AlertTriangle className="size-4 text-cortex-danger" />
            }
            <span className={`text-sm font-bold ${applyResult.success ? 'text-cortex-success' : 'text-cortex-danger'}`}>
              {applyResult.success ? `Recalculated → ${applyResult.new_version}` : 'Recalculation Failed'}
            </span>
          </div>
          <p className="text-xs text-cortex-muted">{applyResult.summary}</p>
          {applyResult.changed_sections.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {applyResult.changed_sections.map(s => (
                <span key={s} className="text-[9px] px-2 py-0.5 rounded-full bg-cortex-success/10 text-cortex-success font-bold">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 5: AUDIT PANEL
          ══════════════════════════════════════════════════════════════════════ */}
      <div>
        <button
          onClick={() => setShowAudit(!showAudit)}
          className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-cortex-sm hover:bg-white/[0.03] transition-colors"
        >
          {showAudit ? <ChevronDown className="size-4 text-cortex-muted" /> : <ChevronRight className="size-4 text-cortex-muted" />}
          <GitBranch className="size-4 text-cortex-info" />
          <span className="text-sm font-semibold text-cortex-muted">Assumption Change History</span>
          <span className="text-[10px] text-cortex-faint ml-1">
            ({portfolioState.history.filter(v => v.delta_log.some(d => d.path.startsWith('inputs.assumptions.'))).length} versions)
          </span>
        </button>

        {showAudit && (
          <AuditPanel portfolioState={portfolioState} />
        )}
      </div>

      {/* Governance footer */}
      <div className="bg-white/[0.01] border border-white/[0.04] rounded-cortex-md p-4">
        <div className="text-[9px] text-cortex-faint">
          <span className="font-bold text-cortex-faint">Assumption Governance:</span> Every edit creates a new version with full audit trail.
          No silent corrections. Invalid values block recalculation. All ROI traces back to these assumptions.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ASSUMPTION TABLE ROW
// ════════════════════════════════════════════════════════════════════════════════

function AssumptionTableRow({
  row,
  isChanged,
  error,
  onEdit,
}: {
  row: AssumptionRow;
  isChanged: boolean;
  error?: ValidationError;
  onEdit: (key: string, value: number) => void;
}) {
  const sensitivityColors: Record<SensitivityLevel, string> = {
    High: STATUS.danger,
    Medium: STATUS.warning,
    Low: STATUS.success,
  };

  const sourceColors: Record<AssumptionSource, string> = {
    User: brand.accent,
    Estimated: STATUS.warning,
    Confirmed: STATUS.success,
  };

  return (
    <tr className={`border-b border-cortex-subtle transition-colors ${isChanged ? 'bg-cortex-accent/5' : 'hover:bg-white/[0.02]'} ${error ? 'bg-cortex-danger/5' : ''}`}>
      {/* Variable name + description */}
      <td className="px-4 py-3">
        <div className="text-xs font-medium text-white">{row.label}</div>
        <div className="text-[9px] text-cortex-faint">{row.description}</div>
      </td>

      {/* Current value */}
      <td className="px-3 py-3 text-right">
        <span className={`text-xs font-mono ${isChanged ? 'text-cortex-muted line-through' : 'text-cortex-secondary'}`}>
          {formatValue(row.currentValue, row.unit)}
        </span>
      </td>

      {/* Editable field */}
      <td className="px-3 py-3">
        <div className="relative">
          <input
            type="number"
            value={row.editedValue}
            onChange={e => onEdit(row.key, parseFloat(e.target.value) || 0)}
            min={row.min}
            max={row.max}
            step={row.unit === 'percent' ? 0.1 : 1}
            className={`w-full text-right text-xs font-mono px-2.5 py-1.5 rounded-cortex-sm bg-cortex-control border transition-all focus:outline-none focus:ring-1 ${
              error
                ? 'border-cortex-danger/40 text-cortex-danger focus:ring-cortex-danger'
                : isChanged
                  ? 'border-cortex-accent/40 text-cortex-accent focus:ring-cortex-accent'
                  : 'border-cortex-default text-cortex-secondary focus:ring-white/20'
            }`}
          />
          {row.unit === 'currency' && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-cortex-faint">$</span>}
          {row.unit === 'currency_hourly' && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-cortex-faint">$/h</span>}
          {row.unit === 'percent' && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-cortex-faint">%</span>}
          {row.unit === 'hours' && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-cortex-faint">h</span>}
        </div>
        {error && <div className="text-[9px] text-cortex-danger mt-0.5">{error.message}</div>}
      </td>

      {/* Source */}
      <td className="px-3 py-3 text-center">
        <span
          className="text-[9px] font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${sourceColors[row.source]}15`, color: sourceColors[row.source] }}
        >
          {row.source}
        </span>
      </td>

      {/* Sensitivity */}
      <td className="px-3 py-3 text-center">
        <span
          className="text-[9px] font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${sensitivityColors[row.sensitivity]}15`, color: sensitivityColors[row.sensitivity] }}
        >
          {row.sensitivity}
        </span>
      </td>

      {/* Last updated version */}
      <td className="px-3 py-3 text-center">
        <span className="text-[10px] font-mono text-cortex-muted">{row.lastUpdatedVersion}</span>
      </td>
    </tr>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// AUDIT PANEL — Shows all assumption changes across versions
// ════════════════════════════════════════════════════════════════════════════════

function AuditPanel({
  portfolioState,
}: {
  portfolioState: PortfolioState;
}) {
  // Filter history to only versions that changed assumptions
  const assumptionVersions = portfolioState.history.filter(
    v => v.delta_log.some(d => d.path.startsWith('inputs.assumptions.')),
  );

  if (assumptionVersions.length === 0) {
    return (
      <div className="ml-8 mt-2 text-xs text-cortex-faint italic">
        No assumption changes recorded yet. Initial values from system estimation.
      </div>
    );
  }

  return (
    <div className="ml-8 mt-2 space-y-3 pb-2">
      {assumptionVersions.map(version => (
        <div key={version.version} className="bg-cortex-sunken border border-white/[0.06] rounded-cortex-md p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono font-bold text-cortex-info">{version.version}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cortex-control text-cortex-muted font-medium">
              {version.actor}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cortex-accent/10 text-cortex-accent font-bold uppercase">
              {version.source}
            </span>
            <span className="text-[10px] text-cortex-faint ml-auto">
              <Clock className="size-3 inline mr-1" />
              {new Date(version.timestamp).toLocaleString()}
            </span>
          </div>

          <div className="text-xs text-cortex-muted mb-2">{version.summary}</div>

          <div className="space-y-1">
            {version.delta_log
              .filter(d => d.path.startsWith('inputs.assumptions.'))
              .map((d, idx) => {
                const varName = d.path.replace('inputs.assumptions.', '').replace(/_/g, ' ');
                return (
                  <div key={idx} className="flex items-center gap-2 text-[11px] bg-black/20 rounded px-2.5 py-1.5">
                    <span className="font-bold text-cortex-warning w-36">{varName}</span>
                    <span className="text-cortex-faint">{String(d.old ?? '—')}</span>
                    <ArrowRight className="size-3 text-cortex-faint" />
                    <span className="text-cortex-info font-bold">{String(d.new_value)}</span>
                    <span className="text-cortex-faint ml-auto text-[9px] max-w-[200px] truncate">{d.reason}</span>
                  </div>
                );
              })
            }
          </div>

          {/* Recalc engines */}
          <div className="flex flex-wrap gap-1 mt-2">
            {Object.entries(version.recalc)
              .filter(([, v]) => v)
              .map(([engine]) => (
                <span key={engine} className="text-[8px] px-1.5 py-0.5 rounded bg-cortex-success/10 text-cortex-success font-bold">
                  {engine}
                </span>
              ))
            }
          </div>

          {/* §5 — ROI Delta Summary */}
          {version.roi_delta_summary && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div className="bg-black/20 rounded px-2.5 py-1.5 text-center">
                <div className="text-[8px] text-cortex-faint uppercase">ROI Delta</div>
                <div className={`text-[11px] font-bold ${version.roi_delta_summary.delta_percent >= 0 ? 'text-cortex-success' : 'text-cortex-danger'}`}>
                  {version.roi_delta_summary.delta_percent >= 0 ? '+' : ''}{version.roi_delta_summary.delta_percent}%
                </div>
                <div className="text-[8px] text-cortex-faint">
                  {version.roi_delta_summary.portfolio_roi_old}% → {version.roi_delta_summary.portfolio_roi_new}%
                </div>
              </div>
              <div className="bg-black/20 rounded px-2.5 py-1.5 text-center">
                <div className="text-[8px] text-cortex-faint uppercase">Gain Delta</div>
                <div className={`text-[11px] font-bold ${version.roi_delta_summary.gain_delta >= 0 ? 'text-cortex-success' : 'text-cortex-danger'}`}>
                  {version.roi_delta_summary.gain_delta >= 0 ? '+' : ''}${Math.round(version.roi_delta_summary.gain_delta / 1000)}K
                </div>
                <div className="text-[8px] text-cortex-faint">
                  ${Math.round(version.roi_delta_summary.gain_old / 1000)}K → ${Math.round(version.roi_delta_summary.gain_new / 1000)}K
                </div>
              </div>
              <div className="bg-black/20 rounded px-2.5 py-1.5 text-center">
                <div className="text-[8px] text-cortex-faint uppercase">Payback Delta</div>
                <div className={`text-[11px] font-bold ${version.roi_delta_summary.payback_delta <= 0 ? 'text-cortex-success' : 'text-cortex-danger'}`}>
                  {version.roi_delta_summary.payback_delta <= 0 ? '' : '+'}{version.roi_delta_summary.payback_delta.toFixed(1)}mo
                </div>
                <div className="text-[8px] text-cortex-faint">
                  {version.roi_delta_summary.payback_old.toFixed(1)}mo → {version.roi_delta_summary.payback_new.toFixed(1)}mo
                </div>
              </div>
            </div>
          )}

          {/* §6 — Partial Failure Warning */}
          {version.roi_recalculated === false && version.recalc.roi && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-cortex-danger">
              <AlertTriangle className="size-3" />
              ROI recalculation failed for this version — previous ROI values retained
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function formatValue(value: number, unit: AssumptionRow['unit']): string {
  switch (unit) {
    case 'currency':
      return value >= 1000 ? `$${(value / 1000).toFixed(0)}K` : `$${value.toFixed(0)}`;
    case 'currency_hourly':
      return `$${value.toFixed(0)}/h`;
    case 'percent':
      return `${value}%`;
    case 'hours':
      return `${value}h`;
    case 'count':
      return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : `${value}`;
    default:
      return String(value);
  }
}