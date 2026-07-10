/**
 * GLOBAL AI CHAT - Floating Chat Panel
 *
 * A platform-wide AI assistant with:
 *   - Lead Context Selector (searchable company picker)
 *   - Section Switcher (which part of the diagnostic to work on)
 *   - Apply-ready generated content
 *   - Demo mode when BACKEND_INTEGRATION is false
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Send, Loader2, Sparkles, Bot, ChevronDown,
  CheckCircle2, Copy, Check, RotateCcw, Zap,
  MessageSquare, ArrowRight, Info, AlertCircle,
  Building2, Search, FileText, Target, DollarSign,
  Phone, AlertTriangle,
} from 'lucide-react';
import {
  useGlobalAIChat,
} from '@/app/contexts/GlobalAIChatContext';
import type { ChatSectionContext, ActiveLeadInfo } from '@/app/contexts/GlobalAIChatContext';
import { chatWithAI } from '@/app/services/dataService';
import type { AIChatMessage } from '@/app/services/dataService';
import { getDemoSubmissions } from '@/app/services/dataService';
import { isBackendEnabled, isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';

// ---- Types ------------------------------------------------------------------

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  applyContent?: string;
  appliedTo?: string;
  isLoading?: boolean;
  error?: string;
  timestamp: Date;
}

type IconComponent = (props: { className?: string }) => React.ReactElement | null;

interface QuickAction {
  label: string;
  prompt: string;
  icon: IconComponent;
  color: string;
}

// ---- Section definitions ----------------------------------------------------

const SECTIONS: {
  id: string;
  label: string;
  short: string;
  icon: IconComponent;
}[] = [
  { id: 'general',                  label: 'General Strategy', short: 'Strategy',   icon: Sparkles    },
  { id: 'proposal.executive_brief', label: 'Executive Brief',  short: 'Exec Brief', icon: FileText    },
  { id: 'proposal.diagnosis',       label: 'Diagnosis',        short: 'Diagnosis',  icon: AlertCircle },
  { id: 'recommendation',           label: 'Recommendation',   short: 'Recommend',  icon: Target      },
  { id: 'roi',                      label: 'ROI Summary',      short: 'ROI',        icon: DollarSign  },
  { id: 'call_prep',                label: 'Call Prep',        short: 'Call Prep',  icon: Phone       },
];

// ---- Quick actions per section -----------------------------------------------

const SECTION_QUICK_ACTIONS: Record<string, QuickAction[]> = {
  'proposal.executive_brief': [
    { label: 'Polish Tone',     prompt: 'Polish the tone of this executive brief for C-suite presentation. Make it concise, authoritative, and compelling. Keep all facts intact.',        icon: Sparkles,      color: '#8B5CF6' },
    { label: 'Sharpen Why Now', prompt: 'Strengthen the "why now" urgency argument in this executive brief. Ground it in the operational data and market context provided.',               icon: Zap,           color: '#F59E0B' },
    { label: 'Simplify',        prompt: 'Simplify the language in this executive brief for a non-technical executive audience. Remove any internal consulting language.',                  icon: MessageSquare, color: '#06D7F6' },
  ],
  'proposal.diagnosis': [
    { label: 'Deepen Argument', prompt: 'Deepen the logical argument in this diagnosis block. Add the "what breaks next if unresolved" narrative without inventing new data.',             icon: Sparkles,     color: '#FD4438' },
    { label: 'Exec Language',   prompt: 'Rewrite this diagnosis block in executive-level language. Remove jargon, add business impact framing.',                                           icon: Zap,          color: '#FB923C' },
    { label: 'Add Urgency',     prompt: 'Add compelling urgency framing to this diagnosis. Explain the compounding cost of inaction without fabricating numbers.',                         icon: AlertCircle,  color: '#F59E0B' },
  ],
  'recommendation': [
    { label: 'Strengthen',       prompt: 'Strengthen the recommendation reasoning. Explain why this service is the right first move, grounded in the diagnostic data.',                  icon: Sparkles,     color: '#8B5CF6' },
    { label: 'Why Now',          prompt: 'Generate a compelling "why this recommendation now" argument based on the lead data and diagnostic findings.',                                  icon: Zap,          color: '#10B981' },
    { label: 'Risk of Inaction', prompt: 'Write a brief "risk of inaction" narrative for this recommendation. What happens if the client delays?',                                        icon: AlertCircle,  color: '#FD4438' },
  ],
  'roi': [
    { label: 'ROI Summary',      prompt: 'Generate a clear, executive-ready ROI summary paragraph. Use only the numbers already provided -- do not fabricate new figures.',              icon: Sparkles,     color: '#10B981' },
    { label: 'Conservative',     prompt: 'Write a conservative ROI narrative that manages expectations while still demonstrating clear value.',                                            icon: Info,         color: '#06D7F6' },
    { label: 'Investment Frame', prompt: 'Reframe the ROI as an investment decision rather than a cost. Use the existing figures.',                                                        icon: ArrowRight,   color: '#8B5CF6' },
  ],
  'call_prep': [
    { label: 'Opening Gambit',    prompt: 'Write a strong opening 2-3 sentences for the discovery call with this client, based on their diagnostic profile.',                            icon: Sparkles,     color: '#8B5CF6' },
    { label: 'Handle Objections', prompt: 'Suggest responses to the most likely objections from this type of client in this industry.',                                                  icon: Zap,          color: '#FB923C' },
    { label: 'Closing Language',  prompt: 'Write soft closing language for the call that moves toward a clear next step without being pushy.',                                            icon: ArrowRight,   color: '#10B981' },
  ],
  'general': [
    { label: 'Proposal Strategy', prompt: 'Give me strategic advice on how to approach this proposal for the best chance of conversion.',                                                icon: Sparkles,     color: '#8B5CF6' },
    { label: 'Objection Prep',    prompt: 'What objections should we anticipate from this type of client, and how should we handle them?',                                               icon: Zap,          color: '#FB923C' },
    { label: 'Next Steps',        prompt: 'Suggest the ideal next steps and timeline for moving this deal forward.',                                                                     icon: ArrowRight,   color: '#10B981' },
  ],
};

// ---- Status colour map -------------------------------------------------------

const STATUS_COLOR: Record<string, string> = {
  'new':        '#8B5CF6',
  'in-review':  '#FB923C',
  'completed':  '#06D7F6',
  'approved':   '#10B981',
};

// ---- Build lead roster from demo data ----------------------------------------

function buildLeadRoster(): ActiveLeadInfo[] {
  return getDemoSubmissions().map(s => ({
    id: s.id,
    companyName: s.company,
    contactName: s.contact,
    industry: s.industry,
    status: s.status,
    priority: s.priority,
    roiPotential: s.roiPotential,
    qualityScore: s.qualityScore,
    aiContext: {
      companyName: s.company,
      industry: s.industry,
      companySize: s.employees,
      primaryPainSignal: `${s.industry} business with ${s.employees} employees`,
      recommendedService: undefined,
      roiSummary: s.roiPotential,
    },
  }));
}

// ---- Demo mock responses ----------------------------------------------------

function getMockResponse(
  message: string,
  _section: string,
): { reply: string; applyContent?: string } {
  const lower = message.toLowerCase();

  if (lower.includes('polish') || lower.includes('tone')) {
    return {
      reply: "I've polished the tone for a C-suite audience. The language is now more authoritative and the value proposition is front-loaded.",
      applyContent: `This diagnostic engagement identifies a critical operational inflection point for your organisation. The evidence indicates that current systems are creating compounding friction at a rate that will materially affect capacity within the next two quarters.\n\nThe recommended intervention is sequenced for maximum impact with minimum disruption -- targeting the highest-leverage bottleneck first, then systematically removing downstream constraints.`,
    };
  }
  if (lower.includes('urgency') || lower.includes('why now')) {
    return {
      reply: "Here's a strengthened 'why now' argument grounded in operational timing and market context.",
      applyContent: `The timing for this intervention is material. Operational drag of this nature compounds at approximately 15-20% per quarter when left unresolved. Competitors who have already addressed similar bottlenecks are reporting 35-50% efficiency gains within 90 days of structured intervention.\n\nDelaying action by one quarter is not a neutral decision -- it is an active choice to absorb an increasing cost.`,
    };
  }
  if (lower.includes('roi') || lower.includes('return')) {
    return {
      reply: "Here's an executive-ready ROI framing using your existing figures. All numbers intact -- only the narrative framing has been enhanced.",
      applyContent: `The projected return reflects a conservative model applied to your current operational baseline. The primary value drivers are time recovered from manual processes, cost avoided through earlier issue detection, and revenue leakage reduced through improved pipeline visibility.\n\nAt the conservative estimate, the engagement pays for itself within the first engagement cycle.`,
    };
  }
  if (lower.includes('strengthen') || lower.includes('argument') || lower.includes('reasoning')) {
    return {
      reply: "Here's a strengthened version of the recommendation reasoning with 'why this sequencing' logic added.",
      applyContent: `The recommendation follows the Cortex sequencing principle: resolve constraints before optimisation, fix bottlenecks before growth. This is not a generic recommendation -- it is derived directly from your diagnostic data, which identified this as the highest-leverage point of intervention.\n\nAddressing this first creates the conditions for every downstream improvement to be more effective.`,
    };
  }
  return {
    reply: `Understood. The key principle: the most effective proposals anchor every claim in the diagnostic data. The AI's role is to explain and frame -- the math has already decided the priority.\n\nIs there a specific aspect you'd like me to refine? I can improve tone, strengthen argument, simplify language, or generate a specific narrative block.`,
  };
}

// ============================================================================
// Sub-components
// ============================================================================

// ---- Message Bubble ---------------------------------------------------------

function MessageBubble({
  msg, section, onApply, onCopy, copiedId,
}: {
  msg: ChatMsg;
  section: ChatSectionContext | null;
  onApply: (msg: ChatMsg) => void;
  onCopy: (id: string, text: string) => void;
  copiedId: string | null;
}) {
  const isUser = msg.role === 'user';

  if (msg.isLoading) {
    return (
      <div className="flex items-start gap-2.5 mb-4">
        <div className="size-7 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center flex-shrink-0">
          <Bot className="size-3.5 text-white" />
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-[#8B5CF6] animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="size-1.5 rounded-full bg-[#8B5CF6] animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="size-1.5 rounded-full bg-[#8B5CF6] animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-start gap-2.5 mb-4 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {!isUser && (
        <div className="size-7 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot className="size-3.5 text-white" />
        </div>
      )}

      <div className={`flex flex-col gap-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-gradient-to-br from-[#8B5CF6] to-[#6D28D9] text-white rounded-tr-sm'
              : 'bg-white/5 border border-white/10 text-gray-200 rounded-tl-sm'
          }`}
        >
          {msg.content.split('\n').map((line, i) => {
            const html = line.replace(/\*\*(.*?)\*\*/g, (_, t) => `<strong>${t}</strong>`);
            return (
              <p
                key={i}
                className={i > 0 && line === '' ? 'mt-2' : i > 0 ? 'mt-1' : ''}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          })}
        </div>

        {!isUser && msg.applyContent && (
          <div className="w-full rounded-xl border border-[#8B5CF6]/30 bg-[#8B5CF6]/5 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#8B5CF6]/20">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#8B5CF6]">
                Generated Content
              </span>
              <button
                onClick={() => onCopy(msg.id + '_apply', msg.applyContent!)}
                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white transition-colors"
              >
                {copiedId === msg.id + '_apply'
                  ? <span className="contents"><Check className="size-3 text-[#10B981]" /><span className="text-[#10B981]">Copied</span></span>
                  : <span className="contents"><Copy className="size-3" />Copy</span>}
              </button>
            </div>
            <p className="px-3 py-3 text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
              {msg.applyContent}
            </p>
            {msg.appliedTo ? (
              <div className="px-3 py-2 flex items-center gap-1.5 border-t border-[#8B5CF6]/20">
                <CheckCircle2 className="size-3.5 text-[#10B981]" />
                <span className="text-[11px] text-[#10B981] font-medium">
                  Applied to {section?.sectionLabel ?? 'section'}
                </span>
              </div>
            ) : section ? (
              <div className="px-3 py-2 border-t border-[#8B5CF6]/20">
                <button
                  onClick={() => onApply(msg)}
                  className="w-full py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider text-white transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg, #8B5CF6, #3B82F6)' }}
                >
                  Apply to {section.sectionLabel}
                </button>
              </div>
            ) : null}
          </div>
        )}

        {!isUser && msg.error && (
          <p className="text-xs text-[#FD4438] mt-1">{msg.error}</p>
        )}

        {!isUser && !msg.error && (
          <button
            onClick={() => onCopy(msg.id, msg.content)}
            className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            {copiedId === msg.id
              ? <span className="contents"><Check className="size-3 text-[#10B981]" /><span className="text-[#10B981]">Copied</span></span>
              : <span className="contents"><Copy className="size-3" />Copy response</span>}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ---- Lead Picker Dropdown ---------------------------------------------------

function LeadPickerDropdown({
  roster,
  selectedId,
  onSelect,
  onClose,
}: {
  roster: ActiveLeadInfo[];
  selectedId: string;
  onSelect: (lead: ActiveLeadInfo | undefined) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 60);
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return roster;
    return roster.filter(l =>
      l.companyName.toLowerCase().includes(q) ||
      l.industry.toLowerCase().includes(q) ||
      l.contactName.toLowerCase().includes(q),
    );
  }, [roster, query]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className="absolute top-full left-0 right-0 z-20 mt-1.5 rounded-xl overflow-hidden shadow-2xl"
      style={{
        background: '#0E0E1C',
        border: '1px solid rgba(139,92,246,0.25)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
      }}
    >
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/8">
        <Search className="size-3.5 text-gray-500 flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search companies..."
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-gray-600 hover:text-white">
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* List */}
      <div className="max-h-[260px] overflow-y-auto">
        {/* "No lead" option */}
        <button
          onClick={() => { onSelect(undefined); onClose(); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/4 transition-colors text-left"
        >
          <div className="size-7 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
            <Sparkles className="size-3.5 text-gray-500" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-gray-400">General -- No specific lead</p>
            <p className="text-[10px] text-gray-600">AI works from general strategy context</p>
          </div>
          {!selectedId && <Check className="size-3.5 text-[#10B981] ml-auto" />}
        </button>

        <div className="border-t border-white/6 mx-3" />

        {filtered.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-xs text-gray-500">No companies match "{query}"</p>
          </div>
        ) : (
          filtered.map(lead => (
            <button
              key={lead.id}
              onClick={() => { onSelect(lead); onClose(); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/4 transition-colors text-left ${
                lead.id === selectedId ? 'bg-[#8B5CF6]/8' : ''
              }`}
            >
              {/* Avatar */}
              <div
                className="size-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-white"
                style={{
                  background: `linear-gradient(135deg, ${STATUS_COLOR[lead.status]}40, ${STATUS_COLOR[lead.status]}20)`,
                  border: `1px solid ${STATUS_COLOR[lead.status]}30`,
                }}
              >
                {lead.companyName.slice(0, 2).toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs font-semibold text-white truncate">{lead.companyName}</span>
                  {lead.priority === 'high' && (
                    <span className="size-1.5 rounded-full bg-[#FD4438] flex-shrink-0" />
                  )}
                </div>
                <p className="text-[10px] text-gray-500 truncate">{lead.industry} - {lead.contactName}</p>
              </div>

              {/* Meta */}
              <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                <span
                  className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                  style={{ color: STATUS_COLOR[lead.status], background: `${STATUS_COLOR[lead.status]}18` }}
                >
                  {lead.status}
                </span>
                <span className="text-[10px] font-semibold text-[#10B981]">{lead.roiPotential}</span>
              </div>

              {lead.id === selectedId && (
                <Check className="size-3.5 text-[#10B981] ml-1 flex-shrink-0" />
              )}
            </button>
          ))
        )}
      </div>
    </motion.div>
  );
}

// ---- Lead Context Strip -----------------------------------------------------

function LeadContextStrip({
  activeLead,
  roster,
  onLeadChange,
}: {
  activeLead: ActiveLeadInfo | undefined;
  roster: ActiveLeadInfo[];
  onLeadChange: (lead: ActiveLeadInfo | undefined) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative mx-4 mt-3" style={{ zIndex: 10 }}>
      <button
        onClick={() => setPickerOpen(p => !p)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
          activeLead
            ? 'bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/18'
            : 'bg-[#FD4438]/8 hover:bg-[#FD4438]/12 border border-[#FD4438]/25 hover:border-[#FD4438]/40'
        }`}
      >
        {activeLead ? (
          <span className="contents">
            {/* Avatar */}
            <div
              className="size-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-white"
              style={{
                background: `linear-gradient(135deg, ${STATUS_COLOR[activeLead.status]}50, ${STATUS_COLOR[activeLead.status]}25)`,
                border: `1px solid ${STATUS_COLOR[activeLead.status]}40`,
              }}
            >
              {activeLead.companyName.slice(0, 2).toUpperCase()}
            </div>

            {/* Company info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white truncate">{activeLead.companyName}</span>
                {activeLead.priority === 'high' && (
                  <span
                    className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                    style={{ color: '#FD4438', background: '#FD443815' }}
                  >
                    HOT
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-gray-500 truncate">{activeLead.industry.split(' / ')[0]}</span>
                <span className="text-gray-700">-</span>
                <span className="text-[9px] font-bold uppercase" style={{ color: STATUS_COLOR[activeLead.status] }}>
                  {activeLead.status}
                </span>
                <span className="text-gray-700">-</span>
                <span className="text-[10px] font-semibold text-[#10B981]">{activeLead.roiPotential}</span>
              </div>
            </div>

            {/* Score */}
            <div className="flex flex-col items-end flex-shrink-0">
              <span className="text-xs font-bold text-white">{activeLead.qualityScore}</span>
              <span className="text-[9px] text-gray-600">score</span>
            </div>

            <ChevronDown
              className={`size-3.5 text-gray-500 transition-transform flex-shrink-0 ${pickerOpen ? 'rotate-180' : ''}`}
            />
          </span>
        ) : (
          <span className="contents">
            <div className="size-8 rounded-lg bg-[#FD4438]/15 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="size-4 text-[#FD4438]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#FD4438]">No company selected</p>
              <p className="text-[10px] text-gray-500">Select a company to ground the AI</p>
            </div>
            <ChevronDown
              className={`size-3.5 text-[#FD4438]/60 transition-transform flex-shrink-0 ${pickerOpen ? 'rotate-180' : ''}`}
            />
          </span>
        )}
      </button>

      <AnimatePresence>
        {pickerOpen && (
          <LeadPickerDropdown
            roster={roster}
            selectedId={activeLead?.id ?? ''}
            onSelect={lead => {
              onLeadChange(lead);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- Section Switcher -------------------------------------------------------

function SectionSwitcher({
  activeSectionId,
  onChange,
}: {
  activeSectionId: string;
  onChange: (sectionId: string, sectionLabel: string) => void;
}) {
  return (
    <div className="px-4 pt-2 pb-1">
      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-600 mb-1.5">
        Working on
      </p>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
        {SECTIONS.map(sec => {
          const Icon = sec.icon;
          const isActive = activeSectionId === sec.id;
          return (
            <button
              key={sec.id}
              onClick={() => onChange(sec.id, sec.label)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0 transition-all"
              style={
                isActive
                  ? {
                      background: 'linear-gradient(135deg, #8B5CF620, #3B82F620)',
                      border: '1px solid #8B5CF640',
                      color: '#a78bfa',
                    }
                  : {
                      background: 'transparent',
                      border: '1px solid transparent',
                      color: '#555568',
                    }
              }
            >
              <Icon className="size-3" />
              {sec.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Quick Pill -------------------------------------------------------------

function QuickPill({
  action, onClick, disabled,
}: {
  action: QuickAction;
  onClick: () => void;
  disabled: boolean;
}) {
  const Icon = action.icon;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
      style={{
        background: `${action.color}18`,
        border: `1px solid ${action.color}40`,
        color: action.color,
      }}
    >
      <Icon className="size-3" />
      {action.label}
    </button>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function GlobalAIChat() {
  const {
    isOpen, currentSection, closeChat, openChat,
    applyToSection, accessToken,
    activeLead, setActiveLead,
    setCurrentSection,
  } = useGlobalAIChat();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hasAutoSent, setHasAutoSent] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const roster = useMemo(() => buildLeadRoster(), []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-send quickPrompt when context changes
  useEffect(() => {
    if (isOpen && currentSection?.quickPrompt && hasAutoSent !== currentSection.quickPrompt) {
      setHasAutoSent(currentSection.quickPrompt);
      sendMessage(currentSection.quickPrompt);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentSection]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  // Reset autoSent tracker when section changes
  useEffect(() => {
    setHasAutoSent(null);
  }, [currentSection?.sectionId]);

  // When a trigger fires with a lead, match it to the roster for full info
  useEffect(() => {
    if (currentSection?.lead && !activeLead) {
      const match = roster.find(r => r.aiContext.companyName === currentSection.lead!.companyName);
      if (match) setActiveLead(match);
    }
  }, [currentSection?.lead, activeLead, roster, setActiveLead]);

  const handleSectionSwitch = useCallback(
    (sectionId: string, sectionLabel: string) => {
      setCurrentSection({ sectionId, sectionLabel, lead: activeLead?.aiContext });
    },
    [setCurrentSection, activeLead],
  );

  const handleLeadChange = useCallback(
    (lead: ActiveLeadInfo | undefined) => {
      setActiveLead(lead);
      if (currentSection) {
        setCurrentSection({ ...currentSection, lead: lead?.aiContext });
      }
    },
    [setActiveLead, currentSection, setCurrentSection],
  );

  const buildHistory = useCallback((): AIChatMessage[] => {
    return messages
      .filter(m => !m.isLoading && !m.error)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;

    const userMsg: ChatMsg = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };
    const loadingMsg: ChatMsg = {
      id: `l_${Date.now()}`,
      role: 'assistant',
      content: '',
      isLoading: true,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput('');
    setIsTyping(true);

    const leadCtx = currentSection?.lead ?? activeLead?.aiContext;

    try {
      let reply: string;
      let applyContent: string | undefined;

      if (!isBackendEnabled()) {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 700));
        const mock = getMockResponse(trimmed, currentSection?.sectionId ?? 'general');
        reply = mock.reply;
        applyContent = mock.applyContent;
      } else {
        const res = await chatWithAI(
          {
            message: trimmed,
            section: currentSection?.sectionId ?? 'general',
            sectionLabel: currentSection?.sectionLabel ?? 'General',
            sectionContent: currentSection?.sectionContent,
            lead: leadCtx,
            history: buildHistory(),
          },
          accessToken ?? '',
        );
        reply = res.reply;
        applyContent = res.applyContent;
      }

      setMessages(prev =>
        prev.filter(m => !m.isLoading).concat({
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: reply,
          applyContent,
          timestamp: new Date(),
        }),
      );
    } catch (err: any) {
      setMessages(prev =>
        prev.filter(m => !m.isLoading).concat({
          id: `e_${Date.now()}`,
          role: 'assistant',
          content: 'Something went wrong. Please try again.',
          error: err?.message ?? 'Unknown error',
          timestamp: new Date(),
        }),
      );
    } finally {
      setIsTyping(false);
    }
  }, [isTyping, currentSection, activeLead, accessToken, buildHistory]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleApply = useCallback((msg: ChatMsg) => {
    if (!msg.applyContent || !currentSection) return;
    const success = applyToSection(currentSection.sectionId, msg.applyContent);
    setMessages(prev =>
      prev.map(m =>
        m.id === msg.id
          ? { ...m, appliedTo: success ? currentSection.sectionId : 'clipboard' }
          : m,
      ),
    );
    if (!success) navigator.clipboard.writeText(msg.applyContent).catch(() => null);
  }, [currentSection, applyToSection]);

  const handleCopy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => null);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const activeSectionId = currentSection?.sectionId ?? 'general';
  const quickActions = SECTION_QUICK_ACTIONS[activeSectionId] ?? SECTION_QUICK_ACTIONS['general'];
  const isEmpty = messages.length === 0;

  return (
    <span className="contents">
      {/* ---- Floating trigger ------------------------------------------------ */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            key="trigger"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => openChat()}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl text-white font-semibold text-sm shadow-2xl"
            style={{
              background: 'linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%)',
              boxShadow: '0 8px 32px rgba(139,92,246,0.5)',
            }}
          >
            <span
              className="absolute inset-0 rounded-2xl animate-ping opacity-20"
              style={{ background: 'linear-gradient(135deg, #8B5CF6, #3B82F6)' }}
            />
            <Sparkles className="size-4" />
            <span>Cortex AI</span>
            {activeLead && (
              <span
                className="size-2 rounded-full border border-white/40 flex-shrink-0"
                style={{ background: STATUS_COLOR[activeLead.status] }}
              />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ---- Chat drawer ----------------------------------------------------- */}
      <AnimatePresence>
        {isOpen && (
          <span className="contents">
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeChat}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            />

            <motion.div
              key="panel"
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed right-0 top-0 bottom-0 z-50 flex flex-col w-[440px] max-w-[95vw]"
              style={{
                background: 'linear-gradient(180deg, #0D0D1A 0%, #0A0A14 100%)',
                borderLeft: '1px solid rgba(139,92,246,0.2)',
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-5 py-3.5 border-b"
                style={{ borderColor: 'rgba(139,92,246,0.15)' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="size-8 rounded-xl flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #8B5CF6, #3B82F6)' }}
                  >
                    <Bot className="size-4 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm leading-tight">MARQ Cortex AI</h3>
                    <p className="text-[10px] text-gray-400 leading-tight">
                      {isBackendEnabled() ? 'GPT-4o-mini - Live' : 'Demo Mode'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {messages.length > 0 && (
                    <button
                      onClick={() => { setMessages([]); setHasAutoSent(null); }}
                      className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-gray-400 hover:text-white"
                      title="Clear chat"
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                  )}
                  <button
                    onClick={closeChat}
                    className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-gray-400 hover:text-white"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              {/* Lead Context Strip */}
              <LeadContextStrip
                activeLead={activeLead}
                roster={roster}
                onLeadChange={handleLeadChange}
              />

              {/* Section Switcher */}
              <SectionSwitcher
                activeSectionId={activeSectionId}
                onChange={handleSectionSwitch}
              />

              <div className="mx-4 mt-1 border-t border-white/6" />

              {/* Quick actions */}
              <div className="px-4 py-2.5 flex gap-2 overflow-x-auto scrollbar-none">
                {quickActions.map(action => (
                  <QuickPill
                    key={action.label}
                    action={action}
                    disabled={isTyping}
                    onClick={() => sendMessage(action.prompt)}
                  />
                ))}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
                {isEmpty ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="h-full flex flex-col items-center justify-center text-center px-6"
                  >
                    <div
                      className="size-14 rounded-2xl flex items-center justify-center mb-4"
                      style={{
                        background: 'linear-gradient(135deg, #8B5CF620, #3B82F620)',
                        border: '1px solid rgba(139,92,246,0.2)',
                      }}
                    >
                      <Sparkles className="size-6 text-[#8B5CF6]" />
                    </div>
                    <p className="text-sm font-semibold text-white mb-1.5">
                      {activeLead ? `Ready for ${activeLead.companyName}` : 'How can I help?'}
                    </p>
                    <p className="text-xs text-gray-400 leading-relaxed mb-3">
                      {activeLead
                        ? `AI is grounded on ${activeLead.companyName} (${activeLead.industry.split(' / ')[0]}). Select a section above then use a quick action or type your own instruction.`
                        : 'Select a company above to ground the AI on a specific lead, or ask a general strategy question.'}
                    </p>

                    {/* Active lead context card */}
                    {activeLead && (
                      <div
                        className="w-full rounded-xl p-3 text-left"
                        style={{
                          background: `${STATUS_COLOR[activeLead.status]}0D`,
                          border: `1px solid ${STATUS_COLOR[activeLead.status]}25`,
                        }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Building2 className="size-3.5" style={{ color: STATUS_COLOR[activeLead.status] }} />
                          <span
                            className="text-[10px] font-bold uppercase tracking-widest"
                            style={{ color: STATUS_COLOR[activeLead.status] }}
                          >
                            Active Lead Context
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                          {[
                            { k: 'Company',  v: activeLead.companyName },
                            { k: 'Industry', v: activeLead.industry.split(' / ')[0] },
                            { k: 'Contact',  v: activeLead.contactName },
                            { k: 'ROI',      v: activeLead.roiPotential },
                            { k: 'Status',   v: activeLead.status },
                            { k: 'Score',    v: String(activeLead.qualityScore) },
                          ].map(row => (
                            <div key={row.k}>
                              <p className="text-[9px] text-gray-600 uppercase tracking-wider">{row.k}</p>
                              <p className="text-[11px] text-gray-300 font-medium truncate">{row.v}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!isBackendEnabled() && (
                      <div className="mt-3 px-3 py-2 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/20 w-full">
                        <p className="text-[10px] text-[#F59E0B] font-medium text-center">
                          Demo mode -- set BACKEND_INTEGRATION: true for live GPT-4o-mini
                        </p>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  messages.map(msg => (
                    <MessageBubble
                      key={msg.id}
                      msg={msg}
                      section={currentSection}
                      onApply={handleApply}
                      onCopy={handleCopy}
                      copiedId={copiedId}
                    />
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Context awareness label */}
              {(activeLead || currentSection) && (
                <div
                  className="mx-4 mb-2 px-3 py-1.5 rounded-lg flex items-center gap-2"
                  style={{
                    background: 'rgba(139,92,246,0.06)',
                    border: '1px solid rgba(139,92,246,0.12)',
                  }}
                >
                  <div className="size-1.5 rounded-full bg-[#8B5CF6] animate-pulse flex-shrink-0" />
                  <p className="text-[10px] text-gray-500 truncate">
                    {activeLead && (
                      <span className="text-[#8B5CF6] font-semibold">{activeLead.companyName}</span>
                    )}
                    {activeLead && currentSection && <span className="text-gray-700"> - </span>}
                    {currentSection && <span>{currentSection.sectionLabel}</span>}
                    {!activeLead && !currentSection && 'No context -- general mode'}
                  </p>
                </div>
              )}

              {/* Input */}
              <div
                className="px-4 pb-4 pt-2 border-t"
                style={{ borderColor: 'rgba(255,255,255,0.06)' }}
              >
                <form onSubmit={handleSubmit} className="relative">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      activeLead
                        ? `Ask about ${activeLead.companyName}${currentSection ? ` - ${currentSection.sectionLabel}` : ''}...`
                        : 'Ask anything...'
                    }
                    rows={2}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-[#8B5CF6]/50 transition-colors"
                    disabled={isTyping}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isTyping}
                    className="absolute right-3 bottom-3 size-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-30"
                    style={{ background: 'linear-gradient(135deg, #8B5CF6, #3B82F6)' }}
                  >
                    {isTyping
                      ? <Loader2 className="size-3.5 text-white animate-spin" />
                      : <Send className="size-3.5 text-white" />}
                  </button>
                </form>
                <p className="text-[9px] text-gray-600 mt-1.5 text-center">
                  Enter to send - Shift+Enter for new line - AI never overrides diagnostic scores
                </p>
              </div>
            </motion.div>
          </span>
        )}
      </AnimatePresence>
    </span>
  );
}