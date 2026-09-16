/**
 * A DESTINATION THE PRODUCT HAS STOPPED OFFERING.
 *
 * Hiding something from the sidebar does not stop a URL. A bookmark, a browser
 * history entry, a link in a chat message and a hand-typed `?page=` all still
 * arrive — and CP-1's navigation rule says they must arrive HERE rather than
 * being bounced to the Dashboard, because a URL that silently means something
 * else is the defect that sprint fixed.
 *
 * So the destination still resolves, and this is what it says when it does:
 * what the surface is for, what is actually missing, and where to go instead.
 * It reads its content from `capabilityStatus.ts`, which is the same source
 * the sidebar reads to decide not to offer it — so the explanation cannot
 * drift from the decision.
 *
 * This is not an error state. Nothing has failed; the product has been honest
 * about something it has not finished.
 */

import { Compass } from 'lucide-react';
import {
  CAPABILITY,
  CAPABILITY_LABEL,
  type CapabilityStatus,
} from '@/app/core/capabilityStatus';
import type { DestinationId } from '@/app/core/navigationModel';

const TONE: Record<CapabilityStatus, string> = {
  LIVE: '',
  PARTIAL: '',
  BLOCKED: '',
  EMPTY: 'This surface is built and correct. What it needs is something to show.',
  'DEMO-ONLY': 'This surface is not connected to your workspace yet.',
  UNREACHABLE: 'This surface cannot currently be reached.',
};

export function NotOfferedYet({
  destination,
  label,
  onNavigate,
}: {
  destination: DestinationId;
  label: string;
  /** Where the operator can usefully go instead. */
  onNavigate?: (page: string) => void;
}) {
  const capability = CAPABILITY[destination];

  return (
    <div className="p-6">
      <div
        data-testid="destination-not-offered"
        data-capability-status={capability.status}
        role="status"
        className="mx-auto max-w-2xl rounded-cortex-lg border border-cortex-default bg-white/[0.02] px-8 py-12 text-center"
      >
        <Compass aria-hidden="true" className="mx-auto size-7 text-gray-600" />

        <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-gray-600">
          {CAPABILITY_LABEL[capability.status]}
        </p>
        <h2 className="mt-2 text-lg font-bold text-white">{label}</h2>

        <p className="mx-auto mt-3 max-w-lg text-xs leading-relaxed text-gray-500">
          {TONE[capability.status]}
        </p>

        {capability.needs && (
          <div className="mx-auto mt-6 max-w-lg rounded-cortex-md border border-white/5 bg-white/[0.02] px-5 py-4 text-left">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-600">
              What it needs
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{capability.needs}</p>
          </div>
        )}

        <p className="mx-auto mt-6 max-w-lg text-[11px] leading-relaxed text-gray-600">
          It is not in the sidebar because a navigation entry is a promise, and
          this one cannot be kept yet. Nothing has been deleted — the work is
          still here, and the entry returns when it can do what its name says.
        </p>

        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-xs font-medium text-white/80 hover:bg-white/5"
          >
            Back to the Dashboard
          </button>
        )}
      </div>
    </div>
  );
}
