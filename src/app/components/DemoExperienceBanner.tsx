/**
 * THE LABEL THAT MAKES A DEMO NOT A LIE.
 *
 * MARQ Cortex may still be run as a demo — Product Reality §9 asked for the
 * fabricated data to be isolated, not destroyed, and a product with nothing to
 * show cannot be shown. What it may not do is present invented companies and an
 * invented pipeline to somebody who has no way to know.
 *
 * So: where `FEATURES.DEMO_EXPERIENCE` is on, every authenticated surface
 * carries this. It is not dismissible, because a banner an operator can close
 * is a banner that is absent for the rest of the session, and the session is
 * exactly when the fabrication is on screen.
 *
 * It renders nothing at all in the shipped configuration.
 */

import { FlaskConical } from 'lucide-react';
import { FEATURES } from '@/config/features';

/** True when this build serves fabricated business data to signed-in surfaces. */
export function isDemoExperienceBuild(): boolean {
  return FEATURES.DEMO_EXPERIENCE && !FEATURES.BACKEND_INTEGRATION;
}

export function DemoExperienceBanner() {
  if (!isDemoExperienceBuild()) return null;

  return (
    <div
      data-testid="demo-experience-banner"
      role="status"
      className="flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center"
    >
      <FlaskConical aria-hidden="true" className="size-3.5 shrink-0 text-amber-400" />
      <p className="text-[11px] font-medium leading-tight text-amber-200">
        <span className="font-bold">Demo data.</span>{' '}
        Every company, person, figure and message on this screen is invented. This
        is not your organization&rsquo;s data and nothing here is saved.
      </p>
    </div>
  );
}
