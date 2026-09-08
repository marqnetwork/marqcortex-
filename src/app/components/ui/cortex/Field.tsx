/**
 * FIELD — a label that is actually attached to its control.
 *
 * The console is full of this shape:
 *
 *     <label className="…">Display Name</label>
 *     <input type="text" value={name} … />
 *
 * which LOOKS labelled and is not. A `<label>` with no `htmlFor`, wrapping
 * nothing, is a styled paragraph: the input has no accessible name, a screen
 * reader announces "edit text, blank", and clicking the label does not focus
 * the control. Placeholders do not close the gap either — they are not names,
 * and they vanish the moment the user types.
 *
 * `Field` owns the association. It generates an id with `useId`, puts it on the
 * label's `htmlFor` and hands it back through the render prop, so the two
 * cannot come apart — there is no version of using this component that leaves
 * the control unnamed.
 *
 * Hint and error text are wired through `aria-describedby` for the same reason:
 * an error rendered next to a field is an error the user cannot hear.
 */
import { useId, type ReactNode } from 'react';

export interface FieldProps {
  label: string;
  /** Renders the control. The id MUST be spread onto it. */
  children: (props: { id: string; 'aria-describedby'?: string }) => ReactNode;
  /** Guidance shown under the control. */
  hint?: string;
  /** A validation message. Takes precedence over the hint when both are set. */
  error?: string;
  /** Marks the field required, in the accessibility tree as well as visually. */
  required?: boolean;
  className?: string;
}

export function Field({ label, children, hint, error, required, className = '' }: FieldProps) {
  const id = useId();
  const describedById = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block mb-2 text-cortex-primary font-semibold text-[length:var(--cortex-font-size-body)]"
      >
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="text-cortex-danger"> *</span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </label>

      {children({ id, 'aria-describedby': describedById })}

      {error ? (
        // `role="alert"` so a validation failure is announced when it appears,
        // rather than being red text the user never learns about.
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-cortex-danger text-[length:var(--cortex-font-size-caption)]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-cortex-faint text-[length:var(--cortex-font-size-caption)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
