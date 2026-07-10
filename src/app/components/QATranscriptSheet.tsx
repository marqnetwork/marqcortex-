/**
 * Q&A TRANSCRIPT SHEET
 *
 * Full question-and-answer sheet for the CORTEX Diagnostic tab.
 * Shows every question asked, the client's answer, and AI-detected signals.
 *
 * Features:
 * - Grouped by category with collapsible sections
 * - Color-coded signal chips (red=pain, orange=risk, green=opportunity, blue=strength)
 * - Maturity indicator per answer (1-5 dots)
 * - Answer → Bottleneck links (click to see which core problems this answer feeds)
 * - Bottleneck → Answer reverse links (from core problems, see source answers)
 * - Search/filter capability
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Search, ChevronDown, ChevronRight, AlertTriangle,
  Zap, Shield, TrendingUp, Filter, Eye, EyeOff, Link2,
  ArrowRight, Circle,
} from 'lucide-react';
import type { AnnotatedResponse } from '@/app/utils/questionRegistry';
import { getBottleneckLabel } from '@/app/utils/questionRegistry';

// ── Signal colors ─────────────────────────────────────────────────────────────

const SIGNAL_COLORS: Record<string, { bg: string; text: string; border: string; icon: typeof AlertTriangle }> = {
  pain:        { bg: 'rgba(253,68,56,0.12)',  text: '#FD4438', border: 'rgba(253,68,56,0.3)',  icon: AlertTriangle },
  risk:        { bg: 'rgba(251,146,60,0.12)', text: '#FB923C', border: 'rgba(251,146,60,0.3)', icon: Shield },
  opportunity: { bg: 'rgba(16,185,129,0.12)', text: '#10B981', border: 'rgba(16,185,129,0.3)', icon: Zap },
  strength:    { bg: 'rgba(59,130,246,0.12)', text: '#3B82F6', border: 'rgba(59,130,246,0.3)', icon: TrendingUp },
};

const MATURITY_LABELS = ['', 'Very Low', 'Low', 'Moderate', 'Good', 'Excellent'];

// ── Props ─────────────────────────────────────────────────────────────────────

interface QATranscriptSheetProps {
  annotatedResponses: AnnotatedResponse[];
  bottleneckSourceMap?: Record<string, number[]>;
  /** Called when user clicks a bottleneck link to scroll to CoreProblem */
  onBottleneckClick?: (bottleneckId: string) => void;
  /** Called when user clicks a source answer reference from CoreProblem */
  highlightQuestionId?: number | null;
}

// ── Main component ────────────────────────────────────────────────────────────

export function QATranscriptSheet({
  annotatedResponses,
  bottleneckSourceMap,
  onBottleneckClick,
  highlightQuestionId,
}: QATranscriptSheetProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [signalFilter, setSignalFilter] = useState<string | null>(null);
  const [showSignals, setShowSignals] = useState(true);
  const [expandAll, setExpandAll] = useState(false);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, AnnotatedResponse[]> = {};
    for (const resp of annotatedResponses) {
      if (!groups[resp.category]) groups[resp.category] = [];
      groups[resp.category].push(resp);
    }
    return groups;
  }, [annotatedResponses]);

  const categories = Object.keys(grouped);

  // Initialize all categories as expanded
  useMemo(() => {
    if (expandedCategories.size === 0 && categories.length > 0) {
      setExpandedCategories(new Set(categories));
    }
  }, [categories.length]);

  // Filter responses
  const filteredGroups = useMemo(() => {
    const result: Record<string, AnnotatedResponse[]> = {};
    for (const [cat, resps] of Object.entries(grouped)) {
      const filtered = resps.filter(r => {
        // Search filter
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const matchesText = r.questionText.toLowerCase().includes(q)
            || r.answer.toLowerCase().includes(q)
            || r.detectedSignals.some(s => s.label.toLowerCase().includes(q));
          if (!matchesText) return false;
        }
        // Signal type filter
        if (signalFilter) {
          if (!r.detectedSignals.some(s => s.type === signalFilter)) return false;
        }
        return true;
      });
      if (filtered.length > 0) result[cat] = filtered;
    }
    return result;
  }, [grouped, searchQuery, signalFilter]);

  const totalSignals = annotatedResponses.reduce((sum, r) => sum + r.detectedSignals.length, 0);
  const signalCounts = useMemo(() => {
    const counts: Record<string, number> = { pain: 0, risk: 0, opportunity: 0, strength: 0 };
    for (const r of annotatedResponses) {
      for (const s of r.detectedSignals) {
        counts[s.type] = (counts[s.type] || 0) + 1;
      }
    }
    return counts;
  }, [annotatedResponses]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleExpandAll = () => {
    if (expandAll) {
      setExpandedCategories(new Set());
    } else {
      setExpandedCategories(new Set(Object.keys(filteredGroups)));
    }
    setExpandAll(!expandAll);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <FileText className="size-5 text-[#06D7F6]" />
            Full Q&A Transcript
            <span className="text-sm font-normal text-gray-400 ml-2">
              {annotatedResponses.length} responses &middot; {totalSignals} signals detected
            </span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSignals(!showSignals)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
              style={{
                backgroundColor: showSignals ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.05)',
                border: showSignals ? '1px solid rgba(139,92,246,0.4)' : '1px solid rgba(255,255,255,0.1)',
                color: showSignals ? '#C4B5FD' : '#9CA3AF',
              }}
            >
              {showSignals ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              AI Signals
            </button>
            <button
              onClick={handleExpandAll}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-gray-400 hover:text-white transition-colors"
            >
              {expandAll ? 'Collapse All' : 'Expand All'}
            </button>
          </div>
        </div>

        {/* Signal summary bar */}
        <div className="flex items-center gap-3 mb-4">
          {(['pain', 'risk', 'opportunity', 'strength'] as const).map(type => {
            const colors = SIGNAL_COLORS[type];
            const count = signalCounts[type];
            const isActive = signalFilter === type;
            return (
              <button
                key={type}
                onClick={() => setSignalFilter(isActive ? null : type)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                style={{
                  backgroundColor: isActive ? colors.bg : 'transparent',
                  border: `1px solid ${isActive ? colors.border : 'rgba(255,255,255,0.08)'}`,
                  color: isActive ? colors.text : '#6B7280',
                }}
              >
                <colors.icon className="size-3" />
                {type} ({count})
              </button>
            );
          })}
          {signalFilter && (
            <button
              onClick={() => setSignalFilter(null)}
              className="text-xs text-gray-500 hover:text-white transition-colors ml-1"
            >
              Clear filter
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search questions, answers, or signals..."
            className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-[#8B5CF6]/50"
          />
        </div>
      </div>

      {/* Q&A Cards by category */}
      {Object.entries(filteredGroups).map(([category, responses]) => (
        <CategorySection
          key={category}
          category={category}
          responses={responses}
          isExpanded={expandedCategories.has(category)}
          onToggle={() => toggleCategory(category)}
          showSignals={showSignals}
          onBottleneckClick={onBottleneckClick}
          highlightQuestionId={highlightQuestionId}
        />
      ))}

      {Object.keys(filteredGroups).length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Filter className="size-8 mx-auto mb-3 opacity-50" />
          <p>No responses match your filter.</p>
        </div>
      )}
    </div>
  );
}

// ── Category Section ──────────────────────────────────────────────────────────

function CategorySection({
  category,
  responses,
  isExpanded,
  onToggle,
  showSignals,
  onBottleneckClick,
  highlightQuestionId,
}: {
  category: string;
  responses: AnnotatedResponse[];
  isExpanded: boolean;
  onToggle: () => void;
  showSignals: boolean;
  onBottleneckClick?: (id: string) => void;
  highlightQuestionId?: number | null;
}) {
  const totalPain = responses.reduce((s, r) => s + r.detectedSignals.filter(sig => sig.type === 'pain').length, 0);
  const avgMaturity = Math.round(responses.reduce((s, r) => s + r.maturityIndicator, 0) / responses.length);

  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded
            ? <ChevronDown className="size-4 text-[#8B5CF6]" />
            : <ChevronRight className="size-4 text-gray-400" />
          }
          <h4 className="text-base font-bold text-white">{category}</h4>
          <span className="text-xs text-gray-500">{responses.length} questions</span>
        </div>
        <div className="flex items-center gap-4">
          {totalPain > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(253,68,56,0.15)', color: '#FD4438' }}>
              {totalPain} pain signals
            </span>
          )}
          <MaturityDots score={avgMaturity as 1|2|3|4|5} />
        </div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 space-y-3">
              {responses.map(resp => (
                <AnswerCard
                  key={resp.questionId}
                  response={resp}
                  showSignals={showSignals}
                  onBottleneckClick={onBottleneckClick}
                  isHighlighted={highlightQuestionId === resp.questionId}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Answer Card ───────────────────────────────────────────────────────────────

function AnswerCard({
  response,
  showSignals,
  onBottleneckClick,
  isHighlighted,
}: {
  response: AnnotatedResponse;
  showSignals: boolean;
  onBottleneckClick?: (id: string) => void;
  isHighlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = response.answer.length > 200;
  const displayAnswer = isLong && !expanded
    ? response.answer.substring(0, 200) + '...'
    : response.answer;

  return (
    <div
      id={`qa-answer-${response.questionId}`}
      className="rounded-xl p-4 transition-all"
      style={{
        backgroundColor: isHighlighted ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.03)',
        border: isHighlighted ? '1px solid rgba(139,92,246,0.5)' : '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Question */}
      <div className="flex items-start gap-3 mb-3">
        <span className="flex-shrink-0 size-7 rounded-full bg-[#8B5CF6]/20 text-[#8B5CF6] flex items-center justify-center text-xs font-bold">
          Q{response.questionId}
        </span>
        <p className="text-sm font-semibold text-gray-200 leading-relaxed">
          {response.questionText}
        </p>
      </div>

      {/* Answer */}
      <div className="ml-10 mb-3">
        <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap">
          {displayAnswer}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-[#8B5CF6] hover:text-[#A78BFA] mt-1 transition-colors"
          >
            {expanded ? 'Show less' : 'Read full answer'}
          </button>
        )}
      </div>

      {/* Bottom row: Signals + Maturity + Bottleneck links */}
      <div className="ml-10 flex flex-wrap items-center gap-2">
        {/* Maturity indicator */}
        <div className="flex items-center gap-1 mr-3" title={`Maturity: ${MATURITY_LABELS[response.maturityIndicator]}`}>
          <MaturityDots score={response.maturityIndicator} />
          <span className="text-[10px] text-gray-500 ml-1">{MATURITY_LABELS[response.maturityIndicator]}</span>
        </div>

        {/* Signal chips */}
        {showSignals && response.detectedSignals.map((signal, idx) => {
          const colors = SIGNAL_COLORS[signal.type];
          return (
            <span
              key={idx}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: colors.bg,
                color: colors.text,
                border: `1px solid ${colors.border}`,
              }}
              title={`${signal.confidence} confidence | Keywords: ${signal.matchedKeywords.join(', ')}`}
            >
              <colors.icon className="size-2.5" />
              {signal.label}
              {signal.confidence === 'high' && (
                <span className="ml-0.5 opacity-60">***</span>
              )}
              {signal.confidence === 'medium' && (
                <span className="ml-0.5 opacity-60">**</span>
              )}
            </span>
          );
        })}

        {/* Bottleneck links */}
        {response.linkedBottlenecks.length > 0 && (
          <div className="flex items-center gap-1 ml-auto">
            <Link2 className="size-3 text-gray-600" />
            {response.linkedBottlenecks.map(bn => (
              <button
                key={bn}
                onClick={() => onBottleneckClick?.(bn)}
                className="text-[10px] font-medium text-[#06D7F6]/80 hover:text-[#06D7F6] transition-colors flex items-center gap-0.5"
              >
                <ArrowRight className="size-2.5" />
                {getBottleneckLabel(bn)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Maturity Dots ─────────────────────────────────────────────────────────────

function MaturityDots({ score }: { score: 1 | 2 | 3 | 4 | 5 }) {
  const colors = ['#FD4438', '#FB923C', '#FBBF24', '#10B981', '#10B981'];
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Circle
          key={i}
          className="size-2"
          fill={i <= score ? colors[score - 1] : 'transparent'}
          stroke={i <= score ? colors[score - 1] : '#4B5563'}
          strokeWidth={1.5}
        />
      ))}
    </div>
  );
}

// ── Source Answers Badge (used in CoreProblemCard) ─────────────────────────────

export function SourceAnswersBadge({
  sourceAnswers,
  onClickAnswer,
}: {
  sourceAnswers: number[];
  onClickAnswer?: (questionId: number) => void;
}) {
  if (!sourceAnswers || sourceAnswers.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
        Based on:
      </span>
      {sourceAnswers.map(qId => (
        <button
          key={qId}
          onClick={() => onClickAnswer?.(qId)}
          className="px-2 py-0.5 rounded-full text-[10px] font-bold transition-all hover:scale-105"
          style={{
            backgroundColor: 'rgba(6,215,246,0.12)',
            color: '#06D7F6',
            border: '1px solid rgba(6,215,246,0.3)',
          }}
          title={`Scroll to answer Q${qId}`}
        >
          Q{qId}
        </button>
      ))}
    </div>
  );
}
