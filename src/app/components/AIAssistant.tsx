/**
 * 💬 AI ASSISTANT DURING DIAGNOSTIC
 * 
 * PROBLEM: 20% abandon diagnostic mid-way (confused or need help)
 * SOLUTION: Smart AI assistant provides guidance in real-time
 * 
 * FEATURES:
 * - Contextual help for each question
 * - Shows examples based on industry
 * - Suggests answers based on previous responses
 * - Encouragement at key points
 * - Progress celebrations
 * 
 * EXPECTED IMPACT: +15% completion rate (80% → 95%)
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageCircle, X, Lightbulb, TrendingUp, Sparkles, CheckCircle2 } from 'lucide-react';
import { generateContextualHelp, type AssistantMessage } from '@/app/core/diagnosticAssistantHelp';

interface AIAssistantProps {
  currentQuestion: string;
  questionNumber: number;
  totalQuestions: number;
  industry: string;
  previousAnswers?: Array<{ question: string; answer: string }>;
  onSuggestionClick?: (suggestion: string) => void;
}

export function AIAssistant({
  currentQuestion,
  questionNumber,
  totalQuestions,
  industry,
  previousAnswers = [],
  onSuggestionClick
}: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [showPulse, setShowPulse] = useState(true);

  // Generate contextual help when question changes
  useEffect(() => {
    const help = generateContextualHelp(currentQuestion, questionNumber, totalQuestions, industry, previousAnswers);
    setMessages([help]);
    
    // Show pulse for new questions
    setShowPulse(true);
    setTimeout(() => setShowPulse(false), 3000);
  }, [currentQuestion]);

  // Auto-open on first question
  useEffect(() => {
    if (questionNumber === 1) {
      setTimeout(() => setIsOpen(true), 1000);
    }
  }, []);

  return (
    <span className="contents">
      {/* Floating Button */}
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.5, type: 'spring' }}
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 size-14 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] shadow-2xl flex items-center justify-center z-50 transition-all hover:scale-110 ${
          showPulse ? 'animate-bounce' : ''
        }`}
      >
        {isOpen ? (
          <X className="size-6 text-white" />
        ) : (
          <MessageCircle className="size-6 text-white" />
        )}
        
        {/* Notification Badge */}
        {!isOpen && showPulse && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 size-5 bg-[#FD4438] rounded-full border-2 border-[#0A0A0F] flex items-center justify-center"
          >
            <span className="text-xs font-bold text-white">!</span>
          </motion.div>
        )}
      </motion.button>

      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-6 w-96 max-w-[calc(100vw-3rem)] bg-[#0A0A0F] border border-[#8B5CF6]/30 rounded-2xl shadow-2xl z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] p-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-white/20 flex items-center justify-center">
                  <Sparkles className="size-5 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-white">AI Assistant</h3>
                  <p className="text-xs text-white/70">Here to help you</p>
                </div>
                <div className="flex items-center gap-1">
                  <div className="size-2 rounded-full bg-[#10B981] animate-pulse" />
                  <span className="text-xs text-white/70">Active</span>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
              {messages.map((msg, idx) => (
                <AssistantMessageBubble
                  key={idx}
                  message={msg}
                  onSuggestionClick={onSuggestionClick}
                />
              ))}
            </div>

            {/* Progress Footer */}
            <div className="border-t border-white/10 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-white/60">Your Progress</span>
                <span className="text-xs font-bold text-[#06D7F6]">
                  {questionNumber}/{totalQuestions} questions
                </span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(questionNumber / totalQuestions) * 100}%` }}
                  transition={{ duration: 0.5 }}
                  className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#06D7F6]"
                />
              </div>
              {questionNumber === totalQuestions && (
                <motion.p
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-[#10B981] mt-2 font-semibold flex items-center gap-1"
                >
                  <CheckCircle2 className="size-3" />
                  Final question! You're almost done!
                </motion.p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

// ============================================================================
// MESSAGE BUBBLE
// ============================================================================

function AssistantMessageBubble({
  message,
  onSuggestionClick
}: {
  message: AssistantMessage;
  onSuggestionClick?: (suggestion: string) => void;
}) {
  const getIcon = () => {
    switch (message.type) {
      case 'help':
        return <Lightbulb className="size-4 text-[#FB923C]" />;
      case 'encouragement':
        return <TrendingUp className="size-4 text-[#10B981]" />;
      case 'suggestion':
        return <Sparkles className="size-4 text-[#06D7F6]" />;
      case 'insight':
        return <CheckCircle2 className="size-4 text-[#8B5CF6]" />;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-3"
    >
      {/* Message */}
      <div className="flex gap-3">
        <div className="flex-shrink-0 size-8 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
          {getIcon()}
        </div>
        <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3">
          <p className="text-sm text-white/80 leading-relaxed">{message.content}</p>
        </div>
      </div>

      {/* Suggestions */}
      {message.suggestions && message.suggestions.length > 0 && (
        <div className="ml-11 space-y-2">
          <p className="text-xs text-white/50">Quick options:</p>
          {message.suggestions.map((suggestion, idx) => (
            <button
              key={idx}
              onClick={() => onSuggestionClick?.(suggestion)}
              className="block w-full text-left px-3 py-2 bg-[#8B5CF6]/20 hover:bg-[#8B5CF6]/30 border border-[#8B5CF6]/30 rounded-lg text-sm text-white/80 transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
