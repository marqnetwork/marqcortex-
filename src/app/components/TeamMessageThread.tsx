/**
 * TEAM MESSAGE THREAD — Phase 4B
 *
 * Team-facing conversation panel inside CORTEX lead detail.
 * Auto-marks client messages as read on open.
 * Bubbles layout: client left (dark), team right (gradient).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send, MessageSquare, Brain, Loader2, RefreshCw, User,
  Inbox, AlertCircle, X, CheckCheck, CornerDownLeft,
} from 'lucide-react';
import { getTeamMessages, postTeamReply, type Message } from '@/app/services/dataService';
import { FEATURES } from '@/config/features';

const MAX_CHARS = 2000;

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
  companyName: string;
  contactName?: string;
  accessToken?: string;
  onUnreadCountChange?: (count: number) => void;
}

export function TeamMessageThread({
  submissionId, companyName, contactName, accessToken, onUnreadCountChange,
}: Props) {
  const [messages, setMessages]     = useState<Message[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [isSending, setIsSending]   = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [draft, setDraft]           = useState('');
  const [wasUnread, setWasUnread]   = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Get current team user name from localStorage
  const teamUserName = (() => {
    try { return JSON.parse(localStorage.getItem('team_user') || '{}').name || 'Team'; }
    catch { return 'Team'; }
  })();

  const load = useCallback(async (silent = false) => {
    if (!accessToken) { setIsLoading(false); return; }
    if (!silent) setIsLoading(true);
    try {
      if (!FEATURES.BACKEND_INTEGRATION) {
        if (FEATURES.VERBOSE_LOGGING && !silent) {
          console.log('📦 Using demo data for team messages (backend disabled)');
        }
        const demoMessages: Message[] = [
          {
            id: 'demo_team_msg_1',
            submissionId,
            author: 'client',
            authorName: contactName || 'Client',
            content: 'When will my report be ready?',
            createdAt: new Date(Date.now() - 7200000).toISOString(),
          },
          {
            id: 'demo_team_msg_2',
            submissionId,
            author: 'team',
            authorName: teamUserName,
            content: 'Your report is being finalized now. You\'ll receive it within the next hour!',
            createdAt: new Date(Date.now() - 3600000).toISOString(),
          },
        ];
        setMessages(demoMessages);
        setWasUnread(0);
        onUnreadCountChange?.(0);
        setError(null);
        setIsLoading(false);
        return;
      }

      const res = await getTeamMessages(submissionId, accessToken);
      setMessages(res.messages ?? []);
      if (!silent && res.unreadFromClient > 0) {
        setWasUnread(res.unreadFromClient);
      }
      onUnreadCountChange?.(0); // just marked read by the GET call
      setError(null);
    } catch (err: any) {
      if (FEATURES.VERBOSE_LOGGING && !silent) {
        console.error('❌ Failed to load team messages:', err);
      }
      if (!silent && !FEATURES.SHOW_API_ERRORS) {
        const demoMessages: Message[] = [];
        setMessages(demoMessages);
        setError(null);
      } else if (!silent) {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [submissionId, accessToken, onUnreadCountChange, contactName, teamUserName]);

  useEffect(() => { load(); }, [load]);

  // Scroll to bottom when messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || isSending || !accessToken) return;

    // Optimistic add
    const optimistic: Message = {
      id:          `opt_${Date.now()}`,
      submissionId,
      author:      'team',
      authorName:  teamUserName,
      content,
      createdAt:   new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setDraft('');
    setIsSending(true);

    try {
      const res = await postTeamReply(submissionId, content, accessToken, teamUserName);
      setMessages(prev => prev.map(m => m.id === optimistic.id ? res.message : m));
    } catch (err: any) {
      setError(err.message);
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
  const clientMessages = messages.filter(m => m.author === 'client');

  return (
    <div className="flex flex-col h-full min-h-[560px]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-4">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-gradient-to-br from-[#06D7F6]/20 to-[#3B82F6]/20 border border-[#06D7F6]/25 flex items-center justify-center">
            <MessageSquare className="size-5 text-[#06D7F6]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-white">Client Messages</h2>
              {wasUnread > 0 && (
                <span className="px-2 py-0.5 bg-[#FD4438] text-white text-[10px] font-bold rounded-full animate-pulse">
                  {wasUnread} new
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">
              {companyName}{contactName ? ` · ${contactName}` : ''}
            </p>
          </div>
        </div>
        <button
          onClick={() => load(true)}
          className="p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mb-3 px-4 py-2.5 bg-[#FD4438]/10 border border-[#FD4438]/25 rounded-xl text-xs text-[#FD4438] flex items-center justify-between">
          <span><AlertCircle className="size-3.5 inline mr-1.5" />{error}</span>
          <button onClick={() => setError(null)}><X className="size-3.5" /></button>
        </div>
      )}

      {/* ── No token state ── */}
      {!accessToken && (
        <div className="flex-1 flex items-center justify-center py-16 text-center">
          <div>
            <MessageSquare className="size-10 text-white/20 mx-auto mb-3" />
            <p className="text-white/40 text-sm">Team authentication required</p>
          </div>
        </div>
      )}

      {/* ── Thread ── */}
      {accessToken && (
        <span className="contents">
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0 pb-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-6 text-[#8B5CF6] animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <TeamEmptyState companyName={companyName} contactName={contactName} />
            ) : (
              messages.map((msg, i) => {
                const isTeam = msg.author === 'team';
                const prevMsg = messages[i - 1];
                const showDateDivider = !prevMsg ||
                  new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

                return (
                  <div key={msg.id}>
                    {showDateDivider && (
                      <div className="flex items-center gap-3 my-2">
                        <div className="flex-1 h-px bg-white/5" />
                        <span className="text-[10px] text-gray-700 px-2">
                          {new Date(msg.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                        <div className="flex-1 h-px bg-white/5" />
                      </div>
                    )}
                    <TeamBubble msg={msg} isTeam={isTeam} />
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {/* ── Reply box ── */}
          <div className="mt-4 pt-4 border-t border-white/10">
            {/* No client messages yet hint */}
            {clientMessages.length === 0 && messages.length === 0 && (
              <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-[#8B5CF6]/8 border border-[#8B5CF6]/15 rounded-xl text-xs text-gray-500">
                <Inbox className="size-3.5 text-[#8B5CF6]/50 flex-shrink-0" />
                No messages yet. The client can send messages from their portal.
              </div>
            )}

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
                placeholder={`Reply to ${contactName || companyName}…`}
                rows={3}
                className="w-full bg-transparent text-white placeholder:text-gray-700 text-sm resize-none outline-none px-4 pt-3.5 pb-10 leading-relaxed"
              />
              <div className="absolute bottom-3 left-4 right-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {draft.length > 1500 && (
                    <span className={`text-xs ${charsLeft < 200 ? 'text-[#FD4438]' : 'text-gray-600'}`}>
                      {charsLeft}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-700 flex items-center gap-1">
                    <CornerDownLeft className="size-3" />⌘↵ to send
                  </span>
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
                  {isSending ? 'Sending…' : 'Reply to Client'}
                </button>
              </div>
            </div>

            <p className="text-[10px] text-gray-700 mt-2 text-center">
              Client will see your reply in their portal on next refresh
            </p>
          </div>
        </span>
      )}
    </div>
  );
}

// ── Team-side bubble ──────────────────────────────────────────────────────────

function TeamBubble({ msg, isTeam }: { msg: Message; isTeam: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isTeam ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      <div className={`size-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
        isTeam
          ? 'bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] text-white'
          : 'bg-white/8 border border-white/15 text-gray-300'
      }`}>
        {isTeam ? <Brain className="size-4" /> : <User className="size-4" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[75%] flex flex-col gap-1 ${isTeam ? 'items-end' : 'items-start'}`}>
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isTeam
            ? 'bg-gradient-to-br from-[#8B5CF6] to-[#7C3AED] text-white rounded-tr-sm'
            : 'bg-white/6 border border-white/10 text-gray-200 rounded-tl-sm'
        }`}>
          {msg.content}
        </div>
        <div className={`flex items-center gap-2 text-[10px] text-gray-600 ${isTeam ? 'flex-row-reverse' : ''}`}>
          <span className="font-medium">{isTeam ? msg.authorName : msg.authorName}</span>
          <span>·</span>
          <span>{timeAgo(msg.createdAt)}</span>
          {isTeam && <CheckCheck className="size-3 text-[#8B5CF6]/40" />}
        </div>
      </div>
    </motion.div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function TeamEmptyState({ companyName, contactName }: { companyName: string; contactName?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="py-16 flex flex-col items-center gap-4 text-center"
    >
      <div className="size-16 rounded-2xl bg-white/3 border border-white/8 flex items-center justify-center">
        <Inbox className="size-7 text-white/20" />
      </div>
      <div>
        <h3 className="font-semibold text-white/70 mb-1">No messages yet</h3>
        <p className="text-gray-600 text-sm max-w-xs leading-relaxed">
          When {contactName || companyName} sends a message from their portal, it will appear here.
          You can also start the conversation proactively.
        </p>
      </div>
    </motion.div>
  );
}