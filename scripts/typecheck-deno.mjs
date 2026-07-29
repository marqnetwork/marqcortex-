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
 * such.
 *
 * This script runs `deno check` when a Deno toolchain is available. When Deno
 * is absent it reports the missing-toolchain blocker explicitly and exits
 * non-zero, rather than falling back to `tsc` and emitting the false
 * diagnostics described above.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const FUNCTIONS_ROOT = 'supabase/functions';

function collectSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const probe = spawnSync('deno', ['--version'], { stdio: 'ignore' });
const denoAvailable = !probe.error && probe.status === 0;

if (!denoAvailable) {
  process.stderr.write(
`typecheck:api — BLOCKED: no Deno toolchain in this environment.

The Supabase Edge Functions under ${FUNCTIONS_ROOT}/ run on Deno. The correct,
production-appropriate type-check for them is:

    deno check ${FUNCTIONS_ROOT}/**/*.ts ${FUNCTIONS_ROOT}/**/*.tsx

The \`Deno\` global and the \`npm:\` / \`jsr:\` import specifiers this code uses
are resolved by the Deno runtime. They are NOT source-code defects, and this
boundary deliberately does not fall back to \`tsc\` (which would misreport them
as TS2304 / TS2307).

To run this check, use a Deno-enabled environment — install Deno
(https://deno.com) or run inside the Supabase functions toolchain — then
re-run: npm run typecheck:api
`
  );
  process.exit(1);
}

const sources = collectSources(FUNCTIONS_ROOT);
process.stdout.write(`deno check — ${sources.length} file(s) under ${FUNCTIONS_ROOT}/\n`);
const check = spawnSync('deno', ['check', ...sources], { stdio: 'inherit' });
process.exit(check.status ?? 1);
