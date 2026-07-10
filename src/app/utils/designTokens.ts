/**
 * MARQ CORTEX — Unified Design Tokens
 *
 * Single source of truth for brand colors, gradients, shadows, and spacing
 * used across BOTH team-facing and client-facing surfaces.
 *
 * Rule: Every component imports from here. No more inline hex codes that drift.
 */

// ── Brand Palette ─────────────────────────────────────────────────────────────

export const BRAND = {
  /** Primary violet — hero buttons, active tabs, key badges */
  purple:     '#8B5CF6',
  purpleDark: '#7C3AED',
  purpleGlow: 'rgba(139,92,246,0.35)',

  /** Secondary blue — gradients, links, info states */
  blue:       '#3B82F6',
  blueDark:   '#2563EB',
  blueGlow:   'rgba(59,130,246,0.25)',

  /** Accent cyan — highlights, secondary CTAs, data viz */
  cyan:       '#06D7F6',
  cyanDark:   '#0891B2',
  cyanGlow:   'rgba(6,215,246,0.20)',

  /** Semantic status colors */
  green:      '#10B981',
  greenGlow:  'rgba(16,185,129,0.15)',
  orange:     '#FB923C',
  orangeGlow: 'rgba(251,146,60,0.18)',
  red:        '#FD4438',
  redGlow:    'rgba(253,68,56,0.15)',

  /** Neutrals — shared across both team & client UIs */
  gray50:     '#F5F5FF',
  gray400:    '#9CA3AF',
  gray500:    '#70707C',
  gray600:    '#4B5563',
  gray700:    '#374151',
  gray800:    '#1F2937',
  gray900:    '#111827',

  /** Surfaces */
  bgDeep:     '#0A0A0F',
  bgCard:     'rgba(0,0,0,0.40)',
  bgCardHover:'rgba(255,255,255,0.05)',
  bgOverlay:  'rgba(0,0,0,0.80)',
  borderSubtle:'rgba(255,255,255,0.10)',
  borderHover: 'rgba(255,255,255,0.20)',
} as const;

// ── Gradient presets ──────────────────────────────────────────────────────────

export const GRADIENTS = {
  /** Hero / primary CTA */
  primaryButton:  `linear-gradient(135deg, ${BRAND.purple}, ${BRAND.blue})`,
  /** Client portal accent */
  cyanButton:     `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.cyan})`,
  /** Card header accents */
  purpleFade:     `linear-gradient(135deg, rgba(139,92,246,0.20), rgba(59,130,246,0.10))`,
  /** Glow orbs for login pages */
  orbPurple:      `radial-gradient(circle, ${BRAND.purple}, transparent)`,
  orbBlue:        `radial-gradient(circle, ${BRAND.blue}, transparent)`,
  orbCyan:        `radial-gradient(circle, ${BRAND.cyan}, transparent)`,
} as const;

// ── Shadow presets ────────────────────────────────────────────────────────────

export const SHADOWS = {
  /** Login card / hero section glow */
  purpleGlow: `0 20px 60px ${BRAND.purpleGlow}`,
  blueGlow:   `0 20px 60px ${BRAND.blueGlow}`,
  cyanGlow:   `0 20px 60px ${BRAND.cyanGlow}`,
  /** Subtle card elevation */
  card:       '0 4px 24px rgba(0,0,0,0.30)',
} as const;

// ── Shared typography classes (Tailwind) ──────────────────────────────────────

export const TYPO = {
  /** Font stack override — applied via style={{ fontFamily }} */
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;
