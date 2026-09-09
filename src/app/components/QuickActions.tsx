/**
 * ⚡ ONE-CLICK TEAM ACTIONS
 * 
 * PROBLEM: Team spends 2 minutes reviewing each submission
 * SOLUTION: Instant actions with keyboard shortcuts
 * 
 * FEATURES:
 * - One-click approve (for quality > 90)
 * - Batch approve (select multiple)
 * - Keyboard shortcuts (A = approve, E = edit, etc.)
 * - Smart auto-send (auto-approve + email if quality > 92)
 * - Quick edit templates (common fixes)
 * 
 * EXPECTED IMPACT: Review time 2 min → 30 seconds (-75%)
 */

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Edit3, Send, Zap, Clock, AlertTriangle, Sparkles } from 'lucide-react';

interface QuickActionsProps {
  submissionId: string;
  qualityScore: number;
  /**
   * The canonical Submission status vocabulary (api.Submission.status, and the
   * server's own counts): new | in-review | completed | approved. This prop
   * previously declared a private vocabulary — 'reviewing' and 'sent' — that no
   * submission ever carries, so Approve stayed disabled for every submission
   * actually in review and the 'a' shortcut was dead on it.
   */
  status: 'new' | 'in-review' | 'completed' | 'approved';
  onApprove: () => void;
  onEdit: () => void;
  onSend: () => void;
  onAutoSend: () => void;
}

export function QuickActions({
  submissionId,
  qualityScore,
  status,
  onApprove,
  onEdit,
  onSend,
  onAutoSend
}: QuickActionsProps) {
  const [showTooltip, setShowTooltip] = useState<string | null>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Only trigger if not typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'a':
          if (status === 'new' || status === 'in-review') {
            onApprove();
          }
          break;
        case 'e':
          onEdit();
          break;
        case 's':
          if (status === 'approved') {
            onSend();
          }
          break;
        case 'x':
          if (qualityScore >= 92) {
            onAutoSend();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [status, qualityScore, onApprove, onEdit, onSend, onAutoSend]);

  // Show auto-send suggestion for high-quality submissions
  const showAutoSend = qualityScore >= 92 && status === 'new';
  const showInstantApprove = qualityScore >= 90 && qualityScore < 92 && status === 'new';

  return (
    <div className="space-y-3">
      {/* Auto-Send (Quality ≥ 92) */}
      {showAutoSend && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-cortex-success/20 to-cortex-info/20 border border-cortex-success/30 rounded-cortex-md p-4"
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="size-10 rounded-full bg-cortex-success/30 flex items-center justify-center flex-shrink-0">
              <Zap className="size-5 text-cortex-success" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-white mb-1 flex items-center gap-2">
                Instant Send Recommended
                <span className="text-xs px-2 py-0.5 bg-cortex-success/30 rounded-full text-cortex-success">
                  Quality: {qualityScore}/100
                </span>
              </h4>
              <p className="text-sm text-white/70">
                This submission passed all quality checks. Send report immediately?
              </p>
            </div>
          </div>
          <button
            onClick={onAutoSend}
            className="w-full px-4 py-3 bg-gradient-to-r from-cortex-success to-cortex-info hover:from-cortex-success-deep hover:to-cortex-info/85 text-white rounded-cortex-sm font-semibold flex items-center justify-center gap-2 transition-all"
          >
            <Zap className="size-4" />
            Auto-Send Report Now
            <kbd className="ml-2 px-2 py-1 bg-white/20 rounded text-xs">X</kbd>
          </button>
          <p className="text-xs text-white/50 text-center mt-2">
            ⚡ Client will receive report in ~5 seconds
          </p>
        </motion.div>
      )}

      {/* Quick Approve (Quality 90-91) */}
      {showInstantApprove && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-cortex-accent/20 to-cortex-accent-alt/20 border border-cortex-accent/30 rounded-cortex-md p-4"
        >
          <div className="flex items-center gap-3 mb-3">
            <CheckCircle2 className="size-5 text-cortex-accent" />
            <div className="flex-1">
              <h4 className="font-bold text-white text-sm">High Quality - Quick Approve?</h4>
              <p className="text-xs text-white/60">Score: {qualityScore}/100</p>
            </div>
          </div>
          <button
            onClick={onApprove}
            className="w-full px-4 py-2 bg-gradient-to-r from-cortex-accent to-cortex-accent-alt hover:from-cortex-accent-deep hover:to-cortex-accent-alt-deep text-white rounded-cortex-sm font-semibold flex items-center justify-center gap-2 transition-all"
          >
            <CheckCircle2 className="size-4" />
            Approve
            <kbd className="ml-2 px-2 py-1 bg-white/20 rounded text-xs">A</kbd>
          </button>
        </motion.div>
      )}

      {/* Standard Actions */}
      <div className="grid grid-cols-3 gap-2">
        <ActionButton
          icon={<CheckCircle2 className="size-4" />}
          label="Approve"
          hotkey="A"
          onClick={onApprove}
          disabled={status !== 'new' && status !== 'in-review'}
          variant="success"
          tooltip="Approve for sending"
        />
        
        <ActionButton
          icon={<Edit3 className="size-4" />}
          label="Edit"
          hotkey="E"
          onClick={onEdit}
          variant="primary"
          tooltip="Make changes"
        />
        
        <ActionButton
          icon={<Send className="size-4" />}
          label="Send"
          hotkey="S"
          onClick={onSend}
          disabled={status !== 'approved'}
          variant="info"
          tooltip="Send to client"
        />
      </div>

      {/* Time Estimate */}
      <div className="flex items-center justify-between text-xs text-white/60 px-2">
        <div className="flex items-center gap-1">
          <Clock className="size-3" />
          <span>Est. review: {getEstimatedReviewTime(qualityScore)}</span>
        </div>
        {qualityScore >= 90 && (
          <div className="flex items-center gap-1 text-cortex-success">
            <Sparkles className="size-3" />
            <span>Fast-track eligible</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// ACTION BUTTON
// ============================================================================

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  hotkey: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'success' | 'warning' | 'info';
  tooltip?: string;
}

function ActionButton({
  icon,
  label,
  hotkey,
  onClick,
  disabled = false,
  variant = 'primary',
  tooltip
}: ActionButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const getVariantStyles = () => {
    switch (variant) {
      case 'success':
        return 'bg-cortex-success/20 border-cortex-success/30 text-cortex-success hover:bg-cortex-success/30';
      case 'warning':
        return 'bg-cortex-warning/20 border-cortex-warning/30 text-cortex-warning hover:bg-cortex-warning/30';
      case 'info':
        return 'bg-cortex-info/20 border-cortex-info/30 text-cortex-info hover:bg-cortex-info/30';
      default:
        return 'bg-cortex-accent/20 border-cortex-accent/30 text-cortex-accent hover:bg-cortex-accent/30';
    }
  };

  return (
    <div className="relative">
      <button
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`w-full px-3 py-2 border rounded-cortex-sm font-medium text-sm flex flex-col items-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${getVariantStyles()}`}
      >
        {icon}
        <span>{label}</span>
        <kbd className="text-[10px] px-1 py-0.5 bg-cortex-sunken rounded">{hotkey}</kbd>
      </button>
      
      {/* Tooltip */}
      {showTooltip && tooltip && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black/90 text-white text-xs rounded whitespace-nowrap z-10"
        >
          {tooltip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-black/90" />
        </motion.div>
      )}
    </div>
  );
}

// ============================================================================
// BATCH ACTIONS
// ============================================================================

interface BatchActionsProps {
  selectedCount: number;
  onApproveAll: () => void;
  onSendAll: () => void;
  onClearSelection: () => void;
}

export function BatchActions({
  selectedCount,
  onApproveAll,
  onSendAll,
  onClearSelection
}: BatchActionsProps) {
  if (selectedCount === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-black/90 backdrop-blur-xl border border-cortex-accent/30 rounded-cortex-md px-6 py-4 shadow-2xl"
    >
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-full bg-cortex-accent/30 flex items-center justify-center">
            <CheckCircle2 className="size-4 text-cortex-accent" />
          </div>
          <span className="font-semibold text-white">
            {selectedCount} selected
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onApproveAll}
            className="px-4 py-2 bg-cortex-success/20 hover:bg-cortex-success/30 border border-cortex-success/30 text-cortex-success rounded-cortex-sm font-medium text-sm transition-all flex items-center gap-2"
          >
            <CheckCircle2 className="size-4" />
            Approve All
          </button>

          <button
            onClick={onSendAll}
            className="px-4 py-2 bg-cortex-info/20 hover:bg-cortex-info/30 border border-cortex-info/30 text-cortex-info rounded-cortex-sm font-medium text-sm transition-all flex items-center gap-2"
          >
            <Send className="size-4" />
            Send All
          </button>

          <button
            onClick={onClearSelection}
            className="px-4 py-2 bg-cortex-control-hover hover:bg-white/20 border border-cortex-strong text-white rounded-cortex-sm font-medium text-sm transition-all"
          >
            Clear
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// QUICK EDIT TEMPLATES
// ============================================================================

interface QuickEditTemplate {
  id: string;
  label: string;
  description: string;
  fix: string;
}

export const QUICK_EDIT_TEMPLATES: QuickEditTemplate[] = [
  {
    id: 'clarify-problem',
    label: 'Clarify Problem Statement',
    description: 'Add more specificity to the identified problem',
    fix: 'Manual order processing with 15 data entry points and 3-5 handoffs between teams'
  },
  {
    id: 'add-roi',
    label: 'Add ROI Details',
    description: 'Include specific cost/time savings',
    fix: 'Estimated savings: $42K annually (20 hrs/week × $40/hr × 52 weeks)'
  },
  {
    id: 'specific-solution',
    label: 'Make Solution More Specific',
    description: 'Add actionable implementation steps',
    fix: 'Implement Zapier automation connecting [Tool A] → [Tool B] → [Tool C]'
  },
  {
    id: 'add-timeline',
    label: 'Add Implementation Timeline',
    description: 'Clarify when changes can happen',
    fix: 'Phase 1 (Weeks 1-2): Setup. Phase 2 (Weeks 3-4): Testing. Phase 3 (Week 5): Launch.'
  }
];

export function QuickEditPanel({ onApplyTemplate }: { onApplyTemplate: (template: QuickEditTemplate) => void }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-white/80 mb-3">Quick Fixes</h4>
      {QUICK_EDIT_TEMPLATES.map((template) => (
        <button
          key={template.id}
          onClick={() => onApplyTemplate(template)}
          className="w-full text-left px-3 py-2 bg-cortex-control hover:bg-cortex-control-hover border border-cortex-default rounded-cortex-sm transition-all group"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-sm font-medium text-white group-hover:text-cortex-accent transition-colors">
                {template.label}
              </p>
              <p className="text-xs text-white/60 mt-1">{template.description}</p>
            </div>
            <Sparkles className="size-4 text-white/40 group-hover:text-cortex-accent transition-colors flex-shrink-0" />
          </div>
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getEstimatedReviewTime(qualityScore: number): string {
  if (qualityScore >= 95) return '< 15 seconds';
  if (qualityScore >= 90) return '30 seconds';
  if (qualityScore >= 85) return '1-2 minutes';
  if (qualityScore >= 75) return '3-5 minutes';
  return '5-10 minutes';
}