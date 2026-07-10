/**
 * CONTRACT ENGINE — Phase 6: Auto-Generation
 *
 * Governance principle: Math decides structure. LLM only explains decisions.
 *
 * Derives contract deterministically from a ProposalDraft:
 *   solutions[]           → ContractDeliverable[]
 *   implementation_plan.phases → ContractMilestone[] + PaymentSchedule
 *   scope_boundaries.excluded  → exclusions[]
 *   financial_summary          → investment figures
 *   approval_block             → payment_terms
 *
 * Contract Ready Gate (Section C — revenue-control-process.md):
 *   Contract cannot be sent unless:
 *     ✓ Proposal status = approved or beyond
 *     ✓ ROI version locked (financial_summary exists + portfolio_version_id present)
 *     ✓ Payment terms defined
 *     ✓ Deliverables not empty
 *     ✓ Legal / compliance clauses injected (≥6 blocks)
 *     ✓ Investment amount confirmed (> 0)
 *   If ROI changes → contract invalidated (roi_version_snapshot mismatch).
 *
 * Legal blocks are MANDATORY and non-editable per spec.
 * No ROI guarantee language. No financial outcome warranty.
 */

import type {
  ProposalDraft,
  ContractPayload,
  ContractDeliverable,
  ContractMilestone,
  PaymentScheduleItem,
  LegalBlock,
} from '@/app/types/cortex-types';

// ════════════════════════════════════════════════════════════════════════════════
// CONTRACT READY GATE TYPES
// ════════════════════════════════════════════════════════════════════════════════

export interface ContractGateCheck {
  id:      string;
  label:   string;
  passed:  boolean;
  reason?: string;   // Blocker description if not passed
}

export interface ContractGateResult {
  passed:    boolean;
  checks:    ContractGateCheck[];
  timestamp: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// MANDATORY LEGAL BLOCKS — non-editable, auto-injected
// ════════════════════════════════════════════════════════════════════════════════

export const LEGAL_BLOCKS: LegalBlock[] = [
  {
    id:       'lb_01',
    title:    'No Guaranteed Financial Outcome',
    text:     'MARQ Cortex provides no guarantee of specific financial outcomes, ROI percentages, or revenue figures. All projections presented in the accompanying proposal are estimates derived from diagnostic data and industry benchmarks. Actual results depend on implementation quality, client engagement, market conditions, and operational factors beyond MARQ Cortex\'s control.',
    editable: false,
  },
  {
    id:       'lb_02',
    title:    'AI Outputs Require Human Oversight',
    text:     'All AI-generated outputs, recommendations, and automation decisions must be reviewed and approved by a designated human authority within the Client organisation before operational deployment. MARQ Cortex is not liable for decisions made on the basis of AI outputs that have not been subject to such review and approval.',
    editable: false,
  },
  {
    id:       'lb_03',
    title:    'Data Responsibility Split',
    text:     'The Client is responsible for the accuracy, completeness, and lawfulness of all data provided to MARQ Cortex. MARQ Cortex is responsible for the secure processing and appropriate use of such data within the agreed scope. Each party bears responsibility for their respective data obligations under applicable data protection legislation.',
    editable: false,
  },
  {
    id:       'lb_04',
    title:    'Limitation of Liability',
    text:     'MARQ Cortex\'s total aggregate liability under this agreement shall not exceed the total fees paid by the Client in the three (3) months immediately preceding the event giving rise to the claim. Neither party shall be liable for indirect, incidental, special, consequential, or punitive damages, whether arising in contract, tort, or otherwise.',
    editable: false,
  },
  {
    id:       'lb_05',
    title:    'Change Request Clause',
    text:     'Any modifications to the agreed Scope of Work must be documented via a signed Change Request. MARQ Cortex reserves the right to revise timelines and fees proportionally for changes to scope. Work on any change request will not commence until a Change Request document has been duly executed by both parties.',
    editable: false,
  },
  {
    id:       'lb_06',
    title:    'Force Majeure',
    text:     'Neither party shall be liable for delays or failures in performance resulting from circumstances beyond their reasonable control, including but not limited to: natural disasters, pandemic events, government actions, labour disputes, or critical infrastructure failures. The affected party shall provide prompt written notice and shall resume performance as soon as reasonably practicable.',
    editable: false,
  },
];

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

export function generateContractId(proposalId: string): string {
  const digits = proposalId.replace(/\D/g, '').slice(-4).padStart(4, '0');
  return `C-${digits}`;
}

/**
 * Distribute payment percentages across milestones.
 * Rule: 40% on Phase 1, remaining 60% split equally across remaining phases.
 * Edge case: single phase = 100%.
 */
function distributePayments(count: number): number[] {
  if (count === 0) return [];
  if (count === 1) return [100];
  const first     = 40;
  const remaining = 60;
  const restPct   = Math.floor(remaining / (count - 1));
  const lastAdj   = remaining - restPct * (count - 2);  // absorb rounding
  return [first, ...Array(count - 2).fill(restPct), lastAdj];
}

// ════════════════════════════════════════════════════════════════════════════════
// CONTRACT READY GATE — Section C, revenue-control-process.md
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Deterministic gate: all checks must pass before Send to Client is enabled.
 * If ROI version drifts (roi_version_snapshot ≠ current portfolio_version_id),
 * the caller should treat the contract as invalidated and force regeneration.
 */
export function runContractReadyGate(
  draft:    ProposalDraft,
  contract: ContractPayload,
): ContractGateResult {
  const POST_APPROVED: string[] = ['approved', 'ready_to_send', 'sent', 'viewed'];

  const checks: ContractGateCheck[] = [
    {
      id:     'proposal_approved',
      label:  'Proposal status = approved or beyond',
      passed: POST_APPROVED.includes(draft.status),
      reason: 'Proposal must reach approved status before contract can be sent.',
    },
    {
      id:     'roi_version_locked',
      label:  'ROI version locked (financial_summary present)',
      passed: !!(draft.financial_summary?.portfolio_version_id),
      reason: 'Financial summary with a locked portfolio version ID must exist. Run Phase 3 gate.',
    },
    {
      id:     'payment_terms_defined',
      label:  'Payment terms defined',
      passed: !!(draft.approval_block?.payment_terms ?? contract.payment_terms),
      reason: 'Payment terms must be defined in the approval block or contract settings.',
    },
    {
      id:     'deliverables_not_empty',
      label:  'Deliverables derived from solutions',
      passed: contract.engagement_scope.length > 0,
      reason: 'At least one deliverable must be auto-derived from solutions[]. Add solutions in §3.',
    },
    {
      id:     'legal_clauses_injected',
      label:  'All 6 legal & compliance clauses injected',
      passed: contract.legal_blocks.length >= 6,
      reason: 'All mandatory legal protection blocks must be present (no-guarantee, liability, etc.).',
    },
    {
      id:     'investment_confirmed',
      label:  'Investment amount confirmed (> 0)',
      passed: contract.investment > 0,
      reason: 'Contract investment value must be greater than zero. Check financial_summary or next_step_offer.price.',
    },
  ];

  return {
    passed:    checks.every(c => c.passed),
    checks,
    timestamp: new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PRIMARY GENERATOR
// ════════════════════════════════════════════════════════════════════════════════

export function generateContractPayload(draft: ProposalDraft): ContractPayload {
  const now = new Date().toISOString();

  // ── Deliverables: one per solution ──────────────────────────────────────────
  const deliverables: ContractDeliverable[] = (draft.solutions ?? []).map((sol, i) => ({
    deliverable_id:      `DEL-${String(i + 1).padStart(3, '0')}`,
    solution_id:         sol.solution_id,
    title:               sol.title,
    description:         sol.system_description,
    acceptance_criteria: sol.expected_operational_outcomes.slice(0, 3),
  }));

  // ── Milestones: one per implementation phase ─────────────────────────────────
  const planPhases = draft.implementation_plan?.phases ?? [];
  const payPcts    = distributePayments(planPhases.length);

  const milestones: ContractMilestone[] = planPhases.map((phase, i) => {
    // Map deliverables assigned to this phase via implementation_phases[]
    const assignedSolutionIds = (draft.implementation_phases ?? [])
      .filter(ip => ip.phase_number === phase.phase_number)
      .flatMap(ip => ip.solution_ids);

    const phaseDeliverableIds = deliverables
      .filter(d => assignedSolutionIds.includes(d.solution_id))
      .map(d => d.deliverable_id);

    return {
      milestone_id:       `MS-${String(i + 1).padStart(3, '0')}`,
      phase_number:       phase.phase_number,
      title:              phase.title,
      duration_weeks:     phase.duration_weeks,
      payment_percentage: payPcts[i] ?? 0,
      deliverable_ids:    phaseDeliverableIds,
    };
  });

  // ── Financial ──────────────────────────────────────────────────────────────
  const investment    = draft.financial_summary?.investment_total ?? draft.next_step_offer.price ?? 0;
  const currency      = draft.financial_summary?.currency ?? draft.next_step_offer.currency ?? 'USD';
  const paymentTerms  = draft.approval_block?.payment_terms ?? '50% upfront, 50% upon roadmap delivery';

  // ── Payment Schedule ────────────────────────────────────────────────────────
  let paymentSchedule: PaymentScheduleItem[];

  if (milestones.length > 0) {
    paymentSchedule = milestones.map(ms => ({
      label:       `Phase ${ms.phase_number}: ${ms.title}`,
      amount:      Math.round(investment * ms.payment_percentage / 100),
      due_trigger: ms.phase_number === 1
        ? 'Due upon contract signature'
        : `Due upon Phase ${ms.phase_number} acceptance`,
      percentage:  ms.payment_percentage,
    }));
  } else {
    paymentSchedule = [
      {
        label:       'Upfront (50%)',
        amount:      Math.round(investment * 0.5),
        due_trigger: 'Due upon contract signature',
        percentage:  50,
      },
      {
        label:       'Delivery (50%)',
        amount:      Math.round(investment * 0.5),
        due_trigger: 'Due upon roadmap delivery',
        percentage:  50,
      },
    ];
  }

  // ── Exclusions from scope_boundaries ────────────────────────────────────────
  const exclusions = draft.scope_boundaries.excluded;

  return {
    contract_id:            generateContractId(draft.proposal_id),
    proposal_id:            draft.proposal_id,
    generated_at:           now,
    client_legal_name:      draft.client.company_name,
    engagement_scope:       deliverables,
    exclusions,
    milestones,
    investment,
    currency,
    payment_structure:      'upfront_milestone',
    payment_terms:          paymentTerms,
    payment_schedule:       paymentSchedule,
    liability_limits:       'Total liability capped at fees paid in preceding 3 months. No consequential or indirect damages.',
    confidentiality_clause: true,
    data_protection_clause: true,
    termination_clause:     '30 days written notice by either party. Pro-rata refund of prepaid fees for uncompleted phases.',
    signature_required:     true,
    legal_blocks:           LEGAL_BLOCKS,
    status:                 'draft',
    sent_at:                null,
    signed_at:              null,
    kickoff_triggered:      false,
    // Snapshot of ROI version at generation time for drift detection
    roi_version_snapshot:   draft.financial_summary?.portfolio_version_id ?? '',
  };
}