/**
 * GLOBAL AI CHAT CONTEXT
 *
 * Provides a platform-wide conversational AI assistant.
 * Any component can:
 *   1. openChat(config?)         — open the panel (optionally pre-loaded with section context)
 *   2. registerApplyHandler      — register a callback so AI can push content into a section
 *   3. unregisterApplyHandler
 *   4. setActiveLead             — set the active company the AI should ground against
 *   5. setCurrentSection         — update section focus without reopening the panel
 */

import { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { AIChatLeadContext } from '@/app/services/dataService';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatSectionContext {
  /** Dot-path id, e.g. "proposal.executive_brief" | "recommendation" | "roi" | "general" */
  sectionId: string;
  /** Human-readable label, e.g. "Executive Brief" */
  sectionLabel: string;
  /** Optional snapshot of current section content fed to the AI as context */
  sectionContent?: string;
  /** Optional lead context */
  lead?: AIChatLeadContext;
  /** If set, this prompt is automatically sent as the first message when the panel opens */
  quickPrompt?: string;
}

/**
 * Richer lead descriptor stored in context — includes display fields for the
 * Lead Selector UI as well as the AIChatLeadContext fed to the API.
 */
export interface ActiveLeadInfo {
  /** Raw submission id, e.g. "DEMO-001" */
  id: string;
  companyName: string;
  contactName: string;
  industry: string;
  status: 'new' | 'in-review' | 'completed' | 'approved';
  priority: 'low' | 'medium' | 'high';
  roiPotential: string;
  qualityScore: number;
  /** Derived context that gets fed to the AI */
  aiContext: AIChatLeadContext;
}

export interface GlobalAIChatContextValue {
  isOpen: boolean;
  currentSection: ChatSectionContext | null;

  /** Open the chat panel, optionally pre-setting a section context */
  openChat: (context?: ChatSectionContext) => void;
  closeChat: () => void;

  /** Update the section the AI is focused on without re-opening the panel */
  setCurrentSection: (ctx: ChatSectionContext | null) => void;

  /**
   * Register a handler for a specific sectionId.
   * When the user clicks "Apply" for an AI response targeting that section,
   * this callback is invoked with the generated content string.
   */
  registerApplyHandler: (sectionId: string, handler: (content: string) => void) => void;
  unregisterApplyHandler: (sectionId: string) => void;

  /** Internal — called by GlobalAIChat when user clicks Apply */
  applyToSection: (sectionId: string, content: string) => boolean;

  /** Shared accessToken so the chat can call the API */
  accessToken: string | undefined;
  setAccessToken: (token: string | undefined) => void;

  /**
   * The company/lead that the AI is grounded against.
   * Any component can set this (e.g. TeamDashboardLayout when CORTEX opens a lead).
   * The chat panel also lets the user switch leads via its built-in picker.
   */
  activeLead: ActiveLeadInfo | undefined;
  setActiveLead: (lead: ActiveLeadInfo | undefined) => void;

  /** @deprecated — use activeLead instead */
  defaultLeadContext: AIChatLeadContext | undefined;
  setDefaultLeadContext: (ctx: AIChatLeadContext | undefined) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const Ctx = createContext<GlobalAIChatContextValue | null>(null);

export function GlobalAIChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentSection, setCurrentSection] = useState<ChatSectionContext | null>(null);
  const [accessToken, setAccessToken] = useState<string | undefined>(undefined);
  const [defaultLeadContext, setDefaultLeadContext] = useState<AIChatLeadContext | undefined>(undefined);
  const [activeLead, setActiveLead] = useState<ActiveLeadInfo | undefined>(undefined);

  // Map of sectionId → apply callback
  const applyHandlers = useRef<Map<string, (content: string) => void>>(new Map());

  const openChat = useCallback((context?: ChatSectionContext) => {
    if (context) {
      setCurrentSection(context);
      if (context.lead) {
        setActiveLead(prev => {
          if (prev) return prev;
          return {
            id: '',
            companyName: context.lead!.companyName,
            contactName: '',
            industry: context.lead!.industry,
            status: 'new' as const,
            priority: 'medium' as const,
            roiPotential: context.lead!.roiSummary ?? '',
            qualityScore: 0,
            aiContext: context.lead!,
          };
        });
      }
    }
    setIsOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const registerApplyHandler = useCallback(
    (sectionId: string, handler: (content: string) => void) => {
      applyHandlers.current.set(sectionId, handler);
    },
    [],
  );

  const unregisterApplyHandler = useCallback((sectionId: string) => {
    applyHandlers.current.delete(sectionId);
  }, []);

  const applyToSection = useCallback((sectionId: string, content: string): boolean => {
    const handler = applyHandlers.current.get(sectionId);
    if (handler) {
      handler(content);
      return true;
    }
    return false;
  }, []);

  const value: GlobalAIChatContextValue = useMemo(() => ({
    isOpen,
    currentSection,
    openChat,
    closeChat,
    setCurrentSection,
    registerApplyHandler,
    unregisterApplyHandler,
    applyToSection,
    accessToken,
    setAccessToken,
    activeLead,
    setActiveLead,
    defaultLeadContext,
    setDefaultLeadContext,
  }), [
    isOpen, currentSection,
    openChat, closeChat, setCurrentSection,
    registerApplyHandler, unregisterApplyHandler, applyToSection,
    accessToken, activeLead, defaultLeadContext,
  ]);

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}

export function useGlobalAIChat(): GlobalAIChatContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useGlobalAIChat must be used inside GlobalAIChatProvider');
  }
  return ctx;
}