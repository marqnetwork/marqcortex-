/**
 * CORTEX REVIEWER CHECKLIST — TYPE DEFINITIONS
 *
 * The quality control gate before any report, call prep, or proposal leaves the team.
 */

export interface CheckItem {
  checked: boolean;
  flagged?: boolean;
  note?: string;
}

export type SectionStatus = 'pass' | 'fail' | 'flagged' | 'incomplete';

export interface ReviewSection {
  status: SectionStatus;
  checks: Record<string, CheckItem>;
  action?: string;
}

export interface FinalDecision {
  decision: 'ready-to-send' | 'needs-revision' | 'not-a-fit';
  approved_by: string;
  approved_at: string;
  reviewer_signature: string;
  notes?: string;
}

export interface ReviewerChecklist {
  // Meta
  review_id: string;
  lead_id: string;
  reviewer_name: string;
  review_date: string;
  review_type: 'report' | 'call-prep' | 'proposal';
  time_spent_minutes?: number;
  revision_notes?: string;

  // Sections
  intake_quality: ReviewSection;
  diagnosis_accuracy: ReviewSection;
  scoring_sanity: ReviewSection;
  recommendation_control: ReviewSection;
  roi_validation: ReviewSection;
  report_quality: ReviewSection;
  call_readiness: ReviewSection;
  proposal_check: ReviewSection;

  // Final
  final_decision?: FinalDecision;
}

// ============================================================================
// EMPTY CHECKLIST FACTORY
// ============================================================================

function emptySection(checks: string[]): ReviewSection {
  const checksObj: Record<string, CheckItem> = {};
  checks.forEach(k => { checksObj[k] = { checked: false }; });
  return { status: 'incomplete', checks: checksObj };
}

export const EMPTY_CHECKLIST: Omit<ReviewerChecklist, 'review_id' | 'lead_id' | 'reviewer_name' | 'review_date' | 'review_type'> = {
  intake_quality: emptySection([
    'answers_specific',
    'founder_tone_present',
    'day_to_day_pain',
    'bottlenecks_stated',
  ]),
  diagnosis_accuracy: emptySection([
    'problems_cross_validated',
    'system_based_not_people',
    'client_language_used',
    'no_overreach',
  ]),
  scoring_sanity: emptySection([
    'pillar_scores_logical',
    'not_all_red_or_green',
    'readiness_matches_narrative',
    'confidence_adequate',
  ]),
  recommendation_control: emptySection([
    'first_step_appropriate',
    'no_overselling',
    'do_not_list_present',
    'reduces_risk',
  ]),
  roi_validation: emptySection([
    'ranges_conservative',
    'no_hard_promises',
    'assumptions_realistic',
    'estimate_language',
  ]),
  report_quality: emptySection([
    'tone_executive',
    'no_tool_names',
    'no_ai_hype',
    'clear_cta_no_pressure',
  ]),
  call_readiness: emptySection([
    'agenda_generated',
    'validation_questions',
    'objections_flagged',
    'fit_criteria_clear',
  ]),
  proposal_check: emptySection([
    'scope_finite',
    'one_paid_step',
    'pricing_anchored',
    'timeline_realistic',
  ]),
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function getOverallReviewStatus(checklist: ReviewerChecklist): SectionStatus {
  const sections: ReviewSection[] = [
    checklist.intake_quality,
    checklist.diagnosis_accuracy,
    checklist.scoring_sanity,
    checklist.recommendation_control,
    checklist.roi_validation,
    checklist.report_quality,
    checklist.call_readiness,
    checklist.proposal_check,
  ];

  if (sections.some(s => s.status === 'fail')) return 'fail';
  if (sections.some(s => s.status === 'flagged')) return 'flagged';
  if (sections.every(s => s.status === 'pass')) return 'pass';
  return 'incomplete';
}

export function getCompletionPercentage(checklist: ReviewerChecklist): number {
  const sections: ReviewSection[] = [
    checklist.intake_quality,
    checklist.diagnosis_accuracy,
    checklist.scoring_sanity,
    checklist.recommendation_control,
    checklist.roi_validation,
    checklist.report_quality,
    checklist.call_readiness,
    checklist.proposal_check,
  ];

  let total = 0;
  let checked = 0;

  sections.forEach(section => {
    const items = Object.values(section.checks);
    total += items.length;
    checked += items.filter(i => i.checked).length;
  });

  return total > 0 ? Math.round((checked / total) * 100) : 0;
}

export function getFlaggedItems(checklist: ReviewerChecklist): string[] {
  const flagged: string[] = [];
  const sections = [
    checklist.intake_quality,
    checklist.diagnosis_accuracy,
    checklist.scoring_sanity,
    checklist.recommendation_control,
    checklist.roi_validation,
    checklist.report_quality,
    checklist.call_readiness,
    checklist.proposal_check,
  ];

  sections.forEach(section => {
    Object.entries(section.checks).forEach(([key, item]) => {
      if (item.flagged) {
        flagged.push(key.replace(/_/g, ' '));
      }
    });
  });

  return flagged;
}
