/**
 * The behaviour every modal overlay needs, separated from the chrome it wears.
 *
 * `Modal` gives an overlay a header, a body and a footer as well as these
 * behaviours, and most dialogs want that. Some do not: a celebratory popup, a
 * milestone card, a booking sheet each have their own shape and would have to
 * fight the chrome to keep it. Before this hook existed, those overlays simply
 * went without the behaviour — which is how the console ended up with eighteen
 * overlays and not one of them announcing itself, trapping focus, or closing on
 * Escape.
 *
 * So the behaviour is the reusable part and the chrome is optional. `Modal`
 * calls this; a bespoke overlay calls it too and keeps its own markup.
 *
 * WHAT IT DOES
 *   1. Moves focus into the panel on open, and back to the trigger on close.
 *   2. Traps Tab in both directions.
 *   3. Closes on Escape.
 *   4. Locks the background scroll, restoring whatever was there before.
 *
 * WHAT THE CALLER STILL OWES
 *   `role="dialog"`, `aria-modal="true"` and a name — an `aria-label`, or an
 *   `aria-labelledby` pointing at the heading. The hook cannot add those: they
 *   belong on the caller's own element. `dialogProps` returns exactly those
 *   attributes plus the ref, so spreading it is the whole contract.
 */
import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogBehaviorOptions {
  open: boolean;
  onClose: () => void;
  /** An accessible name, when the dialog has no visible heading to point at. */
  label?: string;
  /** The id of the heading that names the dialog. */
  labelledBy?: string;
  /** The id of the text that describes it. */
  describedBy?: string;
}

export function useDialogBehavior({
  open, onClose, label, labelledBy, describedBy,
}: DialogBehaviorOptions) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  // Move focus in, and put it back on close. Restoring matters as much as
  // moving: without it, dismissing drops the keyboard user at the top of the
  // document rather than where they were.
  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();
    return () => { restoreFocusTo.current?.focus?.(); };
  }, [open]);

  // Escape closes; Tab cycles within the dialog rather than walking out into
  // the content the overlay is covering.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter(el => el.offsetParent !== null || el === document.activeElement);

      if (focusable.length === 0) {
        // Nothing to move to — hold focus on the panel rather than letting it
        // escape to the page behind.
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  // Restore exactly what was there — not a hard-coded empty string, which would
  // clobber a page that had set its own value.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  return {
    panelRef,
    /** Spread onto the dialog's own element. */
    dialogProps: {
      ref: panelRef,
      role: 'dialog' as const,
      'aria-modal': true as const,
      'aria-label': label,
      'aria-labelledby': labelledBy,
      'aria-describedby': describedBy,
      tabIndex: -1,
    },
  };
}
