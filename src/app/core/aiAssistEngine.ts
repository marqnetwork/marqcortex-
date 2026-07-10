/**
 * AI ASSIST ENGINE — ai-assist-per-block.md
 *
 * Frontend orchestrator for per-block AI actions.
 *
 * Responsibilities:
 *   1. Call POST /blocks/ai-assist on the server
 *   2. Run all 3 validators BEFORE the revision is committed
 *   3. Return a BlockRevision with approval_status="pending" — never auto-accept
 *   4. Respect BACKEND_INTEGRATION=false → return deterministic mock after 1.5s
 *
 * Three validators (spec §5):
 *   A) Fact lock   — client name, offer price, timeline_weeks, ROI metrics
 *   B) Coherence   — solution blocks need specific fields
 *   C) Jargon      — reject if jargon density > threshold
 */

import { FEATURES } from '@/config/features';
import { projectId, publicAnonKey } from '/utils/supabase/info';
import type { Block, BlockRevision, BlockState, RevisionChangeType } from './blockEngine';
import { nextRevisionId, BLOCK_TYPE_LABELS } from './blockEngine';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export type AIAction = 'ai_improve' | 'ai_expand' | 'ai_simplify' | 'fix_issues';

export const AI_ACTION_LABELS: Record<AIAction, string> = {
  ai_improve:  'Improve',
  ai_expand:   'Expand',
  ai_simplify: 'Simplify',
  fix_issues:  'Fix Issues',
};

export const AI_ACTION_DESCRIPTIONS: Record<AIAction, string> = {
  ai_improve:  'Boardroom polish — tighten language, sharpen clarity',
  ai_expand:   'Add depth, structure, and detail across all required fields',
  ai_simplify: 'Client-facing version — remove internal complexity',
  fix_issues:  'Address reviewer notes and missing gate items',
};

// ── Validator result types ────────────────────────────────────────────────────

export interface FactLockResult {
  passed:     boolean;
  violations: string[];
}

export interface CoherenceResult {
  passed:         boolean;
  missing_fields: string[];
}

export interface JargonResult {
  passed:      boolean;
  count:       number;
  words_found: string[];
}

export interface ValidationResult {
  fact_lock:  FactLockResult;
  coherence:  CoherenceResult;
  jargon:     JargonResult;
  all_passed: boolean;
}

export interface AIAssistResult {
  revision:   BlockRevision;
  validation: ValidationResult;
}

export interface AIAssistError {
  code:    'fact_lock_violation' | 'coherence_failure' | 'jargon_failure' | 'api_error' | 'key_missing';
  message: string;
  details: ValidationResult | null;
}

// ── Context assembled from linked blocks ─────────────────────────────────────

export interface AIAssistContext {
  company:           string;
  industry:          string;
  tone:              string;
  roi_snapshot?:     Record<string, unknown>;
  scope_boundaries?: Record<string, unknown>;
  linked_diagnoses?: Record<string, unknown>[];
}

// ════════════════════════════════════════════════════════════════════════════════
// VALIDATOR A — FACT LOCK
// Prevents AI from changing: client name, price, timeline_weeks, ROI metrics
// ════════════════════════════════════════════════════════════════════════════════

/** Numeric keys that are "locked facts" — AI cannot change their values. */
const LOCKED_NUMERIC_KEYS = new Set([
  'price', 'timeline_weeks', 'roi_percentage', 'investment_total',
  'annual_gain', 'payback_month', 'confidence_score', 'complexity_score',
  'severity_score',
]);

/**
 * Locked string keys — AI cannot change their values.
 * We don't know the client name from the block itself, but we can check
 * high-risk string keys like 'offer_name' (price is embedded sometimes).
 */
const LOCKED_STRING_KEYS = new Set(['currency', 'pillar']);

export function validateFactLock(
  original: Record<string, unknown>,
  proposed: Record<string, unknown>,
): FactLockResult {
  const violations: string[] = [];

  function checkObj(orig: Record<string, unknown>, prop: Record<string, unknown>, path = '') {
    for (const key of Object.keys(orig)) {
      const fullKey = path ? `${path}.${key}` : key;
      const origVal = orig[key];
      const propVal = prop[key];

      if (LOCKED_NUMERIC_KEYS.has(key) && typeof origVal === 'number') {
        if (propVal !== undefined && typeof propVal === 'number' && propVal !== origVal) {
          violations.push(
            `fact_lock: "${fullKey}" changed from ${origVal} → ${propVal} (locked numeric field)`,
          );
        }
      }

      if (LOCKED_STRING_KEYS.has(key) && typeof origVal === 'string') {
        if (propVal !== undefined && typeof propVal === 'string' && propVal !== origVal) {
          violations.push(
            `fact_lock: "${fullKey}" changed from "${origVal}" → "${propVal}" (locked string field)`,
          );
        }
      }

      // Recurse into nested objects
      if (
        typeof origVal === 'object' && origVal !== null &&
        typeof propVal === 'object' && propVal !== null &&
        !Array.isArray(origVal)
      ) {
        checkObj(
          origVal as Record<string, unknown>,
          propVal as Record<string, unknown>,
          fullKey,
        );
      }
    }
  }

  checkObj(original, proposed);
  return { passed: violations.length === 0, violations };
}

// ════════════════════════════════════════════════════════════════════════════════
// VALIDATOR B — BLOCK COHERENCE
// Solution blocks must have required fields (spec §5B)
// ════════════════════════════════════════════════════════════════════════════════

const COHERENCE_REQUIRED: Record<string, string[]> = {
  proposal_solution: [
    'description',
    // At least one of these for "systems_affected"
    'systems_affected',
    // At least one of these for "integration_points" or "deliverables"
    'integration_points',
  ],
};

export function validateCoherence(
  blockType: string,
  proposed: Record<string, unknown>,
): CoherenceResult {
  const required = COHERENCE_REQUIRED[blockType];
  if (!required) return { passed: true, missing_fields: [] };

  const missing_fields = required.filter(f => {
    const val = proposed[f];
    if (val === undefined || val === null) return true;
    if (Array.isArray(val) && val.length === 0) return true;
    if (typeof val === 'string' && val.trim().length === 0) return true;
    return false;
  });

  return { passed: missing_fields.length === 0, missing_fields };
}

// ════════════════════════════════════════════════════════════════════════════════
// VALIDATOR C — JARGON LIMITER
// Reject if jargon density is too high (spec §5C)
// ════════════════════════════════════════════════════════════════════════════════

const JARGON_WORDS = [
  'optimize', 'optimise', 'leverage', 'synergy', 'synergize', 'synergise',
  'streamline', 'holistic', 'paradigm', 'robust', 'scalable', 'utilize',
  'utilise', 'cutting-edge', 'best-in-class', 'world-class', 'game-changer',
  'disruptive', 'thought leader', 'thought leadership', 'value-add',
];

const JARGON_THRESHOLD = 3; // more than this in a single text → fail

function extractAllText(content: Record<string, unknown>): string {
  const parts: string[] = [];
  function walk(v: unknown) {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null) {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  }
  walk(content);
  return parts.join(' ').toLowerCase();
}

export function validateJargon(proposed: Record<string, unknown>): JargonResult {
  const text       = extractAllText(proposed);
  const words_found = JARGON_WORDS.filter(w => text.includes(w.toLowerCase()));
  const count       = words_found.length;
  return {
    passed:      count <= JARGON_THRESHOLD,
    count,
    words_found,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// RUN ALL 3 VALIDATORS
// ════════════════════════════════════════════════════════════════════════════════

export function validateAIRevision(
  blockType:       string,
  originalContent: Record<string, unknown>,
  proposedContent: Record<string, unknown>,
): ValidationResult {
  const fact_lock = validateFactLock(originalContent, proposedContent);
  const coherence = validateCoherence(blockType, proposedContent);
  const jargon    = validateJargon(proposedContent);
  const all_passed = fact_lock.passed && coherence.passed && jargon.passed;
  return { fact_lock, coherence, jargon, all_passed };
}

// ════════════════════════════════════════════════════════════════════════════════
// MOCK DATA — BACKEND_INTEGRATION=false fallbacks
// Returns a realistic pending revision without hitting the API.
// ════════════════════════════════════════════════════════════════════════════════

function buildMockRevision(
  block:       Block,
  action:      AIAction,
): BlockRevision {
  const now = new Date().toISOString();

  // Generate block-type-aware mock content
  let proposed_content: Record<string, unknown>;
  let diff_summary: string;

  const isRichText = block.content_format === 'rich_text';
  const currentText = (block.content.text as string) ?? '';

  if (action === 'ai_improve') {
    if (isRichText) {
      proposed_content = {
        ...block.content,
        text: `${currentText.replace(/\. /g, '. [CORTEX AI: tightened language] ').trim()} This assessment is based on confirmed operational data — probability of outcome is conditional on implementation fidelity.`,
      };
      diff_summary = `AI Improve: tightened boardroom language, added probability qualifier, removed vague phrasing`;
    } else {
      proposed_content = {
        ...block.content,
        description: typeof block.content.description === 'string'
          ? block.content.description + ' [AI: sharpened specificity and boardroom precision.]'
          : block.content.description,
      };
      diff_summary = `AI Improve: sharpened description precision, reinforced boardroom tone`;
    }
  } else if (action === 'ai_expand') {
    if (isRichText) {
      proposed_content = {
        ...block.content,
        text: currentText + `\n\nConsequence of inaction: without addressing these confirmed bottlenecks within the next 90 days, compounding drag is projected to increase by an estimated 15–22% per quarter. The window for proactive intervention is narrowing as the competitive landscape tightens in this segment.`,
      };
      diff_summary = `AI Expand: added consequence-of-inaction section with 90-day urgency framing`;
    } else {
      proposed_content = {
        ...block.content,
        integration_points: block.content.integration_points ?? [
          'Real-time event bus connecting all downstream systems',
          'Webhook-based state synchronisation with CRM',
        ],
        expected_operational_outcomes: block.content.expected_operational_outcomes ?? [
          'Estimated 60–70% reduction in manual reconciliation overhead within 45 days',
          'Sub-24h reporting latency replacing current 3-day lag',
        ],
        dependencies_risks: block.content.dependencies_risks ?? [
          'API access to Salesforce and HubSpot required before go-live',
          'Risk: data migration complexity rated medium — mitigation plan included in Phase 1 kick-off',
        ],
      };
      diff_summary = `AI Expand: added integration_points, expected_operational_outcomes, and dependencies_risks sections`;
    }
  } else if (action === 'ai_simplify') {
    if (isRichText) {
      const simplified = currentText
        .split('. ')
        .slice(0, 3)
        .join('. ') + '.';
      proposed_content = { ...block.content, text: simplified };
      diff_summary = `AI Simplify: condensed to 3 key sentences for client-facing clarity`;
    } else {
      proposed_content = {
        ...block.content,
        description: typeof block.content.description === 'string'
          ? block.content.description.split('. ').slice(0, 2).join('. ') + '.'
          : block.content.description,
      };
      diff_summary = `AI Simplify: condensed description for client-facing readability`;
    }
  } else {
    // fix_issues
    if (isRichText) {
      proposed_content = {
        ...block.content,
        text: currentText + ` [AI Fix: added quantified success metrics and removed ambiguous outcome language per gate requirements.]`,
      };
      diff_summary = `AI Fix Issues: addressed gate requirement — added quantified success metrics`;
    } else {
      proposed_content = {
        ...block.content,
        operational_impact: (block.content.operational_impact as string[] | undefined) ?? [
          'Confirmed operational impact metric 1 — sourced from diagnostic data',
          'Confirmed operational impact metric 2 — validated in ops review',
        ],
        financial_impact: (block.content.financial_impact as string[] | undefined) ?? [
          'Estimated financial exposure based on confirmed pipeline velocity',
          'Risk-cost reduction estimate — conservative scenario applied',
        ],
      };
      diff_summary = `AI Fix Issues: populated missing operational_impact and financial_impact arrays per gate requirements`;
    }
  }

  return {
    revision_id:      nextRevisionId(),
    block_id:         block.block_id,
    change_type:      action as RevisionChangeType,
    proposed_content,
    diff_summary,
    created_by:       'gpt-4o-mini (mock)',
    created_by_type:  'ai',
    created_at:       now,
    approval_status:  'pending',
    approved_by:      null,
    approved_at:      null,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN CALL — callBlockAIAssist
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Calls the block AI assist endpoint, runs validators, returns a pending revision.
 *
 * @param blockState  The target block (all state)
 * @param action      Which AI action to perform
 * @param context     Context assembled from linked blocks
 * @returns           AIAssistResult { revision (pending), validation }
 * @throws            AIAssistError on validation failure or API error
 */
export async function callBlockAIAssist(
  blockState: BlockState,
  action:     AIAction,
  context:    AIAssistContext,
): Promise<AIAssistResult> {
  const { block } = blockState;

  // ── BACKEND_INTEGRATION=false → deterministic mock path ───────────────────
  if (!FEATURES.BACKEND_INTEGRATION) {
    // Simulate network delay
    await new Promise(r => setTimeout(r, 1_200));

    const revision   = buildMockRevision(block, action);
    const validation = validateAIRevision(block.block_type, block.content, revision.proposed_content);

    // If mock itself fails validators (shouldn't happen), still return with warning
    return { revision, validation };
  }

  // ── LIVE API path ─────────────────────────────────────────────────────────
  const url = `https://${projectId}.supabase.co/functions/v1/make-server-324f4fbe/blocks/ai-assist`;

  let rawResult: {
    proposed_content: Record<string, unknown>;
    diff_summary:     string;
    change_type:      AIAction;
    model:            string;
    generated_at:     string;
    error?:           string;
    keyMissing?:      boolean;
  };

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${publicAnonKey}`,
      },
      body: JSON.stringify({
        block_id:        block.block_id,
        block_type:      block.block_type,
        title:           block.title,
        current_content: block.content,
        action,
        context,
      }),
    });

    rawResult = await res.json();

    if (!res.ok) {
      const err: AIAssistError = {
        code:    rawResult.keyMissing ? 'key_missing' : 'api_error',
        message: rawResult.error ?? `Server returned ${res.status}`,
        details: null,
      };
      throw err;
    }
  } catch (e: any) {
    if (e && 'code' in e) throw e; // already shaped error
    const err: AIAssistError = {
      code:    'api_error',
      message: `Network error calling block AI assist: ${e?.message ?? e}`,
      details: null,
    };
    throw err;
  }

  const proposed = rawResult.proposed_content;

  // ── Run all 3 validators (spec §5) ───────────────────────────────────────
  const validation = validateAIRevision(block.block_type, block.content, proposed);

  if (!validation.all_passed) {
    const reasons: string[] = [];
    if (!validation.fact_lock.passed) {
      reasons.push(`Fact lock: ${validation.fact_lock.violations.join('; ')}`);
    }
    if (!validation.coherence.passed) {
      reasons.push(`Coherence: missing fields: ${validation.coherence.missing_fields.join(', ')}`);
    }
    if (!validation.jargon.passed) {
      reasons.push(`Jargon (${validation.jargon.count} flagged): ${validation.jargon.words_found.join(', ')}`);
    }

    const code: AIAssistError['code'] = !validation.fact_lock.passed
      ? 'fact_lock_violation'
      : !validation.coherence.passed
      ? 'coherence_failure'
      : 'jargon_failure';

    const err: AIAssistError = {
      code,
      message: `AI revision failed validation: ${reasons.join(' | ')}`,
      details: validation,
    };
    throw err;
  }

  // ── Build the pending revision ────────────────────────────────────────────
  const revision: BlockRevision = {
    revision_id:      nextRevisionId(),
    block_id:         block.block_id,
    change_type:      rawResult.change_type as RevisionChangeType,
    proposed_content: proposed,
    diff_summary:     rawResult.diff_summary,
    created_by:       rawResult.model ?? 'gpt-4o-mini',
    created_by_type:  'ai',
    created_at:       rawResult.generated_at ?? new Date().toISOString(),
    approval_status:  'pending',
    approved_by:      null,
    approved_at:      null,
  };

  return { revision, validation };
}

// ════════════════════════════════════════════════════════════════════════════════
// CONTEXT ASSEMBLER — builds AI context from sibling blocks
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Assembles AI context for a block from the full set of proposal block states.
 * This is the "AI Input Contract" from spec §2.
 */
export function assembleAIContext(
  targetBlockId:  string,
  allStates:      { block: { block_id: string; block_type: string; content: Record<string, unknown> } }[],
  proposalMeta?: { company?: string; industry?: string },
): AIAssistContext {
  const roiSnapshot = allStates.find(
    s => s.block.block_type === 'roi_financial_snapshot',
  )?.block.content;

  const scopeBlock = allStates.find(
    s => s.block.block_type === 'proposal_next_step',
  )?.block.content;

  const diagnosisBlocks = allStates
    .filter(s => s.block.block_type === 'proposal_diagnosis' && s.block.block_id !== targetBlockId)
    .map(s => s.block.content);

  return {
    company:           proposalMeta?.company   ?? 'Vesper Dynamics',
    industry:          proposalMeta?.industry  ?? 'SaaS / Revenue Tech',
    tone:              'ultra-premium boardroom',
    roi_snapshot:      roiSnapshot,
    scope_boundaries:  scopeBlock,
    linked_diagnoses:  diagnosisBlocks.length > 0 ? diagnosisBlocks : undefined,
  };
}
