/**
 * Lead normalizer tests — MCV2-S6.2-IMPLEMENT-004
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeLeadRecord,
  parseLeadKvRecord,
  isLeadEntityKey,
  isLeadEmailIndexKey,
  extractEmailFromIndexKey,
} from '../../supabase/functions/server/migration/normalizer.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = join(root, 'architecture', 'database', 'fixtures', 'kv');
const ORG = '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0';

describe('lead normalizer', () => {
  it('normalizes lead magnet fixture', () => {
    const payload = JSON.parse(readFileSync(join(fixtures, 'lead_magnet_sample.json'), 'utf8'));
    const parsed = parseLeadKvRecord('lead:lead_1739123456_abc', payload);
    const result = normalizeLeadRecord(parsed, ORG, 'lead:lead_1739123456_abc');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.email, 'jane@example.test');
      assert.equal(result.record.status, 'captured');
      assert.equal(result.record.legacyKvKey, 'lead:lead_1739123456_abc');
      assert.equal(result.record.leadSourceKey, 'lead_magnet');
    }
  });

  it('quarantines missing email', () => {
    const parsed = parseLeadKvRecord('lead:bad', JSON.parse(readFileSync(join(fixtures, 'lead_malformed.json'), 'utf8')));
    const result = normalizeLeadRecord(parsed, ORG, 'lead:bad');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reasonCode, 'MISSING_EMAIL');
      assert.equal(result.classification, 'quarantined');
    }
  });

  it('maps exit_intent source to status', () => {
    const payload = JSON.parse(readFileSync(join(fixtures, 'lead_exit_intent_sample.json'), 'utf8'));
    const parsed = parseLeadKvRecord('lead:lead_exit_1739123999_xyz', payload);
    const result = normalizeLeadRecord(parsed, ORG, 'lead:lead_exit_1739123999_xyz');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.record.status, 'exit_intent');
  });

  it('preserves source key', () => {
    const payload = { id: 'x', email: 'a@b.com', source: 'lead_magnet', capturedAt: '2026-01-01T00:00:00Z' };
    const key = 'lead:custom_key';
    const result = normalizeLeadRecord(parseLeadKvRecord(key, payload), ORG, key);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.record.legacyKvKey, key);
  });
});

describe('key helpers', () => {
  it('distinguishes entity vs index keys', () => {
    assert.equal(isLeadEntityKey('lead:abc'), true);
    assert.equal(isLeadEntityKey('lead_email:a@b.com'), false);
    assert.equal(isLeadEmailIndexKey('lead_email:a@b.com'), true);
    assert.equal(extractEmailFromIndexKey('lead_email:User@Test.com'), 'user@test.com');
  });
});
