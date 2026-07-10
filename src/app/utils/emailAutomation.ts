/**
 * 📧 EMAIL AUTOMATION SYSTEM
 * 
 * Handles all automated email communications in the funnel:
 * 
 * EMAIL SEQUENCE:
 * 1. Lead Magnet Confirmation (immediate)
 * 2. Diagnostic Submission Received (immediate)
 * 3. Report Ready Notification (1-24 hours)
 * 4. Meeting Invitation (2-3 days)
 * 5. Proposal Sent (after meeting)
 * 6. Follow-up Reminders (if no response)
 * 
 * FEATURES:
 * - Professional HTML templates
 * - Personalization (name, company, scores)
 * - Tracking (opens, clicks)
 * - Unsubscribe handling
 * - Integration ready (SendGrid, Mailgun, etc.)
 * - Routes through Supabase server → Resend when BACKEND_INTEGRATION is true
 */

import { FEATURES } from '@/config/features';
import { projectId, publicAnonKey } from '/utils/supabase/info';
import { log } from '@/app/utils/logger';

export interface EmailTemplate {
  id: string;
  subject: string;
  body: string;
  variables: string[];
}

export interface EmailPayload {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
  trackingEnabled?: boolean;
}

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

export const EMAIL_TEMPLATES = {
  
  // 1️⃣ LEAD MAGNET CONFIRMATION
  leadMagnetConfirmation: {
    id: 'lead-magnet-confirmation',
    subject: '📥 Your AI Readiness Guide is Here!',
    getContent: (data: { name: string; downloadUrl: string }) => ({
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #0A0A0F; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0A0A0F; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(59, 130, 246, 0.1)); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 40px;">
                  
                  <!-- Header -->
                  <tr>
                    <td align="center" style="padding-bottom: 30px;">
                      <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #8B5CF6, #3B82F6); border-radius: 12px; display: inline-block; line-height: 60px; text-align: center;">
                        <span style="font-size: 30px;">✨</span>
                      </div>
                    </td>
                  </tr>
                  
                  <!-- Title -->
                  <tr>
                    <td align="center" style="padding-bottom: 20px;">
                      <h1 style="color: white; font-size: 28px; margin: 0; font-weight: bold;">
                        Thanks, ${data.name}!
                      </h1>
                    </td>
                  </tr>
                  
                  <!-- Body -->
                  <tr>
                    <td style="color: rgba(255, 255, 255, 0.7); font-size: 16px; line-height: 1.6; padding-bottom: 30px;">
                      <p>Your <strong style="color: #06D7F6;">AI Readiness Guide</strong> should be downloading automatically.</p>
                      <p>If it didn't start, click the button below:</p>
                    </td>
                  </tr>
                  
                  <!-- CTA Button -->
                  <tr>
                    <td align="center" style="padding-bottom: 30px;">
                      <a href="${data.downloadUrl}" style="display: inline-block; background: linear-gradient(90deg, #8B5CF6, #3B82F6); color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                        Download Your Guide
                      </a>
                    </td>
                  </tr>
                  
                  <!-- Next Steps -->
                  <tr>
                    <td style="background: rgba(139, 92, 246, 0.2); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 12px; padding: 20px; margin-top: 20px;">
                      <p style="color: #8B5CF6; font-weight: bold; margin: 0 0 10px 0;">What's Next?</p>
                      <p style="color: rgba(255, 255, 255, 0.7); font-size: 14px; margin: 0;">
                        Take our 5-minute personalized assessment to get custom recommendations for your business.
                      </p>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td align="center" style="padding-top: 40px; border-top: 1px solid rgba(255, 255, 255, 0.1); margin-top: 40px;">
                      <p style="color: rgba(255, 255, 255, 0.5); font-size: 12px; margin: 0;">
                        Questions? Reply to this email or visit our <a href="#" style="color: #06D7F6; text-decoration: none;">help center</a>
                      </p>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `
Thanks, ${data.name}!

Your AI Readiness Guide should be downloading automatically.

If it didn't start, download it here: ${data.downloadUrl}

What's Next?
Take our 5-minute personalized assessment to get custom recommendations for your business.

Questions? Reply to this email.
      `
    })
  },

  // 2️⃣ DIAGNOSTIC SUBMISSION RECEIVED
  diagnosticReceived: {
    id: 'diagnostic-received',
    subject: '✅ We\'re Analyzing Your Responses...',
    getContent: (data: { name: string; companyName: string }) => ({
      html: `
        <!DOCTYPE html>
        <html>
        <body style="margin: 0; padding: 0; background-color: #0A0A0F; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0A0A0F; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(59, 130, 246, 0.1)); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 40px;">
                  
                  <!-- Icon -->
                  <tr>
                    <td align="center" style="padding-bottom: 30px;">
                      <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #06D7F6, #3B82F6); border-radius: 12px; display: inline-block; line-height: 60px; text-align: center;">
                        <span style="font-size: 30px;">🧠</span>
                      </div>
                    </td>
                  </tr>
                  
                  <tr>
                    <td align="center" style="padding-bottom: 20px;">
                      <h1 style="color: white; font-size: 28px; margin: 0; font-weight: bold;">
                        Thanks for Completing the Assessment!
                      </h1>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="color: rgba(255, 255, 255, 0.7); font-size: 16px; line-height: 1.6; padding-bottom: 30px;">
                      <p>Hi ${data.name},</p>
                      <p>We've received your responses for <strong style="color: #06D7F6;">${data.companyName}</strong> and our AI is analyzing them now.</p>
                      <p><strong>What happens next:</strong></p>
                      <ul style="padding-left: 20px;">
                        <li style="margin-bottom: 10px;">Our team will review your responses (usually within 24 hours)</li>
                        <li style="margin-bottom: 10px;">You'll receive a personalized readiness report</li>
                        <li style="margin-bottom: 10px;">We'll identify your biggest opportunities for improvement</li>
                      </ul>
                    </td>
                  </tr>
                  
                  <!-- Timeline -->
                  <tr>
                    <td style="background: rgba(6, 215, 246, 0.1); border: 1px solid rgba(6, 215, 246, 0.3); border-radius: 12px; padding: 20px;">
                      <p style="color: #06D7F6; font-weight: bold; margin: 0 0 10px 0;">⏱️ Expected Timeline</p>
                      <p style="color: rgba(255, 255, 255, 0.7); font-size: 14px; margin: 0;">
                        Most reports are ready within <strong>4-6 hours</strong> during business hours.
                      </p>
                    </td>
                  </tr>
                  
                  <tr>
                    <td align="center" style="padding-top: 40px;">
                      <p style="color: rgba(255, 255, 255, 0.6); font-size: 14px; margin: 0;">
                        We'll email you as soon as your report is ready.
                      </p>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `
Hi ${data.name},

We've received your responses for ${data.companyName} and our AI is analyzing them now.

What happens next:
- Our team will review your responses (usually within 24 hours)
- You'll receive a personalized readiness report
- We'll identify your biggest opportunities for improvement

Expected Timeline: Most reports are ready within 4-6 hours during business hours.

We'll email you as soon as your report is ready.
      `
    })
  },

  // 3️⃣ REPORT READY
  reportReady: {
    id: 'report-ready',
    subject: '🎯 Your Readiness Report is Ready',
    getContent: (data: { name: string; companyName: string; readinessScore: number; loginUrl: string; accessCode: string }) => ({
      html: `
        <!DOCTYPE html>
        <html>
        <body style="margin: 0; padding: 0; background-color: #0A0A0F; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0A0A0F; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(59, 130, 246, 0.1)); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 40px;">
                  
                  <tr>
                    <td align="center" style="padding-bottom: 30px;">
                      <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #8B5CF6, #3B82F6); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                        <span style="color: white; font-size: 42px; font-weight: bold;">${data.readinessScore}</span>
                      </div>
                    </td>
                  </tr>
                  
                  <tr>
                    <td align="center" style="padding-bottom: 20px;">
                      <h1 style="color: white; font-size: 28px; margin: 0; font-weight: bold;">
                        Your Report is Ready!
                      </h1>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="color: rgba(255, 255, 255, 0.7); font-size: 16px; line-height: 1.6; padding-bottom: 30px;">
                      <p>Hi ${data.name},</p>
                      <p>We've completed the analysis for <strong style="color: #06D7F6;">${data.companyName}</strong>.</p>
                      <p><strong>Your Readiness Score: ${data.readinessScore}/100</strong></p>
                      <p>Your personalized report includes:</p>
                      <ul style="padding-left: 20px;">
                        <li style="margin-bottom: 10px;">Operational bottlenecks we identified</li>
                        <li style="margin-bottom: 10px;">Automation opportunities ranked by ROI</li>
                        <li style="margin-bottom: 10px;">Recommended next steps</li>
                        <li style="margin-bottom: 10px;">Custom implementation roadmap</li>
                      </ul>
                    </td>
                  </tr>
                  
                  <tr>
                    <td align="center" style="padding-bottom: 30px;">
                      <a href="${data.loginUrl}" style="display: inline-block; background: linear-gradient(90deg, #8B5CF6, #3B82F6); color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                        View Your Report
                      </a>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="background: rgba(139, 92, 246, 0.2); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 12px; padding: 20px;">
                      <p style="color: #8B5CF6; font-weight: bold; margin: 0 0 10px 0;">🔐 Your Access Code</p>
                      <p style="color: white; font-size: 24px; font-weight: bold; letter-spacing: 2px; margin: 10px 0; font-family: monospace;">
                        ${data.accessCode}
                      </p>
                      <p style="color: rgba(255, 255, 255, 0.6); font-size: 12px; margin: 0;">
                        Use this code to access your report
                      </p>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `
Hi ${data.name},

Your report is ready!

We've completed the analysis for ${data.companyName}.

Your Readiness Score: ${data.readinessScore}/100

Your personalized report includes:
- Operational bottlenecks we identified
- Automation opportunities ranked by ROI
- Recommended next steps
- Custom implementation roadmap

View your report: ${data.loginUrl}

Your Access Code: ${data.accessCode}

Use this code to access your report.
      `
    })
  },

  // 4️⃣ MEETING INVITATION
  meetingInvitation: {
    id: 'meeting-invitation',
    subject: '📞 Let\'s Discuss Your Opportunities',
    getContent: (data: { name: string; companyName: string; schedulerUrl: string; topOpportunity: string }) => ({
      html: `
        <!DOCTYPE html>
        <html>
        <body style="margin: 0; padding: 0; background-color: #0A0A0F; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0A0A0F; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(59, 130, 246, 0.1)); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 40px;">
                  
                  <tr>
                    <td align="center" style="padding-bottom: 30px;">
                      <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #06D7F6, #3B82F6); border-radius: 12px; display: inline-block; line-height: 60px; text-align: center;">
                        <span style="font-size: 30px;">📞</span>
                      </div>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="color: rgba(255, 255, 255, 0.7); font-size: 16px; line-height: 1.6; padding-bottom: 30px;">
                      <p>Hi ${data.name},</p>
                      <p>I've reviewed your assessment for <strong style="color: #06D7F6;">${data.companyName}</strong>, and I spotted something interesting:</p>
                      <div style="background: rgba(6, 215, 246, 0.1); border-left: 4px solid #06D7F6; padding: 15px; margin: 20px 0; border-radius: 4px;">
                        <p style="color: white; font-weight: 600; margin: 0;">${data.topOpportunity}</p>
                      </div>
                      <p>I'd love to walk you through:</p>
                      <ul style="padding-left: 20px;">
                        <li style="margin-bottom: 10px;">The specific opportunities we identified</li>
                        <li style="margin-bottom: 10px;">Real examples from similar businesses</li>
                        <li style="margin-bottom: 10px;">Estimated ROI for your situation</li>
                        <li style="margin-bottom: 10px;">Next steps (if it makes sense)</li>
                      </ul>
                      <p>No pressure - just a conversation about what's possible.</p>
                    </td>
                  </tr>
                  
                  <tr>
                    <td align="center" style="padding-bottom: 30px;">
                      <a href="${data.schedulerUrl}" style="display: inline-block; background: linear-gradient(90deg, #8B5CF6, #3B82F6); color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                        Schedule a 30-Min Call
                      </a>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="color: rgba(255, 255, 255, 0.6); font-size: 14px; text-align: center;">
                      <p>Available this week? Pick a time that works for you.</p>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `
Hi ${data.name},

I've reviewed your assessment for ${data.companyName}, and I spotted something interesting:

"${data.topOpportunity}"

I'd love to walk you through:
- The specific opportunities we identified
- Real examples from similar businesses
- Estimated ROI for your situation
- Next steps (if it makes sense)

No pressure - just a conversation about what's possible.

Schedule a 30-min call: ${data.schedulerUrl}
      `
    })
  }
};

// ============================================================================
// EMAIL SERVICE
// ============================================================================

export class EmailService {
  
  /**
   * Send an email.
   * When BACKEND_INTEGRATION is true, routes through the Supabase edge function
   * server which uses Resend for delivery. Otherwise simulates success.
   */
  static async send(payload: EmailPayload): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      log.info('📧 Sending email:', { to: payload.to, subject: payload.subject });

      if (FEATURES.BACKEND_INTEGRATION) {
        // Route through server → Resend
        const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-324f4fbe`;
        const token = localStorage.getItem('team_access_token') || publicAnonKey;
        const res = await fetch(`${BASE}/email/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            to: payload.to,
            subject: payload.subject,
            html: payload.html,
            text: payload.text,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Server email send failed');
        log.info('📧 Server responded:', data);
        return { success: true, messageId: data.messageId || `srv_${Date.now()}` };
      }

      // Demo mode — simulate success
      await new Promise(resolve => setTimeout(resolve, 500));
      return { success: true, messageId: `demo_${Date.now()}` };
      
    } catch (error) {
      console.error('❌ Email send failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Send lead magnet confirmation
   */
  static async sendLeadMagnetConfirmation(to: string, name: string, downloadUrl: string) {
    const template = EMAIL_TEMPLATES.leadMagnetConfirmation;
    const content = template.getContent({ name, downloadUrl });
    
    return this.send({
      to,
      from: 'team@marqcortex.com',
      subject: template.subject,
      html: content.html,
      text: content.text,
      trackingEnabled: true
    });
  }
  
  /**
   * Send diagnostic received confirmation
   */
  static async sendDiagnosticReceived(to: string, name: string, companyName: string) {
    const template = EMAIL_TEMPLATES.diagnosticReceived;
    const content = template.getContent({ name, companyName });
    
    return this.send({
      to,
      from: 'team@marqcortex.com',
      subject: template.subject,
      html: content.html,
      text: content.text,
      trackingEnabled: true
    });
  }
  
  /**
   * Send report ready notification
   */
  static async sendReportReady(to: string, name: string, companyName: string, readinessScore: number, loginUrl: string, accessCode: string) {
    const template = EMAIL_TEMPLATES.reportReady;
    const content = template.getContent({ name, companyName, readinessScore, loginUrl, accessCode });
    
    return this.send({
      to,
      from: 'team@marqcortex.com',
      subject: template.subject,
      html: content.html,
      text: content.text,
      trackingEnabled: true
    });
  }
  
  /**
   * Send meeting invitation
   */
  static async sendMeetingInvitation(to: string, name: string, companyName: string, schedulerUrl: string, topOpportunity: string) {
    const template = EMAIL_TEMPLATES.meetingInvitation;
    const content = template.getContent({ name, companyName, schedulerUrl, topOpportunity });
    
    return this.send({
      to,
      from: 'team@marqcortex.com',
      subject: template.subject,
      html: content.html,
      text: content.text,
      trackingEnabled: true
    });
  }
}

// ============================================================================
// AUTOMATION TRIGGERS
// ============================================================================

export class EmailAutomation {
  
  /**
   * Trigger: When lead magnet is downloaded
   */
  static async onLeadMagnetDownload(contactInfo: { name: string; email: string }) {
    await EmailService.sendLeadMagnetConfirmation(
      contactInfo.email,
      contactInfo.name,
      'https://marqcortex.app/download/ai-readiness-guide'
    );
  }
  
  /**
   * Trigger: When diagnostic is submitted
   */
  static async onDiagnosticSubmit(submission: { email: string; contactName: string; companyName: string }) {
    await EmailService.sendDiagnosticReceived(
      submission.email,
      submission.contactName,
      submission.companyName
    );
  }
  
  /**
   * Trigger: When report is approved by team
   */
  static async onReportApproved(data: {
    email: string;
    name: string;
    companyName: string;
    readinessScore: number;
    submissionId: string;
  }) {
    const loginUrl = `https://marqcortex.app/client-portal?id=${data.submissionId}`;
    const accessCode = generateAccessCode();
    
    await EmailService.sendReportReady(
      data.email,
      data.name,
      data.companyName,
      data.readinessScore,
      loginUrl,
      accessCode
    );
  }
  
  /**
   * Trigger: 2-3 days after report sent, if no meeting booked
   */
  static async onFollowUpNeeded(data: {
    email: string;
    name: string;
    companyName: string;
    topOpportunity: string;
  }) {
    const schedulerUrl = 'https://marqcortex.app/book';
    
    await EmailService.sendMeetingInvitation(
      data.email,
      data.name,
      data.companyName,
      schedulerUrl,
      data.topOpportunity
    );
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}