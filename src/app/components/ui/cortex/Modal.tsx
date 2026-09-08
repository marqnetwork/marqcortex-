/**
 * MODAL — a dialog the browser and the screen reader both know is a dialog.
 *
 * WHAT THIS REPLACES
 *   The console and the funnel between them hand-rolled eighteen overlays —
 *   `fixed inset-0` plus a backdrop plus a panel — and NOT ONE of them declared
 *   `role="dialog"` or `aria-modal`. The consequences are the same every time:
 *
 *   * A screen reader is never told a dialog opened. The user hears the new
 *     content only if they happen to navigate into it.
 *   * The page behind stays in the tab order, so Tab walks straight out of the
 *     dialog and into the content the overlay is covering — where clicks land
 *     on the backdrop and nothing responds.
 *   * Focus is never moved in, so a keyboard user opening a dialog is left with
 *     their focus wherever it was, usually on a trigger now hidden behind the
 *     overlay.
 *   * Focus is never restored on close, so dismissing a dialog drops the user
 *     back at the top of the document.
 *   * The page behind scrolls under the overlay.
 *
 * WHAT IT DOES
 *   Declares the dialog, moves focus in and back out, traps Tab, closes on
 *   Escape, and locks the background scroll — the five things every one of
 *   those overlays needed and none of them had.
 *
 * WHAT IT IS NOT
 *   It is not a replacement for `components/ui/dialog.tsx`, the vendored Radix
 *   primitive, which does all of this properly and should be preferred in new
 *   code that is already using shadcn components. This exists for the console's
 *   own overlays, which are styled from the Cortex tokens and are not built on
 *   Radix — converting them all to Radix would be a much larger change than
 *   giving them the semantics they are missing.
 */
import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialogBehavior } from './useDialogBehavior';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Names the dialog. Rendered as its heading unless `hideTitle` is set. */
  title: string;
  /** A line under the title, and the dialog's description for assistive tech. */
  description?: string;
  children: ReactNode;
  /** Footer actions, pinned below the content. */
  footer?: ReactNode;
  /** For a dialog whose own content already carries the heading. */
  hideTitle?: boolean;
  /** Set false for a dialog that must be dismissed deliberately. */
  dismissOnBackdrop?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASS = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  hideTitle = false,
  dismissOnBackdrop = true,
  size = 'md',
  className = '',
}: ModalProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  // The four behaviours live in `useDialogBehavior`, so an overlay that cannot
  // wear this chrome can still have them. See that module for why.
  const { dialogProps } = useDialogBehavior({
    open,
    onClose,
    labelledBy: titleId,
    describedBy: description ? descriptionId : undefined,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* `aria-hidden` on the backdrop, not on the page: hiding the whole
          document would hide the dialog with it. `aria-modal` on the panel is
          what tells assistive technology to ignore the rest. */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={dismissOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      <div
        {...dialogProps}
        className={`relative w-full ${SIZE_CLASS[size]} rounded-cortex-lg bg-cortex-overlay border border-cortex-strong shadow-[0_20px_40px_-12px_rgba(0,0,0,0.6)] outline-none ${className}`}
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-cortex-subtle">
          <div className="min-w-0">
            {/* Always rendered, so the dialog always has a name. `hideTitle`
                only removes it from SIGHT — a nameless dialog is announced as
                "dialog" and nothing else. */}
            <h2
              id={titleId}
              className={hideTitle ? 'sr-only' : 'text-cortex-primary font-semibold text-[length:var(--cortex-font-size-heading)]'}
            >
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className={hideTitle ? 'sr-only' : 'mt-1 text-cortex-muted text-[length:var(--cortex-font-size-caption)]'}
              >
                {description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-cortex-sm text-cortex-muted hover:text-cortex-primary hover:bg-cortex-control transition-colors flex-shrink-0"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 p-5 border-t border-cortex-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
