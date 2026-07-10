/**
 * CORTEX COPILOT ENGINE — copilot-patch-plan.md
 *
 * 3-step pipeline (spec §2):
 *   Step 1: interpretRequest  → classify intent, select blocks, return PatchPlan (no edits)
 *   Step 2: applyPatchPlan    → for each target, callBlockAIAssist → BlockRevision (pending)
 *   Step 3: Review queue (UI) → Accept All / Accept Selected / Reject All
 *
 * Version drift protection (spec §5):
 *   If any patch touches proposal_solution / proposal_timeline / proposal_next_step
 *   → roi_recalc_required = true
 *
 * Hard guardrails (spec §5):
 *   - roi_financial_snapshot → never targeted
 *   - contract_clause        → admin-only notice, not targeted
 *   - BACKEND_INTEGRATION=false → deterministic mock plan via dataService
 */

import type { BlockRevision, BlockState } from './blockEngine';
import { BLOCK_TYPE_LABELS, REFERENCE_ONLY_TYPES } from './blockEngine';
import {
  callBlockAIAssist,
  assembleAIContext,
  type AIAction,
  type AIAssistContext,
} from './aiAssistEngine';
import {
  copilotInterpret as requestCopilotInterpret,
  type CopilotInterpretRequest,
  type CopilotInterpretResponse,
} from '@/app/services/dataService';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export type PatchIntent =
  | 'rewrite_tone'
  | 'expand_detail'
  | 'simplify_client_view'
  | 'fix_ready_gate_failures'
  | 'align_solution_to_diagnosis'
  | 'generate_missing_blocks'
  | 'summarize_for_email';

export type PatchScope   = 'current_page' | 'whole_proposal' | 'full_engagement';
export type PatchStatus  = 'planned' | 'applied' | 'cancelled';

export const PATCH_SCOPE_LABELS: Record<PatchScope, string> = {
  current_page:    'Current Page',
  whole_proposal:  'Whole Proposal',
  full_engagement: 'Proposal + ROI + Contract',
};

export const PATCH_INTENT_LABELS: Record<PatchIntent, string> = {
  rewrite_tone:              'Rewrite Tone',
  expand_detail:             'Expand Detail',
  simplify_client_view:      'Simplify for Client',
  fix_ready_gate_failures:   'Fix Gate Failures',
  align_solution_to_diagnosis: 'Align Solutions → Diagnoses',
  generate_missing_blocks:   'Generate Missing Blocks',
  summarize_for_email:       'Summarise for Email',
};

export interface PatchTarget {
  block_id:    string;
  block_type:  string;
  title:       string;
  action:      AIAction;
  rationale:   string;
  constraints: {
    tone?:         string;
    do_not_change: string[];
  };
}

export interface SkippedBlock {
  block_id: string;
  title:    string;
  reason:   string;
}

export interface PatchPlan {
  patch_id:            string;
  scope:               { entity_type: string; entity_id: string };
  intent:              PatchIntent;
  intent_label:        string;
  user_input:          string;
  targets:             PatchTarget[];
  skipped:             SkippedBlock[];
  global_constraints:  {
    no_new_claims:               boolean;
    no_guarantees:               boolean;
    roi_numbers_locked:          boolean;
    contract_clauses_admin_only: boolean;
  };
  roi_recalc_required: boolean;
  created_at:          string;
  status:              PatchStatus;
}

export interface BatchApplyResult {
  patch_id:            string;
  applied:             Array<{ target: PatchTarget; revision: BlockRevision }>;
  failed:              Array<{ target: PatchTarget; error: string }>;
  roi_recalc_required: boolean;
}

// ── ROI drift trigger types ────────────────────────────────────────────────────
const ROI_DRIFT_TYPES = new Set([
  'proposal_solution',
  'proposal_timeline',
  'proposal_next_step',
]);

// ════════════════════════════════════════════════════════════════════════════════
// PATCH ID GENERATOR
// ════════════════════════════════════════════════════════════════════════════════

let _patchSeq = 0;
function nextPatchId(): string {
  return `PATCH-${String(++_patchSeq).padStart(4, '0')}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// QUICK COMMANDS — maps a chat shortcut to a pre-formed user_input
// ════════════════════════════════════════════════════════════════════════════════

export interface QuickCommand {
  label:      string;
  input:      string;
  icon:       string;
  color:      string;
  scope:      PatchScope;
}

export const QUICK_COMMANDS: QuickCommand[] = [
  {
    label: 'Fix Gate Issues',
    input: 'Fix all failing ready gate items and approve draft blocks.',
    icon:  'wrench',
    color: '#FB923C',
    scope: 'whole_proposal',
  },
  {
    label: 'Rewrite Tone',
    input: 'Rewrite all proposal blocks in ultra-premium boardroom tone.',
    icon:  'zap',
    color: '#8B5CF6',
    scope: 'whole_proposal',
  },
  {
    label: 'Expand Solutions',
    input: 'Expand all solution blocks with integration points, deliverables, and outcomes.',
    icon:  'expand',
    color: '#06D7F6',
    scope: 'whole_proposal',
  },
  {
    label: 'Simplify for Client',
    input: 'Simplify all client-facing blocks — shorter sentences, no internal jargon.',
    icon:  'minimize',
    color: '#F59E0B',
    scope: 'whole_proposal',
  },
  {
    label: 'Align Solutions',
    input: 'Ensure all solution blocks reference their linked diagnosis blocks.',
    icon:  'link',
    color: '#10B981',
    scope: 'whole_proposal',
  },
  {
    label: 'Draft Follow-up Email',
    input: 'Generate a follow-up email template summarising the proposal for the client.',
    icon:  'mail',
    color: '#3B82F6',
    scope: 'whole_proposal',
  },
];

// ════════════════════════════════════════════════════════════════════════════════
// MOCK PLAN BUILDER — BACKEND_INTEGRATION=false
// Deterministically classifies intent and builds a plan from available blocks.
// ════════════════════════════════════════════════════════════════════════════════

/** Keyword-based intent classifier */
function classifyIntent(input: string): PatchIntent {
  const text = input.toLowerCase();
  if (/fix|gate|fail|approv|issue|missing|blocked/.test(text))  return 'fix_ready_gate_failures';
  if (/email|follow.?up|summar|draft email/.test(text))         return 'summarize_for_email';
  if (/simplif|shorten|client.?fac|shorter|concis/.test(text)) return 'simplify_client_view';
  if (/expand|detail|depth|integrat|outcome|deliverable/.test(text)) return 'expand_detail';
  if (/align|diagnos|solution|tie.?back/.test(text))           return 'align_solution_to_diagnosis';
  if (/missing|generat|creat|new block/.test(text))            return 'generate_missing_blocks';
  return 'rewrite_tone'; // default
}

/** Maps intent → which block types to target */
const INTENT_TARGET_TYPES: Record<PatchIntent, string[]> = {
  rewrite_tone:              ['proposal_executive_brief', 'proposal_diagnosis', 'proposal_solution', 'roi_summary_narrative', 'proposal_next_step'],
  expand_detail:             ['proposal_solution', 'proposal_diagnosis', 'proposal_timeline'],
  simplify_client_view:      ['proposal_executive_brief', 'proposal_next_step', 'roi_summary_narrative', 'followup_email_template'],
  fix_ready_gate_failures:   ['proposal_executive_brief', 'proposal_diagnosis', 'proposal_solution', 'proposal_timeline', 'proposal_team', 'proposal_governance', 'proposal_next_step'],
  align_solution_to_diagnosis: ['proposal_solution'],
  generate_missing_blocks:   [], // doesn't target existing blocks
  summarize_for_email:       ['followup_email_template', 'roi_summary_narrative', 'proposal_executive_brief'],
};

/** Maps intent → which AIAction to apply */
const INTENT_ACTION_MAP: Record<PatchIntent, AIAction> = {
  rewrite_tone:              'ai_improve',
  expand_detail:             'ai_expand',
  simplify_client_view:      'ai_simplify',
  fix_ready_gate_failures:   'fix_issues',
  align_solution_to_diagnosis: 'ai_expand',
  generate_missing_blocks:   'ai_expand',
  summarize_for_email:       'ai_improve',
};

function buildMockPlan(
  userInput:  string,
  scope:      PatchScope,
  entityId:   string,
  allStates:  BlockState[],
): PatchPlan {
  const intent      = classifyIntent(userInput);
  const intentLabel = PATCH_INTENT_LABELS[intent];
  const targetTypes = new Set(INTENT_TARGET_TYPES[intent]);
  const action      = INTENT_ACTION_MAP[intent];

  const targets:  PatchTarget[]  = [];
  const skipped:  SkippedBlock[] = [];

  for (const state of allStates) {
    const { block, lock, pending_revision } = state;

    // Always skip reference blocks and locked blocks (with no admin override)
    if (REFERENCE_ONLY_TYPES.has(block.block_type)) {
      skipped.push({ block_id: block.block_id, title: block.title, reason: 'Reference block — ROI numbers immutable (schema §9)' });
      continue;
    }
    if (lock) {
      skipped.push({ block_id: block.block_id, title: block.title, reason: `Locked: ${lock.lock_reason}` });
      continue;
    }
    if (pending_revision) {
      skipped.push({ block_id: block.block_id, title: block.title, reason: 'Already has a pending revision — accept or reject first' });
      continue;
    }
    if (block.block_type === 'contract_clause') {
      skipped.push({ block_id: block.block_id, title: block.title, reason: 'Contract clause — admin approval required' });
      continue;
    }

    // For full_engagement scope, include all non-locked blocks
    // For whole_proposal, include proposal_* blocks
    // For current_page, include whatever is linked to the proposal
    const inScope =
      scope === 'full_engagement' ? true :
      scope === 'whole_proposal'  ? block.block_type.startsWith('proposal_') || block.block_type === 'roi_summary_narrative' :
      true; // current_page: all loaded blocks

    if (!inScope) {
      skipped.push({ block_id: block.block_id, title: block.title, reason: `Out of scope (${scope})` });
      continue;
    }

    // For fix_ready_gate_failures: only target non-approved blocks
    if (intent === 'fix_ready_gate_failures' && block.status === 'approved') {
      skipped.push({ block_id: block.block_id, title: block.title, reason: 'Already approved — no gate fix needed' });
      continue;
    }

    if (!targetTypes.has(block.block_type)) {
      skipped.push({ block_id: block.block_id, title: block.title, reason: `Block type "${block.block_type}" not targeted by "${intentLabel}" intent` });
      continue;
    }

    targets.push({
      block_id:    block.block_id,
      block_type:  block.block_type,
      title:       block.title,
      action,
      rationale:   buildRationale(intent, block.block_type, block.title),
      constraints: {
        tone:          'boardroom_premium',
        do_not_change: ['numbers', 'pricing', 'timeline_weeks', 'roi_metrics'],
      },
    });
  }

  const roi_recalc_required = targets.some(t => ROI_DRIFT_TYPES.has(t.block_type));

  return {
    patch_id:   nextPatchId(),
    scope:      { entity_type: 'proposal', entity_id: entityId },
    intent,
    intent_label: intentLabel,
    user_input:   userInput,
    targets,
    skipped,
    global_constraints: {
      no_new_claims:               true,
      no_guarantees:               true,
      roi_numbers_locked:          true,
      contract_clauses_admin_only: true,
    },
    roi_recalc_required,
    created_at: new Date().toISOString(),
    status:     'planned',
  };
}

/** Demo-mode API-shaped response for dataService.copilotInterpret */
export function buildMockCopilotInterpretApiResponse(
  userInput:  string,
  scope:      PatchScope,
  entityId:   string,
  allStates:  BlockState[],
): CopilotInterpretResponse {
  const plan = buildMockPlan(userInput, scope, entityId, allStates);
  return {
    intent:              plan.intent,
    intent_label:        plan.intent_label,
    targets:             plan.targets,
    skipped:             plan.skipped,
    roi_recalc_required: plan.roi_recalc_required,
  };
}

function buildRationale(intent: PatchIntent, blockType: string, title: string): string {
  const typeLabel = BLOCK_TYPE_LABELS[blockType as any] ?? blockType;
  switch (intent) {
    case 'rewrite_tone':
      return `${typeLabel} "${title}" selected for boardroom tone refinement — language clarity improvement.`;
    case 'expand_detail':
      return `${typeLabel} "${title}" selected for expansion — adding required integration points, outcomes, and deliverables.`;
    case 'simplify_client_view':
      return `${typeLabel} "${title}" selected for client-facing simplification — removing internal complexity.`;
    case 'fix_ready_gate_failures':
      return `${typeLabel} "${title}" is in draft/unapproved status — fixing gate-blocking issues.`;
    case 'align_solution_to_diagnosis':
      return `${typeLabel} "${title}" selected to strengthen diagnosis tie-back and cross-reference alignment.`;
    case 'summarize_for_email':
      return `${typeLabel} "${title}" selected to generate executive follow-up summary for client email.`;
    default:
      return `${typeLabel} "${title}" selected for AI improvement.`;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 1 — INTERPRET REQUEST
// ════════════════════════════════════════════════════════════════════════════════

export async function interpretRequest(
  userInput:    string,
  scope:        PatchScope,
  entityId:     string,
  allStates:    BlockState[],
  proposalMeta: { company?: string; industry?: string } = {},
  accessToken:  string = '',
): Promise<PatchPlan> {
  const blockSummaries = allStates.map(s => ({
    block_id:    s.block.block_id,
    block_type:  s.block.block_type,
    title:       s.block.title,
    status:      s.block.status,
    has_pending: !!s.pending_revision,
    is_locked:   !!s.lock,
  }));

  const payload: CopilotInterpretRequest = {
    user_input:      userInput,
    scope,
    entity_id:       entityId,
    block_summaries: blockSummaries,
    context: {
      company:  proposalMeta.company  ?? 'Vesper Dynamics',
      industry: proposalMeta.industry ?? 'SaaS / Revenue Tech',
    },
  };

  let raw: CopilotInterpretResponse;
  try {
    raw = await requestCopilotInterpret(payload, accessToken, allStates);
  } catch (e: any) {
    if (e?.message) throw e;
    throw new Error(`Network error: ${e}`);
  }

  const roi_recalc_required = (raw.roi_recalc_required ?? false) ||
    ((raw.targets ?? []) as PatchTarget[]).some(t => ROI_DRIFT_TYPES.has(t.block_type));

  return {
    patch_id:     nextPatchId(),
    scope:        { entity_type: 'proposal', entity_id: entityId },
    intent:       raw.intent       ?? 'rewrite_tone',
    intent_label: raw.intent_label ?? PATCH_INTENT_LABELS[raw.intent ?? 'rewrite_tone'],
    user_input:   userInput,
    targets:      raw.targets  ?? [],
    skipped:      raw.skipped  ?? [],
    global_constraints: {
      no_new_claims:               true,
      no_guarantees:               true,
      roi_numbers_locked:          true,
      contract_clauses_admin_only: true,
    },
    roi_recalc_required,
    created_at: new Date().toISOString(),
    status:     'planned',
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// STEP 2 — APPLY PATCH PLAN
// Calls callBlockAIAssist for each target, collects pending revisions.
// Sequential (not parallel) to respect §4 one-pending-per-block rule.
// ════════════════════════════════════════════════════════════════════════════════

export async function applyPatchPlan(
  plan:         PatchPlan,
  allStates:    BlockState[],
  onProgress:   (completed: number, total: number, currentTitle: string) => void = () => {},
  accessToken:  string = '',
): Promise<BatchApplyResult> {
  const applied: BatchApplyResult['applied'] = [];
  const failed:  BatchApplyResult['failed']  = [];

  for (let i = 0; i < plan.targets.length; i++) {
    const target = plan.targets[i];
    onProgress(i, plan.targets.length, target.title);

    const blockState = allStates.find(s => s.block.block_id === target.block_id);
    if (!blockState) {
      failed.push({ target, error: `Block "${target.block_id}" not found in current states` });
      continue;
    }

    // Re-check: block might have gained a pending revision since plan was built
    if (blockState.pending_revision) {
      failed.push({ target, error: `Block "${target.block_id}" now has a pending revision — skipped` });
      continue;
    }

    const context: AIAssistContext = assembleAIContext(target.block_id, allStates, {
      company:  'Vesper Dynamics',
      industry: 'SaaS / Revenue Tech',
    });

    try {
      const { revision } = await callBlockAIAssist(blockState, target.action, context, accessToken);
      applied.push({ target, revision });
    } catch (err: any) {
      failed.push({ target, error: err?.message ?? String(err) });
    }
  }

  onProgress(plan.targets.length, plan.targets.length, '');

  return {
    patch_id:            plan.patch_id,
    applied,
    failed,
    roi_recalc_required: plan.roi_recalc_required,
  };
}