/**
 * CLIENT MESSAGING — Phase 4B
 *
 * Client-facing conversation widget inside the portal.
 * Polls every 15s for team replies. Bubbles layout:
 *   Client → right (purple)
 *   Team   → left (dark card with gradient avatar)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send, MessageSquare, Brain, Loader2, RefreshCw,
  CheckCheck, Clock, Sparkles, X,
} from 'lucide-react';
import {
  getClientMessages, postClientMessage, trackEngagement,
  getDemoMessages, type Message, type ClientAuthContext,
} from '@/app/services/dataService';
import { isBackendEnabled, isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';

const MAX_CHARS = 1000;

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Props {
  submissionId: string;
  clientName: string;
  companyName: string;
  clientAuth?: ClientAuthContext;
}

export function ClientMessaging({ submissionId, clientName, companyName, clientAuth }: Props) {
  const [messages, setMessages]       = useState<Message[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [isSending, setIsSending]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [draft, setDraft]             = useState('');
  const [newReplyBanner, setNewReplyBanner] = useState(false);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const textareaRef= useRef<HTMLTextAreaElement>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevCountRef = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      if (!isBackendEnabled()) {
        if (isVerboseLogging() && !silent) {
          console.log('Using rich demo data for client messaging (backend disabled)');
        }
        const demoMessages = getDemoMessages(submissionId, clientName);
        setMessages(prev => {
          // Preserve any optimistic messages sent during this session
          const optimistic = prev.filter(m => m.id.startsWith('opt_') || m.id.startsWith('demo_local_'));
          // Merge demo messages with local messages
          const existingLocalIds = new Set(prev.filter(m => m.id.startsWith('local_')).map(m => m.id));
          const localMsgs = prev.filter(m => existingLocalIds.has(m.id));
          return [...demoMessages, ...localMsgs, ...optimistic];
        });
        setError(null);
        setIsLoading(false);
        return;
      }

      const res = await getClientMessages(submissionId, clientAuth);
      const incoming = res.messages ?? [];

      // Detect new team replies since last load
      const teamCount = incoming.filter(m => m.author === 'team').length;
      if (silent && teamCount > prevCountRef.current) {
        setNewReplyBanner(true);
        setTimeout(() => setNewReplyBanner(false), 5000);
      }
      prevCountRef.current = teamCount;

      setMessages(incoming);
      setError(null);
    } catch (err: any) {
      if (isVerboseLogging() && !silent) {
        console.error('Failed to load messages:', err);
      }
      if (!silent && !shouldShowApiErrors()) {
        const demoMessages: Message[] = [];
        setMessages(demoMessages);
        setError(null);
      } else if (!silent) {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [submissionId, clientName, clientAuth]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(() => load(true), 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || isSending) return;

    // Optimistic add
    const optimistic: Message = {
      id:          `opt_${Date.now()}`,
      submissionId,
      author:      'client',
      authorName:  clientName,
      content,
      createdAt:   new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setDraft('');
    setIsSending(true);

    try {
      if (!isBackendEnabled()) {
        // Demo mode: keep the optimistic message and simulate a delay
        await new Promise(resolve => setTimeout(resolve, 400));
        const localMsg: Message = {
          ...optimistic,
          id: `local_${Date.now()}`,
        };
        setMessages(prev => prev.map(m => m.id === optimistic.id ? localMsg : m));
      } else {
        const res = await postClientMessage(submissionId, content, clientName, clientAuth);
        // Replace optimistic message with real one
        setMessages(prev => prev.map(m => m.id === optimistic.id ? res.message : m));
        // 13C: track message_sent event (fire-and-forget)
        trackEngagement(submissionId, 'message_sent', undefined, clientAuth);
      }
    } catch (err: any) {
      setError(err.message);
      // Remove optimistic on failure
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setDraft(content);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const charsLeft = MAX_CHARS - draft.length;

  return (
    <div className="flex flex-col h-full min-h-[600px] max-w-3xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-4">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
            <MessageSquare className="size-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-white">Messages</h2>
            <p className="text-xs text-gray-500">Ask our team anything about your diagnostic</p>
          </div>
        </div>
        <button
          onClick={() => load(true)}
          className="p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          title="Refresh messages"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      {/* ── New reply banner ── */}
      <AnimatePresence>
        {newReplyBanner && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            className="flex items-center gap-3 mb-3 px-4 py-3 bg-[#10B981]/10 border border-[#10B981]/30 rounded-xl text-sm text-[#10B981]"
          >
            <Sparkles className="size-4 flex-shrink-0" />
            <span className="font-medium">Our team replied to your message!</span>
            <button onClick={() => setNewReplyBanner(false)} className="ml-auto">
              <X className="size-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Error ── */}
      {error && (
        <div className="mb-3 px-4 py-2.5 bg-[#FD4438]/10 border border-[#FD4438]/25 rounded-xl text-xs text-[#FD4438] flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-3"><X className="size-3.5" /></button>
        </div>
      )}

      {/* ── Thread ── */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0 pb-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 text-[#8B5CF6] animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} isClient={msg.author === 'client'} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Compose ── */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <div className={`relative rounded-2xl border transition-all ${
          draft.length > 0
            ? 'border-[#8B5CF6]/50 bg-[#8B5CF6]/5'
            : 'border-white/10 bg-white/3'
        }`}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question or leave a comment for our team…"
            rows={3}
            className="w-full bg-transparent text-white placeholder:text-gray-600 text-sm resize-none outline-none px-4 pt-3.5 pb-10 leading-relaxed"
          />

          {/* Compose footer */}
          <div className="absolute bottom-3 left-4 right-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {draft.length > 700 && (
                <span className={`text-xs ${charsLeft < 100 ? 'text-[#FD4438]' : 'text-gray-500'}`}>
                  {charsLeft} left
                </span>
              )}
              <span className="text-[10px] text-gray-700">⌘↵ to send</span>
            </div>
            <button
              onClick={handleSend}
              disabled={!draft.trim() || isSending}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-lg text-xs font-semibold text-white hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSending
                ? <Loader2 className="size-3.5 animate-spin" />
                : <Send className="size-3.5" />
              }
              {isSending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>

        <p className="text-[10px] text-gray-700 mt-2 text-center">
          Messages are private — only visible to you and our team
        </p>
      </div>
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg, isClient }: { msg: Message; isClient: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isClient ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      <div className={`size-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
        isClient
          ? 'bg-[#8B5CF6]/20 border border-[#8B5CF6]/30 text-[#8B5CF6]'
          : 'bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] text-white'
      }`}>
        {isClient
          ? msg.authorName.charAt(0).toUpperCase()
          : <Brain className="size-4" />
        }
      </div>

      {/* Bubble */}
      <div className={`max-w-[75%] ${isClient ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
          isClient
            ? 'bg-gradient-to-br from-[#8B5CF6] to-[#7C3AED] text-white rounded-tr-sm'
            : 'bg-white/8 border border-white/10 text-gray-200 rounded-tl-sm'
        }`}>
          {msg.content}
        </div>

        {/* Meta */}
        <div className={`flex items-center gap-2 text-[10px] text-gray-600 ${isClient ? 'flex-row-reverse' : ''}`}>
          <span>{isClient ? 'You' : msg.authorName}</span>
          <span>·</span>
          <span>{timeAgo(msg.createdAt)}</span>
          {isClient && <CheckCheck className="size-3 text-[#8B5CF6]/50" />}
        </div>
      </div>
    </motion.div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="py-16 flex flex-col items-center gap-4 text-center"
    >
      <div className="size-16 rounded-2xl bg-gradient-to-br from-[#8B5CF6]/20 to-[#3B82F6]/10 border border-[#8B5CF6]/20 flex items-center justify-center">
        <MessageSquare className="size-7 text-[#8B5CF6]/60" />
      </div>
      <div>
        <h3 className="font-semibold text-white mb-1">Start the conversation</h3>
        <p className="text-gray-500 text-sm max-w-xs leading-relaxed">
          Have a question about your diagnostic results, timeline, or next steps? 
          Our team typically replies within a few hours.
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
        {[
          'What does my readiness score mean?',
          'How long until my report is ready?',
          'Can we schedule a call sooner?',
        ].map(prompt => (
          <button
            key={prompt}
            className="w-full text-left px-4 py-2.5 bg-white/4 border border-white/8 rounded-xl text-xs text-gray-400 hover:bg-white/8 hover:text-white transition-all"
          >
            "{prompt}"
          </button>
        ))}
      </div>
    </motion.div>
  );
}