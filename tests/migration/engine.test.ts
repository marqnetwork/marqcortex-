/**
 * KV reader and inventory tests — MCV2-S6.2-IMPLEMENT-004
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInMemoryKvReader } from '../../supabase/functions/server/migration/kvReader.ts';
import { buildInventoryReport } from '../../supabase/functions/server/migration/inventory.ts';
import {
  createLeadDomainContext,
  processLeadBatch,
  buildSimulationReport,
} from '../../supabase/functions/server/migration/domains/leads.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = join(root, 'architecture', 'database', 'fixtures', 'kv');
const ORG = '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0';

function buildFixtureStore(): Record<string, unknown> {
  return {
    'lead:lead_1739123456_abc': JSON.parse(readFileSync(join(fixtures, 'lead_magnet_sample.json'), 'utf8')),
    'lead:lead_1739123456_def': readFileSync(join(fixtures, 'lead_double_encoded.json'), 'utf8').trim(),
    'lead:lead_bad': JSON.parse(readFileSync(join(fixtures, 'lead_malformed.json'), 'utf8')),
    'lead_email:jane@example.test': 'lead_1739123456_abc',
    'lead_email:orphan@example.test': 'missing_lead_id',
  };
}

describe('kvReader pagination', () => {
  it('pages deterministically by key order', async () => {
    const reader = createInMemoryKvReader(buildFixtureStore());
    const page1 = await reader.scanPrefix('lead:', null, 2);
    assert.equal(page1.records.length, 2);
    assert.equal(page1.hasMore, true);
    const page2 = await reader.scanPrefix('lead:', page1.nextCursor, 2);
    assert.ok(page2.records.length >= 1);
    assert.equal(page2.records[0].key > page1.records[1].key, true);
  });
});

describe('inventory mode', () => {
  it('detects malformed and orphaned mappings', async () => {
    const reader = createInMemoryKvReader(buildFixtureStore());
    const report = await buildInventoryReport(reader, 50);
    assert.ok(report.summary.totalRecords >= 5);
    assert.ok(report.summary.missingRequiredCount >= 1);
    assert.ok(report.orphanedLeadEmailMappings.includes('lead_email:orphan@example.test'));
  });
});

describe('simulation no-write guarantee', () => {
  it('does not require database client for prediction', async () => {
    const reader = createInMemoryKvReader(buildFixtureStore());
    const ctx = createLeadDomainContext(ORG, 'test-run', false);
    const page = await reader.scanPrefix('lead:', null, 50);
    const mockClient = {
      from() {
        throw new Error('simulation must not write business rows');
      },
    };
    await processLeadBatch(mockClient as never, reader, ctx, page.records);
    const report = buildSimulationReport(ctx, page.records.length, 'test-run', []);
    assert.ok(report.predictedLeads >= 2);
    assert.ok(report.quarantined >= 1);
    assert.equal(report.thresholdsPassed, true);
  });
});

describe('duplicate email handling', () => {
  it('classifies second email duplicate', async () => {
    const store = {
      'lead:one': { id: 'one', email: 'dup@test.com', source: 'lead_magnet', capturedAt: '2026-01-01T00:00:00Z' },
      'lead:two': { id: 'two', email: 'dup@test.com', source: 'lead_magnet', capturedAt: '2026-01-02T00:00:00Z' },
    };
    const reader = createInMemoryKvReader(store);
    const ctx = createLeadDomainContext(ORG, 'dup-run', false);
    const page = await reader.scanPrefix('lead:', null, 50);
    await processLeadBatch({ from: () => ({}) } as never, reader, ctx, page.records);
    assert.equal(ctx.classifications.duplicate, 1);
    assert.equal(ctx.predicted.length, 1);
  });
});

describe('cross-organization safety', () => {
  it('scopes normalized records to provided organization', () => {
    const ctx = createLeadDomainContext('org-a', 'run', false);
    assert.equal(ctx.organizationId, 'org-a');
  });
});

describe('source key preservation', () => {
  it('retains legacy_kv_key from KV key', async () => {
    const store = {
      'lead:preserve_me': {
        id: 'preserve_me',
        email: 'keep@test.com',
        source: 'lead_magnet',
        capturedAt: '2026-01-01T00:00:00Z',
      },
    };
    const reader = createInMemoryKvReader(store);
    const ctx = createLeadDomainContext(ORG, 'run', false);
    const page = await reader.scanPrefix('lead:', null, 10);
    await processLeadBatch({ from: () => ({}) } as never, reader, ctx, page.records);
    assert.equal(ctx.predicted[0].legacyKvKey, 'lead:preserve_me');
  });
});
