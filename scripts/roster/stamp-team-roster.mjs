#!/usr/bin/env node
/**
 * Stamp a reviewed internal-staff roster, or reverse one.
 *
 * WHAT THIS REPLACES
 *
 * A block of SQL in `architecture/database/MEMBERSHIP_BOOTSTRAP.md` that an
 * operator pasted into a console and hand-edited:
 *
 *     UPDATE auth.users SET raw_app_meta_data = … FROM (VALUES ('<UUID>', 'admin')) …
 *
 * Deciding who is internal MARQ staff is a security boundary — the stamp is the
 * only thing the console's authorization, the AI capability grant and the
 * membership bootstrap read. Running that boundary from a markdown file means a
 * typo stamps a customer, a dropped `WHERE` stamps everybody, and nothing
 * afterwards records what was done or can undo it.
 *
 * WHAT THIS IS
 *
 * A thin, auditable driver over two reviewed database functions
 * (`supabase/migrations/20260818130000_marq_membership_lifecycle.sql`):
 *
 *     cortex.stamp_team_roster(roster, expected_count, artifact, dry_run)
 *     cortex.unstamp_team_roster(artifact, dry_run)
 *
 * EVERY guarantee lives in those functions, not here — an empty roster, an
 * unknown id, a duplicate, a role the console cannot issue, an account that
 * belongs to another organization, a count that does not match the review, and
 * the all-or-nothing transaction. This file reads a JSON file, passes it, and
 * prints what came back. It cannot loosen a check by being wrong, only fail to
 * reach one.
 *
 * WHY THE ROSTER IS NOT IN THE REPOSITORY
 *
 * A real roster names real people by `auth.users` id. This repository has no
 * approved convention for committing production identifiers, so the roster is
 * operator-supplied at run time and `.gitignore` keeps the filled-in copies out.
 * `supabase/operations/roster/team-roster.example.json` is the template.
 *
 * WHO MAY RUN IT
 *
 * A privileged database role. `auth.users` belongs to the auth schema, on which
 * the `service_role` PostgREST role holds no privilege — an API key cannot do
 * this and must not be able to. The functions are SECURITY INVOKER and granted
 * to nobody precisely so they add no authority of their own.
 *
 * USAGE
 *
 *   node scripts/roster/stamp-team-roster.mjs --roster=<file>            # plan
 *   node scripts/roster/stamp-team-roster.mjs --roster=<file> --expect=N --apply
 *   node scripts/roster/stamp-team-roster.mjs --artifact=<id> --unstamp  # plan
 *   node scripts/roster/stamp-team-roster.mjs --artifact=<id> --unstamp --apply
 *
 * Connection: DATABASE_URL, or the standard PG* variables.
 *
 * EXIT CODES
 *   0  the plan printed, or the change applied
 *   1  refused, or failed
 *   2  no database reachable / psql missing — never reported as success
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.length > 0 ? rest.join('=') : true];
  }),
);

const APPLY = args.get('apply') === true;
const UNSTAMP = args.get('unstamp') === true;

function die(message, code = 1) {
  console.error(`✗ ${message}`);
  process.exit(code);
}

function psql(sql) {
  const base = process.env.DATABASE_URL ? ['-d', process.env.DATABASE_URL] : [];
  return spawnSync('psql', [...base, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-c', sql], {
    encoding: 'utf8',
    env: process.env,
  });
}

// --- preflight -------------------------------------------------------------
const probe = psql('SELECT 1');
if (probe.error?.code === 'ENOENT') {
  die('psql is not on PATH. This needs a direct connection to the database.', 2);
}
if (probe.status !== 0) {
  console.error((probe.stderr ?? '').trim());
  die('no reachable PostgreSQL. Set DATABASE_URL or the PG* variables.', 2);
}

/** SQL literal quoting. The roster is JSON from a file the operator wrote, and
 *  it reaches the database as ONE quoted literal — never as interpolated SQL. */
function literal(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// ===========================================================================
// REVERSE
// ===========================================================================
if (UNSTAMP) {
  const artifact = args.get('artifact');
  if (typeof artifact !== 'string' || artifact.trim() === '') {
    die('--unstamp needs --artifact=<identifier>. Reversing "the last one" is not a thing this can guess.');
  }

  const sql = `SELECT cortex.unstamp_team_roster(${literal(artifact)}, ${APPLY ? 'false' : 'true'})`;
  const run = psql(sql);
  if (run.status !== 0) {
    console.error((run.stderr ?? '').trim());
    die(`the reversal was refused. Nothing was changed.`);
  }
  console.log(APPLY ? '✓ reversal applied' : '✓ reversal plan (nothing was changed)');
  console.log(run.stdout.trim());
  process.exit(0);
}

// ===========================================================================
// STAMP
// ===========================================================================
const rosterPath = args.get('roster');
if (typeof rosterPath !== 'string' || !existsSync(rosterPath)) {
  die(
    '--roster=<file> is required and must exist. Start from ' +
      'supabase/operations/roster/team-roster.example.json.',
  );
}

let document;
try {
  document = JSON.parse(readFileSync(rosterPath, 'utf8'));
} catch (error) {
  die(`${rosterPath} is not valid JSON: ${error.message}`);
}

const artifact = args.get('artifact') ?? document.artifact;
if (typeof artifact !== 'string' || artifact.trim() === '') {
  die('the roster file needs an "artifact" identifier (or pass --artifact=). It is what makes the stamp reversible.');
}

if (!Array.isArray(document.roster) || document.roster.length === 0) {
  die('the roster file has no "roster" array, or it is empty.');
}

// The entries are passed through untouched — including any the database will
// reject. Filtering here would mean this script decided who was on the roster,
// which is the job it exists to take away from itself.
const entries = document.roster.map((entry) => ({
  user_id: entry.user_id,
  team_role: entry.team_role,
}));

// The expected count is the operator's assertion about what they reviewed. It
// comes from the command line when applying, so "I read this list" is an act
// rather than a value that travelled with the file it describes.
const declared = args.get('expect') ?? (APPLY ? undefined : document.expectedCount ?? entries.length);
if (APPLY && declared === undefined) {
  die('--apply needs --expect=<n>: state the number of accounts you reviewed.');
}
const expected = Number(declared);
if (!Number.isInteger(expected) || expected <= 0) {
  die(`--expect must be a positive integer, got ${declared}`);
}

const sql =
  `SELECT jsonb_pretty(cortex.stamp_team_roster(` +
  `${literal(JSON.stringify(entries))}::jsonb, ${expected}, ${literal(artifact)}, ${APPLY ? 'false' : 'true'}))`;

const run = psql(sql);
if (run.status !== 0) {
  console.error((run.stderr ?? '').trim());
  die('the roster was refused. Nothing was changed — the function validates in full before it writes.');
}

console.log(
  APPLY
    ? `✓ roster applied — artifact ${artifact}`
    : `✓ roster plan — artifact ${artifact} (nothing was changed; re-run with --expect=${expected} --apply)`,
);
console.log(run.stdout.trim());

if (APPLY) {
  console.log(
    '\nThe stamp moved BOTH halves of each account\'s authority: the trusted\n' +
      'app_metadata AND the MARQ organization membership row, through the one\n' +
      'authoritative membership write (migration 20260820120000). The\n' +
      '`memberships` array above reports what each row now stands for.\n' +
      '\nNo bootstrap run is needed for these accounts. To confirm nothing is\n' +
      'left disagreeing across the whole deployment:\n' +
      '  psql "$DATABASE_URL" -c "SELECT * FROM cortex.team_authority_drift()"',
  );
}
