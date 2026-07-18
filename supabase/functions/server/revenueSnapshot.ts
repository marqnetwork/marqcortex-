/**
 * REVENUE SNAPSHOT — deterministic deal-snapshot derivation (dashboard-specs.md §3)
 *
 * Powers the Revenue Intelligence Dashboard. Reads ONLY authoritative persisted
 * records (submissions, proposals, outcomes, objection escalations) and derives a
 * flat DealSnapshot[] that the existing frontend aggregators consume unchanged.
 *
 * GOVERNANCE (core rule — "Math decides, LLM only explains"):
 *   Every field here is computed deterministically from persisted data. No LLM
 *   is involved. No metric is invented: fields that the platform does not persist
 *   (region, scenario, forward ROI actuals) fall back to documented deterministic
 *   defaults that the dashboard treats as "unknown"/"not tracked" — they never
 *   fabricate a revenue number.
 *
 * Pure module (no Deno / KV imports) so it is unit-testable under the Node runner.
 */

// ── Snapshot shape (mirrors src/app/core/dashboardAggregator.ts DealSnapshot) ──

export type CRMStage =
  | 'lead_captured' | 'diagnostic_started' | 'diagnostic_completed'
  | 'proposal_draft' | 'proposal_sent' | 'proposal_viewed'
  | 'negotiation_objection' | 'approved_pending_contract'
  | 'contract_sent' | 'contract_signed'
  | 'onboarding_started' | 'implementation_active'
  | 'closed_won' | 'closed_lost';

export type ObjectionType = 'price' | 'risk' | 'timing' | 'trust' | 'internal_alignment';

export interface DealSnapshot {
  deal_id:     string;
  client_name: string;
  industry:    string;
  region:      'NA' | 'EMEA' | 'APAC';
  owner:       string;
  stage:       CRMStage;
  value:       number;
  deal_size_band: '$0–50K' | '$50K–100K' | '$100K+';
  scenario:    'conservative' | 'expected' | 'optimistic';
  created_at:           string;
  proposal_sent_at:     string | null;
  proposal_viewed_at:   string | null;
  proposal_approved_at: string | null;
  contract_signed_at:   string | null;
  objection_type:          ObjectionType | null;
  objection_resolved_days: number | null;
  is_expired:              boolean;
  projected_roi_pct:       number;
  actual_roi_pct:          number | null;
  projected_payback_month: number;
  actual_payback_month:    number | null;
}

// ── Raw persisted record shapes (loose — only the fields we read) ──────────────

export interface RawSubmission {
  id?: string;
  company?: string;
  industry?: string;
  status?: string;
  owner?: string;
  reviewedBy?: string;
  assignedTo?: string;
  submittedAt?: string;
  [k: string]: unknown;
}

export interface RawProposal {
  submissionId?: string;
  status?: string;                 // draft | sent | viewed | accepted | rejected
  sent_date?: string;
  viewed_at?: string;
  accepted_at?: string;
  rejected_at?: string;
  price?: number;
  next_step_offer?: { price?: number };
  [k: string]: unknown;
}

export interface RawOutcome {
  submissionId?: string;
  didConvert?: boolean;
  conversionValue?: number | null;
  loggedAt?: string;
  [k: string]: unknown;
}

export interface RawEscalation {
  submissionId?: string;
  objectionType?: string;
  createdAt?: string;
  resolvedAt?: string | null;
  status?: string;
  [k: string]: unknown;
}

export interface DeriveInput {
  submissions: RawSubmission[];
  proposals:   RawProposal[];
  outcomes:    RawOutcome[];
  escalations: RawEscalation[];
}

// ── Deterministic helpers ──────────────────────────────────────────────────────

const OBJECTION_TYPES: ObjectionType[] = ['price', 'risk', 'timing', 'trust', 'internal_alignment'];

export function bandForValue(value: number): DealSnapshot['deal_size_band'] {
  if (value >= 100_000) return '$100K+';
  if (value >= 50_000)  return '$50K–100K';
  return '$0–50K';
}

/**
 * Map the authoritative lifecycle (outcome → proposal → submission) to a single
 * CRM stage. Outcome is the strongest signal, then proposal status, then the
 * submission status. A bare submission is a completed diagnostic.
 */
export function deriveStage(
  sub: RawSubmission,
  proposal: RawProposal | undefined,
  outcome: RawOutcome | undefined,
): CRMStage {
  if (outcome && outcome.didConvert === true)  return 'closed_won';
  if (outcome && outcome.didConvert === false) return 'closed_lost';

  switch (proposal?.status) {
    case 'rejected': return 'closed_lost';
    case 'accepted': return 'approved_pending_contract';
    case 'viewed':   return 'proposal_viewed';
    case 'sent':     return 'proposal_sent';
    case 'draft':    return 'proposal_draft';
  }

  if (sub.status === 'approved') return 'approved_pending_contract';
  return 'diagnostic_completed';
}

function pickValue(proposal: RawProposal | undefined, outcome: RawOutcome | undefined): number {
  if (outcome?.didConvert && typeof outcome.conversionValue === 'number') {
    return outcome.conversionValue;
  }
  const p = proposal?.next_step_offer?.price ?? proposal?.price;
  return typeof p === 'number' && p > 0 ? p : 0;
}

function daysBetween(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** Most-recent escalation for a submission, by createdAt. */
function latestEscalation(escalations: RawEscalation[], submissionId: string): RawEscalation | undefined {
  const mine = escalations
    .filter(e => e.submissionId === submissionId && OBJECTION_TYPES.includes(e.objectionType as ObjectionType))
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  return mine[0];
}

// ── Main derivation ────────────────────────────────────────────────────────────

export function deriveDealSnapshots(input: DeriveInput): DealSnapshot[] {
  const proposalBySub = new Map<string, RawProposal>();
  for (const p of input.proposals) {
    if (p.submissionId) proposalBySub.set(p.submissionId, p);
  }
  const outcomeBySub = new Map<string, RawOutcome>();
  for (const o of input.outcomes) {
    if (o.submissionId) outcomeBySub.set(o.submissionId, o);
  }

  const snapshots: DealSnapshot[] = [];
  for (const sub of input.submissions) {
    const id = sub.id;
    if (!id) continue;

    const proposal = proposalBySub.get(id);
    const outcome  = outcomeBySub.get(id);
    const esc      = latestEscalation(input.escalations, id);

    const stage = deriveStage(sub, proposal, outcome);
    const value = pickValue(proposal, outcome);

    const contract_signed_at = stage === 'closed_won'
      ? (outcome?.loggedAt ?? proposal?.accepted_at ?? null)
      : null;

    snapshots.push({
      deal_id:     id,
      client_name: sub.company || 'Unknown',
      industry:    sub.industry || 'Unknown',
      region:      'NA',                       // not persisted — deterministic default (dashboard filter defaults to "all")
      owner:       sub.owner || sub.reviewedBy || sub.assignedTo || 'Unassigned',
      stage,
      value,
      deal_size_band: bandForValue(value),
      scenario:    'expected',                 // not persisted — deterministic default
      created_at:  sub.submittedAt || '',
      proposal_sent_at:     proposal?.sent_date  ?? null,
      proposal_viewed_at:   proposal?.viewed_at  ?? null,
      proposal_approved_at: proposal?.accepted_at ?? null,
      contract_signed_at,
      objection_type:          (esc?.objectionType as ObjectionType) ?? null,
      objection_resolved_days: esc ? daysBetween(esc.createdAt, esc.resolvedAt) : null,
      is_expired:              false,          // expiration not persisted — never inferred
      projected_roi_pct:       0,              // forward ROI not persisted here
      actual_roi_pct:          null,           // no actuals tracked → ROI accuracy panel shows "not tracked"
      projected_payback_month: 0,
      actual_payback_month:    null,
    });
  }
  return snapshots;
}

// ── Deterministic headline summary (server-side aggregation, no LLM) ───────────

export interface SnapshotSummary {
  total_deals:       number;
  proposals_sent:    number;
  closed_won:        number;
  closed_lost:       number;
  closed_won_value:  number;
  close_rate_pct:    number;   // won / proposals_sent, 1dp
  total_pipeline_value: number;
}

const WON_STAGES: CRMStage[] = [
  'contract_sent', 'contract_signed', 'onboarding_started',
  'implementation_active', 'closed_won',
];

export function summarizeSnapshots(snapshots: DealSnapshot[]): SnapshotSummary {
  const proposalsSent = snapshots.filter(s => s.proposal_sent_at !== null).length;
  const won  = snapshots.filter(s => WON_STAGES.includes(s.stage));
  const lost = snapshots.filter(s => s.stage === 'closed_lost');
  const closedWonValue = snapshots
    .filter(s => s.stage === 'closed_won')
    .reduce((sum, s) => sum + s.value, 0);
  const closeRate = proposalsSent > 0 ? (won.length / proposalsSent) * 100 : 0;

  return {
    total_deals:          snapshots.length,
    proposals_sent:       proposalsSent,
    closed_won:           snapshots.filter(s => s.stage === 'closed_won').length,
    closed_lost:          lost.length,
    closed_won_value:     closedWonValue,
    close_rate_pct:       Math.round(closeRate * 10) / 10,
    total_pipeline_value: snapshots.reduce((sum, s) => sum + s.value, 0),
  };
}
