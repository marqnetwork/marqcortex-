/**
 * A LIVE node is one the application can actually reach.
 *
 * The manifest says LIVE means "works end-to-end. Real data. No mock bypass."
 * `DiagnosticQuestion` was marked LIVE and **nothing imported it**. So was
 * `ProgressModal`, which only `DiagnosticQuestion` mounts. Neither had run in
 * the product for as long as anyone could tell.
 *
 * `src/system/validate.ts` did not catch it, and could not have: it checks that
 * a LIVE node's DEPENDENCIES are sound — that it does not rest on something
 * MISSING or DEMO — which is a statement about what a node points at. Nothing
 * asked what points at the node. A file can satisfy every dependency rule in the
 * manifest and still be unreachable from `main.tsx`.
 *
 * This walks the real import graph instead of asking the manifest about itself.
 * The manifest is the claim; the import graph is the fact.
 *
 * ── WHY DYNAMIC IMPORTS COUNT ──────────────────────────────────────────────
 *
 * The router lazy-loads its pages, so `import('@/app/pages/Foo')` is how most of
 * the product is reached. A traversal that followed only static `import ... from`
 * would call almost every page orphaned, which is the kind of false alarm that
 * gets a check deleted rather than fixed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { manifest } from '../../src/system/manifest.ts';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SRC = join(ROOT, 'src');
const ENTRY = join(SRC, 'main.tsx');

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/** Resolve a specifier to a file on disk, or `null` if it is not ours. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null; // a package, not a file in this repository

  const candidates = extname(base)
    ? [base, ...EXTENSIONS.map((extension) => base + extension)]
    : [
        ...EXTENSIONS.map((extension) => base + extension),
        ...EXTENSIONS.map((extension) => join(base, `index${extension}`)),
      ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Every specifier a module pulls in — static, dynamic, re-exported, side-effect. */
function specifiersIn(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bimport\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g, // import x from '…'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //      import('…')
    /\bexport\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g, // export … from '…'
    /\bimport\s*['"]([^'"]+)['"]/g, //                import '…'
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/** Everything reachable from the entry point, as repository-relative paths. */
async function reachableFromEntry(): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [ENTRY];

  while (queue.length > 0) {
    const file = queue.pop()!;
    const key = relative(ROOT, file);
    if (seen.has(key)) continue;
    seen.add(key);

    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    // Comments first: a module that EXPLAINS why it no longer imports something
    // still names it, and a traversal that believes prose reports the graph the
    // code used to have.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    for (const specifier of specifiersIn(code)) {
      const resolved = resolveSpecifier(specifier, file);
      if (resolved !== null) queue.push(resolved);
    }
  }
  return seen;
}

describe('the manifest agrees with the import graph', () => {
  it('the traversal actually finds the application', async () => {
    // A traversal that resolved nothing would pass every assertion below by
    // finding no LIVE node reachable and no ORPHANED node reachable either.
    const reachable = await reachableFromEntry();
    assert.ok(
      reachable.size > 100,
      `the import walk found only ${reachable.size} files — it is not following the graph`,
    );
    assert.ok(reachable.has('src/app/App.tsx'), 'the walk never reached App.tsx');
    assert.ok(
      reachable.has('src/app/components/TeamLogin.tsx'),
      'the walk never reached a lazily-routed page — dynamic imports are not being followed',
    );
  });

  it('every LIVE node with a file is reachable from main.tsx', async () => {
    const reachable = await reachableFromEntry();
    const unreachable: string[] = [];

    for (const entry of Object.values(manifest.nodes)) {
      if (entry.status !== 'LIVE') continue;
      if (!entry.filePath?.startsWith('src/')) continue;
      // Only files that are code the app runs. A type-only module is erased at
      // build time and legitimately has no runtime edge.
      if (entry.type === 'TYPE') continue;
      if (!existsSync(join(ROOT, entry.filePath))) continue; // MISSING's business

      if (!reachable.has(entry.filePath)) {
        unreachable.push(`${entry.id} ${entry.name} — ${entry.filePath}`);
      }
    }

    assert.deepEqual(
      unreachable,
      [],
      'these claim LIVE and nothing imports them. LIVE means "works end-to-end"; ' +
        'a file the app never reaches does not work, it simply never runs. Mark ' +
        'them ORPHANED, or wire them in.',
    );
  });

  it('every ORPHANED node really is unreachable', async () => {
    // The status has to be as falsifiable as the one it replaced. A node marked
    // ORPHANED that IS wired in is the same lie in the other direction.
    const reachable = await reachableFromEntry();
    const wired: string[] = [];

    for (const entry of Object.values(manifest.nodes)) {
      if (entry.status !== 'ORPHANED') continue;
      if (entry.filePath && reachable.has(entry.filePath)) {
        wired.push(`${entry.id} ${entry.name} — ${entry.filePath}`);
      }
    }

    assert.deepEqual(wired, [], 'these are marked ORPHANED but the app does reach them');
  });

  it('every node names a file that exists, unless it says MISSING', async () => {
    const absent: string[] = [];
    for (const entry of Object.values(manifest.nodes)) {
      if (entry.status === 'MISSING') continue;
      if (!entry.filePath) continue;
      if (!existsSync(join(ROOT, entry.filePath))) {
        absent.push(`${entry.id} ${entry.name} — ${entry.filePath}`);
      }
    }
    assert.deepEqual(absent, [], 'these name a file that is not on disk but do not say MISSING');
  });
});
