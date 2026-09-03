/**
 * AI-01 Batch 4E — static validation of the self-hosted provider migration and
 * its rollback. No database required.
 *
 * THIS FILE IS NOT THE VERIFICATION, AND SAYS SO FIRST.
 *
 * Batch 4C's production gate found two defects its static suite reported as
 * healthy, because both were about what PostgreSQL DOES with the file rather
 * than what the file contains. The same limit applies here: whether the CHECK
 * constraint below actually accepts every existing row and rejects nested JSON
 * is a question for a real server, and this suite cannot answer it.
 *
 * WHAT A SCAN IS THE RIGHT TOOL FOR IS PROVING ABSENCE, and this migration's
 * claims are almost entirely absences:
 *
 *   no new table, no new column
 *   no plaintext or secret column
 *   no RLS policy and no grant to a browser role
 *   no seeded provider, endpoint, model or credential
 *   no URL regex pretending the database validates an endpoint
 *   no DELETE of an operator's configuration in the rollback
 *
 * The one PRESENCE it asserts is the pair that has to exist together: a
 * predicate function and the constraint that calls it, plus the `service_role`
 * EXECUTE grant whose absence broke every 4C write.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = '20260903120000_ai_self_hosted_providers.sql';
const ROLLBACK = '20260903120000_rollback_ai_self_hosted_providers.sql';

const sql = readFileSync(join(root, 'supabase', 'migrations', MIGRATION), 'utf8');
const rollbackSql = readFileSync(
  join(root, 'supabase', 'migrations', 'rollbacks', ROLLBACK),
  'utf8',
);

/** The file with SQL comments stripped and runs of whitespace collapsed. */
const strip = (text: string) => text.replace(/^\s*--.*$/gm, ' ').replace(/[ \t]+/g, ' ');
const code = strip(sql);
const rollback = strip(rollbackSql);

describe('AI self-hosted provider migration (static)', () => {
  it('runs in a single transaction, and so does its rollback', () => {
    assert.match(code, /^\s*BEGIN;/m);
    assert.match(code, /^\s*COMMIT;\s*$/m);
    assert.match(rollback, /^\s*BEGIN;/m);
    assert.match(rollback, /^\s*COMMIT;\s*$/m);
  });

  it('creates no table and adds no column', () => {
    // A self-hosted provider is a row in the table Batch 4C already built. A
    // second set of tables would be a second RLS posture and a second privilege
    // matrix to keep aligned with the first.
    assert.doesNotMatch(code, /CREATE TABLE/i);
    assert.doesNotMatch(code, /ADD COLUMN/i);
  });

  it('adds the shape predicate and the constraint that calls it', () => {
    assert.match(
      code,
      /CREATE OR REPLACE FUNCTION cortex\.ai_provider_configuration_shape_is_safe\(config JSONB\)/,
    );
    assert.match(code, /\bIMMUTABLE\b/);
    assert.match(code, /ADD CONSTRAINT ai_provider_configuration_shape/);
    assert.match(
      code,
      /CHECK \(cortex\.ai_provider_configuration_shape_is_safe\(configuration\)\)/,
    );
  });

  it('grants EXECUTE on the predicate to the runtime role', () => {
    // THE BATCH 4C LESSON, ASSERTED. A CHECK constraint is evaluated as the
    // writing role; a predicate the runtime cannot execute makes every write
    // fail with `permission denied for function`, which is exactly how 4C's
    // credential activation shipped broken.
    assert.match(
      code,
      /GRANT EXECUTE ON FUNCTION cortex\.ai_provider_configuration_shape_is_safe\(JSONB\) TO service_role/,
    );
  });

  it('adds the constraint conditionally, so the migration is re-runnable', () => {
    // PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`, and a duplicate
    // constraint name is precisely what made the first 4C migration
    // unappliable anywhere.
    assert.match(code, /FROM pg_constraint/);
    assert.match(code, /conname = 'ai_provider_configuration_shape'/);
  });

  it('enforces a flat map of bounded text values', () => {
    assert.match(code, /jsonb_typeof\(entry\.value\) <> 'string'/);
    assert.match(code, /length\(entry\.value #>> '\{\}'\) > 2048/);
    assert.match(code, /jsonb_object_keys\(config\)\) <= 160/);
  });

  it('rejects credential-shaped keys without rejecting the schema’s own', () => {
    const predicate = /entry\.key ~\* '\(([^']+)\)'/.exec(code)?.[1] ?? '';
    assert.notEqual(predicate, '', 'the key pattern must be present');
    // The narrowness IS the design. `credentialRequired` and
    // `model.N.maxOutputTokens` are legitimate 4E keys, so a pattern containing
    // `credential` or `token` would reject the schema it protects — and a
    // constraint that rejects valid data is a constraint somebody disables.
    assert.equal(predicate.includes('token'), false);
    assert.equal(predicate.includes('credential'), false);
    for (const word of ['secret', 'password', 'api[-_]?key', 'private[-_]?key', 'bearer']) {
      assert.ok(predicate.includes(word), `expected the pattern to name ${word}`);
    }
  });

  it('makes no attempt to validate a URL in SQL', () => {
    // A partial endpoint check here beside a complete one in the runtime would
    // be worse than none: a reader would assume the database was the authority,
    // and the two would drift on the first address family somebody forgot.
    assert.doesNotMatch(code, /https?:\/\//i);
    assert.doesNotMatch(code, /169\.254/);
    assert.doesNotMatch(code, /127\.0\.0\.1/);
    assert.doesNotMatch(code, /localhost/i);
  });

  it('seeds nothing and copies no secret', () => {
    assert.doesNotMatch(code, /\bINSERT\b/i);
    assert.doesNotMatch(code, /OPENAI_API_KEY|ANTHROPIC_API_KEY|AI_CREDENTIAL_ENCRYPTION_KEY/);
    assert.doesNotMatch(code, /\bplaintext\b/i);
  });

  it('changes no policy, no privilege beyond the predicate, and no browser role', () => {
    assert.doesNotMatch(code, /CREATE POLICY|DROP POLICY|ALTER POLICY/i);
    assert.doesNotMatch(code, /GRANT ALL/i);
    assert.doesNotMatch(code, /TO (anon|authenticated|PUBLIC)\b/);
    // Exactly one GRANT, and it is the predicate's.
    assert.equal((code.match(/\bGRANT\b/g) ?? []).length, 1);
  });

  it('corrects the column comment the 4C migration left open', () => {
    assert.match(code, /COMMENT ON COLUMN cortex\.ai_provider_configuration\.configuration/);
    assert.match(code, /endpointPolicy\.ts/);
  });
});

describe('AI self-hosted provider rollback (static)', () => {
  it('drops the constraint before the function it depends on', () => {
    const constraintAt = rollback.indexOf('DROP CONSTRAINT IF EXISTS ai_provider_configuration_shape');
    const functionAt = rollback.indexOf('DROP FUNCTION IF EXISTS');
    assert.ok(constraintAt >= 0, 'the constraint must be dropped');
    assert.ok(functionAt >= 0, 'the predicate must be dropped');
    assert.ok(constraintAt < functionAt, 'the constraint must go first');
  });

  it('destroys no operator configuration', () => {
    // THE CLAIM THAT MATTERS. Removing a shape constraint is not a reason to
    // delete a provider an administrator defined, and a rollback that quietly
    // did would be discovered only after it had run.
    assert.doesNotMatch(rollback, /\bDELETE\b/i);
    assert.doesNotMatch(rollback, /\bTRUNCATE\b/i);
    assert.doesNotMatch(rollback, /DROP TABLE/i);
    assert.doesNotMatch(rollback, /DROP COLUMN/i);
  });

  it('restores the Batch 4C column comment rather than leaving 4E text behind', () => {
    assert.match(rollback, /COMMENT ON COLUMN cortex\.ai_provider_configuration\.configuration/);
    assert.match(rollback, /AI-01 Batch 4C/);
    assert.doesNotMatch(rollback, /endpointPolicy\.ts/);
  });

  it('is idempotent', () => {
    assert.match(rollback, /DROP CONSTRAINT IF EXISTS/);
    assert.match(rollback, /DROP FUNCTION IF EXISTS/);
  });
});
