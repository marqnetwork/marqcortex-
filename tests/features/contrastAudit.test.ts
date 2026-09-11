/**
 * Text on a tinted background clears AA — measured, not asserted.
 *
 * The pattern this checks is everywhere in the console: a pill or badge whose
 * background is a low-alpha tint of a status colour, with text in that same
 * colour (or a neutral text token) on top. The contrast that matters is against
 * the COMPOSITED tint, not against the page, and it is easy to get wrong by
 * nudging one alpha.
 *
 * It is also easy to get the CHECK wrong, and this one was, twice:
 *
 *   1. The first version crossed every colour with every alpha found anywhere,
 *      and over-reported — an alpha used for a border is not a background behind
 *      that colour's text.
 *   2. The second matched style objects with `\{[^{}]*\}` and found NOTHING. A
 *      JSX style prop is `style={{ … }}` and every value in it is `${…}`, so a
 *      brace-free pattern can never match one. Zero findings from a broken
 *      matcher reads exactly like zero findings from a clean codebase, which is
 *      the most expensive kind of green.
 *
 * So: balanced braces, real co-occurrence, and a self-check that the scan found
 * the pairings that are known to be there.
 *
 * The recorded H1 finding — "chip-on-own-tint at 4.17:1" for `status.neutral` —
 * turned out to describe a pairing that **does not exist in the code**. Nothing
 * puts neutral text on a neutral tint. Two real failures did exist and neither
 * had been recorded.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const APP = join(ROOT, 'src/app');
const TOKENS = join(ROOT, 'src/app/lib/tokens.ts');

/** WCAG AA for normal text. */
const AA = 4.5;

/** The surfaces a tinted chip is painted on. */
const SURFACES: Readonly<Record<string, string>> = {
  canvas: '#0A0A0F',
  surface: '#111118',
  control: '#16161D',
};

type Rgba = readonly [number, number, number, number];

function parseColour(value: string): Rgba | null {
  const hex = /^#([0-9A-Fa-f]{6})$/.exec(value.trim());
  if (hex) {
    const n = hex[1];
    return [
      parseInt(n.slice(0, 2), 16),
      parseInt(n.slice(2, 4), 16),
      parseInt(n.slice(4, 6), 16),
      1,
    ];
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value.trim());
  if (rgba) {
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  }
  return null;
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` at `alpha` over the opaque `bg`. */
function over(fg: Rgba, alpha: number, bg: Rgba): Rgba {
  return [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
    1,
  ];
}

/** The token values, read from the token file so this cannot drift from it. */
async function palette(): Promise<Map<string, Rgba>> {
  const source = await readFile(TOKENS, 'utf8');
  const values = new Map<string, Rgba>();
  for (const match of source.matchAll(/'--cortex-(status|text|brand)-([a-z-]+)':\s*'([^']+)'/g)) {
    const parsed = parseColour(match[3]);
    if (!parsed) continue;
    // `status-success-light` reaches the code as `status.successLight`.
    const name = match[2].replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    values.set(`${match[1] === 'brand' ? 'brand' : match[1]}.${name}`, parsed);
  }
  return values;
}

function paletteKey(identifier: string, known: Map<string, Rgba>): string | null {
  const match = /^(STATUS|status|TEXT|text|BRAND|brand)\.([A-Za-z]+)$/.exec(identifier);
  if (!match) return null;
  const key = `${match[1].toLowerCase()}.${match[2]}`;
  return known.has(key) ? key : null;
}

/** The balanced extent of every `style={{ … }}` in a source file. */
function styleObjects(source: string): string[] {
  const objects: string[] = [];
  for (const match of source.matchAll(/style=\{\{/g)) {
    let i = match.index! + match[0].length - 1;
    let depth = 0;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    objects.push(source.slice(match.index!, i + 1));
  }
  return objects;
}

async function tsxFiles(dir: string, found: string[] = []): Promise<string[]> {
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) await tsxFiles(path, found);
    else if (name.endsWith('.tsx')) found.push(path);
  }
  return found;
}

interface Pairing {
  readonly foreground: string;
  readonly background: string;
  readonly alpha: string;
  readonly sites: Set<string>;
}

async function pairings(): Promise<Map<string, Pairing>> {
  const known = await palette();
  const found = new Map<string, Pairing>();

  for (const file of await tsxFiles(APP)) {
    const source = await readFile(file, 'utf8');
    for (const object of styleObjects(source)) {
      const bg = /background(?:Color)?:\s*`\$\{([A-Za-z_.]+)\}([0-9A-Fa-f]{2})`/.exec(object);
      if (!bg) continue;
      // `color:` and not `borderColor:` — the key must not follow a letter.
      const fg = /(?:^|[^A-Za-z])color:\s*([A-Za-z_.]+)\s*[,}]/.exec(object);
      if (!fg) continue;

      const background = paletteKey(bg[1], known);
      const foreground = paletteKey(fg[1], known);
      if (!background || !foreground) continue;

      const key = `${foreground}|${background}|${bg[2].toLowerCase()}`;
      if (!found.has(key)) {
        found.set(key, { foreground, background, alpha: bg[2].toLowerCase(), sites: new Set() });
      }
      found.get(key)!.sites.add(file.slice(ROOT.length));
    }
  }
  return found;
}

interface Measurement {
  readonly surface: string;
  readonly ratio: number;
  describe(): string;
}

/**
 * Measure every pairing on every surface it can sit on.
 *
 * Extracted from the assertion so the COMPOSITING can be tested directly. While
 * this lived inline, replacing `over(tint, alpha, surface)` with `surface` made
 * every chip measure higher and the audit passed — the permissive direction,
 * which is the one a mutation test has to reach.
 */
function measureAll(all: readonly Pairing[], known: Map<string, Rgba>): Measurement[] {
  const out: Measurement[] = [];
  for (const pairing of all) {
    const alpha = parseInt(pairing.alpha, 16) / 255;
    const tint = known.get(pairing.background)!;
    const ink = known.get(pairing.foreground)!;

    for (const [surface, surfaceHex] of Object.entries(SURFACES)) {
      const base = parseColour(surfaceHex)!;
      const composited = over(tint, alpha * tint[3], base);
      // Text with its own alpha composites too — `text.muted` is white at 50%.
      const painted = ink[3] === 1 ? ink : over(ink, ink[3], composited);
      const ratio = contrast(painted, composited);
      out.push({
        surface,
        ratio,
        describe: () =>
          `${pairing.foreground} on ${pairing.background}@${pairing.alpha} over ${surface}: ` +
          `${ratio.toFixed(2)}:1 — ${[...pairing.sites].join(', ')}`,
      });
    }
  }
  return out;
}

describe('tinted chips clear WCAG AA', () => {
  it('the scan finds the pairings that are known to be there', async () => {
    // The self-check the broken second version needed and did not have.
    const found = await pairings();
    assert.ok(
      found.size >= 15,
      `only ${found.size} tinted pairings found — the style-object walk is not working`,
    );
    const colours = new Set([...found.values()].map((p) => p.background));
    for (const expected of ['status.danger', 'status.success', 'status.info']) {
      assert.ok(colours.has(expected), `the scan did not find any ${expected} chip`);
    }
  });

  it('every tinted chip clears 4.5:1 on every surface it can sit on', async () => {
    const known = await palette();
    const failures = measureAll([...(await pairings()).values()], known).filter(
      (m) => m.ratio < AA,
    );

    assert.deepEqual(
      failures.map((m) => m.describe()),
      [],
      `these are under AA. Lower the tint alpha (a darker chip raises contrast) ` +
        `or lighten the ink:\n  ${failures.map((m) => m.describe()).join('\n  ')}`,
    );
  });

  it('the audit composites the tint rather than measuring the bare surface', async () => {
    // The mutation this exists for: dropping the composite step leaves the bare
    // SURFACE as the background. A surface is darker than any tint of a bright
    // colour laid over it, so every same-colour chip then measures HIGHER and
    // the whole audit passes vacuously. Asserting the helpers compose correctly
    // does not catch that — the loop has to be shown using them.
    const known = await palette();
    const synthetic: Pairing = {
      foreground: 'status.danger',
      background: 'status.danger',
      alpha: '33',
      sites: new Set(['synthetic']),
    };

    const measured = measureAll([synthetic], known);
    const onControl = measured.find((m) => m.surface === 'control');
    assert.ok(onControl, 'the measurement did not cover the control surface');
    assert.equal(
      onControl!.ratio.toFixed(2),
      '4.14',
      'the audit is not compositing the tint over the surface',
    );
    assert.ok(onControl!.ratio < AA, 'a 20% danger tint must read as a failure');
  });

  it('the measurement itself is right', async () => {
    // A contrast function that returned a constant would pass everything above.
    const white = parseColour('#FFFFFF')!;
    const black = parseColour('#000000')!;
    assert.equal(Math.round(contrast(white, black)), 21);
    assert.equal(Math.round(contrast(white, white)), 1);
    // A known pair. The expected value here was hand-written as 5.30 and was
    // simply wrong; recomputing the WCAG relative luminance by hand gives 5.700.
    // Worth keeping as a fixed number rather than a range: it is the one thing
    // in this file that would catch the luminance coefficients being mistyped.
    assert.equal(contrast(parseColour('#FD4438')!, parseColour('#0A0A0F')!).toFixed(2), '5.70');
    // Compositing halves the distance to the backdrop.
    assert.deepEqual(over(white, 0.5, black), [128, 128, 128, 1]);

    // And it must actually be APPLIED. Dropping the composite step leaves the
    // bare surface as the background, which is darker than any tint of it — so
    // every same-colour chip measures HIGHER and the whole audit passes
    // vacuously. That mutation survived the first version of this file.
    const danger = parseColour('#FD4438')!;
    const control = parseColour('#16161D')!;
    const tinted = over(danger, 0x33 / 255, control);
    assert.ok(
      contrast(danger, tinted) < contrast(danger, control),
      'a tint of a colour must reduce that colour\'s contrast against it',
    );
    assert.equal(contrast(danger, tinted).toFixed(2), '4.14');
  });
});
