/**
 * The Cortex surface primitives.
 *
 * Built entirely on `src/styles/tokens.css` and its TypeScript mirror, so a
 * change to a token reaches every screen that uses one of these rather than
 * every screen having to be found and edited.
 *
 * These sit ALONGSIDE `components/ui/*`, the vendored shadcn primitives, and do
 * not replace them: those are input controls (button, dialog, select) authored
 * against the light shadcn theme, while these are the console's dark surfaces,
 * states and status vocabulary. Reach for a shadcn primitive for a control, and
 * for one of these for the container and the state around it.
 */
export { Surface, type SurfaceProps, type SurfaceLevel, type SurfacePadding } from './Surface';
export { PageHeader, type PageHeaderProps } from './PageHeader';
export { Field, type FieldProps } from './Field';
export { Modal, type ModalProps } from './Modal';
export {
  StatusBadge, PriorityBadge, ToneBadge,
  type SubmissionStatus, type Priority, type Tone,
} from './StatusBadge';
export {
  LoadingState, type LoadingStateProps,
  EmptyState, type EmptyStateProps,
  ErrorState, type ErrorStateProps,
} from './FeedbackStates';
