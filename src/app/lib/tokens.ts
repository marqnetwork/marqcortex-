/**
 * ══════════════════════════════════════════════════════════════════════════════
 * MARQ CORTEX — Design Tokens (TypeScript mirror)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `src/styles/tokens.css` is the source of truth and the prose that explains
 * each token lives there. This file exists because most of the console cannot
 * read a CSS custom property:
 *
 *   * roughly five thousand call sites style through inline `style={{ }}`
 *     objects, where a `var(--…)` works for CSS properties but not for values
 *     the code then has to compute with;
 *   * every chart takes its colours as plain strings (`fill`, `stroke`,
 *     `contentStyle`), and Recharts resolves nothing;
 *   * a few components pass a colour into `boxShadow` or a gradient built by
 *     string concatenation.
 *
 * Those call sites had no name to use, which is why 5,311 hex literals
 * accumulated. Now they have one.
 *
 * THE TWO FILES CANNOT DRIFT. `tests/features/designTokens.test.ts` parses the
 * CSS and this module and fails if either declares a token the other does not,
 * or if any single value disagrees. Add a token to one and the test tells you
 * about the other.
 *
 * USAGE
 *   Prefer the Tailwind utilities (`bg-cortex-raised`, `border-cortex-default`,
 *   `text-cortex-muted`) wherever a class will do — `tokens.css` declares them.
 *   Reach for this module when the value has to be a string in JavaScript.
 */

/**
 * Every token, keyed by its CSS custom property name.
 *
 * Flat and literal on purpose: this shape is what makes the drift test a
 * one-line comparison against the parsed stylesheet rather than a mapping
 * somebody has to maintain.
 */
export const CORTEX_TOKENS = {
  '--cortex-surface-canvas': '#0A0A0F',
  '--cortex-surface-raised': 'rgba(0, 0, 0, 0.4)',
  '--cortex-surface-sunken': 'rgba(0, 0, 0, 0.3)',
  '--cortex-surface-overlay': '#0D0D18',
  '--cortex-surface-control': 'rgba(255, 255, 255, 0.05)',
  '--cortex-surface-control-hover': 'rgba(255, 255, 255, 0.1)',

  '--cortex-border-subtle': 'rgba(255, 255, 255, 0.05)',
  '--cortex-border-default': 'rgba(255, 255, 255, 0.1)',
  '--cortex-border-strong': 'rgba(255, 255, 255, 0.2)',

  '--cortex-text-primary': '#FFFFFF',
  '--cortex-text-secondary': 'rgba(255, 255, 255, 0.7)',
  '--cortex-text-muted': 'rgba(255, 255, 255, 0.5)',
  '--cortex-text-faint': 'rgba(255, 255, 255, 0.3)',

  '--cortex-accent': '#8B5CF6',
  '--cortex-accent-alt': '#3B82F6',
  '--cortex-accent-tertiary': '#EC4899',
  '--cortex-accent-light': '#A78BFA',
  '--cortex-accent-deep': '#7C3AED',
  '--cortex-accent-alt-light': '#60A5FA',
  '--cortex-accent-alt-deep': '#2563EB',

  '--cortex-status-success': '#10B981',
  '--cortex-status-warning': '#FB923C',
  '--cortex-status-danger': '#FD4438',
  '--cortex-status-info': '#06D7F6',
  '--cortex-status-caution': '#F59E0B',
  '--cortex-status-neutral': '#70707C',
  '--cortex-status-success-light': '#34D399',
  '--cortex-status-success-deep': '#059669',
  '--cortex-status-danger-light': '#FCA5A5',
  '--cortex-status-danger-deep': '#DC2626',
  '--cortex-status-caution-light': '#FBBF24',
  '--cortex-status-caution-deep': '#D97706',

  '--cortex-radius-sm': '8px',
  '--cortex-radius-md': '12px',
  '--cortex-radius-lg': '16px',
  '--cortex-radius-pill': '9999px',

  '--cortex-space-1': '4px',
  '--cortex-space-2': '8px',
  '--cortex-space-3': '12px',
  '--cortex-space-4': '16px',
  '--cortex-space-5': '24px',
  '--cortex-space-6': '32px',

  '--cortex-elevation-flat': 'none',
  '--cortex-elevation-overlay': '0 20px 40px -12px rgba(0, 0, 0, 0.6)',
  '--cortex-elevation-accent': '0 0 20px rgba(139, 92, 246, 0.25)',

  '--cortex-font-size-display': '24px',
  '--cortex-font-size-title': '20px',
  '--cortex-font-size-heading': '16px',
  '--cortex-font-size-body': '14px',
  '--cortex-font-size-label': '13px',
  '--cortex-font-size-caption': '12px',
  '--cortex-font-size-micro': '10px',

  '--cortex-font-weight-regular': '400',
  '--cortex-font-weight-medium': '500',
  '--cortex-font-weight-semibold': '600',
  '--cortex-font-weight-bold': '700',

  '--cortex-line-height-tight': '1.25',
  '--cortex-line-height-normal': '1.5',

  '--cortex-control-height-compact': '36px',
  '--cortex-control-height-comfortable': '44px',

  '--cortex-duration-fast': '150ms',
  '--cortex-duration-normal': '250ms',
} as const;

export type CortexTokenName = keyof typeof CORTEX_TOKENS;

/** Read a token by its CSS name. */
export function token<K extends CortexTokenName>(name: K): (typeof CORTEX_TOKENS)[K] {
  return CORTEX_TOKENS[name];
}

// ── Grouped accessors ─────────────────────────────────────────────────────────
// Derived from `CORTEX_TOKENS`, never restated, so a value exists once.

export const surface = {
  canvas: CORTEX_TOKENS['--cortex-surface-canvas'],
  raised: CORTEX_TOKENS['--cortex-surface-raised'],
  sunken: CORTEX_TOKENS['--cortex-surface-sunken'],
  overlay: CORTEX_TOKENS['--cortex-surface-overlay'],
  control: CORTEX_TOKENS['--cortex-surface-control'],
  controlHover: CORTEX_TOKENS['--cortex-surface-control-hover'],
} as const;

export const border = {
  subtle: CORTEX_TOKENS['--cortex-border-subtle'],
  default: CORTEX_TOKENS['--cortex-border-default'],
  strong: CORTEX_TOKENS['--cortex-border-strong'],
} as const;

export const text = {
  primary: CORTEX_TOKENS['--cortex-text-primary'],
  secondary: CORTEX_TOKENS['--cortex-text-secondary'],
  muted: CORTEX_TOKENS['--cortex-text-muted'],
  faint: CORTEX_TOKENS['--cortex-text-faint'],
} as const;

export const brand = {
  accent: CORTEX_TOKENS['--cortex-accent'],
  accentAlt: CORTEX_TOKENS['--cortex-accent-alt'],
  accentTertiary: CORTEX_TOKENS['--cortex-accent-tertiary'],
  /** Text on a tint of the accent. The base accent is 4.33:1 there — under AA. */
  accentLight: CORTEX_TOKENS['--cortex-accent-light'],
  /** The accent, pressed. */
  accentDeep: CORTEX_TOKENS['--cortex-accent-deep'],
  accentAltLight: CORTEX_TOKENS['--cortex-accent-alt-light'],
  accentAltDeep: CORTEX_TOKENS['--cortex-accent-alt-deep'],
} as const;

export const status = {
  success: CORTEX_TOKENS['--cortex-status-success'],
  warning: CORTEX_TOKENS['--cortex-status-warning'],
  danger: CORTEX_TOKENS['--cortex-status-danger'],
  info: CORTEX_TOKENS['--cortex-status-info'],
  caution: CORTEX_TOKENS['--cortex-status-caution'],
  neutral: CORTEX_TOKENS['--cortex-status-neutral'],

  successLight: CORTEX_TOKENS['--cortex-status-success-light'],
  successDeep: CORTEX_TOKENS['--cortex-status-success-deep'],
  dangerLight: CORTEX_TOKENS['--cortex-status-danger-light'],
  dangerDeep: CORTEX_TOKENS['--cortex-status-danger-deep'],
  cautionLight: CORTEX_TOKENS['--cortex-status-caution-light'],
  cautionDeep: CORTEX_TOKENS['--cortex-status-caution-deep'],
} as const;

export const radius = {
  sm: CORTEX_TOKENS['--cortex-radius-sm'],
  md: CORTEX_TOKENS['--cortex-radius-md'],
  lg: CORTEX_TOKENS['--cortex-radius-lg'],
  pill: CORTEX_TOKENS['--cortex-radius-pill'],
} as const;

export const space = {
  1: CORTEX_TOKENS['--cortex-space-1'],
  2: CORTEX_TOKENS['--cortex-space-2'],
  3: CORTEX_TOKENS['--cortex-space-3'],
  4: CORTEX_TOKENS['--cortex-space-4'],
  5: CORTEX_TOKENS['--cortex-space-5'],
  6: CORTEX_TOKENS['--cortex-space-6'],
} as const;

export const elevation = {
  flat: CORTEX_TOKENS['--cortex-elevation-flat'],
  overlay: CORTEX_TOKENS['--cortex-elevation-overlay'],
  accent: CORTEX_TOKENS['--cortex-elevation-accent'],
} as const;

export const typography = {
  display: CORTEX_TOKENS['--cortex-font-size-display'],
  title: CORTEX_TOKENS['--cortex-font-size-title'],
  heading: CORTEX_TOKENS['--cortex-font-size-heading'],
  body: CORTEX_TOKENS['--cortex-font-size-body'],
  label: CORTEX_TOKENS['--cortex-font-size-label'],
  caption: CORTEX_TOKENS['--cortex-font-size-caption'],
  micro: CORTEX_TOKENS['--cortex-font-size-micro'],
} as const;

export const fontWeight = {
  regular: CORTEX_TOKENS['--cortex-font-weight-regular'],
  medium: CORTEX_TOKENS['--cortex-font-weight-medium'],
  semibold: CORTEX_TOKENS['--cortex-font-weight-semibold'],
  bold: CORTEX_TOKENS['--cortex-font-weight-bold'],
} as const;

export const lineHeight = {
  tight: CORTEX_TOKENS['--cortex-line-height-tight'],
  normal: CORTEX_TOKENS['--cortex-line-height-normal'],
} as const;

export const controlHeight = {
  compact: CORTEX_TOKENS['--cortex-control-height-compact'],
  comfortable: CORTEX_TOKENS['--cortex-control-height-comfortable'],
} as const;

export const duration = {
  fast: CORTEX_TOKENS['--cortex-duration-fast'],
  normal: CORTEX_TOKENS['--cortex-duration-normal'],
} as const;

/**
 * The status colours a chart may draw from, in a stable order.
 *
 * Charts used to inline their own arrays of six hexes, each file picking a
 * different order, so the same status was a different colour on two screens of
 * the same dashboard.
 */
export const CHART_SERIES: readonly string[] = [
  brand.accent,
  status.success,
  status.warning,
  brand.accentAlt,
  status.info,
  status.danger,
];

/**
 * The colour that means a given submission status, everywhere.
 *
 * `Record` over the exact status union, so a status added to the domain cannot
 * be forgotten here — the compiler names it.
 */
export const SUBMISSION_STATUS_COLOR: Readonly<
  Record<'new' | 'in-review' | 'completed' | 'approved', string>
> = {
  new: brand.accent,
  'in-review': status.warning,
  completed: status.info,
  approved: status.success,
};

/**
 * The colour that means a given business department, everywhere.
 *
 * The portfolio views declared this map TWICE, in two components of the same
 * file, with the same twelve entries written two different ways — so a
 * department recoloured on one view and not the other would have looked like
 * two departments. It is declared once here, drawn only from tokens.
 *
 * The trailing entries are the legacy keys older submissions still carry; they
 * deliberately share a colour with their modern equivalent, because they ARE
 * the same department under an older name.
 */
export const DEPARTMENT_COLOR: Readonly<Record<string, string>> = {
  revenue_engine:          status.success,
  customer_experience:     status.info,
  operations_supply_chain: status.warning,
  marketing_acquisition:   brand.accentTertiary,
  finance_unit_economics:  status.caution,
  data_infrastructure:     brand.accentAlt,
  talent_process:          brand.accent,

  // Legacy keys, same departments.
  operations: status.warning,
  revenue:    status.success,
  systems:    brand.accentAlt,
  governance: brand.accent,
  data:       status.caution,
};

/** The colour that means a given priority, everywhere. */
export const PRIORITY_COLOR: Readonly<Record<'low' | 'medium' | 'high', string>> = {
  low: status.neutral,
  medium: status.caution,
  high: status.danger,
};
