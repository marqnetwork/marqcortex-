/**
 * INLINE AI TRIGGER
 *
 * Reusable pill-shaped "Generate: [Action] - [Section]" button.
 * When clicked, opens the Global AI Chat with:
 *   1. The section context pre-loaded
 *   2. An optional quickPrompt auto-sent as the first message
 *
 * Matches the design shown in the screenshot: gradient pill with ✦ icon.
 */

import React from 'react';
import { Sparkles, Zap, MessageSquare, Bot, ArrowRight } from 'lucide-react';
import { useGlobalAIChat, type ChatSectionContext } from '@/app/contexts/GlobalAIChatContext';
import type { AIChatLeadContext } from '@/app/services/dataService';

// ── Types ─────────────────────────────────────────────────────────────────────

interface InlineAITriggerProps {
  /** Display label: "Polish Tone", "Strengthen Argument", etc. */
  label: string;
  /** The section identifier */
  sectionId: string;
  /** Human-readable section label */
  sectionLabel: string;
  /** Auto-prompt to fire when chat opens (optional) */
  quickPrompt?: string;
  /** Current content of the section (fed to AI as context) */
  sectionContent?: string;
  /** Lead context for AI awareness */
  leadContext?: AIChatLeadContext;
  /** Visual variant */
  variant?: 'pill' | 'ghost' | 'compact';
  /** Icon to show */
  icon?: 'sparkles' | 'zap' | 'message' | 'bot' | 'arrow';
  /** Override gradient colours [from, to] */
  colors?: [string, string];
  /** Extra class */
  className?: string;
}

const ICONS = {
  sparkles: Sparkles,
  zap:      Zap,
  message:  MessageSquare,
  bot:      Bot,
  arrow:    ArrowRight,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function InlineAITrigger({
  label,
  sectionId,
  sectionLabel,
  quickPrompt,
  sectionContent,
  leadContext,
  variant = 'pill',
  icon = 'sparkles',
  colors = ['#8B5CF6', '#3B82F6'],
  className = '',
}: InlineAITriggerProps) {
  const { openChat } = useGlobalAIChat();

  const Icon = ICONS[icon];

  const handleClick = () => {
    const ctx: ChatSectionContext = {
      sectionId,
      sectionLabel,
      sectionContent,
      lead: leadContext,
      quickPrompt,
    };
    openChat(ctx);
  };

  // ── Pill variant (matches screenshot style) ────────────────────────────
  if (variant === 'pill') {
    return (
      <button
        onClick={handleClick}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all hover:opacity-90 active:scale-[0.97] ${className}`}
        style={{
          background: `linear-gradient(135deg, ${colors[0]}18, ${colors[1]}18)`,
          border: `1px solid ${colors[0]}35`,
          color: colors[0],
        }}
      >
        <Icon className="size-3" />
        <span>Generate: {label}</span>
        <span
          className="text-[9px] font-black opacity-60 ml-0.5"
          style={{ color: colors[1] }}
        >
          — {sectionLabel}
        </span>
      </button>
    );
  }

  // ── Compact variant ────────────────────────────────────────────────────
  if (variant === 'compact') {
    return (
      <button
        onClick={handleClick}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all hover:opacity-90 active:scale-[0.97] ${className}`}
        style={{
          background: `${colors[0]}15`,
          border: `1px solid ${colors[0]}25`,
          color: colors[0],
        }}
      >
        <Icon className="size-2.5" />
        AI
      </button>
    );
  }

  // ── Ghost variant ──────────────────────────────────────────────────────
  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:bg-white/5 text-gray-400 hover:text-white border border-transparent hover:border-white/10 ${className}`}
    >
      <Icon className="size-3" />
      {label}
    </button>
  );
}

// ── Convenience: AI Toolbar (row of multiple triggers) ───────────────────────

interface AIToolbarProps {
  sectionId: string;
  sectionLabel: string;
  sectionContent?: string;
  leadContext?: AIChatLeadContext;
  actions: { label: string; prompt: string; icon?: InlineAITriggerProps['icon'] }[];
}

export function AIToolbar({
  sectionId,
  sectionLabel,
  sectionContent,
  leadContext,
  actions,
}: AIToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map(action => (
        <InlineAITrigger
          key={action.label}
          label={action.label}
          sectionId={sectionId}
          sectionLabel={sectionLabel}
          sectionContent={sectionContent}
          leadContext={leadContext}
          quickPrompt={action.prompt}
          icon={action.icon ?? 'sparkles'}
          variant="pill"
        />
      ))}
    </div>
  );
}