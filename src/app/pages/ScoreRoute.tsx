import { useNavigate, Navigate } from 'react-router';
import ScorePage from '@/app/components/ScorePage';
import { useApp } from '@/app/contexts/AppContext';

export function ScoreRoute() {
  const navigate = useNavigate();
  const { scoreResult, contactInfo, lastIndustry, isSubmitting } = useApp();

  // If no score result, redirect to landing (direct URL access without data)
  if (!scoreResult) {
    return <Navigate to="/" replace />;
  }

  return (
    <ScorePage
      scoreResult={scoreResult}
      contactInfo={contactInfo ? {
        name: contactInfo.name,
        email: contactInfo.email,
        phone: contactInfo.phone,
        website: contactInfo.website,
      } : {
        name: 'Valued Customer',
        email: 'customer@example.com',
      }}
      industry={lastIndustry}
      isSubmitting={isSubmitting}
      onBackToHome={() => navigate('/')}
    />
  );
}
