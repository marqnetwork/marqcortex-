/**
 * 🎁 LEAD MAGNET CAPTURE FLOW
 * 
 * This is the FIRST conversion point in your funnel.
 * 
 * FLOW:
 * 1. User clicks "Get Free Guide" on landing page
 * 2. Form appears: Name, Email, Phone, Website
 * 3. User submits → PDF download starts
 * 4. Show "Downloading..." message
 * 5. After 3 seconds → Auto-redirect to diagnostic questionnaire
 * 6. Contact info is stored and pre-filled in questionnaire
 * 
 * WHY THIS MATTERS:
 * - Captures contact info BEFORE they take diagnostic
 * - Even if they abandon questionnaire, you have their info
 * - PDF creates immediate value (reciprocity)
 * - Smooth transition to questionnaire keeps momentum
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, ArrowRight, CheckCircle2, Sparkles, Mail, Phone, Globe, User } from 'lucide-react';
// pdfExport (jsPDF) is intentionally NOT statically imported here.
// It is dynamically imported inside downloadPDF() so jsPDF bytes are only
// fetched when the user actually triggers a PDF download — not on first parse.
import { saveLead } from '@/app/services/dataService';

interface LeadMagnetCaptureProps {
  onComplete: (contactInfo: ContactInfo) => void;
}

export interface ContactInfo {
  name: string;
  email: string;
  phone: string;
  website: string;
  capturedAt: string;
}

export function LeadMagnetCapture({ onComplete }: LeadMagnetCaptureProps) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    website: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError('');

    // Validate
    if (!formData.name || !formData.email) {
      setFormError('Please fill in your name and email.');
      setIsSubmitting(false);
      return;
    }

    // Simulate API call to save contact
    await saveContactInfo(formData);

    // Start PDF download
    downloadPDF();

    // Show downloading state
    setIsDownloading(true);

    // Countdown from 3 to 0
    let count = 3;
    const interval = setInterval(() => {
      count--;
      setCountdown(count);
      
      if (count === 0) {
        clearInterval(interval);
        // Redirect to questionnaire with pre-filled info
        const contactInfo: ContactInfo = {
          ...formData,
          capturedAt: new Date().toISOString()
        };
        onComplete(contactInfo);
      }
    }, 1000);
  };

  if (isDownloading) {
    return <DownloadingScreen countdown={countdown} name={formData.name} />;
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl w-full"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring' }}
            className="inline-flex items-center justify-center size-20 rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] mb-6"
          >
            <Sparkles className="size-10 text-white" />
          </motion.div>
          
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Get Your Free{' '}
            <span className="bg-gradient-to-r from-[#8B5CF6] via-[#3B82F6] to-[#06D7F6] text-transparent bg-clip-text">
              AI Readiness Guide
            </span>
          </h1>
          
          <p className="text-xl text-white/70 max-w-xl mx-auto">
            Discover the 5 critical steps every business must take before implementing AI automation
          </p>
        </div>

        {/* Value Props */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <ValueProp
            icon={<CheckCircle2 className="size-5 text-[#06D7F6]" />}
            text="Real-world examples"
          />
          <ValueProp
            icon={<CheckCircle2 className="size-5 text-[#06D7F6]" />}
            text="Implementation checklist"
          />
          <ValueProp
            icon={<CheckCircle2 className="size-5 text-[#06D7F6]" />}
            text="Cost-saving strategies"
          />
        </div>

        {/* Form */}
        <motion.form
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          onSubmit={handleSubmit}
          className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-8"
        >
          <div className="space-y-5">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Full Name *
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-white/40" />
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="John Smith"
                  className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-[#8B5CF6] transition-colors"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Email Address *
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-white/40" />
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="john@company.com"
                  className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-[#8B5CF6] transition-colors"
                />
              </div>
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Phone Number
              </label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-white/40" />
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+1 (555) 123-4567"
                  className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-[#8B5CF6] transition-colors"
                />
              </div>
            </div>

            {/* Website */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Company Website
              </label>
              <div className="relative">
                <Globe className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-white/40" />
                <input
                  type="url"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  placeholder="https://company.com"
                  className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-[#8B5CF6] transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Form Error */}
          {formError && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-3 bg-[#FD4438]/10 border border-[#FD4438]/30 rounded-xl"
            >
              <p className="text-sm text-[#FD4438] text-center">{formError}</p>
            </motion.div>
          )}

          {/* Submit Button */}
          <motion.button
            type="submit"
            disabled={isSubmitting}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full mt-8 px-8 py-4 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] hover:from-[#7C3AED] hover:to-[#2563EB] text-white rounded-xl font-semibold text-lg flex items-center justify-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span className="contents">
                <div className="size-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing...
              </span>
            ) : (
              <span className="contents">
                <Download className="size-5" />
                Download Free Guide
                <ArrowRight className="size-5" />
              </span>
            )}
          </motion.button>

          {/* Privacy Note */}
          <p className="text-xs text-white/50 text-center mt-4">
            Your information is safe with us. We'll never share your details.
          </p>
        </motion.form>

        {/* Social Proof */}
        <div className="mt-8 text-center">
          <p className="text-sm text-white/60 mb-3">
            Trusted by businesses improving their operations
          </p>
          <div className="flex items-center justify-center gap-6 flex-wrap">
            <StatBadge label="500+" sublabel="Downloads" />
            <StatBadge label="4.9/5" sublabel="Rating" />
            <StatBadge label="15 min" sublabel="Average read" />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ============================================================================
// DOWNLOADING SCREEN
// ============================================================================

function DownloadingScreen({ countdown, name }: { countdown: number; name: string }) {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-2xl w-full text-center"
      >
        {/* Success Icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', delay: 0.2 }}
          className="inline-flex items-center justify-center size-24 rounded-full bg-gradient-to-br from-[#06D7F6] to-[#3B82F6] mb-6"
        >
          <CheckCircle2 className="size-12 text-white" />
        </motion.div>

        <h2 className="text-4xl font-bold mb-4">
          Thanks, {name.split(' ')[0]}! 🎉
        </h2>

        <p className="text-xl text-white/70 mb-8">
          Your guide is downloading now...
        </p>

        {/* Download Animation */}
        <div className="mb-8">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="inline-block"
          >
            <Download className="size-16 text-[#8B5CF6]" />
          </motion.div>
        </div>

        {/* Progress Bar */}
        <div className="max-w-md mx-auto mb-8">
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: '100%' }}
              transition={{ duration: 3 }}
              className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#06D7F6]"
            />
          </div>
        </div>

        {/* Redirect Message */}
        <div className="bg-gradient-to-br from-[#8B5CF6]/20 to-[#3B82F6]/20 border border-[#8B5CF6]/30 rounded-2xl p-6">
          <p className="text-lg mb-3">
            While you're here, let's personalize your experience...
          </p>
          <p className="text-white/60 mb-4">
            We'll ask you a few quick questions to give you custom recommendations
          </p>
          <div className="text-3xl font-bold text-[#06D7F6]">
            {countdown}
          </div>
          <p className="text-sm text-white/50 mt-2">
            Redirecting to personalized assessment...
          </p>
        </div>

        {/* Checklist Preview */}
        <div className="mt-8 text-left max-w-md mx-auto">
          <p className="text-sm text-white/60 mb-4">What you'll discover in the guide:</p>
          <div className="space-y-2">
            <CheckItem text="How to assess your current operations" />
            <CheckItem text="5 automation quick wins" />
            <CheckItem text="Common pitfalls to avoid" />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ============================================================================
// UTILITY COMPONENTS
// ============================================================================

function ValueProp({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-4 py-3">
      {icon}
      <span className="text-sm font-medium">{text}</span>
    </div>
  );
}

function StatBadge({ label, sublabel }: { label: string; sublabel: string }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-[#06D7F6]">{label}</div>
      <div className="text-xs text-white/50">{sublabel}</div>
    </div>
  );
}

function CheckItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <CheckCircle2 className="size-4 text-[#06D7F6] flex-shrink-0 mt-0.5" />
      <span className="text-sm text-white/70">{text}</span>
    </div>
  );
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

async function saveContactInfo(data: Omit<ContactInfo, 'capturedAt'>) {
  // Routes through dataService → api → server (or demo fallback)
  await saveLead({
    name: data.name,
    email: data.email,
    phone: data.phone,
    website: data.website,
  });
}

function downloadPDF() {
  // Generate a branded AI Readiness Guide PDF
  const guideHTML = `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:700px;margin:0 auto;padding:40px;">
      <div style="background:linear-gradient(135deg,#8B5CF6,#3B82F6);border-radius:16px;padding:60px 40px;text-align:center;color:white;margin-bottom:40px;">
        <div style="font-size:32px;font-weight:800;margin-bottom:8px;">MARQ Cortex</div>
        <div style="font-size:14px;opacity:0.8;margin-bottom:32px;">AI Operations Intelligence</div>
        <div style="font-size:28px;font-weight:700;line-height:1.3;">The AI Readiness Guide</div>
        <div style="font-size:16px;opacity:0.9;margin-top:12px;">5 Signals Your Business Is Ready for AI Operations</div>
      </div>
      <h2 style="font-size:22px;font-weight:700;color:#1a1a2e;margin-bottom:16px;">Why This Matters</h2>
      <p style="color:#555;line-height:1.7;margin-bottom:24px;">Most businesses between $1M and $50M in revenue are losing 15-30% of their operational capacity to manual workflows, disconnected tools, and repetitive admin. AI can fix this — but only if you know where to start.</p>
      <h2 style="font-size:22px;font-weight:700;color:#1a1a2e;margin-bottom:16px;">The 5 Signals</h2>
      ${[
        { num: 1, title: 'Your team spends more time on admin than execution', desc: 'If your best people are buried in spreadsheets, CRM updates, and manual reporting, AI can automate 60-80% of that work.' },
        { num: 2, title: 'Follow-ups and handoffs are falling through cracks', desc: 'Deals stall, tasks get missed, and clients wait too long. AI-powered workflow automation eliminates these gaps.' },
        { num: 3, title: 'You have data but no real-time insights', desc: 'Dashboards exist but nobody trusts them. AI can unify your data sources and surface actionable intelligence.' },
        { num: 4, title: 'Hiring is your default solution to scaling problems', desc: 'Adding headcount to fix process problems makes the chaos more expensive. AI infrastructure scales without linear cost.' },
        { num: 5, title: 'Your tools don\\\'t talk to each other', desc: 'Slack, CRM, project management, billing — all disconnected. AI integration layers make your existing stack work as one system.' },
      ].map(s => `
        <div style="background:#f8f8fc;border:1px solid #e8e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
          <div style="display:flex;align-items:flex-start;gap:16px;">
            <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#8B5CF6,#3B82F6);color:white;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;flex-shrink:0;">${s.num}</div>
            <div>
              <div style="font-weight:700;color:#1a1a2e;margin-bottom:6px;">${s.title}</div>
              <div style="color:#666;font-size:14px;line-height:1.6;">${s.desc}</div>
            </div>
          </div>
        </div>
      `).join('')}
      <div style="background:linear-gradient(135deg,#0a0a0f,#1a1a2e);border-radius:16px;padding:40px;text-align:center;color:white;margin-top:40px;">
        <div style="font-size:20px;font-weight:700;margin-bottom:12px;">Ready to Find Out Where AI Fits?</div>
        <div style="font-size:14px;opacity:0.8;margin-bottom:4px;">Take the free AI Operations Diagnostic at marqcortex.com</div>
        <div style="font-size:12px;opacity:0.5;margin-top:20px;">&copy; 2026 MARQ Cortex. All rights reserved.</div>
      </div>
    </div>
  `;

  // Dynamic import — jsPDF is only fetched when the user actually requests
  // a download, keeping it out of the landing-page and lead-magnet bundles.
  import('@/app/utils/pdfExport').then(({ exportHTMLToPDF }) => {
    exportHTMLToPDF(guideHTML, {
      filename: 'MARQ-Cortex-AI-Readiness-Guide.pdf',
      orientation: 'portrait',
      format: 'a4',
      scale: 2,
    }).catch(err => {
      console.error('PDF guide generation failed:', err);
    });
  }).catch(err => {
    console.error('PDF module failed to load:', err);
  });
}