/**
 * PROPOSAL CONSISTENCY VALIDATOR — phase-p1-implementation.md §3
 *
 * Runs before status change to ready_to_send. Three validation sections:
 *
 *   A. Structural — diagnosis count, solution count, cross-linking, phase assignment, timeline
 *   B. Financial  — financial_summary, investment matching, ROI scenario, payback value
 *   C. Narrative  — exec brief coverage, duration conflicts, amount conflicts, guarantee language
 *
 * Export blocked until all checks pass.
 *
 * Rule: "Math decides, LLM only explains" — all checks are deterministic.
 */

import type { BlockState } from './blockEngine';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export type ConsistencyErrorType =
  | 'structural_error'
  | 'mapping_error'
  | 'financial_mismatch'
  | 'narrative_issue'
  | 'guarantee_language'
  | 'data_missing';

export type ValidationSection = 'structural' | 'financial' | 'narrative';

export interface ConsistencyError {
  type:    ConsistencyErrorType;
  section: ValidationSection;
  message: string;
}

export interface ConsistencyWarning {
  section: ValidationSection;
  message: string;
}

export interface SectionResult {
  passed:   boolean;
  errors:   ConsistencyError[];
  warnings: ConsistencyWarning[];
}

export interface ConsistencyResult {
  validation_passed: boolean;
  errors:            ConsistencyError[];
  warnings:          ConsistencyWarning[];
  summary: {
    structural: boolean;
    financial:  boolean;
    narrative:  boolean;
  };
  sections: {
    structural: SectionResult;
    financial:  SectionResult;
    narrative:  SectionResult;
  };
  block_count: number;
  run_at:      string;
}

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function getBlockText(state: BlockState): string {
  const c = state.block.content;
  if (state.block.content_format === 'rich_text') return (c.text as string) ?? '';
  // For structured_json, concatenate all string values
  return Object.values(c)
    .flatMap(v => {
      if (typeof v === 'string') return [v];
      if (Array.isArray(v)) return v.map(i => typeof i === 'string' ? i : JSON.stringify(i));
      return [];
    })
    .join(' ');
}

function blocksByType(states: BlockState[], blockType: string): BlockState[] {
  return states.filter(s => s.block.block_type === blockType);
}

function approvedBlocksByType(states: BlockState[], blockType: string): BlockState[] {
  return states.filter(s => s.block.block_type === blockType && s.block.status === 'approved');
}

const GUARANTEE_PATTERNS = [
  /\bguarantee[ds]?\b/i,
  /\bguaranteed roi\b/i,
  /\bwill increase by\b/i,
  /\b100% efficiency\b/i,
  /\bzero risk\b/i,
  /\bno-risk\b/i,
];

// ════════════════════════════════════════════════════════════════════════════════
// A. STRUCTURAL VALIDATION
// ════════════════════════════════════════════════════════════════════════════════

function validateStructural(states: BlockState[]): SectionResult {
  const errors:   ConsistencyError[]   = [];
  const warnings: ConsistencyWarning[] = [];

  const diagBlocks = blocksByType(states, 'proposal_diagnosis');
  const solBlocks  = blocksByType(states, 'proposal_solution');
  const tlBlocks   = blocksByType(states, 'proposal_timeline');

  // ── Check: ≥ 3 diagnosis blocks ──────────────────────────────────────────
  if (diagBlocks.length < 3) {
    errors.push({
      type:    'structural_error',
      section: 'structural',
      message: `Only ${diagBlocks.length} diagnosis block${diagBlocks.length !== 1 ? 's' : ''} found — minimum 3 required before proposal can be sent.`,
    });
  }

  // ── Check: ≥ 2 solution blocks ────────────────────────────────────────────
  if (solBlocks.length < 2) {
    errors.push({
      type:    'structural_error',
      section: 'structural',
      message: `Only ${solBlocks.length} solution block${solBlocks.length !== 1 ? 's' : ''} found — minimum 2 required.`,
    });
  }

  // ── Check: every diagnosis has a linked solution (keyword-based heuristic) ─
  for (const dx of diagBlocks) {
    const dxTitle    = dx.block.title.toLowerCase();
    const dxContent  = getBlockText(dx).toLowerCase();
    const dxKeywords = extractKeywords(dxTitle + ' ' + dxContent);

    const hasLinkedSolution = solBlocks.some(sol => {
      const solText = (getBlockText(sol) + ' ' + sol.block.title).toLowerCase();
      return dxKeywords.some(kw => solText.includes(kw));
    });

    if (!hasLinkedSolution) {
      errors.push({
        type:    'mapping_error',
        section: 'structural',
        message: `Diagnosis "${dx.block.title}" has no linked solution block — ensure at least one solution addresses this problem area.`,
      });
    }
  }

  // ── Check: every solution assigned to phase / pillar ─────────────────────
  for (const sol of solBlocks) {
    const c = sol.block.content;
    const hasPillar   = !!(c.pillar   || c.phase);
    const hasTimeline = !!(c.timeline_weeks || c.duration);

    if (!hasPillar) {
      errors.push({
        type:    'structural_error',
        section: 'structural',
        message: `Solution "${sol.block.title}" is not assigned to a pillar or phase.`,
      });
    }
    if (!hasTimeline) {
      warnings.push({
        section: 'structural',
        message: `Solution "${sol.block.title}" is missing a timeline_weeks value.`,
      });
    }
  }

  // ── Check: timeline block consistent ─────────────────────────────────────
  if (tlBlocks.length === 0 && solBlocks.length > 0) {
    // No standalone timeline block — check if solution weeks are coherent
    const solWeeks = solBlocks
      .map(s => s.block.content.timeline_weeks as number)
      .filter(w => typeof w === 'number' && w > 0);

    if (solWeeks.length > 0) {
      const totalWeeks = solWeeks.reduce((a, b) => a + b, 0);
      const nsBlock    = blocksByType(states, 'proposal_next_step')[0];
      if (nsBlock) {
        const offered = nsBlock.block.content.duration as string ?? '';
        const offerWeeks = parseInt(offered.replace(/[^0-9]/g, '')) || 0;
        if (offerWeeks > 0 && totalWeeks > offerWeeks) {
          errors.push({
            type:    'structural_error',
            section: 'structural',
            message: `Solution timelines sum to ${totalWeeks} weeks but next step offer states ${offerWeeks} weeks — inconsistent.`,
          });
        }
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'with', 'this', 'that', 'from', 'have', 'has', 'its', 'been', 'was', 'will', 'can', 'all', 'in', 'on', 'at', 'to', 'of', 'a', 'an', 'is']);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 12); // top 12 keywords
}

// ════════════════════════════════════════════════════════════════════════════════
// B. FINANCIAL VALIDATION
// ════════════════════════════════════════════════════════════════════════════════

function validateFinancial(states: BlockState[]): SectionResult {
  const errors:   ConsistencyError[]   = [];
  const warnings: ConsistencyWarning[] = [];

  const roiFinBlocks  = blocksByType(states, 'roi_financial_snapshot');
  const roiNarBlocks  = blocksByType(states, 'roi_summary_narrative');
  const nsBlocks      = blocksByType(states, 'proposal_next_step');
  const solBlocks     = blocksByType(states, 'proposal_solution');

  // ── Check: financial_summary populated ────────────────────────────────────
  if (roiFinBlocks.length === 0) {
    errors.push({
      type:    'data_missing',
      section: 'financial',
      message: 'No ROI Financial Snapshot block found — run the ROI engine before sending the proposal.',
    });
  } else {
    const roiFin = roiFinBlocks[0].block.content;

    // ── Check: investment_total present ────────────────────────────────────
    const investmentTotal = roiFin.investment_total as number;
    if (!investmentTotal || investmentTotal <= 0) {
      errors.push({
        type:    'data_missing',
        section: 'financial',
        message: 'ROI Financial Snapshot is missing investment_total — re-run the ROI engine.',
      });
    }

    // ── Check: investment_total matches next step price ───────────────────
    if (nsBlocks.length > 0 && investmentTotal > 0) {
      const nsPrice = nsBlocks[0].block.content.price as number;
      if (nsPrice && Math.abs(nsPrice - investmentTotal) > 1) {
        errors.push({
          type:    'financial_mismatch',
          section: 'financial',
          message: `Investment total mismatch: ROI Snapshot shows $${investmentTotal.toLocaleString()} but Next Step Offer price is $${nsPrice.toLocaleString()}. Reconcile before sending.`,
        });
      }
    }

    // ── Check: ROI scenario defined ───────────────────────────────────────
    if (!roiFin.scenario) {
      errors.push({
        type:    'data_missing',
        section: 'financial',
        message: 'ROI scenario is undefined — re-run the ROI engine with a scenario selection (conservative / expected / optimistic).',
      });
    }

    // ── Check: payback value present ─────────────────────────────────────
    if (!roiFin.payback_month && roiFin.payback_month !== 0) {
      errors.push({
        type:    'data_missing',
        section: 'financial',
        message: 'ROI Financial Snapshot is missing payback_month — re-run the ROI engine.',
      });
    }

    // ── Check: ROI scenario defined on ROI narrative ──────────────────────
    if (roiNarBlocks.length === 0) {
      warnings.push({
        section: 'financial',
        message: 'No ROI Summary Narrative block found — client-facing ROI explanation is missing.',
      });
    }
  }

  // ── Check: solution price allocations add up ─────────────────────────────
  // (only if solutions have price fields — not all do in current schema)
  const solPrices = solBlocks
    .map(s => s.block.content.price as number)
    .filter(p => typeof p === 'number' && p > 0);

  if (solPrices.length > 0 && roiFinBlocks.length > 0) {
    const solSum       = solPrices.reduce((a, b) => a + b, 0);
    const investTotal  = roiFinBlocks[0].block.content.investment_total as number ?? 0;
    if (investTotal > 0 && Math.abs(solSum - investTotal) > 1) {
      warnings.push({
        section: 'financial',
        message: `Solution price allocations sum to $${solSum.toLocaleString()} vs investment total $${investTotal.toLocaleString()} — verify allocation breakdown.`,
      });
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// C. NARRATIVE VALIDATION
// ════════════════════════════════════════════════════════════════════════════════

function validateNarrative(states: BlockState[]): SectionResult {
  const errors:   ConsistencyError[]   = [];
  const warnings: ConsistencyWarning[] = [];

  const ebBlocks   = blocksByType(states, 'proposal_executive_brief');
  const diagBlocks = blocksByType(states, 'proposal_diagnosis');
  const solBlocks  = blocksByType(states, 'proposal_solution');
  const nsBlocks   = blocksByType(states, 'proposal_next_step');
  const roiFinBlocks = blocksByType(states, 'roi_financial_snapshot');

  // ── Check: executive brief references ≥ 2 diagnosis themes ───────────────
  if (ebBlocks.length > 0 && diagBlocks.length >= 2) {
    const ebText   = getBlockText(ebBlocks[0]).toLowerCase();
    const diagHits = diagBlocks.filter(dx => {
      const keywords = extractKeywords(dx.block.title.toLowerCase());
      return keywords.some(kw => ebText.includes(kw));
    });
    if (diagHits.length < 2) {
      errors.push({
        type:    'narrative_issue',
        section: 'narrative',
        message: `Executive Brief references only ${diagHits.length} diagnosis theme${diagHits.length !== 1 ? 's' : ''} — it should address at least 2 core problem areas identified in the diagnosis.`,
      });
    }
  }

  // ── Check: no conflicting durations ──────────────────────────────────────
  const allWeeks = [
    ...solBlocks.map(s => ({ label: s.block.title, weeks: s.block.content.timeline_weeks as number })),
  ].filter(x => x.weeks > 0);

  if (nsBlocks.length > 0) {
    const offered    = nsBlocks[0].block.content.duration as string ?? '';
    const offerWeeks = parseInt(offered.replace(/[^0-9]/g, '')) || 0;
    const maxSol     = allWeeks.reduce((m, x) => Math.max(m, x.weeks), 0);

    if (offerWeeks > 0 && maxSol > offerWeeks) {
      errors.push({
        type:    'narrative_issue',
        section: 'narrative',
        message: `Duration conflict: solution "${allWeeks.find(w => w.weeks === maxSol)?.label}" runs ${maxSol} weeks but the offer commits to ${offerWeeks} weeks — client-facing promise contradicts scope.`,
      });
    }
  }

  // ── Check: no conflicting investment amounts ──────────────────────────────
  const nsPrice   = nsBlocks[0]?.block.content.price as number;
  const roiTotal  = roiFinBlocks[0]?.block.content.investment_total as number;
  if (nsPrice && roiTotal && Math.abs(nsPrice - roiTotal) > 1) {
    errors.push({
      type:    'financial_mismatch',
      section: 'narrative',
      message: `Investment amount conflict: offer shows $${nsPrice.toLocaleString()} but ROI narrative references $${roiTotal.toLocaleString()} — client will see conflicting numbers.`,
    });
  }

  // ── Check: no "guarantee" language across all content blocks ─────────────
  for (const state of states) {
    const text = getBlockText(state);
    for (const pattern of GUARANTEE_PATTERNS) {
      if (pattern.test(text)) {
        errors.push({
          type:    'guarantee_language',
          section: 'narrative',
          message: `Guarantee language detected in block "${state.block.title}" — remove absolute promises (spec: no "guaranteed ROI", no "will increase by X%"). Review and rewrite.`,
        });
        break; // one error per block is enough
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Run all three validation sections against the full set of block states.
 *
 * @param allStates  BlockState[] for the proposal — from getBlocksByProposal()
 * @returns          ConsistencyResult with grouped errors, warnings, and section pass/fail
 */
export function runConsistencyValidator(allStates: BlockState[]): ConsistencyResult {
  const structural = validateStructural(allStates);
  const financial  = validateFinancial(allStates);
  const narrative  = validateNarrative(allStates);

  const allErrors   = [...structural.errors,   ...financial.errors,   ...narrative.errors];
  const allWarnings = [...structural.warnings,  ...financial.warnings, ...narrative.warnings];

  return {
    validation_passed: structural.passed && financial.passed && narrative.passed,
    errors:            allErrors,
    warnings:          allWarnings,
    summary: {
      structural: structural.passed,
      financial:  financial.passed,
      narrative:  narrative.passed,
    },
    sections: { structural, financial, narrative },
    block_count: allStates.length,
    run_at:      new Date().toISOString(),
  };
}
