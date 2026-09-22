/**
 * A2-P06-C04 — the cutover verifier: every check can fail on its own, and an
 * unobserved fact is a failure, never a pass.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { observationFromRecheck, verifyCutover, type CutoverObservation } from '../persistence/runtimeCutoverVerifier.ts';

const ZERO = { runs: 0, checkpoints: 0, approvals: 0 };
const PRE: CutoverObservation = {
  domain: 'workflow',
  stage: 'pre',
  mode: 'kv_frozen',
  kvEstate: ZERO,
  sqlEstate: ZERO,
  schema: { tablesRlsForced: ['workflow_runs', 'workflow_checkpoints', 'workflow_approvals'], functions: 12 },
  tenantConfiguration: { defaultOrganizationId: 'marq-cortex', allowDefaultOrganization: false },
};
const POST: CutoverObservation = { domain: 'agent', stage: 'post', mode: 'sql_frozen', kvEstate: ZERO, sqlEstate: ZERO, sqlReadSucceeded: true };
const LIVE: CutoverObservation = { domain: 'agent', stage: 'live', mode: 'sql', liveness: [{ step: 'create', ok: true }, { step: 'spend once', ok: true }] };

const failing = (observation: CutoverObservation) => {
  const verdict = verifyCutover(observation);
  return { verdict: verdict.verdict, failed: verdict.checks.filter((c) => !c.ok).map((c) => c.name) };
};

describe('A2-P06-C04 — GO only when every check passes', () => {
  it('the clean observation for each stage is GO', () => {
    for (const observation of [PRE, POST, LIVE]) assert.equal(verifyCutover(observation).verdict, 'GO');
  });

  it('PRE: each defect alone is NO_GO, naming exactly its check', () => {
    const cases: [Partial<CutoverObservation>, string][] = [
      [{ mode: 'kv' }, 'mode'],
      [{ kvEstate: { ...ZERO, runs: 1 } }, 'kv_estate_zero'],
      [{ sqlEstate: { ...ZERO, approvals: 1 } }, 'sql_estate_zero'],
      [{ schema: { tablesRlsForced: ['workflow_runs', 'workflow_checkpoints'], functions: 12 } }, 'tables_rls_forced'],
      [{ schema: { tablesRlsForced: PRE.schema!.tablesRlsForced, functions: 11 } }, 'functions_present'],
      [{ tenantConfiguration: { defaultOrganizationId: 'marq-cortex', allowDefaultOrganization: true } }, 'tenant_configuration'],
    ];
    for (const [change, check] of cases) {
      assert.deepEqual(failing({ ...PRE, ...change }), { verdict: 'NO_GO', failed: [check] }, check);
    }
  });

  it('PRE: the agent domain requires the AGENT tables, not the workflow ones', () => {
    assert.deepEqual(failing({ ...PRE, domain: 'agent' }).failed, ['tables_rls_forced']);
  });

  it('an observation that was never made fails; it is never assumed', () => {
    const blind = failing({ domain: 'workflow', stage: 'pre', mode: 'kv_frozen' });
    assert.deepEqual(blind.failed, ['kv_estate_zero', 'sql_estate_zero', 'tables_rls_forced', 'functions_present', 'tenant_configuration']);
    assert.deepEqual(failing({ ...POST, sqlReadSucceeded: undefined }).failed, ['sql_reached']);
    assert.deepEqual(failing({ ...LIVE, liveness: [] }).failed, ['liveness']);
  });

  it('POST: a KV or SQL write after the freeze is NO_GO', () => {
    assert.deepEqual(failing({ ...POST, kvEstate: { ...ZERO, checkpoints: 1 } }).failed, ['kv_estate_zero']);
    assert.deepEqual(failing({ ...POST, sqlEstate: { ...ZERO, runs: 1 } }).failed, ['sql_estate_zero']);
    assert.deepEqual(failing({ ...POST, mode: 'sql' }).failed, ['mode']);
  });

  it('LIVE: one failed step is NO_GO and is named', () => {
    const verdict = verifyCutover({ ...LIVE, liveness: [...LIVE.liveness!, { step: 'cross-tenant invisible', ok: false }] });
    assert.equal(verdict.verdict, 'NO_GO');
    assert.match(verdict.checks.find((c) => c.name === 'liveness')!.detail, /cross-tenant invisible/);
  });

  it('a fingerprint divergence is NO_GO with no exception list to grow', () => {
    assert.deepEqual(failing({ ...PRE, fingerprints: { source: 'a', target: 'b' } }).failed, ['fingerprints_equal']);
    assert.equal(verifyCutover({ ...PRE, fingerprints: { source: 'a', target: 'a' } }).verdict, 'GO');
  });
});

describe('A2-P06-C04 — from the hosted recheck JSON', () => {
  const recheck = {
    check: 'a2-zero-estate-recheck',
    verdict: 'ZERO_ESTATE',
    kv: { workflow: { runs: 0, checkpoints: 0, approvals: 0 }, agent: { runs: 0, checkpoints: 0, approvals: 0 }, inspected: 73 },
    sql: { workflow_runs: 0, workflow_checkpoints: 0, workflow_approvals: 0, agent_runs: null, agent_checkpoints: null, agent_approvals: null },
    schema: { tables_rls_forced: ['workflow_approvals', 'workflow_checkpoints', 'workflow_runs'], workflow_functions: 12, agent_functions: 0 },
  };

  it('turns a clean recheck into a GO pre-cutover observation for the domain that is ready', () => {
    const observation = { ...PRE, ...observationFromRecheck(JSON.stringify(recheck), 'workflow') };
    assert.equal(verifyCutover(observation).verdict, 'GO');
  });

  it('reports the agent domain NOT ready when its migrations are not applied', () => {
    const observation = { ...PRE, domain: 'agent' as const, ...observationFromRecheck(recheck, 'agent') };
    assert.deepEqual(failing(observation).failed, ['tables_rls_forced', 'functions_present']);
  });

  it('turns INCONCLUSIVE_ROW_SECURITY into unobserved estates, which fail', () => {
    const observation = { domain: 'workflow' as const, stage: 'pre' as const, mode: 'kv_frozen' as const, tenantConfiguration: PRE.tenantConfiguration, ...observationFromRecheck({ ...recheck, verdict: 'INCONCLUSIVE_ROW_SECURITY' }, 'workflow') };
    assert.ok(failing(observation).failed.includes('kv_estate_zero'));
    assert.ok(failing(observation).failed.includes('sql_estate_zero'));
  });

  it('treats a malformed count as unobserved, never as zero', () => {
    const broken = { ...recheck, kv: { ...recheck.kv, workflow: { runs: '0', checkpoints: 0, approvals: 0 } } };
    assert.equal(observationFromRecheck(broken, 'workflow').kvEstate, undefined);
    const nulled = { ...recheck, kv: { ...recheck.kv, workflow: { runs: null, checkpoints: 0, approvals: 0 } } };
    assert.equal(observationFromRecheck(nulled, 'workflow').kvEstate, undefined, 'a null KV count is not zero');
    const noFunctions = { ...recheck, schema: { ...recheck.schema, workflow_functions: null } };
    assert.equal(observationFromRecheck(noFunctions, 'workflow').schema, undefined);
  });
});
