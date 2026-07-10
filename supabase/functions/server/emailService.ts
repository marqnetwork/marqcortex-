/**
 * EMAIL SERVICE
 * Uses Resend. Gracefully no-ops when RESEND_API_KEY is not set.
 * Set the secret via: Supabase Dashboard → Edge Functions → Secrets → RESEND_API_KEY
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
// Use onboarding@resend.dev for sandbox, switch to team@marqcortex.com after domain verification
const FROM = Deno.env.get('EMAIL_FROM') || 'MARQ Cortex <onboarding@resend.dev>';

export function isResendConfigured(): boolean {
  return !!RESEND_API_KEY;
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log(`📧 [EMAIL SKIPPED — no RESEND_API_KEY] To: ${to} | Subject: ${subject}`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.log(`📧 Email send error to ${to}:`, JSON.stringify(data));
    } else {
      console.log(`✅ Email sent to ${to} — subject: "${subject}"`);
    }
  } catch (err) {
    console.log(`📧 Email exception for ${to}:`, err);
  }
}

// ============================================================================
// TEMPLATE HELPERS
// ============================================================================

function baseTemplate(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MARQ Cortex</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0F;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0A0A0F;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;">
          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#8B5CF6,#3B82F6);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;">
              <div style="display:inline-flex;align-items:center;gap:12px;">
                <div style="width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:12px;display:inline-block;line-height:44px;text-align:center;font-size:22px;">⚡</div>
                <span style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">MARQ Cortex</span>
              </div>
            </td>
          </tr>
          <!-- BODY -->
          <tr>
            <td style="background:#111118;border-left:1px solid rgba(255,255,255,0.08);border-right:1px solid rgba(255,255,255,0.08);padding:40px;">
              ${body}
            </td>
          </tr>
          <!-- FOOTER -->
          <tr>
            <td style="background:#0D0D14;border:1px solid rgba(255,255,255,0.08);border-top:none;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
              <p style="color:#4B5563;font-size:12px;margin:0;">© 2026 MARQ Cortex · Operational Intelligence Platform</p>
              <p style="color:#374151;font-size:11px;margin:8px 0 0;">You received this because you're part of the MARQ Cortex platform.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function statChip(label: string, value: string, color: string): string {
  return `<td style="padding:0 6px;">
    <div style="background:${color}18;border:1px solid ${color}40;border-radius:10px;padding:12px 16px;text-align:center;">
      <div style="color:${color};font-size:18px;font-weight:700;">${value}</div>
      <div style="color:#6B7280;font-size:11px;margin-top:2px;">${label}</div>
    </div>
  </td>`;
}

function ctaButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:linear-gradient(135deg,#8B5CF6,#3B82F6);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:600;font-size:15px;letter-spacing:0.2px;">${label}</a>`;
}

// ============================================================================
// EMAIL 1 — TEAM: new submission alert
// ============================================================================

export async function sendTeamNewSubmissionEmail(submission: {
  id: string;
  company: string;
  contact: string;
  email: string;
  industry: string;
  priority: string;
  completionScore: number;
  qualityScore: number;
  submittedDate: string;
}, teamEmail = 'admin@marqcortex.com') {
  const priorityColor = submission.priority === 'high' ? '#FD4438' : submission.priority === 'medium' ? '#FB923C' : '#70707C';
  const priorityLabel = submission.priority.charAt(0).toUpperCase() + submission.priority.slice(1);

  const html = baseTemplate(`
    <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0 0 8px;">🔔 New Diagnostic Submission</h1>
    <p style="color:#9CA3AF;font-size:15px;margin:0 0 32px;">A new business has completed the diagnostic questionnaire and is ready for review.</p>

    <div style="background:#1A1A26;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:24px;margin:0 0 28px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="48" valign="top" style="padding-right:16px;">
            <div style="width:48px;height:48px;background:linear-gradient(135deg,#8B5CF620,#3B82F620);border:1px solid #8B5CF640;border-radius:12px;text-align:center;line-height:48px;font-size:22px;">🏢</div>
          </td>
          <td valign="top">
            <div style="color:#fff;font-size:18px;font-weight:700;">${submission.company}</div>
            <div style="color:#9CA3AF;font-size:14px;margin-top:2px;">${submission.contact} · ${submission.email}</div>
            <div style="color:#6B7280;font-size:13px;margin-top:4px;">${submission.industry} · Submitted ${submission.submittedDate}</div>
          </td>
          <td align="right" valign="top">
            <span style="background:${priorityColor}20;border:1px solid ${priorityColor}50;color:${priorityColor};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">${priorityLabel} Priority</span>
          </td>
        </tr>
      </table>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      <tr>
        ${statChip('Completion', `${submission.completionScore}%`, '#8B5CF6')}
        ${statChip('Quality', `${submission.qualityScore}%`, '#3B82F6')}
        ${statChip('Priority', priorityLabel, priorityColor)}
      </tr>
    </table>

    <div style="text-align:center;">
      ${ctaButton('https://marqcortex.app/dashboard', 'Open in CORTEX Dashboard →')}
    </div>

    <p style="color:#4B5563;font-size:13px;text-align:center;margin:24px 0 0;">Submission ID: ${submission.id}</p>
  `);

  await sendEmail(teamEmail, `🔔 New Submission — ${submission.company} (${priorityLabel} Priority)`, html);
}

// ============================================================================
// EMAIL 2 — CLIENT: submission under review
// ============================================================================

export async function sendClientUnderReviewEmail(submission: {
  company: string;
  contact: string;
  email: string;
  completionScore: number;
}) {
  const firstName = submission.contact.split(' ')[0];

  const html = baseTemplate(`
    <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0 0 8px;">We've received your diagnostic, ${firstName}.</h1>
    <p style="color:#9CA3AF;font-size:15px;line-height:1.6;margin:0 0 28px;">
      Great news — your operational assessment for <strong style="color:#fff;">${submission.company}</strong> is now being reviewed by our team of analysts. We'll work through your responses and build a personalised readiness report.
    </p>

    <div style="background:linear-gradient(135deg,#FB923C18,#8B5CF618);border:1px solid #FB923C30;border-radius:14px;padding:24px;margin:0 0 28px;text-align:center;">
      <div style="font-size:32px;margin-bottom:8px;">🔍</div>
      <div style="color:#FB923C;font-size:16px;font-weight:700;">Currently Under Review</div>
      <div style="color:#9CA3AF;font-size:14px;margin-top:6px;">Our analysts are studying your ${submission.completionScore}% completion score and building insights</div>
    </div>

    <h3 style="color:#fff;font-size:16px;font-weight:600;margin:0 0 16px;">What happens next?</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      ${['Your answers are reviewed for completeness and depth', 'Our AI engine generates operational insights specific to your industry', 'A personalised readiness report is compiled for your business', 'You\'ll receive an email when your report is ready to view'].map((step, i) => `
        <tr>
          <td valign="top" style="padding:8px 0;">
            <span style="display:inline-block;width:24px;height:24px;background:#8B5CF620;border:1px solid #8B5CF640;border-radius:50%;color:#8B5CF6;font-size:11px;font-weight:700;text-align:center;line-height:24px;margin-right:12px;">${i + 1}</span>
            <span style="color:#D1D5DB;font-size:14px;">${step}</span>
          </td>
        </tr>
      `).join('')}
    </table>

    <p style="color:#6B7280;font-size:13px;text-align:center;margin:0;">Typical turnaround: 24–48 hours · We'll email you when your report is ready.</p>
  `);

  await sendEmail(submission.email, `Your Diagnostic Is Being Reviewed — ${submission.company}`, html);
}

// ============================================================================
// EMAIL 3 — CLIENT: report ready
// ============================================================================

export async function sendClientReportReadyEmail(submission: {
  id: string;
  company: string;
  contact: string;
  email: string;
  qualityScore: number;
  roiPotential: string;
}) {
  const firstName = submission.contact.split(' ')[0];

  const html = baseTemplate(`
    <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0 0 8px;">Your report is ready, ${firstName}! 🎉</h1>
    <p style="color:#9CA3AF;font-size:15px;line-height:1.6;margin:0 0 28px;">
      Your <strong style="color:#fff;">${submission.company}</strong> Operational Readiness Report has been completed by our team. Log in to the client portal to view your full analysis, recommendations, and ROI projections.
    </p>

    <div style="background:linear-gradient(135deg,#06D7F618,#3B82F618);border:1px solid #06D7F630;border-radius:14px;padding:24px;margin:0 0 28px;text-align:center;">
      <div style="font-size:36px;margin-bottom:8px;">📊</div>
      <div style="color:#06D7F6;font-size:18px;font-weight:700;">Report Ready to View</div>
      <div style="color:#9CA3AF;font-size:14px;margin-top:6px;">Quality score: ${submission.qualityScore}% · Estimated ROI: ${submission.roiPotential}</div>
    </div>

    <h3 style="color:#fff;font-size:16px;font-weight:600;margin:0 0 16px;">Your report includes:</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
      ${['Operational Readiness Score with detailed breakdown', 'Industry-benchmarked performance analysis', 'Top 3 high-impact quick wins for immediate action', 'AI-powered ROI projections and opportunity sizing', 'Strategic recommendations tailored to your business'].map(item => `
        <tr>
          <td style="padding:6px 0;">
            <span style="color:#06D7F6;margin-right:10px;">✓</span>
            <span style="color:#D1D5DB;font-size:14px;">${item}</span>
          </td>
        </tr>
      `).join('')}
    </table>

    <div style="text-align:center;margin:0 0 24px;">
      ${ctaButton('https://marqcortex.app/client', 'View My Full Report →')}
    </div>

    <p style="color:#4B5563;font-size:13px;text-align:center;margin:0;">Log in with the email address you used during the diagnostic assessment.</p>
  `);

  await sendEmail(submission.email, `📊 Your Readiness Report is Ready — ${submission.company}`, html);
}

// ============================================================================
// EMAIL 4 — CLIENT: proposal sent (they have a proposal to review)
// ============================================================================

export async function sendProposalSentEmail(submission: {
  company: string;
  contact: string;
  email: string;
}, proposal: {
  title?: string;
  total_investment?: string;
  timeline?: string;
}) {
  const firstName = submission.contact.split(' ')[0];
  const proposalTitle = proposal.title || 'Operational Partnership Proposal';

  const html = baseTemplate(`
    <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0 0 8px;">You have a proposal, ${firstName}! 📋</h1>
    <p style="color:#9CA3AF;font-size:15px;line-height:1.6;margin:0 0 28px;">
      Great news — our team has prepared a personalised proposal for <strong style="color:#fff;">${submission.company}</strong> based on your diagnostic results. Log in to your client portal to review the full details.
    </p>

    <div style="background:linear-gradient(135deg,#8B5CF618,#3B82F618);border:1px solid #8B5CF630;border-radius:14px;padding:28px;margin:0 0 28px;">
      <div style="color:#8B5CF6;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Proposal Ready</div>
      <div style="color:#fff;font-size:20px;font-weight:700;margin-bottom:16px;">${proposalTitle}</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${proposal.total_investment ? statChip('Investment', proposal.total_investment, '#8B5CF6') : ''}
          ${proposal.timeline ? statChip('Timeline', proposal.timeline, '#3B82F6') : ''}
          ${statChip('Status', 'Awaiting Review', '#FB923C')}
        </tr>
      </table>
    </div>

    <p style="color:#9CA3AF;font-size:14px;line-height:1.6;margin:0 0 28px;">
      This proposal outlines our recommended engagement, investment, and expected outcomes for your business. You can accept, decline, or request changes directly from the portal.
    </p>

    <div style="text-align:center;margin:0 0 16px;">
      ${ctaButton('https://marqcortex.app/client', 'Review Proposal →')}
    </div>

    <p style="color:#4B5563;font-size:13px;text-align:center;margin:0;">Log in with the email address you used during your diagnostic assessment.</p>
  `);

  await sendEmail(submission.email, `📋 Your Proposal is Ready — ${submission.company}`, html);
}

// ============================================================================
// EMAIL 5 — TEAM: proposal viewed / accepted / rejected by client
// ============================================================================

export async function sendTeamProposalViewedEmail(submission: {
  company: string;
  contact: string;
}, teamEmail = 'admin@marqcortex.com') {
  const html = baseTemplate(`
    <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 8px;">👁 Proposal Viewed</h1>
    <p style="color:#9CA3AF;font-size:15px;margin:0 0 28px;">
      <strong style="color:#fff;">${submission.contact}</strong> from <strong style="color:#fff;">${submission.company}</strong> just opened their proposal. They're reviewing it now — a great time to follow up!
    </p>

    <div style="background:linear-gradient(135deg,#06D7F618,#3B82F618);border:1px solid #06D7F630;border-radius:14px;padding:20px 24px;margin:0 0 28px;display:flex;align-items:center;gap:16px;">
      <div style="font-size:28px;">🕐</div>
      <div>
        <div style="color:#06D7F6;font-size:15px;font-weight:600;">Active Right Now</div>
        <div style="color:#9CA3AF;font-size:13px;margin-top:4px;">${submission.company} opened the proposal — response expected within 24–48 hours</div>
      </div>
    </div>

    <div style="text-align:center;">
      ${ctaButton('https://marqcortex.app/dashboard', 'View in CORTEX Dashboard →')}
    </div>
  `);

  await sendEmail(teamEmail, `👁 Proposal Viewed — ${submission.company}`, html);
}

export async function sendProposalRespondedEmail(submission: {
  company: string;
  contact: string;
  email: string;
}, response: 'accepted' | 'rejected', teamEmail = 'admin@marqcortex.com') {
  const accepted = response === 'accepted';
  const accent   = accepted ? '#10B981' : '#FD4438';
  const emoji    = accepted ? '🎉' : '📭';
  const headline = accepted
    ? `${emoji} Proposal Accepted — ${submission.company}`
    : `${emoji} Proposal Declined — ${submission.company}`;
  const bodyText = accepted
    ? `<strong style="color:#fff;">${submission.contact}</strong> from <strong style="color:#fff;">${submission.company}</strong> has <strong style="color:#10B981;">accepted the proposal</strong>. Time to kick things off — reach out to schedule the onboarding call.`
    : `<strong style="color:#fff;">${submission.contact}</strong> from <strong style="color:#fff;">${submission.company}</strong> has <strong style="color:#FD4438;">declined the proposal</strong>. Consider following up to understand their objections and discuss alternatives.`;

  const html = baseTemplate(`
    <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 16px;">${headline}</h1>

    <div style="background:${accent}12;border:1px solid ${accent}30;border-radius:14px;padding:20px 24px;margin:0 0 24px;">
      <p style="color:#D1D5DB;font-size:15px;line-height:1.6;margin:0;">${bodyText}</p>
    </div>

    ${accepted ? `
    <h3 style="color:#fff;font-size:15px;font-weight:600;margin:0 0 12px;">Recommended next steps:</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      ${['Send a welcome email to the client', 'Schedule the kick-off call within 48 hours', 'Set up a project workspace and share access', 'Update the submission status to Approved in CORTEX'].map((step, i) => `
        <tr>
          <td style="padding:6px 0;">
            <span style="color:#10B981;margin-right:10px;font-weight:700;">${i + 1}.</span>
            <span style="color:#D1D5DB;font-size:14px;">${step}</span>
          </td>
        </tr>
      `).join('')}
    </table>
    ` : ''}

    <div style="text-align:center;">
      ${ctaButton('https://marqcortex.app/dashboard', 'Open in CORTEX Dashboard →')}
    </div>
  `);

  await sendEmail(teamEmail, headline, html);
}

// ============================================================================
// EMAIL 6 — TEAM: new message from client
// ============================================================================

export async function sendNewClientMessageEmail(submission: {
  company: string;
  contact: string;
}, messageContent: string, teamEmail = 'admin@marqcortex.com') {
  const preview = messageContent.length > 120 ? messageContent.slice(0, 120) + '…' : messageContent;

  const html = baseTemplate(`
    <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 8px;">💬 New Message from ${submission.company}</h1>
    <p style="color:#9CA3AF;font-size:15px;margin:0 0 24px;">
      <strong style="color:#fff;">${submission.contact}</strong> has sent you a message via the client portal.
    </p>

    <div style="background:#1A1A26;border:1px solid rgba(255,255,255,0.08);border-left:3px solid #8B5CF6;border-radius:0 14px 14px 0;padding:20px 24px;margin:0 0 28px;">
      <div style="color:#8B5CF6;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${submission.contact} wrote:</div>
      <p style="color:#E5E7EB;font-size:15px;line-height:1.7;margin:0;font-style:italic;">"${preview}"</p>
    </div>

    <div style="text-align:center;">
      ${ctaButton('https://marqcortex.app/dashboard', 'Reply in CORTEX Dashboard →')}
    </div>

    <p style="color:#4B5563;font-size:13px;text-align:center;margin:16px 0 0;">Respond promptly to keep the engagement strong.</p>
  `);

  await sendEmail(teamEmail, `💬 New Message — ${submission.company}`, html);
}

// ============================================================================
// EMAIL 7 — CLIENT: team replied to their message
// ============================================================================

export async function sendTeamReplyEmail(submission: {
  company: string;
  contact: string;
  email: string;
}, replyContent: string, authorName: string) {
  const firstName  = submission.contact.split(' ')[0];
  const preview    = replyContent.length > 120 ? replyContent.slice(0, 120) + '…' : replyContent;

  const html = baseTemplate(`
    <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 8px;">💬 New Reply from MARQ Cortex</h1>
    <p style="color:#9CA3AF;font-size:15px;margin:0 0 24px;">
      Hi ${firstName}, <strong style="color:#fff;">${authorName}</strong> from the MARQ Cortex team has replied to your message.
    </p>

    <div style="background:#1A1A26;border:1px solid rgba(255,255,255,0.08);border-left:3px solid #3B82F6;border-radius:0 14px 14px 0;padding:20px 24px;margin:0 0 28px;">
      <div style="color:#3B82F6;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${authorName} wrote:</div>
      <p style="color:#E5E7EB;font-size:15px;line-height:1.7;margin:0;font-style:italic;">"${preview}"</p>
    </div>

    <div style="text-align:center;">
      ${ctaButton('https://marqcortex.app/client', 'View Full Conversation →')}
    </div>

    <p style="color:#4B5563;font-size:13px;text-align:center;margin:16px 0 0;">Log in with the email address you used during your diagnostic assessment.</p>
  `);

  await sendEmail(submission.email, `💬 New Reply from MARQ Cortex — ${submission.company}`, html);
}

// ============================================================================
// EMAIL 8 — TEAM: weekly digest
// ============================================================================

export async function sendWeeklyDigestEmail(stats: {
  totalSubmissions: number;
  newThisWeek: number;
  completed: number;
  approved: number;
  avgQuality: number;
  proposalsSent: number;
  proposalsAccepted: number;
  topIndustry: string;
}, teamEmail = 'admin@marqcortex.com') {
  const weekLabel = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = baseTemplate(`
    <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0 0 4px;">📊 Weekly Performance Summary</h1>
    <p style="color:#9CA3AF;font-size:14px;margin:0 0 32px;">Week ending ${weekLabel} · CORTEX Intelligence Platform</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr>
        ${statChip('New This Week', String(stats.newThisWeek), '#8B5CF6')}
        ${statChip('Total Pipeline', String(stats.totalSubmissions), '#3B82F6')}
        ${statChip('Completed', String(stats.completed), '#06D7F6')}
        ${statChip('Converted', String(stats.approved), '#10B981')}
      </tr>
    </table>

    <div style="background:#1A1A26;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:24px;margin:0 0 24px;">
      <h3 style="color:#fff;font-size:15px;font-weight:600;margin:0 0 16px;">Proposal Performance</h3>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${statChip('Sent', String(stats.proposalsSent), '#FB923C')}
          ${statChip('Accepted', String(stats.proposalsAccepted), '#10B981')}
          ${statChip('Accept Rate', stats.proposalsSent > 0 ? `${Math.round((stats.proposalsAccepted / stats.proposalsSent) * 100)}%` : 'N/A', '#8B5CF6')}
        </tr>
      </table>
    </div>

    <div style="background:#1A1A26;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:20px 24px;margin:0 0 28px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:4px 0;"><span style="color:#6B7280;font-size:13px;">Avg. Quality Score</span></td>
          <td align="right"><span style="color:#8B5CF6;font-size:15px;font-weight:700;">${stats.avgQuality}%</span></td>
        </tr>
        <tr>
          <td style="padding:4px 0;"><span style="color:#6B7280;font-size:13px;">Top Industry</span></td>
          <td align="right"><span style="color:#fff;font-size:13px;font-weight:600;">${stats.topIndustry}</span></td>
        </tr>
      </table>
    </div>

    <div style="text-align:center;">
      ${ctaButton('https://marqcortex.app/dashboard', 'Open Full Analytics →')}
    </div>
  `);

  await sendEmail(teamEmail, `📊 Weekly Digest — ${stats.newThisWeek} new submissions this week`, html);
}

// ============================================================================
// EMAIL 9 — TEST email (verify Resend key is working)
// ============================================================================

export async function sendTestEmail(toEmail: string, senderName: string) {
  const html = baseTemplate(`
    <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 8px;">✅ Email delivery is working!</h1>
    <p style="color:#9CA3AF;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Hi <strong style="color:#fff;">${senderName}</strong>, this is a test email confirming that your <strong style="color:#fff;">Resend API key</strong> is correctly configured and email delivery is operational.
    </p>

    <div style="background:linear-gradient(135deg,#10B98112,#06D7F612);border:1px solid #10B98130;border-radius:14px;padding:24px;margin:0 0 24px;text-align:center;">
      <div style="font-size:36px;margin-bottom:8px;">🚀</div>
      <div style="color:#10B981;font-size:16px;font-weight:700;">CORTEX Email Engine: Online</div>
      <div style="color:#9CA3AF;font-size:13px;margin-top:6px;">Sent at ${new Date().toUTCString()}</div>
    </div>

    <h3 style="color:#fff;font-size:14px;font-weight:600;margin:0 0 12px;">Active email triggers:</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      ${[
        'New submission → Team alert',
        'Status → In Review → Client confirmation',
        'Status → Completed → Client report ready',
        'Proposal sent → Client notification',
        'Proposal viewed/responded → Team alert',
        'Client message → Team alert',
        'Team reply → Client notification',
        'Weekly digest → Monday morning summary',
      ].map(item => `
        <tr>
          <td style="padding:5px 0;">
            <span style="color:#10B981;margin-right:10px;">✓</span>
            <span style="color:#D1D5DB;font-size:13px;">${item}</span>
          </td>
        </tr>
      `).join('')}
    </table>

    <p style="color:#4B5563;font-size:13px;text-align:center;margin:0;">All notification preferences respect your Settings → Notifications toggles.</p>
  `);

  await sendEmail(toEmail, '✅ MARQ Cortex Email Delivery Test — Everything is working', html);
}

// ============================================================================
// EMAIL 10 — GENERIC NURTURE: send any queued nurture email via Resend
// ============================================================================

export async function sendNurtureEmail(email: {
  contactEmail: string;
  contactName: string;
  companyName: string;
  subject: string;
  previewText: string;
  templateId: string;
  readinessScore?: number;
  industry?: string;
  bottleneckTheme?: string;
}) {
  const firstName = email.contactName.split(' ')[0];

  // Build template-specific body block
  let bodyBlock = '';
  switch (email.templateId) {
    case 'diagnostic_received':
      bodyBlock = `
        <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0 0 8px;">We've received your diagnostic, ${firstName}.</h1>
        <p style="color:#9CA3AF;font-size:15px;line-height:1.6;margin:0 0 28px;">
          Great news — your operational assessment for <strong style="color:#fff;">${email.companyName}</strong> is now being reviewed by our team of analysts. We'll work through your responses and build a personalised readiness report.
        </p>
        <div style="background:linear-gradient(135deg,#FB923C18,#8B5CF618);border:1px solid #FB923C30;border-radius:14px;padding:24px;margin:0 0 28px;text-align:center;">
          <div style="font-size:32px;margin-bottom:8px;">🔍</div>
          <div style="color:#FB923C;font-size:16px;font-weight:700;">Currently Under Review</div>
          <div style="color:#9CA3AF;font-size:14px;margin-top:6px;">Our analysts are studying your responses and building insights</div>
        </div>
        <p style="color:#6B7280;font-size:13px;text-align:center;margin:0;">Typical turnaround: 4–6 hours during business hours.</p>`;
      break;

    case 'score_summary':
      bodyBlock = `
        <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0 0 8px;">Your AI Readiness Score, ${firstName}</h1>
        <p style="color:#9CA3AF;font-size:15px;line-height:1.6;margin:0 0 28px;">
          We've completed the initial scoring for <strong style="color:#fff;">${email.companyName}</strong>.
        </p>
        <div style="background:linear-gradient(135deg,#8B5CF618,#3B82F618);border:1px solid #8B5CF630;border-radius:14px;padding:28px;margin:0 0 28px;text-align:center;">
          <div style="color:#8B5CF6;font-size:48px;font-weight:800;">${email.readinessScore ?? '—'}</div>
          <div style="color:#9CA3AF;font-size:14px;margin-top:4px;">out of 100</div>
        </div>
        <p style="color:#9CA3AF;font-size:14px;line-height:1.6;margin:0 0 28px;">
          ${email.previewText}
        </p>
        <div style="text-align:center;">${ctaButton('https://marqcortex.app/client', 'View Full Breakdown →')}</div>`;
      break;

    case 'report_ready':
      bodyBlock = `
        <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0 0 8px;">Your report is ready, ${firstName}! 🎉</h1>
        <p style="color:#9CA3AF;font-size:15px;line-height:1.6;margin:0 0 28px;">
          Your <strong style="color:#fff;">${email.companyName}</strong> Operational Readiness Report has been completed. Log in to view your full analysis, recommendations, and ROI projections.
        </p>
        <div style="background:linear-gradient(135deg,#06D7F618,#3B82F618);border:1px solid #06D7F630;border-radius:14px;padding:24px;margin:0 0 28px;text-align:center;">
          <div style="font-size:36px;margin-bottom:8px;">📊</div>
          <div style="color:#06D7F6;font-size:18px;font-weight:700;">Report Ready to View</div>
        </div>
        <div style="text-align:center;">${ctaButton('https://marqcortex.app/client', 'View My Full Report →')}</div>`;
      break;

    case 'meeting_nudge':
      bodyBlock = `
        <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0 0 8px;">Let's discuss your opportunities, ${firstName}</h1>
        <p style="color:#9CA3AF;font-size:15px;line-height:1.6;margin:0 0 28px;">
          I reviewed your assessment for <strong style="color:#fff;">${email.companyName}</strong> and spotted some quick wins${email.bottleneckTheme ? ` around <strong style="color:#FB923C;">${email.bottleneckTheme}</strong>` : ''}. Can we spend 30 minutes walking through them?
        </p>
        <div style="text-align:center;margin:0 0 24px;">${ctaButton('https://marqcortex.app/book', 'Schedule a 30-Min Call →')}</div>
        <p style="color:#6B7280;font-size:13px;text-align:center;margin:0;">No pressure — just a conversation about what's possible.</p>`;
      break;

    case 'followup_reminder':
      bodyBlock = `
        <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0 0 8px;">Still thinking it over, ${firstName}?</h1>
        <p style="color:#9CA3AF;font-size:15px;line-height:1.6;margin:0 0 28px;">
          It's been a few days since your assessment for <strong style="color:#fff;">${email.companyName}</strong>. The insights we found don't expire, but the competitive window does.
        </p>
        <div style="background:linear-gradient(135deg,#FD443818,#FB923C18);border:1px solid #FD443830;border-radius:14px;padding:24px;margin:0 0 28px;">
          <p style="color:#FB923C;font-weight:700;margin:0 0 8px;">Your readiness score: ${email.readinessScore ?? '—'}/100</p>
          <p style="color:#9CA3AF;font-size:14px;margin:0;">Your personalised report and recommendations are still waiting for you.</p>
        </div>
        <div style="text-align:center;">${ctaButton('https://marqcortex.app/client', 'View My Report →')}</div>`;
      break;

    case 'proposal_delivered':
      bodyBlock = `
        <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0 0 8px;">Your custom proposal is ready, ${firstName}! 📋</h1>
        <p style="color:#9CA3AF;font-size:15px;line-height:1.6;margin:0 0 28px;">
          Based on our readiness call, we've prepared a tailored proposal for <strong style="color:#fff;">${email.companyName}</strong> with phased implementation and clear ROI projections.
        </p>
        <div style="text-align:center;margin:0 0 24px;">${ctaButton('https://marqcortex.app/client', 'Review Proposal →')}</div>
        <p style="color:#6B7280;font-size:13px;text-align:center;margin:0;">Log in with the email address you used during your diagnostic.</p>`;
      break;

    default:
      // Generic fallback
      bodyBlock = `
        <h1 style="color:#fff;font-size:24px;font-weight:700;margin:0 0 8px;">Hi ${firstName},</h1>
        <p style="color:#9CA3AF;font-size:15px;line-height:1.6;margin:0 0 28px;">${email.previewText}</p>
        <div style="text-align:center;">${ctaButton('https://marqcortex.app/client', 'View Your Portal →')}</div>`;
      break;
  }

  const html = baseTemplate(bodyBlock);
  await sendEmail(email.contactEmail, email.subject, html);
}