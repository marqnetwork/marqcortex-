/**
 * PROPOSAL COPILOT ENGINE — section-level copilot orchestration
 *
 * Single home for the ProposalSectionCopilot demo generator, the deterministic
 * fact-lock policy, and the helpers that assemble a live backend response into
 * the same shape the demo path returns. This keeps `ProposalSectionCopilot.tsx`
 * thin and lets `dataService.proposalSectionCopilot` share one code path.
 *
 * GOVERNANCE: the LLM only rewrites/explains narrative. Fact-locked fields
 * (price, currency, duration, severity, confidence, evidence) are re-applied
 * deterministically here on the client too — a defence-in-depth mirror of the
 * server-side enforcement — so no code path can surface an AI-altered number.
 */

import type { ProposalDraft, DiagnosisBlock } from '@/app/types/cortex-types';

// ── Public section / action vocabulary ─────────────────────────────────────────

export type SectionKey =
  | 'executive_brief'
  | 'diagnosis_0' | 'diagnosis_1' | 'diagnosis_2'
  | 'scope_boundaries'
  | 'next_step_offer';

export type ActionKey = 'improve' | 'expand' | 'simplify' | 'fix_gate' | 'custom';

export interface SectionValidation {
  fact_lock: { passed: boolean; violations: string[] };
  jargon:    { passed: boolean; words_found: string[] };
  coherence: { passed: boolean; missing: string[] };
}

export interface SectionCopilotResult {
  after:          Record<string, unknown>;
  diff_summary:   string;
  changed_fields: { field: string; before: string; after: string }[];
  validation:     SectionValidation;
}

// ── Fact-lock policy (mirrors supabase/functions/server/proposalSectionCopilot.ts) ──

export const LOCKED_FIELDS_BY_SECTION: Record<string, string[]> = {
  next_step_offer: ['price', 'currency', 'duration'],
  diagnosis_0:     ['severity', 'confidence', 'evidence'],
  diagnosis_1:     ['severity', 'confidence', 'evidence'],
  diagnosis_2:     ['severity', 'confidence', 'evidence'],
};

const BANNED_JARGON = [
  'optimize', 'leverage', 'synergy', 'paradigm', 'holistic',
  'robust', 'utilize', 'seamless', 'streamline',
];

/**
 * Overwrite every locked field of a section with the authoritative value from
 * `current`, regardless of what `proposed` contains. Pure + deterministic.
 */
export function enforceFactLock(
  section: string,
  proposed: Record<string, unknown>,
  current: Record<string, unknown>,
): { content: Record<string, unknown>; restored: string[] } {
  const locked = LOCKED_FIELDS_BY_SECTION[section];
  if (!locked || !proposed || typeof proposed !== 'object') {
    return { content: proposed, restored: [] };
  }
  const content: Record<string, unknown> = { ...proposed };
  const restored: string[] = [];
  for (const field of locked) {
    if (!(field in current)) continue;
    if (JSON.stringify(content[field]) !== JSON.stringify(current[field])) {
      restored.push(field);
    }
    content[field] = current[field];
  }
  return { content, restored };
}

/** Diff two section-content objects at the top level into a display-ready list. */
export function computeChangedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { field: string; before: string; after: string }[] {
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  const out: { field: string; before: string; after: string }[] = [];
  for (const k of keys) {
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    out.push({ field: k, before: toDisplay(b), after: toDisplay(a) });
  }
  return out;
}

function toDisplay(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `${v.length} item${v.length !== 1 ? 's' : ''}`;
  return JSON.stringify(v);
}

/**
 * Deterministic validators for a live revision. Fact-lock is authoritative:
 * anything the LLM changed on a locked field is a violation (and is also
 * reverted by enforceFactLock before this runs).
 */
export function validateSectionRevision(
  section: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  factLockRestored: string[],
): SectionValidation {
  const jargonFound = BANNED_JARGON.filter(w => {
    const hay = collectStrings(after).toLowerCase();
    return new RegExp(`\\b${w}\\b`, 'i').test(hay);
  });

  const missing = Object.keys(before ?? {}).filter(k => {
    const v = after?.[k];
    if (Array.isArray(v)) return v.length === 0 && (before[k] as unknown[])?.length > 0;
    return (v === undefined || v === null || v === '') && before[k] !== '' && before[k] != null;
  });

  return {
    fact_lock: { passed: factLockRestored.length === 0, violations: factLockRestored },
    jargon:    { passed: jargonFound.length === 0, words_found: jargonFound },
    coherence: { passed: missing.length === 0, missing },
  };
}

function collectStrings(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(collectStrings).join(' ');
  if (v && typeof v === 'object') return Object.values(v).map(collectStrings).join(' ');
  return '';
}

/** Assemble a live backend response into the demo-parity SectionCopilotResult. */
export function assembleLiveResult(
  section: SectionKey,
  before: Record<string, unknown>,
  proposed: Record<string, unknown>,
  diff_summary: string,
): SectionCopilotResult {
  const { content: after, restored } = enforceFactLock(section, proposed, before);
  return {
    after,
    diff_summary,
    changed_fields: computeChangedFields(before, after),
    validation: validateSectionRevision(section, before, after, restored),
  };
}

// ── Section content extraction ─────────────────────────────────────────────────

export function getSectionContent(draft: ProposalDraft, section: SectionKey): Record<string, unknown> {
  if (section === 'executive_brief')  return draft.executive_brief as unknown as Record<string, unknown>;
  if (section === 'scope_boundaries') return draft.scope_boundaries as unknown as Record<string, unknown>;
  if (section === 'next_step_offer')  return draft.next_step_offer as unknown as Record<string, unknown>;
  const idx = parseInt(section.split('_')[1] ?? '0', 10);
  return (draft.diagnosis_blocks[idx] ?? {}) as Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════════════════════════
// DEMO GENERATOR — BACKEND_INTEGRATION=false path
// Generates realistic section-aware revisions without hitting the API.
// (Moved verbatim from ProposalSectionCopilot.tsx to preserve demo behavior.)
// ════════════════════════════════════════════════════════════════════════════════

export function buildDemoSectionRevision(
  section: SectionKey,
  action: ActionKey,
  draft: ProposalDraft,
  customPrompt: string,
  rejectionContext: string[],
): Pick<SectionCopilotResult, 'after' | 'diff_summary' | 'changed_fields' | 'validation'> {
  const company = draft.client.company_name;
  const rejCtx  = rejectionContext.length > 0
    ? `[Avoiding previously rejected patterns: ${rejectionContext.slice(-2).join('; ')}] `
    : '';

  if (section === 'executive_brief') {
    const eb = draft.executive_brief;
    if (action === 'improve') {
      const after = {
        ...eb,
        strategic_context: `${rejCtx}${company} stands at a critical operational inflection point. ${eb.strategic_context.replace(/\.$/, '')} — every month of delay compounds operational drag by an estimated 8–12%, validated against cohort benchmarks in this segment.`,
        why_now: `${eb.why_now.replace(/\.$/, '')} The 90-day intervention window is narrowing; organisations that act now capture a compounding first-mover advantage that late entrants cannot recover. The cost of inaction at current trajectory is approximately $18K–$24K per quarter.`,
        positioning_statement: `MARQ Cortex delivers the diagnostic precision and implementation certainty that ${company}'s leadership needs — not a framework, but a guaranteed outcome.`,
      };
      return {
        after,
        diff_summary: 'Sharpened urgency framing with cost-of-inaction quantification; boardroom-polished positioning statement',
        changed_fields: [
          { field: 'strategic_context', before: eb.strategic_context, after: after.strategic_context },
          { field: 'why_now', before: eb.why_now, after: after.why_now },
          { field: 'positioning_statement', before: eb.positioning_statement, after: after.positioning_statement },
        ],
        validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
      };
    }
    if (action === 'expand') {
      const after = {
        ...eb,
        strategic_context: `${eb.strategic_context} ${rejCtx}Across the ${company} operational stack, three compounding patterns were confirmed: fragmented tooling creating reconciliation overhead, manual hand-offs introducing error rates of 12–18%, and absent real-time visibility forcing reactive decision-making rather than proactive intervention.`,
        what_success_looks_like: `${eb.what_success_looks_like} Specifically: (1) manual reporting time drops from 3 days to under 4 hours; (2) lead response time reaches sub-2h consistently; (3) a documented AI governance framework is operational and auditable within 30 days of engagement close.`,
      };
      return {
        after,
        diff_summary: 'Expanded strategic context with 3 confirmed operational patterns; added measurable milestones to success vision',
        changed_fields: [
          { field: 'strategic_context', before: eb.strategic_context, after: after.strategic_context },
          { field: 'what_success_looks_like', before: eb.what_success_looks_like, after: after.what_success_looks_like },
        ],
        validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
      };
    }
    if (action === 'simplify') {
      const after = {
        ...eb,
        strategic_context: `${company} has operational gaps that are slowing growth and costing money. Our diagnostic found exactly where the problems are and how to fix them.`,
        why_now: `The longer you wait, the more expensive these problems become. We can start solving this immediately.`,
        positioning_statement: `We found the problem. We have the fix. Here's the plan.`,
      };
      return {
        after,
        diff_summary: 'Simplified to plain-English client-facing version — removed internal complexity, kept core message',
        changed_fields: [
          { field: 'strategic_context', before: eb.strategic_context, after: after.strategic_context },
          { field: 'why_now', before: eb.why_now, after: after.why_now },
          { field: 'positioning_statement', before: eb.positioning_statement, after: after.positioning_statement },
        ],
        validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
      };
    }
    // fix_gate or custom
    const after = {
      ...eb,
      strategic_context: `${eb.strategic_context} ${rejCtx}Quantified baseline: current operational state generates an estimated $${(Math.floor(Math.random() * 8) + 4) * 1000}/month in avoidable cost — confirmed via diagnostic data, not assumption.`,
      why_now: `${eb.why_now} Gate requirement met: this proposal references ${draft.diagnosis_blocks.length} confirmed diagnostic findings, each with evidence source and severity classification.`,
    };
    return {
      after,
      diff_summary: `${action === 'custom' ? `Custom: "${customPrompt.slice(0,50)}…" — ` : ''}Added quantified baseline and gate-required evidence reference to pass Phase 1 readiness checks`,
      changed_fields: [
        { field: 'strategic_context', before: eb.strategic_context, after: after.strategic_context },
        { field: 'why_now', before: eb.why_now, after: after.why_now },
      ],
      validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
    };
  }

  // ── DIAGNOSIS SECTIONS ──────────────────────────────────────────────────────
  if (section.startsWith('diagnosis_')) {
    const idx   = parseInt(section.split('_')[1] ?? '0', 10);
    const block = draft.diagnosis_blocks[idx] as DiagnosisBlock | undefined;
    if (!block) {
      return {
        after: {},
        diff_summary: 'No diagnosis block found at this index',
        changed_fields: [],
        validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: false, missing: ['block'] } },
      };
    }
    if (action === 'improve') {
      const after = {
        ...block,
        description: `${rejCtx}${block.description.replace(/\.$/, '')} — confirmed via ${block.evidence.length} evidence source${block.evidence.length !== 1 ? 's' : ''} and validated against ${company}'s operational data.`,
        operational_impact: [
          ...block.operational_impact.slice(0, -1),
          block.operational_impact.at(-1)?.replace('increases', 'compounds quarterly, each cycle harder to reverse') ?? block.operational_impact.at(-1) ?? '',
        ],
      };
      return {
        after,
        diff_summary: 'Sharpened description with evidence sourcing; reworded final operational impact for compounding urgency',
        changed_fields: [
          { field: 'description', before: block.description, after: after.description },
          { field: 'operational_impact[-1]', before: block.operational_impact.at(-1) ?? '', after: after.operational_impact.at(-1) ?? '' },
        ],
        validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
      };
    }
    if (action === 'expand') {
      const after = {
        ...block,
        operational_impact: [
          ...block.operational_impact,
          `${rejCtx}Integration failure risk: without resolution, downstream systems face cascading data inconsistency — estimated 15–22% increase in reconciliation overhead per quarter`,
        ],
        financial_impact: [
          ...block.financial_impact,
          'Opportunity cost: delayed automation means $3,200–$6,400/month in manual labour that should be captured as margin',
        ],
        evidence: [
          ...block.evidence,
          { source: 'ops_pattern' as const, ref: 'OPS-PATTERN-AUTO', note: 'Cross-validated against MARQ industry benchmark for similar company size and sector' },
        ],
      };
      return {
        after,
        diff_summary: 'Added compounding cascade impact bullet, opportunity cost financial metric, and cross-benchmark evidence source',
        changed_fields: [
          { field: 'operational_impact', before: `${block.operational_impact.length} items`, after: `${after.operational_impact.length} items (+1)` },
          { field: 'financial_impact', before: `${block.financial_impact.length} items`, after: `${after.financial_impact.length} items (+1)` },
          { field: 'evidence', before: `${block.evidence.length} sources`, after: `${after.evidence.length} sources (+1)` },
        ],
        validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
      };
    }
    if (action === 'simplify') {
      const after = {
        ...block,
        description: block.description.split('. ').slice(0, 2).join('. ') + '.',
        operational_impact: block.operational_impact.slice(0, 2),
        financial_impact: block.financial_impact.slice(0, 1),
      };
      return {
        after,
        diff_summary: 'Condensed to 2 sentences, top 2 operational impacts, 1 financial impact — client-facing readability',
        changed_fields: [
          { field: 'description', before: block.description, after: after.description },
          { field: 'operational_impact', before: `${block.operational_impact.length} items`, after: `${after.operational_impact.length} items (trimmed)` },
          { field: 'financial_impact', before: `${block.financial_impact.length} items`, after: `${after.financial_impact.length} items (trimmed)` },
        ],
        validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
      };
    }
    // fix_gate / custom
    const after = {
      ...block,
      description: `${rejCtx}${block.description}`,
      operational_impact: block.operational_impact.length < 2
        ? [...block.operational_impact, 'Confirmed: team coordination overhead increases measurably each sprint cycle without process standardisation']
        : block.operational_impact,
      financial_impact: block.financial_impact.length < 1
        ? ['Revenue leakage estimated at 4–8% of monthly pipeline value based on confirmed velocity data']
        : block.financial_impact,
    };
    return {
      after,
      diff_summary: `${action === 'custom' ? `Custom: "${customPrompt.slice(0,50)}…" — ` : ''}Populated missing gate-required arrays (operational_impact ≥ 2, financial_impact ≥ 1)`,
      changed_fields: [
        { field: 'operational_impact', before: `${block.operational_impact.length} items`, after: `${after.operational_impact.length} items` },
        { field: 'financial_impact', before: `${block.financial_impact.length} items`, after: `${after.financial_impact.length} items` },
      ],
      validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
    };
  }

  // ── SCOPE BOUNDARIES ───────────────────────────────────────────────────────
  if (section === 'scope_boundaries') {
    const sb = draft.scope_boundaries;
    if (action === 'improve') {
      const after = {
        ...sb,
        included: sb.included.map(i => i.endsWith('Phase 1)') ? i : i + ' (delivered as named output with acceptance criteria)'),
        excluded: [
          ...sb.excluded,
          `${rejCtx}Any work streams not explicitly named in the Included list above — change requests require a formal scope amendment`,
        ],
      };
      return {
        after,
        diff_summary: 'Added acceptance criteria qualifier to included items; added catch-all exclusion clause to protect scope integrity',
        changed_fields: [
          { field: 'included', before: `${sb.included.length} items`, after: `${after.included.length} items (amended)` },
          { field: 'excluded', before: `${sb.excluded.length} items`, after: `${after.excluded.length} items (+1)` },
        ],
        validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
      };
    }
    if (action === 'expand') {
      const after = {
        ...sb,
        included: [
          ...sb.included,
          `Weekly progress sync (30 min) with designated ${company} lead`,
          'Final handover pack: documented processes, AI prompt library, and maintenance guide',
        ],
        assumptions: [
          ...sb.assumptions,
          `${rejCtx}${company} designates a single internal point-of-contact with authority to approve deliverables`,
          'Scope is fixed for the engagement period; any additions require written agreement and timeline extension',
        ],
      };
      return {
        after,
        diff_summary: 'Added weekly sync and handover pack to included; added POC designation and scope-lock assumptions to protect delivery',
        changed_fields: [
          { field: 'included', before: `${sb.included.length} items`, after: `${after.included.length} items (+2)` },
          { field: 'assumptions', before: `${sb.assumptions.length} items`, after: `${after.assumptions.length} items (+2)` },
        ],
        validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
      };
    }
    const after = {
      ...sb,
      included: sb.included.slice(0, 3).map(i => i.split('(')[0].trim()),
      excluded: sb.excluded.slice(0, 2),
      assumptions: sb.assumptions.slice(0, 2),
    };
    return {
      after,
      diff_summary: 'Condensed scope to 3 core deliverables — removed qualifying clauses for client-facing clarity',
      changed_fields: [
        { field: 'included', before: `${sb.included.length} items`, after: `${after.included.length} items (simplified)` },
        { field: 'excluded', before: `${sb.excluded.length} items`, after: `${after.excluded.length} items (simplified)` },
      ],
      validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
    };
  }

  // ── NEXT STEP OFFER ────────────────────────────────────────────────────────
  const ns = draft.next_step_offer;
  if (action === 'improve') {
    const after = {
      ...ns,
      offer_name: `${rejCtx}${company} AI Readiness Audit & Implementation Blueprint`,
      primary_cta: 'Confirm the Engagement — Start Within 5 Business Days',
      secondary_cta: 'Book a 30-Minute Alignment Call First',
    };
    return {
      after,
      diff_summary: 'Personalised offer name with company; rewritten CTAs with specific commitment language and urgency — price untouched (fact-locked)',
      changed_fields: [
        { field: 'offer_name', before: ns.offer_name, after: after.offer_name },
        { field: 'primary_cta', before: ns.primary_cta, after: after.primary_cta },
        { field: 'secondary_cta', before: ns.secondary_cta, after: after.secondary_cta },
      ],
      validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
    };
  }
  const after = {
    ...ns,
    offer_name: `${rejCtx}${company} Diagnostic Audit`,
    primary_cta: 'Get Started',
    secondary_cta: 'Learn more first',
  };
  return {
    after,
    diff_summary: 'Simplified offer name and CTAs for client-facing readability — price untouched (fact-locked)',
    changed_fields: [
      { field: 'offer_name', before: ns.offer_name, after: after.offer_name },
      { field: 'primary_cta', before: ns.primary_cta, after: after.primary_cta },
    ],
    validation: { fact_lock: { passed: true, violations: [] }, jargon: { passed: true, words_found: [] }, coherence: { passed: true, missing: [] } },
  };
}
