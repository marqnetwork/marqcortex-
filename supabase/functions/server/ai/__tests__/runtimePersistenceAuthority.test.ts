/**
 * A2-P06-C01 — the runtime persistence transition controller, exhaustively.
 *
 * Sixteen edges per domain, two domains, and every one asserted: a controller
 * whose refusals are tested only for the edges somebody thought of is a
 * controller with untested permissions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  RUNTIME_PERSISTENCE_DOMAINS,
  RUNTIME_PERSISTENCE_MODES,
  authorityOf,
  parseRuntimePersistenceMode,
  planTransition,
  tenantConfigurationProblem,
  writesAllowed,
  type RuntimePersistenceMode,
  type TransitionEvidence,
} from '../persistence/runtimePersistenceAuthority.ts';

const ZERO = { runs: 0, checkpoints: 0, approvals: 0 };
const CANONICAL = '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0';
const FULL: TransitionEvidence = {
  kvEstate: ZERO,
  sqlEstate: ZERO,
  sqlSchemaPresent: true,
  tenantConfiguration: { defaultOrganizationId: 'marq-cortex', allowDefaultOrganization: false },
  postCutoverVerified: true,
};

/** The permitted edges, and nothing else. */
const PERMITTED = new Set([
  'kv->kv_frozen',
  'kv_frozen->kv',
  'kv_frozen->sql_frozen',
  'sql_frozen->sql',
  'sql->sql_frozen',
  'sql_frozen->kv_frozen',
]);

describe('A2-P06-C01 — modes', () => {
  it('unset is KV, the production truth today', () => {
    for (const domain of RUNTIME_PERSISTENCE_DOMAINS) {
      assert.deepEqual(parseRuntimePersistenceMode(domain, undefined), { ok: true, mode: 'kv' });
      assert.deepEqual(parseRuntimePersistenceMode(domain, '  '), { ok: true, mode: 'kv' });
    }
  });

  it('an unrecognised value is refused, never read as a default', () => {
    for (const raw of ['sqll', 'SQL', 'true', '1', 'kv,sql', 'postgres']) {
      const verdict = parseRuntimePersistenceMode('workflow', raw);
      assert.equal(verdict.ok, false, raw);
      assert.match(!verdict.ok ? verdict.problem : '', /AI_WORKFLOW_PERSISTENCE/);
    }
  });

  it('every mode has exactly one authority, and only the unfrozen ones write', () => {
    assert.deepEqual(RUNTIME_PERSISTENCE_MODES.map(authorityOf), ['kv', 'kv', 'sql', 'sql']);
    assert.deepEqual(RUNTIME_PERSISTENCE_MODES.map(writesAllowed), [true, false, false, true]);
  });
});

describe('A2-P06-C01 — the transition matrix', () => {
  for (const domain of RUNTIME_PERSISTENCE_DOMAINS) {
    for (const from of RUNTIME_PERSISTENCE_MODES) {
      for (const to of RUNTIME_PERSISTENCE_MODES) {
        const edge = `${from}->${to}`;
        it(`${domain}: ${edge} ${from === to ? 'is an idempotent no-op' : PERMITTED.has(edge) ? 'is permitted with full evidence' : 'is refused even with full evidence'}`, () => {
          const verdict = planTransition(domain, from, to, FULL);
          if (from === to) {
            assert.deepEqual(verdict, { allowed: true, noop: true, authorityAfter: authorityOf(to) });
          } else if (PERMITTED.has(edge)) {
            assert.equal(verdict.allowed, true);
          } else {
            assert.equal(verdict.allowed, false);
            assert.equal(!verdict.allowed && verdict.code, 'EDGE_NOT_PERMITTED');
          }
        });
      }
    }
  }

  it('never changes authority on an edge that allows writes on both sides', () => {
    for (const from of RUNTIME_PERSISTENCE_MODES) {
      for (const to of RUNTIME_PERSISTENCE_MODES) {
        const verdict = planTransition('workflow', from, to, FULL);
        if (verdict.allowed && !verdict.noop && authorityOf(from) !== authorityOf(to)) {
          assert.equal(writesAllowed(from), false, `${from}->${to} changes authority while writing`);
          assert.equal(writesAllowed(to), false, `${from}->${to} changes authority into a writing mode`);
        }
      }
    }
  });
});

describe('A2-P06-C01 — the cutover edge demands the zero-estate recheck', () => {
  const cut = (evidence: TransitionEvidence) => planTransition('workflow', 'kv_frozen', 'sql_frozen', evidence);

  it('ABORTS the zero-backfill strategy if the KV source holds any runtime row', () => {
    for (const kvEstate of [{ ...ZERO, runs: 1 }, { ...ZERO, checkpoints: 1 }, { ...ZERO, approvals: 1 }]) {
      const verdict = cut({ ...FULL, kvEstate });
      assert.equal(verdict.allowed, false);
      assert.equal(!verdict.allowed && verdict.code, 'ABORT_ZERO_BACKFILL_STRATEGY');
      assert.match(!verdict.allowed ? verdict.reasons[0] : '', /nothing is dropped or copied/);
    }
  });

  it('aborts if SQL already holds rows before it was given authority', () => {
    const verdict = cut({ ...FULL, sqlEstate: { ...ZERO, runs: 2 } });
    assert.equal(!verdict.allowed && verdict.code, 'ABORT_ZERO_BACKFILL_STRATEGY');
  });

  it('refuses without the recheck, without the schema, or without a safe tenant configuration', () => {
    assert.equal(!cut({ ...FULL, kvEstate: undefined }).allowed && (cut({ ...FULL, kvEstate: undefined }) as { code: string }).code, 'EVIDENCE_MISSING');
    const noSchema = cut({ ...FULL, sqlSchemaPresent: false });
    assert.equal(!noSchema.allowed && noSchema.code, 'SCHEMA_ABSENT');
    const unsafe = cut({ ...FULL, tenantConfiguration: { defaultOrganizationId: 'marq-cortex', allowDefaultOrganization: true } });
    assert.equal(!unsafe.allowed && unsafe.code, 'TENANT_CONFIGURATION_UNSAFE');
    const noTenant = cut({ ...FULL, tenantConfiguration: undefined });
    assert.equal(!noTenant.allowed && noTenant.code, 'EVIDENCE_MISSING');
  });

  it('accepts the hosted configuration as recorded: slug default, fallback OFF', () => {
    assert.equal(cut(FULL).allowed, true);
  });

  it('accepts an enabled default only when it is the canonical UUID', () => {
    assert.equal(cut({ ...FULL, tenantConfiguration: { defaultOrganizationId: CANONICAL, allowDefaultOrganization: true } }).allowed, true);
    assert.equal(tenantConfigurationProblem({ defaultOrganizationId: CANONICAL, allowDefaultOrganization: true }), undefined);
  });
});

describe('A2-P06-C01 — unfreezing SQL and rolling back', () => {
  it('SQL is not unfrozen until the post-cutover verification passed', () => {
    const verdict = planTransition('agent', 'sql_frozen', 'sql', { ...FULL, postCutoverVerified: false });
    assert.equal(!verdict.allowed && verdict.code, 'NOT_VERIFIED');
  });

  it('rolls back only while SQL holds nothing — after that the window is closed', () => {
    assert.equal(planTransition('workflow', 'sql_frozen', 'kv_frozen', { sqlEstate: ZERO }).allowed, true);
    const closed = planTransition('workflow', 'sql_frozen', 'kv_frozen', { sqlEstate: { ...ZERO, runs: 1 } });
    assert.equal(!closed.allowed && closed.code, 'ROLLBACK_WINDOW_CLOSED');
    const blind = planTransition('workflow', 'sql_frozen', 'kv_frozen', {});
    assert.equal(!blind.allowed && blind.code, 'EVIDENCE_MISSING');
  });

  it('is deterministic: the same question always gets the same answer', () => {
    const modes: RuntimePersistenceMode[] = [...RUNTIME_PERSISTENCE_MODES];
    const once = modes.flatMap((a) => modes.map((b) => JSON.stringify(planTransition('agent', a, b, FULL))));
    const twice = modes.flatMap((a) => modes.map((b) => JSON.stringify(planTransition('agent', a, b, FULL))));
    assert.deepEqual(once, twice);
  });
});
