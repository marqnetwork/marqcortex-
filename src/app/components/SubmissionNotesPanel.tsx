/**
 * SUBMISSION NOTES PANEL — Phase 3B
 *
 * Internal team notes attached to a CORTEX submission.
 * Persisted in Supabase KV. Only visible to authenticated team members.
 *
 * Note types:
 *   note    — general observation (default, grey)
 *   action  — required follow-up task (orange)
 *   flag    — urgent / escalation (red)
 *   insight — strategic observation (purple/blue)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  MessageSquare, Plus, Trash2, RefreshCw, AlertTriangle,
  Zap, Lightbulb, StickyNote, Send, Lock, Clock,
} from 'lucide-react';
import { getNotes, addNote, deleteNote, type Note } from '@/app/services/dataService';
import { isBackendEnabled, isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';
import { asArray } from '@/app/lib/payload';
import {
  brand,
  status as STATUS,
  text as TEXT,
} from '@/app/lib/tokens';


// ── Types & config ─────────────────────────────────────────────────────────

type NoteType = Note['type'];

const NOTE_TYPES: {
  id: NoteType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  border: string;
  chipBg: string;
}[] = [
  {
    id: 'note',
    label: 'Note',
    icon: StickyNote,
    color: TEXT.muted,
    bg: 'bg-cortex-control',
    border: 'border-cortex-default',
    chipBg: 'bg-cortex-control-hover',
  },
  {
    id: 'action',
    label: 'Action',
    icon: Zap,
    color: STATUS.warning,
    bg: 'bg-cortex-warning/8',
    border: 'border-cortex-warning/20',
    chipBg: 'bg-cortex-warning/15',
  },
  {
    id: 'flag',
    label: 'Flag',
    icon: AlertTriangle,
    color: STATUS.danger,
    bg: 'bg-cortex-danger/8',
    border: 'border-cortex-danger/20',
    chipBg: 'bg-cortex-danger/15',
  },
  {
    id: 'insight',
    label: 'Insight',
    icon: Lightbulb,
    color: brand.accent,
    bg: 'bg-cortex-accent/8',
    border: 'border-cortex-accent/20',
    chipBg: 'bg-cortex-accent/15',
  },
];

function getNoteTypeCfg(type: NoteType) {
  return NOTE_TYPES.find(t => t.id === type) ?? NOTE_TYPES[0];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function initials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().substring(0, 2);
}

// Deterministic avatar colour from author string
const AVATAR_COLOURS = [brand.accent, brand.accentAlt, STATUS.info, STATUS.warning, STATUS.success];
function avatarColour(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % AVATAR_COLOURS.length;
  return AVATAR_COLOURS[h];
}

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
  submissionId: string;
  companyName?: string;
  accessToken?: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function SubmissionNotesPanel({ submissionId, companyName, accessToken }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Add-note form state
  const [draft, setDraft] = useState('');
  const [draftType, setDraftType] = useState<NoteType>('note');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Fetch ──

  const fetchNotes = useCallback(async (silent = false) => {
    if (!accessToken || !isBackendEnabled()) { setIsLoading(false); return; }
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    try {
      const res = await getNotes(submissionId, accessToken);
      // Narrowed before it becomes state — see `@/app/lib/payload`.
      setNotes(asArray(res.notes));
    } catch (err) {
      console.error('SubmissionNotesPanel fetch error:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [submissionId, accessToken]);

  useEffect(() => {
    fetchNotes();
    const interval = setInterval(() => fetchNotes(true), 20000);
    return () => clearInterval(interval);
  }, [fetchNotes]);

  // Scroll to bottom when notes load
  useEffect(() => {
    if (!isLoading && notes.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isLoading, notes.length]);

  // ── Add note ──

  const handleSubmit = async () => {
    if (!draft.trim() || !accessToken || isSubmitting) return;
    if (!isBackendEnabled()) {
      // In demo mode, add note locally only
      const tempId = `temp-${Date.now()}`;
      const localNote: Note = {
        id: tempId,
        kvKey: `note:${submissionId}:${tempId}`,
        submissionId,
        content: draft.trim(),
        type: draftType,
        authorName: 'You',
        authorEmail: '',
        createdAt: new Date().toISOString(),
      };
      setNotes(prev => [...prev, localNote]);
      setDraft('');
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setIsSubmitting(true);
    setAddError(null);

    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const optimistic: Note = {
      id: tempId,
      kvKey: `note:${submissionId}:${tempId}`,
      submissionId,
      content: draft.trim(),
      type: draftType,
      authorName: 'You',
      authorEmail: '',
      createdAt: new Date().toISOString(),
    };
    setNotes(prev => [...prev, optimistic]);
    setDraft('');
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });

    try {
      const res = await addNote(submissionId, optimistic.content, draftType, accessToken);
      // Replace optimistic note with real one
      setNotes(prev => prev.map(n => n.id === tempId ? res.note : n));
    } catch (err: any) {
      console.error('Add note error:', err);
      setAddError(err.message || 'Failed to save note');
      // Remove optimistic note on failure
      setNotes(prev => prev.filter(n => n.id !== tempId));
      setDraft(optimistic.content); // restore draft
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ── Delete ──

  const handleDelete = async (note: Note) => {
    if (!accessToken) return;
    if (!isBackendEnabled()) {
      // In demo mode, just remove locally
      setNotes(prev => prev.filter(n => n.id !== note.id));
      return;
    }
    setDeletingId(note.id);
    // Optimistic remove
    setNotes(prev => prev.filter(n => n.id !== note.id));
    try {
      await deleteNote(submissionId, note.id, accessToken);
    } catch (err) {
      console.error('Delete note error:', err);
      // Restore on failure
      setNotes(prev => [...prev, note].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ));
    } finally {
      setDeletingId(null);
    }
  };

  // ── Counts by type ──
  const counts = NOTE_TYPES.reduce((acc, t) => {
    acc[t.id] = notes.filter(n => n.type === t.id).length;
    return acc;
  }, {} as Record<NoteType, number>);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="size-10 rounded-cortex-md bg-gradient-to-br from-cortex-accent/20 to-cortex-accent-alt/20 border border-cortex-accent/30 flex items-center justify-center">
              <MessageSquare className="size-5 text-cortex-accent" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Team Notes</h2>
              <p className="text-cortex-muted text-sm">
                {companyName ? `Internal notes for ${companyName}` : 'Internal notes'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-cortex-faint bg-cortex-control border border-cortex-default rounded-cortex-sm px-3 py-1.5">
            <Lock className="size-3" />
            Team only
          </div>
          <button
            onClick={() => fetchNotes(true)}
            disabled={isRefreshing}
            className="p-2 hover:bg-cortex-control rounded-cortex-sm transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`size-4 text-cortex-muted ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Type summary chips ── */}
      <div className="flex gap-2 flex-wrap">
        {NOTE_TYPES.map(t => {
          const Icon = t.icon;
          return (
            <div
              key={t.id}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-cortex-sm border text-xs font-medium ${t.bg} ${t.border}`}
              style={{ color: t.color }}
            >
              <Icon className="size-3.5" />
              {counts[t.id]} {t.label}{counts[t.id] !== 1 ? 's' : ''}
            </div>
          );
        })}
        {notes.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-cortex-sm bg-cortex-control border border-cortex-default text-xs text-cortex-muted">
            <Clock className="size-3.5" />
            {notes.length} total
          </div>
        )}
      </div>

      {/* ── Notes feed ── */}
      <div className="bg-cortex-sunken border border-cortex-default rounded-cortex-lg overflow-hidden">
        <div className="max-h-[480px] overflow-y-auto p-4 space-y-3">
          {isLoading ? (
            <NotesLoadingSkeleton />
          ) : notes.length === 0 ? (
            <EmptyNotesState />
          ) : (
            <span className="contents">
              {notes.map((note, i) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  index={i}
                  isDeleting={deletingId === note.id}
                  onDelete={() => handleDelete(note)}
                />
              ))}
              <div ref={bottomRef} />
            </span>
          )}
        </div>

        {/* ── Add note form ── */}
        <div className="border-t border-cortex-default p-4 bg-black/20">
          {/* Type selector */}
          <div className="flex gap-1.5 mb-3">
            {NOTE_TYPES.map(t => {
              const Icon = t.icon;
              const isActive = draftType === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setDraftType(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-cortex-sm border text-xs font-medium transition-all ${
                    isActive
                      ? `${t.bg} ${t.border}`
                      : 'bg-white/3 border-white/8 text-cortex-faint hover:text-cortex-muted hover:bg-cortex-control'
                  }`}
                  style={isActive ? { color: t.color } : {}}
                >
                  <Icon className="size-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Textarea */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                draftType === 'action'  ? 'Describe the required action...' :
                draftType === 'flag'    ? 'What needs urgent attention?' :
                draftType === 'insight' ? 'Share a strategic observation...' :
                'Add a note for the team...'
              }
              rows={3}
              disabled={!accessToken}
              className="w-full bg-cortex-control border border-cortex-default rounded-cortex-md px-4 py-3 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-cortex-accent/50 focus:ring-1 focus:ring-cortex-accent/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            />
            {draft.length > 0 && (
              <div className="absolute bottom-3 right-3 text-[10px] text-cortex-faint">
                ⌘↵ to submit
              </div>
            )}
          </div>

          {/* Error */}
          {addError && (
            <p className="mt-2 text-xs text-cortex-danger flex items-center gap-1">
              <AlertTriangle className="size-3" />
              {addError}
            </p>
          )}

          {/* Submit row */}
          <div className="flex items-center justify-between mt-3">
            {!accessToken ? (
              <p className="text-xs text-cortex-faint">Authentication required to add notes</p>
            ) : (
              <p className="text-xs text-cortex-faint">
                Notes are visible to all team members
              </p>
            )}
            <button
              onClick={handleSubmit}
              disabled={!draft.trim() || !accessToken || isSubmitting}
              className={`flex items-center gap-2 px-4 py-2 rounded-cortex-md text-sm font-semibold transition-all ${
                draft.trim() && accessToken && !isSubmitting
                  ? 'bg-gradient-to-r from-cortex-accent to-cortex-accent-alt text-white hover:opacity-90 shadow-lg shadow-cortex-accent/20'
                  : 'bg-cortex-control text-cortex-faint cursor-not-allowed'
              }`}
            >
              {isSubmitting ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {isSubmitting ? 'Saving…' : 'Add Note'}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function NoteCard({
  note, index, isDeleting, onDelete,
}: {
  note: Note;
  index: number;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const cfg = getNoteTypeCfg(note.type);
  const Icon = cfg.icon;
  const colour = avatarColour(note.authorName);
  const isTemp = note.id.startsWith('temp-');

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: isDeleting ? 0.4 : 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`group relative rounded-cortex-md border p-4 transition-all ${cfg.bg} ${cfg.border} ${
        isTemp ? 'opacity-70' : ''
      }`}
    >
      <div className="flex gap-3">
        {/* Author avatar */}
        <div
          className="size-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5"
          style={{ backgroundColor: colour }}
        >
          {initials(note.authorName)}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-white text-sm font-semibold">{note.authorName}</span>
            {/* Type chip */}
            <span
              className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.chipBg}`}
              style={{ color: cfg.color }}
            >
              <Icon className="size-2.5" />
              {cfg.label.toUpperCase()}
            </span>
            <span className="text-cortex-faint text-xs ml-auto flex items-center gap-1">
              <Clock className="size-2.5" />
              {timeAgo(note.createdAt)}
              {isTemp && <span className="ml-1 text-cortex-accent">saving…</span>}
            </span>
          </div>
          <p className="text-cortex-secondary text-sm leading-relaxed whitespace-pre-wrap break-words">
            {note.content}
          </p>
        </div>

        {/* Delete button */}
        {!isTemp && (
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-cortex-danger/15 rounded-cortex-sm transition-all flex-shrink-0 mt-0.5"
            title="Delete note"
          >
            <Trash2 className="size-3.5 text-cortex-faint hover:text-cortex-danger transition-colors" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function EmptyNotesState() {
  return (
    <div className="py-12 text-center">
      <div className="size-14 rounded-cortex-lg bg-cortex-control flex items-center justify-center mx-auto mb-4">
        <MessageSquare className="size-6 text-cortex-faint" />
      </div>
      <p className="text-white font-medium text-sm mb-1">No notes yet</p>
      <p className="text-cortex-muted text-xs max-w-xs mx-auto leading-relaxed">
        Add the first note, flag an issue, or log a required action for this submission.
      </p>
    </div>
  );
}

function NotesLoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex gap-3 p-4 rounded-cortex-md bg-white/3 border border-white/8 animate-pulse">
          <div className="size-8 rounded-full bg-cortex-control-hover flex-shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 bg-cortex-control-hover rounded w-32" />
            <div className="h-3 bg-cortex-control rounded w-full" />
            <div className="h-3 bg-cortex-control rounded w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}