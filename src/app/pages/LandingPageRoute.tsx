import { useState } from 'react';
import { useNavigate } from 'react-router';
import LandingPage from '@/app/components/LandingPage';
import { ExitIntentPopup, useExitIntent } from '@/app/components/ExitIntentPopup';
import { useApp } from '@/app/contexts/AppContext';
import type { ContactInfo } from '@/app/components/LeadMagnetCapture';

export function LandingPageRoute() {
  const navigate = useNavigate();
  const { setContactInfo } = useApp();
  const [showExitPopup, setShowExitPopup] = useState(false);

  useExitIntent(() => {
    if (!showExitPopup) setShowExitPopup(true);
  });

  return (
    <span className="contents">
      <LandingPage
        onStartDiagnostic={() => navigate('/get-started')}
        onTeamLogin={() => navigate('/team/login')}
        onClientLogin={() => navigate('/client/login')}
      />
      {showExitPopup && (
        <ExitIntentPopup
          onCapture={(email) => {
            const quickLead: ContactInfo = {
              name: email.split('@')[0],
              email,
              phone: '',
              website: '',
              capturedAt: new Date().toISOString(),
            };
            setContactInfo(quickLead);
            setShowExitPopup(false);
            navigate('/diagnostic');
          }}
          onClose={() => setShowExitPopup(false)}
        />
      )}
    </span>
  );
}
