import { useNavigate } from 'react-router';
import DiagnosticForm, { type DiagnosticSubmissionData } from '@/app/components/DiagnosticForm';
import { useApp } from '@/app/contexts/AppContext';
import { computeInstantScore } from '@/app/utils/instantScoring';
import { enqueueNurtureSequence } from '@/app/utils/emailNurtureQueue';
import { createSubmission, enqueueEmails as enqueueEmailsApi } from '@/app/services/dataService';
import { FEATURES } from '@/config/features';

export function DiagnosticRoute() {
  const navigate = useNavigate();
  const {
    contactInfo,
    setScoreResult,
    setLastIndustry,
    setIsSubmitting,
  } = useApp();

  const handleComplete = async (data: DiagnosticSubmissionData) => {
    setIsSubmitting(true);

    // Compute instant score client-side
    const score = computeInstantScore(data.answers, data.industry);
    setScoreResult(score);
    setLastIndustry(data.industry);

    // Queue nurture email sequence
    const email = data.email || contactInfo?.email || '';
    const name = data.contactName || contactInfo?.name || '';
    const company = data.website || contactInfo?.website || name + "'s Company";
    const submissionId = `sub_${Date.now()}`;
    const nurtureEntries = enqueueNurtureSequence({
      submissionId,
      contactName: name,
      contactEmail: email,
      companyName: company,
      industry: data.industry,
      readinessScore: score.readinessScore,
      bottleneckTheme: score.bottleneckTheme.label,
    });

    // ── Persist to Supabase FIRST ────────────────────────────────────────────
    // Dispatch the POST /submissions request *before* navigating (and before
    // the score page renders anything that could throw, e.g. client-side PDF
    // export of a themed report). This guarantees database persistence can
    // never be blocked by a downstream failure — the request is already in
    // flight. We await its result afterwards only to settle `isSubmitting`;
    // navigation is never gated on it.
    const persistence: Promise<void> = FEATURES.BACKEND_INTEGRATION
      ? (async () => {
          try {
            const result = await createSubmission({
              contactName: data.contactName || contactInfo?.name || '',
              email: data.email || contactInfo?.email || '',
              phone: data.phone || contactInfo?.phone || '',
              website: data.website || contactInfo?.website || '',
              industry: data.industry,
              answers: data.answers,
              // ── F-001: pipe client-computed score to server so both sides show the same number
              readinessScore: score.readinessScore,
            });

            // Also push email queue to server (non-blocking)
            try {
              await enqueueEmailsApi({
                submissionId: result.submissionId || submissionId,
                contactName: name,
                contactEmail: email,
                companyName: company,
                industry: data.industry,
                readinessScore: score.readinessScore,
                bottleneckTheme: score.bottleneckTheme.label,
                emails: nurtureEntries.map(e => ({
                  id: e.id,
                  templateId: e.templateId,
                  subject: e.subject,
                  previewText: e.previewText,
                  status: e.status,
                  scheduledAt: e.scheduledAt,
                  sentAt: e.sentAt,
                  createdAt: e.createdAt,
                  readinessScore: e.readinessScore,
                  bottleneckTheme: e.bottleneckTheme,
                })),
              });
            } catch (emailErr) {
              console.error('Email queue sync failed (non-blocking):', emailErr);
            }
          } catch (err) {
            console.error('Failed to save submission:', err);
          }
        })()
      : Promise.resolve();

    // Navigate to score page immediately so user sees value. Intentionally NOT
    // awaited on persistence — the request above is already dispatched.
    navigate('/score');

    // Settle submitting state once persistence resolves (already non-blocking).
    await persistence;
    setIsSubmitting(false);
  };

  return (
    <DiagnosticForm
      onComplete={handleComplete}
      onBack={() => navigate('/')}
      initialData={contactInfo ? {
        contactName: contactInfo.name,
        email: contactInfo.email,
        phone: contactInfo.phone,
        website: contactInfo.website,
      } : undefined}
    />
  );
}