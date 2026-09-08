/**
 * PROPOSAL SECTION COPILOT
 *
 * Inline AI feedback loop wired directly to ProposalDraft sections.
 * Unlike the Block Registry (§12) which operates on the block schema,
 * this copilot targets the 6 first-class proposal sections:
 *   • Executive Brief     • Diagnosis 1–3
 *   • Scope Boundaries    • Next Step Offer
 *
 * AI Feedback Loop (how AI learns from us):
 *   1. User selects section + action (or types a natural language prompt)
 *   2. AI generates a pending revision (never auto-applied)
 *   3. 3 validators run: Fact Lock · Coherence · Jargon
 *   4. Team ACCEPTS → section content updates, bump version
 *   5. Team REJECTS + types WHY → rejection reason is stored in session
 *   6. On the NEXT AI call, rejection reasons are prepended as negative context
 *      ("Previous suggestion rejected because: [reason]. Avoid this.")
 *   7. Stats bar shows accepted/rejected count per session
 */

import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bot, ChevronDown, ChevronUp, Zap, Expand, Minimize2, Wrench,
  Check, X, Edit3, Send, Loader2, AlertTriangle, CheckCircle2,
  MessageSquare, Sparkles, Info, Target, Shield,
  ThumbsUp, ThumbsDown, RotateCcw, History, ArrowLeftRight,
  Lock, ShieldCheck, ShieldX, AlertCircle,
} from 'lucide-react';
import type { ProposalDraft } from '@/app/types/cortex-types';
import { useGlobalAIChat } from '@/app/contexts/GlobalAIChatContext';
import { isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';
import * as dataService from '@/app/services/dataService';
import {
  buildDemoSectionRevision,
  getSectionContent,
  type SectionKey,
  type ActionKey,
} from '@/app/core/proposalCopilotEngine';
import { brand, status } from '@/app/lib/tokens';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

interface SectionRevision {
  id: string;
  section: SectionKey;
  sectionLabel: string;
  action: ActionKey;
  actionLabel: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  diff_summary: string;
  changed_fields: { field: string; before: string; after: string }[];
  validation: {
    fact_lock: { passed: boolean; violations: string[] };
    jargon: { passed: boolean; words_found: string[] };
    coherence: { passed: boolean; missing: string[] };
  };
  status: 'pending' | 'accepted' | 'rejected';
  reject_reason?: string;
  custom_prompt?: string;
  created_at: string;
}

interface SessionStats {
  accepted: number;
  rejected: number;
  rejection_contexts: string[]; // fed back into next AI call
}

// ════════════════════════════════════════════════════════════════════════════════
// STATIC CONFIG
// ════════════════════════════════════════════════════════════════════════════════

const SECTION_CFG: Record<SectionKey, { label: string; color: string; shortDesc: string }> = {
  executive_brief:  { label: 'Executive Brief',  color: brand.accent, shortDesc: '§1 — title, context, why now, success vision' },
  diagnosis_0:      { label: 'Diagnosis 1',      color: status.danger, shortDesc: '§2 — first bottleneck block' },
  diagnosis_1:      { label: 'Diagnosis 2',      color: status.warning, shortDesc: '§2 — second bottleneck block' },
  diagnosis_2:      { label: 'Diagnosis 3',      color: status.caution, shortDesc: '§2 — third bottleneck block' },
  scope_boundaries: { label: 'Scope Boundaries', color: status.success, shortDesc: '§3 — included, excluded, assumptions' },
  next_step_offer:  { label: 'Next Step Offer',  color: status.info, shortDesc: '§4 — offer name, price, CTAs (price locked)' },
};

const ACTION_CFG: Record<ActionKey, { label: string; desc: string; color: string; icon: React.FC<{className?: string}> }> = {
  improve:   { label: 'Polish Tone',      desc: 'Boardroom-grade precision & clarity',    color: brand.accent, icon: Sparkles   },
  expand:    { label: 'Add Depth',        desc: 'More structure, detail & evidence',       color: status.info, icon: Expand     },
  simplify:  { label: 'Simplify',         desc: 'Client-facing, jargon-free version',      color: status.caution, icon: Minimize2  },
  fix_gate:  { label: 'Fix Gate Issues',  desc: 'Resolve readiness gate blockers',         color: status.warning, icon: Wrench     },
  custom:    { label: 'Custom Prompt',    desc: 'Describe what you want in plain English',  color: status.success, icon: MessageSquare },
};

const QUICK_PROMPTS = [
  'Make the executive brief more urgent with specific numbers',
  'Add cost-of-inaction framing to the diagnosis',
  'Sharpen the scope to be more defensible',
  'Rewrite the CTA to feel more premium',
];

// ════════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════════════════

function ValidationBadge({ label, passed, detail }: { label: string; passed: boolean; detail?: string }) {
  return (
    <span
      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold"
      style={{ background: passed ? '#10B98115' : '#FD443815', color: passed ? status.success : status.danger, border: `1px solid ${passed ? '#10B98130' : '#FD443830'}` }}
      title={detail}
    >
      {passed ? <CheckCircle2 className="size-2.5" /> : <AlertCircle className="size-2.5" />}
      {label}
    </span>
  );
}

function DiffRow({ field, before, after }: { field: string; before: string; after: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[8px] font-bold uppercase tracking-widest text-cortex-faint">{field}</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-cortex-danger/5 border border-cortex-danger/15 rounded-cortex-sm p-2.5">
          <div className="text-[8px] text-cortex-danger font-bold mb-1 uppercase tracking-wider">Before</div>
          <p className="text-[10px] text-cortex-muted leading-relaxed line-clamp-4">{before || <span className="italic text-cortex-faint">empty</span>}</p>
        </div>
        <div className="bg-cortex-success/5 border border-cortex-success/15 rounded-cortex-sm p-2.5">
          <div className="text-[8px] text-cortex-success font-bold mb-1 uppercase tracking-wider">After</div>
          <p className="text-[10px] text-cortex-secondary leading-relaxed line-clamp-4">{after}</p>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PENDING REVISION CARD
// ════════════════════════════════════════════════════════════════════════════════

const PendingRevisionCard = React.forwardRef<HTMLDivElement, {
  revision: SectionRevision;
  onAccept: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onEditManually: (id: string) => void;
}>(function PendingRevisionCard({
  revision,
  onAccept,
  onReject,
  onEditManually,
}, ref) {
  const [rejectMode, setRejectMode]   = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [expanded, setExpanded]       = useState(true);
  const sectionCfg = SECTION_CFG[revision.section];
  const actionCfg  = ACTION_CFG[revision.action];
  const ActionIcon = actionCfg.icon;
  const v = revision.validation;
  const allValid = v.fact_lock.passed && v.jargon.passed && v.coherence.passed;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="border border-cortex-accent/25 rounded-cortex-md overflow-hidden bg-cortex-accent/[0.04]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-cortex-subtle">
        <div className="flex items-center gap-2.5 min-w-0">
          <Bot className="size-3.5 text-cortex-accent flex-shrink-0" />
          <span
            className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0"
            style={{ background: `${sectionCfg.color}18`, color: sectionCfg.color, border: `1px solid ${sectionCfg.color}30` }}
          >
            {revision.sectionLabel}
          </span>
          <span
            className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0 flex items-center gap-1"
            style={{ background: `${actionCfg.color}15`, color: actionCfg.color, border: `1px solid ${actionCfg.color}25` }}
          >
            <ActionIcon className="size-2.5" />
            {revision.actionLabel}
          </span>
          <span className="text-[9px] text-cortex-faint truncate hidden sm:block">{revision.diff_summary}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Validator badges */}
          <ValidationBadge label="Fact Lock" passed={v.fact_lock.passed} detail={v.fact_lock.violations.join('; ') || 'No violations'} />
          <ValidationBadge label="Jargon" passed={v.jargon.passed} detail={v.jargon.words_found.join(', ') || 'Clean'} />
          <ValidationBadge label="Coherence" passed={v.coherence.passed} detail={v.coherence.missing.join(', ') || 'All fields present'} />
          <button onClick={() => setExpanded(e => !e)} className="text-cortex-faint hover:text-cortex-muted transition-colors ml-1">
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-3">
              {/* Diff view */}
              {revision.changed_fields.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[9px] text-cortex-faint font-bold uppercase tracking-wider">
                    <ArrowLeftRight className="size-3" />
                    Changed Fields ({revision.changed_fields.length})
                  </div>
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {revision.changed_fields.map((f, i) => (
                      <DiffRow key={i} field={f.field} before={f.before} after={f.after} />
                    ))}
                  </div>
                </div>
              )}

              {/* Validation detail (only if something failed) */}
              {!allValid && (
                <div className="bg-cortex-danger/5 border border-cortex-danger/20 rounded-cortex-sm p-3 text-[10px] text-cortex-danger space-y-1">
                  {!v.fact_lock.passed && <p>⚠ Fact Lock: {v.fact_lock.violations.join('; ')}</p>}
                  {!v.jargon.passed && <p>⚠ Jargon: {v.jargon.words_found.join(', ')}</p>}
                  {!v.coherence.passed && <p>⚠ Coherence: missing {v.coherence.missing.join(', ')}</p>}
                </div>
              )}

              {/* Reject form */}
              {rejectMode ? (
                <div className="space-y-2">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-cortex-danger">
                    Why are you rejecting this? (AI will use your reason to improve next time)
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="e.g. Too generic — needs to reference ExampleCo's specific $340K pipeline gap, not vague percentages…"
                    rows={3}
                    className="w-full bg-cortex-sunken border border-cortex-danger/30 rounded-cortex-sm px-3 py-2 text-xs text-white resize-none focus:outline-none focus:border-cortex-danger/60 placeholder:text-cortex-faint"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { onReject(revision.id, rejectReason || 'No reason given'); setRejectMode(false); }}
                      className="flex-1 py-2 rounded-cortex-sm bg-cortex-danger/15 border border-cortex-danger/30 text-cortex-danger text-xs font-bold hover:bg-cortex-danger/25 transition-colors"
                    >
                      Submit Rejection → AI Learns From This
                    </button>
                    <button
                      onClick={() => setRejectMode(false)}
                      className="px-3 py-2 rounded-cortex-sm bg-cortex-control text-cortex-muted text-xs hover:bg-cortex-control-hover transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => onAccept(revision.id)}
                    disabled={!allValid}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-cortex-sm bg-cortex-success/15 border border-cortex-success/30 text-cortex-success text-xs font-bold hover:bg-cortex-success/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Check className="size-3.5" />
                    Accept — Apply to Draft
                  </button>
                  <button
                    onClick={() => setRejectMode(true)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-cortex-sm bg-cortex-danger/10 border border-cortex-danger/25 text-cortex-danger text-xs font-bold hover:bg-cortex-danger/20 transition-colors"
                  >
                    <X className="size-3.5" />
                    Reject
                  </button>
                  <button
                    onClick={() => onEditManually(revision.id)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-cortex-sm bg-cortex-control border border-cortex-default text-cortex-muted text-xs font-bold hover:bg-cortex-control-hover transition-colors"
                  >
                    <Edit3 className="size-3.5" />
                    Edit Manually
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
PendingRevisionCard.displayName = 'PendingRevisionCard';

// ════════════════════════════════════════════════════════════════════════════════
// HISTORY ITEM
// ════════════════════════════════════════════════════════════════════════════════

function HistoryItem({ revision }: { revision: SectionRevision }) {
  const sectionCfg = SECTION_CFG[revision.section];
  const accepted   = revision.status === 'accepted';
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-cortex-sm bg-white/[0.02] border border-cortex-subtle">
      <div
        className="size-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: accepted ? '#10B98115' : '#FD443815' }}
      >
        {accepted
          ? <ThumbsUp className="size-2.5 text-cortex-success" />
          : <ThumbsDown className="size-2.5 text-cortex-danger" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-bold" style={{ color: sectionCfg.color }}>{revision.sectionLabel}</span>
          <span className="text-[9px] text-cortex-faint">·</span>
          <span className="text-[9px] text-cortex-muted">{revision.actionLabel}</span>
          <span
            className="text-[8px] font-bold px-1.5 py-0.5 rounded-full"
            style={{
              background: accepted ? '#10B98118' : '#FD443818',
              color: accepted ? status.success : status.danger,
            }}
          >
            {accepted ? 'ACCEPTED' : 'REJECTED'}
          </span>
        </div>
        <p className="text-[9px] text-cortex-faint mt-0.5 truncate">{revision.diff_summary}</p>
        {!accepted && revision.reject_reason && (
          <p className="text-[9px] text-cortex-warning mt-0.5 italic">Reason: "{revision.reject_reason}"</p>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// FEEDBACK LOOP EXPLAINER
// ════════════════════════════════════════════════════════════════════════════════

function FeedbackLoopExplainer() {
  return (
    <div className="bg-cortex-info/[0.04] border border-cortex-info/15 rounded-cortex-md p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold text-cortex-info">
        <Info className="size-3.5" />
        How the AI Feedback Loop Works
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { step: '1', icon: Bot,          color: brand.accent, label: 'AI Generates',   desc: 'Pending revision created — never auto-applied' },
          { step: '2', icon: ShieldCheck,  color: status.info, label: '3 Validators',   desc: 'Fact Lock · Coherence · Jargon — all must pass' },
          { step: '3', icon: ArrowLeftRight, color: status.success, label: 'You Review',   desc: 'Side-by-side diff · Accept or Reject with reason' },
          { step: '4', icon: RotateCcw,    color: status.warning, label: 'AI Learns',      desc: 'Rejection reasons fed back as negative context next call' },
        ].map(({ step, icon: Icon, color, label, desc }) => (
          <div key={step} className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span
                className="size-4 rounded-full flex items-center justify-center text-[8px] font-black flex-shrink-0"
                style={{ background: `${color}20`, color }}
              >
                {step}
              </span>
              <Icon className="size-3 flex-shrink-0" style={{ color }} />
              <span className="text-[9px] font-bold" style={{ color }}>{label}</span>
            </div>
            <p className="text-[9px] text-cortex-faint leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-cortex-subtle pt-2.5 text-[9px] text-cortex-faint leading-relaxed">
        <span className="text-cortex-warning font-bold">Key rule:</span> Math decides priority, LLM only explains decisions. AI cannot change prices, timelines, or ROI metrics — those are fact-locked. Only narrative and structure can be revised.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — ProposalSectionCopilot
// ════════════════════════════════════════════════════════════════════════════════

interface ProposalSectionCopilotProps {
  draft: ProposalDraft;
  onApply: (section: SectionKey, content: Record<string, unknown>) => void;
  accessToken?: string;
}

export function ProposalSectionCopilot({ draft, onApply, accessToken }: ProposalSectionCopilotProps) {
  const [collapsed, setCollapsed]       = useState(false);
  const [activeTab, setActiveTab]       = useState<'copilot' | 'history' | 'how'>('copilot');
  const [section, setSection]           = useState<SectionKey>('executive_brief');
  const [action, setAction]             = useState<ActionKey>('improve');
  const [customPrompt, setCustomPrompt] = useState('');
  const [loading, setLoading]           = useState(false);
  const [pendingRevisions, setPendingRevisions] = useState<SectionRevision[]>([]);
  const [historyItems, setHistoryItems]  = useState<SectionRevision[]>([]);
  const [stats, setStats]               = useState<SessionStats>({ accepted: 0, rejected: 0, rejection_contexts: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const { openChat } = useGlobalAIChat();

  const handleOpenGlobalChat = () => {
    const cfg = SECTION_CFG[section];
    let sectionContent = '';
    if (section === 'executive_brief') {
      const eb = draft.executive_brief;
      sectionContent = `Title: ${eb.title}. Strategic context: ${eb.strategic_context ?? ''}. Why now: ${eb.why_now ?? ''}. Success vision: ${eb.what_success_looks_like ?? ''}.`;
    } else if (section.startsWith('diagnosis_')) {
      const idx = parseInt(section.split('_')[1] ?? '0', 10);
      const b = draft.diagnosis_blocks[idx];
      sectionContent = b ? `Title: ${b.title}. Description: ${b.description}` : '';
    } else if (section === 'scope_boundaries') {
      const sc = draft.scope_boundaries;
      sectionContent = `Included: ${sc.included.join(', ')}. Excluded: ${sc.excluded.join(', ')}.`;
    }
    openChat({
      sectionId: section === 'executive_brief' ? 'proposal.executive_brief' : `proposal.${section}`,
      sectionLabel: cfg.label,
      sectionContent,
    });
  };

  // Available sections (filter out diagnosis blocks that don't exist)
  const availableSections = (Object.keys(SECTION_CFG) as SectionKey[]).filter(k => {
    if (k.startsWith('diagnosis_')) {
      const idx = parseInt(k.split('_')[1] ?? '0', 10);
      return idx < draft.diagnosis_blocks.length;
    }
    return true;
  });

  const hasPending = pendingRevisions.length > 0;

  // ── Generate revision ───────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (action === 'custom' && !customPrompt.trim()) {
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    try {
      const before = getSectionContent(draft, section);

      // dataService gates demo vs live: demo returns a deterministic mock,
      // live routes through the Intelligence Gateway. Fact-lock is enforced in
      // both paths so no AI-altered price/score can reach the draft.
      const result = await dataService.proposalSectionCopilot(
        {
          section,
          section_label: SECTION_CFG[section].label,
          action,
          current_content: before,
          custom_prompt: action === 'custom' ? customPrompt.trim() : undefined,
          rejection_contexts: stats.rejection_contexts,
          context: {
            company:  draft.client.company_name,
            industry: draft.client.industry,
            locked_facts: {
              price:    draft.next_step_offer.price,
              currency: draft.next_step_offer.currency,
              duration: draft.next_step_offer.duration,
            },
          },
        },
        accessToken ?? '',
        { draft, rejectionContexts: stats.rejection_contexts },
      );

      const revision: SectionRevision = {
        id:           `rev_${Date.now()}`,
        section,
        sectionLabel: SECTION_CFG[section].label,
        action,
        actionLabel:  ACTION_CFG[action].label,
        before,
        after:        result.after,
        diff_summary:   result.diff_summary,
        changed_fields: result.changed_fields,
        validation:     result.validation,
        status:         'pending',
        custom_prompt:  action === 'custom' ? customPrompt.trim() : undefined,
        created_at:   new Date().toISOString(),
      };

      setPendingRevisions(prev => [revision, ...prev]);
      setCustomPrompt('');
      setActiveTab('copilot');
    } catch (err) {
      if (isVerboseLogging()) console.error('Section copilot generate failed:', err);
      if (shouldShowApiErrors()) {
        const keyMissing = (err as { keyMissing?: boolean })?.keyMissing;
        window.alert(keyMissing
          ? 'AI is not configured (missing API key). Contact your administrator.'
          : `AI generation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [draft, section, action, customPrompt, stats.rejection_contexts, accessToken]);

  // ── Accept revision ─────────────────────────────────────────────────────────
  const handleAccept = useCallback((id: string) => {
    const rev = pendingRevisions.find(r => r.id === id);
    if (!rev) return;
    onApply(rev.section, rev.after);
    const accepted = { ...rev, status: 'accepted' as const };
    setHistoryItems(prev => [accepted, ...prev]);
    setPendingRevisions(prev => prev.filter(r => r.id !== id));
    setStats(s => ({ ...s, accepted: s.accepted + 1 }));
  }, [pendingRevisions, onApply]);

  // ── Reject revision ─────────────────────────────────────────────────────────
  const handleReject = useCallback((id: string, reason: string) => {
    const rev = pendingRevisions.find(r => r.id === id);
    if (!rev) return;
    const rejected = { ...rev, status: 'rejected' as const, reject_reason: reason };
    setHistoryItems(prev => [rejected, ...prev]);
    setPendingRevisions(prev => prev.filter(r => r.id !== id));
    // Feed rejection reason into AI context for next call
    setStats(s => ({
      accepted: s.accepted,
      rejected: s.rejected + 1,
      rejection_contexts: [...s.rejection_contexts.slice(-4), reason],
    }));
  }, [pendingRevisions]);

  // ── Edit manually — remove pending, open editor section ────────────────────
  const handleEditManually = useCallback((id: string) => {
    setPendingRevisions(prev => prev.filter(r => r.id !== id));
  }, []);

  const pendingCount = pendingRevisions.length;
  const totalSuggestions = stats.accepted + stats.rejected + pendingCount;

  return (
    <div className="border border-cortex-accent/20 rounded-cortex-md overflow-hidden bg-cortex-raised backdrop-blur-xl">
      {/* ── Panel header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-cortex-subtle">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <div className="size-5 rounded-cortex-sm bg-cortex-accent/20 flex items-center justify-center">
              <Sparkles className="size-3 text-cortex-accent" />
            </div>
            CORTEX AI Copilot
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cortex-accent/15 text-cortex-accent font-bold border border-cortex-accent/25 uppercase tracking-wider">
              Proposal Layer
            </span>
          </div>

          {/* Session stats */}
          {totalSuggestions > 0 && (
            <div className="flex items-center gap-2 text-[9px] text-cortex-faint">
              <span className="text-cortex-success font-bold">✓ {stats.accepted}</span>
              <span>·</span>
              <span className="text-cortex-danger font-bold">✗ {stats.rejected}</span>
              {stats.rejection_contexts.length > 0 && (
                <span className="contents">
                  <span>·</span>
                  <span className="text-cortex-warning">{stats.rejection_contexts.length} feedback{stats.rejection_contexts.length !== 1 ? 's' : ''} queued for AI</span>
                </span>
              )}
            </div>
          )}

          {/* Pending badge */}
          {pendingCount > 0 && (
            <span className="size-5 rounded-full bg-cortex-warning text-black text-[9px] font-black flex items-center justify-center">
              {pendingCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Tabs */}
          {[
            { id: 'copilot' as const, label: 'Generate', icon: Bot },
            { id: 'history' as const, label: `History ${historyItems.length > 0 ? `(${historyItems.length})` : ''}`, icon: History },
            { id: 'how' as const, label: 'How it works', icon: Info },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setCollapsed(false); }}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-cortex-sm text-[10px] font-bold transition-all ${
                activeTab === tab.id && !collapsed
                  ? 'bg-cortex-accent/20 text-cortex-accent border border-cortex-accent/30'
                  : 'text-cortex-muted hover:text-cortex-secondary hover:bg-cortex-control'
              }`}
            >
              <tab.icon className="size-3" />
              {tab.label}
            </button>
          ))}
          {/* Open in Global Chat */}
          <button
            onClick={handleOpenGlobalChat}
            title="Open in Cortex AI Chat"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-cortex-sm text-[10px] font-bold text-cortex-accent border border-cortex-accent/25 bg-cortex-accent/8 hover:bg-cortex-accent/15 transition-all"
          >
            <Sparkles className="size-3" />
            Chat ↗
          </button>
          <button
            onClick={() => setCollapsed(c => !c)}
            className="text-cortex-faint hover:text-cortex-muted transition-colors ml-1"
          >
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </button>
        </div>
      </div>

      {/* ── Panel body ───────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {/* ─── TAB: HOW IT WORKS ─────────────────────────────────────────── */}
            {activeTab === 'how' && (
              <div className="p-4">
                <FeedbackLoopExplainer />
              </div>
            )}

            {/* ─── TAB: HISTORY ──────────────────────────────────────────────── */}
            {activeTab === 'history' && (
              <div className="p-4">
                {historyItems.length === 0 ? (
                  <div className="text-center py-6 text-cortex-faint text-xs">
                    No AI revisions in this session yet. Generate and review suggestions above.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {historyItems.map(rev => (
                      <HistoryItem key={rev.id} revision={rev} />
                    ))}
                  </div>
                )}
                {stats.rejection_contexts.length > 0 && (
                  <div className="mt-3 p-3 bg-cortex-warning/[0.05] border border-cortex-warning/20 rounded-cortex-sm">
                    <div className="text-[9px] font-bold text-cortex-warning uppercase tracking-wider mb-2">
                      Feedback Queued for AI Context ({stats.rejection_contexts.length})
                    </div>
                    <div className="space-y-1">
                      {stats.rejection_contexts.map((ctx, i) => (
                        <p key={i} className="text-[9px] text-cortex-muted italic">"{ctx}"</p>
                      ))}
                    </div>
                    <p className="text-[9px] text-cortex-faint mt-2">
                      ↳ These will be prepended to the next AI call as negative context — AI won't repeat these patterns.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ─── TAB: COPILOT (generate + pending) ─────────────────────────── */}
            {activeTab === 'copilot' && (
              <div className="p-4 space-y-4">

                {/* ── Controls row ─────────────────────────────────────────────── */}
                <div className="space-y-3">
                  {/* Section selector */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint">
                      Target Section
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {availableSections.map(sec => {
                        const cfg = SECTION_CFG[sec];
                        const active = section === sec;
                        return (
                          <button
                            key={sec}
                            onClick={() => setSection(sec)}
                            className="px-2.5 py-1.5 rounded-cortex-sm text-[9px] font-bold transition-all border"
                            style={active
                              ? { background: `${cfg.color}20`, color: cfg.color, borderColor: `${cfg.color}40` }
                              : { background: 'transparent', color: status.neutral, borderColor: '#ffffff10' }
                            }
                          >
                            {cfg.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[9px] text-cortex-faint">{SECTION_CFG[section].shortDesc}</p>
                  </div>

                  {/* Action selector */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint">
                      AI Action
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(ACTION_CFG) as ActionKey[]).map(act => {
                        const cfg    = ACTION_CFG[act];
                        const active = action === act;
                        const Icon   = cfg.icon;
                        return (
                          <button
                            key={act}
                            onClick={() => setAction(act)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-cortex-sm text-[9px] font-bold transition-all border"
                            style={active
                              ? { background: `${cfg.color}18`, color: cfg.color, borderColor: `${cfg.color}35` }
                              : { background: 'transparent', color: status.neutral, borderColor: '#ffffff10' }
                            }
                          >
                            <Icon className="size-2.5" />
                            {cfg.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[9px] text-cortex-faint">{ACTION_CFG[action].desc}</p>
                  </div>

                  {/* Custom prompt input */}
                  {action === 'custom' ? (
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint">
                        Your Prompt
                      </label>
                      <div className="flex gap-2">
                        <input
                          ref={inputRef}
                          type="text"
                          value={customPrompt}
                          onChange={e => setCustomPrompt(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && !loading && handleGenerate()}
                          placeholder="e.g. Make the executive brief more urgent with ExampleCo's pipeline gap numbers…"
                          className="flex-1 bg-white/[0.04] border border-cortex-default rounded-cortex-sm px-3 py-2 text-xs text-white focus:outline-none focus:border-cortex-accent/50 placeholder:text-cortex-faint"
                        />
                        <button
                          onClick={handleGenerate}
                          disabled={loading || !customPrompt.trim()}
                          className="px-4 py-2 rounded-cortex-sm bg-cortex-accent hover:bg-cortex-accent/85 text-white text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                        >
                          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                          {loading ? 'Generating…' : 'Run'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleGenerate}
                        disabled={loading}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-cortex-md bg-cortex-accent hover:bg-cortex-accent/85 text-white text-xs font-bold transition-all shadow-lg shadow-cortex-accent/20 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                        {loading ? 'AI is thinking…' : `Generate: ${ACTION_CFG[action].label} · ${SECTION_CFG[section].label}`}
                      </button>
                      {stats.rejection_contexts.length > 0 && (
                        <span className="text-[9px] text-cortex-warning flex items-center gap-1">
                          <RotateCcw className="size-2.5" />
                          {stats.rejection_contexts.length} feedback context{stats.rejection_contexts.length !== 1 ? 's' : ''} will be sent to AI
                        </span>
                      )}
                    </div>
                  )}

                  {/* Quick prompts */}
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_PROMPTS.map((p, i) => (
                      <button
                        key={i}
                        onClick={() => { setAction('custom'); setCustomPrompt(p); }}
                        className="px-2 py-1 rounded-cortex-sm border border-white/8 text-[8px] text-cortex-faint hover:text-cortex-muted hover:border-white/15 transition-colors"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Pending revisions queue ──────────────────────────────────── */}
                {hasPending && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider text-cortex-warning">
                      <Zap className="size-3" />
                      Pending AI Revisions ({pendingCount}) — Review before applying
                    </div>
                    <AnimatePresence mode="popLayout">
                      {pendingRevisions.map(rev => (
                        <PendingRevisionCard
                          key={rev.id}
                          revision={rev}
                          onAccept={handleAccept}
                          onReject={handleReject}
                          onEditManually={handleEditManually}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}

                {/* ── Empty state ──────────────────────────────────────────────── */}
                {!hasPending && !loading && (
                  <div className="flex items-center gap-3 p-3 bg-white/[0.02] border border-cortex-subtle rounded-cortex-md">
                    <Bot className="size-5 text-cortex-faint flex-shrink-0" />
                    <div>
                      <p className="text-xs text-cortex-faint">Select a section and action above, then click <span className="text-white font-bold">Generate</span>.</p>
                      <p className="text-[9px] text-cortex-faint mt-0.5">AI suggestions are always pending — you Accept, Reject, or Edit. Your rejection reasons teach the AI what not to do next time.</p>
                    </div>
                  </div>
                )}

                {/* ── Fact lock notice ────────────────────────────────────────── */}
                <div className="flex items-center gap-2 text-[9px] text-cortex-faint">
                  <Lock className="size-2.5 flex-shrink-0" />
                  Fact-locked fields (price, timeline, ROI metrics) are protected — AI cannot change them even if asked.
                  {draft.next_step_offer.price > 0 && (
                    <span className="text-cortex-info font-bold ml-1">
                      ${draft.next_step_offer.price.toLocaleString()} {draft.next_step_offer.currency} · {draft.next_step_offer.duration}
                    </span>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}