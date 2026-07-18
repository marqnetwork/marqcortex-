/**
 * CORTEX REVIEWER MODULE
 * 
 * Internal quality control gate before sending reports, call prep, or proposals.
 * 
 * PURPOSE:
 * Ensures you only sell what you can deliver,
 * and only diagnose what you can defend.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Shield,
  Eye,
  Edit3,
  Send,
  Clock,
  User,
  FileText,
  Phone,
  Target,
  Flag,
  TrendingUp,
  AlertCircle,
  Save,
  Loader2
} from 'lucide-react';
import type { ReviewerChecklist, CheckItem } from '@/app/types/reviewer-checklist';
import {
  EMPTY_CHECKLIST,
  getOverallReviewStatus,
  getCompletionPercentage,
  getFlaggedItems
} from '@/app/types/reviewer-checklist';
import { getReview, saveReview } from '@/app/services/dataService';
import { isBackendEnabled } from '@/config/runtime';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface CortexReviewerModuleProps {
  leadId: string;
  companyName: string;
  reviewType: 'report' | 'call-prep' | 'proposal';
  accessToken?: string;
}

export function CortexReviewerModule({
  leadId,
  companyName,
  reviewType,
  accessToken
}: CortexReviewerModuleProps) {
  const [checklist, setChecklist] = useState<ReviewerChecklist>({
    ...EMPTY_CHECKLIST,
    review_id: `rev_${Date.now()}`,
    lead_id: leadId,
    reviewer_name: 'Current User', // In production: get from auth
    review_date: new Date().toISOString(),
    review_type: reviewType
  });

  const [expandedSection, setExpandedSection] = useState<string | null>('intake');
  const [reviewStartTime] = useState(Date.now());

  // ── Persistence state ──────────────────────────────────────────────────────
  const persistEnabled = Boolean(accessToken) && isBackendEnabled();
  const [isLoading, setIsLoading] = useState(persistEnabled);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  // Gates autosave until the initial load has completed (avoids clobbering
  // a stored review with the empty factory checklist on first render).
  const hasLoadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist the given checklist to the backend (no-op unless enabled).
  const persist = useCallback(async (next: ReviewerChecklist): Promise<boolean> => {
    if (!persistEnabled || !accessToken) return false;
    setSaveStatus('saving');
    try {
      const res = await saveReview(leadId, reviewType, next, accessToken);
      setSaveStatus('saved');
      setLastSavedAt(res.review?.updated_at ?? new Date().toISOString());
      return true;
    } catch (err) {
      console.error('CortexReviewerModule save error:', err);
      setSaveStatus('error');
      return false;
    }
  }, [persistEnabled, accessToken, leadId, reviewType]);

  // ── Load any previously saved review on mount ──
  useEffect(() => {
    let cancelled = false;
    if (!persistEnabled || !accessToken) {
      hasLoadedRef.current = true;
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    getReview(leadId, reviewType, accessToken)
      .then((res) => {
        if (cancelled) return;
        if (res.review) {
          setChecklist(res.review);
          setLastSavedAt(res.review.updated_at ?? null);
          setSaveStatus('saved');
        }
      })
      .catch((err) => console.error('CortexReviewerModule load error:', err))
      .finally(() => {
        if (cancelled) return;
        hasLoadedRef.current = true;
        setIsLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, reviewType, accessToken, persistEnabled]);

  // ── Debounced autosave whenever the checklist changes post-load ──
  useEffect(() => {
    if (!persistEnabled || !hasLoadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void persist(checklist); }, 1200);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [checklist, persistEnabled, persist]);

  const overallStatus = getOverallReviewStatus(checklist);
  const completionPct = getCompletionPercentage(checklist);
  const flaggedItems = getFlaggedItems(checklist);

  const handleCheckToggle = (
    section: keyof Omit<ReviewerChecklist, 'final_decision' | 'review_id' | 'lead_id' | 'reviewer_name' | 'review_date' | 'review_type' | 'time_spent_minutes' | 'revision_notes'>,
    checkKey: string
  ) => {
    setChecklist(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        checks: {
          ...prev[section].checks,
          [checkKey]: {
            ...prev[section].checks[checkKey],
            checked: !prev[section].checks[checkKey].checked
          }
        }
      }
    }));
  };

  const handleFinalDecision = async (decision: 'ready-to-send' | 'needs-revision' | 'not-a-fit') => {
    const timeSpent = Math.round((Date.now() - reviewStartTime) / 1000 / 60); // minutes

    // Build the finalized checklist up-front so we can both update state and
    // persist the exact same object (setState is async, so we can't read it back).
    const finalized: ReviewerChecklist = {
      ...checklist,
      time_spent_minutes: timeSpent,
      final_decision: {
        decision,
        approved_by: checklist.reviewer_name,
        approved_at: new Date().toISOString(),
        reviewer_signature: checklist.reviewer_name,
        notes: checklist.revision_notes,
      }
    };

    setChecklist(finalized);

    // Cancel any pending debounced autosave — this explicit save supersedes it.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    if (persistEnabled) {
      await persist(finalized);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
              <Shield className="size-6 text-[#8B5CF6]" />
              Quality Review
            </h2>
            <p className="text-white/60">
              {companyName} • {reviewType === 'report' ? 'Readiness Report' : reviewType === 'call-prep' ? 'Call Preparation' : 'Proposal'} Review
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SaveIndicator
              persistEnabled={persistEnabled}
              isLoading={isLoading}
              status={saveStatus}
              lastSavedAt={lastSavedAt}
            />
            <ReviewStatusBadge status={overallStatus} />
          </div>
        </div>

        {/* Progress Bar */}
        <div className="bg-black/40 border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white/70">Review Progress</span>
            <span className="text-sm font-semibold text-[#06D7F6]">{completionPct}%</span>
          </div>
          <div className="h-2 bg-black/40 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${completionPct}%` }}
              className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#06D7F6] rounded-full"
            />
          </div>
        </div>
      </div>

      {/* Flagged Items Alert */}
      {flaggedItems.length > 0 && (
        <div className="bg-gradient-to-br from-[#FD4438]/20 to-[#FB923C]/20 border border-[#FD4438]/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-[#FD4438] flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold mb-2 text-[#FD4438]">
                {flaggedItems.length} Item{flaggedItems.length > 1 ? 's' : ''} Require Attention
              </h4>
              <ul className="space-y-1">
                {flaggedItems.map((item, idx) => (
                  <li key={idx} className="text-sm text-white/70">• {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Review Sections */}
      <div className="space-y-3">
        <ReviewSection
          title="A. Intake Quality"
          description="Answers are specific, not vague or buzzwords"
          icon={<FileText className="size-5 text-[#8B5CF6]" />}
          status={checklist.intake_quality.status}
          isExpanded={expandedSection === 'intake'}
          onToggle={() => setExpandedSection(expandedSection === 'intake' ? null : 'intake')}
        >
          <ChecklistItems
            checks={checklist.intake_quality.checks}
            labels={{
              answers_specific: 'Answers are specific (not vague or buzzwords)',
              founder_tone_present: 'Founder/decision-maker tone present',
              day_to_day_pain: 'Day-to-day pain described, not theory',
              bottlenecks_stated: 'At least 2 operational bottlenecks clearly stated'
            }}
            onToggle={(key) => handleCheckToggle('intake_quality', key)}
          />
          <ActionNote action={checklist.intake_quality.action}>
            If FAIL → request clarification before proceeding
          </ActionNote>
        </ReviewSection>

        <ReviewSection
          title="B. Diagnosis Accuracy"
          description="Problems are cross-validated and system-based"
          icon={<Target className="size-5 text-[#3B82F6]" />}
          status={checklist.diagnosis_accuracy.status}
          isExpanded={expandedSection === 'diagnosis'}
          onToggle={() => setExpandedSection(expandedSection === 'diagnosis' ? null : 'diagnosis')}
        >
          <ChecklistItems
            checks={checklist.diagnosis_accuracy.checks}
            labels={{
              problems_cross_validated: 'Top 3 problems are cross-validated (multiple answers support them)',
              system_based_not_people: 'Problems are system-based, not people-blame',
              client_language_used: 'Language reflects client\'s words, not consultant jargon',
              no_overreach: 'No overreach or assumptions'
            }}
            onToggle={(key) => handleCheckToggle('diagnosis_accuracy', key)}
          />
          <ActionNote action={checklist.diagnosis_accuracy.action}>
            If uncertain → downgrade confidence + flag for call validation
          </ActionNote>
        </ReviewSection>

        <ReviewSection
          title="C. Scoring Sanity Check"
          description="Pillar scores are logical and consistent"
          icon={<TrendingUp className="size-5 text-[#06D7F6]" />}
          status={checklist.scoring_sanity.status}
          isExpanded={expandedSection === 'scoring'}
          onToggle={() => setExpandedSection(expandedSection === 'scoring' ? null : 'scoring')}
        >
          <ChecklistItems
            checks={checklist.scoring_sanity.checks}
            labels={{
              pillar_scores_logical: 'Pillar scores make logical sense together',
              not_all_red_or_green: 'No "all red" or "all green" without justification',
              readiness_matches_narrative: 'Readiness level matches narrative reality',
              confidence_adequate: 'Confidence score ≥ 0.7 or clearly flagged'
            }}
            onToggle={(key) => handleCheckToggle('scoring_sanity', key)}
          />
          <ActionNote action={checklist.scoring_sanity.action}>
            If mismatch → rescore manually
          </ActionNote>
        </ReviewSection>

        <ReviewSection
          title="D. Recommendation Control"
          description="First step is appropriate, no overselling"
          icon={<Shield className="size-5 text-[#FB923C]" />}
          status={checklist.recommendation_control.status}
          isExpanded={expandedSection === 'recommendation'}
          onToggle={() => setExpandedSection(expandedSection === 'recommendation' ? null : 'recommendation')}
        >
          <ChecklistItems
            checks={checklist.recommendation_control.checks}
            labels={{
              first_step_appropriate: 'First step is appropriate (Audit vs Build)',
              no_overselling: 'No selling ahead of readiness',
              do_not_list_present: '"Do NOT recommend yet" list is present',
              reduces_risk: 'Recommendation reduces risk, not increases scope'
            }}
            onToggle={(key) => handleCheckToggle('recommendation_control', key)}
          />
          <ActionNote action={checklist.recommendation_control.action}>
            If tempted to upsell → stop
          </ActionNote>
        </ReviewSection>

        <ReviewSection
          title="E. ROI Range Validation"
          description="Ranges are conservative and defensible"
          icon={<TrendingUp className="size-5 text-[#06D7F6]" />}
          status={checklist.roi_validation.status}
          isExpanded={expandedSection === 'roi'}
          onToggle={() => setExpandedSection(expandedSection === 'roi' ? null : 'roi')}
        >
          <ChecklistItems
            checks={checklist.roi_validation.checks}
            labels={{
              ranges_conservative: 'Ranges are conservative and defensible',
              no_hard_promises: 'No hard promises',
              assumptions_realistic: 'Assumptions are realistic for company size',
              estimate_language: 'Language says "estimate / based on similar cases"'
            }}
            onToggle={(key) => handleCheckToggle('roi_validation', key)}
          />
          <ActionNote action={checklist.roi_validation.action}>
            If aggressive → soften
          </ActionNote>
        </ReviewSection>

        {reviewType === 'report' && (
          <ReviewSection
            title="F. Report Quality"
            description="Tone is calm, executive, no AI hype"
            icon={<FileText className="size-5 text-[#8B5CF6]" />}
            status={checklist.report_quality.status}
            isExpanded={expandedSection === 'report'}
            onToggle={() => setExpandedSection(expandedSection === 'report' ? null : 'report')}
          >
            <ChecklistItems
              checks={checklist.report_quality.checks}
              labels={{
                tone_executive: 'Tone is calm, respectful, executive',
                no_tool_names: 'No tool names unless client mentioned them',
                no_ai_hype: 'No AI hype or buzzwords',
                clear_cta_no_pressure: 'Clear CTA, no pressure'
              }}
              onToggle={(key) => handleCheckToggle('report_quality', key)}
            />
            <ActionNote action={checklist.report_quality.action}>
              If it reads like a pitch → rewrite
            </ActionNote>
          </ReviewSection>
        )}

        {reviewType === 'call-prep' && (
          <ReviewSection
            title="G. Sales Call Readiness"
            description="Agenda, questions, and objections prepared"
            icon={<Phone className="size-5 text-[#3B82F6]" />}
            status={checklist.call_readiness.status}
            isExpanded={expandedSection === 'call'}
            onToggle={() => setExpandedSection(expandedSection === 'call' ? null : 'call')}
          >
            <ChecklistItems
              checks={checklist.call_readiness.checks}
              labels={{
                agenda_generated: 'Call agenda auto-generated',
                validation_questions: 'Validation questions prepared',
                objections_flagged: 'Objection risks flagged',
                fit_criteria_clear: 'Fit / no-fit criteria clear'
              }}
              onToggle={(key) => handleCheckToggle('call_readiness', key)}
            />
            <ActionNote action={checklist.call_readiness.action}>
              If unclear → do not take the call yet
            </ActionNote>
          </ReviewSection>
        )}

        {reviewType === 'proposal' && (
          <ReviewSection
            title="H. Proposal Check"
            description="Scope is finite, pricing anchored"
            icon={<FileText className="size-5 text-[#06D7F6]" />}
            status={checklist.proposal_check.status}
            isExpanded={expandedSection === 'proposal'}
            onToggle={() => setExpandedSection(expandedSection === 'proposal' ? null : 'proposal')}
          >
            <ChecklistItems
              checks={checklist.proposal_check.checks}
              labels={{
                scope_finite: 'Scope is finite and clear',
                one_paid_step: 'Only ONE paid step proposed',
                pricing_anchored: 'Pricing anchored, not negotiable language',
                timeline_realistic: 'Timeline realistic (no hero promises)'
              }}
              onToggle={(key) => handleCheckToggle('proposal_check', key)}
            />
            <ActionNote action={checklist.proposal_check.action}>
              If vague → tighten
            </ActionNote>
          </ReviewSection>
        )}
      </div>

      {/* Final Decision */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Flag className="size-5 text-[#FB923C]" />
          I. Final Decision
        </h3>
        <p className="text-white/60 text-sm mb-6">
          Reviewer must select ONE. No silent approvals.
        </p>

        {checklist.final_decision && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-[#06D7F6]/30 bg-[#06D7F6]/10 p-4">
            <CheckCircle2 className="size-5 text-[#06D7F6] flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-white">
                Decision recorded: {DECISION_LABELS[checklist.final_decision.decision]}
              </p>
              <p className="text-white/60">
                by {checklist.final_decision.approved_by} ·{' '}
                {new Date(checklist.final_decision.approved_at).toLocaleString()}
                {typeof checklist.time_spent_minutes === 'number' && (
                  <> · {checklist.time_spent_minutes} min</>
                )}
              </p>
              {!persistEnabled && (
                <p className="text-white/40 text-xs mt-1">
                  Demo mode — this decision is not saved to the server.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleFinalDecision('ready-to-send')}
            disabled={completionPct < 100}
            className={`p-4 rounded-xl border-2 transition-all ${
              completionPct >= 100
                ? 'border-[#06D7F6] bg-[#06D7F6]/10 hover:bg-[#06D7F6]/20 cursor-pointer'
                : 'border-white/10 bg-black/20 opacity-50 cursor-not-allowed'
            }`}
          >
            <CheckCircle2 className={`size-6 mb-2 mx-auto ${completionPct >= 100 ? 'text-[#06D7F6]' : 'text-white/30'}`} />
            <div className="font-semibold mb-1">Ready to Send</div>
            <div className="text-xs text-white/60">All checks passed</div>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleFinalDecision('needs-revision')}
            className="p-4 rounded-xl border-2 border-[#FB923C] bg-[#FB923C]/10 hover:bg-[#FB923C]/20 transition-all"
          >
            <Edit3 className="size-6 text-[#FB923C] mb-2 mx-auto" />
            <div className="font-semibold mb-1">Needs Revision</div>
            <div className="text-xs text-white/60">Why logged</div>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleFinalDecision('not-a-fit')}
            className="p-4 rounded-xl border-2 border-[#FD4438] bg-[#FD4438]/10 hover:bg-[#FD4438]/20 transition-all"
          >
            <XCircle className="size-6 text-[#FD4438] mb-2 mx-auto" />
            <div className="font-semibold mb-1">Not a Fit</div>
            <div className="text-xs text-white/60">Reason recorded</div>
          </motion.button>
        </div>

        {completionPct < 100 && (
          <div className="mt-4 flex items-start gap-2 text-sm text-white/60">
            <AlertCircle className="size-4 flex-shrink-0 mt-0.5" />
            <span>Complete all checklist items before making a final decision.</span>
          </div>
        )}
      </div>

      {/* Reviewer Notes */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Edit3 className="size-5 text-[#8B5CF6]" />
          Reviewer Notes
        </h3>
        <textarea
          className="w-full h-32 bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-[#8B5CF6]/50 resize-none"
          placeholder="Add notes about this review (e.g., specific revisions needed, why not a fit, concerns to discuss...)"
          value={checklist.revision_notes || ''}
          onChange={(e) =>
            setChecklist(prev => ({
              ...prev,
              revision_notes: e.target.value
            }))
          }
        />
      </div>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const DECISION_LABELS: Record<'ready-to-send' | 'needs-revision' | 'not-a-fit', string> = {
  'ready-to-send': 'Ready to Send',
  'needs-revision': 'Needs Revision',
  'not-a-fit': 'Not a Fit',
};

function SaveIndicator({
  persistEnabled,
  isLoading,
  status,
  lastSavedAt,
}: {
  persistEnabled: boolean;
  isLoading: boolean;
  status: SaveStatus;
  lastSavedAt: string | null;
}) {
  if (!persistEnabled) {
    return (
      <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white/5 text-white/50 border border-white/10">
        <Eye className="size-3" />
        Demo — not saved
      </div>
    );
  }
  if (isLoading || status === 'saving') {
    return (
      <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-[#8B5CF6]/15 text-[#8B5CF6] border border-[#8B5CF6]/30">
        <Loader2 className="size-3 animate-spin" />
        {isLoading ? 'Loading…' : 'Saving…'}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-[#FD4438]/15 text-[#FD4438] border border-[#FD4438]/30">
        <AlertTriangle className="size-3" />
        Save failed
      </div>
    );
  }
  if (status === 'saved') {
    return (
      <div
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-[#06D7F6]/15 text-[#06D7F6] border border-[#06D7F6]/30"
        title={lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleString()}` : undefined}
      >
        <Save className="size-3" />
        Saved
      </div>
    );
  }
  return null;
}

function ReviewSection({
  title,
  description,
  icon,
  status,
  isExpanded,
  onToggle,
  children
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  status: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          {icon}
          <div className="text-left">
            <h4 className="font-semibold">{title}</h4>
            <p className="text-sm text-white/60">{description}</p>
          </div>
        </div>
        <SectionStatusBadge status={status} />
      </button>

      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="px-6 pb-4 border-t border-white/10"
        >
          <div className="pt-4">
            {children}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function ChecklistItems({
  checks,
  labels,
  onToggle
}: {
  checks: Record<string, CheckItem>;
  labels: Record<string, string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="space-y-3 mb-4">
      {Object.entries(checks).map(([key, check]) => (
        <label
          key={key}
          className="flex items-start gap-3 cursor-pointer group"
        >
          <input
            type="checkbox"
            checked={check.checked}
            onChange={() => onToggle(key)}
            className="mt-1 size-5 rounded border-2 border-white/20 bg-black/40 checked:bg-[#06D7F6] checked:border-[#06D7F6] cursor-pointer transition-all"
          />
          <span className="text-sm text-white/80 group-hover:text-white transition-colors flex-1">
            {labels[key]}
          </span>
          {check.checked && (
            <CheckCircle2 className="size-5 text-[#06D7F6] flex-shrink-0" />
          )}
        </label>
      ))}
    </div>
  );
}

function ActionNote({ action, children }: { action: string; children: React.ReactNode }) {
  return (
    <div className="bg-gradient-to-br from-[#8B5CF6]/10 to-[#3B82F6]/10 border border-[#8B5CF6]/30 rounded-lg p-3">
      <p className="text-sm text-white/80 italic">{children}</p>
    </div>
  );
}

function SectionStatusBadge({ status }: { status: string }) {
  if (status === 'pass') {
    return (
      <div className="flex items-center gap-1 text-xs px-3 py-1 rounded-full bg-[#06D7F6]/20 text-[#06D7F6]">
        <CheckCircle2 className="size-3" />
        Pass
      </div>
    );
  }
  if (status === 'fail') {
    return (
      <div className="flex items-center gap-1 text-xs px-3 py-1 rounded-full bg-[#FD4438]/20 text-[#FD4438]">
        <XCircle className="size-3" />
        Fail
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-xs px-3 py-1 rounded-full bg-[#FB923C]/20 text-[#FB923C]">
      <AlertTriangle className="size-3" />
      Review
    </div>
  );
}

function ReviewStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
    pass: {
      label: 'Passing',
      icon: <CheckCircle2 className="size-4" />,
      className: 'bg-[#06D7F6]/20 text-[#06D7F6] border-[#06D7F6]/30'
    },
    warning: {
      label: 'Review Needed',
      icon: <AlertTriangle className="size-4" />,
      className: 'bg-[#FB923C]/20 text-[#FB923C] border-[#FB923C]/30'
    },
    flagged: {
      label: 'Flagged',
      icon: <AlertTriangle className="size-4" />,
      className: 'bg-[#FB923C]/20 text-[#FB923C] border-[#FB923C]/30'
    },
    fail: {
      label: 'Failed',
      icon: <XCircle className="size-4" />,
      className: 'bg-[#FD4438]/20 text-[#FD4438] border-[#FD4438]/30'
    },
    incomplete: {
      label: 'Incomplete',
      icon: <AlertTriangle className="size-4" />,
      className: 'bg-white/10 text-white/60 border-white/20'
    },
  };

  const { label, icon, className } = config[status] || config['incomplete'];

  return (
    <div className={`px-4 py-2 rounded-full border flex items-center gap-2 ${className}`}>
      {icon}
      <span className="font-semibold">{label}</span>
    </div>
  );
}