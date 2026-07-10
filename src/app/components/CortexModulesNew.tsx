/**
 * CORTEX — NEW MODULES (Modules 8, 9, 10)
 *
 * Module 8: Decision Log — status timeline with team notes
 * Module 9: Next Actions — per-lead task list
 * Module 10: Outcome / Learning Loop — per-lead feedback (WIRED TO BACKEND)
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Clock,
  CheckCircle2,
  Circle,
  Plus,
  Flag,
  User,
  ArrowRight,
  Lightbulb,
  TrendingUp,
  TrendingDown,
  MessageSquare,
  AlertTriangle,
  Trash2,
  Check,
  Loader2,
  Brain,
} from 'lucide-react';
import type { CortexLeadData, DecisionLog, NextAction } from '@/app/types/cortex-types';
import { logOutcome, getOutcome, type OutcomeRecord } from '@/app/services/dataService';
import { isBackendEnabled, isVerboseLogging, shouldShowApiErrors } from '@/config/runtime';

// ============================================================================
// MODULE 8 — DECISION LOG
// ============================================================================

export function DecisionLogModule({ data }: { data: CortexLeadData }) {
  const [logs, setLogs] = useState<DecisionLog[]>(data.decisionLog);
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [noteAuthor, setNoteAuthor] = useState('Team Member');

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    const note: DecisionLog = {
      leadId: data.lead.id,
      timestamp: new Date().toISOString(),
      fromStatus: data.lead.status,
      toStatus: data.lead.status,
      reason: 'Team note added',
      actionTakenBy: noteAuthor,
      notes: newNote,
    };
    setLogs([...logs, note]);
    setNewNote('');
    setShowAddNote(false);
  };

  const statusColors: Record<string, string> = {
    new: '#8B5CF6',
    'needs-review': '#FB923C',
    'ready-for-call': '#3B82F6',
    'proposal-sent': '#06D7F6',
    converted: '#10B981',
    disqualified: '#70707C',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="size-6 text-[#8B5CF6]" />
            Decision Log
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Full audit trail of every status change, team note, and action taken on this lead.
          </p>
        </div>
        <button
          onClick={() => setShowAddNote(!showAddNote)}
          className="flex items-center gap-2 px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-lg transition-colors font-medium"
        >
          <Plus className="size-4" />
          Add Note
        </button>
      </div>

      <AnimatePresence>
        {showAddNote && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-black/40 border border-[#8B5CF6]/30 rounded-xl p-6"
          >
            <h3 className="font-bold mb-4 text-[#8B5CF6]">Add Team Note</h3>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Your name"
                value={noteAuthor}
                onChange={e => setNoteAuthor(e.target.value)}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:border-[#8B5CF6] outline-none transition-colors text-sm"
              />
              <textarea
                rows={3}
                placeholder="Add a note, observation, or context about this lead..."
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:border-[#8B5CF6] outline-none transition-colors text-sm resize-none"
              />
              <div className="flex gap-3">
                <button
                  onClick={handleAddNote}
                  className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-lg transition-colors text-sm font-medium"
                >
                  Save Note
                </button>
                <button
                  onClick={() => setShowAddNote(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-400 rounded-lg transition-colors text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative">
        <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-white/10" />
        <div className="space-y-6">
          {logs.map((log, idx) => {
            const color = statusColors[log.toStatus] || '#8B5CF6';
            const isNote = log.reason === 'Team note added';
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.08 }}
                className="relative flex gap-4 pl-10"
              >
                <div
                  className="absolute left-0 size-10 rounded-full flex items-center justify-center border-2 border-[#0A0A0F] z-10"
                  style={{ backgroundColor: `${color}20`, borderColor: color }}
                >
                  {isNote
                    ? <MessageSquare className="size-4" style={{ color }} />
                    : <ArrowRight className="size-4" style={{ color }} />
                  }
                </div>
                <div className="flex-1 bg-black/40 border border-white/10 rounded-xl p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="font-semibold text-white">{log.reason}</span>
                      {log.fromStatus !== log.toStatus && (
                        <span className="ml-2 text-sm text-gray-400">
                          {log.fromStatus.replace('-', ' ')} → {log.toStatus.replace('-', ' ')}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap ml-4">
                      {new Date(log.timestamp).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {log.notes && <p className="text-sm text-gray-300 mb-2">{log.notes}</p>}
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <User className="size-3" />
                    {log.actionTakenBy}
                  </div>
                </div>
              </motion.div>
            );
          })}
          <div className="relative flex gap-4 pl-10 opacity-30">
            <div className="absolute left-0 size-10 rounded-full flex items-center justify-center border-2 border-dashed border-white/20">
              <Plus className="size-4 text-gray-600" />
            </div>
            <div className="flex-1 border border-dashed border-white/10 rounded-xl p-5">
              <p className="text-sm text-gray-600">Next status change or team note will appear here</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MODULE 9 — NEXT ACTIONS
// ============================================================================

interface ActionItem extends NextAction {
  completed: boolean;
}

export function NextActionsModule({ data }: { data: CortexLeadData }) {
  const [actions, setActions] = useState<ActionItem[]>(
    data.nextActions.map(a => ({ ...a, completed: false }))
  );
  const [showAdd, setShowAdd] = useState(false);
  const [newAction, setNewAction] = useState('');
  const [newPriority, setNewPriority] = useState<'urgent' | 'high' | 'medium' | 'low'>('high');
  const [newAssignee, setNewAssignee] = useState('');

  const priorityConfig = {
    urgent: { color: '#FD4438', label: 'URGENT', bg: 'bg-[#FD4438]/10 border-[#FD4438]/30' },
    high:   { color: '#FB923C', label: 'HIGH',   bg: 'bg-[#FB923C]/10 border-[#FB923C]/30' },
    medium: { color: '#06D7F6', label: 'MEDIUM', bg: 'bg-[#06D7F6]/10 border-[#06D7F6]/30' },
    low:    { color: '#70707C', label: 'LOW',    bg: 'bg-white/5 border-white/10' },
  };

  const handleToggle = (idx: number) => {
    setActions(prev => prev.map((a, i) => i === idx ? { ...a, completed: !a.completed } : a));
  };

  const handleAdd = () => {
    if (!newAction.trim()) return;
    const action: ActionItem = {
      leadId: data.lead.id,
      action: newAction,
      priority: newPriority,
      assignedTo: newAssignee || 'Unassigned',
      dueDate: undefined,
      completed: false,
    };
    setActions([...actions, action]);
    setNewAction('');
    setNewAssignee('');
    setShowAdd(false);
  };

  const handleDelete = (idx: number) => {
    setActions(prev => prev.filter((_, i) => i !== idx));
  };

  const pending   = actions.filter(a => !a.completed);
  const completed = actions.filter(a => a.completed);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Flag className="size-6 text-[#FB923C]" />
            Next Actions
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            {pending.length} pending · {completed.length} completed
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-4 py-2 bg-[#FB923C] hover:bg-[#ea7c1b] text-white rounded-lg transition-colors font-medium"
        >
          <Plus className="size-4" />
          Add Action
        </button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-black/40 border border-[#FB923C]/30 rounded-xl p-6"
          >
            <h3 className="font-bold mb-4 text-[#FB923C]">New Action Item</h3>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Describe the action..."
                value={newAction}
                onChange={e => setNewAction(e.target.value)}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:border-[#FB923C] outline-none transition-colors text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Priority</label>
                  <select
                    value={newPriority}
                    onChange={e => setNewPriority(e.target.value as typeof newPriority)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:border-[#FB923C] outline-none"
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Assigned To</label>
                  <input
                    type="text"
                    placeholder="Team member name"
                    value={newAssignee}
                    onChange={e => setNewAssignee(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-gray-500 focus:border-[#FB923C] outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleAdd}
                  className="px-4 py-2 bg-[#FB923C] hover:bg-[#ea7c1b] text-white rounded-lg transition-colors text-sm font-medium"
                >
                  Add Action
                </button>
                <button
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-400 rounded-lg transition-colors text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {pending.length > 0 && (
        <div className="space-y-3">
          {pending.map((action) => {
            const realIdx = actions.indexOf(action);
            const p = priorityConfig[action.priority];
            return (
              <motion.div
                key={realIdx}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-start gap-4 p-5 bg-black/40 border rounded-xl ${p.bg} hover:border-white/20 transition-colors group`}
              >
                <button onClick={() => handleToggle(realIdx)} className="flex-shrink-0 mt-0.5">
                  <Circle className="size-5 text-gray-500 hover:text-[#10B981] transition-colors" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium">{action.action}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span
                      className="px-2 py-0.5 rounded text-xs font-bold"
                      style={{ color: p.color, backgroundColor: `${p.color}20` }}
                    >
                      {p.label}
                    </span>
                    {action.assignedTo && (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <User className="size-3" />{action.assignedTo}
                      </span>
                    )}
                    {action.dueDate && (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="size-3" />
                        {new Date(action.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(realIdx)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-[#FD4438]"
                >
                  <Trash2 className="size-4" />
                </button>
              </motion.div>
            );
          })}
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Completed ({completed.length})
          </h3>
          <div className="space-y-2">
            {completed.map((action) => {
              const realIdx = actions.indexOf(action);
              return (
                <div
                  key={realIdx}
                  className="flex items-center gap-4 p-4 bg-white/3 border border-white/5 rounded-xl opacity-50"
                >
                  <button onClick={() => handleToggle(realIdx)}>
                    <CheckCircle2 className="size-5 text-[#10B981]" />
                  </button>
                  <p className="text-gray-400 line-through text-sm flex-1">{action.action}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {actions.length === 0 && (
        <div className="text-center py-12 text-gray-600">
          <Flag className="size-12 mx-auto mb-3 opacity-30" />
          <p>No actions yet. Add the first action for this lead.</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MODULE 10 — OUTCOME / LEARNING LOOP (per-lead, wired to backend)
// ============================================================================

interface OutcomeModuleProps {
  data: CortexLeadData;
  submissionId: string;
  accessToken?: string;
}

export function OutcomeModule({ data, submissionId, accessToken }: OutcomeModuleProps) {
  const [didConvert, setDidConvert] = useState<boolean | null>(null);
  const [conversionValue, setConversionValue] = useState('');
  const [recommendationWorked, setRecommendationWorked] = useState<boolean | null>(null);
  const [whatLearned, setWhatLearned] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [improvements, setImprovements] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [existingOutcome, setExistingOutcome] = useState<OutcomeRecord | null>(null);

  // Load existing outcome on mount
  useEffect(() => {
    if (!accessToken || !submissionId || !isBackendEnabled()) {
      setIsLoading(false);
      return;
    }
    getOutcome(submissionId, accessToken)
      .then(res => {
        if (res.outcome) {
          const o = res.outcome;
          setExistingOutcome(o);
          setDidConvert(o.didConvert);
          setConversionValue(o.conversionValue?.toString() || '');
          setRecommendationWorked(o.recommendationWorked ?? null);
          setWhatLearned(o.whatWeLearned || '');
          setLostReason(o.lostReason || '');
          setImprovements(o.improvementAreas || []);
        }
      })
      .catch(err => console.warn('Could not load existing outcome (non-fatal):', err))
      .finally(() => setIsLoading(false));
  }, [submissionId, accessToken]);

  const handleSave = async () => {
    if (didConvert === null) return;
    if (!accessToken) {
      setSaveError('Team login required to save outcomes.');
      return;
    }
    if (!isBackendEnabled()) {
      // In demo mode, save locally only
      const localOutcome: OutcomeRecord = {
        submissionId,
        didConvert,
        conversionValue: didConvert ? (parseFloat(conversionValue) || null) : null,
        lostReason: !didConvert ? lostReason || null : null,
        recommendationWorked,
        whatWeLearned: whatLearned,
        improvementAreas: improvements,
        loggedAt: new Date().toISOString(),
        loggedBy: 'demo-user',
      };
      setExistingOutcome(localOutcome);
      setSaved(true);
      setTimeout(() => setSaved(false), 3500);
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await logOutcome(submissionId, {
        didConvert,
        conversionValue: didConvert ? (parseFloat(conversionValue) || null) : null,
        lostReason: !didConvert ? lostReason || null : null,
        recommendationWorked,
        whatWeLearned: whatLearned,
        improvementAreas: improvements,
      }, accessToken);
      setExistingOutcome(result.outcome);
      setSaved(true);
      setTimeout(() => setSaved(false), 3500);
    } catch (err: any) {
      console.error('Failed to save outcome:', err);
      setSaveError(err.message || 'Failed to save outcome. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 text-[#8B5CF6] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="size-6 text-[#10B981]" />
            Outcome & Learning Loop
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Record what happened with this lead. Every outcome trains CORTEX to predict better.
          </p>
        </div>
        {existingOutcome && (
          <div
            className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"
            style={{
              background: existingOutcome.didConvert ? 'rgba(16,185,129,0.15)' : 'rgba(253,68,56,0.12)',
              border: `1px solid ${existingOutcome.didConvert ? 'rgba(16,185,129,0.4)' : 'rgba(253,68,56,0.35)'}`,
              color: existingOutcome.didConvert ? '#10B981' : '#FD4438',
            }}
          >
            {existingOutcome.didConvert ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
            {existingOutcome.didConvert ? 'Logged: WON' : 'Logged: LOST'} ·{' '}
            {new Date(existingOutcome.loggedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        )}
      </div>

      {/* Conversion Outcome */}
      <div className="bg-black/40 border border-white/10 rounded-xl p-6">
        <h3 className="font-bold mb-4 text-white">Did this lead convert?</h3>
        <div className="flex gap-4 mb-4">
          <button
            onClick={() => setDidConvert(true)}
            className={`flex-1 py-3 rounded-xl border-2 font-semibold transition-all flex items-center justify-center gap-2 ${
              didConvert === true
                ? 'bg-[#10B981]/20 border-[#10B981] text-[#10B981]'
                : 'border-white/10 text-gray-400 hover:border-white/20'
            }`}
          >
            <TrendingUp className="size-4" />
            Yes — Converted
          </button>
          <button
            onClick={() => setDidConvert(false)}
            className={`flex-1 py-3 rounded-xl border-2 font-semibold transition-all flex items-center justify-center gap-2 ${
              didConvert === false
                ? 'bg-[#FD4438]/20 border-[#FD4438] text-[#FD4438]'
                : 'border-white/10 text-gray-400 hover:border-white/20'
            }`}
          >
            <TrendingDown className="size-4" />
            No — Did Not Convert
          </button>
        </div>

        <AnimatePresence mode="wait">
          {didConvert === true && (
            <motion.div key="convert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <label className="text-sm text-gray-400 block mb-2">Deal Value ($)</label>
              <input
                type="number"
                placeholder="e.g. 25000"
                value={conversionValue}
                onChange={e => setConversionValue(e.target.value)}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:border-[#10B981] outline-none transition-colors"
              />
            </motion.div>
          )}
          {didConvert === false && (
            <motion.div key="lost" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <label className="text-sm text-gray-400 block mb-2">Why didn't they convert?</label>
              <textarea
                rows={3}
                placeholder="Budget, timing, wrong fit, went with competitor, no decision..."
                value={lostReason}
                onChange={e => setLostReason(e.target.value)}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:border-[#FD4438] outline-none transition-colors resize-none"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Recommendation Accuracy */}
      <div className="bg-black/40 border border-white/10 rounded-xl p-6">
        <h3 className="font-bold mb-2 text-white">Did the AI recommendation work?</h3>
        <p className="text-sm text-gray-400 mb-4">
          Recommended:{' '}
          <span className="text-[#8B5CF6] font-semibold">{data.recommendation.primaryServiceLabel}</span>
        </p>
        <div className="flex gap-4">
          <button
            onClick={() => setRecommendationWorked(true)}
            className={`flex-1 py-3 rounded-xl border-2 font-semibold transition-all text-sm ${
              recommendationWorked === true
                ? 'bg-[#10B981]/20 border-[#10B981] text-[#10B981]'
                : 'border-white/10 text-gray-400 hover:border-white/20'
            }`}
          >
            ✓ Correct — it fit perfectly
          </button>
          <button
            onClick={() => setRecommendationWorked(false)}
            className={`flex-1 py-3 rounded-xl border-2 font-semibold transition-all text-sm ${
              recommendationWorked === false
                ? 'bg-[#FD4438]/20 border-[#FD4438] text-[#FD4438]'
                : 'border-white/10 text-gray-400 hover:border-white/20'
            }`}
          >
            ✗ Wrong — we changed it
          </button>
          <button
            onClick={() => setRecommendationWorked(null)}
            className={`px-4 py-3 rounded-xl border-2 font-semibold transition-all text-sm ${
              recommendationWorked === null
                ? 'bg-white/10 border-white/30 text-gray-300'
                : 'border-white/10 text-gray-500 hover:border-white/20'
            }`}
          >
            N/A
          </button>
        </div>
      </div>

      {/* What We Learned */}
      <div className="bg-black/40 border border-white/10 rounded-xl p-6">
        <h3 className="font-bold mb-2 text-white flex items-center gap-2">
          <Lightbulb className="size-5 text-[#FB923C]" />
          What did we learn from this lead?
        </h3>
        <p className="text-sm text-gray-400 mb-4">
          This feeds directly into improving CORTEX's scoring and recommendation accuracy.
        </p>
        <textarea
          rows={4}
          placeholder="What signals predicted the outcome? What should we have caught earlier? What would we do differently?"
          value={whatLearned}
          onChange={e => setWhatLearned(e.target.value)}
          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 focus:border-[#FB923C] outline-none transition-colors resize-none text-sm"
        />
      </div>

      {/* System Improvement Tags */}
      <div className="bg-gradient-to-br from-[#8B5CF6]/10 to-[#3B82F6]/10 border border-[#8B5CF6]/20 rounded-xl p-6">
        <h3 className="font-bold mb-3 text-white flex items-center gap-2">
          <Brain className="size-5 text-[#8B5CF6]" />
          System Improvement Tags
        </h3>
        <p className="text-sm text-gray-400 mb-4">
          Which areas of CORTEX should be updated based on this outcome? These votes aggregate in Learning Insights.
        </p>
        <div className="flex flex-wrap gap-2">
          {['Scoring accuracy', 'Recommendation engine', 'Risk detection', 'Timeline estimates', 'Pricing guidance', 'Objection library', 'Industry model'].map(area => (
            <button
              key={area}
              onClick={() => {
                setImprovements(prev =>
                  prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]
                );
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                improvements.includes(area)
                  ? 'bg-[#8B5CF6]/30 border-[#8B5CF6] text-[#8B5CF6]'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
              }`}
            >
              {improvements.includes(area) ? '✓ ' : ''}{area}
            </button>
          ))}
        </div>
      </div>

      {/* Error Banner */}
      <AnimatePresence>
        {saveError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="px-4 py-3 rounded-xl flex items-center justify-between gap-3"
            style={{ background: 'rgba(253,68,56,0.08)', border: '1px solid rgba(253,68,56,0.3)', color: '#FCA5A5' }}
          >
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="size-4 text-[#FD4438] flex-shrink-0" />
              {saveError}
            </div>
            <button onClick={() => setSaveError(null)} className="text-gray-500 hover:text-white">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={didConvert === null || isSaving}
          className="px-6 py-3 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] hover:opacity-90 text-white rounded-xl font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isSaving ? (
            <span className="contents"><Loader2 className="size-4 animate-spin" />Saving…</span>
          ) : saved ? (
            <span className="contents"><Check className="size-4" />Saved to Learning Loop!</span>
          ) : (
            <span className="contents"><TrendingUp className="size-4" />{existingOutcome ? 'Update Outcome' : 'Save Outcome Feedback'}</span>
          )}
        </button>
        {!accessToken && (
          <p className="text-xs text-gray-500">Team login required to persist outcomes.</p>
        )}
        {accessToken && didConvert !== null && !saved && (
          <p className="text-xs text-gray-500">
            This outcome will aggregate in{' '}
            <span className="text-[#10B981]">Learning Insights</span> to improve future predictions.
          </p>
        )}
      </div>
    </div>
  );
}