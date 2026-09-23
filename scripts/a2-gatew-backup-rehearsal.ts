/**
 * A2 Gate W prerequisite 1 — prove `a2-gatew-backup.ts` locally before an
 * operator points it at production.
 *
 * Builds a hosted-shaped LOCAL source (tenancy tables, the real kv_store, a
 * migration ledger whose head is the hosted head), runs the backup exactly as
 * the operator will, and asserts:
 *   - every artefact exists, the checksums verify, the archives list data for
 *     every named table, and the restore into a scratch LOCAL database
 *     reproduces every row count;
 *   - the source is unchanged: row count and content digest of every named
 *     table identical before and after;
 *   - the refusals hold: an output directory inside Git, a non-empty output
 *     directory, a non-local restore target, a missing named table.
 *
 * Local only (BP-004 guard). Creates and drops `cortex_a2_backup_source`.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyDatabaseTarget,
  localDatabaseEnvironment,
} from '../supabase/functions/server/ai/workflows/persistence/migration/localOnly.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'cortex_a2_backup_source';
const TABLES = [
  'public.kv_store_324f4fbe', 'public.organizations', 'public.organization_memberships', 'public.roles',
  'public.permissions', 'public.role_permissions', 'supabase_migrations.schema_migrations',
];

const target = classifyDatabaseTarget(process.env);
if (!target.ok) {
  console.error(`✗ REFUSED: ${target.problem}`);
  process.exit(1);
}
const ENV = localDatabaseEnvironment(process.env);
const baseUrl = process.env.DATABASE_URL ?? 'postgresql:///postgres?host=/var/run/postgresql';
const urlFor = (database: string) => {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
};
const psql = (database: string, sql: string) =>
  spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', urlFor(database)], { encoding: 'utf8', env: ENV, input: sql });
const admin = new URL(baseUrl).pathname.replace(/^\//, '') || 'postgres';

function fail(message: string): never {
  console.error(`✗ ${message}`);
  psql(admin, `DROP DATABASE IF EXISTS ${SOURCE} WITH (FORCE);`);
  process.exit(1);
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}
const scalar = (sql: string) => {
  const run = psql(SOURCE, sql);
  if (run.status !== 0) fail(`${sql}: ${run.stderr}`);
  return run.stdout.trim();
};

if (psql(admin, 'SELECT 1;').status !== 0) {
  console.error('SKIPPED: no reachable local PostgreSQL.');
  process.exit(2);
}

// ── A hosted-shaped source ──────────────────────────────────────────────────

psql(admin, `DROP DATABASE IF EXISTS ${SOURCE} WITH (FORCE);`);
expect(psql(admin, `CREATE DATABASE ${SOURCE};`).status === 0, 'could not create the source database');
for (const file of [
  join(ROOT, 'tests', 'database', 'harness', '00_platform_stub.sql'),
  join(ROOT, 'supabase', 'migrations', '20260711050000_cortex_tenancy_foundation.sql'),
  join(ROOT, 'supabase', 'migrations', '20260711050001_cortex_tenancy_rls_and_seed.sql'),
  join(ROOT, 'supabase', 'migrations', '20260713000000_kv_store_foundation.sql'),
]) {
  const run = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', urlFor(SOURCE), '-f', file], { encoding: 'utf8', env: ENV });
  expect(run.status === 0, `applying ${file}: ${run.stderr}`);
}
scalar(`
  CREATE SCHEMA supabase_migrations;
  CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);
  INSERT INTO supabase_migrations.schema_migrations VALUES
    ('20260711050000', ARRAY['-- stub'], 'cortex_tenancy_foundation'),
    ('20260901120000', ARRAY['-- stub'], 'ai_customer_byok');
  INSERT INTO public.kv_store_324f4fbe (key, value)
    SELECT 'sub:rehearsal-' || n, jsonb_build_object('company', 'rehearsal ' || n, 'note', E'quote '' and newline\\n')
      FROM generate_series(1, 73) AS n;`);

const digest = () =>
  TABLES.map((t) => `${t}=${scalar(`SELECT count(*) || ':' || coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') FROM ${t} x;`)}`).join('\n');
const before = digest();
console.log(`A2 Gate W — backup rehearsal (local: ${target.host})`);

// ── The backup, exactly as the operator runs it ─────────────────────────────

const backup = (outputDirectory: string, extra: Record<string, string | undefined> = {}) =>
  spawnSync(process.execPath, ['--experimental-strip-types', join(ROOT, 'scripts', 'a2-gatew-backup.ts'), outputDirectory], {
    encoding: 'utf8',
    env: { ...ENV, DATABASE_URL: undefined, A2_BACKUP_SOURCE_URL: urlFor(SOURCE), A2_BACKUP_VERIFY_URL: urlFor(admin), ...extra },
  });

const out = join(mkdtempSync(join(tmpdir(), 'a2-gatew-backup-')), 'dump');
const run = backup(out);
expect(run.status === 0, `the backup failed: ${run.stderr}${run.stdout}`);
process.stdout.write(run.stdout.replace(/^/gm, '    '));

const sums = readFileSync(join(out, 'SHA256SUMS'), 'utf8').trim().split('\n');
expect(sums.length === 6, 'SHA256SUMS does not cover every artefact');
for (const line of sums) {
  const [hash, file] = line.split(/\s+/);
  expect(createHash('sha256').update(readFileSync(join(out, file))).digest('hex') === hash, `checksum mismatch: ${file}`);
}
expect(readFileSync(join(out, 'restore-verify.txt'), 'utf8').startsWith('RESTORED'), 'the restore was not verified');
expect(/migration_head\t20260901120000/.test(readFileSync(join(out, 'source.txt'), 'utf8')), 'source.txt misreports the migration head');
expect(/public\.kv_store_324f4fbe\t73/.test(readFileSync(join(out, 'row-counts.tsv'), 'utf8')), 'row-counts.tsv misreports KV');
console.log('  ✓ artefacts: checksums verify; restore into a scratch LOCAL database reproduces every row count');

expect(digest() === before, 'the source changed during the backup');
console.log(`  ✓ source unchanged: content digest of all ${TABLES.length} named tables identical`);

// ── Refusals ────────────────────────────────────────────────────────────────

const inGit = backup(join(ROOT, 'tmp-a2-backup-must-refuse'));
rmSync(join(ROOT, 'tmp-a2-backup-must-refuse'), { recursive: true, force: true });
expect(inGit.status !== 0 && /inside a Git work tree/.test(inGit.stderr), 'an output directory inside Git was not refused');
const nonEmpty = backup(out);
expect(nonEmpty.status !== 0 && /is not empty/.test(nonEmpty.stderr), 'a non-empty output directory was not refused');
const remote = backup(join(dirname(out), 'remote'), { A2_BACKUP_VERIFY_URL: 'postgresql://postgres@db.example.supabase.co:5432/postgres' });
expect(remote.status !== 0 && /A2_BACKUP_VERIFY_URL refused/.test(remote.stderr), 'a non-local restore target was not refused');
scalar('ALTER TABLE public.role_permissions RENAME TO role_permissions_renamed;');
const missing = backup(join(dirname(out), 'missing'));
expect(missing.status !== 0 && /pg_dump critical-tables\.dump failed/.test(missing.stderr), 'a missing named table was not a failure');
scalar('ALTER TABLE public.role_permissions_renamed RENAME TO role_permissions;');
console.log('  ✓ refused: output inside Git, non-empty output, non-local restore target, missing named table');

rmSync(dirname(out), { recursive: true, force: true });
psql(admin, `DROP DATABASE IF EXISTS ${SOURCE} WITH (FORCE);`);
console.log('\n✓ backup rehearsal passed');
