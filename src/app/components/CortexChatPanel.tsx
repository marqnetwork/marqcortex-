/**
 * CORTEX CHAT PANEL — Live Recalculation via Natural Language
 *
 * Wires parseChatToChangeRequest into the UI so messages like
 * "update tickets to 350" trigger the deterministic recalc pipeline
 * and refresh the dashboard in real-time.
 *
 * Also provides mock GPT-4o-mini narrative generation for:
 *   - why_now
 *   - confidence_reasoning
 *   - strategic_decision
 *
 * When isBackendEnabled() is true, calls the real GPT-4o-mini
 * endpoint on the server. Falls back to deterministic mock narratives
 * when false (demo mode).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Send, Brain, Sparkles, AlertTriangle,
  CheckCircle2, Loader2, Zap,
} from 'lucide-react';
import { parseChatToChangeRequest, applyChangeRequest, revertToVersion } from '@/app/core/versionEngine';
import type { PortfolioState, RecalcResult } from '@/app/core/types';
import { isBackendEnabled, isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';
import { generateCortexNarrative, type NarrativeContext } from '@/app/services/dataService';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

interface ChatMessage {
  id: string;
  role: 'user' | 'system';
  content: string;
  timestamp: string;
  /** If this message triggered a recalc, store result metadata */
  recalcResult?: {
    success: boolean;
    newVersion: string;
    summary: string;
    changedSections: string[];
  };
  /** For system messages that are narratives */
  narrative?: {
    type: 'why_now' | 'confidence_reasoning' | 'strategic_decision';
    text: string;
    isLive?: boolean;  // true = real GPT-4o-mini, false/undefined = mock
  };
}

interface CortexChatPanelProps {
  portfolioState: PortfolioState | undefined;
  companyName: string;
  onPortfolioUpdate: (newState: PortfolioState, result: RecalcResult) => void;
  accessToken?: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// MOCK NARRATIVE GENERATION (GPT-4o-mini stub)
// ════════════════════════════════════════════════════════════════════════════════

function generateMockNarrative(
  type: 'why_now' | 'confidence_reasoning' | 'strategic_decision',
  state: PortfolioState,
): string {
  const company = state.inputs.business_snapshot.company;
  const industry = state.inputs.business_snapshot.industry;
  const recs = state.outputs.recommendations;
  const topRec = recs[0];
  const confidence = topRec?.confidence_model?.confidence_score ?? 0;
  const version = state.current_version;

  switch (type) {
    case 'why_now':
      return `${company} is currently operating with ${state.inputs.assumptions.support_tickets_per_week} support tickets/week and a ${state.inputs.assumptions.avg_response_time_hours}hr average response time. At the current trajectory, the compounding operational drag will increase by approximately 15-20% per quarter. The ${industry} market is shifting toward automation-first support models, and competitors who have already implemented similar solutions are seeing 40-60% efficiency gains. Delaying action by even one quarter risks an additional $${Math.round((state.inputs.assumptions.monthly_revenue ?? 0) * 0.08).toLocaleString()}/month in hidden costs. Version ${version} analysis confirms the urgency window is narrowing.`;

    case 'confidence_reasoning':
      return `Confidence score of ${confidence}/100 is derived from three weighted components: priority signal strength (40% weight — ${recs.length} qualifying recommendations with pattern strength above threshold), feasibility assessment (30% weight — technical and organizational readiness scores indicate moderate-to-high execution capability), and evidence validation (30% weight — ${topRec?.evidence_strength?.validated_signals ?? 0} validated signals with ${topRec?.evidence_strength?.cross_department_validations ?? 0} cross-department corroborations). ${topRec?.evidence_strength?.contradiction_flags ?? 0} contradiction flags were detected, which ${(topRec?.evidence_strength?.contradiction_flags ?? 0) > 2 ? 'moderately reduces' : 'does not significantly affect'} overall confidence. The score reflects deterministic calculation, not AI opinion.`;

    case 'strategic_decision':
      return `The recommendation to address "${topRec?.core_problem?.problem_title ?? 'the primary bottleneck'}" first is a math-driven decision, not an AI preference. Domain scoring ranked this problem ${topRec?.priority_score?.computed_priority?.toFixed(1) ?? '0'}/10 in computed priority, with an impact score of ${topRec?.priority_score?.impact_score ?? 0}/10 and feasibility of ${topRec?.priority_score?.feasibility_score ?? 0}/10. The sequencing logic follows Cortex rules: resolve constraints before optimization, bottlenecks before growth, data gaps before AI implementation. This recommendation unlocks downstream value for ${recs.length > 1 ? `the remaining ${recs.length - 1} recommendation(s)` : 'future optimizations'} in the portfolio.`;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════════════════════════════════════════

export function CortexChatPanel({
  portfolioState,
  companyName,
  onPortfolioUpdate,
  accessToken,
}: CortexChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showPulse, setShowPulse] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initial welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        id: 'welcome',
        role: 'system',
        content: `Welcome to the CORTEX recalculation engine for **${companyName}**. You can:\n\n• Update assumptions: *"set tickets to 350"*\n• Change constraints: *"update margin to 55"*\n• Request explanations: *"why this recommendation?"*\n• Approve versions: *"approve"* or *"lock"*\n• Generate narratives: *"explain why now"*\n\nEvery change triggers a full deterministic pipeline recalculation.`,
        timestamp: new Date().toISOString(),
      }]);
    }
  }, [companyName]);

  // Pulse animation on load
  useEffect(() => {
    const timer = setTimeout(() => setShowPulse(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, {
      ...msg,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    }]);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing) return;
    addMessage({ role: 'user', content: text });
    setIsProcessing(true);

    // Small delay for UX feel
    await new Promise(r => setTimeout(r, 300));

    try {
      // Check for narrative generation requests
      const lower = text.toLowerCase();
      if (lower.includes('explain why now') || lower.includes('why now')) {
        if (portfolioState) {
          const narrative = await generateNarrative('why_now', portfolioState, accessToken);
          addMessage({
            role: 'system',
            content: narrative,
            narrative: { type: 'why_now', text: narrative, isLive: isBackendEnabled() },
          });
        } else {
          addMessage({ role: 'system', content: 'No portfolio state available. Complete a diagnostic first.' });
        }
        setIsProcessing(false);
        return;
      }

      if (lower.includes('confidence') && (lower.includes('explain') || lower.includes('reasoning') || lower.includes('why'))) {
        if (portfolioState) {
          const narrative = await generateNarrative('confidence_reasoning', portfolioState, accessToken);
          addMessage({
            role: 'system',
            content: narrative,
            narrative: { type: 'confidence_reasoning', text: narrative, isLive: isBackendEnabled() },
          });
        } else {
          addMessage({ role: 'system', content: 'No portfolio state available.' });
        }
        setIsProcessing(false);
        return;
      }

      if (lower.includes('strategic') || (lower.includes('why') && lower.includes('first'))) {
        if (portfolioState) {
          const narrative = await generateNarrative('strategic_decision', portfolioState, accessToken);
          addMessage({
            role: 'system',
            content: narrative,
            narrative: { type: 'strategic_decision', text: narrative, isLive: isBackendEnabled() },
          });
        } else {
          addMessage({ role: 'system', content: 'No portfolio state available.' });
        }
        setIsProcessing(false);
        return;
      }

      // Check for revert commands
      const revertMatch = lower.match(/revert\s+(?:to\s+)?v(\d+)/);
      if (revertMatch && portfolioState) {
        const targetVersion = `v${revertMatch[1]}`;
        const result = revertToVersion(portfolioState, targetVersion);
        if (result.success) {
          onPortfolioUpdate(result.state, result);
          addMessage({
            role: 'system',
            content: `Successfully reverted to ${targetVersion}. ${result.summary}`,
            recalcResult: {
              success: true,
              newVersion: result.new_version,
              summary: result.summary,
              changedSections: result.changed_sections,
            },
          });
        } else {
          addMessage({
            role: 'system',
            content: `Revert failed: ${result.error || result.summary}`,
          });
        }
        setIsProcessing(false);
        return;
      }

      // Parse chat message to ChangeRequest
      const changeRequest = parseChatToChangeRequest(text);

      if (!changeRequest) {
        addMessage({
          role: 'system',
          content: `I couldn't parse a specific change from that message. Try:\n\n• *"set tickets to 350"*\n• *"update revenue to 500000"*\n• *"change margin to 60"*\n• *"approve"* to lock the version\n• *"explain why now"* for narratives\n• *"revert to v1"* to roll back`,
        });
        setIsProcessing(false);
        return;
      }

      if (!portfolioState) {
        addMessage({
          role: 'system',
          content: 'No portfolio state available for this lead. Complete a diagnostic assessment first.',
        });
        setIsProcessing(false);
        return;
      }

      // Handle RequestExplanation
      if (changeRequest.type === 'RequestExplanation') {
        const topRec = portfolioState.outputs.recommendations[0];
        if (topRec) {
          addMessage({
            role: 'system',
            content: `**${topRec.core_problem.problem_title}** was selected as the primary recommendation because:\n\n` +
              `• Severity: ${topRec.core_problem.severity_score}/10\n` +
              `• Impact Score: ${topRec.priority_score.impact_score}/10\n` +
              `• Feasibility: ${topRec.priority_score.feasibility_score}/10\n` +
              `• Computed Priority: ${topRec.priority_score.computed_priority}/10\n` +
              `• Confidence: ${topRec.confidence_model.confidence_score}/100\n\n` +
              `${topRec.strategic_decision.why_first}\n\nMath decides priority. LLM only explains decisions.`,
          });
        } else {
          addMessage({ role: 'system', content: 'No recommendations available to explain.' });
        }
        setIsProcessing(false);
        return;
      }

      // Handle ApproveVersion
      if (changeRequest.type === 'ApproveVersion') {
        const result = applyChangeRequest(portfolioState, changeRequest);
        onPortfolioUpdate(result.state, result);
        addMessage({
          role: 'system',
          content: `Version **${result.new_version}** has been approved and locked for proposal/export.`,
          recalcResult: {
            success: result.success,
            newVersion: result.new_version,
            summary: result.summary,
            changedSections: result.changed_sections,
          },
        });
        setIsProcessing(false);
        return;
      }

      // Handle UpdatePriorityPreference (no recalc needed)
      if (changeRequest.type === 'UpdatePriorityPreference') {
        addMessage({
          role: 'system',
          content: `Priority preference noted: "${changeRequest.preference_note}". This is a soft preference — the scoring engine still uses the deterministic formula. If you want to change assumptions that affect scoring, use "set [field] to [value]".`,
        });
        setIsProcessing(false);
        return;
      }

      // Apply the change request (UpdateAssumption, UpdateConstraint, ClarifyAnswer)
      const result = applyChangeRequest(portfolioState, changeRequest, 'team_user', 'chat');

      if (result.success) {
        onPortfolioUpdate(result.state, result);

        const deltaLines = result.state.history[0]?.delta_log.map(d => {
          const field = d.path.split('.').pop()?.replace(/_/g, ' ') ?? d.path;
          return `• **${field}**: ${d.old} → ${d.new_value}`;
        }).join('\n') || '';

        const engineList = result.changed_sections.join(', ') || 'none';

        addMessage({
          role: 'system',
          content: `Pipeline recalculated → **${result.new_version}**\n\n${deltaLines}\n\nRecalculated engines: ${engineList}\n\n${result.summary}`,
          recalcResult: {
            success: true,
            newVersion: result.new_version,
            summary: result.summary,
            changedSections: result.changed_sections,
          },
        });
      } else {
        addMessage({
          role: 'system',
          content: `Recalculation failed: ${result.error || result.summary}`,
          recalcResult: {
            success: false,
            newVersion: result.new_version,
            summary: result.summary,
            changedSections: [],
          },
        });
      }
    } catch (err) {
      console.log('[CortexChatPanel] Error:', err);
      addMessage({
        role: 'system',
        content: `An error occurred while processing your request: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, portfolioState, onPortfolioUpdate, addMessage, accessToken]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (text) {
      setInput('');
      sendMessage(text);
    }
  }, [input, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Quick action buttons
  const quickActions = [
    { label: 'Explain why now', icon: Sparkles },
    { label: 'Why this first?', icon: Brain },
    { label: 'Explain confidence', icon: Zap },
  ];

  return (
    <span className="contents">
      {/* Floating Toggle Button */}
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.5, type: 'spring' }}
        onClick={() => {
          setIsOpen(!isOpen);
          setShowPulse(false);
        }}
        className={`fixed bottom-6 right-6 z-50 size-14 rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 ${
          isOpen
            ? 'bg-[#0A0A0F] border border-[#8B5CF6]/50'
            : 'bg-gradient-to-br from-[#8B5CF6] to-[#06D7F6]'
        }`}
      >
        {isOpen ? (
          <X className="size-6 text-white" />
        ) : (
          <Brain className="size-6 text-white" />
        )}
        {!isOpen && showPulse && (
          <motion.div
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 rounded-full bg-[#8B5CF6]/30"
          />
        )}
        {!isOpen && (
          <span className="absolute -top-1 -right-1 size-4 bg-[#06D7F6] rounded-full border-2 border-[#0A0A0F] flex items-center justify-center">
            <span className="text-[8px] font-black text-black">AI</span>
          </span>
        )}
      </motion.button>

      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-24 right-6 w-[420px] max-w-[calc(100vw-3rem)] h-[560px] max-h-[calc(100vh-8rem)] bg-[#0A0A0F] border border-[#8B5CF6]/30 rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#8B5CF6]/20 to-[#06D7F6]/20 border-b border-white/10 p-4 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#06D7F6] flex items-center justify-center">
                  <Brain className="size-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-white text-sm">CORTEX Engine</h3>
                  <p className="text-[10px] text-gray-400">
                    {portfolioState
                      ? `${portfolioState.current_version} · ${portfolioState.outputs.recommendations.length} recs`
                      : 'No portfolio loaded'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-2 rounded-full bg-[#10B981] animate-pulse" />
                  <span className="text-[10px] text-gray-500">Live</span>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map(msg => (
                <ChatBubble key={msg.id} message={msg} />
              ))}
              {isProcessing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 px-4 py-2"
                >
                  <Loader2 className="size-4 text-[#8B5CF6] animate-spin" />
                  <span className="text-xs text-gray-500">Running pipeline...</span>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Actions */}
            <div className="px-4 py-2 border-t border-white/5 flex-shrink-0">
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {quickActions.map(action => (
                  <button
                    key={action.label}
                    onClick={() => sendMessage(action.label.toLowerCase())}
                    disabled={isProcessing}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-white/5 hover:bg-[#8B5CF6]/15 border border-white/10 hover:border-[#8B5CF6]/30 text-gray-400 hover:text-white transition-all whitespace-nowrap disabled:opacity-50"
                  >
                    <action.icon className="size-3" />
                    {action.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Input */}
            <div className="p-3 border-t border-white/10 flex-shrink-0">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder='Try "set tickets to 350"...'
                  disabled={isProcessing}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#8B5CF6]/50 focus:ring-1 focus:ring-[#8B5CF6]/25 disabled:opacity-50 transition-colors"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isProcessing}
                  className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#06D7F6] flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition-opacity"
                >
                  <Send className="size-4 text-white" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// CHAT BUBBLE
// ════════════════════════════════════════════════════════════════════════════════

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] text-white'
            : 'bg-white/[0.04] border border-white/10 text-gray-300'
        }`}
      >
        {/* Narrative badge */}
        {message.narrative && (
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="size-3 text-[#06D7F6]" />
            <span className="text-[9px] font-black uppercase tracking-wider text-[#06D7F6]">
              {message.narrative.type.replace(/_/g, ' ')}
            </span>
            <span className="text-[8px] text-gray-600 ml-auto">GPT-4o-mini ({message.narrative.isLive ? 'live' : 'mock'})</span>
          </div>
        )}

        {/* Recalc result badge */}
        {message.recalcResult && (
          <div className={`flex items-center gap-1.5 mb-2 px-2 py-1 rounded-lg text-[10px] font-bold ${
            message.recalcResult.success
              ? 'bg-[#10B981]/10 text-[#10B981]'
              : 'bg-[#FD4438]/10 text-[#FD4438]'
          }`}>
            {message.recalcResult.success ? (
              <CheckCircle2 className="size-3" />
            ) : (
              <AlertTriangle className="size-3" />
            )}
            {message.recalcResult.success ? 'PIPELINE RECALCULATED' : 'RECALC FAILED'}
            <span className="ml-auto font-mono">{message.recalcResult.newVersion}</span>
          </div>
        )}

        {/* Content with basic markdown-like bold */}
        <div className="whitespace-pre-wrap text-[13px]">
          {renderContent(message.content)}
        </div>

        {/* Changed sections pills */}
        {message.recalcResult?.success && message.recalcResult.changedSections.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-white/5">
            {message.recalcResult.changedSections.map(s => (
              <span key={s} className="text-[8px] px-1.5 py-0.5 rounded bg-[#8B5CF6]/10 text-[#8B5CF6] font-semibold">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Simple bold markdown renderer */
function renderContent(text: string) {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold text-white">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i} className="italic text-gray-400">{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// NARRATIVE GENERATION
// ════════════════════════════════════════════════════════════════════════════════

async function generateNarrative(
  type: 'why_now' | 'confidence_reasoning' | 'strategic_decision',
  state: PortfolioState,
  token?: string,
): Promise<string> {
  if (isBackendEnabled() && token) {
    try {
      const topRec = state.outputs.recommendations[0];
      const context: NarrativeContext = {
        company: state.inputs.business_snapshot.company,
        industry: state.inputs.business_snapshot.industry,
        employee_estimate: state.inputs.business_snapshot.employee_estimate,
        current_version: state.current_version,
        assumptions: { ...state.inputs.assumptions },
        recommendation_count: state.outputs.recommendations.length,
        ...(topRec ? {
          top_recommendation: {
            problem_title: topRec.core_problem?.problem_title ?? 'Unknown',
            severity_score: topRec.core_problem?.severity_score ?? 0,
            pillar_impact: topRec.core_problem?.pillar_impact ?? [],
            confidence_score: topRec.confidence_model?.confidence_score ?? 0,
            priority_score: {
              impact_score: topRec.priority_score?.impact_score ?? 0,
              feasibility_score: topRec.priority_score?.feasibility_score ?? 0,
              risk_score: topRec.priority_score?.risk_score ?? 0,
              computed_priority: topRec.priority_score?.computed_priority ?? 0,
            },
            why_first: topRec.strategic_decision?.why_first ?? '',
            ...(topRec.evidence_strength ? {
              evidence_strength: {
                validated_signals: topRec.evidence_strength.validated_signals ?? 0,
                cross_department_validations: topRec.evidence_strength.cross_department_validations ?? 0,
                contradiction_flags: topRec.evidence_strength.contradiction_flags ?? 0,
              },
            } : {}),
          },
        } : {}),
      };
      const response = await generateCortexNarrative(type, context, token);
      return response.narrative;
    } catch (err) {
      console.log('[CortexChatPanel] Narrative API failed, falling back to mock:', err);
      return generateMockNarrative(type, state);
    }
  }
  return generateMockNarrative(type, state);
}