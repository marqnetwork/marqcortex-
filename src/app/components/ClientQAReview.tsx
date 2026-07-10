/**
 * CLIENT Q&A REVIEW
 *
 * Phase 4: Client-facing read-only review of their diagnostic responses.
 * Shows in the Client Portal under a "Your Assessment" tab.
 *
 * Unlike the internal QATranscriptSheet (which shows signals and bottleneck links),
 * this component shows a clean, professional view of their answers with
 * AI-generated readiness indicators and simple category grouping.
 *
 * Dark theme matching the Client Portal design.
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, ChevronDown, ChevronRight, CheckCircle2,
  AlertCircle, Circle, Search,
} from 'lucide-react';
import type { Submission } from '@/app/services/dataService';
import {
  getQuestionsForIndustry,
  assessMaturity,
  type QuestionDef,
} from '@/app/utils/questionRegistry';

// ── Props ─────────────────────────────────────────────────────────────────────

interface ClientQAReviewProps {
  submission: Submission;
  companyName: string;
}

// ── Maturity labels for client-facing display ─────────────────────────────────

const MATURITY_CLIENT_LABELS = ['', 'Getting Started', 'Developing', 'Established', 'Strong', 'Optimised'];
const MATURITY_COLORS = ['', '#FD4438', '#FB923C', '#FBBF24', '#10B981', '#10B981'];

// ── Main Component ────────────────────────────────────────────────────────────

export function ClientQAReview({ submission, companyName }: ClientQAReviewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const industry = submission.industry || submission.industryId || 'other';
  const questions = getQuestionsForIndustry(industry);
  const answers = submission.answers || {};

  // Build QA pairs grouped by category
  const grouped = useMemo(() => {
    const groups: Record<string, { question: QuestionDef; answer: string; maturity: 1|2|3|4|5 }[]> = {};
    for (const q of questions) {
      const raw = answers[q.id];
      if (raw === undefined || raw === null) continue;
      const answerText = String(raw).trim();
      if (!answerText) continue;

      if (!groups[q.category]) groups[q.category] = [];
      groups[q.category].push({
        question: q,
        answer: answerText,
        maturity: assessMaturity(answerText),
      });
    }
    return groups;
  }, [questions, answers]);

  const categories = Object.keys(grouped);

  // Auto-expand all on first render
  useMemo(() => {
    if (expandedCategories.size === 0 && categories.length > 0) {
      setExpandedCategories(new Set(categories));
    }
  }, [categories.length]);

  // Filter
  const filteredGroups = useMemo(() => {
    if (!searchQuery) return grouped;
    const q = searchQuery.toLowerCase();
    const result: typeof grouped = {};
    for (const [cat, items] of Object.entries(grouped)) {
      const filtered = items.filter(item =>
        item.question.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q)
      );
      if (filtered.length > 0) result[cat] = filtered;
    }
    return result;
  }, [grouped, searchQuery]);

  const totalAnswered = Object.values(grouped).reduce((s, g) => s + g.length, 0);
  const totalQuestions = questions.length;

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#8B5CF6]/10 to-[#3B82F6]/10 border border-[#8B5CF6]/20 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-xl bg-[#8B5CF6]/20 flex items-center justify-center">
            <FileText className="size-6 text-[#8B5CF6]" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-white mb-1">
              Your Diagnostic Responses
            </h2>
            <p className="text-sm text-gray-400">
              Review the answers you submitted for {companyName}&apos;s operational diagnostic.
              {totalAnswered < totalQuestions && (
                <span className="text-[#FB923C] ml-1">
                  ({totalAnswered} of {totalQuestions} questions answered)
                </span>
              )}
              {totalAnswered === totalQuestions && (
                <span className="text-[#10B981] ml-1">
                  All {totalQuestions} questions answered
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search your responses..."
            className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-[#8B5CF6]/50"
          />
        </div>
      </div>

      {/* Category sections */}
      {Object.entries(filteredGroups).map(([category, items]) => {
        const isExpanded = expandedCategories.has(category);
        const avgMaturity = Math.round(items.reduce((s, i) => s + i.maturity, 0) / items.length) as 1|2|3|4|5;

        return (
          <div
            key={category}
            className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden"
          >
            <button
              onClick={() => toggleCategory(category)}
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isExpanded
                  ? <ChevronDown className="size-4 text-[#8B5CF6]" />
                  : <ChevronRight className="size-4 text-gray-400" />
                }
                <h3 className="text-base font-bold text-white">{category}</h3>
                <span className="text-xs text-gray-500">{items.length} responses</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: MATURITY_COLORS[avgMaturity] }}>
                  {MATURITY_CLIENT_LABELS[avgMaturity]}
                </span>
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map(i => (
                    <Circle
                      key={i}
                      className="size-2"
                      fill={i <= avgMaturity ? MATURITY_COLORS[avgMaturity] : 'transparent'}
                      stroke={i <= avgMaturity ? MATURITY_COLORS[avgMaturity] : '#4B5563'}
                      strokeWidth={1.5}
                    />
                  ))}
                </div>
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
                  <div className="px-5 pb-4 space-y-4">
                    {items.map(({ question, answer, maturity }) => (
                      <div
                        key={question.id}
                        className="rounded-xl p-4"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        {/* Question */}
                        <div className="flex items-start gap-3 mb-3">
                          <span className="flex-shrink-0 size-7 rounded-full bg-[#8B5CF6]/20 text-[#8B5CF6] flex items-center justify-center text-xs font-bold">
                            {question.id}
                          </span>
                          <p className="text-sm font-semibold text-gray-200 leading-relaxed">
                            {question.question}
                          </p>
                        </div>

                        {/* Answer */}
                        <div className="ml-10">
                          <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap">
                            {answer}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {Object.keys(filteredGroups).length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <FileText className="size-8 mx-auto mb-3 opacity-50" />
          <p>No responses found.</p>
        </div>
      )}
    </div>
  );
}