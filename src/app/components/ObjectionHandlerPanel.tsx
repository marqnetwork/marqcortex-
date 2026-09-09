/**
 * OBJECTION HANDLER PANEL — Phase 6: Objection Handling Intelligence
 *
 * §9 of ProposalDraftEditor
 *
 * Spec: revenue-control-process.md §2 — Objection Handling Intelligence
 *
 * Implements:
 *   A. Engagement Monitoring — view activity, financial engagement, no-response delay
 *   B. Objection Classification Engine — keyword scoring → type + confidence
 *      Confidence > 0.65 → at_risk = true (corrected from 0.70)
 *   C. Automated Executive Response — playbooks, hydrated email templates
 *   D. Escalation Protocol — persist tracking, priority flag, strategic call trigger
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  AlertTriangle, MessageSquare, ChevronDown, ChevronRight,
  Check, X, Copy, Send, AlertCircle, Eye,
  TrendingDown, Shield, Clock, Users, DollarSign,
  RefreshCw, History, Zap, Activity, PhoneCall,
  Flag, ArrowUpCircle, FileWarning, Loader2, CheckCircle2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ObjectionType, ObjectionDetected, ObjectionPlaybook, ProposalDraft } from '@/app/types/cortex-types';
import {
  detectObjection,
  getPlaybook,
  hydratePlaybook,
} from '@/app/core/objectionEngine';
import {
  getEscalations,
  createEscalation,
  resolveEscalation,
  type EscalationRecord,
} from '@/app/services/dataService';
import { isBackendEnabled } from '@/config/runtime';
import { asArray } from '@/app/lib/payload';
import {
  border as BORDER,
  brand,
  status as STATUS,
  surface as SURFACE,
  text as TEXT,
} from '@/app/lib/tokens';

// ── Palette ──────────────────────────────────────────────────────────────────
//
// Read once at module scope. Deliberately not referenced as `status.x` inside
// the components below: one or more of them take a parameter of that name, and
// an unqualified reference there resolves to the parameter, not to the token.
const K_ACCENT        = brand.accent;
const K_BORDER_STRONG = BORDER.strong;
const K_CANVAS        = SURFACE.canvas;
const K_CAUTION       = STATUS.caution;
const K_DANGER        = STATUS.danger;
const K_INFO          = STATUS.info;
const K_NEUTRAL       = STATUS.neutral;
const K_SUCCESS       = STATUS.success;
const K_TEXT_PRIMARY  = TEXT.primary;
const K_WARNING       = STATUS.warning;


// ════════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════════

const OBJECTION_ICONS: Record<ObjectionType, LucideIcon> = {
  price:              DollarSign,
  risk:               Shield,
  timing:             Clock,
  trust:              Eye,
  internal_alignment: Users,
};

const OBJECTION_COLORS: Record<ObjectionType, string> = {
  price:              K_CAUTION,
  risk:               K_DANGER,
  timing:             K_INFO,
  trust:              K_ACCENT,
  internal_alignment: K_SUCCESS,
};

const OBJECTION_LABELS: Record<ObjectionType, string> = {
  price:              'Price Objection',
  risk:               'Risk Objection',
  timing:             'Timing Objection',
  trust:              'Trust Objection',
  internal_alignment: 'Internal Alignment Objection',
};

interface HistoryEntry {
  id:        string;
  input:     string;
  detected:  ObjectionDetected;
  timestamp: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// A. ENGAGEMENT MONITORING
// ════════════════════════════════════════════════════════════════════════════════

interface EngagementSignal {
  label:     string;
  value:     string;
  risk:      'ok' | 'warn' | 'critical';
  icon:      LucideIcon;
}

function EngagementMonitoring({ draft }: { draft: ProposalDraft }) {
  const sentAt    = draft.proposal_state?.sent_at;
  const hoursOpen = sentAt
    ? Math.round((Date.now() - new Date(sentAt).getTime()) / 3_600_000)
    : null;

  const isViewed   = draft.status === 'viewed';
  const isSent     = draft.status === 'sent' || isViewed;
  const isRejected = draft.status === 'rejected';

  // Derive mock engagement signals from proposal status
  const signals: EngagementSignal[] = [
    {
      label: 'View Activity',
      value: isViewed
        ? `Viewed · ${hoursOpen !== null ? `${hoursOpen}h ago` : 'recently'}`
        : isSent
        ? 'Delivered — not yet opened'
        : 'Not sent yet',
      risk:  isViewed ? 'ok' : isSent ? 'warn' : 'ok',
      icon:  Eye,
    },
    {
      label: 'Financial Section Engagement',
      value: isViewed
        ? 'ROI tab accessed (3 views)'
        : isSent
        ? 'Not viewed'
        : '—',
      risk:  isViewed ? 'ok' : isSent ? 'warn' : 'ok',
      icon:  TrendingDown,
    },
    {
      label: 'No-Response Delay',
      value: hoursOpen !== null
        ? hoursOpen > 72
          ? `${Math.floor(hoursOpen / 24)}d — follow-up recommended`
          : hoursOpen > 48
          ? `${hoursOpen}h — approaching threshold`
          : `${hoursOpen}h — within normal range`
        : 'N/A',
      risk:  hoursOpen !== null
        ? hoursOpen > 72 ? 'critical' : hoursOpen > 48 ? 'warn' : 'ok'
        : 'ok',
      icon:  Clock,
    },
    {
      label: 'Direct Keyword Signals',
      value: isRejected
        ? 'Rejection signal detected'
        : isViewed
        ? 'Monitoring active'
        : 'Awaiting engagement',
      risk:  isRejected ? 'critical' : 'ok',
      icon:  Activity,
    },
  ];

  const riskColors = { ok: K_SUCCESS, warn: K_CAUTION, critical: K_DANGER };

  return (
    <div className="space-y-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint flex items-center gap-2">
        <Activity className="size-3 text-cortex-info" />
        Engagement Monitoring
        <span className="text-[9px] text-cortex-faint font-normal normal-case">Continuous · Proposal {draft.proposal_id}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {signals.map(sig => (
          <div
            key={sig.label}
            className="flex items-start gap-2.5 px-3 py-2.5 rounded-cortex-sm border"
            style={{
              borderColor: `${riskColors[sig.risk]}20`,
              background:  `${riskColors[sig.risk]}06`,
            }}
          >
            <sig.icon className="size-3 flex-shrink-0 mt-0.5" style={{ color: riskColors[sig.risk] }} />
            <div className="min-w-0">
              <div className="text-[9px] font-bold text-cortex-muted truncate">{sig.label}</div>
              <div className="text-[9px] leading-snug" style={{ color: riskColors[sig.risk] }}>
                {sig.value}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// CONFIDENCE BAR
// ════════════════════════════════════════════════════════════════════════════════

function ConfidenceBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-cortex-control-hover overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.round(value * 100)}%`, background: color }}
        />
      </div>
      <span className="text-[9px] font-black w-8 text-right" style={{ color }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// D. ESCALATION PROTOCOL
// ════════════════════════════════════════════════════════════════════════════════

function EscalationProtocol({
  detected,
  draft,
  detectionCount,
  persisted = false,
  activeEscalation = null,
  syncing = false,
  error = null,
  onResolve,
}: {
  detected:          ObjectionDetected;
  draft:             ProposalDraft;
  detectionCount:    number;
  persisted?:        boolean;
  activeEscalation?: EscalationRecord | null;
  syncing?:          boolean;
  error?:            string | null;
  onResolve?:        () => void;
}) {
  const isResolved   = activeEscalation?.status === 'resolved';
  const isPersistent = detectionCount >= 2;
  const color        = K_DANGER;

  const steps = [
    {
      id:      'flag',
      icon:    Flag,
      label:   'Proposal Flagged At Risk',
      detail:  `${OBJECTION_LABELS[detected.type]} at ${Math.round(detected.confidence * 100)}% confidence — proposal ${draft.proposal_id} flagged internally.`,
      done:    true,
    },
    {
      id:      'priority',
      icon:    ArrowUpCircle,
      label:   'Follow-Up Priority Elevated',
      detail:  `Priority raised to HIGH. ${draft.client.primary_contact.name} at ${draft.client.company_name} — next follow-up due within 24h.`,
      done:    true,
    },
    {
      id:      'call',
      icon:    PhoneCall,
      label:   'Strategic Call Recommended',
      detail:  isPersistent
        ? `Objection detected ${detectionCount}×. Schedule strategic call immediately. No email chain.`
        : 'Schedule a 30-minute strategic call if objection is not resolved within 48 hours.',
      done:    isPersistent,
    },
    {
      id:      'summary',
      icon:    FileWarning,
      label:   'Objection Summary Prepared',
      detail:  `Type: ${OBJECTION_LABELS[detected.type]} · Confidence: ${Math.round(detected.confidence * 100)}% · Contact: ${draft.client.primary_contact.name} · ${draft.client.company_name}.`,
      done:    true,
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint flex items-center gap-2">
          <AlertTriangle className="size-3 text-cortex-danger" />
          Escalation Protocol
        </div>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded font-bold border"
          style={{
            color:       isResolved ? K_SUCCESS : color,
            borderColor: isResolved ? `${K_SUCCESS}30` : `${color}30`,
            background:  isResolved ? `${K_SUCCESS}10` : `${color}10`,
          }}
        >
          {isResolved ? 'RESOLVED' : isPersistent ? 'PERSISTENT — CRITICAL' : 'ACTIVE'}
        </span>
        {persisted && activeEscalation && !isResolved && onResolve && (
          <button
            onClick={onResolve}
            disabled={syncing}
            className="ml-auto flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded border transition-colors disabled:opacity-50"
            style={{ color: K_SUCCESS, borderColor: `${K_SUCCESS}30`, background: `${K_SUCCESS}10` }}
          >
            {syncing ? <Loader2 className="size-2.5 animate-spin" /> : <CheckCircle2 className="size-2.5" />}
            Mark Resolved
          </button>
        )}
      </div>

      {persisted && (
        <div className="flex items-center gap-1.5 text-[9px] text-cortex-faint">
          <Shield className="size-2.5 text-cortex-info" />
          {activeEscalation
            ? <>Escalation <span className="font-mono text-cortex-muted">{activeEscalation.id}</span> persisted{isResolved && activeEscalation.resolvedAt ? ` · resolved ${new Date(activeEscalation.resolvedAt).toLocaleTimeString()}` : ''}.</>
            : <>Escalation persistence active.</>}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-[9px] font-semibold text-cortex-danger">
          <AlertCircle className="size-2.5" />
          {error}
        </div>
      )}

      {isPersistent && (
        <div
          className="px-3 py-2 rounded-cortex-sm text-[9px] font-semibold leading-relaxed"
          style={{ background: `${K_DANGER}10`, color: K_DANGER, border: `1px solid ${K_DANGER}25` }}
        >
          Same objection type detected {detectionCount} times. Objection is persistent — reactive email is insufficient. Strategic call required.
        </div>
      )}

      <div className="space-y-1.5">
        {steps.map((step, i) => (
          <div
            key={step.id}
            className="flex items-start gap-2.5 px-3 py-2.5 rounded-cortex-sm border"
            style={{
              borderColor: step.done ? `${K_DANGER}20` : `${K_TEXT_PRIMARY}08`,
              background:  step.done ? `${K_DANGER}06` : 'transparent',
            }}
          >
            <div
              className="size-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{
                background: step.done ? `${K_DANGER}18` : `${K_TEXT_PRIMARY}06`,
                border:     `1px solid ${step.done ? `${K_DANGER}30` : `${K_TEXT_PRIMARY}10`}`,
              }}
            >
              <step.icon className="size-2.5" style={{ color: step.done ? K_DANGER : K_BORDER_STRONG }} />
            </div>
            <div className="flex-1">
              <div
                className="text-[9px] font-bold"
                style={{ color: step.done ? K_DANGER : K_BORDER_STRONG }}
              >
                {step.label}
              </div>
              <div className="text-[9px] text-cortex-faint leading-relaxed">{step.detail}</div>
            </div>
            {step.done && <Check className="size-3 text-cortex-danger flex-shrink-0 mt-1" />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// C. PLAYBOOK DISPLAY (Automated Executive Response)
// ════════════════════════════════════════════════════════════════════════════════

function PlaybookDisplay({
  playbook,
  detected,
  draft,
}: {
  playbook:  ObjectionPlaybook;
  detected:  ObjectionDetected;
  draft:     ProposalDraft;
}) {
  const hydrated           = useMemo(() => hydratePlaybook(playbook, draft), [playbook, draft]);
  const color              = OBJECTION_COLORS[playbook.type];
  const Icon               = OBJECTION_ICONS[playbook.type];
  const [showEmail, setShowEmail] = useState(false);
  const [copied,    setCopied]    = useState(false);

  const handleCopy = useCallback(() => {
    const text = `Subject: ${hydrated.email_subject}\n\n${hydrated.email_body}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [hydrated]);

  return (
    <div className="space-y-4">
      {/* Playbook header */}
      <div className="flex items-center gap-3 px-4 py-3.5 rounded-cortex-md border"
        style={{ borderColor: `${color}25`, background: `${color}08` }}
      >
        <div
          className="size-8 rounded-cortex-md flex items-center justify-center flex-shrink-0"
          style={{ background: `${color}18`, border: `1px solid ${color}30` }}
        >
          <Icon className="size-4" style={{ color }} />
        </div>
        <div className="flex-1">
          <div className="text-xs font-bold" style={{ color }}>{hydrated.label}</div>
          <ConfidenceBar value={detected.confidence} color={color} />
        </div>
        <div
          className="text-[9px] px-2 py-1 rounded-cortex-sm font-bold border"
          style={{
            color:       detected.at_risk ? K_DANGER : K_SUCCESS,
            borderColor: detected.at_risk ? `${K_DANGER}30` : `${K_SUCCESS}30`,
            background:  detected.at_risk ? `${K_DANGER}10` : `${K_SUCCESS}10`,
          }}
        >
          {detected.at_risk ? '⚡ AT RISK (>65%)' : 'NORMAL'}
        </div>
      </div>

      {/* Response points */}
      <div className="space-y-1.5">
        <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint">
          Automated Response Strategy — No Discounts Without Override
        </div>
        {hydrated.response_points.map((point, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-cortex-sm bg-black/20 border border-white/6"
          >
            <div
              className="size-4 rounded-full flex items-center justify-center flex-shrink-0 text-[8px] font-black mt-0.5"
              style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}
            >
              {i + 1}
            </div>
            <span className="text-[10px] text-cortex-secondary leading-relaxed">{point}</span>
          </div>
        ))}
      </div>

      {/* Email template */}
      <div className="bg-black/20 border border-white/6 rounded-cortex-md overflow-hidden">
        <button
          onClick={() => setShowEmail(e => !e)}
          className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
        >
          <Send className="size-3 flex-shrink-0" style={{ color }} />
          <span className="flex-1 text-[10px] font-bold text-cortex-secondary">
            Executive Response Template — Boardroom Tone
          </span>
          <span className="text-[9px] text-cortex-faint mr-2">{hydrated.email_subject}</span>
          {showEmail
            ? <ChevronDown  className="size-3 text-cortex-faint" />
            : <ChevronRight className="size-3 text-cortex-faint" />
          }
        </button>

        {showEmail && (
          <div className="border-t border-cortex-subtle p-4 space-y-3">
            <div className="space-y-1">
              <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint">Subject</div>
              <div className="px-3 py-2 bg-cortex-sunken rounded-cortex-sm text-[10px] text-cortex-secondary font-semibold">
                {hydrated.email_subject}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint">Body</div>
              <div className="px-3 py-3 bg-cortex-sunken rounded-cortex-sm text-[9px] text-cortex-muted leading-relaxed font-mono whitespace-pre-wrap">
                {hydrated.email_body}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-bold rounded-cortex-sm transition-colors"
                style={{
                  background: copied ? `${K_SUCCESS}14` : `${color}14`,
                  color:      copied ? K_SUCCESS   : color,
                  border:     `1px solid ${copied ? `${K_SUCCESS}30` : `${color}30`}`,
                }}
              >
                {copied ? <Check className="size-2.5" /> : <Copy className="size-2.5" />}
                {copied ? 'Copied!' : 'Copy Email'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT
// ════════════════════════════════════════════════════════════════════════════════

export interface ObjectionHandlerPanelProps {
  draft: ProposalDraft;
  submissionId?: string;
  accessToken?: string;
}

export function ObjectionHandlerPanel({ draft, submissionId, accessToken }: ObjectionHandlerPanelProps) {
  const [inputText,   setInputText]   = useState('');
  const [manualType,  setManualType]  = useState<ObjectionType | 'auto'>('auto');
  const [detected,    setDetected]    = useState<ObjectionDetected | null>(null);
  const [history,     setHistory]     = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // ── Escalation persistence ────────────────────────────────────────────────
  const persistEnabled = Boolean(submissionId) && Boolean(accessToken) && isBackendEnabled();
  const [escalations,   setEscalations]   = useState<EscalationRecord[]>([]);
  const [escLoading,    setEscLoading]    = useState(persistEnabled);
  const [escSyncing,    setEscSyncing]    = useState(false);
  const [escError,      setEscError]      = useState<string | null>(null);
  // The escalation record created for the currently-detected objection.
  const [activeEscalationId, setActiveEscalationId] = useState<string | null>(null);

  // Load persisted escalations on mount and seed the detection history.
  useEffect(() => {
    let cancelled = false;
    if (!persistEnabled || !submissionId || !accessToken) {
      setEscLoading(false);
      return;
    }
    setEscLoading(true);
    getEscalations(submissionId, accessToken)
      .then((res) => {
        if (cancelled) return;
        // Narrowed before it becomes state — see `@/app/lib/payload`.
        const escalations = asArray<EscalationRecord>(res.escalations);
        setEscalations(escalations);
        // Reflect persisted escalations in the detection-history log.
        setHistory(escalations.slice(0, 10).map((e) => ({
          id:        e.id,
          input:     e.inputExcerpt || `[${OBJECTION_LABELS[e.objectionType]}]`,
          detected:  { type: e.objectionType, confidence: e.confidence, at_risk: e.atRisk },
          timestamp: new Date(e.createdAt).toLocaleTimeString(),
        })));
      })
      .catch((err) => { if (!cancelled) setEscError(err?.message || 'Failed to load escalations'); })
      .finally(() => { if (!cancelled) setEscLoading(false); });
    return () => { cancelled = true; };
  }, [persistEnabled, submissionId, accessToken]);

  // Server-authoritative recurrence count for the active objection type
  // (active/persistent escalations of the same type, incl. the one just filed).
  const persistedDetectionCount = useMemo(() => {
    if (!detected) return 0;
    return escalations.filter(
      e => e.objectionType === detected.type && e.status !== 'resolved',
    ).length;
  }, [detected, escalations]);

  // Local (in-session) count used when persistence is off.
  const localDetectionCount = useMemo(
    () => detected ? history.filter(h => h.detected.type === detected.type).length + 1 : 0,
    [detected, history],
  );

  const detectionCount = persistEnabled
    ? Math.max(persistedDetectionCount, 1)
    : localDetectionCount;

  const handleDetect = useCallback(async () => {
    const result: ObjectionDetected = manualType !== 'auto'
      ? { type: manualType, confidence: 0.92, at_risk: true }
      : detectObjection(inputText);

    const excerpt = manualType !== 'auto' ? `[Manual: ${OBJECTION_LABELS[manualType]}]` : inputText;

    setDetected(result);
    setActiveEscalationId(null);
    setHistory(prev => [
      {
        id:        `h-${Date.now()}`,
        input:     excerpt,
        detected:  result,
        timestamp: new Date().toLocaleTimeString(),
      },
      ...prev.slice(0, 9),
    ]);
    console.log(`[ObjectionEngine] Detected: ${result.type} conf:${(result.confidence * 100).toFixed(0)}% at_risk:${result.at_risk} threshold:0.65`);

    // Persist the escalation when the objection crosses the at-risk threshold.
    if (result.at_risk && persistEnabled && submissionId && accessToken) {
      setEscSyncing(true);
      setEscError(null);
      try {
        const res = await createEscalation(submissionId, {
          proposalId:    draft.proposal_id,
          objectionType: result.type,
          confidence:    result.confidence,
          atRisk:        result.at_risk,
          inputExcerpt:  excerpt,
          companyName:   draft.client.company_name,
          contactName:   draft.client.primary_contact.name,
        }, accessToken);
        setEscalations(prev => [res.escalation, ...prev]);
        setActiveEscalationId(res.escalation.id);
      } catch (err: any) {
        setEscError(err?.message || 'Failed to record escalation');
      } finally {
        setEscSyncing(false);
      }
    }
  }, [inputText, manualType, persistEnabled, submissionId, accessToken, draft]);

  const handleResolve = useCallback(async () => {
    if (!persistEnabled || !submissionId || !accessToken || !activeEscalationId) return;
    setEscSyncing(true);
    setEscError(null);
    try {
      await resolveEscalation(submissionId, activeEscalationId, accessToken);
      setEscalations(prev => prev.map(e =>
        e.id === activeEscalationId
          ? { ...e, status: 'resolved', resolvedAt: new Date().toISOString() }
          : e,
      ));
      setActiveEscalationId(null);
    } catch (err: any) {
      setEscError(err?.message || 'Failed to resolve escalation');
    } finally {
      setEscSyncing(false);
    }
  }, [persistEnabled, submissionId, accessToken, activeEscalationId]);

  const handleClear = useCallback(() => {
    setDetected(null);
    setInputText('');
    setManualType('auto');
    setActiveEscalationId(null);
  }, []);

  const playbook = detected ? getPlaybook(detected.type) : null;
  const activeEscalation = activeEscalationId
    ? escalations.find(e => e.id === activeEscalationId) ?? null
    : null;

  return (
    <div className="bg-cortex-raised backdrop-blur-xl border border-cortex-default rounded-cortex-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-cortex-subtle">
        <span className="flex items-center gap-2.5 text-sm font-bold text-white">
          <MessageSquare className="size-4" style={{ color: K_WARNING }} />
          §9 Objection Handling Intelligence
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border uppercase tracking-wider"
            style={{ color: K_WARNING, borderColor: `${K_WARNING}33`, background: `${K_WARNING}14` }}
          >
            Phase 6
          </span>
        </span>
        <div className="flex items-center gap-2.5">
          {persistEnabled ? (
            <span
              className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border"
              style={{ color: K_INFO, borderColor: `${K_INFO}33`, background: `${K_INFO}14` }}
              title="Escalations are persisted to the backend"
            >
              {escLoading || escSyncing
                ? <Loader2 className="size-2.5 animate-spin" />
                : <Shield className="size-2.5" />}
              {escLoading ? 'Loading…' : escSyncing ? 'Saving…' : 'Persisted'}
            </span>
          ) : (
            <span
              className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border"
              style={{ color: K_NEUTRAL, borderColor: `${K_TEXT_PRIMARY}10`, background: `${K_TEXT_PRIMARY}06` }}
              title="Demo mode — escalations are not saved"
            >
              <Eye className="size-2.5" />
              Demo
            </span>
          )}
          <button
            onClick={() => setShowHistory(h => !h)}
            className="flex items-center gap-1.5 text-[9px] font-bold text-cortex-faint hover:text-cortex-secondary transition-colors"
          >
            <History className="size-3" />
            {history.length > 0 ? `${history.length} logged` : 'No history'}
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">

        {/* A. Engagement Monitoring */}
        <EngagementMonitoring draft={draft} />

        {/* B. Objection Detection Input */}
        <div className="space-y-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint">
            B. Objection Classification — Threshold 65%
          </div>

          {/* Mode selector */}
          <div className="flex gap-2 flex-wrap">
            {([
              ['auto',               'Auto-Detect'],
              ['price',              'Price'],
              ['risk',               'Risk'],
              ['timing',             'Timing'],
              ['trust',              'Trust'],
              ['internal_alignment', 'Internal Alignment'],
            ] as [ObjectionType | 'auto', string][]).map(([type, label]) => (
              <button
                key={type}
                onClick={() => setManualType(type)}
                className="px-2.5 py-1 rounded-cortex-sm text-[9px] font-bold border transition-colors"
                style={{
                  borderColor: manualType === type
                    ? (type === 'auto' ? K_WARNING : OBJECTION_COLORS[type as ObjectionType])
                    : `${K_TEXT_PRIMARY}10`,
                  background:  manualType === type
                    ? (type === 'auto' ? `${K_WARNING}14` : `${OBJECTION_COLORS[type as ObjectionType]}14`)
                    : 'transparent',
                  color: manualType === type
                    ? (type === 'auto' ? K_WARNING : OBJECTION_COLORS[type as ObjectionType])
                    : K_NEUTRAL,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Text input (only for auto mode) */}
          {manualType === 'auto' && (
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder={`Paste email excerpt, meeting note, or objection signal here…\ne.g. "We love the idea but the budget is tight and we'd need board approval."`}
              rows={3}
              className="w-full bg-white/[0.03] border border-cortex-default rounded-cortex-md px-4 py-3 text-[11px] text-cortex-secondary resize-none focus:outline-none focus:border-cortex-warning/40 placeholder:text-cortex-faint leading-relaxed"
            />
          )}

          {manualType !== 'auto' && (
            <div
              className="px-4 py-3 rounded-cortex-md border text-[10px] text-cortex-muted italic"
              style={{ borderColor: `${K_WARNING}20`, background: `${K_WARNING}08` }}
            >
              Manual override: <strong className="text-cortex-secondary">{OBJECTION_LABELS[manualType]}</strong> — confidence set to 92%, at_risk = true.
            </div>
          )}

          {/* Detect button */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleDetect}
              disabled={manualType === 'auto' && !inputText.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold rounded-cortex-sm transition-all"
              style={{
                background:  (manualType !== 'auto' || inputText.trim())
                  ? `linear-gradient(135deg, ${K_WARNING}, ${K_CAUTION})`
                  : `${K_TEXT_PRIMARY}08`,
                color:       (manualType !== 'auto' || inputText.trim()) ? K_CANVAS : K_BORDER_STRONG,
                cursor:      (manualType !== 'auto' || inputText.trim()) ? 'pointer' : 'not-allowed',
                boxShadow:   (manualType !== 'auto' || inputText.trim()) ? `0 4px 16px ${K_WARNING}25` : undefined,
              }}
            >
              <Zap className="size-3" />Classify Objection &amp; Load Playbook
            </button>
            {detected && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1.5 px-3 py-2 text-[9px] font-bold text-cortex-muted hover:text-white border border-cortex-default hover:border-cortex-strong rounded-cortex-sm transition-colors"
              >
                <X className="size-2.5" />Clear
              </button>
            )}
          </div>
        </div>

        {/* C. Automated Executive Response playbook */}
        {detected && playbook && (
          <PlaybookDisplay playbook={playbook} detected={detected} draft={draft} />
        )}

        {/* D. Escalation Protocol — shown when at_risk */}
        {detected?.at_risk && (
          <EscalationProtocol
            detected={detected}
            draft={draft}
            detectionCount={detectionCount}
            persisted={persistEnabled}
            activeEscalation={activeEscalation}
            syncing={escSyncing}
            error={escError}
            onResolve={handleResolve}
          />
        )}

        {/* Empty state */}
        {!detected && (
          <div className="flex items-center gap-3 px-4 py-3.5 rounded-cortex-md bg-white/[0.02] border border-white/6">
            <MessageSquare className="size-3.5 text-cortex-faint flex-shrink-0" />
            <div className="text-[10px] text-cortex-faint leading-relaxed">
              Paste a client objection signal above to auto-classify type, load the response playbook, and generate a hydrated email. Confidence &gt; 65% activates the escalation protocol and flags the proposal at-risk.
            </div>
          </div>
        )}

        {/* Detection history log */}
        {showHistory && history.length > 0 && (
          <div className="space-y-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-cortex-faint flex items-center gap-2">
              <History className="size-3" />Detection History
            </div>
            <div className="space-y-1.5">
              {history.map(entry => {
                const Icon  = OBJECTION_ICONS[entry.detected.type];
                const color = OBJECTION_COLORS[entry.detected.type];
                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-cortex-sm bg-black/20 border border-white/6 cursor-pointer hover:border-cortex-default transition-colors"
                    onClick={() => {
                      setDetected(entry.detected);
                      setShowHistory(false);
                    }}
                  >
                    <Icon className="size-3 flex-shrink-0" style={{ color }} />
                    <span className="flex-1 text-[9px] text-cortex-muted truncate">{entry.input}</span>
                    <span className="text-[9px] font-bold flex-shrink-0" style={{ color }}>
                      {OBJECTION_LABELS[entry.detected.type]}
                    </span>
                    <span
                      className="text-[9px] font-black flex-shrink-0"
                      style={{ color: entry.detected.at_risk ? K_DANGER : K_SUCCESS }}
                    >
                      {Math.round(entry.detected.confidence * 100)}%
                    </span>
                    <span className="text-[9px] text-cortex-faint flex-shrink-0">{entry.timestamp}</span>
                  </div>
                );
              })}
            </div>
            <div className="text-[9px] text-cortex-faint italic pl-1">
              Click any entry to reload its playbook.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
