import { useNavigate } from 'react-router';
import { LeadMagnetCapture, type ContactInfo } from '@/app/components/LeadMagnetCapture';
import { useApp } from '@/app/contexts/AppContext';

export function LeadMagnetRoute() {
  const navigate = useNavigate();
  const { setContactInfo } = useApp();

  const handleComplete = (info: ContactInfo) => {
    setContactInfo(info);
    localStorage.setItem('lead_contact', JSON.stringify(info));
    navigate('/diagnostic');
  };

  return <LeadMagnetCapture onComplete={handleComplete} />;
}
