/**
 * ROLE & PERMISSION LAYER — phase-p1-implementation.md §1
 *
 * Five roles: admin | strategist | finance | sales | viewer
 *
 * Permission matrix (strict):
 *   - Only Admin can unlock locked blocks
 *   - Finance can modify ROI assumptions (roi_financial_snapshot), not narrative
 *   - Sales cannot touch solution scope
 *   - Viewer is read-only on everything
 *
 * Rules:
 *   canEditBlock     — role has write access to this block type
 *   canAIAssistBlock — role can trigger AI actions on this block type
 *   canApproveBlock  — role can approve (sign-off) this block type
 *   canUnlockBlock   — only admin
 *   canUseCopilot    — admin + strategist only
 */

import type { BlockType } from './blockEngine';

// ════════════════════════════════════════════════════════════════════════════════
// ROLE ENUM
// ════════════════════════════════════════════════════════════════════════════════

export type UserRole = 'admin' | 'strategist' | 'finance' | 'sales' | 'viewer';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin:      'Admin',
  strategist: 'Strategist',
  finance:    'Finance',
  sales:      'Sales',
  viewer:     'Viewer',
};

export const ROLE_COLORS: Record<UserRole, string> = {
  admin:      '#FD4438',
  strategist: '#8B5CF6',
  finance:    '#10B981',
  sales:      '#F59E0B',
  viewer:     '#6B7280',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin:      'Full access — can unlock, override, and approve all blocks',
  strategist: 'Can edit all proposal and narrative content; no financial or contract access',
  finance:    'Can view and reference ROI financial blocks; no narrative or proposal editing',
  sales:      'Can edit executive brief and next step offer only; no solution scope access',
  viewer:     'Read-only — cannot edit, approve, or run AI on any block',
};

// ════════════════════════════════════════════════════════════════════════════════
// PERMISSION MATRIX (spec §1 — strict)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Maps each block type to the set of roles allowed to EDIT it.
 * Roles not in the set are denied. Admin always has access.
 */
const BLOCK_EDIT_ROLES: Record<BlockType, ReadonlySet<UserRole>> = {
  proposal_executive_brief:  new Set(['admin', 'strategist', 'sales']),
  proposal_diagnosis:        new Set(['admin', 'strategist']),
  proposal_solution:         new Set(['admin', 'strategist']),
  proposal_timeline:         new Set(['admin', 'strategist']),
  proposal_team:             new Set(['admin', 'strategist']),
  proposal_governance:       new Set(['admin', 'strategist']),
  proposal_next_step:        new Set(['admin', 'strategist', 'sales']),
  roi_summary_narrative:     new Set(['admin', 'strategist']),
  roi_financial_snapshot:    new Set(['admin', 'finance']),     // reference-only in engine §9, but Finance sees it
  recommendation_card:       new Set(['admin', 'strategist', 'sales']),
  contract_clause:           new Set(['admin']),
  followup_email_template:   new Set(['admin', 'strategist', 'sales']),
  crm_note:                  new Set(['admin', 'strategist', 'sales']),
};

/**
 * AI Assist: same as edit, except roi_financial_snapshot is never AI-assisted
 * (it's reference-only in blockEngine §9). Finance keeps edit access but not AI.
 */
const BLOCK_AI_ROLES: Record<BlockType, ReadonlySet<UserRole>> = {
  ...BLOCK_EDIT_ROLES,
  roi_financial_snapshot: new Set([]),   // no AI on reference block — enforced by blockEngine §9
  contract_clause:        new Set([]),   // admin-only AI notice handled in EditableBlockCard
};

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS — PURE FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

/** Returns true if the role is allowed to create/propose a revision on this block type. */
export function canEditBlock(role: UserRole, blockType: BlockType): boolean {
  return BLOCK_EDIT_ROLES[blockType]?.has(role) ?? false;
}

/** Returns true if the role can trigger AI Assist actions on this block type. */
export function canAIAssistBlock(role: UserRole, blockType: BlockType): boolean {
  return BLOCK_AI_ROLES[blockType]?.has(role) ?? false;
}

/** Returns true if the role can sign-off (approve) a block (same as edit rights). */
export function canApproveBlock(role: UserRole, blockType: BlockType): boolean {
  return BLOCK_EDIT_ROLES[blockType]?.has(role) ?? false;
}

/** Only admin can unlock locked blocks (schema §6). */
export function canUnlockBlock(role: UserRole): boolean {
  return role === 'admin';
}

/** Global Copilot restricted to admin + strategist (spec Phase C). */
export function canUseCopilot(role: UserRole): boolean {
  return role === 'admin' || role === 'strategist';
}

/** Human-readable reason shown to non-permitted roles. */
export function getPermissionDeniedReason(role: UserRole, blockType: BlockType): string {
  const roleLabel = ROLE_LABELS[role];
  switch (blockType) {
    case 'contract_clause':
      return `${roleLabel} role: contract clauses are Admin-only`;
    case 'roi_financial_snapshot':
      return role === 'finance'
        ? 'ROI Snapshot: reference-only — use ROI Assumptions Editor'
        : `${roleLabel} role: ROI financial data is Finance/Admin only`;
    case 'proposal_solution':
    case 'proposal_timeline':
    case 'proposal_diagnosis':
      return `${roleLabel} role: solution/diagnosis/timeline scope is Strategist/Admin only`;
    case 'roi_summary_narrative':
      return `${roleLabel} role: ROI narrative is Strategist/Admin only`;
    default:
      return `${roleLabel} role does not have write access to ${blockType.replace(/_/g, ' ')}`;
  }
}
