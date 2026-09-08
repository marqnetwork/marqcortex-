/**
 * PROPOSAL ANNOTATION LAYER — 13B
 *
 * Drop-in annotation system for the ProposalViewer:
 *   • Select any text → floating toolbar with colour palette + "Annotate"
 *   • Annotation form popover — author (persisted in localStorage), comment, colour
 *   • Highlights rendered inline via AnnotatableText (segmented string splitter)
 *   • Hover tooltip on each highlight — author initials + comment + timestamp
 *   • Side panel lists every annotation; click scrolls to highlight; trash to delete
 *   • All annotations persisted server-side in KV (GET/POST/DELETE)
 */

import {
  createContext, useContext, useState, useEffect, useRef, useCallback,
  type ReactNode, useId,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  MessageSquare, X, Trash2, Highlighter, ChevronRight, Clock,
  Loader2, PanelRightOpen, PanelRightClose, Check, Download,
} from 'lucide-react';
import {
  getProposalAnnotations, createProposalAnnotation, deleteProposalAnnotation,
  type ProposalAnnotation,
} from '@/app/services/dataService';
import { generateAnnotatedProposalHTML } from '@/app/utils/proposalExport';
import { asArray } from '@/app/lib/payload';
import { useDialogBehavior } from '@/app/components/ui/cortex';
import { brand, status, border, surface } from '@/app/lib/tokens';

// ── Colour palette ─────────────────────────────────────────────────────────────

/**
 * The highlighter palette.
 *
 * Deliberately NOT the status vocabulary: these are tints chosen so the text
 * underneath a highlight stays readable, and they carry no good/bad meaning.
 * The token layer has no tint scale to express them yet — see the checkpoint's
 * note on that decision — so they stay declared here, together, rather than
 * half of them pointing at status colours that mean something else.
 */
export const ANNOT_COLORS: { id: string; hex: string; bg: string; border: string }[] = [
  { id: 'amber',  hex: '#FBBF24', bg: 'rgba(251,191,36,0.22)',  border: 'rgba(251,191,36,0.55)'  },
  { id: 'green',  hex: '#34D399', bg: 'rgba(52,211,153,0.18)',  border: 'rgba(52,211,153,0.50)'  },
  { id: 'blue',   hex: '#60A5FA', bg: 'rgba(96,165,250,0.18)',  border: 'rgba(96,165,250,0.50)'  },
  { id: 'violet', hex: '#A78BFA', bg: 'rgba(167,139,250,0.20)', border: 'rgba(167,139,250,0.50)' },
  { id: 'red',    hex: '#F87171', bg: 'rgba(248,113,113,0.18)', border: 'rgba(248,113,113,0.50)' },
  { id: 'orange', hex: '#FB923C', bg: 'rgba(251,146,60,0.18)',  border: 'rgba(251,146,60,0.50)'  },
];

// ── Context ────────────────────────────────────────────────────────────────────

interface AnnotationCtx {
  annotations:    ProposalAnnotation[];
  deleteAnnotation: (id: string) => void;
  panelOpen:      boolean;
  setPanelOpen:   (v: boolean) => void;
  hoveredId:      string | null;
  setHoveredId:   (id: string | null) => void;
}

const Ctx = createContext<AnnotationCtx | null>(null);
export function useAnnotations() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAnnotations must be used inside AnnotationProvider');
  return c;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

function colorFor(hex: string) {
  return ANNOT_COLORS.find(c => c.hex === hex) ?? ANNOT_COLORS[0];
}

const LS_AUTHOR_KEY = 'proposal_annotation_author';

// ── Text segmentation ─────────────────────────────────────────────────────────

interface Segment {
  text:        string;
  annotation?: ProposalAnnotation;
}

/** Splits `text` into plain + annotated segments; first match wins for overlaps. */
function buildSegments(text: string, relevant: ProposalAnnotation[]): Segment[] {
  if (!relevant.length) return [{ text }];

  // Build sorted hit list: {start, end, annotation}
  type Hit = { start: number; end: number; ann: ProposalAnnotation };
  const hits: Hit[] = [];

  relevant.forEach(ann => {
    let idx = 0;
    while (true) {
      const pos = text.indexOf(ann.selectedText, idx);
      if (pos === -1) break;
      hits.push({ start: pos, end: pos + ann.selectedText.length, ann });
      idx = pos + 1;
    }
  });

  // Sort by start; remove overlaps (first wins)
  hits.sort((a, b) => a.start - b.start);
  const clean: Hit[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start >= cursor) { clean.push(h); cursor = h.end; }
  }

  // Build segments
  const segs: Segment[] = [];
  let pos = 0;
  for (const h of clean) {
    if (h.start > pos) segs.push({ text: text.slice(pos, h.start) });
    segs.push({ text: text.slice(h.start, h.end), annotation: h.ann });
    pos = h.end;
  }
  if (pos < text.length) segs.push({ text: text.slice(pos) });
  return segs;
}

// ── AnnotatableText ───────────────────────────────────────────────────────────

export function AnnotatableText({
  text,
  sectionKey,
  className,
}: {
  text:       string;
  sectionKey: string;
  className?: string;
}) {
  const { annotations, hoveredId, setHoveredId } = useAnnotations();
  const relevant = annotations.filter(
    a => a.sectionKey === sectionKey && text.includes(a.selectedText),
  );
  const segments = buildSegments(text, relevant);

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (!seg.annotation) return <span key={i}>{seg.text}</span>;
        const ann   = seg.annotation;
        const col   = colorFor(ann.color);
        const isHov = hoveredId === ann.id;

        return (
          <span key={i} className="relative inline">
            <mark
              data-annotation-id={ann.id}
              onMouseEnter={() => setHoveredId(ann.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                background:    col.bg,
                borderBottom:  `2px solid ${col.border}`,
                color:         'inherit',
                cursor:        'default',
                borderRadius:  '2px',
                padding:       '0 1px',
                transition:    'background 0.15s',
                ...(isHov ? { background: col.border } : {}),
              }}
            >
              {seg.text}
            </mark>

            {/* Hover tooltip */}
            <AnimatePresence>
              {isHov && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.95 }}
                  transition={{ duration: 0.12 }}
                  className="absolute z-50 bottom-full mb-2 left-0 min-w-[200px] max-w-[280px]"
                  style={{ filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.7))' }}
                  onMouseEnter={() => setHoveredId(ann.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <div
                    className="rounded-cortex-md p-3 text-xs"
                    style={{
                      background: '#141420',
                      border:     `1px solid ${col.border}`,
                    }}
                  >
                    {/* Author row */}
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className="size-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                        style={{ background: col.bg, color: col.hex, border: `1px solid ${col.border}` }}
                      >
                        {initials(ann.author)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-white truncate">{ann.author}</div>
                        <div className="flex items-center gap-1 text-cortex-muted">
                          <Clock className="size-2.5" />
                          {timeAgo(ann.createdAt)}
                        </div>
                      </div>
                      <div
                        className="size-2 rounded-full flex-shrink-0"
                        style={{ background: ann.color }}
                      />
                    </div>
                    {ann.comment && (
                      <p className="text-cortex-secondary leading-relaxed">{ann.comment}</p>
                    )}
                  </div>
                  {/* Arrow */}
                  <div
                    className="absolute left-4 top-full w-0 h-0"
                    style={{
                      borderLeft:  '6px solid transparent',
                      borderRight: '6px solid transparent',
                      borderTop:   `6px solid ${col.border}`,
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </span>
        );
      })}
    </span>
  );
}

// ── Floating selection toolbar ────────────────────────────────────────────────

interface ToolbarState {
  text:   string;
  x:      number;   // px from left of viewport
  y:      number;   // px from top of viewport (top of toolbar = above selection)
}

interface FormState {
  visible:    boolean;
  text:       string;
  sectionKey: string;
  x:          number;
  y:          number;
}

// ── Main provider ─────────────────────────────────────────────────────────────

export function AnnotationProvider({
  submissionId,
  children,
}: {
  submissionId: string;
  children:     ReactNode;
}) {
  const [annotations,  setAnnotations]  = useState<ProposalAnnotation[]>([]);
  const [isLoading,    setIsLoading]    = useState(true);
  const [panelOpen,    setPanelOpen]    = useState(false);
  const [hoveredId,    setHoveredId]    = useState<string | null>(null);
  const [toolbar,      setToolbar]      = useState<ToolbarState | null>(null);
  const [form,         setForm]         = useState<FormState | null>(null);
  const [selColor,     setSelColor]     = useState(ANNOT_COLORS[0].hex);
  const [author,       setAuthor]       = useState('');
  const [comment,      setComment]      = useState('');
  const [isSaving,     setIsSaving]     = useState(false);
  const [saveFlash,    setSaveFlash]    = useState(false);
  const containerRef   = useRef<HTMLDivElement>(null);
  const formRef        = useRef<HTMLDivElement>(null);

  // Load author from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(LS_AUTHOR_KEY);
    if (saved) setAuthor(saved);
  }, []);

  // Fetch annotations from server
  const loadAnnotations = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getProposalAnnotations(submissionId);
      // Narrowed before it becomes state — see `@/app/lib/payload`.
      setAnnotations(asArray(res.annotations));
    } catch (err) {
      console.error('Load annotations error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [submissionId]);

  useEffect(() => { loadAnnotations(); }, [loadAnnotations]);

  // Delete annotation
  const deleteAnnotation = useCallback(async (id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
    try {
      await deleteProposalAnnotation(submissionId, id);
    } catch (err) {
      console.error('Delete annotation error:', err);
      loadAnnotations(); // re-sync on failure
    }
  }, [submissionId, loadAnnotations]);

  // ── Text-selection handler ──
  useEffect(() => {
    function handleMouseUp(e: MouseEvent) {
      // Ignore clicks inside the annotation form itself
      if (formRef.current?.contains(e.target as Node)) return;

      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';

      if (!text || text.length < 3) {
        // Small delay so toolbar click events fire before clearing
        setTimeout(() => { setToolbar(null); }, 100);
        return;
      }

      // Only activate inside our container
      if (!containerRef.current) return;
      const range = sel!.getRangeAt(0);
      const rect  = range.getBoundingClientRect();

      setToolbar({
        text,
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
      setForm(null);
    }

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Close toolbar/form on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (formRef.current?.contains(e.target as Node)) return;
      const toolbarEl = document.getElementById('annot-toolbar');
      if (toolbarEl?.contains(e.target as Node)) return;
      setToolbar(null);
      setForm(null);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ── Detect which sectionKey the selection lives in ──
  function detectSectionKey(text: string): string {
    // Walk ancestors of the selection range looking for data-section-key
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 'general';
    let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
    while (node && node !== containerRef.current) {
      if (node instanceof Element) {
        const key = node.getAttribute('data-section-key');
        if (key) return key;
      }
      node = node.parentNode;
    }
    return 'general';
  }

  // ── Open annotation form ──
  function openForm(toolbarState: ToolbarState) {
    const sectionKey = detectSectionKey(toolbarState.text);
    setForm({
      visible:    true,
      text:       toolbarState.text,
      sectionKey,
      x:          toolbarState.x,
      y:          toolbarState.y,
    });
    setToolbar(null);
  }

  // ── Submit annotation ──
  async function handleSubmit() {
    if (!form || !author.trim()) return;
    setIsSaving(true);
    try {
      localStorage.setItem(LS_AUTHOR_KEY, author.trim());
      const res = await createProposalAnnotation(submissionId, {
        selectedText: form.text,
        comment:      comment.trim(),
        author:       author.trim(),
        color:        selColor,
        sectionKey:   form.sectionKey,
      });
      setAnnotations(prev => [res.annotation, ...prev]);
      setForm(null);
      setComment('');
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 2000);
    } catch (err) {
      console.error('Create annotation error:', err);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Ctx.Provider value={{ annotations, deleteAnnotation, panelOpen, setPanelOpen, hoveredId, setHoveredId }}>
      {/* Wrapper — all annotatable content lives here */}
      <div ref={containerRef} className="relative">
        {children}
      </div>

      {/* ── Floating selection toolbar ── */}
      <AnimatePresence>
        {toolbar && (
          <motion.div
            id="annot-toolbar"
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.92 }}
            transition={{ duration: 0.13 }}
            className="fixed z-[9999] flex items-center gap-1 px-2 py-1.5 rounded-cortex-md"
            style={{
              left:      toolbar.x,
              top:       toolbar.y - 52,
              transform: 'translateX(-50%)',
              background: '#141420',
              border:     '1px solid rgba(255,255,255,0.14)',
              boxShadow:  '0 8px 32px rgba(0,0,0,0.7)',
            }}
          >
            {/* Colour swatches */}
            {ANNOT_COLORS.map(col => (
              <button
                key={col.id}
                onClick={() => setSelColor(col.hex)}
                className="size-4 rounded-full flex-shrink-0 transition-transform"
                style={{
                  background:   col.hex,
                  outline:      selColor === col.hex ? `2px solid ${col.hex}` : 'none',
                  outlineOffset:'2px',
                  transform:    selColor === col.hex ? 'scale(1.25)' : 'scale(1)',
                }}
                title={col.id}
              />
            ))}
            <div className="w-px h-4 bg-white/15 mx-0.5" />
            {/* Annotate button */}
            <button
              onClick={() => openForm(toolbar)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-cortex-sm text-xs font-semibold transition-all"
              style={{ background: brand.accent, color: '#fff' }}
            >
              <Highlighter className="size-3" />
              Annotate
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Annotation form popover ── */}
      <AnimatePresence>
        {form?.visible && (
          <motion.div
            ref={formRef}
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed z-[9999] w-[300px]"
            style={{
              left:      Math.min(form.x, window.innerWidth - 320),
              top:       form.y - 10,
              transform: 'translateY(-100%)',
              background: '#141420',
              border:     '1px solid rgba(255,255,255,0.14)',
              borderRadius: 16,
              boxShadow:  '0 16px 48px rgba(0,0,0,0.8)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2 border-b border-white/8">
              <div className="flex items-center gap-2">
                <Highlighter className="size-3.5 text-cortex-accent" />
                <span className="text-sm font-semibold text-white">New Annotation</span>
              </div>
              <button
                onClick={() => setForm(null)}
                className="p-1 hover:bg-white/8 rounded-cortex-sm transition-colors"
              >
                <X className="size-3.5 text-cortex-muted" />
              </button>
            </div>

            <div className="px-4 py-3 space-y-3">
              {/* Selected text preview */}
              <div
                className="text-xs text-cortex-muted px-2.5 py-2 rounded-cortex-sm leading-relaxed line-clamp-2 italic"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                "{form.text.length > 80 ? form.text.slice(0, 80) + '…' : form.text}"
              </div>

              {/* Colour palette */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-cortex-muted mr-1">Colour</span>
                {ANNOT_COLORS.map(col => (
                  <button
                    key={col.id}
                    onClick={() => setSelColor(col.hex)}
                    className="size-5 rounded-full transition-transform"
                    style={{
                      background:   col.hex,
                      outline:      selColor === col.hex ? `2px solid ${col.hex}` : 'none',
                      outlineOffset:'2px',
                      transform:    selColor === col.hex ? 'scale(1.2)' : 'scale(1)',
                    }}
                  />
                ))}
              </div>

              {/* Author */}
              <div>
                <label className="text-[11px] text-cortex-muted mb-1 block">Your name</label>
                <input
                  type="text"
                  value={author}
                  onChange={e => setAuthor(e.target.value)}
                  placeholder="e.g. Sarah Chen"
                  className="w-full px-3 py-2 rounded-cortex-sm text-sm text-white placeholder-gray-600 outline-none transition-colors"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                  onFocus={e => (e.target.style.borderColor = brand.accent)}
                  onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
                  autoFocus
                />
              </div>

              {/* Comment */}
              <div>
                <label className="text-[11px] text-cortex-muted mb-1 block">Comment <span className="text-cortex-faint">(optional)</span></label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
                  placeholder="Add a note about this section…"
                  rows={3}
                  className="w-full px-3 py-2 rounded-cortex-sm text-sm text-white placeholder-gray-600 resize-none outline-none transition-colors"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                  onFocus={e => (e.target.style.borderColor = brand.accent)}
                  onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
                />
                <p className="text-[10px] text-cortex-faint mt-1">⌘ Enter to save</p>
              </div>

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={isSaving || !author.trim()}
                className="w-full py-2 rounded-cortex-md text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #8B5CF6, #3B82F6)', color: '#fff' }}
              >
                {isSaving
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Check className="size-4" />
                }
                Save Annotation
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Save confirmation flash ── */}
      <AnimatePresence>
        {saveFlash && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] flex items-center gap-2 px-4 py-2.5 rounded-cortex-md text-sm font-semibold"
            style={{
              background: `${status.success}26`,
              border:     `1px solid ${status.success}59`,
              color:      status.success,
              backdropFilter: 'blur(12px)',
            }}
          >
            <Check className="size-4" />
            Annotation saved
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Annotation panel ── */}
      <AnnotationPanel
        annotations={annotations}
        isLoading={isLoading}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onDelete={deleteAnnotation}
      />
    </Ctx.Provider>
  );
}

// ── Annotation panel (slide-in right) ─────────────────────────────────────────

/**
 * The annotations drawer.
 *
 * It is a dialog by behaviour and was not one by declaration: no `role`, no
 * `aria-modal`, no focus moved in or restored, no Escape, and a close button
 * with no accessible name at all. Tab walked straight out of it into the
 * proposal underneath, which the drawer was covering.
 *
 * It keeps its own shape — a right-hand slide-in, not a centred `Modal` — so
 * it takes the four behaviours from `useDialogBehavior` rather than the
 * `Modal` chrome, which is exactly the case that hook exists for.
 */
function AnnotationPanel({
  annotations,
  isLoading,
  open,
  onClose,
  onDelete,
}: {
  annotations: ProposalAnnotation[];
  isLoading:   boolean;
  open:        boolean;
  onClose:     () => void;
  onDelete:    (id: string) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { setHoveredId } = useAnnotations();
  const titleId = useId();
  const { dialogProps } = useDialogBehavior({ open, onClose, labelledBy: titleId });

  async function handleDelete(id: string) {
    setDeletingId(id);
    await onDelete(id);
    setDeletingId(null);
  }

  // Scroll to highlight on click
  function scrollTo(id: string) {
    const el = document.querySelector(`[data-annotation-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHoveredId(id);
      setTimeout(() => setHoveredId(null), 2500);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <span className="contents">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            style={{ background: `color-mix(in srgb, ${surface.canvas} 65%, transparent)` }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            {...dialogProps}
            className="fixed right-0 top-0 h-full w-[340px] z-50 flex flex-col bg-cortex-overlay border-l border-cortex-default"
            style={{ boxShadow: '-16px 0 48px rgba(0,0,0,0.6)' }}
          >
            {/* Panel header */}
            <div
              className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ borderBottom: `1px solid ${border.default}` }}
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4 text-cortex-accent" aria-hidden="true" />
                <h2 id={titleId} className="font-bold text-cortex-primary text-sm">Annotations</h2>
                {annotations.length > 0 && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: `${brand.accent}33`, color: brand.accent }}
                  >
                    {annotations.length}
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                aria-label="Close annotations"
                className="p-1.5 hover:bg-cortex-control rounded-cortex-sm transition-colors"
              >
                <X className="size-4 text-cortex-muted" aria-hidden="true" />
              </button>
            </div>

            {/* Annotation list */}
            <div className="flex-1 overflow-y-auto py-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="size-6 text-cortex-accent animate-spin" />
                </div>
              ) : annotations.length === 0 ? (
                <div className="py-16 px-6 text-center">
                  <div
                    className="size-14 rounded-cortex-lg flex items-center justify-center mx-auto mb-4"
                    style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)' }}
                  >
                    <Highlighter className="size-6 text-cortex-accent/50" />
                  </div>
                  <p className="text-white font-medium text-sm mb-1">No annotations yet</p>
                  <p className="text-cortex-muted text-xs leading-relaxed">
                    Select any text in the proposal and click <strong className="text-cortex-muted">Annotate</strong> to add your notes.
                  </p>
                </div>
              ) : (
                <div className="px-3 space-y-2">
                  {annotations.map(ann => {
                    const col = colorFor(ann.color);
                    return (
                      <motion.div
                        key={ann.id}
                        layout
                        initial={{ opacity: 0, x: 16 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 16 }}
                        className="group rounded-cortex-md p-3 cursor-pointer transition-colors"
                        style={{
                          background: 'rgba(255,255,255,0.03)',
                          border:     `1px solid rgba(255,255,255,0.07)`,
                        }}
                        onClick={() => scrollTo(ann.id)}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = col.border)}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)')}
                      >
                        {/* Top row: author + timestamp + delete */}
                        <div className="flex items-center gap-2 mb-2">
                          <div
                            className="size-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                            style={{ background: col.bg, color: col.hex, border: `1px solid ${col.border}` }}
                          >
                            {initials(ann.author)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-white truncate">{ann.author}</div>
                            <div className="flex items-center gap-1 text-[10px] text-cortex-muted">
                              <Clock className="size-2.5" />
                              {timeAgo(ann.createdAt)}
                            </div>
                          </div>
                          {/* Section chip */}
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}
                          >
                            {ann.sectionKey}
                          </span>
                          {/* Delete */}
                          <button
                            onClick={e => { e.stopPropagation(); handleDelete(ann.id); }}
                            disabled={deletingId === ann.id}
                            className="p-1 rounded-cortex-sm opacity-0 group-hover:opacity-100 transition-all hover:bg-cortex-danger/15"
                            title="Delete annotation"
                          >
                            {deletingId === ann.id
                              ? <Loader2 className="size-3 text-cortex-muted animate-spin" />
                              : <Trash2 className="size-3 text-cortex-muted hover:text-cortex-danger" />
                            }
                          </button>
                        </div>

                        {/* Selected text */}
                        <div
                          className="text-[11px] italic text-cortex-muted px-2 py-1.5 rounded-cortex-sm mb-2 leading-relaxed line-clamp-2"
                          style={{ background: col.bg, borderLeft: `3px solid ${col.hex}` }}
                        >
                          "{ann.selectedText.length > 80 ? ann.selectedText.slice(0, 80) + '…' : ann.selectedText}"
                        </div>

                        {/* Comment */}
                        {ann.comment && (
                          <p className="text-xs text-cortex-secondary leading-relaxed">{ann.comment}</p>
                        )}

                        {/* Scroll hint */}
                        <div className="flex items-center gap-1 mt-2 text-[10px] text-cortex-faint opacity-0 group-hover:opacity-100 transition-opacity">
                          <ChevronRight className="size-3" />
                          Click to jump to highlight
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Panel footer */}
            <div
              className="px-5 py-3 text-[11px] text-cortex-faint flex-shrink-0"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              Select text in the proposal to add annotations
            </div>
          </motion.div>
        </span>
      )}
    </AnimatePresence>
  );
}

// ── Toggle button (used in ProposalViewer cover) ──────────────────────────────

export function AnnotationPanelToggle() {
  const { panelOpen, setPanelOpen, annotations } = useAnnotations();
  const unread = annotations.length;

  return (
    <button
      onClick={() => setPanelOpen(!panelOpen)}
      className="flex items-center gap-2 px-3 py-2 rounded-cortex-md text-xs font-semibold transition-all"
      style={{
        background: panelOpen ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.05)',
        border:     panelOpen ? '1px solid rgba(139,92,246,0.4)' : '1px solid rgba(255,255,255,0.1)',
        color:      panelOpen ? '#C4B5FD' : 'rgba(255,255,255,0.6)',
      }}
      title={panelOpen ? 'Close annotation panel' : 'Open annotation panel'}
    >
      {panelOpen
        ? <PanelRightClose className="size-3.5" />
        : <PanelRightOpen className="size-3.5" />
      }
      Notes
      {unread > 0 && (
        <span
          className="size-4 rounded-full flex items-center justify-center text-[9px] font-bold"
          style={{ background: brand.accent, color: '#fff' }}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}

// ── Export with annotations button — 13D ──────────────────────────────────────

export function ExportAnnotationsButton({
  proposal,
  companyName,
}: {
  proposal:    any;
  companyName: string;
}) {
  const { annotations } = useAnnotations();
  const [isGenerating, setIsGenerating] = useState(false);

  async function handleExport() {
    if (!proposal || isGenerating) return;
    setIsGenerating(true);
    try {
      const html = generateAnnotatedProposalHTML(proposal, annotations, companyName);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const tab  = window.open(url, '_blank');
      // Revoke after the tab has had time to load the blob
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      if (!tab) {
        // Popup blocked — fall back to a download
        const a = document.createElement('a');
        a.href = url;
        a.download = `proposal-${companyName.toLowerCase().replace(/\s+/g, '-')}-annotated.html`;
        a.click();
      }
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={!proposal || isGenerating}
      className="flex items-center gap-2 px-3 py-2 rounded-cortex-md text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: `${status.info}14`,
        border:     `1px solid ${status.info}40`,
        color:      status.info,
      }}
      onMouseEnter={e => {
        if (!proposal || isGenerating) return;
        (e.currentTarget as HTMLElement).style.background  = 'rgba(6,215,246,0.16)';
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(6,215,246,0.45)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background  = 'rgba(6,215,246,0.08)';
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(6,215,246,0.25)';
      }}
      title={
        annotations.length > 0
          ? `Export proposal with ${annotations.length} annotation${annotations.length !== 1 ? 's' : ''}`
          : 'Export proposal as print-ready PDF'
      }
    >
      {isGenerating
        ? <Loader2 className="size-3.5 animate-spin" />
        : <Download className="size-3.5" />
      }
      {isGenerating ? 'Generating…' : 'Export PDF'}
      {annotations.length > 0 && !isGenerating && (
        <span
          className="size-4 rounded-full flex items-center justify-center text-[9px] font-bold"
          style={{ background: 'rgba(251,191,36,0.22)', color: '#FBBF24', border: '1px solid rgba(251,191,36,0.4)' }}
        >
          {annotations.length > 9 ? '9+' : annotations.length}
        </span>
      )}
    </button>
  );
}