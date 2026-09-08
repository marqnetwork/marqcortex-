/**
 * UI SPRINT 7 — the design-token layer, and the drift it exists to prevent.
 *
 * THE PROBLEM THE TOKENS ADDRESS
 *   The console carried 5,311 hard-coded hex literals across 98 components, and
 *   the inconsistency was semantic rather than cosmetic. Three different "panel"
 *   surfaces (`bg-black/40`, `/30`, `/20`) were used interchangeably for the
 *   same kind of container, so depth had stopped meaning anything. Four hairline
 *   borders (`white/10`, `/8`, `/6`, `/5`) appeared on the same screen, none of
 *   them distinguishable. "Muted text" was `text-white/60`, `text-white/50` or
 *   `text-gray-400` depending on which file you opened.
 *
 * WHAT IS GUARDED HERE
 *   1. THE TWO LAYERS CANNOT DRIFT. `src/styles/tokens.css` is the source of
 *      truth; `src/app/lib/tokens.ts` mirrors it for the thousands of inline
 *      styles and chart props that cannot read a custom property. Every token
 *      must exist in both, with the same value.
 *   2. EVERY TOKEN IS REACHABLE. A token nothing can name is a token nobody
 *      uses, so each one is exported through a grouped accessor.
 *   3. NO VALUE IS STATED TWICE. The grouped accessors are derived from
 *      `CORTEX_TOKENS`, never restated, so a value exists in exactly one place
 *      in the module.
 *   4. THE TOKENS ARE THE PRODUCT'S EXISTING COLOURS. This layer is not a
 *      redesign, and the test names the specific hexes the console already
 *      renders so a future "tidy-up" of them is a deliberate, visible change.
 *   5. THE STATUS MAPS ARE TOTAL. Every submission status and every priority
 *      has exactly one colour, so the same state cannot read differently on two
 *      screens of the same dashboard.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  CORTEX_TOKENS,
  token,
  surface, border, text, brand, status,
  radius, space, elevation,
  typography, fontWeight, lineHeight,
  controlHeight, duration,
  CHART_SERIES,
  SUBMISSION_STATUS_COLOR,
  PRIORITY_COLOR,
} from '../../src/app/lib/tokens.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const CSS_PATH = 'src/styles/tokens.css';
const TS_PATH = 'src/app/lib/tokens.ts';

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Strip comments so declarations are matched, never prose. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The `:root` block's declarations — the tokens themselves.
 *
 * The `@theme inline` block below it maps tokens onto Tailwind utilities by
 * REFERENCE (`var(--cortex-…)`), so it declares no values of its own and is
 * deliberately excluded here.
 */
function parseRootTokens(): Map<string, string> {
  const css = stripCssComments(readSource(CSS_PATH));
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  assert.ok(root, ':root block not found in tokens.css');

  const tokens = new Map<string, string>();
  for (const line of root[1].split('\n')) {
    const match = line.match(/^\s*(--cortex-[a-z0-9-]+)\s*:\s*(.+?);\s*$/);
    if (match) tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

/** The `@theme inline` block's declarations — the Tailwind utility surface. */
function parseThemeMappings(): Map<string, string> {
  const css = stripCssComments(readSource(CSS_PATH));
  const theme = css.match(/@theme inline\s*\{([\s\S]*?)\n\}/);
  assert.ok(theme, '@theme inline block not found in tokens.css');

  const mappings = new Map<string, string>();
  for (const line of theme[1].split('\n')) {
    const match = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*var\((--cortex-[a-z0-9-]+)\);\s*$/);
    if (match) mappings.set(match[1], match[2]);
  }
  return mappings;
}

// ── 1. The two layers agree ───────────────────────────────────────────────────

describe('the CSS and TypeScript token layers cannot drift', () => {
  it('declares the same token names in both', () => {
    const css = [...parseRootTokens().keys()].sort();
    const ts = Object.keys(CORTEX_TOKENS).sort();
    assert.deepEqual(ts, css);
  });

  it('gives every token the same value in both', () => {
    for (const [name, value] of parseRootTokens()) {
      assert.equal(
        CORTEX_TOKENS[name as keyof typeof CORTEX_TOKENS], value,
        `${name} disagrees between ${CSS_PATH} and ${TS_PATH}`,
      );
    }
  });

  it('declares a non-empty value for every token', () => {
    for (const [name, value] of Object.entries(CORTEX_TOKENS)) {
      assert.equal(typeof value, 'string');
      assert.ok(value.length > 0, `${name} has no value`);
    }
  });

  it('reads a token back through the accessor', () => {
    assert.equal(token('--cortex-accent'), CORTEX_TOKENS['--cortex-accent']);
  });
});

// ── 2. Every token is reachable, and stated once ─────────────────────────────

describe('every token is reachable through a grouped accessor', () => {
  const groups = [
    surface, border, text, brand, status, radius, space,
    elevation, typography, fontWeight, lineHeight, controlHeight, duration,
  ];

  it('exposes every declared token through exactly one group', () => {
    const exposed = new Set(groups.flatMap(group => Object.values(group) as string[]));
    for (const [name, value] of Object.entries(CORTEX_TOKENS)) {
      assert.ok(exposed.has(value), `${name} (${value}) is not reachable from any accessor`);
    }
  });

  it('states no value twice in the module source', () => {
    // The grouped accessors must READ `CORTEX_TOKENS`, never repeat a literal.
    // A second copy of a value is a second thing to change, and the one that
    // gets missed.
    const source = readSource(TS_PATH);
    const body = source.slice(source.indexOf('export const surface'));
    const literals = body.match(/'#[0-9A-Fa-f]{6}'|'rgba\([^)]*\)'|'\d+px'/g) ?? [];
    assert.deepEqual(
      literals, [],
      `grouped accessors restate values instead of reading them: ${literals.join(', ')}`,
    );
  });
});

// ── 3. The Tailwind utility surface ──────────────────────────────────────────

describe('the tokens are usable from a class name', () => {
  it('maps every colour token onto a Tailwind colour utility', () => {
    const mapped = new Set(parseThemeMappings().values());
    const colourTokens = [...parseRootTokens().keys()].filter(
      name => name.startsWith('--cortex-surface-')
        || name.startsWith('--cortex-border-')
        || name.startsWith('--cortex-text-')
        || name.startsWith('--cortex-status-')
        || name === '--cortex-accent'
        || name === '--cortex-accent-alt',
    );
    for (const name of colourTokens) {
      assert.ok(mapped.has(name), `${name} has no Tailwind utility, so no class can say it`);
    }
  });

  it('maps every radius token too', () => {
    const mapped = new Set(parseThemeMappings().values());
    for (const name of [...parseRootTokens().keys()].filter(n => n.startsWith('--cortex-radius-'))) {
      assert.ok(mapped.has(name), `${name} has no Tailwind utility`);
    }
  });

  it('maps by reference, never by value', () => {
    // A mapping that restates a hex is a second source of truth.
    const css = stripCssComments(readSource(CSS_PATH));
    const theme = css.match(/@theme inline\s*\{([\s\S]*?)\n\}/)![1];
    assert.ok(
      !/#[0-9A-Fa-f]{3,8}|rgba?\(/.test(theme),
      '@theme inline contains a literal colour instead of a var() reference',
    );
  });

  it('points every mapping at a token that exists', () => {
    const declared = parseRootTokens();
    for (const [utility, target] of parseThemeMappings()) {
      assert.ok(declared.has(target), `${utility} points at ${target}, which is not declared`);
    }
  });
});

// ── 4. This is a convergence, not a redesign ─────────────────────────────────

describe('the three-step scale exists for the two jobs the base colour cannot do', () => {
  // `-light` is TEXT on a tint of its own hue; `-deep` is a solid fill,
  // PRESSED. Sixteen files were doing both with undeclared hex before these
  // were named.
  const relative = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (fg: string, bg: string) => {
    const [a, b] = [relative(fg), relative(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  };

  const PAIRS: [name: string, light: string, base: string, deep: string][] = [
    ['accent',     brand.accentLight,    brand.accent,    brand.accentDeep],
    ['accent-alt', brand.accentAltLight, brand.accentAlt, brand.accentAltDeep],
    ['success',    status.successLight,  status.success,  status.successDeep],
    ['danger',     status.dangerLight,   status.danger,   status.dangerDeep],
    ['caution',    status.cautionLight,  status.caution,  status.cautionDeep],
  ];

  for (const [name, light, base, deep] of PAIRS) {
    it(`${name}: light is lighter than base, and deep is darker`, () => {
      assert.ok(relative(light) > relative(base), `${name}-light is not lighter than the base`);
      assert.ok(relative(deep) < relative(base), `${name}-deep is not darker than the base`);
    });

    it(`${name}: the light step clears AA on the canvas where the base may not`, () => {
      // This is the whole reason the light step exists. `#C4B5FD` and friends
      // were being hand-written precisely because the base colour is not
      // readable as text on a dark surface.
      assert.ok(
        contrast(light, surface.canvas) >= 4.5,
        `${name}-light is ${contrast(light, surface.canvas).toFixed(2)}:1 on the canvas`,
      );
    });
  }

  it('every step is distinct', () => {
    const all = PAIRS.flatMap(([, l, b, d]) => [l, b, d]);
    assert.equal(new Set(all).size, all.length, 'two steps of the scale share a colour');
  });
});

describe('the tokens are the colours the product already renders', () => {
  it('keeps the brand pair', () => {
    assert.equal(brand.accent, '#8B5CF6');
    assert.equal(brand.accentAlt, '#3B82F6');
  });

  it('keeps every status colour', () => {
    assert.equal(status.success, '#10B981');
    assert.equal(status.warning, '#FB923C');
    assert.equal(status.danger, '#FD4438');
    assert.equal(status.info, '#06D7F6');
    assert.equal(status.caution, '#F59E0B');
    assert.equal(status.neutral, '#70707C');
  });

  it('keeps the canvas and the dominant panel surface', () => {
    // `#0A0A0F` is the app background; `rgba(0,0,0,0.4)` is `bg-black/40`, the
    // panel fill used 213 times before this layer existed.
    assert.equal(surface.canvas, '#0A0A0F');
    assert.equal(surface.raised, 'rgba(0, 0, 0, 0.4)');
  });

  it('keeps the dominant border weight', () => {
    // `border-white/10`, used 471 times.
    assert.equal(border.default, 'rgba(255, 255, 255, 0.1)');
  });

  it('keeps the radii the components already round to', () => {
    // rounded-lg, rounded-xl, rounded-2xl, rounded-full.
    assert.equal(radius.sm, '8px');
    assert.equal(radius.md, '12px');
    assert.equal(radius.lg, '16px');
    assert.equal(radius.pill, '9999px');
  });

  it('offers a comfortable control height that clears a touch target', () => {
    assert.ok(parseInt(controlHeight.comfortable, 10) >= 44);
  });
});

// ── 5. Status maps are total and unambiguous ─────────────────────────────────

describe('one status, one colour, everywhere', () => {
  it('colours every submission status', () => {
    assert.deepEqual(
      Object.keys(SUBMISSION_STATUS_COLOR).sort(),
      ['approved', 'completed', 'in-review', 'new'],
    );
    for (const [name, colour] of Object.entries(SUBMISSION_STATUS_COLOR)) {
      assert.match(colour, /^#[0-9A-Fa-f]{6}$/, `${name} has no colour`);
    }
  });

  it('gives each submission status a distinct colour', () => {
    const colours = Object.values(SUBMISSION_STATUS_COLOR);
    assert.equal(new Set(colours).size, colours.length, 'two statuses share a colour');
  });

  it('colours every priority, and distinctly', () => {
    assert.deepEqual(Object.keys(PRIORITY_COLOR).sort(), ['high', 'low', 'medium']);
    const colours = Object.values(PRIORITY_COLOR);
    assert.equal(new Set(colours).size, colours.length);
  });

  it('draws every status colour from the token layer', () => {
    const known = new Set(Object.values(CORTEX_TOKENS) as string[]);
    for (const colour of [...Object.values(SUBMISSION_STATUS_COLOR), ...Object.values(PRIORITY_COLOR)]) {
      assert.ok(known.has(colour), `${colour} is not a token`);
    }
  });

  it('gives charts a stable series order drawn from the tokens', () => {
    const known = new Set(Object.values(CORTEX_TOKENS) as string[]);
    assert.ok(CHART_SERIES.length >= 5);
    assert.equal(new Set(CHART_SERIES).size, CHART_SERIES.length, 'a series colour repeats');
    for (const colour of CHART_SERIES) {
      assert.ok(known.has(colour), `${colour} is not a token`);
    }
  });
});
