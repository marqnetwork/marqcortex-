/**
 * What the production release actually ships, measured.
 *
 * Nothing recorded the size of this application's bundle. `vite build` prints a
 * chunk-size warning on every run — the primary dashboard chunk is over a
 * megabyte — and a warning that appears on every successful build is a warning
 * nobody reads. Before a release is approved, the number should be a recorded
 * fact with a ceiling over it rather than a line of yellow text scrolling past.
 *
 * ── WHAT THIS IS AND IS NOT ────────────────────────────────────────────────
 *
 * It is a RATCHET, not a target. The budgets below sit above what the release
 * currently ships, with room for ordinary growth, and they exist to catch the
 * step change: a heavy library pulled into the entry chunk, a lazy route that
 * stops being lazy, a dependency bump that doubles a vendor bundle. Those are
 * the regressions that reach users as a blank screen on a slow connection, and
 * they are invisible in a diff.
 *
 * It is deliberately NOT a demand to split `CortexDashboard`. That chunk is
 * genuine application code — checked, not assumed: no heavy charting, PDF or
 * date library is bundled into it that is not already lazily routed — and it is
 * loaded on demand, behind authentication, after the entry chunk has already
 * rendered. Restructuring it is a refactor with regression risk, and the end of
 * a release cycle is the wrong time to take that on. Recording the number and
 * pinning a ceiling is the part that belongs here.
 *
 * ── WHY GZIP IS THE NUMBER THAT MATTERS ────────────────────────────────────
 *
 * Every host that serves this compresses; `scripts/serve-release.mjs` and Vercel
 * both do. Raw bytes are what parse time scales with and are recorded too, but
 * the transfer cost — the part a user on a slow link feels — is the compressed
 * size, so that is what the tighter budget is set against.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = join(root, 'dist', 'assets');

const KB = 1024;

/**
 * Budgets, in kilobytes. Each sits above the measured release with headroom.
 * Raising one is a decision someone should have to make on purpose, in a diff
 * that says why — which is the whole mechanism.
 */
const BUDGET = {
  /** The chunk every visitor downloads before anything renders. */
  entryGzip: 70,
  /** The largest single lazy chunk. Currently CortexDashboard. */
  largestChunkGzip: 360,
  /** Everything, if a visitor somehow reached every route in one session. */
  totalGzip: 1_500,
  /** Parse cost scales with raw bytes, not transfer size. */
  totalRaw: 5_500,
} as const;

interface Chunk {
  name: string;
  raw: number;
  gzip: number;
}

function chunks(): Chunk[] {
  return readdirSync(ASSETS)
    .filter((name) => name.endsWith('.js'))
    .map((name) => {
      const bytes = readFileSync(join(ASSETS, name));
      return { name, raw: bytes.length, gzip: gzipSync(bytes).length };
    })
    .sort((a, b) => b.gzip - a.gzip);
}

const kb = (bytes: number) => Math.round(bytes / KB);

describe('release bundle budget', () => {
  it('a build exists to measure', () => {
    // A skip reads as a pass in a summary line, so this fails instead and says
    // what to run. `npm run test:bundle` builds first for exactly this reason.
    assert.ok(
      existsSync(ASSETS),
      'dist/assets is missing — run `npm run build` first, or `npm run test:bundle` which does',
    );
    assert.ok(chunks().length > 0, 'dist/assets contains no JavaScript');
  });

  it(`the entry chunk is under ${BUDGET.entryGzip} kB gzipped`, () => {
    const entry = chunks().find((chunk) => chunk.name.startsWith('index-'));
    assert.ok(entry, 'no index-*.js entry chunk found — the build layout changed');
    assert.ok(
      entry.gzip <= BUDGET.entryGzip * KB,
      `the entry chunk is ${kb(entry.gzip)} kB gzipped (${kb(entry.raw)} kB raw), over the ` +
        `${BUDGET.entryGzip} kB budget. This is the code every visitor downloads before ` +
        `anything renders, so something that belongs behind a lazy route is probably in it.`,
    );
  });

  it(`no single chunk exceeds ${BUDGET.largestChunkGzip} kB gzipped`, () => {
    const largest = chunks()[0];
    assert.ok(
      largest.gzip <= BUDGET.largestChunkGzip * KB,
      `${largest.name} is ${kb(largest.gzip)} kB gzipped (${kb(largest.raw)} kB raw), over the ` +
        `${BUDGET.largestChunkGzip} kB budget. Either a heavy dependency landed in it, or a ` +
        `route that was lazy stopped being lazy.`,
    );
  });

  it(`the whole bundle is under ${BUDGET.totalGzip} kB gzipped and ${BUDGET.totalRaw} kB raw`, () => {
    const all = chunks();
    const gzip = all.reduce((sum, chunk) => sum + chunk.gzip, 0);
    const raw = all.reduce((sum, chunk) => sum + chunk.raw, 0);

    assert.ok(
      gzip <= BUDGET.totalGzip * KB,
      `the bundle is ${kb(gzip)} kB gzipped across ${all.length} chunks, over the ` +
        `${BUDGET.totalGzip} kB budget`,
    );
    assert.ok(
      raw <= BUDGET.totalRaw * KB,
      `the bundle is ${kb(raw)} kB raw across ${all.length} chunks, over the ` +
        `${BUDGET.totalRaw} kB budget. Raw bytes are what parse time scales with.`,
    );
  });

  it('the profile is reported, so the number is a fact and not a warning nobody reads', () => {
    const all = chunks();
    const gzip = all.reduce((sum, chunk) => sum + chunk.gzip, 0);
    const raw = all.reduce((sum, chunk) => sum + chunk.raw, 0);

    console.log(`\n  ${all.length} JS chunks — ${kb(raw)} kB raw, ${kb(gzip)} kB gzipped`);
    for (const chunk of all.slice(0, 5)) {
      console.log(`    ${chunk.name.padEnd(44)} ${String(kb(chunk.gzip)).padStart(5)} kB gz`);
    }
    assert.ok(all.length > 0);
  });
});
