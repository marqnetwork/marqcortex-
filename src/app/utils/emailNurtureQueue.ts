/**
 * EMAIL NURTURE QUEUE — Client-Side Queue Manager
 *
 * Maintains a queue of pending email nurture actions in localStorage.
 * When BACKEND_INTEGRATION is true, these are also persisted via the server.
 *
 * Emails in the queue represent what WOULD be sent at each stage:
 *   1. Diagnostic Received   — immediate after submission
 *   2. Score Summary         — immediate (with instant score)
 *   3. Report Ready          — after CORTEX analysis complete
 *   4. Meeting Nudge         — 48h after report, if no call booked
 *   5. Follow-Up Reminder    — 5d after score, if no engagement
 *   6. Proposal Delivered    — after team sends proposal
 *
 * The team dashboard shows the full queue so they can see
 * what nurture emails are pending, sent, or skipped for each lead.
 */

import { DEMO_NURTURE_LEADS } from '@/app/services/dataService';

// ── Types ────────────────────────────────────────────────────────────────────

export type EmailStatus = 'pending' | 'sent' | 'skipped' | 'failed';
export type EmailTemplateId =
  | 'diagnostic_received'
  | 'score_summary'
  | 'report_ready'
  | 'meeting_nudge'
  | 'followup_reminder'
  | 'proposal_delivered';

export interface QueuedEmail {
  id: string;
  submissionId: string;
  contactName: string;
  contactEmail: string;
  companyName: string;
  industry: string;
  templateId: EmailTemplateId;
  subject: string;
  previewText: string;
  status: EmailStatus;
  scheduledAt: string;   // ISO — when it should fire
  sentAt: string | null; // ISO — when it actually fired
  createdAt: string;
  readinessScore?: number;
  bottleneckTheme?: string;
  // A/B subject line testing
  subjectVariantA?: string;
  subjectVariantB?: string;
  activeVariant?: 'A' | 'B';
}

// ── Template metadata ────────────────────────────────────────────────────────

interface TemplateConfig {
  id: EmailTemplateId;
  label: string;
  subject: (name: string, company: string) => string;
  preview: (name: string, score?: number) => string;
  delayMs: number;  // ms after submission to schedule
  color: string;
  icon: string;     // emoji
}

export const EMAIL_TEMPLATE_CONFIGS: TemplateConfig[] = [
  {
    id: 'diagnostic_received',
    label: 'Diagnostic Received',
    subject: (name) => `Thanks ${name} — we're analyzing your responses`,
    preview: (name) => `Hi ${name}, we've received your diagnostic and our AI is analyzing it now. You'll hear from us within 4-6 hours.`,
    delayMs: 0,
    color: '#06D7F6',
    icon: '📥',
  },
  {
    id: 'score_summary',
    label: 'Score Summary',
    subject: (_, company) => `Your AI Readiness Score for ${company}`,
    preview: (name, score) => `Hi ${name}, your AI Readiness Score is ${score ?? '—'}/100. Here's what we found and what you can do about it.`,
    delayMs: 60_000, // 1 minute after (sent alongside the instant score)
    color: '#8B5CF6',
    icon: '📊',
  },
  {
    id: 'report_ready',
    label: 'Full Report Ready',
    subject: (name) => `${name}, your full readiness report is ready`,
    preview: (name) => `Hi ${name}, our team has completed the deep analysis. Your personalised report with actionable recommendations is ready to view.`,
    delayMs: 4 * 3600_000, // 4 hours
    color: '#3B82F6',
    icon: '📋',
  },
  {
    id: 'meeting_nudge',
    label: 'Meeting Nudge',
    subject: (name) => `${name}, let's discuss your opportunities`,
    preview: (name) => `Hi ${name}, I reviewed your assessment and spotted some quick wins. Can we spend 30 minutes walking through them?`,
    delayMs: 48 * 3600_000, // 48 hours
    color: '#FB923C',
    icon: '📞',
  },
  {
    id: 'followup_reminder',
    label: 'Follow-Up Reminder',
    subject: (_, company) => `Still thinking about ${company}'s AI roadmap?`,
    preview: (name) => `Hi ${name}, it's been a few days since your assessment. The insights we found don't expire, but the competitive window does.`,
    delayMs: 5 * 24 * 3600_000, // 5 days
    color: '#FD4438',
    icon: '🔔',
  },
  {
    id: 'proposal_delivered',
    label: 'Proposal Delivered',
    subject: (name) => `${name}, your custom proposal is ready`,
    preview: (name) => `Hi ${name}, based on our readiness call, we've prepared a tailored proposal with phased implementation and clear ROI projections.`,
    delayMs: 0, // triggered manually by team
    color: '#10B981',
    icon: '📝',
  },
];

// ── Storage key ──────────────────────────────────────────────────────────────

const QUEUE_KEY = 'eclipse_email_nurture_queue';

// ── Queue operations ─────────────────────────────────────────────────────────

function loadQueue(): QueuedEmail[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedEmail[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Generate a unique id */
function uid(): string {
  return `eq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Enqueue the standard nurture sequence for a new submission.
 * Called from App.tsx after diagnostic completion.
 */
export function enqueueNurtureSequence(params: {
  submissionId: string;
  contactName: string;
  contactEmail: string;
  companyName: string;
  industry: string;
  readinessScore: number;
  bottleneckTheme: string;
}): QueuedEmail[] {
  const queue = loadQueue();
  const now = Date.now();
  const newEntries: QueuedEmail[] = [];

  for (const tpl of EMAIL_TEMPLATE_CONFIGS) {
    // Skip proposal_delivered — that's triggered manually later
    if (tpl.id === 'proposal_delivered') continue;

    const entry: QueuedEmail = {
      id: uid(),
      submissionId: params.submissionId,
      contactName: params.contactName,
      contactEmail: params.contactEmail,
      companyName: params.companyName,
      industry: params.industry,
      templateId: tpl.id,
      subject: tpl.subject(params.contactName, params.companyName),
      previewText: tpl.preview(params.contactName, params.readinessScore),
      status: tpl.delayMs === 0 ? 'sent' : 'pending',
      scheduledAt: new Date(now + tpl.delayMs).toISOString(),
      sentAt: tpl.delayMs === 0 ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
      readinessScore: params.readinessScore,
      bottleneckTheme: params.bottleneckTheme,
    };
    newEntries.push(entry);
  }

  saveQueue([...newEntries, ...queue]);
  return newEntries;
}

/**
 * Get the full queue (newest first).
 */
export function getEmailQueue(): QueuedEmail[] {
  return loadQueue().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Get queue entries for a specific submission.
 */
export function getEmailsForSubmission(submissionId: string): QueuedEmail[] {
  return loadQueue()
    .filter((e) => e.submissionId === submissionId)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}

/**
 * Mark an email as sent.
 */
export function markEmailSent(emailId: string): void {
  const queue = loadQueue();
  const idx = queue.findIndex((e) => e.id === emailId);
  if (idx >= 0) {
    queue[idx].status = 'sent';
    queue[idx].sentAt = new Date().toISOString();
    saveQueue(queue);
  }
}

/**
 * Mark an email as skipped.
 */
export function markEmailSkipped(emailId: string): void {
  const queue = loadQueue();
  const idx = queue.findIndex((e) => e.id === emailId);
  if (idx >= 0) {
    queue[idx].status = 'skipped';
    saveQueue(queue);
  }
}

/**
 * Get queue summary stats.
 */
export function getQueueStats(): {
  total: number;
  pending: number;
  sent: number;
  skipped: number;
  failed: number;
  byTemplate: Record<EmailTemplateId, number>;
} {
  const queue = loadQueue();
  const byTemplate = {} as Record<EmailTemplateId, number>;
  for (const tpl of EMAIL_TEMPLATE_CONFIGS) {
    byTemplate[tpl.id] = queue.filter((e) => e.templateId === tpl.id && e.status === 'pending').length;
  }
  return {
    total: queue.length,
    pending: queue.filter((e) => e.status === 'pending').length,
    sent: queue.filter((e) => e.status === 'sent').length,
    skipped: queue.filter((e) => e.status === 'skipped').length,
    failed: queue.filter((e) => e.status === 'failed').length,
    byTemplate,
  };
}

/**
 * Clear all queue entries (for testing).
 */
export function clearQueue(): void {
  localStorage.removeItem(QUEUE_KEY);
}

/**
 * Seed the queue with demo data.
 */
export function seedDemoQueue(): void {
  const existing = loadQueue();
  if (existing.length > 0) return; // Don't re-seed

  const now = Date.now();
  const entries: QueuedEmail[] = [];

  for (const lead of DEMO_NURTURE_LEADS) {
    const submissionId = `demo-sub-${lead.email.split('@')[0]}`;
    for (const tpl of EMAIL_TEMPLATE_CONFIGS) {
      if (tpl.id === 'proposal_delivered') continue;

      const scheduledTime = now - lead.ageMs + tpl.delayMs;
      const isPast = scheduledTime < now;
      const isMeetingNudge = tpl.id === 'meeting_nudge';

      entries.push({
        id: uid(),
        submissionId,
        contactName: lead.name,
        contactEmail: lead.email,
        companyName: lead.company,
        industry: lead.industry,
        templateId: tpl.id,
        subject: tpl.subject(lead.name, lead.company),
        previewText: tpl.preview(lead.name, lead.score),
        status: isPast ? (isMeetingNudge && lead.ageMs > 50 * 3600_000 ? 'skipped' : 'sent') : 'pending',
        scheduledAt: new Date(scheduledTime).toISOString(),
        sentAt: isPast ? new Date(scheduledTime).toISOString() : null,
        createdAt: new Date(now - lead.ageMs).toISOString(),
        readinessScore: lead.score,
        bottleneckTheme: lead.theme,
      });
    }
  }

  saveQueue(entries);
}

// ── A/B Subject Line Testing ─────────────────────────────────────────────────

/**
 * Alternate (B-variant) subject lines for each template.
 * Variant A = the original subject from EMAIL_TEMPLATE_CONFIGS.
 * Variant B = a re-written subject designed to test different hooks.
 */
export const AB_VARIANT_B_SUBJECTS: Record<EmailTemplateId, (name: string, company: string) => string> = {
  diagnostic_received: (name) => `${name}, your AI diagnostic is being processed`,
  score_summary: (_, company) => `${company}: Here's your AI readiness breakdown`,
  report_ready: (name) => `Your personalised AI roadmap is live, ${name}`,
  meeting_nudge: (name) => `Quick wins spotted, ${name} — 30 min to review?`,
  followup_reminder: (_, company) => `${company}'s competitive window is closing`,
  proposal_delivered: (name) => `${name}, your implementation plan is attached`,
};

/**
 * Seed A/B variants onto all emails that don't have them yet.
 * Randomly assigns activeVariant (50/50 split).
 * Idempotent — skips emails that already have variants set.
 */
export function seedABVariants(): void {
  const queue = loadQueue();
  let changed = false;

  for (const email of queue) {
    if (email.subjectVariantA && email.subjectVariantB) continue;

    const tplCfg = EMAIL_TEMPLATE_CONFIGS.find((t) => t.id === email.templateId);
    if (!tplCfg) continue;

    const variantBFn = AB_VARIANT_B_SUBJECTS[email.templateId];
    if (!variantBFn) continue;

    email.subjectVariantA = tplCfg.subject(email.contactName, email.companyName);
    email.subjectVariantB = variantBFn(email.contactName, email.companyName);
    email.activeVariant = Math.random() < 0.5 ? 'A' : 'B';
    // Set subject to match active variant
    email.subject = email.activeVariant === 'A' ? email.subjectVariantA : email.subjectVariantB;
    changed = true;
  }

  if (changed) saveQueue(queue);
}

/**
 * Switch a single email between variant A and B.
 */
export function switchVariant(emailId: string): void {
  const queue = loadQueue();
  const idx = queue.findIndex((e) => e.id === emailId);
  if (idx < 0) return;

  const email = queue[idx];
  if (!email.subjectVariantA || !email.subjectVariantB) return;

  email.activeVariant = email.activeVariant === 'A' ? 'B' : 'A';
  email.subject = email.activeVariant === 'A' ? email.subjectVariantA : email.subjectVariantB;
  saveQueue(queue);
}

/**
 * Bulk-apply a variant to all pending emails of a given template.
 */
export function bulkApplyVariant(templateId: EmailTemplateId, variant: 'A' | 'B'): number {
  const queue = loadQueue();
  let count = 0;

  for (const email of queue) {
    if (email.templateId !== templateId) continue;
    if (email.status !== 'pending') continue;
    if (!email.subjectVariantA || !email.subjectVariantB) continue;

    email.activeVariant = variant;
    email.subject = variant === 'A' ? email.subjectVariantA : email.subjectVariantB;
    count++;
  }

  saveQueue(queue);
  return count;
}

/**
 * Get A/B test stats for a given template:
 * - how many sent with A vs B
 * - pending counts per variant
 */
export interface ABTestStats {
  templateId: EmailTemplateId;
  label: string;
  color: string;
  icon: string;
  sampleSubjectA: string;
  sampleSubjectB: string;
  sentA: number;
  sentB: number;
  pendingA: number;
  pendingB: number;
  totalA: number;
  totalB: number;
}

export function getABTestStats(): ABTestStats[] {
  const queue = loadQueue();
  const results: ABTestStats[] = [];

  for (const tpl of EMAIL_TEMPLATE_CONFIGS) {
    if (tpl.id === 'proposal_delivered') continue;

    const emails = queue.filter((e) => e.templateId === tpl.id && e.subjectVariantA && e.subjectVariantB);
    if (emails.length === 0) continue;

    const sentA = emails.filter((e) => e.status === 'sent' && e.activeVariant === 'A').length;
    const sentB = emails.filter((e) => e.status === 'sent' && e.activeVariant === 'B').length;
    const pendingA = emails.filter((e) => e.status === 'pending' && e.activeVariant === 'A').length;
    const pendingB = emails.filter((e) => e.status === 'pending' && e.activeVariant === 'B').length;

    results.push({
      templateId: tpl.id,
      label: tpl.label,
      color: tpl.color,
      icon: tpl.icon,
      sampleSubjectA: emails[0].subjectVariantA!,
      sampleSubjectB: emails[0].subjectVariantB!,
      sentA,
      sentB,
      pendingA,
      pendingB,
      totalA: sentA + pendingA,
      totalB: sentB + pendingB,
    });
  }

  return results;
}

// ── Delivery Tracking Types (API-Ready) ──────────────────────────────────────
// These types define the shape of delivery data that will flow back from
// the email API (Resend/SendGrid/etc.) once BACKEND_INTEGRATION is enabled.
// For now they power the demo analytics in the EmailNurturePanel.

export interface EmailDeliveryEvent {
  emailId: string;
  event: 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'unsubscribed';
  timestamp: string;
  metadata?: {
    userAgent?: string;
    ipAddress?: string;
    linkUrl?: string;        // for 'clicked' events
    bounceType?: 'hard' | 'soft';
  };
}

export interface EmailDeliveryStats {
  totalSent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  deliveryRate: number;      // delivered / totalSent (%)
  openRate: number;          // opened / delivered (%)
  clickRate: number;         // clicked / opened (%)
  bounceRate: number;        // bounced / totalSent (%)
}

export interface TemplatePerformance {
  templateId: EmailTemplateId;
  label: string;
  stats: EmailDeliveryStats;
  bestSubjectLine: string;
  bestOpenRate: number;
}

/**
 * Get demo delivery stats for the nurture queue.
 * When BACKEND_INTEGRATION is true, replace this with real webhook data from Resend.
 *
 * API integration point:
 *   GET /email/stats → returns EmailDeliveryStats
 *   POST /email/webhooks/resend → receives EmailDeliveryEvent from Resend webhooks
 */
export function getDemoDeliveryStats(): EmailDeliveryStats {
  const queue = loadQueue();
  const sent = queue.filter(e => e.status === 'sent');
  const totalSent = sent.length;

  // Simulate realistic email delivery metrics
  const delivered = Math.round(totalSent * 0.97);
  const opened = Math.round(delivered * 0.42);
  const clicked = Math.round(opened * 0.18);
  const bounced = Math.round(totalSent * 0.02);

  return {
    totalSent,
    delivered,
    opened,
    clicked,
    bounced,
    complained: 0,
    unsubscribed: 0,
    deliveryRate: totalSent > 0 ? Math.round((delivered / totalSent) * 100) : 0,
    openRate: delivered > 0 ? Math.round((opened / delivered) * 100) : 0,
    clickRate: opened > 0 ? Math.round((clicked / opened) * 100) : 0,
    bounceRate: totalSent > 0 ? Math.round((bounced / totalSent) * 100) : 0,
  };
}

/**
 * Get per-template performance for the analytics view.
 * API integration point: GET /email/stats/by-template
 */
export function getDemoTemplatePerformance(): TemplatePerformance[] {
  const queue = loadQueue();

  // Simulated open rates vary by template type (realistic industry benchmarks)
  const benchmarkOpenRates: Record<EmailTemplateId, number> = {
    diagnostic_received: 0.72,  // transactional — high
    score_summary: 0.58,
    report_ready: 0.65,
    meeting_nudge: 0.34,
    followup_reminder: 0.28,
    proposal_delivered: 0.78,   // high-intent
  };

  return EMAIL_TEMPLATE_CONFIGS.map(tpl => {
    const sent = queue.filter(e => e.templateId === tpl.id && e.status === 'sent');
    const totalSent = sent.length;
    const openRate = benchmarkOpenRates[tpl.id] ?? 0.35;
    const opened = Math.round(totalSent * openRate);
    const clicked = Math.round(opened * 0.2);

    return {
      templateId: tpl.id,
      label: tpl.label,
      stats: {
        totalSent,
        delivered: Math.round(totalSent * 0.97),
        opened,
        clicked,
        bounced: Math.round(totalSent * 0.02),
        complained: 0,
        unsubscribed: 0,
        deliveryRate: totalSent > 0 ? 97 : 0,
        openRate: totalSent > 0 ? Math.round(openRate * 100) : 0,
        clickRate: opened > 0 ? Math.round((clicked / opened) * 100) : 0,
        bounceRate: totalSent > 0 ? 2 : 0,
      },
      bestSubjectLine: sent[0]?.subject ?? tpl.subject('{{name}}', '{{company}}'),
      bestOpenRate: Math.round(openRate * 100),
    };
  });
}

// ── Email Preview / Render (API-Ready) ───────────────────────────────────────
// These functions generate the full HTML that would be sent via the API.
// When BACKEND_INTEGRATION is true, the server's emailService.ts handles rendering.
// In demo mode, these allow the team to preview exactly what clients receive.

export interface EmailPreview {
  to: string;
  from: string;
  subject: string;
  html: string;
  plainText: string;
  templateId: EmailTemplateId;
  personalisation: Record<string, string>;
}

/**
 * Generate a preview of what a queued email would look like when sent.
 * API integration point: POST /email/preview → returns { html, plainText }
 */
export function getEmailPreview(emailId: string): EmailPreview | null {
  const queue = loadQueue();
  const email = queue.find(e => e.id === emailId);
  if (!email) return null;

  return {
    to: email.contactEmail,
    from: 'MARQ Cortex <team@marqcortex.com>',
    subject: email.subject,
    html: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#0A0A1A;color:#E5E7EB;border-radius:12px;">
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="color:#8B5CF6;font-size:24px;margin:0;">MARQ CORTEX</h1>
      </div>
      <p style="font-size:16px;line-height:1.6;color:#D1D5DB;">Hi ${email.contactName},</p>
      <p style="font-size:14px;line-height:1.6;color:#9CA3AF;">${email.previewText}</p>
      <div style="margin:24px 0;padding:16px;background:rgba(139,92,246,0.1);border-left:3px solid #8B5CF6;border-radius:4px;">
        <p style="margin:0;font-size:13px;color:#C4B5FD;">This is a preview of the <strong>${EMAIL_TEMPLATE_CONFIGS.find(t => t.id === email.templateId)?.label}</strong> template.</p>
      </div>
      <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;" />
      <p style="font-size:11px;color:#6B7280;text-align:center;">MARQ Cortex · AI Consultancy · <a href="#" style="color:#8B5CF6;">Unsubscribe</a></p>
    </div>`,
    plainText: `Hi ${email.contactName},\n\n${email.previewText}\n\n---\nMARQ Cortex · AI Consultancy`,
    templateId: email.templateId,
    personalisation: {
      name: email.contactName,
      company: email.companyName,
      email: email.contactEmail,
      industry: email.industry,
      score: String(email.readinessScore ?? ''),
      theme: email.bottleneckTheme ?? '',
    },
  };
}

// ── API Integration Contracts ────────────────────────────────────────────────
// These interfaces document the exact shape of the API endpoints that will
// replace the localStorage-based queue when BACKEND_INTEGRATION is flipped to true.
//
// Server routes (already scaffolded in /supabase/functions/server/index.tsx):
//   GET    /email-queue              → list queue items (with filters)
//   PATCH  /email-queue/:id          → update status (send/skip/reschedule)
//   POST   /email/send               → trigger immediate send via Resend
//   GET    /email/status             → Resend API key status + delivery health
//   POST   /email/preview            → render email HTML without sending
//
// Webhook endpoint (to be added):
//   POST   /email/webhooks/resend    → receives delivery events from Resend
//
// Environment variables required:
//   RESEND_API_KEY                   → Resend API key for sending
//   EMAIL_FROM                       → Verified sender (team@marqcortex.com)
//
// The migration path:
//   1. Set RESEND_API_KEY as Supabase secret
//   2. Verify sender domain in Resend dashboard
//   3. Flip BACKEND_INTEGRATION to true in /src/config/features.ts
//   4. All EmailService.send() calls will route through the server
//   5. Add Resend webhook URL pointing to /email/webhooks/resend
//   6. Delivery events flow back into the dashboard automatically