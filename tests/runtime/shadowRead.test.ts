/**
 * Runtime Storage Gateway — shadow-read validation (MCV2-S7.5 / S7.8)
 *
 * Exercises the pure gateway + drift primitives under node. Verifies the
 * contract that guarantees no regression when backend reads are enabled:
 *   - the authority (KV) value is always returned unchanged;
 *   - the shadow read is never invoked while disabled;
 *   - drift and presence mismatches are detected and reported;
 *   - a throwing shadow read is swallowed and reported, never propagated.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shadowRead,
  shadowReadWithReport,
} from '../../supabase/functions/server/runtime/gateway.ts';
import { diffProjections } from '../../supabase/functions/server/runtime/drift.ts';
import {
  projectOutcomeKv,
  projectOutcomeSql,
  projectLeadExistenceKv,
  projectLeadExistenceSql,
  projectSubmissionKv,
  projectSubmissionSql,
} from '../../supabase/functions/server/runtime/drift.ts';

const idProject = (v: unknown) => (v as Record<string, unknown> | null);

describe('shadowRead — authority preservation', () => {
  it('returns the authority value unchanged when disabled and never calls shadow', async () => {
    let shadowCalls = 0;
    const value = await shadowRead({
      domain: 'outcome',
      key: 'sub-1',
      enabled: false,
      readAuthority: () => ({ submissionId: 'sub-1', didConvert: true, conversionValue: 100 }),
      readShadow: () => { shadowCalls++; return null; },
      projectAuthority: projectOutcomeKv,
      projectShadow: projectOutcomeSql,
    });
    assert.deepEqual(value, { submissionId: 'sub-1', didConvert: true, conversionValue: 100 });
    assert.equal(shadowCalls, 0);
  });

  it('returns the authority value unchanged even when the shadow differs', async () => {
    const { value, report } = await shadowReadWithReport({
      domain: 'outcome',
      key: 'sub-1',
      enabled: true,
      readAuthority: () => ({ submissionId: 'sub-1', didConvert: true, conversionValue: 100 }),
      readShadow: () => ({ submission_id: 'sub-1', value: { didConvert: false, conversionValue: 0 } }),
      projectAuthority: projectOutcomeKv,
      projectShadow: (r) => projectOutcomeSql(idProject(r)),
    });
    // Caller still sees KV truth.
    assert.deepEqual(value, { submissionId: 'sub-1', didConvert: true, conversionValue: 100 });
    // Drift is surfaced for validation.
    assert.equal(report.status, 'drift');
    const changed = report.fields.map((f) => f.field).sort();
    assert.deepEqual(changed, ['conversionValue', 'didConvert']);
  });
});

describe('shadowRead — drift + telemetry', () => {
  it('reports match when projections agree', async () => {
    const reports: string[] = [];
    const { report } = await shadowReadWithReport({
      domain: 'submission',
      key: 'sub-9',
      enabled: true,
      readAuthority: () => ({ id: 'sub-9', status: 'new', company: 'Acme', email: 'a@acme.test', aiScore: 80 }),
      readShadow: () => ({
        legacy_id: 'sub-9', status: 'new', company_name: 'Acme',
        contact_email: 'a@acme.test', ai_score: 80,
      }),
      projectAuthority: projectSubmissionKv,
      projectShadow: (r) => projectSubmissionSql(idProject(r)),
      telemetry: (rep) => reports.push(rep.status),
    });
    assert.equal(report.status, 'match');
    // consoleTelemetry suppresses matches; a custom sink still receives them.
    assert.deepEqual(reports, ['match']);
  });

  it('flags a presence mismatch as missing', async () => {
    const { report } = await shadowReadWithReport({
      domain: 'submission',
      key: 'sub-x',
      enabled: true,
      readAuthority: () => ({ id: 'sub-x', status: 'new', company: 'Acme', email: 'a@acme.test', aiScore: 5 }),
      readShadow: () => null,
      projectAuthority: projectSubmissionKv,
      projectShadow: (r) => projectSubmissionSql(idProject(r)),
    });
    assert.equal(report.status, 'missing');
    assert.equal(report.authorityPresent, true);
    assert.equal(report.shadowPresent, false);
  });
});

describe('shadowRead — error isolation (no regression)', () => {
  it('swallows a throwing shadow read, returns authority, reports shadow_error', async () => {
    const captured: string[] = [];
    const { value, report } = await shadowReadWithReport({
      domain: 'lead',
      key: 'jane@example.test',
      enabled: true,
      readAuthority: () => 'lead_123',
      readShadow: () => { throw new Error('db unreachable'); },
      projectAuthority: (v) => projectLeadExistenceKv(v as string | null),
      projectShadow: (r) => projectLeadExistenceSql(idProject(r)),
      telemetry: (rep) => captured.push(rep.status),
    });
    assert.equal(value, 'lead_123');
    assert.equal(report.status, 'shadow_error');
    assert.equal(report.error, 'db unreachable');
    assert.deepEqual(captured, ['shadow_error']);
  });
});

describe('diffProjections / projectors', () => {
  it('lead existence agrees when both sides have the lead', () => {
    const rep = diffProjections(
      'lead', 'jane@example.test',
      projectLeadExistenceKv('lead_1'),
      projectLeadExistenceSql({ id: 'uuid', email: 'jane@example.test' }),
    );
    assert.equal(rep.status, 'match');
  });

  it('lead existence drifts when KV has it but SQL does not', () => {
    const rep = diffProjections(
      'lead', 'jane@example.test',
      projectLeadExistenceKv('lead_1'),
      projectLeadExistenceSql(null),
    );
    assert.equal(rep.status, 'drift');
    assert.deepEqual(rep.fields.map((f) => f.field), ['exists']);
  });

  it('outcome projectors normalize KV and SQL to the same shape', () => {
    const kv = projectOutcomeKv({ submissionId: 's', didConvert: true, conversionValue: 500, extra: 'ignored' });
    const sql = projectOutcomeSql({ submission_id: 's', value: { didConvert: true, conversionValue: 500 } });
    assert.deepEqual(kv, sql);
  });

  it('both-absent is a match, not a mismatch', () => {
    const rep = diffProjections('outcome', 's', null, null);
    assert.equal(rep.status, 'match');
  });
});
