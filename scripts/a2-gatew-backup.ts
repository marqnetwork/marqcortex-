/**
 * A2 Gate W prerequisite 1 — the logical backup an OPERATOR takes at W1.2.
 *
 *   A2_BACKUP_SOURCE_URL='postgresql://…'   (the hosted database; never argv)
 *   node --experimental-strip-types scripts/a2-gatew-backup.ts /abs/dir/OUTSIDE/git
 *
 * WHAT IT WRITES — only files, only into the named directory, never into Git:
 *
 *   public-full.dump        pg_dump -Fc of schema `public`, schema AND data
 *   critical-tables.dump    pg_dump -Fc --data-only of the named tables, with
 *                           --strict-names so a missing table is a failure
 *   source.txt              server version, database, time, migration head
 *   row-counts.tsv          row count per named table, read in the dump's session
 *   restore-list.txt        pg_restore --list of both archives
 *   SHA256SUMS              checksums of every file above
 *   restore-verify.txt      (when a LOCAL verify target is reachable) the named
 *                           tables restored into a scratch local database and
 *                           their row counts compared with the source
 *
 * WHAT IT NEVER DOES: write to the source. Every source session is opened with
 * default_transaction_read_only=on AND each query runs inside an explicit
 * BEGIN READ ONLY; pg_dump reads in its own read-only snapshot. The script then
 * checks that the source session really was read-only and refuses otherwise.
 * The connection URL and password are passed to the children as libpq
 * environment variables — never on a command line, never printed.
 *
 * The restore verification may only target a LOCAL database (BP-004 guard):
 * it creates and drops one scratch database, `cortex_a2_backup_verify`.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import {
  classifyDatabaseTarget,
  localDatabaseEnvironment,
} from '../supabase/functions/server/ai/workflows/persistence/migration/localOnly.ts';

/** W1.2's named critical tables, plus `roles` (their foreign-key parent) and the migration ledger. */
export const CRITICAL_TABLES = [
  'public.kv_store_324f4fbe',
  'public.organizations',
  'public.organization_memberships',
  'public.roles',
  'public.permissions',
  'public.role_permissions',
  'supabase_migrations.schema_migrations',
] as const;

const VERIFY_DATABASE = 'cortex_a2_backup_verify';

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** A PostgreSQL URL as libpq environment variables, so nothing secret reaches argv. */
function libpqEnvironment(url: string): Record<string, string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail('A2_BACKUP_SOURCE_URL is not a connection URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) fail('A2_BACKUP_SOURCE_URL is not a PostgreSQL URL');
  const env: Record<string, string> = {};
  const host = parsed.searchParams.get('host') ?? decodeURIComponent(parsed.hostname);
  if (host) env.PGHOST = host;
  if (parsed.port) env.PGPORT = parsed.port;
  if (parsed.username) env.PGUSER = decodeURIComponent(parsed.username);
  if (parsed.password) env.PGPASSWORD = decodeURIComponent(parsed.password);
  env.PGDATABASE = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres';
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

// ── Arguments ───────────────────────────────────────────────────────────────

const outputDirectory = process.argv[2];
if (!outputDirectory || !isAbsolute(outputDirectory)) fail('usage: a2-gatew-backup.ts <absolute output directory outside any Git work tree>');
const sourceUrl = process.env.A2_BACKUP_SOURCE_URL;
if (!sourceUrl) fail('A2_BACKUP_SOURCE_URL is not set (put the connection string in the environment, never on the command line)');

// The restore check writes (one scratch database), so it may only ever be local.
const verifyUrl = process.env.A2_BACKUP_VERIFY_URL;
if (verifyUrl) {
  const target = classifyDatabaseTarget({ DATABASE_URL: verifyUrl });
  if (!target.ok) fail(`A2_BACKUP_VERIFY_URL refused: ${target.problem}`);
}

if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) fail(`${outputDirectory} is not empty`);
mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
chmodSync(outputDirectory, 0o700);
// NEVER INTO GIT: the dump holds every KV row, including customer submissions.
if (spawnSync('git', ['-C', outputDirectory, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).stdout.trim() === 'true') {
  fail(`${outputDirectory} is inside a Git work tree; a backup of production data must never be committable`);
}

// Only the libpq variables derived from the URL select the source: a stray
// PGHOST/PGSERVICE in the operator's shell must not redirect the dump.
const baseEnvironment = localDatabaseEnvironment(process.env);
delete baseEnvironment.PGPASSWORD;
delete baseEnvironment.PGUSER;
delete baseEnvironment.PGDATABASE;
delete baseEnvironment.PGPORT;
const SOURCE_ENV = {
  ...baseEnvironment,
  ...libpqEnvironment(sourceUrl),
  PGOPTIONS: '-c default_transaction_read_only=on',
  PGAPPNAME: 'a2-gatew-backup',
};

function sourceQuery(sql: string): string {
  const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
    encoding: 'utf8',
    env: SOURCE_ENV,
    input: `BEGIN READ ONLY;\n${sql}\nROLLBACK;\n`,
  });
  if (run.status !== 0) fail(`source query failed: ${run.stderr.trim()}`);
  return run.stdout.trim();
}

// ── Preflight: read-only session, compatible pg_dump ────────────────────────

// Every psql query here runs inside BEGIN READ ONLY, and pg_dump always opens
// its snapshot as REPEATABLE READ, READ ONLY. The session default is belt and
// braces: a connection pooler may drop startup options, so it is RECORDED,
// while the transaction flag the queries actually run under is REQUIRED.
const [defaultReadOnly, transactionReadOnly] = sourceQuery(
  `SELECT current_setting('default_transaction_read_only') || '/' || current_setting('transaction_read_only');`,
).split('/');
if (transactionReadOnly !== 'on') fail('the source transaction is not read-only; refusing');

const serverVersionNum = Number(sourceQuery('SHOW server_version_num;'));
const serverMajor = Math.floor(serverVersionNum / 10000);
const dumpVersion = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' }).stdout.trim();
const dumpMajor = Number(/(\d+)\.\d+/.exec(dumpVersion)?.[1] ?? NaN);
if (!(dumpMajor >= serverMajor)) fail(`pg_dump ${dumpMajor} is older than server ${serverMajor}; install pg_dump ${serverMajor}+`);

const ledgerPresent = sourceQuery(`SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL;`) === 't';
const source = [
  `database\t${sourceQuery('SELECT current_database();')}`,
  `server_version\t${sourceQuery('SHOW server_version;')}`,
  `pg_dump\t${dumpVersion}`,
  `taken_at\t${sourceQuery('SELECT now();')}`,
  `migration_head\t${ledgerPresent ? sourceQuery('SELECT max(version) FROM supabase_migrations.schema_migrations;') : 'NO LEDGER'}`,
  `session\tdefault_transaction_read_only=${defaultReadOnly}, transaction_read_only=${transactionReadOnly}`,
].join('\n');
writeFileSync(join(outputDirectory, 'source.txt'), `${source}\n`, { mode: 0o600 });

// ── The dumps ───────────────────────────────────────────────────────────────

function dump(file: string, args: readonly string[]) {
  const run = spawnSync('pg_dump', ['--format=custom', `--file=${join(outputDirectory, file)}`, ...args], {
    encoding: 'utf8',
    env: SOURCE_ENV,
  });
  if (run.status !== 0) fail(`pg_dump ${file} failed: ${run.stderr.trim()}`);
  chmodSync(join(outputDirectory, file), 0o600);
}

dump('public-full.dump', ['--schema=public']);
dump('critical-tables.dump', ['--data-only', '--strict-names', ...CRITICAL_TABLES.flatMap((t) => ['--table', t])]);

const counts = CRITICAL_TABLES.map((table) => `${table}\t${sourceQuery(`SELECT count(*) FROM ${table};`)}`);
writeFileSync(join(outputDirectory, 'row-counts.tsv'), `${counts.join('\n')}\n`, { mode: 0o600 });

const listing = ['public-full.dump', 'critical-tables.dump'].map((file) => {
  const run = spawnSync('pg_restore', ['--list', join(outputDirectory, file)], { encoding: 'utf8' });
  if (run.status !== 0) fail(`pg_restore --list ${file} failed: ${run.stderr.trim()}`);
  return `### ${file}\n${run.stdout}`;
});
writeFileSync(join(outputDirectory, 'restore-list.txt'), listing.join('\n'), { mode: 0o600 });
for (const table of CRITICAL_TABLES) {
  const [schema, name] = table.split('.');
  if (!new RegExp(`TABLE DATA ${schema} ${name} `).test(listing[1])) fail(`critical-tables.dump holds no data entry for ${table}`);
}

// ── Restore verification into a LOCAL scratch database ──────────────────────

let verified = 'SKIPPED: no local verify target (set A2_BACKUP_VERIFY_URL to a local PostgreSQL)';
if (verifyUrl) {
  const LOCAL_ENV = localDatabaseEnvironment(process.env);
  const local = (database: string) => {
    const url = new URL(verifyUrl);
    url.pathname = `/${database}`;
    return url.toString();
  };
  const localPsql = (database: string, sql: string) =>
    spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', local(database)], { encoding: 'utf8', env: LOCAL_ENV, input: sql });
  const admin = new URL(verifyUrl).pathname.replace(/^\//, '') || 'postgres';
  localPsql(admin, `DROP DATABASE IF EXISTS ${VERIFY_DATABASE} WITH (FORCE);`);
  if (localPsql(admin, `CREATE DATABASE ${VERIFY_DATABASE};`).status !== 0) fail('could not create the local verify database');
  try {
    // Table definitions only (no RLS/policies/grants that name hosted roles),
    // then the data archive. Constraints are not needed to count rows.
    const schemas = [...new Set(CRITICAL_TABLES.map((t) => t.split('.')[0]))];
    localPsql(VERIFY_DATABASE, schemas.map((s) => `CREATE SCHEMA IF NOT EXISTS ${s};`).join('\n'));
    const ledger = CRITICAL_TABLES.filter((t) => !t.startsWith('public.'));
    for (const table of ledger) {
      // The ledger is not in the `public` dump; its shape comes from the source.
      const columns = sourceQuery(
        `SELECT string_agg(format('%I %s', column_name, CASE WHEN data_type = 'ARRAY' THEN 'text[]' ELSE data_type END), ', ' ORDER BY ordinal_position)
           FROM information_schema.columns WHERE table_schema || '.' || table_name = '${table}';`,
      );
      if (localPsql(VERIFY_DATABASE, `CREATE TABLE ${table} (${columns});`).status !== 0) fail(`could not recreate ${table} locally`);
    }
    const publicTables = CRITICAL_TABLES.filter((t) => t.startsWith('public.')).flatMap((t) => ['--table', t.split('.')[1]]);
    const definitions = spawnSync('pg_restore', ['--no-owner', '--no-acl', '--schema-only', '--schema=public', ...publicTables, '-d', local(VERIFY_DATABASE), join(outputDirectory, 'public-full.dump')], { encoding: 'utf8', env: LOCAL_ENV });
    if (definitions.status !== 0) fail(`restoring table definitions failed: ${definitions.stderr.trim()}`);
    const data = spawnSync('pg_restore', ['--no-owner', '--no-acl', '--data-only', '-d', local(VERIFY_DATABASE), join(outputDirectory, 'critical-tables.dump')], { encoding: 'utf8', env: LOCAL_ENV });
    if (data.status !== 0) fail(`restoring data failed: ${data.stderr.trim()}`);
    const restored = CRITICAL_TABLES.map((table) => `${table}\t${localPsql(VERIFY_DATABASE, `SELECT count(*) FROM ${table};`).stdout.trim()}`);
    if (restored.join('\n') !== counts.join('\n')) {
      fail(`restored row counts differ from the source:\n${restored.join('\n')}\nvs\n${counts.join('\n')}`);
    }
    verified = `RESTORED into local ${VERIFY_DATABASE}; every named table's row count equals the source\n${restored.join('\n')}`;
  } finally {
    localPsql(admin, `DROP DATABASE IF EXISTS ${VERIFY_DATABASE} WITH (FORCE);`);
  }
}
writeFileSync(join(outputDirectory, 'restore-verify.txt'), `${verified}\n`, { mode: 0o600 });

// ── Checksums ───────────────────────────────────────────────────────────────

const files = ['public-full.dump', 'critical-tables.dump', 'source.txt', 'row-counts.tsv', 'restore-list.txt', 'restore-verify.txt'];
const sums = files.map((file) => `${createHash('sha256').update(readFileSync(join(outputDirectory, file))).digest('hex')}  ${file}`);
writeFileSync(join(outputDirectory, 'SHA256SUMS'), `${sums.join('\n')}\n`, { mode: 0o600 });

console.log(`✓ A2 Gate W backup written to ${outputDirectory} (read-only source session; nothing written to the source)`);
console.log(source.split('\n').filter((line) => !line.startsWith('session')).map((line) => `  ${line}`).join('\n'));
console.log(counts.map((line) => `  rows ${line}`).join('\n'));
console.log(`  restore: ${verified.split('\n')[0]}`);
