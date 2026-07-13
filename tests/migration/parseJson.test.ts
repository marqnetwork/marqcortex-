/**
 * Migration parseJson tests — MCV2-S6.2-IMPLEMENT-004
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeJsonParse, normalizeEmail, emptyStringToNull } from '../../supabase/functions/server/migration/parseJson.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = join(root, 'architecture', 'database', 'fixtures', 'kv');

describe('safeJsonParse', () => {
  it('parses object values directly', () => {
    const obj = { email: 'a@test.com' };
    const result = safeJsonParse(obj);
    assert.equal(result.error, null);
    assert.deepEqual(result.parsed, obj);
    assert.equal(result.doubleEncoded, false);
  });

  it('handles double-encoded JSON strings', () => {
    const raw = readFileSync(join(fixtures, 'lead_double_encoded.json'), 'utf8').trim();
    const result = safeJsonParse(raw);
    assert.equal(result.error, null);
    assert.equal(result.doubleEncoded, true);
    assert.equal((result.parsed as { email: string }).email, 'double@example.test');
  });

  it('returns structured failure for malformed JSON', () => {
    const result = safeJsonParse('{not json');
    assert.ok(result.error);
    assert.equal(result.parsed, null);
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  });

  it('returns null for empty strings', () => {
    assert.equal(normalizeEmail(''), null);
    assert.equal(normalizeEmail('   '), null);
  });
});

describe('emptyStringToNull', () => {
  it('converts blank to null', () => {
    assert.equal(emptyStringToNull(''), null);
    assert.equal(emptyStringToNull('hello'), 'hello');
  });
});
