/**
 * UNIVERSAL EDITABLE BLOCKS ENGINE — editable-blocks-schema.json
 *
 * Governance: "every UI box becomes an editable, versioned Block, with safe
 *              locking + audit trail."
 *
 * Four core entities (schema §1):
 *   blocks          — the box itself
 *   block_revisions — every change, human or AI
 *   block_links     — connect blocks to proposal / roi / solution / etc.
 *   block_locks     — prevent edits when sent / signed
 *
 * Rules enforced here:
 *   §3  UI renders from blocks.content of current_revision_id
 *   §4  Only one pending revision per block allowed
 *   §4  Revisions are never overwritten
 *   §4  Accepting revision updates block.content + current_revision_id
 *   §6  If locked, only admin can create revisions
 *   §9  roi_financial_snapshot is a reference block — numbers not editable
 *
 * Mock store: seeded deterministically for ExampleCo (lead_010 / P-0001).
 * In production: replace store arrays with Supabase queries.
 */

// ════════════════════════════════════════════════════════════════════════════════
// BLOCK TYPES — locked enum (schema §2)
// ════════════════════════════════════════════════════════════════════════════════

export type BlockType =
  | 'proposal_executive_brief'
  | 'proposal_diagnosis'
  | 'proposal_solution'
  | 'proposal_timeline'
  | 'proposal_team'
  | 'proposal_governance'
  | 'proposal_next_step'
  | 'roi_summary_narrative'
  | 'roi_financial_snapshot'   // reference block — schema §9
  | 'recommendation_card'
  | 'contract_clause'           // usually locked
  | 'followup_email_template'
  | 'crm_note';

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  proposal_executive_brief:  'Executive Brief',
  proposal_diagnosis:        'Diagnosis',
  proposal_solution:         'Solution',
  proposal_timeline:         'Timeline',
  proposal_team:             'Team',
  proposal_governance:       'Governance',
  proposal_next_step:        'Next Step Offer',
  roi_summary_narrative:     'ROI Narrative',
  roi_financial_snapshot:    'ROI Snapshot',
  recommendation_card:       'Recommendation',
  contract_clause:           'Contract Clause',
  followup_email_template:   'Follow-up Email',
  crm_note:                  'CRM Note',
};

/** Which block types are reference-only (no human/AI content edits allowed). */
export const REFERENCE_ONLY_TYPES: ReadonlySet<BlockType> = new Set([
  'roi_financial_snapshot',
]);

/** Which block types default to locked. */
export const DEFAULT_LOCKED_TYPES: ReadonlySet<BlockType> = new Set([
  'contract_clause',
  'roi_financial_snapshot',
]);

// ════════════════════════════════════════════════════════════════════════════════
// CORE TYPE DEFINITIONS — schema §3–§6
// ════════════════════════════════════════════════════════════════════════════════

export type BlockStatus    = 'draft' | 'approved' | 'locked';
export type BlockSource    = 'human' | 'ai' | 'mixed';
export type ContentFormat  = 'rich_text' | 'structured_json';

/** schema §3 — the block itself */
export interface Block {
  block_id:            string;
  block_type:          BlockType;
  title:               string;
  content_format:      ContentFormat;
  /** Live content — always the accepted revision's proposed_content */
  content:             Record<string, unknown>;
  status:              BlockStatus;
  source:              BlockSource;
  owner_user_id:       string;
  created_at:          string;
  updated_at:          string;
  /** Points to the currently active BlockRevision */
  current_revision_id: string;
  version:             number;
}

export type RevisionChangeType =
  | 'create'
  | 'edit'
  | 'ai_improve'
  | 'ai_expand'
  | 'ai_simplify'
  | 'chat_patch';

export type RevisionApprovalStatus = 'pending' | 'accepted' | 'rejected';
export type RevisionAuthorType     = 'human' | 'ai';

/** schema §4 — every change, human or AI */
export interface BlockRevision {
  revision_id:       string;
  block_id:          string;
  change_type:       RevisionChangeType;
  proposed_content:  Record<string, unknown>;
  diff_summary:      string;
  created_by:        string;
  created_by_type:   RevisionAuthorType;
  created_at:        string;
  approval_status:   RevisionApprovalStatus;
  approved_by:       string | null;
  approved_at:       string | null;
}

export type BlockLinkEntityType =
  | 'proposal' | 'diagnosis' | 'solution'
  | 'phase'    | 'roi'       | 'contract' | 'deal';

/** schema §5 — connect blocks to the system */
export interface BlockLink {
  link_id:     string;
  block_id:    string;
  entity_type: BlockLinkEntityType;
  entity_id:   string;
  created_at:  string;
}

export type BlockLockReason =
  | 'proposal_sent'
  | 'contract_sent'
  | 'contract_signed'
  | 'compliance_locked'
  | 'roi_locked';

export type BlockLockAuthority = 'system' | 'admin';

/** schema §6 — non-negotiable locks */
export interface BlockLock {
  lock_id:        string;
  block_id:       string;
  lock_reason:    BlockLockReason;
  locked_by:      BlockLockAuthority;
  locked_at:      string;
  unlock_allowed: boolean;
}

// ════════════════════════════════════════════════════════════════════════════════
// COMPOSED BLOCK STATE (UI consumption)
// ════════════════════════════════════════════════════════════════════════════════

export interface BlockState {
  block:            Block;
  revisions:        BlockRevision[];   // all, newest first
  links:            BlockLink[];
  lock:             BlockLock | null;
  pending_revision: BlockRevision | null;
}

// ════════════════════════════════════════════════════════════════════════════════
// READY GATE — spec §8
// Required block set for Proposal readiness (gate result type)
// ════════════════════════════════════════════════════════════════════════════════

export interface BlocksGateRequirement {
  block_type:  BlockType;
  min_count:   number;
  label:       string;
  approved:    number;   // how many are currently approved
  total:       number;   // how many exist of this type
  passed:      boolean;
}

export interface BlocksGateResult {
  passed:       boolean;
  requirements: BlocksGateRequirement[];
  summary:      string;
}

// ════════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════════

// Fixed reference date — matches project convention
const REF = '2026-03-02';

function dba(daysAgo: number): string {
  const d = new Date(REF);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

// ════════════════════════════════════════════════════════════════════════════════
// MOCK STORE — seeded deterministically for ExampleCo / lead_010 / P-0001
// ════════════════════════════════════════════════════════════════════════════════

/**
 * All blocks across the system.
 * In production: Supabase query `SELECT * FROM blocks WHERE ...`
 */
export let BLOCK_STORE: Block[] = [

  // ── Proposal Executive Brief ───────────────────────────────────────────────
  {
    block_id:            'B-EB-001',
    block_type:          'proposal_executive_brief',
    title:               'Strategic Context & Executive Brief',
    content_format:      'rich_text',
    content: {
      text: 'Vesper Dynamics operates in a high-velocity SaaS environment where delayed revenue recognition, fragmented pipeline visibility, and unstructured AI governance are compounding into a $380K–$520K annual drag. This engagement addresses three confirmed critical bottlenecks: pipeline leakage at the qualification stage (≈$240K exposed revenue), uncoordinated automation across 7 disconnected tools (≈18h/week overhead per rep), and the absence of a structured AI governance framework that exposes the firm to compliance risk in 2 regulated verticals. The proposed solution is a 12-week MARQ Cortex engagement phased into two delivery sprints, delivering measurable outcomes at each milestone gate.',
    },
    status:              'approved',
    source:              'mixed',
    owner_user_id:       'U-01',
    created_at:          dba(42),
    updated_at:          dba(5),
    current_revision_id: 'R-EB-003',
    version:             3,
  },

  // ── Diagnosis Blocks ───────────────────────────────────────────────────────
  {
    block_id:            'B-DX-001',
    block_type:          'proposal_diagnosis',
    title:               'Revenue Leakage at Qualification Stage',
    content_format:      'structured_json',
    content: {
      severity:           'critical',
      confidence:         92,
      description:        'Sales reps are losing ≈23% of qualified leads between MQL → SQL handoff due to absence of automated lead-scoring criteria and manual re-qualification loops. This creates a predictable $240K annual exposure based on current pipeline velocity of $1.04M ARR.',
      operational_impact: [
        'Reps spend avg 4.2h/week re-qualifying leads that scored above threshold',
        'Zero visibility into drop-off reason — no feedback loop to marketing',
      ],
      financial_impact: [
        '$240K exposed annual revenue at current pipeline velocity',
        '14% ACV compression due to late-stage discounting on de-prioritised deals',
      ],
      evidence: [{ source: 'questionnaire', ref: 'Q7', note: 'Rep interview confirmed 4+ hours/week re-qualification overhead' }],
    },
    status:              'approved',
    source:              'human',
    owner_user_id:       'U-01',
    created_at:          dba(40),
    updated_at:          dba(8),
    current_revision_id: 'R-DX-001-B',
    version:             2,
  },
  {
    block_id:            'B-DX-002',
    block_type:          'proposal_diagnosis',
    title:               'Fragmented Automation Stack (7 Disconnected Tools)',
    content_format:      'structured_json',
    content: {
      severity:           'high',
      confidence:         87,
      description:        'Seven automation tools operate without a shared data model or unified orchestration layer. This causes 18h/week average overhead per revenue team member, manual data reconciliation, and a 3-day average delay in downstream reporting. The tool fragmentation ceiling prevents scaling beyond current ARR without proportional headcount growth.',
      operational_impact: [
        '18h/week per rep in manual data reconciliation across Salesforce, HubSpot, Zapier, and 4 bespoke tools',
        '3-day reporting lag prevents proactive deal intervention',
      ],
      financial_impact: [
        '$147K/year in payroll misallocation (6 FTE × $24.5K overhead each in non-value hours)',
        'Growth ceiling capped at ~$2.2M ARR without proportional headcount growth',
      ],
      evidence: [{ source: 'ops_pattern', ref: 'OP-02', note: 'Tool audit — 7 tools, 0 shared APIs, avg 18h/week overhead confirmed' }],
    },
    status:              'approved',
    source:              'mixed',
    owner_user_id:       'U-01',
    created_at:          dba(38),
    updated_at:          dba(6),
    current_revision_id: 'R-DX-002-B',
    version:             2,
  },
  {
    block_id:            'B-DX-003',
    block_type:          'proposal_diagnosis',
    title:               'AI Governance Gap in Regulated Verticals',
    content_format:      'structured_json',
    content: {
      severity:           'high',
      confidence:         78,
      description:        'No documented AI governance framework exists for the two regulated client verticals (healthcare adjacent, financial services). Current AI feature deployments lack audit trails, model explainability documentation, and approval workflows required by forthcoming EU AI Act obligations. This creates compliance risk and threatens the ability to expand into enterprise accounts requiring SOC 2 Type II or equivalent governance.',
      operational_impact: [
        'No AI audit trail — AI model outputs are not logged, creating accountability gap',
        'Enterprise deals stalling at security review stage (3 deals confirmed in Q1 2026)',
      ],
      financial_impact: [
        '$180K potential enterprise ARR blocked by absence of governance documentation',
        'Estimated €40K–€80K EU AI Act compliance cost if addressed reactively vs. proactively',
      ],
      evidence: [{ source: 'financial_data', ref: 'FD-03', note: 'Pipeline report: 3 enterprise deals stalled at security review' }],
    },
    status:              'draft',       // ← NOT yet approved → gate fails here
    source:              'ai',
    owner_user_id:       'U-01',
    created_at:          dba(10),
    updated_at:          dba(2),
    current_revision_id: 'R-DX-003-A',
    version:             1,
  },

  // ── Solution Blocks ────────────────────────────────────────────────────────
  {
    block_id:            'B-SOL-001',
    block_type:          'proposal_solution',
    title:               'Unified Workflow Automation Layer',
    content_format:      'structured_json',
    content: {
      pillar:            'workflow',
      description:       'Deploy a unified orchestration hub connecting all 7 automation tools via a shared event bus and data schema. Replaces manual reconciliation with real-time sync. Estimated 15h/week saved per rep within 45 days of go-live.',
      systems_affected:  ['Salesforce', 'HubSpot', 'Zapier', 'Internal CRM overlay'],
      timeline_weeks:    6,
      complexity_score:  3,
    },
    status:              'approved',
    source:              'human',
    owner_user_id:       'U-01',
    created_at:          dba(25),
    updated_at:          dba(7),
    current_revision_id: 'R-SOL-001-B',
    version:             2,
  },
  {
    block_id:            'B-SOL-002',
    block_type:          'proposal_solution',
    title:               'AI Governance Framework & Audit Layer',
    content_format:      'structured_json',
    content: {
      pillar:            'agents',
      description:       'Design and deploy a lightweight AI governance framework: model registry, audit-trail logging, explainability documentation templates, and an approval workflow for AI features in regulated contexts. Unblocks 3 stalled enterprise deals.',
      systems_affected:  ['AI model registry', 'Compliance portal', 'Deal room'],
      timeline_weeks:    4,
      complexity_score:  2,
    },
    status:              'draft',       // ← pending review → gate fails here
    source:              'ai',
    owner_user_id:       'U-02',
    created_at:          dba(5),
    updated_at:          dba(1),
    current_revision_id: 'R-SOL-002-A',
    version:             1,
  },

  // ── Next Step Offer ────────────────────────────────────────────────────────
  {
    block_id:            'B-NS-001',
    block_type:          'proposal_next_step',
    title:               'Next Step: AI Systems Audit (12-Week Sprint)',
    content_format:      'structured_json',
    content: {
      offer_name:    'AI Systems Audit — Foundation Sprint',
      price:         45000,
      currency:      'USD',
      duration:      '12 weeks',
      primary_cta:   'Sign & Schedule Kick-off',
      secondary_cta: 'Request Amendment',
    },
    status:              'approved',
    source:              'human',
    owner_user_id:       'U-01',
    created_at:          dba(20),
    updated_at:          dba(4),
    current_revision_id: 'R-NS-001-A',
    version:             1,
  },

  // ── ROI Narrative (editable) ───────────────────────────────────────────────
  {
    block_id:            'B-ROI-NAR',
    block_type:          'roi_summary_narrative',
    title:               'ROI Summary Narrative',
    content_format:      'rich_text',
    content: {
      text: 'At the expected scenario, Vesper Dynamics is projected to realise a 340% ROI within 12 months of the engagement close, with payback achieved at month 8. The $153,000 annual gain (confidence-weighted) is derived from three compounding levers: $96K revenue recovered through pipeline tightening, $38K operational savings via automation, and $19K risk-cost reduction from governance implementation. All figures apply a 72% realization factor — no 100% efficiency assumptions are made.',
    },
    status:              'draft',
    source:              'mixed',
    owner_user_id:       'U-01',
    created_at:          dba(12),
    updated_at:          dba(3),
    current_revision_id: 'R-ROI-NAR-A',
    version:             1,
  },

  // ── ROI Financial Snapshot — REFERENCE BLOCK, LOCKED (schema §9) ──────────
  {
    block_id:            'B-ROI-FIN',
    block_type:          'roi_financial_snapshot',
    title:               'ROI Financial Snapshot (ROI Engine Output)',
    content_format:      'structured_json',
    content: {
      roi_percentage:      340,
      investment_total:    45000,
      annual_gain:         153000,
      payback_month:       8,
      scenario:            'expected',
      confidence_score:    84,
      _note:               'Read-only. Numbers sourced from ROI engine. Edit roi_summary_narrative to change narrative.',
    },
    status:              'locked',
    source:              'ai',
    owner_user_id:       'system',
    created_at:          dba(12),
    updated_at:          dba(12),
    current_revision_id: 'R-ROI-FIN-A',
    version:             1,
  },

  // ── Contract Clause — LOCKED ───────────────────────────────────────────────
  {
    block_id:            'B-CC-001',
    block_type:          'contract_clause',
    title:               'Limitation of Liability & IP Ownership',
    content_format:      'rich_text',
    content: {
      text: 'MARQ Cortex Ltd liability is limited to the total fees paid under this engagement. All work product, deliverables, and AI model outputs produced during this engagement are the exclusive intellectual property of the Client upon full payment. MARQ Cortex retains no rights to reuse client-specific training data or proprietary process documentation.',
    },
    status:              'locked',
    source:              'human',
    owner_user_id:       'U-01',
    created_at:          dba(18),
    updated_at:          dba(18),
    current_revision_id: 'R-CC-001-A',
    version:             1,
  },

  // ── CRM Note ──────────────────────────────────────────────────────────────
  {
    block_id:            'B-CRM-001',
    block_type:          'crm_note',
    title:               'Stakeholder Note — CFO Alignment Call',
    content_format:      'rich_text',
    content: {
      text: 'CFO (Priya Nair) raised ROI payback timing as a key concern — specifically the 8-month payback vs. her internal benchmark of 6 months. Agreed to provide a supplemental DCF model by next week. CTO (Marcus Reyes) is a strong internal champion. Decision expected by 14 March 2026.',
    },
    status:              'draft',
    source:              'human',
    owner_user_id:       'U-02',
    created_at:          dba(3),
    updated_at:          dba(1),
    current_revision_id: 'R-CRM-001-A',
    version:             1,
  },
];

/**
 * All revisions, newest first per block.
 * Rule (schema §4): Revisions are NEVER overwritten.
 */
export let REVISION_STORE: BlockRevision[] = [

  // ── B-EB-001 revisions (3) ─────────────────────────────────────────────────
  {
    revision_id: 'R-EB-001', block_id: 'B-EB-001',
    change_type: 'create',
    proposed_content: { text: 'Vesper Dynamics requires operational alignment...' },
    diff_summary: 'Initial draft — executive brief created from diagnostic output',
    created_by: 'U-01', created_by_type: 'human', created_at: dba(42),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(42),
  },
  {
    revision_id: 'R-EB-002', block_id: 'B-EB-001',
    change_type: 'edit',
    proposed_content: { text: 'Vesper Dynamics operates in a high-velocity SaaS environment where delayed revenue recognition and fragmented pipeline...' },
    diff_summary: 'Added revenue quantification ($380K–$520K drag) and expanded why-now section',
    created_by: 'U-01', created_by_type: 'human', created_at: dba(15),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(15),
  },
  {
    revision_id: 'R-EB-003', block_id: 'B-EB-001',
    change_type: 'ai_improve',
    proposed_content: { text: 'Vesper Dynamics operates in a high-velocity SaaS environment where delayed revenue recognition, fragmented pipeline visibility, and unstructured AI governance are compounding into a $380K–$520K annual drag...' },
    diff_summary: 'AI: Tightened positioning statement, added compliance risk framing for two regulated verticals',
    created_by: 'gpt-4o-mini', created_by_type: 'ai', created_at: dba(5),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(5),
  },

  // ── B-DX-001 revisions (2) ─────────────────────────────────────────────────
  {
    revision_id: 'R-DX-001-A', block_id: 'B-DX-001',
    change_type: 'create',
    proposed_content: { severity: 'critical', confidence: 85, description: 'Sales reps losing leads at MQL→SQL handoff...' },
    diff_summary: 'Initial diagnosis block — revenue leakage detected from Q7 questionnaire signal',
    created_by: 'U-01', created_by_type: 'human', created_at: dba(40),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(40),
  },
  {
    revision_id: 'R-DX-001-B', block_id: 'B-DX-001',
    change_type: 'edit',
    proposed_content: { severity: 'critical', confidence: 92, description: 'Sales reps are losing ≈23% of qualified leads...' },
    diff_summary: 'Raised confidence to 92 after pipeline data confirmed $240K exposure; added 14% ACV compression metric',
    created_by: 'U-01', created_by_type: 'human', created_at: dba(8),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(8),
  },

  // ── B-DX-002 revisions (2) ─────────────────────────────────────────────────
  {
    revision_id: 'R-DX-002-A', block_id: 'B-DX-002',
    change_type: 'create',
    proposed_content: { severity: 'high', confidence: 80 },
    diff_summary: 'Initial diagnosis — fragmented automation stack identified from tool audit',
    created_by: 'U-01', created_by_type: 'human', created_at: dba(38),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(38),
  },
  {
    revision_id: 'R-DX-002-B', block_id: 'B-DX-002',
    change_type: 'ai_expand',
    proposed_content: { severity: 'high', confidence: 87, description: 'Seven automation tools operate without a shared data model...' },
    diff_summary: 'AI: Expanded with $147K payroll misallocation calculation and growth ceiling analysis',
    created_by: 'gpt-4o-mini', created_by_type: 'ai', created_at: dba(6),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(6),
  },

  // ── B-DX-003 revisions — HAS A PENDING REVISION ───────────────────────────
  {
    revision_id: 'R-DX-003-A', block_id: 'B-DX-003',
    change_type: 'create',
    proposed_content: { severity: 'high', confidence: 78 },
    diff_summary: 'AI: Generated governance gap diagnosis from compliance signal in diagnostic Q12',
    created_by: 'gpt-4o-mini', created_by_type: 'ai', created_at: dba(10),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(10),
  },
  {
    revision_id: 'R-DX-003-B', block_id: 'B-DX-003',
    change_type: 'ai_improve',
    proposed_content: {
      severity: 'high', confidence: 82,
      description: 'No documented AI governance framework exists for the two regulated client verticals (healthcare adjacent, financial services). Current deployments lack audit trails and model explainability. Three enterprise deals confirmed stalled at security review stage in Q1 2026. EU AI Act compliance cost estimated at €40K–€80K if addressed reactively.',
      operational_impact: [
        'No AI audit trail — 0% model output logging across all deployed features',
        'Three enterprise deals stalled at security review (confirmed Q1 2026 pipeline report)',
        'Zero approval workflow for AI features in regulated client environments',
      ],
      financial_impact: [
        '$180K enterprise ARR blocked — 3 deals pending governance clearance',
        '€40K–€80K EU AI Act reactive compliance cost vs. ≈€12K proactive path',
      ],
    },
    diff_summary: 'AI: Raised confidence to 82, added third operational impact, quantified EU AI Act compliance cost delta',
    created_by: 'gpt-4o-mini', created_by_type: 'ai', created_at: dba(2),
    approval_status: 'pending',   // ← PENDING — triggers "Review changes" in UI
    approved_by: null, approved_at: null,
  },

  // ── B-SOL-001 revisions (2) ────────────────────────────────────────────────
  {
    revision_id: 'R-SOL-001-A', block_id: 'B-SOL-001',
    change_type: 'create',
    proposed_content: { pillar: 'workflow' },
    diff_summary: 'Initial solution block — workflow automation layer',
    created_by: 'U-01', created_by_type: 'human', created_at: dba(25),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(25),
  },
  {
    revision_id: 'R-SOL-001-B', block_id: 'B-SOL-001',
    change_type: 'edit',
    proposed_content: { pillar: 'workflow', timeline_weeks: 6, complexity_score: 3 },
    diff_summary: 'Updated timeline to 6 weeks after technical scoping; complexity set to 3',
    created_by: 'U-01', created_by_type: 'human', created_at: dba(7),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(7),
  },

  // ── B-SOL-002 revisions — HAS A PENDING REVISION ──────────────────────────
  {
    revision_id: 'R-SOL-002-A', block_id: 'B-SOL-002',
    change_type: 'create',
    proposed_content: { pillar: 'agents', timeline_weeks: 4, complexity_score: 2 },
    diff_summary: 'AI: Generated governance framework solution from diagnosis B-DX-003',
    created_by: 'gpt-4o-mini', created_by_type: 'ai', created_at: dba(5),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(5),
  },
  {
    revision_id: 'R-SOL-002-B', block_id: 'B-SOL-002',
    change_type: 'edit',
    proposed_content: {
      pillar: 'agents',
      description: 'Design and deploy a lightweight AI governance framework: model registry, audit-trail logging, explainability documentation templates, and an approval workflow for AI features in regulated contexts. Includes SOC 2 Type II evidence pack. Unblocks 3 stalled enterprise deals ($180K ARR exposure).',
      systems_affected: ['AI model registry', 'Compliance portal', 'Deal room', 'SOC 2 evidence vault'],
      timeline_weeks: 5,
      complexity_score: 3,
    },
    diff_summary: 'Human: Expanded scope to include SOC 2 evidence pack; timeline extended to 5 weeks; complexity updated to 3',
    created_by: 'U-01', created_by_type: 'human', created_at: dba(1),
    approval_status: 'pending',   // ← PENDING — triggers "Review changes" in UI
    approved_by: null, approved_at: null,
  },

  // ── B-NS-001 (1) ───────────────────────────────────────────────────────────
  {
    revision_id: 'R-NS-001-A', block_id: 'B-NS-001',
    change_type: 'create',
    proposed_content: { offer_name: 'AI Systems Audit — Foundation Sprint', price: 45000 },
    diff_summary: 'Initial next step offer — price set to $45K for 12-week sprint',
    created_by: 'U-01', created_by_type: 'human', created_at: dba(20),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(20),
  },

  // ── B-ROI-NAR (1) ──────────────────────────────────────────────────────────
  {
    revision_id: 'R-ROI-NAR-A', block_id: 'B-ROI-NAR',
    change_type: 'create',
    proposed_content: { text: 'At the expected scenario, Vesper Dynamics is projected to realise a 340% ROI...' },
    diff_summary: 'AI: Generated ROI narrative from ROI engine output (scenario: expected)',
    created_by: 'gpt-4o-mini', created_by_type: 'ai', created_at: dba(12),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(12),
  },

  // ── B-ROI-FIN (1) ──────────────────────────────────────────────────────────
  {
    revision_id: 'R-ROI-FIN-A', block_id: 'B-ROI-FIN',
    change_type: 'create',
    proposed_content: { roi_percentage: 340, investment_total: 45000 },
    diff_summary: 'System: ROI engine snapshot committed — reference block locked on creation',
    created_by: 'system', created_by_type: 'ai', created_at: dba(12),
    approval_status: 'accepted', approved_by: 'system', approved_at: dba(12),
  },

  // ── B-CC-001 (1) ───────────────────────────────────────────────────────────
  {
    revision_id: 'R-CC-001-A', block_id: 'B-CC-001',
    change_type: 'create',
    proposed_content: { text: 'MARQ Cortex Ltd liability is limited...' },
    diff_summary: 'System: Contract clause populated from legal template — locked on creation',
    created_by: 'U-01', created_by_type: 'human', created_at: dba(18),
    approval_status: 'accepted', approved_by: 'U-01', approved_at: dba(18),
  },

  // ── B-CRM-001 (1) ──────────────────────────────────────────────────────────
  {
    revision_id: 'R-CRM-001-A', block_id: 'B-CRM-001',
    change_type: 'create',
    proposed_content: { text: 'CFO (Priya Nair) raised ROI payback timing...' },
    diff_summary: 'Human: CRM note added after CFO alignment call on 2026-02-28',
    created_by: 'U-02', created_by_type: 'human', created_at: dba(3),
    approval_status: 'accepted', approved_by: 'U-02', approved_at: dba(3),
  },
];

/**
 * All block links.
 * Rule (schema §5): a block can have multiple links.
 */
export let LINK_STORE: BlockLink[] = [
  { link_id: 'L-001', block_id: 'B-EB-001',  entity_type: 'proposal', entity_id: 'P-0001', created_at: dba(42) },
  { link_id: 'L-002', block_id: 'B-DX-001',  entity_type: 'proposal', entity_id: 'P-0001', created_at: dba(40) },
  { link_id: 'L-003', block_id: 'B-DX-001',  entity_type: 'diagnosis', entity_id: 'DX-001', created_at: dba(40) },
  { link_id: 'L-004', block_id: 'B-DX-002',  entity_type: 'proposal', entity_id: 'P-0001', created_at: dba(38) },
  { link_id: 'L-005', block_id: 'B-DX-002',  entity_type: 'diagnosis', entity_id: 'DX-002', created_at: dba(38) },
  { link_id: 'L-006', block_id: 'B-DX-003',  entity_type: 'proposal', entity_id: 'P-0001', created_at: dba(10) },
  { link_id: 'L-007', block_id: 'B-DX-003',  entity_type: 'diagnosis', entity_id: 'DX-003', created_at: dba(10) },
  { link_id: 'L-008', block_id: 'B-SOL-001', entity_type: 'proposal', entity_id: 'P-0001', created_at: dba(25) },
  { link_id: 'L-009', block_id: 'B-SOL-001', entity_type: 'solution', entity_id: 'SOL-001', created_at: dba(25) },
  { link_id: 'L-010', block_id: 'B-SOL-002', entity_type: 'proposal', entity_id: 'P-0001', created_at: dba(5) },
  { link_id: 'L-011', block_id: 'B-SOL-002', entity_type: 'solution', entity_id: 'SOL-002', created_at: dba(5) },
  { link_id: 'L-012', block_id: 'B-NS-001',  entity_type: 'proposal', entity_id: 'P-0001', created_at: dba(20) },
  { link_id: 'L-013', block_id: 'B-ROI-NAR', entity_type: 'roi',      entity_id: 'ROI-001', created_at: dba(12) },
  { link_id: 'L-014', block_id: 'B-ROI-FIN', entity_type: 'roi',      entity_id: 'ROI-001', created_at: dba(12) },
  { link_id: 'L-015', block_id: 'B-CC-001',  entity_type: 'contract',  entity_id: 'CON-001', created_at: dba(18) },
  { link_id: 'L-016', block_id: 'B-CRM-001', entity_type: 'deal',      entity_id: 'D-010',   created_at: dba(3) },
];

/**
 * All locks.
 * Rule (schema §6): contract_clause defaults unlock_allowed=false.
 *                   ROI financial snapshot → roi_locked.
 */
export let LOCK_STORE: BlockLock[] = [
  {
    lock_id:        'K-0001',
    block_id:       'B-ROI-FIN',
    lock_reason:    'roi_locked',
    locked_by:      'system',
    locked_at:      dba(12),
    unlock_allowed: false,
  },
  {
    lock_id:        'K-0002',
    block_id:       'B-CC-001',
    lock_reason:    'proposal_sent',
    locked_by:      'system',
    locked_at:      dba(18),
    unlock_allowed: false,
  },
];

// ════════════════════════════════════════════════════════════════════════════════
// ID GENERATORS — deterministic, collision-safe
// ════════════════════════════════════════════════════════════════════════════════

let _blockSeq = 200;
let _revSeq   = 1000;
let _linkSeq  = 100;
let _lockSeq  = 10;

export function nextBlockId():    string { return `B-${String(++_blockSeq).padStart(6, '0')}`; }
export function nextRevisionId(): string { return `R-${String(++_revSeq).padStart(6, '0')}`; }
export function nextLinkId():     string { return `L-${String(++_linkSeq).padStart(3, '0')}`; }
export function nextLockId():     string { return `K-${String(++_lockSeq).padStart(4, '0')}`; }

// ════════════════════════════════════════════════════════════════════════════════
// PURE FUNCTIONS — no side effects; callers update stores
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Returns true if a block is currently locked.
 * Rule (schema §6): if locked, only admin can create revisions.
 */
export function isBlockLocked(blockId: string, locks: BlockLock[]): boolean {
  return locks.some(l => l.block_id === blockId);
}

/**
 * Returns the active pending revision for a block, or null.
 * Rule (schema §4): only ONE pending revision per block allowed.
 */
export function getPendingRevision(blockId: string, revisions: BlockRevision[]): BlockRevision | null {
  return revisions.find(r => r.block_id === blockId && r.approval_status === 'pending') ?? null;
}

/**
 * Compose a BlockState for a given blockId from the four stores.
 * UI always reads from this — never raw stores.
 */
export function getBlockState(
  blockId:   string,
  blocks:    Block[],
  revisions: BlockRevision[],
  links:     BlockLink[],
  locks:     BlockLock[],
): BlockState | null {
  const block = blocks.find(b => b.block_id === blockId);
  if (!block) return null;

  const blockRevisions = revisions
    .filter(r => r.block_id === blockId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return {
    block,
    revisions:        blockRevisions,
    links:            links.filter(l => l.block_id === blockId),
    lock:             locks.find(l => l.block_id === blockId) ?? null,
    pending_revision: getPendingRevision(blockId, revisions),
  };
}

/**
 * Get all blocks linked to a proposal, with full state.
 */
export function getBlocksByProposal(
  proposalId: string,
  blocks:     Block[],
  revisions:  BlockRevision[],
  links:      BlockLink[],
  locks:      BlockLock[],
): BlockState[] {
  const linkedBlockIds = links
    .filter(l => l.entity_type === 'proposal' && l.entity_id === proposalId)
    .map(l => l.block_id);

  return linkedBlockIds
    .map(id => getBlockState(id, blocks, revisions, links, locks))
    .filter((s): s is BlockState => s !== null);
}

/**
 * Create a new Block.
 * Rule (schema §3): version starts at 1.
 */
export function createBlock(params: {
  block_type:     BlockType;
  title:          string;
  content_format: ContentFormat;
  content:        Record<string, unknown>;
  source:         BlockSource;
  owner_user_id:  string;
}): { block: Block; revision: BlockRevision } {
  const now         = new Date().toISOString();
  const block_id    = nextBlockId();
  const revision_id = nextRevisionId();

  const revision: BlockRevision = {
    revision_id,
    block_id,
    change_type:      'create',
    proposed_content: params.content,
    diff_summary:     `Block created — ${BLOCK_TYPE_LABELS[params.block_type]}`,
    created_by:       params.owner_user_id,
    created_by_type:  params.source === 'ai' ? 'ai' : 'human',
    created_at:       now,
    approval_status:  'accepted',
    approved_by:      params.owner_user_id,
    approved_at:      now,
  };

  const block: Block = {
    block_id,
    block_type:          params.block_type,
    title:               params.title,
    content_format:      params.content_format,
    content:             params.content,
    status:              DEFAULT_LOCKED_TYPES.has(params.block_type) ? 'locked' : 'draft',
    source:              params.source,
    owner_user_id:       params.owner_user_id,
    created_at:          now,
    updated_at:          now,
    current_revision_id: revision_id,
    version:             1,
  };

  return { block, revision };
}

/**
 * Propose a new revision for an existing block.
 *
 * Rules enforced:
 *   §4  Only ONE pending revision allowed per block — throws if one already exists.
 *   §6  Locked blocks require isAdmin=true — throws otherwise.
 *   §9  roi_financial_snapshot content cannot be changed — throws.
 */
export function createRevision(
  block:            Block,
  revisions:        BlockRevision[],
  locks:            BlockLock[],
  params: {
    change_type:      RevisionChangeType;
    proposed_content: Record<string, unknown>;
    diff_summary:     string;
    created_by:       string;
    created_by_type:  RevisionAuthorType;
    is_admin?:        boolean;
  },
): BlockRevision {
  // §9 — ROI financial snapshot is immutable
  if (REFERENCE_ONLY_TYPES.has(block.block_type)) {
    throw new Error(
      `Block "${block.block_id}" is a reference block (${block.block_type}). Numbers cannot be edited. Edit the roi_summary_narrative block instead.`,
    );
  }

  // §6 — Locked blocks: only admin
  if (isBlockLocked(block.block_id, locks) && !params.is_admin) {
    const lock = locks.find(l => l.block_id === block.block_id)!;
    throw new Error(
      `Block "${block.block_id}" is locked (reason: ${lock.lock_reason}). Only admin can create revisions.`,
    );
  }

  // §4 — Only one pending revision allowed
  const existing = getPendingRevision(block.block_id, revisions);
  if (existing) {
    throw new Error(
      `Block "${block.block_id}" already has a pending revision (${existing.revision_id}). Accept or reject it before proposing a new one.`,
    );
  }

  return {
    revision_id:      nextRevisionId(),
    block_id:         block.block_id,
    change_type:      params.change_type,
    proposed_content: params.proposed_content,
    diff_summary:     params.diff_summary,
    created_by:       params.created_by,
    created_by_type:  params.created_by_type,
    created_at:       new Date().toISOString(),
    approval_status:  'pending',
    approved_by:      null,
    approved_at:      null,
  };
}

/**
 * Accept a pending revision.
 *
 * Rule (schema §4): Accepting updates block.content + current_revision_id.
 *                   version increments on acceptance.
 */
export function acceptRevision(
  block:     Block,
  revision:  BlockRevision,
  approvedBy: string,
): { block: Block; revision: BlockRevision } {
  if (revision.approval_status !== 'pending') {
    throw new Error(`Revision ${revision.revision_id} is not pending (status: ${revision.approval_status}).`);
  }

  const now = new Date().toISOString();

  const updatedRevision: BlockRevision = {
    ...revision,
    approval_status: 'accepted',
    approved_by:     approvedBy,
    approved_at:     now,
  };

  const updatedBlock: Block = {
    ...block,
    content:             revision.proposed_content,
    current_revision_id: revision.revision_id,
    version:             block.version + 1,
    updated_at:          now,
    // If block was draft and content was accepted, it can stay draft until explicit approval
  };

  return { block: updatedBlock, revision: updatedRevision };
}

/**
 * Reject a pending revision.
 * Rule (schema §4): Revisions are never overwritten — rejection just sets status.
 */
export function rejectRevision(revision: BlockRevision, rejectedBy: string): BlockRevision {
  if (revision.approval_status !== 'pending') {
    throw new Error(`Revision ${revision.revision_id} is not pending (status: ${revision.approval_status}).`);
  }
  return {
    ...revision,
    approval_status: 'rejected',
    approved_by:     rejectedBy,
    approved_at:     new Date().toISOString(),
  };
}

/**
 * Approve a block (status → 'approved').
 * Separate from accepting a revision — approving a block is an explicit team sign-off.
 */
export function approveBlock(block: Block): Block {
  if (block.status === 'locked') throw new Error(`Cannot approve a locked block.`);
  return { ...block, status: 'approved', updated_at: new Date().toISOString() };
}

/**
 * Lock a block.
 */
export function lockBlock(blockId: string, params: {
  lock_reason:    BlockLockReason;
  locked_by:      BlockLockAuthority;
  unlock_allowed?: boolean;
}): BlockLock {
  return {
    lock_id:        nextLockId(),
    block_id:       blockId,
    lock_reason:    params.lock_reason,
    locked_by:      params.locked_by,
    locked_at:      new Date().toISOString(),
    unlock_allowed: params.unlock_allowed ?? false,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// READY GATE — spec §8
// Required block set for Proposal readiness.
// ════════════════════════════════════════════════════════════════════════════════

const BLOCKS_GATE_REQUIREMENTS: { block_type: BlockType; min_count: number; label: string }[] = [
  { block_type: 'proposal_executive_brief', min_count: 1, label: 'Executive Brief (approved)' },
  { block_type: 'proposal_diagnosis',       min_count: 3, label: '3× Diagnosis Blocks (approved)' },
  { block_type: 'proposal_solution',        min_count: 2, label: '2× Solution Blocks (approved)' },
  { block_type: 'proposal_next_step',       min_count: 1, label: 'Next Step Offer (approved)' },
];

export function checkBlocksReadyGate(states: BlockState[]): BlocksGateResult {
  const requirements: BlocksGateRequirement[] = BLOCKS_GATE_REQUIREMENTS.map(req => {
    const matching = states.filter(s => s.block.block_type === req.block_type);
    const approved = matching.filter(s => s.block.status === 'approved').length;
    const total    = matching.length;
    const passed   = approved >= req.min_count;
    return { ...req, approved, total, passed };
  });

  const passed  = requirements.every(r => r.passed);
  const failing = requirements.filter(r => !r.passed);

  const summary = passed
    ? 'All required blocks are approved — proposal gate cleared.'
    : `${failing.length} requirement${failing.length > 1 ? 's' : ''} not met: ${
        failing.map(r => r.label).join(', ')
      }.`;

  return { passed, requirements, summary };
}

// ════════════════════════════════════════════════════════════════════════════════
// DISPLAY HELPERS
// ════════════════════════════════════════════════════════════════════════════════

export const STATUS_COLORS: Record<BlockStatus, { bg: string; text: string; border: string; dot: string }> = {
  draft:    { bg: '#8B5CF620', text: '#8B5CF6', border: '#8B5CF640', dot: '#8B5CF6' },
  approved: { bg: '#10B98120', text: '#10B981', border: '#10B98140', dot: '#10B981' },
  locked:   { bg: '#70707C20', text: '#9CA3AF', border: '#70707C40', dot: '#70707C' },
};

export const SOURCE_COLORS: Record<BlockSource, string> = {
  human: '#3B82F6',
  ai:    '#8B5CF6',
  mixed: '#06D7F6',
};

export const CHANGE_TYPE_LABELS: Record<RevisionChangeType, string> = {
  create:       'Created',
  edit:         'Edited',
  ai_improve:   'AI Improve',
  ai_expand:    'AI Expand',
  ai_simplify:  'AI Simplify',
  chat_patch:   'Chat Patch',
};

export const LOCK_REASON_LABELS: Record<BlockLockReason, string> = {
  proposal_sent:    'Proposal Sent',
  contract_sent:    'Contract Sent',
  contract_signed:  'Contract Signed',
  compliance_locked:'Compliance Lock',
  roi_locked:       'ROI Engine Lock',
};
