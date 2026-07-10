/**
 * PROPOSAL EXPORT UTILITY — 13D
 *
 * Generates a self-contained, print-ready HTML document from a proposal object
 * and its annotations.  Opens in a new browser tab and auto-fires window.print()
 * so the user can immediately save as PDF.
 *
 * Features:
 *  • All sections fully expanded (no accordion state)
 *  • Annotated text wrapped in <mark> with a superscript [N] reference
 *  • Reference numbers assigned in document order (top → bottom)
 *  • Annotation Index appended after the last section — numbered list showing
 *    author, section chip, date, highlighted quote, and comment
 *  • MARQ Cortex colour palette preserved in section headers and mark tints
 *  • @media print rules collapse the "Print / Close" toolbar
 *  • Page margins, auto page-break-inside:avoid, and footer via @page
 */

import type { ProposalAnnotation } from '@/app/services/dataService';

// ── Section key order — matches the document reading order ───────────────────

const SECTION_KEY_ORDER = [
  'summary', 'diagnosis', 'service',
  'deliverables', 'timeline', 'investment', 'general',
];

// ── Annotation colour: hex → print-friendly pastel tints ─────────────────────

const PRINT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  '#FBBF24': { bg: '#FFFBEB', border: '#D97706', text: '#92400E' },  // amber
  '#34D399': { bg: '#ECFDF5', border: '#059669', text: '#065F46' },  // green
  '#60A5FA': { bg: '#EFF6FF', border: '#2563EB', text: '#1E40AF' },  // blue
  '#A78BFA': { bg: '#F5F3FF', border: '#7C3AED', text: '#5B21B6' },  // violet
  '#F87171': { bg: '#FEF2F2', border: '#DC2626', text: '#991B1B' },  // red
  '#FB923C': { bg: '#FFF7ED', border: '#EA580C', text: '#9A3412' },  // orange
};

function annotColor(hex: string) {
  return PRINT_COLORS[hex] ?? PRINT_COLORS['#FBBF24'];
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch {
    return iso ?? '';
  }
}

function fmtDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso ?? '';
  }
}

function initials(name: string): string {
  return String(name).trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

// ── Reference number assignment (document order) ──────────────────────────────

function buildRefMap(annotations: ProposalAnnotation[]): Map<string, number> {
  const map = new Map<string, number>();
  let n = 1;
  for (const key of SECTION_KEY_ORDER) {
    annotations.filter(a => a.sectionKey === key).forEach(a => {
      if (!map.has(a.id)) map.set(a.id, n++);
    });
  }
  annotations.forEach(a => { if (!map.has(a.id)) map.set(a.id, n++); });
  return map;
}

// ── Text annotator — injects <mark>[N]</sup> around matched spans ─────────────

function annotateText(
  text: string,
  annotations: ProposalAnnotation[],
  sectionKey: string,
  refMap: Map<string, number>,
): string {
  const relevant = annotations.filter(
    a => a.sectionKey === sectionKey && text.includes(a.selectedText),
  );
  if (!relevant.length) return esc(text);

  type Hit = { start: number; end: number; ann: ProposalAnnotation };
  const hits: Hit[] = [];
  relevant.forEach(ann => {
    let idx = 0;
    while (true) {
      const pos = text.indexOf(ann.selectedText, idx);
      if (pos === -1) break;
      hits.push({ start: pos, end: pos + ann.selectedText.length, ann });
      idx = pos + 1;
    }
  });

  hits.sort((a, b) => a.start - b.start);
  const clean: Hit[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start >= cursor) { clean.push(h); cursor = h.end; }
  }

  let html = '';
  let pos = 0;
  for (const h of clean) {
    if (h.start > pos) html += esc(text.slice(pos, h.start));
    const col = annotColor(h.ann.color);
    const ref = refMap.get(h.ann.id) ?? '';
    html += `<mark style="background:${col.bg};border-bottom:2px solid ${col.border};` +
      `padding:0 2px;border-radius:2px;color:inherit;">${esc(h.ann.selectedText)}` +
      `<sup style="font-size:8px;color:#7C3AED;font-weight:800;margin-left:1px;` +
      `vertical-align:super;line-height:0;">[${ref}]</sup></mark>`;
    pos = h.end;
  }
  if (pos < text.length) html += esc(text.slice(pos));
  return html;
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function section(title: string, color: string, body: string): string {
  return `
  <div class="section">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;
                padding-bottom:10px;border-bottom:2px solid ${color}20;">
      <div style="width:4px;height:22px;background:${color};border-radius:2px;flex-shrink:0;"></div>
      <h2 style="margin:0;font-size:15px;font-weight:800;color:${color};letter-spacing:-0.01em;">${esc(title)}</h2>
    </div>
    <div style="color:#374151;font-size:13.5px;line-height:1.7;">${body}</div>
  </div>`;
}

// ── Individual section renderers ──────────────────────────────────────────────

function renderSummary(proposal: any, ann: ProposalAnnotation[], ref: Map<string, number>): string {
  if (!proposal?.executive_summary?.paragraphs?.length) return '';
  const paras = (proposal.executive_summary.paragraphs as string[])
    .map(p => `<p style="margin:0 0 10px 0;">${annotateText(p, ann, 'summary', ref)}</p>`)
    .join('');
  return section('Executive Summary', '#8B5CF6', paras);
}

function renderDiagnosis(proposal: any, ann: ProposalAnnotation[], ref: Map<string, number>): string {
  const problems = proposal?.confirmed_diagnosis?.problems;
  if (!problems?.length) return '';
  const items = (problems as any[]).map((p: any, i: number) => `
    <div style="padding:14px 16px;border-left:3px solid #FD443840;background:#FFF0F0;
                border-radius:0 8px 8px 0;margin-bottom:12px;">
      <h4 style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#991B1B;">
        ${i + 1}. ${esc(p.title ?? '')}
      </h4>
      <p style="margin:0 0 6px 0;">${annotateText(p.description ?? '', ann, 'diagnosis', ref)}</p>
      ${p.cost ? `<p style="margin:0;font-size:12px;color:#DC2626;font-style:italic;">Cost: ${esc(p.cost)}</p>` : ''}
    </div>
  `).join('');
  return section('What We Confirmed Together', '#FD4438', items);
}

function renderService(proposal: any, ann: ProposalAnnotation[], ref: Map<string, number>): string {
  const rs = proposal?.recommended_step;
  if (!rs) return '';

  const includes = (rs.includes as string[] ?? [])
    .map(item => `<li style="margin-bottom:5px;">${esc(item)}</li>`).join('');
  const excludes = (rs.does_not_include as string[] ?? [])
    .map(item => `<li style="margin-bottom:5px;color:#6B7280;">${esc(item)}</li>`).join('');

  const body = `
    <h3 style="margin:0 0 8px 0;font-size:14px;font-weight:800;color:#1F2937;">${esc(rs.service_name ?? '')}</h3>
    <p style="margin:0 0 16px 0;">${annotateText(rs.what_it_does ?? '', ann, 'service', ref)}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <div>
        <p style="margin:0 0 8px 0;font-size:11px;font-weight:800;color:#06D7F6;text-transform:uppercase;letter-spacing:.05em;">Includes</p>
        <ul style="margin:0;padding-left:16px;">${includes}</ul>
      </div>
      <div>
        <p style="margin:0 0 8px 0;font-size:11px;font-weight:800;color:#FB923C;text-transform:uppercase;letter-spacing:.05em;">Does Not Include</p>
        <ul style="margin:0;padding-left:16px;">${excludes}</ul>
      </div>
    </div>
  `;
  return section('Recommended First Step', '#FB923C', body);
}

function renderDeliverables(proposal: any, ann: ProposalAnnotation[], ref: Map<string, number>): string {
  const items = proposal?.deliverables?.items;
  if (!items?.length) return '';
  const rows = (items as any[]).map((item: any, i: number) => `
    <div style="display:flex;gap:12px;padding:12px 14px;border:1px solid #E5E7EB;
                border-radius:10px;margin-bottom:10px;background:#F9FAFB;">
      <div style="width:26px;height:26px;background:#06D7F6;color:white;border-radius:50%;
                  display:flex;align-items:center;justify-content:center;font-weight:800;
                  font-size:11px;flex-shrink:0;line-height:1;">${i + 1}</div>
      <div style="flex:1;min-width:0;">
        <h5 style="margin:0 0 4px 0;font-size:13px;font-weight:700;">${esc(item.name ?? '')}</h5>
        <p style="margin:0 0 4px 0;font-size:12.5px;">${annotateText(item.description ?? '', ann, 'deliverables', ref)}</p>
        ${item.format ? `<span style="font-size:11px;background:#E5E7EB;padding:2px 8px;border-radius:10px;color:#6B7280;">${esc(item.format)}</span>` : ''}
      </div>
    </div>
  `).join('');
  return section('Deliverables', '#06D7F6', rows);
}

function renderTimeline(proposal: any): string {
  const phases = proposal?.timeline?.phases;
  if (!phases?.length) return '';
  const rows = (phases as any[]).map((phase: any, i: number) => `
    <div style="display:flex;gap:12px;margin-bottom:14px;">
      <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">
        <div style="width:28px;height:28px;background:linear-gradient(135deg,#8B5CF6,#3B82F6);
                    color:white;border-radius:50%;display:flex;align-items:center;
                    justify-content:center;font-weight:800;font-size:11px;line-height:1;">${i + 1}</div>
        ${i < phases.length - 1 ? `<div style="width:2px;flex:1;min-height:16px;background:#E5E7EB;margin:4px 0;"></div>` : ''}
      </div>
      <div style="flex:1;padding:10px 12px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:${i < phases.length - 1 ? '0' : '0'};">
        <h5 style="margin:0 0 6px 0;font-size:13px;font-weight:700;">${esc(phase.phase ?? '')}</h5>
        <ul style="margin:0;padding-left:14px;">
          ${(phase.activities as string[] ?? []).map(act => `<li style="font-size:12px;margin-bottom:3px;color:#6B7280;">${esc(act)}</li>`).join('')}
        </ul>
      </div>
    </div>
  `).join('');
  return section(`Timeline — ${esc(proposal.timeline.total_duration ?? '')}`, '#3B82F6', rows);
}

function renderInvestment(proposal: any, ann: ProposalAnnotation[], ref: Map<string, number>): string {
  const inv = proposal?.investment;
  if (!inv) return '';
  const lines = [inv.payment_terms, inv.includes_note].filter(Boolean);
  const body = `
    <div style="text-align:center;padding:20px;border-bottom:1px solid #E5E7EB;margin-bottom:20px;">
      <div style="font-size:48px;font-weight:900;color:#06D7F6;letter-spacing:-2px;">
        $${Number(inv.amount ?? 0).toLocaleString()}
      </div>
      <p style="margin:4px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6B7280;">
        ${esc(inv.structure ?? '')} · ${esc(inv.currency ?? '')}
      </p>
    </div>
    ${lines.map(l => `<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;">
      <span style="color:#06D7F6;font-size:15px;flex-shrink:0;margin-top:1px;">✓</span>
      <span>${esc(l)}</span>
    </div>`).join('')}
    ${inv.credit_to_next_phase ? `
    <div style="margin:14px 0;padding:12px 14px;background:#FFF7ED;border:1px solid #FB923C40;border-radius:8px;">
      <strong style="color:#FB923C;">Full credit to next phase:</strong> If you proceed to implementation,
      the entire $${Number(inv.credit_amount ?? 0).toLocaleString()} audit fee is credited.
    </div>` : ''}
    ${inv.reassurance ? `
    <div style="margin-top:14px;padding:14px 16px;background:#F5F3FF;border:1px solid #8B5CF620;border-radius:8px;font-style:italic;">
      ${annotateText(inv.reassurance, ann, 'investment', ref)}
    </div>` : ''}
  `;
  return section('Investment', '#06D7F6', body);
}

function renderNextSteps(proposal: any): string {
  const steps = proposal?.next_steps?.steps;
  if (!steps?.length) return '';
  const rows = (steps as string[]).map((step, i) => `
    <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
      <div style="width:22px;height:22px;border-radius:50%;background:#8B5CF620;border:1.5px solid #8B5CF6;
                  display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;
                  color:#8B5CF6;flex-shrink:0;line-height:1;">${i + 1}</div>
      <span style="font-size:13.5px;padding-top:2px;">${esc(step)}</span>
    </div>
  `).join('');
  return section('Next Steps', '#8B5CF6', rows);
}

function renderFuturePath(proposal: any): string {
  const fp = proposal?.future_path;
  if (!fp?.future_services?.length) return '';
  const cards = (fp.future_services as any[]).map(svc => `
    <div style="padding:12px 14px;border:1px solid #E5E7EB;border-radius:10px;background:#F9FAFB;">
      <h5 style="margin:0 0 4px 0;font-size:13px;font-weight:700;">${esc(svc.name ?? '')}</h5>
      <p style="margin:0 0 6px 0;font-size:12px;color:#6B7280;">${esc(svc.brief_description ?? '')}</p>
      ${svc.typical_timeline ? `<span style="font-size:10px;background:#8B5CF615;color:#8B5CF6;padding:2px 8px;border-radius:10px;">${esc(svc.typical_timeline)}</span>` : ''}
    </div>
  `).join('');
  const title = fp.section_title || 'What This Unlocks Next';
  return section(title, '#8B5CF6', `
    ${fp.note ? `<p style="margin:0 0 14px 0;font-size:12px;color:#6B7280;">${esc(fp.note)}</p>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">${cards}</div>
  `);
}

// ── Annotation index ──────────────────────────────────────────────────────────

function renderAnnotationIndex(
  annotations: ProposalAnnotation[],
  refMap: Map<string, number>,
): string {
  if (!annotations.length) return '';

  const sorted = [...annotations].sort(
    (a, b) => (refMap.get(a.id) ?? 0) - (refMap.get(b.id) ?? 0),
  );

  const entries = sorted.map(ann => {
    const ref = refMap.get(ann.id) ?? '?';
    const col = annotColor(ann.color);
    const excerpt = ann.selectedText.length > 130
      ? ann.selectedText.slice(0, 130) + '…'
      : ann.selectedText;
    return `
    <div style="display:flex;gap:16px;padding:16px 0;border-bottom:1px solid #F3F4F6;">
      <!-- Ref circle -->
      <div style="width:30px;height:30px;border-radius:50%;background:${ann.color};color:#fff;
                  display:flex;align-items:center;justify-content:center;font-weight:800;
                  font-size:12px;flex-shrink:0;line-height:1;margin-top:2px;">${ref}</div>

      <!-- Body -->
      <div style="flex:1;min-width:0;">
        <!-- Author row -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          <div style="width:26px;height:26px;border-radius:50%;background:${col.bg};border:1.5px solid ${col.border};
                      color:${col.text};font-weight:800;font-size:10px;
                      display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${esc(initials(ann.author))}
          </div>
          <strong style="font-size:13px;">${esc(ann.author)}</strong>
          <span style="font-size:11px;background:#F3F4F6;padding:2px 8px;border-radius:10px;color:#6B7280;">
            ${esc(ann.sectionKey)}
          </span>
          <span style="font-size:11px;color:#9CA3AF;">${fmtDateShort(ann.createdAt)}</span>
        </div>

        <!-- Highlighted quote -->
        <blockquote style="margin:0 0 8px 0;padding:8px 14px;background:${col.bg};
                            border-left:3px solid ${col.border};border-radius:0 8px 8px 0;
                            font-style:italic;font-size:13px;color:${col.text};">
          &ldquo;${esc(excerpt)}&rdquo;
        </blockquote>

        <!-- Comment -->
        ${ann.comment
          ? `<p style="margin:0;font-size:13px;color:#374151;">${esc(ann.comment)}</p>`
          : `<p style="margin:0;font-size:12px;font-style:italic;color:#9CA3AF;">No comment</p>`
        }
      </div>
    </div>`;
  }).join('');

  return `
  <div style="margin-top:52px;padding-top:32px;border-top:2.5px solid #E5E7EB;page-break-before:always;">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:28px;">
      <div style="width:42px;height:42px;background:linear-gradient(135deg,#8B5CF6,#3B82F6);
                  border-radius:12px;display:flex;align-items:center;justify-content:center;
                  font-size:20px;color:white;flex-shrink:0;">✏</div>
      <div>
        <h2 style="margin:0;font-size:20px;font-weight:900;color:#1F2937;letter-spacing:-0.02em;">
          Annotation Index
        </h2>
        <p style="margin:4px 0 0;font-size:13px;color:#6B7280;">
          ${annotations.length} annotation${annotations.length !== 1 ? 's' : ''} across this proposal
        </p>
      </div>
    </div>
    ${entries}
  </div>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #1F2937;
    background: #ffffff;
    font-size: 14px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    max-width: 820px;
    margin: 0 auto;
    padding: 40px 48px;
  }
  .section {
    margin-bottom: 32px;
    page-break-inside: avoid;
  }
  mark {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 20px;
    background: rgba(255,255,255,0.96);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid #E5E7EB;
    gap: 12px;
  }
  .toolbar-label {
    font-size: 12px;
    color: #6B7280;
    font-weight: 500;
  }
  .btn-print {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    background: #8B5CF6;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    letter-spacing: -0.01em;
  }
  .btn-print:hover { background: #7C3AED; }
  .btn-close {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: transparent;
    color: #6B7280;
    border: 1px solid #E5E7EB;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-close:hover { background: #F9FAFB; color: #1F2937; }
  @media print {
    .toolbar { display: none !important; }
    .page { padding: 0; }
    body { font-size: 12px; }
  }
  @page {
    margin: 1in 0.85in;
    size: A4 portrait;
  }
`;

// ── Main export function ───────────────────────────────────────────────────────

export function generateAnnotatedProposalHTML(
  proposal: any,
  annotations: ProposalAnnotation[],
  companyName: string,
): string {
  const refMap = buildRefMap(annotations);
  const hasAnnotations = annotations.length > 0;

  // Cover
  const proposalDate = proposal?.generated_date
    ? fmtDate(proposal.generated_date)
    : fmtDate(new Date().toISOString());

  const coverHtml = `
  <div style="background:linear-gradient(135deg,#1a0a2e 0%,#0f0a1e 60%,#0a0f1e 100%);
              color:white;border-radius:16px;padding:40px 44px;margin-bottom:36px;
              position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <!-- Decorative blobs -->
    <div style="position:absolute;top:-40px;right:-40px;width:180px;height:180px;
                background:rgba(139,92,246,0.15);border-radius:50%;pointer-events:none;"></div>
    <div style="position:absolute;bottom:-20px;left:200px;width:120px;height:120px;
                background:rgba(59,130,246,0.1);border-radius:50%;pointer-events:none;"></div>

    <div style="position:relative;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
        <div style="width:36px;height:36px;background:linear-gradient(135deg,#8B5CF6,#3B82F6);
                    border-radius:10px;display:flex;align-items:center;justify-content:center;
                    font-size:18px;color:white;flex-shrink:0;">✦</div>
        <span style="font-size:11px;font-weight:800;letter-spacing:.1em;color:#A78BFA;text-transform:uppercase;">
          CORTEX Proposal
        </span>
        ${hasAnnotations ? `<span style="margin-left:auto;font-size:11px;font-weight:700;
          background:rgba(251,191,36,0.2);color:#FBBF24;border:1px solid rgba(251,191,36,0.35);
          padding:3px 10px;border-radius:20px;">
          ✏ ${annotations.length} Annotation${annotations.length !== 1 ? 's' : ''}
        </span>` : ''}
      </div>

      <h1 style="margin:0 0 10px 0;font-size:26px;font-weight:900;letter-spacing:-0.02em;line-height:1.2;">
        AI Readiness &amp; Operations Diagnostic Proposal
      </h1>
      <p style="margin:0 0 24px 0;font-size:14px;color:rgba(255,255,255,0.55);">
        Prepared for <strong style="color:rgba(255,255,255,0.85);">${esc(proposal?.company_name ?? companyName)}</strong>
        &nbsp;·&nbsp;${esc(proposalDate)}
      </p>

      ${proposal?.status === 'accepted' ? `
      <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 18px;
                  background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.35);
                  border-radius:20px;color:#34D399;font-size:13px;font-weight:700;">
        ✓ Proposal Accepted
      </div>` : proposal?.status === 'rejected' ? `
      <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 18px;
                  background:rgba(253,68,56,0.2);border:1px solid rgba(253,68,56,0.35);
                  border-radius:20px;color:#F87171;font-size:13px;font-weight:700;">
        ✕ Proposal Declined
      </div>` : `
      <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 18px;
                  background:rgba(139,92,246,0.2);border:1px solid rgba(139,92,246,0.35);
                  border-radius:20px;color:#C4B5FD;font-size:13px;font-weight:700;">
        ○ Awaiting Your Response
      </div>`}
    </div>
  </div>`;

  // Sections
  const sections = [
    renderSummary(proposal, annotations, refMap),
    renderDiagnosis(proposal, annotations, refMap),
    renderService(proposal, annotations, refMap),
    renderDeliverables(proposal, annotations, refMap),
    renderTimeline(proposal),
    renderInvestment(proposal, annotations, refMap),
    renderNextSteps(proposal),
    renderFuturePath(proposal),
    renderAnnotationIndex(annotations, refMap),
  ].filter(Boolean).join('\n');

  // Toolbar
  const toolbar = `
  <div class="toolbar no-print">
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="width:28px;height:28px;background:linear-gradient(135deg,#8B5CF6,#3B82F6);
                  border-radius:8px;display:flex;align-items:center;justify-content:center;
                  font-size:14px;color:white;flex-shrink:0;">✦</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:#1F2937;">
          ${esc(proposal?.company_name ?? companyName)} — CORTEX Proposal
        </div>
        <div class="toolbar-label">
          ${hasAnnotations ? `${annotations.length} annotation${annotations.length !== 1 ? 's' : ''} included` : 'No annotations'}
          &nbsp;·&nbsp;Generated ${fmtDate(new Date().toISOString())}
        </div>
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn-close" onclick="window.close()">✕ Close</button>
      <button class="btn-print" onclick="window.print()">⎙ Save as PDF</button>
    </div>
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(proposal?.company_name ?? companyName)} — CORTEX Proposal${hasAnnotations ? ' (Annotated)' : ''}</title>
  <style>${CSS}</style>
</head>
<body>
  ${toolbar}
  <div class="page">
    ${coverHtml}
    ${sections}
  </div>
  <script>
    // Auto-open print dialog after a short delay for rendering to settle
    // Removed from auto-fire — user clicks the "Save as PDF" button instead
  </script>
</body>
</html>`;
}