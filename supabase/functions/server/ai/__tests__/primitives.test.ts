/**
 * Unit tests for the control plane's primitives: hashing, validation,
 * identifiers, configuration and the error taxonomy.
 *
 * These are the components everything else is built on, so they are pinned
 * against fixed expectations rather than against each other.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { sha256Hex, promptFingerprint } from '../prompts/hash.ts';
import {
  arrayOf,
  bool,
  describeIssues,
  int,
  jsonObject,
  literal,
  object,
  optional,
  str,
  stringMap,
  withDefault,
} from '../security/validation.ts';
import { adoptOrCreateId, createSequentialIdFactory, isSafeId } from '../contracts/ids.ts';
import { AIError, statusForCode, toAIError } from '../contracts/errors.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';
import { isSupportedContractVersion, CONTRACT_VERSION } from '../contracts/versions.ts';

describe('sha256', () => {
  // NIST FIPS 180-4 vectors. If the implementation ever drifts, every prompt
  // hash in the audit trail becomes unverifiable — so these are exact.
  it('matches the published empty-string vector', () => {
    assert.equal(
      sha256Hex(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the published "abc" vector', () => {
    assert.equal(
      sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the published 56-character vector (two-block message)', () => {
    assert.equal(
      sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with the platform digest across lengths and encodings', () => {
    // Cross-checked against node:crypto, which is an independent
    // implementation. Covers multi-byte UTF-8 (where a code-unit
    // implementation silently diverges) and every padding boundary: 55 bytes
    // fits one block, 56 forces a second, 64 is exactly one block.
    const oracle = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
    const cases = [
      '',
      'a',
      'é',
      '🧠 prompt with emoji',
      'x'.repeat(55),
      'x'.repeat(56),
      'x'.repeat(64),
      'x'.repeat(1000),
      'MARQ Cortex — decision intelligence, façade, naïve',
    ];
    for (const text of cases) {
      assert.equal(sha256Hex(text), oracle(text), `digest mismatch for ${text.length} chars`);
    }
  });

  it('is deterministic and sensitive to a single character', () => {
    assert.equal(sha256Hex('marq cortex'), sha256Hex('marq cortex'));
    assert.notEqual(sha256Hex('marq cortex'), sha256Hex('marq cortez'));
  });

  it('produces a readable prefixed fingerprint', () => {
    const fingerprint = promptFingerprint('abc');
    assert.match(fingerprint, /^sha256:[0-9a-f]{16}$/);
    assert.equal(fingerprint, `sha256:${sha256Hex('abc').slice(0, 16)}`);
  });
});

describe('validation primitives', () => {
  it('drops keys the shape does not declare', () => {
    const validator = object({ keep: str() });
    const result = validator.validate({ keep: 'yes', smuggled: 'no' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(Object.keys(result.value), ['keep']);
  });

  it('reports every failing field, not just the first', () => {
    const validator = object({ a: str({ minLength: 3 }), b: int({ min: 0, max: 5 }) });
    const result = validator.validate({ a: 'x', b: 99 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(
      result.issues.map((issue) => issue.path).sort(),
      ['a', 'b'],
    );
  });

  it('never echoes the offending value in the message', () => {
    const result = object({ secret: str({ maxLength: 3 }) }).validate({ secret: 'hunter2' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.doesNotMatch(describeIssues(result.issues), /hunter2/);
  });

  it('treats null and undefined identically for optional fields', () => {
    const validator = object({ maybe: optional(str()) });
    for (const value of [undefined, null]) {
      const result = validator.validate({ maybe: value });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal('maybe' in result.value, false);
    }
  });

  it('applies defaults for absent fields but validates present ones', () => {
    const validator = object({ n: withDefault(int({ min: 0, max: 10 }), 3) });
    const absent = validator.validate({});
    assert.equal(absent.ok && absent.value.n, 3);
    assert.equal(validator.validate({ n: 99 }).ok, false);
  });

  it('rejects a literal outside its allowed set and names the set', () => {
    const result = literal(['a', 'b'] as const).validate('c', 'field');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.issues[0].message, /must be one of: a, b/);
  });

  it('bounds array length in both directions', () => {
    const validator = arrayOf(str(), { minItems: 1, maxItems: 2 });
    assert.equal(validator.validate([]).ok, false);
    assert.equal(validator.validate(['a', 'b', 'c']).ok, false);
    assert.equal(validator.validate(['a']).ok, true);
  });

  it('rejects a deeply nested object that would exhaust the prompt budget', () => {
    let nested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 20; i += 1) nested = { nested };
    assert.equal(jsonObject({ maxDepth: 5 }).validate(nested).ok, false);
  });

  it('rejects an object with too many nodes', () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 200; i += 1) wide[`k${i}`] = i;
    assert.equal(jsonObject({ maxNodes: 50 }).validate(wide).ok, false);
    assert.equal(jsonObject({ maxNodes: 500 }).validate(wide).ok, true);
  });

  it('rejects arrays and null where an object is required', () => {
    assert.equal(jsonObject().validate([]).ok, false);
    assert.equal(jsonObject().validate(null).ok, false);
    assert.equal(bool().validate('true').ok, false);
  });

  it('bounds string map entries, keys and values', () => {
    const validator = stringMap({ maxEntries: 2, maxKeyLength: 4, maxValueLength: 4 });
    assert.equal(validator.validate({ a: 'ok', b: 'ok' }).ok, true);
    assert.equal(validator.validate({ a: '1', b: '2', c: '3' }).ok, false);
    assert.equal(validator.validate({ toolong: '1' }).ok, false);
    assert.equal(validator.validate({ a: 'toolong' }).ok, false);
  });
});

describe('identifiers', () => {
  it('accepts safe caller-supplied trace ids', () => {
    assert.equal(isSafeId('req_abc-123.def:ghi'), true);
  });

  it('rejects ids that would corrupt a log line or a storage key', () => {
    for (const bad of ['', 'has space', 'new\nline', 'a'.repeat(200), '<script>']) {
      assert.equal(isSafeId(bad), false, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });

  it('replaces an unsafe caller id rather than failing the request', () => {
    const ids = createSequentialIdFactory('t');
    assert.equal(adoptOrCreateId('bad id', 'cor', ids), 'cor_t1');
    assert.equal(adoptOrCreateId('good-id', 'cor', ids), 'good-id');
  });
});

describe('error taxonomy', () => {
  it('maps codes to the documented HTTP statuses', () => {
    assert.equal(statusForCode('AUTH_REQUIRED'), 401);
    assert.equal(statusForCode('CAPABILITY_DENIED'), 403);
    assert.equal(statusForCode('RATE_LIMITED'), 429);
    assert.equal(statusForCode('PAYLOAD_TOO_LARGE'), 413);
    assert.equal(statusForCode('PROVIDER_TIMEOUT'), 504);
    assert.equal(statusForCode('NO_PROVIDER_AVAILABLE'), 503);
  });

  it('keeps diagnostics out of the caller-facing body', () => {
    const error = new AIError('VALIDATION_FAILED', 'Invalid request.', {
      diagnostics: 'internal detail with org=acme',
      fields: ['a'],
    });
    const body = error.toResponseBody('req_1', 'cor_1');
    assert.equal(JSON.stringify(body).includes('internal detail'), false);
    assert.deepEqual(body.fields, ['a']);
    assert.equal(body.code, 'VALIDATION_FAILED');
  });

  it('never leaks an unknown throwable message to the caller', () => {
    const converted = toAIError(new Error('SQL: SELECT * FROM secrets WHERE org=acme'));
    assert.equal(converted.code, 'INTERNAL_ERROR');
    assert.equal(converted.message, 'AI request failed.');
    assert.match(String(converted.diagnostics), /SELECT \* FROM secrets/);
  });

  it('passes an AIError through unchanged', () => {
    const original = new AIError('RATE_LIMITED', 'slow down');
    assert.equal(toAIError(original), original);
  });
});

describe('configuration', () => {
  it('falls back to a safe default for an unparseable value', () => {
    const config = loadControlPlaneConfig(
      recordEnv({ AI_CIRCUIT_OPEN_MS: 'not-a-number', AI_BUDGET_ENFORCE: 'maybe' }),
    );
    assert.equal(config.circuit.openMs, 30_000);
    assert.equal(config.budget.enforce, true);
  });

  it('rejects an out-of-range value rather than propagating it', () => {
    const config = loadControlPlaneConfig(recordEnv({ AI_CIRCUIT_FAILURE_THRESHOLD: '-5' }));
    assert.equal(config.circuit.failureThreshold, 5);
  });

  it('parses boolean spellings operators actually use', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
      assert.equal(loadControlPlaneConfig(recordEnv({ AI_BUDGET_ENFORCE: value })).budget.enforce, true);
    }
    for (const value of ['false', 'FALSE', '0', 'no', 'off']) {
      assert.equal(loadControlPlaneConfig(recordEnv({ AI_BUDGET_ENFORCE: value })).budget.enforce, false);
    }
  });

  it('reads a provider preference list and drops empty entries', () => {
    const config = loadControlPlaneConfig(
      recordEnv({ AI_PROVIDER_PREFERENCE: 'anthropic, ,openai' }),
    );
    assert.deepEqual(config.providerPreference, ['anthropic', 'openai']);
  });
});

describe('contract versioning', () => {
  it('accepts the current contract', () => {
    assert.equal(isSupportedContractVersion(CONTRACT_VERSION), true);
  });

  it('refuses an unknown contract rather than reinterpreting the payload', () => {
    assert.equal(isSupportedContractVersion('ai.v2'), false);
    assert.equal(isSupportedContractVersion(''), false);
  });
});
