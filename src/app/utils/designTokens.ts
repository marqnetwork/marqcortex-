/**
 * MARQ CORTEX — Design token aliases.
 *
 * WHAT THIS IS NOW
 *   A compatibility surface over `@/app/lib/tokens`, kept because three
 *   components import `BRAND` and `GRADIENTS` by these names. It declares no
 *   colour of its own.
 *
 * WHAT IT USED TO BE
 *   A second token module. It called itself the single source of truth and
 *   spelled out seventeen hex values — the same values `lib/tokens.ts`
 *   declares, written a second time. Two modules each claiming to be the one
 *   place a colour is decided is the failure this whole migration exists to
 *   remove, and it is worse here than in a component: a component with a
 *   stray hex is one screen adrift, whereas a second TOKEN module hands the
 *   drift to everything that imports it.
 *
 *   Only the twelve names anything actually reads are kept — the sixteen dead
 *   ones (`purpleDark`, `cyanDark`, seven greys, four surfaces, two borders)
 *   are gone rather than given token values nobody would consume. New code
 *   should import `@/app/lib/tokens` directly.
 */

import { brand, status } from '@/app/lib/tokens';

/** Compose an 8-digit hex from a token and an alpha, for the *Glow values. */
const glow = (hex: string, alpha: number) =>
  `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase()}`;

// ── Brand Palette ─────────────────────────────────────────────────────────────

export const BRAND = {
  /** Primary violet — hero buttons, active tabs, key badges */
  purple:     brand.accent,
  purpleGlow: glow(brand.accent, 0.35),

  /** Secondary blue — gradients, links, info states */
  blue:       brand.accentAlt,
  blueGlow:   glow(brand.accentAlt, 0.25),

  /** Accent cyan — highlights, secondary CTAs, data viz */
  cyan:       status.info,
  cyanGlow:   glow(status.info, 0.20),

  /** Semantic status colors */
  green:      status.success,
  greenGlow:  glow(status.success, 0.15),
  orange:     status.warning,
  orangeGlow: glow(status.warning, 0.18),
  red:        status.danger,
  redGlow:    glow(status.danger, 0.15),

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
