/**
 * CRM SYNCHRONIZATION ENGINE — Phase 7
 *
 * Spec: crm-sync-spec.md
 * Governance principle: Math decides stage. No manual CRM updating.
 *
 * Core exports:
 *   mapStatusToCRMStage(draft)         → CRMStage
 *   deriveDealFromDraft(draft)         → CRMDeal
 *   STAGE_PIPELINE                     → ordered CRMStage[]
 *   STAGE_CFG                          → labels, colors, close_probability
 *   CRM_ACTIVITY_LABELS                → human-readable activity strings
 */

import type {
  ProposalDraft,
  CRMDeal,
  CRMStage,
  CRMActivityType,
  CRMActivityLog,
  CRMTask,
} from '@/app/types/cortex-types';

// ════════════════════════════════════════════════════════════════════════════════
// STAGE PIPELINE — 14 locked canonical stages
// ════════════════════════════════════════════════════════════════════════════════

export const STAGE_PIPELINE: CRMStage[] = [
  'lead_captured',
  'diagnostic_started',
  'diagnostic_completed',
  'proposal_draft',
  'proposal_sent',
  'proposal_viewed',
  'negotiation_objection',
  'approved_pending_contract',
  'contract_sent',
  'contract_signed',
  'onboarding_started',
  'implementation_active',
  'closed_won',
  'closed_lost',
];

// ════════════════════════════════════════════════════════════════════════════════
// STAGE CONFIG — labels, colors, close probability
// ════════════════════════════════════════════════════════════════════════════════

export interface StageCfg {
  label:             string;
  short:             string;
  color:             string;
  close_probability: number;  // 0–1
  group:             'pre_proposal' | 'proposal' | 'contract' | 'delivery' | 'closed';
}

export const STAGE_CFG: Record<CRMStage, StageCfg> = {
  lead_captured:             { label: 'Lead Captured',             short: 'Lead',       color: '#6B7280', close_probability: 0.05, group: 'pre_proposal'  },
  diagnostic_started:        { label: 'Diagnostic Started',        short: 'Diag Start', color: '#8B5CF6', close_probability: 0.15, group: 'pre_proposal'  },
  diagnostic_completed:      { label: 'Diagnostic Completed',      short: 'Diag Done',  color: '#A78BFA', close_probability: 0.25, group: 'pre_proposal'  },
  proposal_draft:            { label: 'Proposal Draft',            short: 'Draft',      color: '#06D7F6', close_probability: 0.30, group: 'proposal'      },
  proposal_sent:             { label: 'Proposal Sent',             short: 'Sent',       color: '#3B82F6', close_probability: 0.45, group: 'proposal'      },
  proposal_viewed:           { label: 'Proposal Viewed',           short: 'Viewed',     color: '#10B981', close_probability: 0.55, group: 'proposal'      },
  negotiation_objection:     { label: 'Negotiation / Objection',   short: 'Objection',  color: '#FB923C', close_probability: 0.40, group: 'proposal'      },
  approved_pending_contract: { label: 'Approved — Pending Contract', short: 'Approved', color: '#F59E0B', close_probability: 0.75, group: 'contract'      },
  contract_sent:             { label: 'Contract Sent',             short: 'Contract',   color: '#F59E0B', close_probability: 0.85, group: 'contract'      },
  contract_signed:           { label: 'Contract Signed',           short: 'Signed',     color: '#10B981', close_probability: 0.95, group: 'contract'      },
  onboarding_started:        { label: 'Onboarding Started',        short: 'Onboarding', color: '#10B981', close_probability: 0.97, group: 'delivery'      },
  implementation_active:     { label: 'Implementation Active',     short: 'Active',     color: '#10B981', close_probability: 0.99, group: 'delivery'      },
  closed_won:                { label: 'Closed Won',                short: 'Won',        color: '#10B981', close_probability: 1.00, group: 'closed'        },
  closed_lost:               { label: 'Closed Lost',               short: 'Lost',       color: '#FD4438', close_probability: 0.00, group: 'closed'        },
};

// ════════════════════════════════════════════════════════════════════════════════
// ACTIVITY LABELS
// ════════════════════════════════════════════════════════════════════════════════

export const CRM_ACTIVITY_LABELS: Record<CRMActivityType, string> = {
  deal_created:          'Deal Created',
  diagnostic_started:    'Diagnostic Started',
  diagnostic_completed:  'Diagnostic Completed',
  proposal_created:      'Proposal Created',
  proposal_ready_to_send:'Proposal Marked Ready to Send',
  proposal_sent:         'Proposal Sent to Client',
  proposal_viewed:       'Proposal Viewed by Client',
  objection_detected:    'Objection Detected',
  proposal_approved:     'Proposal Approved',
  proposal_rejected:     'Proposal Rejected',
  contract_generated:    'Contract Auto-Generated',
  contract_sent:         'Contract Sent to Client',
  contract_signed:       'Contract Signed — Kickoff Triggered',
  onboarding_started:    'Onboarding Started',
  implementation_started:'Implementation Started',
  project_completed:     'Project Completed — Closed Won',
};

// ════════════════════════════════════════════════════════════════════════════════
// STAGE MAPPING — ProposalDraft.status → CRMStage
// Spec §3: Event → Stage Mapping
// ════════════════════════════════════════════════════════════════════════════════

export function mapStatusToCRMStage(draft: ProposalDraft): CRMStage {
  switch (draft.status) {
    case 'draft':
    case 'review':
    case 'internal_review':
    case 'financial_binding':
      return 'proposal_draft';
    case 'approved':
    case 'ready_to_send':
      return 'approved_pending_contract';
    case 'sent':
      return 'proposal_sent';
    case 'viewed':
      return 'proposal_viewed';
    case 'rejected':
    case 'expired':
      return 'closed_lost';
    default:
      return 'proposal_draft';
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// ACTIVITY DERIVATION — builds chronological log from proposal lifecycle
// Spec §5: Activity Log Entries
// ════════════════════════════════════════════════════════════════════════════════

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function daysAgo(d: number): string {
  return hoursAgo(d * 24);
}

/**
 * Deterministically derives an activity timeline from a ProposalDraft.
 * Activities are always in chronological order (oldest first).
 */
export function deriveActivitiesFromDraft(draft: ProposalDraft): CRMActivityLog[] {
  const did    = `D-${draft.proposal_id.replace(/\D/g, '').slice(-4).padStart(4, '0')}`;
  const pid    = draft.proposal_id;
  const ts     = (d: string) => d;

  const log: CRMActivityLog[] = [];
  let seq = 0;

  const push = (type: CRMActivityType, payload: Record<string, unknown>, createdAt: string) => {
    log.push({
      activity_id: `ACT-${String(++seq).padStart(4, '0')}`,
      deal_id:     did,
      type,
      payload,
      created_at:  createdAt,
    });
  };

  // Always: deal + diagnostic events
  push('deal_created',         { proposal_id: pid, client: draft.client.company_name },          daysAgo(14));
  push('diagnostic_started',   { diagnostic_id: draft.linkage.diagnostic_id },                  daysAgo(13));
  push('diagnostic_completed', { diagnostic_id: draft.linkage.diagnostic_id, blocks: draft.diagnosis_blocks.length }, daysAgo(12));
  push('proposal_created',     { proposal_id: pid, version: draft.metadata.version },            daysAgo(10));

  if (draft.status === 'ready_to_send' || draft.status === 'approved' ||
      draft.status === 'sent' || draft.status === 'viewed' ||
      draft.status === 'rejected' || draft.status === 'expired') {
    push('proposal_ready_to_send', { proposal_id: pid }, daysAgo(7));
  }

  if (draft.status === 'approved' || draft.status === 'ready_to_send') {
    push('proposal_approved', { proposal_id: pid, approved_by: draft.metadata.created_by }, daysAgo(5));
    push('contract_generated', { contract_id: `C-${draft.proposal_id.replace(/\D/g, '').slice(-4).padStart(4, '0')}` }, daysAgo(5));
  }

  if (draft.status === 'sent' || draft.status === 'viewed') {
    push('proposal_approved', { proposal_id: pid, approved_by: draft.metadata.created_by }, daysAgo(6));
    push('contract_generated', { contract_id: `C-${draft.proposal_id.replace(/\D/g, '').slice(-4).padStart(4, '0')}` }, daysAgo(6));
    push('proposal_sent',      { proposal_id: pid, sent_at: draft.proposal_state?.sent_at ?? daysAgo(4) }, daysAgo(4));
  }

  if (draft.status === 'viewed') {
    push('proposal_viewed', { proposal_id: pid, viewed_at: daysAgo(2), time_spent_seconds: 312 }, daysAgo(2));
  }

  if (draft.status === 'rejected') {
    push('proposal_sent',     { proposal_id: pid },                        daysAgo(6));
    push('proposal_rejected', { proposal_id: pid, reason: 'budget_cycle' }, daysAgo(2));
  }

  return log;
}

// ════════════════════════════════════════════════════════════════════════════════
// TASK AUTO-CREATION — Spec §4: Task Auto-Creation Rules
// ════════════════════════════════════════════════════════════════════════════════

export function deriveTasksFromDraft(draft: ProposalDraft): CRMTask[] {
  const did    = `D-${draft.proposal_id.replace(/\D/g, '').slice(-4).padStart(4, '0')}`;
  const owner  = draft.metadata.created_by || 'BD Lead';
  const now    = Date.now();
  const tasks: CRMTask[] = [];
  let seq = 0;

  const task = (
    type:       string,
    due_at:     string,
    notes:      string,
    status:     CRMTask['status'] = 'open',
  ): CRMTask => ({
    task_id:     `TSK-${String(++seq).padStart(4, '0')}`,
    deal_id:     did,
    assigned_to: owner,
    task_type:   type,
    due_at,
    status,
    notes,
    overdue:     status === 'open' && new Date(due_at).getTime() < now,
  });

  switch (draft.status) {
    case 'sent':
      // proposal_sent → "Follow up if not viewed" +48h
      tasks.push(task(
        'Follow up if not viewed',
        hoursFromNow(48),
        `Proposal ${draft.proposal_id} sent to ${draft.client.primary_contact.name}. Follow up if unopened.`,
      ));
      break;

    case 'viewed':
      // proposal_viewed → "Send clarification + book call" +24h
      tasks.push(task(
        'Send clarification + book call',
        hoursFromNow(24),
        `${draft.client.primary_contact.name} at ${draft.client.company_name} viewed the proposal. Strike while warm.`,
      ));
      break;

    case 'approved':
    case 'ready_to_send':
      // proposal_approved → contract pending; remind to send contract
      tasks.push(task(
        'Send contract to client',
        hoursFromNow(24),
        `Proposal approved. Contract ${draft.proposal_id.replace('P', 'C')} is in draft — send to client.`,
      ));
      break;

    case 'rejected':
    case 'expired':
      // closed_lost → schedule recovery call within 7 days
      tasks.push(task(
        'Post-rejection recovery call',
        hoursFromNow(7 * 24),
        `Deal marked closed_lost. Schedule discovery call to understand decision and preserve relationship.`,
      ));
      break;

    default:
      // Draft/review states → internal review reminder
      tasks.push(task(
        'Complete proposal internal review',
        hoursFromNow(72),
        `Proposal ${draft.proposal_id} is in ${draft.status} — complete internal gate before sending.`,
      ));
      break;
  }

  return tasks;
}

// ════════════════════════════════════════════════════════════════════════════════
// DEAL DERIVATION — builds full CRMDeal from ProposalDraft
// Spec §7: Mock Payload
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Derives a complete CRMDeal from a ProposalDraft.
 * All values are deterministic — no randomness, no LLM.
 * Owner falls back to 'Admin / BD Lead' when created_by is missing (Spec §6).
 */
export function deriveDealFromDraft(draft: ProposalDraft): CRMDeal {
  const stage      = mapStatusToCRMStage(draft);
  const cfg        = STAGE_CFG[stage];
  const dealId     = `D-${draft.proposal_id.replace(/\D/g, '').slice(-4).padStart(4, '0')}`;
  const clientId   = `C-${draft.client.client_id.replace(/\D/g, '').slice(-4).padStart(4, '0') ?? '0001'}`;
  const investment = draft.financial_summary?.investment_total ?? draft.next_step_offer.price ?? 0;

  // Contract ID if proposal is past approved stage
  const hasContract = ['approved', 'ready_to_send', 'sent', 'viewed'].includes(draft.status);
  const contractId  = hasContract
    ? `C-${draft.proposal_id.replace(/\D/g, '').slice(-4).padStart(4, '0')}`
    : null;

  return {
    deal_id:           dealId,
    client_id:         clientId,
    proposal_id:       draft.proposal_id,
    contract_id:       contractId,
    owner_user_id:     draft.metadata.created_by || 'Admin / BD Lead',  // Spec §6 default
    stage,
    value_estimate:    investment,
    close_probability: cfg.close_probability,
    created_at:        draft.metadata.created_at,
    updated_at:        draft.metadata.last_updated_at,
    activity:          deriveActivitiesFromDraft(draft),
    tasks:             deriveTasksFromDraft(draft),
  };
}
