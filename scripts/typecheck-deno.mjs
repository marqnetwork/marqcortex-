#!/usr/bin/env node
/**
 * API boundary — Supabase Edge Functions (Deno) type-check.
 *
 * The Supabase functions target the Deno runtime: they use the `Deno` global
 * and `npm:` / `jsr:` import specifiers, which Deno resolves natively. The
 * production-appropriate type-checker for this code is therefore `deno check`,
 * NOT `tsc`.
 *
 * `tsc` has no Deno resolver, so under `tsc` the `Deno` global surfaces as
 * TS2304 ("Cannot find name 'Deno'") and every `npm:` / `jsr:` specifier
 * surfaces as TS2307 ("Cannot find module"). Those are artifacts of using the
 * wrong tool — they are NOT source-code defects and must not be reported as
 * such. This script therefore never falls back to `tsc`.
 *
 * WHY `--node-modules-dir=none`
 * The repository root has a `package.json` and a `node_modules/` for the Vite
 * web app. Deno auto-detects that and expects every `npm:` specifier the edge
 * functions use to be installed there, which it is not — the edge functions are
 * deployed by the Supabase CLI, which resolves them from Deno's own cache.
 * Forcing `none` makes the local check resolve them the same way the deploy does.
 *
 * BOUNDARIES
 * The check runs in two passes so a pre-existing failure elsewhere in the server
 * cannot be mistaken for a regression in the AI boundary, and vice versa:
 *
 *   ai      supabase/functions/server/ai/** plus aiRoutes.ts — the AI-01
 *           surface. Required to be clean. A non-zero exit here is a blocker.
 *   server  everything else under supabase/functions/.
 *
 * Pass `--boundary=ai` to check only the AI surface.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

const FUNCTIONS_ROOT = 'supabase/functions';
const CONFIG = join(FUNCTIONS_ROOT, 'deno.json');

/** Paths that make up the AI-01 boundary. */
const AI_PREFIXES = [
  join(FUNCTIONS_ROOT, 'server', 'ai') + sep,
  join(FUNCTIONS_ROOT, 'server', 'aiRoutes.ts'),
  join(FUNCTIONS_ROOT, 'server', 'teamAuthorization.ts'),
];

function collectSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSources(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const isAiFile = (file) => AI_PREFIXES.some((prefix) => file.startsWith(prefix));

const probe = spawnSync('deno', ['--version'], { stdio: 'ignore' });
if (probe.error || probe.status !== 0) {
  process.stderr.write(
`typecheck:api — BLOCKED: no Deno toolchain in this environment.

The Supabase Edge Functions under ${FUNCTIONS_ROOT}/ run on Deno. The correct,
production-appropriate type-check for them is:

    deno check --config ${CONFIG} --node-modules-dir=none <sources>

The \`Deno\` global and the \`npm:\` / \`jsr:\` import specifiers this code uses
are resolved by the Deno runtime. They are NOT source-code defects, and this
boundary deliberately does not fall back to \`tsc\` (which would misreport them
as TS2304 / TS2307).

Install Deno to run this check. Any of these work:

    npm  i -g deno                       # no privileged install needed
    curl -fsSL https://deno.land/install.sh | sh
    brew install deno

Then re-run: npm run typecheck:api
`,
  );
  process.exit(1);
}

if (!existsSync(CONFIG)) {
  process.stderr.write(`typecheck:api — BLOCKED: ${CONFIG} is missing.\n`);
  process.exit(1);
}

const requested = process.argv.find((arg) => arg.startsWith('--boundary='))?.split('=')[1];
const all = collectSources(FUNCTIONS_ROOT);
const boundaries =
  requested === 'ai'
    ? [{ name: 'ai', files: all.filter(isAiFile) }]
    : [
        { name: 'ai', files: all.filter(isAiFile) },
        { name: 'server', files: all.filter((file) => !isAiFile(file)) },
      ];

let failed = 0;
for (const boundary of boundaries) {
  if (boundary.files.length === 0) continue;
  process.stdout.write(
    `\n── deno check [${boundary.name}] — ${boundary.files.length} file(s) ──\n`,
  );
  const result = spawnSync(
    'deno',
    ['check', '--config', CONFIG, '--node-modules-dir=none', ...boundary.files],
    { stdio: 'inherit' },
  );
  const status = result.status ?? 1;
  process.stdout.write(`[${boundary.name}] exit ${status}\n`);
  if (status !== 0) failed += 1;
}

process.exit(failed === 0 ? 0 : 1);
