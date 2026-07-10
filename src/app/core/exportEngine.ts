/**
 * EXECUTIVE EXPORT ENGINE — proposal-p2-implementation.md §2
 *
 * Formalises export.
 *
 * Rules:
 *   • Export source is ALWAYS proposal_snapshot.content_snapshot — never live blocks.
 *   • Export blocked if: roi_recalc_required | !validation_passed | contract_invalidated.
 *   • Three export document types:
 *       executive_summary   — cover + brief + diagnosis + financial + next steps
 *       full_technical      — all 8 sections in structured order
 *       contract_attachment — cover + financial + governance + signature block only
 *
 * The engine produces a structured ExportPayload (section array).
 * Rendering (HTML / PDF) is handled in ExportPanel.tsx via window.print().
 */

import type { ProposalSnapshot, SnapshotContent } from './snapshotEngine';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export type ExportDocType =
  | 'executive_summary'     // §A — boardroom-grade, shorter
  | 'full_technical'        // §B — all 8 sections, structured detail
  | 'contract_attachment';  // §C — financial + legal + signature only

export const EXPORT_DOC_LABELS: Record<ExportDocType, string> = {
  executive_summary:   'Executive Summary',
  full_technical:      'Full Technical Proposal',
  contract_attachment: 'Contract Attachment',
};

export const EXPORT_DOC_DESCRIPTIONS: Record<ExportDocType, string> = {
  executive_summary:   'Boardroom-grade summary — cover, brief, diagnosis, financials, next steps.',
  full_technical:      'Complete 8-section proposal — all detail, linked to diagnosis.',
  contract_attachment: 'Financial summary, governance, scope assumptions, and signature block only.',
};

export const EXPORT_DOC_ICONS: Record<ExportDocType, string> = {
  executive_summary:   '📊',
  full_technical:      '📋',
  contract_attachment: '✍️',
};

/** A single section of the export document. */
export interface ExportSection {
  /** Short identifier for use as anchor. */
  id:       string;
  /** Display order — 1-based. */
  order:    number;
  /** Section heading. */
  title:    string;
  /** Subtitle / description shown under heading. */
  subtitle?: string;
  /** Array of content blocks — each is a rendered HTML string or structured data. */
  content:  ExportSectionContent[];
}

export type ExportSectionContent =
  | { type: 'heading';    text: string }
  | { type: 'paragraph';  text: string }
  | { type: 'kv_row';     label: string; value: string; accent?: string }
  | { type: 'bullet';     text: string; level?: number }
  | { type: 'divider' }
  | { type: 'signature_field'; label: string; value?: string }
  | { type: 'tag_row';    tags: Array<{ label: string; color: string }> }
  | { type: 'metric_row'; metrics: Array<{ label: string; value: string; accent?: string }> };

/** The assembled export document. */
export interface ExportPayload {
  doc_type:            ExportDocType;
  proposal_snapshot_id: string;
  proposal_id:          string;
  version_number:       number;
  version_hash:         string;
  generated_at:         string;
  /** The sections, ordered for rendering. */
  sections:             ExportSection[];
}

/** Safety gate result for export. */
export interface ExportSafetyGate {
  /** Export is permitted only when blocked === false. */
  blocked:  boolean;
  /** Human-readable blockers. */
  reasons:  string[];
  /** Specific flags (for UI coloring). */
  flags: {
    roi_recalc_required:  boolean;
    validation_failed:    boolean;
    contract_invalidated: boolean;
    wrong_status:         boolean;
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// SAFETY GATE CHECK
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Checks all export safety conditions.
 *
 * @param roiRecalcRequired     From ChangeImpact.roi_recalc_required (or false if no impact).
 * @param validationPassed      From ConsistencyResult.validation_passed (or true if not yet run).
 * @param contractInvalidated   From ChangeImpact.contract_invalidated (or false).
 * @param proposalStatus        Current proposal status string.
 */
export function checkExportSafety(
  roiRecalcRequired:  boolean,
  validationPassed:   boolean,
  contractInvalidated: boolean,
  proposalStatus:     string,
): ExportSafetyGate {
  const reasons: string[] = [];

  const wrongStatus = proposalStatus !== 'ready_to_send' && proposalStatus !== 'sent';
  if (wrongStatus) {
    reasons.push(`Proposal must be in "ready_to_send" status before export. Current: "${proposalStatus}".`);
  }
  if (roiRecalcRequired) {
    reasons.push('ROI recalculation is required before export. Re-run ROI engine first.');
  }
  if (!validationPassed) {
    reasons.push('Consistency Validator has unresolved errors. Resolve all errors before export.');
  }
  if (contractInvalidated) {
    reasons.push('Contract clauses are stale due to a scope/pricing change. Revalidate contract first.');
  }

  return {
    blocked: reasons.length > 0,
    reasons,
    flags: {
      roi_recalc_required:  roiRecalcRequired,
      validation_failed:    !validationPassed,
      contract_invalidated: contractInvalidated,
      wrong_status:         wrongStatus,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION BUILDERS
// ════════════════════════════════════════════════════════════════════════════════

function fmt(n: number | undefined | null): string {
  if (n == null) return 'N/A';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtCurrency(n: number | undefined | null, currency = 'USD'): string {
  if (n == null) return 'N/A';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

// §1 Cover Page
function buildCoverSection(snap: ProposalSnapshot, c: SnapshotContent): ExportSection {
  const company = (c.executive_brief as any)?.title
    ? c.executive_brief.title
    : snap.proposal_id;
  return {
    id: 'cover', order: 1, title: 'Cover Page',
    content: [
      { type: 'heading',   text: 'MARQ CORTEX' },
      { type: 'paragraph', text: 'AI Consultancy — Proposal Document' },
      { type: 'divider' },
      { type: 'heading',   text: c.executive_brief?.title ?? 'Proposal' },
      { type: 'paragraph', text: `Prepared for: ${snap.proposal_id}` },
      { type: 'kv_row',    label: 'Date',    value: new Date(snap.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
      { type: 'kv_row',    label: 'Version', value: `v${snap.version_number}` },
      { type: 'kv_row',    label: 'Ref',     value: snap.proposal_snapshot_id },
      { type: 'kv_row',    label: 'Hash',    value: snap.version_hash },
    ],
  };
}

// §2 Executive Brief
function buildExecutiveBriefSection(c: SnapshotContent): ExportSection {
  return {
    id: 'executive_brief', order: 2, title: 'Executive Brief',
    subtitle: 'Strategic context and positioning — boardroom tone.',
    content: [
      { type: 'heading',   text: c.executive_brief?.title ?? 'Executive Brief' },
      { type: 'paragraph', text: c.executive_brief?.strategic_context ?? '' },
      { type: 'kv_row',    label: 'Why Now',               value: c.executive_brief?.why_now ?? '' },
      { type: 'kv_row',    label: 'What Success Looks Like', value: c.executive_brief?.what_success_looks_like ?? '' },
      { type: 'kv_row',    label: 'Positioning',            value: c.executive_brief?.positioning_statement ?? '' },
    ],
  };
}

// §3 Diagnosis Summary
function buildDiagnosisSection(c: SnapshotContent): ExportSection {
  const sev: Record<string, string> = {
    critical: '#FD4438', high: '#FB923C', medium: '#F59E0B', low: '#6B7280',
  };
  const content: ExportSectionContent[] = [
    { type: 'paragraph', text: `${c.diagnosis_blocks.length} confirmed bottlenecks identified across the organisation.` },
    { type: 'divider' },
  ];
  for (const dx of c.diagnosis_blocks) {
    content.push({ type: 'heading',   text: `${dx.title}` });
    content.push({ type: 'tag_row',   tags: [{ label: dx.severity.toUpperCase(), color: sev[dx.severity] ?? '#6B7280' }, { label: `Confidence ${dx.confidence}%`, color: '#06D7F6' }] });
    content.push({ type: 'paragraph', text: dx.description });
    for (const op of dx.operational_impact) {
      content.push({ type: 'bullet', text: op });
    }
    for (const fi of dx.financial_impact) {
      content.push({ type: 'bullet', text: fi, level: 2 });
    }
    content.push({ type: 'divider' });
  }
  return { id: 'diagnosis', order: 3, title: 'Diagnosis Summary', subtitle: '3–5 bottlenecks · impact narrative', content };
}

// §4 Recommended Solutions
function buildSolutionsSection(c: SnapshotContent): ExportSection {
  const content: ExportSectionContent[] = [];
  if (!c.solutions || c.solutions.length === 0) {
    content.push({ type: 'paragraph', text: 'No solution blocks available in this snapshot.' });
  } else {
    for (const sol of c.solutions) {
      const s = sol as any;
      content.push({ type: 'heading',   text: s.title ?? s.solution_id ?? 'Solution' });
      if (s.description) content.push({ type: 'paragraph', text: s.description });
      if (s.diagnosis_link) content.push({ type: 'kv_row', label: 'Linked Diagnosis', value: s.diagnosis_link });
      if (s.investment_allocation) content.push({ type: 'kv_row', label: 'Investment', value: fmtCurrency(s.investment_allocation) });
      content.push({ type: 'divider' });
    }
  }
  return { id: 'solutions', order: 4, title: 'Recommended Solutions', subtitle: 'Detailed, structured · linked to diagnosis', content };
}

// §5 Implementation Timeline
function buildTimelineSection(c: SnapshotContent): ExportSection {
  const content: ExportSectionContent[] = [];
  if (!c.implementation_phases || c.implementation_phases.length === 0) {
    content.push({ type: 'paragraph', text: 'No implementation phases available in this snapshot.' });
  } else {
    for (const phase of c.implementation_phases) {
      const p = phase as any;
      content.push({ type: 'heading', text: p.phase_name ?? p.phase_id ?? 'Phase' });
      if (p.duration) content.push({ type: 'kv_row', label: 'Duration',    value: p.duration });
      if (p.owner)    content.push({ type: 'kv_row', label: 'Owner',       value: p.owner });
      if (p.outcomes) content.push({ type: 'kv_row', label: 'Outcomes',    value: Array.isArray(p.outcomes) ? p.outcomes.join(', ') : p.outcomes });
      if (p.governance_checkpoint) content.push({ type: 'kv_row', label: 'Governance Checkpoint', value: p.governance_checkpoint, accent: '#F59E0B' });
      content.push({ type: 'divider' });
    }
  }
  return { id: 'timeline', order: 5, title: 'Implementation Timeline', subtitle: 'Phases · governance checkpoints', content };
}

// §6 Financial Summary
function buildFinancialSection(c: SnapshotContent): ExportSection {
  const fs = c.roi_snapshot as any;
  const content: ExportSectionContent[] = [];

  if (!fs) {
    content.push({ type: 'paragraph', text: 'Financial summary not available in this snapshot.' });
  } else {
    const inv    = fs.total_investment ?? fs.investment_total ?? fs.totalInvestment;
    const payback = fs.payback_months ?? fs.paybackMonths;
    const roi    = fs.roi_percent_12m ?? fs.roiPercent12Month ?? fs.roi;
    const npv    = fs.net_present_value ?? fs.netPresentValue;

    content.push({
      type: 'metric_row', metrics: [
        { label: 'Total Investment', value: fmtCurrency(inv),           accent: '#8B5CF6' },
        { label: 'Payback Period',   value: payback ? `${payback} mo`  : 'N/A', accent: '#06D7F6' },
        { label: 'ROI (12-month)',   value: roi     ? `${fmt(roi)}%`   : 'N/A', accent: '#10B981' },
        { label: 'Net Present Value',value: fmtCurrency(npv),           accent: '#F59E0B' },
      ],
    });
    content.push({ type: 'divider' });
    content.push({ type: 'paragraph', text: '⚠ Risk note: All figures are projections based on diagnostic data. Conservative scenario used.' });
  }
  return { id: 'financial', order: 6, title: 'Financial Summary', subtitle: 'Investment · payback period · conservative ROI · risk note', content };
}

// §7 Governance & Assumptions
function buildGovernanceSection(c: SnapshotContent): ExportSection {
  const content: ExportSectionContent[] = [
    { type: 'heading',   text: 'Human-in-Loop Commitment' },
    { type: 'paragraph', text: 'MARQ Cortex operates under a strict human-in-loop governance model. All AI-generated recommendations are reviewed and approved by a senior strategist before client delivery. No automated decisions affect client systems without explicit human sign-off.' },
    { type: 'divider' },
    { type: 'heading',   text: 'Data Handling' },
    { type: 'paragraph', text: 'All diagnostic data is processed under SOC 2 Type II controls. Data is not shared with third-party AI providers beyond the agreed engagement scope. Client data is purged 90 days post-engagement unless retained under a separate data agreement.' },
    { type: 'divider' },
    { type: 'heading',   text: 'Scope Boundaries' },
    { type: 'bullet',    text: 'Included:' },
  ];
  for (const item of (c.scope_boundaries?.included ?? [])) {
    content.push({ type: 'bullet', text: item, level: 2 });
  }
  content.push({ type: 'bullet', text: 'Excluded:' });
  for (const item of (c.scope_boundaries?.excluded ?? [])) {
    content.push({ type: 'bullet', text: item, level: 2 });
  }
  content.push({ type: 'bullet', text: 'Assumptions:' });
  for (const item of (c.scope_boundaries?.assumptions ?? [])) {
    content.push({ type: 'bullet', text: item, level: 2 });
  }
  return { id: 'governance', order: 7, title: 'Governance & Assumptions', subtitle: 'Human-in-loop · data handling · scope boundaries', content };
}

// §8 Next Steps + Signature Block
function buildNextStepsSection(c: SnapshotContent, snap: ProposalSnapshot): ExportSection {
  const ns = c.next_step_offer as any;
  const price = ns?.price ? new Intl.NumberFormat('en-US', { style: 'currency', currency: ns.currency ?? 'USD', maximumFractionDigits: 0 }).format(ns.price) : 'N/A';
  return {
    id: 'next_steps', order: 8, title: 'Next Steps', subtitle: 'Acceptance process · signature block',
    content: [
      { type: 'heading',   text: ns?.offer_name ?? 'Engagement Offer' },
      { type: 'kv_row',    label: 'Investment',  value: price,             accent: '#10B981' },
      { type: 'kv_row',    label: 'Duration',    value: ns?.duration ?? 'N/A' },
      { type: 'kv_row',    label: 'Primary CTA', value: ns?.primary_cta   ?? 'N/A', accent: '#06D7F6' },
      { type: 'kv_row',    label: 'Secondary CTA', value: ns?.secondary_cta ?? 'N/A' },
      { type: 'divider' },
      { type: 'heading',   text: 'Acceptance' },
      { type: 'paragraph', text: 'To accept this proposal, please complete the signature block below. Return a signed copy to your MARQ Cortex engagement manager to initiate onboarding.' },
      { type: 'divider' },
      { type: 'heading',   text: 'Signature Block' },
      { type: 'signature_field', label: 'Client Name' },
      { type: 'signature_field', label: 'Authorized Signatory' },
      { type: 'signature_field', label: 'Title / Position' },
      { type: 'signature_field', label: 'Date' },
      { type: 'signature_field', label: 'Signature' },
      { type: 'divider' },
      { type: 'kv_row', label: 'Proposal Reference', value: snap.proposal_snapshot_id },
      { type: 'kv_row', label: 'Version Hash',       value: snap.version_hash },
    ],
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// SECTION SELECTION BY DOC TYPE
// ════════════════════════════════════════════════════════════════════════════════

const SECTION_BUILDERS: Record<
  ExportDocType,
  Array<(c: SnapshotContent, snap: ProposalSnapshot) => ExportSection>
> = {
  executive_summary: [
    (c, s) => buildCoverSection(s, c),
    (c)    => buildExecutiveBriefSection(c),
    (c)    => buildDiagnosisSection(c),
    (c)    => buildFinancialSection(c),
    (c, s) => buildNextStepsSection(c, s),
  ],
  full_technical: [
    (c, s) => buildCoverSection(s, c),
    (c)    => buildExecutiveBriefSection(c),
    (c)    => buildDiagnosisSection(c),
    (c)    => buildSolutionsSection(c),
    (c)    => buildTimelineSection(c),
    (c)    => buildFinancialSection(c),
    (c)    => buildGovernanceSection(c),
    (c, s) => buildNextStepsSection(c, s),
  ],
  contract_attachment: [
    (c, s) => buildCoverSection(s, c),
    (c)    => buildFinancialSection(c),
    (c)    => buildGovernanceSection(c),
    (c, s) => buildNextStepsSection(c, s),
  ],
};

// ════════════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION — assembleExportPayload
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Assembles a structured ExportPayload from a frozen ProposalSnapshot.
 *
 * Source is ALWAYS the snapshot — never the live proposal.
 */
export function assembleExportPayload(
  snapshot: ProposalSnapshot,
  docType:  ExportDocType,
): ExportPayload {
  const builders  = SECTION_BUILDERS[docType];
  const sections  = builders.map(fn => fn(snapshot.content_snapshot, snapshot));

  // Re-number sections in output order
  sections.forEach((s, i) => { s.order = i + 1; });

  return {
    doc_type:             docType,
    proposal_snapshot_id: snapshot.proposal_snapshot_id,
    proposal_id:          snapshot.proposal_id,
    version_number:       snapshot.version_number,
    version_hash:         snapshot.version_hash,
    generated_at:         new Date().toISOString(),
    sections,
  };
}
