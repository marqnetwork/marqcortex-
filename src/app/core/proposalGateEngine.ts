/**
 * PROPOSAL GATE ENGINE — Phase 1 Ready Gate
 *
 * Rule source: ready-gate-rules.md + phase1-gate-criteria.md + phase1-gate-requirements.md
 *
 * Governance principle: Math decides gate eligibility. No LLM. Deterministic.
 *
 * Two validation layers:
 *   Layer 1 — Structural (field-level):  ready-gate-rules.md
 *   Layer 2 — Boardroom-grade (semantic): phase1-gate-criteria.md / phase1-gate-requirements.md
 *
 * Returns a GateResult object. If passed: status → internal_review.
 * Gate output shape matches the spec: { gate, passed, missing: [{ path, reason }] }
 */

import type { ProposalDraft } from '@/app/types/cortex-types';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export type GateSection =
  | 'linkage'
  | 'executive_brief'
  | 'diagnosis_blocks'
  | 'scope_boundaries'
  | 'next_step_offer'
  | 'solutions'
  | 'implementation_phases'
  | 'financial_summary'
  | 'implementation_plan';

export interface GateMissing {
  path: string;
  reason: string;
  /** Which validation layer caught this */
  layer: 'structural' | 'boardroom';
  section: GateSection;
}

export interface GateResult {
  gate: 'phase1_internal_review' | 'phase2_financial_binding' | 'phase3_approved' | 'phase4_sent' | 'phase5_export_ready';
  passed: boolean;
  missing: GateMissing[];
  checks_total: number;
  checks_passed: number;
  /** Only set when passed === true */
  validation_timestamp: string;
  /** SHA-like fingerprint of editable content at validation time */
  version_hash: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// CONSTANTS — boardroom semantic rules
// ════════════════════════════════════════════════════════════════════════════════

/** Phrases that signal vague / non-quantified language. Boardroom rule: reject. */
const VAGUE_PHRASES = [
  'improve efficiency',
  'increase productivity',
  'better performance',
  'more effective',
  'enhance processes',
  'optimize workflow',
  'streamline operations',
  'improve operations',
];

/** Excluded scope must block legal/medical/financial advisory */
const LEGAL_BLOCK_RE = /legal|medical|financial adv|advisory/i;

/** Excluded scope must block full autonomy AI claims */
const AUTONOMY_BLOCK_RE = /autonom|fully automat/i;

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Count clauses/sentences that contain at least one numeric token.
 * Spec: "at least 2 quantified statements (numbers, not adjectives)"
 */
function countQuantifiedStatements(text: string): number {
  const clauses = text.split(/[.!?,;]+/).filter(s => s.trim().length > 0);
  return clauses.filter(c => /\d/.test(c)).length;
}

/**
 * Deterministic content fingerprint for audit log.
 * Uses djb2-style hash over editable sections only.
 */
function contentHash(draft: ProposalDraft): string {
  const payload = JSON.stringify({
    eb: draft.executive_brief,
    dx: draft.diagnosis_blocks,
    sc: draft.scope_boundaries,
    offer: draft.next_step_offer,
    v: draft.metadata.version,
  });
  let h = 5381;
  for (let i = 0; i < payload.length; i++) {
    h = ((h << 5) + h) ^ payload.charCodeAt(i);
    h = h >>> 0; // convert to unsigned 32-bit
  }
  return h.toString(16).padStart(8, '0');
}

// ════════════════════════════════════════════════════════════════════════════════
// GATE ENGINE
// ════════════════════════════════════════════════════════════════════════════════

/**
 * runReadyGate
 *
 * Evaluates a ProposalDraft against all Phase 1 gate criteria.
 * Pure function — no side effects, no network calls.
 *
 * @param draft  The current ProposalDraft payload
 * @returns      GateResult with full missing list and pass/fail flag
 */
export function runReadyGate(draft: ProposalDraft): GateResult {
  const missing: GateMissing[] = [];
  let checks_total = 0;

  function check(
    condition: boolean,
    path: string,
    reason: string,
    section: GateSection,
    layer: GateMissing['layer'] = 'structural',
  ): void {
    checks_total++;
    if (!condition) {
      missing.push({ path, reason, section, layer });
    }
  }

  const eb     = draft.executive_brief;
  const blocks = draft.diagnosis_blocks;
  const scope  = draft.scope_boundaries;
  const offer  = draft.next_step_offer;

  // ── §1 LINKAGE ──────────────────────────────────────────────────────────────
  // Layer: structural

  check(
    !!draft.linkage.diagnostic_id.trim(),
    'linkage.diagnostic_id',
    'Diagnostic ID is required',
    'linkage',
  );
  check(
    !!draft.linkage.portfolio_version_id.trim(),
    'linkage.portfolio_version_id',
    'Portfolio version ID is required',
    'linkage',
  );

  // ── §2 EXECUTIVE BRIEF — structural ─────────────────────────────────────────

  check(
    !!eb.title.trim(),
    'executive_brief.title',
    'Title is required',
    'executive_brief',
  );
  check(
    eb.strategic_context.length >= 300,
    'executive_brief.strategic_context',
    `Min 300 characters — currently ${eb.strategic_context.length}`,
    'executive_brief',
  );
  check(
    eb.why_now.length >= 200,
    'executive_brief.why_now',
    `Min 200 characters — currently ${eb.why_now.length}`,
    'executive_brief',
  );
  check(
    eb.what_success_looks_like.length >= 200,
    'executive_brief.what_success_looks_like',
    `Min 200 characters — currently ${eb.what_success_looks_like.length}`,
    'executive_brief',
  );

  // ── §2 EXECUTIVE BRIEF — boardroom-grade (phase1-gate-criteria.md §1) ───────

  const allBriefText = [
    eb.title,
    eb.strategic_context,
    eb.why_now,
    eb.what_success_looks_like,
    eb.positioning_statement,
  ].join(' ');

  // Rule: ≥ 600 words total across the brief
  const wc = wordCount(allBriefText);
  check(
    wc >= 600,
    'executive_brief',
    `Min 600 words across full brief — currently ${wc} words`,
    'executive_brief',
    'boardroom',
  );

  // Rule: at least 2 quantified statements (numbers, not adjectives)
  const quantifiedCount = countQuantifiedStatements(allBriefText);
  check(
    quantifiedCount >= 2,
    'executive_brief',
    `Min 2 quantified statements with numbers/metrics — found ${quantifiedCount}`,
    'executive_brief',
    'boardroom',
  );

  // Rule: no vague language ("improve efficiency" etc.)
  const briefLower = allBriefText.toLowerCase();
  const foundVague = VAGUE_PHRASES.find(p => briefLower.includes(p));
  check(
    foundVague === undefined,
    'executive_brief',
    foundVague
      ? `Vague language detected: "${foundVague}" — replace with specific metrics`
      : '',
    'executive_brief',
    'boardroom',
  );

  // ── §3 DIAGNOSIS BLOCKS — structural ────────────────────────────────────────

  check(
    blocks.length >= 3,
    'diagnosis_blocks',
    `Min 3 diagnosis blocks required — currently ${blocks.length}`,
    'diagnosis_blocks',
  );

  blocks.forEach((b, i) => {
    // Title
    check(
      b.title.trim().length >= 8,
      `diagnosis_blocks[${i}].title`,
      `Min 8 characters — currently ${b.title.trim().length}`,
      'diagnosis_blocks',
    );

    // Description
    check(
      b.description.length >= 200,
      `diagnosis_blocks[${i}].description`,
      `Min 200 characters — currently ${b.description.length}`,
      'diagnosis_blocks',
    );

    // Operational impact
    check(
      b.operational_impact.length >= 2,
      `diagnosis_blocks[${i}].operational_impact`,
      `Min 2 items — currently ${b.operational_impact.length}`,
      'diagnosis_blocks',
    );
    b.operational_impact.forEach((item, j) => {
      check(
        item.length >= 30,
        `diagnosis_blocks[${i}].operational_impact[${j}]`,
        `Min 30 characters — currently ${item.length}`,
        'diagnosis_blocks',
      );
    });

    // Financial impact
    check(
      b.financial_impact.length >= 2,
      `diagnosis_blocks[${i}].financial_impact`,
      `Min 2 items — currently ${b.financial_impact.length}`,
      'diagnosis_blocks',
    );
    b.financial_impact.forEach((item, j) => {
      check(
        item.length >= 30,
        `diagnosis_blocks[${i}].financial_impact[${j}]`,
        `Min 30 characters — currently ${item.length}`,
        'diagnosis_blocks',
      );
    });

    // Evidence
    check(
      b.evidence.length >= 1,
      `diagnosis_blocks[${i}].evidence`,
      'At least 1 evidence item with valid source and ref is required',
      'diagnosis_blocks',
    );
    b.evidence.forEach((ev, j) => {
      check(
        !!ev.source && !!ev.ref.trim(),
        `diagnosis_blocks[${i}].evidence[${j}]`,
        'Evidence must have a valid source and a non-empty ref',
        'diagnosis_blocks',
      );
    });

    // Boardroom: confidence ≥ 70 (phase1-gate-criteria.md §2)
    check(
      b.confidence >= 70,
      `diagnosis_blocks[${i}].confidence`,
      `Min 70 confidence required — currently ${b.confidence}`,
      'diagnosis_blocks',
      'boardroom',
    );
  });

  // Boardroom: at least 1 high/critical (phase1-gate-criteria.md §2)
  check(
    blocks.some(b => b.severity === 'high' || b.severity === 'critical'),
    'diagnosis_blocks',
    'At least 1 diagnosis must be classified as High or Critical severity',
    'diagnosis_blocks',
    'boardroom',
  );

  // ── §4 SCOPE BOUNDARIES — structural ────────────────────────────────────────

  check(
    scope.included.length >= 3,
    'scope_boundaries.included',
    `Min 3 included items — currently ${scope.included.length}`,
    'scope_boundaries',
  );
  check(
    scope.excluded.length >= 2,
    'scope_boundaries.excluded',
    `Min 2 excluded items — currently ${scope.excluded.length}`,
    'scope_boundaries',
  );
  check(
    scope.assumptions.length >= 2,
    'scope_boundaries.assumptions',
    `Min 2 assumption items — currently ${scope.assumptions.length}`,
    'scope_boundaries',
  );

  // Boardroom: scope governance (phase1-gate-criteria.md §4)
  const excludedText = scope.excluded.join(' ');
  check(
    LEGAL_BLOCK_RE.test(excludedText),
    'scope_boundaries.excluded',
    'Excluded scope must explicitly block legal / medical / financial advisory services',
    'scope_boundaries',
    'boardroom',
  );
  check(
    AUTONOMY_BLOCK_RE.test(excludedText),
    'scope_boundaries.excluded',
    'Excluded scope must explicitly block fully autonomous AI decision-making',
    'scope_boundaries',
    'boardroom',
  );

  // ── §5 NEXT STEP OFFER ───────────────────────────────────────────────────────

  check(
    !!offer.offer_name.trim(),
    'next_step_offer.offer_name',
    'Offer name is required',
    'next_step_offer',
  );
  check(
    offer.price > 0,
    'next_step_offer.price',
    'Price must be greater than 0',
    'next_step_offer',
  );
  check(
    !!offer.duration.trim(),
    'next_step_offer.duration',
    'Duration is required',
    'next_step_offer',
  );
  check(
    !!offer.primary_cta.trim(),
    'next_step_offer.primary_cta',
    'Primary CTA is required',
    'next_step_offer',
  );

  // ── §6 STRATEGIC COHERENCE (phase1-gate-criteria.md §6) ─────────────────────
  // Brief must reference at least one keyword from confirmed diagnosis titles.

  if (blocks.length >= 1) {
    const diagKeywords = blocks.flatMap(b =>
      b.title.toLowerCase().split(/\s+/).filter(w => w.length > 4),
    );
    check(
      diagKeywords.some(kw => briefLower.includes(kw)),
      'executive_brief',
      'Executive brief must reference at least one theme from confirmed diagnosis titles (strategic coherence)',
      'executive_brief',
      'boardroom',
    );
  }

  // ── §7 SOLUTION BINDING — Phase 1 guard (when solutions already defined) ─────
  // If solutions have been authored, every diagnosis must be linked.
  // (Full enforcement is Phase 2 gate; this is an early-warning check.)
  const solutions = draft.solutions ?? [];
  if (solutions.length > 0) {
    const linkedDxIds = new Set(solutions.flatMap(s => s.linked_diagnosis_ids));
    blocks.forEach((b, i) => {
      check(
        linkedDxIds.has(b.diagnosis_id),
        `solutions`,
        `Diagnosis "${b.title || b.diagnosis_id}" (${b.diagnosis_id}) has no mapped solution`,
        'solutions',
        'structural',
      );
    });
  }

  // ── RESULT ───────────────────────────────────────────────────────────────────

  const passed = missing.length === 0;

  return {
    gate:                 'phase1_internal_review',
    passed,
    missing,
    checks_total,
    checks_passed:        checks_total - missing.length,
    validation_timestamp: passed ? new Date().toISOString() : '',
    version_hash:         passed ? contentHash(draft) : '',
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION METADATA (for UI grouping)
// ════════════════════════════════════════════════════════════════════════════════

export const GATE_SECTION_LABELS: Record<GateSection, string> = {
  linkage:               'Linkage',
  executive_brief:       'Executive Brief',
  diagnosis_blocks:      'Confirmed Diagnosis',
  scope_boundaries:      'Scope Boundaries',
  next_step_offer:       'Next Step Offer',
  solutions:             'Solution Architecture',
  implementation_phases: 'Implementation Phases',
  financial_summary:     'Financial Summary',
  implementation_plan:   'Implementation Architecture',
};

export const GATE_SECTION_ORDER: GateSection[] = [
  'linkage',
  'executive_brief',
  'diagnosis_blocks',
  'scope_boundaries',
  'next_step_offer',
  'solutions',
  'implementation_phases',
  'financial_summary',
  'implementation_plan',
];

// ════════════════════════════════════════════════════════════════════════════════
// PHASE 2 READY GATE — Financial Binding
//
// Rule source: solution-architecture-binding.md §5
// Proposal cannot move to Financial Binding unless all 5 conditions pass.
// ════════════════════════════════════════════════════════════════════════════════

export function runPhase2Gate(draft: ProposalDraft): GateResult {
  const missing: GateMissing[] = [];
  let checks_total = 0;

  function check(
    condition: boolean,
    path: string,
    reason: string,
    section: GateSection,
    layer: GateMissing['layer'] = 'structural',
  ): void {
    checks_total++;
    if (!condition) {
      missing.push({ path, reason, section, layer });
    }
  }

  const solutions = draft.solutions ?? [];
  const phases    = draft.implementation_phases ?? [];
  const blocks    = draft.diagnosis_blocks;

  // ── Condition 1: At least 2 solutions ─────────────────────────────────────
  check(
    solutions.length >= 2,
    'solutions',
    `Min 2 solutions required — currently ${solutions.length}`,
    'solutions',
  );

  // ── Condition 2: All diagnoses mapped ─────────────────────────────────────
  const linkedDxIds = new Set(solutions.flatMap(s => s.linked_diagnosis_ids));
  blocks.forEach((b) => {
    check(
      linkedDxIds.has(b.diagnosis_id),
      'solutions',
      `Diagnosis "${b.title || b.diagnosis_id}" (${b.diagnosis_id}) is not linked to any solution`,
      'solutions',
    );
  });

  // ── Condition 3: Per-solution validation ──────────────────────────────────
  solutions.forEach((s, i) => {
    const fl = s.financial_levers;

    // At least one financial lever > 0
    check(
      fl.efficiency_gain > 0 || fl.revenue_uplift > 0 || fl.cost_reduction > 0 || fl.risk_mitigation > 0,
      `solutions[${i}].financial_levers`,
      `Solution "${s.title || s.solution_id}" must define at least one financial lever > 0`,
      'solutions',
    );

    // At least one system affected
    check(
      s.implementation_scope.systems_affected.length >= 1,
      `solutions[${i}].implementation_scope.systems_affected`,
      `Solution "${s.title || s.solution_id}" must list at least one system affected`,
      'solutions',
    );

    // complexity_score 1–5
    check(
      s.complexity_score >= 1 && s.complexity_score <= 5,
      `solutions[${i}].complexity_score`,
      `Complexity score must be 1–5 — currently ${s.complexity_score}`,
      'solutions',
    );

    // confidence_score 0–100
    check(
      s.confidence_score >= 0 && s.confidence_score <= 100,
      `solutions[${i}].confidence_score`,
      `Confidence score must be 0–100 — currently ${s.confidence_score}`,
      'solutions',
    );
  });

  // ── Condition 4: Every solution assigned to a phase ───────────────────────
  const phaseSolutionIds = new Set(phases.flatMap(p => p.solution_ids));
  solutions.forEach((s, i) => {
    check(
      phaseSolutionIds.has(s.solution_id),
      'implementation_phases',
      `Solution "${s.title || s.solution_id}" (${s.solution_id}) is not assigned to any implementation phase`,
      'implementation_phases',
    );
  });

  // ── Condition 5: Average confidence_score ≥ 70 ───────────────────────────
  if (solutions.length > 0) {
    const avgConf = solutions.reduce((sum, s) => sum + s.confidence_score, 0) / solutions.length;
    check(
      avgConf >= 70,
      'solutions',
      `Average solution confidence must be ≥ 70 — currently ${avgConf.toFixed(1)}`,
      'solutions',
      'boardroom',
    );
  }

  // ── RESULT ────────────────────────────────────────────────────────────────
  const passed = missing.length === 0;

  return {
    gate:                 'phase2_financial_binding',
    passed,
    missing,
    checks_total,
    checks_passed:        checks_total - missing.length,
    validation_timestamp: passed ? new Date().toISOString() : '',
    version_hash:         passed ? contentHash(draft) : '',
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE 3 READY GATE — Proposal Approval
//
// Rule source: financial-summary-binding-1.md §5
// Proposal cannot advance to Approved unless all financial conditions pass.
// ════════════════════════════════════════════════════════════════════════════════

export function runPhase3Gate(draft: ProposalDraft): GateResult {
  const missing: GateMissing[] = [];
  let checks_total = 0;

  function check(
    condition: boolean,
    path: string,
    reason: string,
    section: GateSection,
    layer: GateMissing['layer'] = 'structural',
  ): void {
    checks_total++;
    if (!condition) missing.push({ path, reason, section, layer });
  }

  const fs       = draft.financial_summary;
  const solutions = draft.solutions ?? [];

  // ── 1. Financial summary populated ────────────────────────────────────────
  check(
    !!fs,
    'financial_summary',
    'Financial summary must be populated from ROI engine before proposal can advance to Approved',
    'financial_summary',
  );

  if (fs) {
    // ── 2. Portfolio version match (Validation 1) ──────────────────────────
    check(
      fs.portfolio_version_id === draft.linkage.portfolio_version_id,
      'financial_summary.portfolio_version_id',
      `Portfolio version mismatch — summary is "${fs.portfolio_version_id}" but linkage is "${draft.linkage.portfolio_version_id}". ROI recalculation required.`,
      'financial_summary',
      'boardroom',
    );

    // ── 3. Dependency validation passed (Validation 2) ────────────────────
    check(
      fs.dependency_validated === true,
      'financial_summary.dependency_validated',
      'Dependency validation must pass — overlapping gain detection required',
      'financial_summary',
    );

    // ── 4. Confidence threshold ≥ 70 (Validation 3) ───────────────────────
    check(
      fs.confidence_score >= 70,
      'financial_summary.confidence_score',
      `Financial confidence score must be ≥ 70 — currently ${fs.confidence_score}`,
      'financial_summary',
      'boardroom',
    );

    // ── 5. Realization factor applied (Validation 4) ──────────────────────
    check(
      fs.realization_factor_applied === true,
      'financial_summary.realization_factor_applied',
      'Realization factor must be applied — no 100% efficiency assumption allowed without explicit flag',
      'financial_summary',
    );

    // ── 6. Investment & ROI populated ─────────────────────────────────────
    check(
      fs.investment_total > 0,
      'financial_summary.investment_total',
      'Investment total must be > 0',
      'financial_summary',
    );
    check(
      fs.roi_percentage > 0,
      'financial_summary.roi_percentage',
      'ROI percentage must be > 0',
      'financial_summary',
    );
    check(
      fs.annual_gain_conf_weighted > 0,
      'financial_summary.annual_gain_conf_weighted',
      'Annual gain (confidence-weighted) must be > 0',
      'financial_summary',
    );
  }

  // ── 7. All solutions financially bound ────────────────────────────────────
  solutions.forEach((s, i) => {
    check(
      !!s.financial_binding,
      `solutions[${i}].financial_binding`,
      `Solution "${s.title || s.solution_id}" has no financial binding — ROI allocation required`,
      'financial_summary',
    );
    if (s.financial_binding) {
      check(
        s.financial_binding.investment_allocated > 0,
        `solutions[${i}].financial_binding.investment_allocated`,
        `Solution "${s.title || s.solution_id}" has zero investment allocated`,
        'financial_summary',
      );
      check(
        s.financial_binding.annual_gain > 0,
        `solutions[${i}].financial_binding.annual_gain`,
        `Solution "${s.title || s.solution_id}" has zero annual gain — financial model incomplete`,
        'financial_summary',
      );
    }
  });

  // ── RESULT ────────────────────────────────────────────────────────────────
  const passed = missing.length === 0;

  return {
    gate:                 'phase3_approved',
    passed,
    missing,
    checks_total,
    checks_passed:        checks_total - missing.length,
    validation_timestamp: passed ? new Date().toISOString() : '',
    version_hash:         passed ? contentHash(draft) : '',
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE 4 READY GATE — Final Export
//
// Rule source: implementation-architecture.md §5
// Proposal cannot be exported unless all implementation conditions pass.
// ════════════════════════════════════════════════════════════════════════════════

export function runPhase4Gate(draft: ProposalDraft): GateResult {
  const missing: GateMissing[] = [];
  let checks_total = 0;

  function check(
    condition: boolean,
    path: string,
    reason: string,
    section: GateSection,
    layer: GateMissing['layer'] = 'structural',
  ): void {
    checks_total++;
    if (!condition) missing.push({ path, reason, section, layer });
  }

  const plan      = draft.implementation_plan;
  const solutions = draft.solutions ?? [];

  // ── 1. Implementation plan populated ──────────────────────────────────────
  check(
    !!plan,
    'implementation_plan',
    'Implementation plan must be populated before proposal can be exported',
    'implementation_plan',
  );

  if (plan) {
    const phases = plan.phases ?? [];

    // ── 2. At least one phase defined ─────────────────────────────────────
    check(
      phases.length >= 1,
      'implementation_plan.phases',
      'At least one implementation phase is required',
      'implementation_plan',
    );

    // ── 3. Every solution assigned to at least one phase ──────────────────
    const assignedSolutionIds = new Set(phases.flatMap(p => p.solution_ids));
    solutions.forEach(s => {
      check(
        assignedSolutionIds.has(s.solution_id),
        `implementation_plan.phases`,
        `Solution "${s.title || s.solution_id}" is not assigned to any implementation phase`,
        'implementation_plan',
      );
    });

    // ── 4. Per-phase validation ────────────────────────────────────────────
    phases.forEach((phase, i) => {
      const label = `Phase ${phase.phase_number} "${phase.title}"`;

      // Must have ≥ 2 milestones
      check(
        (phase.milestones ?? []).length >= 2,
        `implementation_plan.phases[${i}].milestones`,
        `${label} must have at least 2 milestones — currently ${(phase.milestones ?? []).length}`,
        'implementation_plan',
      );

      // Each milestone must have owner and ≥ 1 deliverable
      (phase.milestones ?? []).forEach((m, mi) => {
        check(
          !!m.owner?.trim(),
          `implementation_plan.phases[${i}].milestones[${mi}].owner`,
          `Milestone "${m.title}" in ${label} has no assigned owner`,
          'implementation_plan',
        );
        check(
          (m.deliverables ?? []).length >= 1,
          `implementation_plan.phases[${i}].milestones[${mi}].deliverables`,
          `Milestone "${m.title}" in ${label} must define at least 1 deliverable`,
          'implementation_plan',
        );
      });

      // Must have ≥ 1 governance checkpoint
      check(
        (phase.governance_checkpoints ?? []).length >= 1,
        `implementation_plan.phases[${i}].governance_checkpoints`,
        `${label} must have at least 1 governance checkpoint`,
        'implementation_plan',
      );

      // Phase must have a duration
      check(
        (phase.duration_weeks ?? 0) > 0,
        `implementation_plan.phases[${i}].duration_weeks`,
        `${label} must specify a duration > 0 weeks`,
        'implementation_plan',
      );
    });

    // ── 5. Team structure ──────────────────────────────────────────────────
    check(
      (plan.team_structure?.cortex_team ?? []).length >= 1,
      'implementation_plan.team_structure.cortex_team',
      'At least 1 Cortex team member must be defined',
      'implementation_plan',
    );
    check(
      (plan.team_structure?.client_team_required ?? []).length >= 1,
      'implementation_plan.team_structure.client_team_required',
      'At least 1 client team member must be defined',
      'implementation_plan',
    );

    // ── 6. Integration architecture completeness ───────────────────────────
    const ia = plan.integration_architecture;
    const iaChecks: [keyof typeof ia, string][] = [
      ['systems_affected',      'Systems Affected'],
      ['data_sources',          'Data Sources'],
      ['automation_tools',      'Automation Tools'],
      ['ai_models_used',        'AI Models'],
      ['security_considerations','Security Considerations'],
    ];
    iaChecks.forEach(([key, label]) => {
      check(
        (ia?.[key] ?? []).length >= 1,
        `implementation_plan.integration_architecture.${key}`,
        `Integration architecture must define at least 1 item for "${label}"`,
        'implementation_plan',
        'boardroom',
      );
    });

    // ── 7. Governance controls all active ─────────────────────────────────
    const gc = plan.governance_controls;
    if (gc) {
      check(gc.human_in_loop,                    'implementation_plan.governance_controls.human_in_loop',                    'Human-in-loop control must be enabled', 'implementation_plan', 'boardroom');
      check(gc.approval_required_for_automation, 'implementation_plan.governance_controls.approval_required_for_automation', 'Approval required for automation must be enabled', 'implementation_plan', 'boardroom');
      check(gc.quarterly_review,                 'implementation_plan.governance_controls.quarterly_review',                 'Quarterly review must be scheduled', 'implementation_plan', 'boardroom');
      check(gc.roi_revalidation_required,        'implementation_plan.governance_controls.roi_revalidation_required',        'ROI revalidation requirement must be enabled', 'implementation_plan', 'boardroom');
    } else {
      check(false, 'implementation_plan.governance_controls', 'Governance controls must be defined', 'implementation_plan');
    }
  }

  // ── RESULT ────────────────────────────────────────────────────────────────
  const passed = missing.length === 0;

  return {
    gate:                 'phase4_sent',
    passed,
    missing,
    checks_total,
    checks_passed:        checks_total - missing.length,
    validation_timestamp: passed ? new Date().toISOString() : '',
    version_hash:         passed ? contentHash(draft) : '',
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE 5 EXPORT GATE — Proposal Integrity Lock
//
// Rule source: proposal-control-export.md §5
// Export is blocked unless all 4 prior gates pass AND no pending ROI recalculation.
// ════════════════════════════════════════════════════════════════════════════════

export function runPhase5Gate(draft: ProposalDraft): GateResult {
  const missing: GateMissing[] = [];
  let checks_total = 0;

  function check(
    condition: boolean,
    path: string,
    reason: string,
    section: GateSection,
    layer: GateMissing['layer'] = 'structural',
  ): void {
    checks_total++;
    if (!condition) missing.push({ path, reason, section, layer });
  }

  // ── Run all 4 upstream gates and verify they pass ────────────────────────
  const phase1 = runReadyGate(draft);
  const phase2 = runPhase2Gate(draft);
  const phase3 = runPhase3Gate(draft);
  const phase4 = runPhase4Gate(draft);

  check(
    phase1.passed,
    'gates.phase1',
    `Phase 1 Ready Gate not passed — ${phase1.missing.length} blocker(s) remain. Executive Brief, Diagnosis, and Scope must be validated.`,
    'linkage',
    'boardroom',
  );
  check(
    phase2.passed,
    'gates.phase2',
    `Phase 2 Solution Binding not passed — ${phase2.missing.length} blocker(s) remain. All diagnoses must be mapped to solutions with financial levers.`,
    'solutions',
    'boardroom',
  );
  check(
    phase3.passed,
    'gates.phase3',
    `Phase 3 ROI Binding not passed — ${phase3.missing.length} blocker(s) remain. Financial summary must be validated with confidence ≥ 70.`,
    'financial_summary',
    'boardroom',
  );
  check(
    phase4.passed,
    'gates.phase4',
    `Phase 4 Implementation Architecture not passed — ${phase4.missing.length} blocker(s) remain. All phases, milestones, and governance must be defined.`,
    'implementation_plan',
    'boardroom',
  );

  // ── No pending ROI recalculation ─────────────────────────────────────────
  const fs = draft.financial_summary;
  if (fs) {
    check(
      fs.portfolio_version_id === draft.linkage.portfolio_version_id,
      'financial_summary.portfolio_version_id',
      `Pending ROI recalculation detected — summary version "${fs.portfolio_version_id}" does not match portfolio "${draft.linkage.portfolio_version_id}". Recalculate before export.`,
      'financial_summary',
      'boardroom',
    );
  }

  // ── Status must be ready_to_send ─────────────────────────────────────────
  check(
    draft.status === 'ready_to_send',
    'proposal_state.status',
    `Proposal must be in "ready_to_send" status before export — currently "${draft.status}". Complete all gates and advance status.`,
    'linkage',
    'structural',
  );

  const passed = missing.length === 0;

  return {
    gate:                 'phase5_export_ready',
    passed,
    missing,
    checks_total,
    checks_passed:        checks_total - missing.length,
    validation_timestamp: passed ? new Date().toISOString() : '',
    version_hash:         passed ? contentHash(draft) : '',
  };
}