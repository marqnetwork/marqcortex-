/**
 * A2 Gate W prerequisite 2 — `scripts/a2-gatew-corridor.ts`, the operator's
 * secret-mutation path, driven against a FAKE Supabase CLI that keeps secrets
 * the way the Management API reports them (name + SHA-256 digest) and records
 * every invocation. No network, no hosted anything.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMBINED_ROLLBACK_SEQUENCE,
  RUNTIME_PERSISTENCE_CORRIDOR,
} from '../../supabase/functions/server/ai/persistence/runtimeCutoverPlan.ts';
import {
  composeRuntimePersistence,
  describeRuntimePersistence,
} from '../../supabase/functions/server/ai/persistence/runtimePersistenceComposition.ts';
import { recordEnv } from '../../supabase/functions/server/ai/runtime/env.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'a2-gatew-corridor.ts');
const HEAD = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: ROOT }).stdout.trim();

const FAKE_CLI = `
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const state = process.env.FAKE_STATE;
const args = process.argv.slice(2);
appendFileSync(state + '.log', JSON.stringify(args) + '\\n');
const secrets = JSON.parse(readFileSync(state, 'utf8'));
const fails = (process.env.FAKE_FAIL ?? '').split(',');
if (fails.includes(args[0] + ' ' + args[1])) { console.error('fake failure'); process.exit(1); }
if (args[0] === 'secrets' && args[1] === 'list') {
  console.log(JSON.stringify(Object.entries(secrets).map(([name, value]) => ({ name, value: createHash('sha256').update(value).digest('hex') }))));
} else if (args[0] === 'secrets' && args[1] === 'set') {
  const [name, ...rest] = args[2].split('='); secrets[name] = rest.join('=');
} else if (args[0] === 'secrets' && args[1] === 'unset') {
  if (!args[2] || args[2].startsWith('-')) { for (const k of Object.keys(secrets)) delete secrets[k]; } else delete secrets[args[2]];
} else if (!(args[0] === 'functions' && args[1] === 'deploy')) { process.exit(2); }
writeFileSync(state, JSON.stringify(secrets));
`;

function harness(initial: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'a2-corridor-'));
  const fake = join(dir, 'fake-supabase.mjs');
  const state = join(dir, 'secrets.json');
  writeFileSync(fake, FAKE_CLI);
  writeFileSync(state, JSON.stringify({ OTHER_SECRET: 'keep-me', ...initial }));
  writeFileSync(`${state}.log`, '');
  const run = (args: string[], extra: Record<string, string> = {}) =>
    spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, A2_SUPABASE_CLI: JSON.stringify([process.execPath, fake]), FAKE_STATE: state, ...extra },
    });
  const secrets = () => JSON.parse(readFileSync(state, 'utf8')) as Record<string, string>;
  const calls = () => readFileSync(`${state}.log`, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]);
  return { run, secrets, calls };
}
// Ports shaped as index.tsx supplies them; the boot line never touches them.
const KV_PORTS = {
  read: () => Promise.resolve(undefined),
  readByPrefix: () => Promise.resolve([]),
  compareAndSwap: () => Promise.resolve(false),
};
const pairArg = (pair: { workflow: string; agent: string }) => `${pair.workflow}/${pair.agent}`;
const clean = spawnSync('git', ['status', '--porcelain', '--', 'supabase/functions', 'supabase/config.toml'], { encoding: 'utf8', cwd: ROOT }).stdout.trim() === '';

describe('A2 Gate W — the operator corridor step script', () => {
  it('status at the baseline: both unset reads kv/kv, corridor state 1/7', () => {
    const h = harness();
    const out = h.run(['status']);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /current pair kv\/kv — corridor state 1\/7/);
  });

  it('the boot line it tells the operator to look for is the one the runtime logs, for every corridor pair', () => {
    for (const pair of RUNTIME_PERSISTENCE_CORRIDOR) {
      const initial: Record<string, string> = {};
      if (pair.workflow !== 'kv') initial.AI_WORKFLOW_PERSISTENCE = pair.workflow;
      if (pair.agent !== 'kv') initial.AI_AGENT_PERSISTENCE = pair.agent;
      const out = harness(initial).run(['status']);
      const actual = describeRuntimePersistence(
        composeRuntimePersistence({
          env: recordEnv({ AI_WORKFLOW_PERSISTENCE: pair.workflow, AI_AGENT_PERSISTENCE: pair.agent }),
          kv: { workflow: KV_PORTS, agent: KV_PORTS },
          sqlGateway: { rpc: () => Promise.resolve([]) },
          tenant: { defaultOrganizationId: 'marq-cortex', allowDefaultOrganization: false },
        }),
      );
      assert.ok(out.stdout.includes(`expected boot line: ${actual}`), `${pairArg(pair)}: ${out.stdout}`);
    }
  });

  it('dry run: prints the exact commands and changes nothing', () => {
    const h = harness();
    const out = h.run(['step', 'kv_frozen/kv']);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /secrets set AI_WORKFLOW_PERSISTENCE=kv_frozen --project-ref oqybniefkbppptfatoae/);
    assert.match(out.stdout, /functions deploy make-server-324f4fbe --project-ref oqybniefkbppptfatoae --no-verify-jwt/);
    assert.match(out.stdout, /DRY RUN/);
    assert.deepEqual(h.calls().map((c) => `${c[0]} ${c[1]}`), ['secrets list']);
    assert.deepEqual(h.secrets(), { OTHER_SECRET: 'keep-me' });
  });

  it('refuses a non-adjacent step, an off-corridor target, and a wrong commit — before any mutation', () => {
    const h = harness();
    assert.match(h.run(['step', 'kv_frozen/kv_frozen']).stderr, /not one corridor step/);
    assert.match(h.run(['step', 'sql/kv']).stderr, /not on the reviewed corridor/);
    assert.match(h.run(['step', 'kv_frozen/kv', '--execute', '--commit', '0000000']).stderr, /is not the approved commit/);
    assert.match(h.run(['step', 'kv_frozen/kv', '--execute']).stderr, /needs --commit/);
    assert.ok(h.calls().every((c) => c[1] === 'list'));
    assert.deepEqual(h.secrets(), { OTHER_SECRET: 'keep-me' });
  });

  it('refuses a current value that is not a mode (the runtime would refuse it too)', () => {
    const out = harness({ AI_AGENT_PERSISTENCE: 'sq1' }).run(['status']);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /AI_AGENT_PERSISTENCE is set to a value whose digest is not any mode/);
  });

  it('forward walk kv/kv -> sql/sql then the reverse walk back to kv/kv, one secret and one redeploy per step', { skip: !clean && 'function source has local changes' }, () => {
    const h = harness();
    const walk = [...RUNTIME_PERSISTENCE_CORRIDOR.slice(1), ...COMBINED_ROLLBACK_SEQUENCE.slice(1)];
    let previous = RUNTIME_PERSISTENCE_CORRIDOR[0];
    for (const pair of walk) {
      const moved = previous.workflow !== pair.workflow ? pair.workflow : pair.agent;
      previous = pair;
      const before = h.calls().length;
      const out = h.run(['step', pairArg(pair), '--execute', '--commit', HEAD]);
      assert.equal(out.status, 0, `${pairArg(pair)}: ${out.stderr}`);
      assert.match(out.stdout, new RegExp(`✓ secrets read ${pairArg(pair)}`));
      const calls = h.calls().slice(before);
      assert.deepEqual(calls.map((c) => `${c[0]} ${c[1]}`), ['secrets list', `secrets ${moved === 'kv' ? 'unset' : 'set'}`, 'functions deploy', 'secrets list']);
      assert.ok(calls[2].includes('--no-verify-jwt') && calls[2].includes('make-server-324f4fbe'));
      if (calls[1][1] === 'unset') {
        // BY NAME, always: `secrets unset` with no name removes every secret.
        assert.match(calls[1][2], /^AI_(WORKFLOW|AGENT)_PERSISTENCE$/);
      }
    }
    // Back at the baseline: both secrets gone, nothing else touched.
    assert.deepEqual(h.secrets(), { OTHER_SECRET: 'keep-me' });
  });

  it('a failed redeploy stops loudly with the secret changed, and says what to do', { skip: !clean && 'function source has local changes' }, () => {
    const h = harness();
    const out = h.run(['step', 'kv_frozen/kv', '--execute', '--commit', HEAD], { FAKE_FAIL: 'functions deploy' });
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /redeploy FAILED/);
    assert.equal(h.secrets().AI_WORKFLOW_PERSISTENCE, 'kv_frozen');
    // …and the state it left is a corridor state the next status reads.
    assert.match(h.run(['status']).stdout, /kv_frozen\/kv — corridor state 2\/7/);
  });

});
