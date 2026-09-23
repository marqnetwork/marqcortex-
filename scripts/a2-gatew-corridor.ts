/**
 * A2 Gate W prerequisite 2 — the operator's ONE step along the corridor.
 *
 *   node --experimental-strip-types scripts/a2-gatew-corridor.ts status
 *   node --experimental-strip-types scripts/a2-gatew-corridor.ts step <workflow>/<agent>
 *   node --experimental-strip-types scripts/a2-gatew-corridor.ts step <workflow>/<agent> --execute --commit <sha>
 *
 * Existing infrastructure only: the Supabase CLI the repo already uses
 * (`npm run supabase:deploy`; on Windows `scripts/supabase-cli.ps1`), the
 * project's existing Edge Function secrets, and the SAME Edge Function
 * `make-server-324f4fbe`. No configuration table, no new configuration system,
 * no mode written into source. The corridor it walks is imported from
 * `runtimeCutoverPlan.ts` — the one the runtime itself enforces — so the two
 * cannot drift, and the runtime still refuses any pair this script would not.
 *
 * WHAT `step` DOES, in order, and it stops at the first thing that is not so:
 *   1. refuses a config.toml that would push extra secrets
 *      (`[edge_runtime.secrets]`) or that no longer pins verify_jwt = false;
 *   2. with --execute: refuses unless HEAD is the approved --commit and the
 *      function source is clean, so every redeploy is the W3 code;
 *   3. reads the CURRENT pair from `secrets list` digests (absent = kv);
 *   4. refuses unless the target is the ADJACENT corridor state (forward or
 *      reverse): exactly one domain, exactly one edge;
 *   5. sets that one secret — or, for a return to kv, unsets it BY NAME
 *      (`secrets unset` with no name would remove every secret);
 *   6. redeploys make-server-324f4fbe with --no-verify-jwt (the pinned posture);
 *   7. re-reads the pair and refuses to report success unless it is the target;
 *   8. prints the boot line the operator must then SEE in the function log.
 *
 * Without --execute it prints the exact commands and changes nothing.
 * Mixed isolates during a step serve two ADJACENT corridor states, which the
 * corridor makes safe by construction (one domain, one edge); the first
 * freeze's in-flight window is why W4.3 waits before the final recheck.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RUNTIME_PERSISTENCE_CORRIDOR,
  type RuntimePersistencePair,
} from '../supabase/functions/server/ai/persistence/runtimeCutoverPlan.ts';
import { RUNTIME_PERSISTENCE_MODES, type RuntimePersistenceMode } from '../supabase/functions/server/ai/persistence/runtimePersistenceAuthority.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'oqybniefkbppptfatoae';
const FUNCTION_SLUG = 'make-server-324f4fbe';
const SECRET = { workflow: 'AI_WORKFLOW_PERSISTENCE', agent: 'AI_AGENT_PERSISTENCE' } as const;

function fail(message: string): never {
  console.error(`✗ STOPPED: ${message}`);
  process.exit(1);
}

const cli: string[] = (() => {
  const raw = process.env.A2_SUPABASE_CLI;
  if (!raw) return ['supabase'];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((part) => typeof part === 'string')) return parsed;
  } catch {
    /* fall through */
  }
  return fail('A2_SUPABASE_CLI must be a JSON array, e.g. ["npx","supabase"]');
})();

function supabase(args: readonly string[]) {
  const run = spawnSync(cli[0], [...cli.slice(1), ...args], { encoding: 'utf8', cwd: ROOT, env: process.env });
  return { ok: run.status === 0, stdout: run.stdout ?? '', stderr: (run.stderr ?? '') + (run.error ? String(run.error) : '') };
}

const describe = (pair: RuntimePersistencePair) => `${pair.workflow}/${pair.agent}`;
const corridorIndex = (pair: RuntimePersistencePair) =>
  RUNTIME_PERSISTENCE_CORRIDOR.findIndex((p) => p.workflow === pair.workflow && p.agent === pair.agent);

/** The boot line `describeRuntimePersistence` logs for an on-corridor pair (pinned by test). */
function expectedBootLine(pair: RuntimePersistencePair): string {
  const part = (name: string, mode: RuntimePersistenceMode) =>
    `${name}=${mode} (authority ${mode.startsWith('sql') ? 'sql' : 'kv'}, ${mode.endsWith('_frozen') ? 'frozen' : 'writable'})`;
  return `[ai] runtime persistence: ${part('workflow', pair.workflow)} ${part('agent', pair.agent)} pair=on_corridor`;
}

// ── Preconditions that hold for every command ───────────────────────────────

const config = readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8');
if (/^\s*\[edge_runtime\.secrets\]/m.test(config)) {
  fail('supabase/config.toml has [edge_runtime.secrets]; `secrets set` would push those too');
}
const functionBlock = /\[functions\.make-server-324f4fbe\]([^[]*)/.exec(config)?.[1] ?? '';
if (!/^\s*verify_jwt\s*=\s*false\s*$/m.test(functionBlock)) {
  fail('supabase/config.toml no longer pins [functions.make-server-324f4fbe] verify_jwt = false');
}

// ── Reading the current pair ────────────────────────────────────────────────

const DIGESTS = new Map(RUNTIME_PERSISTENCE_MODES.map((mode) => [createHash('sha256').update(mode).digest('hex'), mode]));

function readPair(): RuntimePersistencePair {
  const listed = supabase(['secrets', 'list', '--project-ref', PROJECT_REF, '-o', 'json']);
  if (!listed.ok) fail(`secrets list failed: ${listed.stderr.trim()}`);
  let secrets: Array<{ name?: unknown; value?: unknown }>;
  try {
    secrets = JSON.parse(listed.stdout);
    if (!Array.isArray(secrets)) throw new Error('not an array');
  } catch {
    return fail('secrets list did not return a JSON array');
  }
  const modeOf = (name: string): RuntimePersistenceMode => {
    const entry = secrets.find((secret) => secret.name === name);
    if (entry === undefined) return 'kv'; // unset is kv — the production baseline
    const mode = DIGESTS.get(String(entry.value).toLowerCase());
    if (mode === undefined) {
      fail(`${name} is set to a value whose digest is not any mode's SHA-256; the runtime would refuse it — inspect before moving`);
    }
    return mode;
  };
  return { workflow: modeOf(SECRET.workflow), agent: modeOf(SECRET.agent) };
}

// ── Commands ────────────────────────────────────────────────────────────────

const [command, targetArgument, ...flags] = process.argv.slice(2);

if (command === 'status') {
  const pair = readPair();
  const index = corridorIndex(pair);
  console.log(`current pair ${describe(pair)} — ${index < 0 ? 'OFF CORRIDOR (the runtime refuses mutation in both domains)' : `corridor state ${index + 1}/7`}`);
  if (index >= 0) console.log(`expected boot line: ${expectedBootLine(pair)}`);
  process.exit(0);
}

if (command !== 'step' || !targetArgument) {
  fail('usage: a2-gatew-corridor.ts status | step <workflow>/<agent> [--execute --commit <sha>]');
}

const [workflowMode, agentMode] = targetArgument.split('/');
const target = { workflow: workflowMode, agent: agentMode } as RuntimePersistencePair;
const targetIndex = corridorIndex(target);
if (targetIndex < 0) fail(`${targetArgument} is not on the reviewed corridor`);

const execute = flags.includes('--execute');
if (execute) {
  const commit = flags[flags.indexOf('--commit') + 1];
  if (!flags.includes('--commit') || !commit) fail('--execute needs --commit <the approved commit>');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: ROOT }).stdout.trim();
  if (!head.startsWith(commit) || commit.length < 7) fail(`HEAD ${head} is not the approved commit ${commit}`);
  const dirty = spawnSync('git', ['status', '--porcelain', '--', 'supabase/functions', 'supabase/config.toml'], { encoding: 'utf8', cwd: ROOT }).stdout.trim();
  if (dirty !== '') fail(`the function source has local changes; a redeploy must be exactly ${commit}:\n${dirty}`);
}

const current = readPair();
const currentIndex = corridorIndex(current);
if (currentIndex < 0) fail(`the current pair ${describe(current)} is off the corridor; resolve it before any step`);
if (Math.abs(currentIndex - targetIndex) !== 1) {
  fail(`${describe(current)} -> ${describe(target)} is not one corridor step (states ${currentIndex + 1} -> ${targetIndex + 1})`);
}
const domain = (['workflow', 'agent'] as const).find((d) => current[d] !== target[d])!;
const name = SECRET[domain];
const mutation =
  target[domain] === 'kv'
    ? ['secrets', 'unset', name, '--project-ref', PROJECT_REF, '--yes']
    : ['secrets', 'set', `${name}=${target[domain]}`, '--project-ref', PROJECT_REF];
const deploy = ['functions', 'deploy', FUNCTION_SLUG, '--project-ref', PROJECT_REF, '--no-verify-jwt'];

console.log(`step ${describe(current)} -> ${describe(target)} (${currentIndex < targetIndex ? 'forward' : 'reverse'}; ${domain} moves ${current[domain]} -> ${target[domain]})`);
console.log(`  1. ${[...cli, ...mutation].join(' ')}`);
console.log(`  2. ${[...cli, ...deploy].join(' ')}`);
console.log(`  3. ${[...cli, 'secrets', 'list', '--project-ref', PROJECT_REF, '-o', 'json'].join(' ')}  (must read ${describe(target)})`);
if (!execute) {
  console.log('DRY RUN — nothing changed. Re-run with --execute --commit <approved sha>.');
  process.exit(0);
}

const setResult = supabase(mutation);
if (!setResult.ok) fail(`the secret change failed; nothing was redeployed; re-run status: ${setResult.stderr.trim()}`);
const deployResult = supabase(deploy);
if (!deployResult.ok) {
  fail(`the secret is changed but the redeploy FAILED — run status, then retry the deploy or reverse this step: ${deployResult.stderr.trim()}`);
}
const after = readPair();
if (describe(after) !== describe(target)) fail(`after the step the secrets read ${describe(after)}, not ${describe(target)}`);

console.log(`✓ secrets read ${describe(after)}; ${FUNCTION_SLUG} redeployed from ${flags[flags.indexOf('--commit') + 1]} with verify_jwt=false`);
console.log('OBSERVE before the next step: call GET /make-server-324f4fbe/health (boots an isolate of the new');
console.log('version), then in Dashboard → Edge Functions → make-server-324f4fbe → Logs find, for the NEW version:');
console.log(`  ${expectedBootLine(target)}`);
console.log('and NO "runtime persistence REFUSED" line.');
