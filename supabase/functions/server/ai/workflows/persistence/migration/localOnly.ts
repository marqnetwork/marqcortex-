/**
 * The local-only database guard (BP-004 / A2, §15).
 *
 * ── LOAD-BEARING, AND A WARNING WOULD NOT BE ───────────────────────────────
 *
 * BP-004 proves a migration WITHOUT touching a hosted system. The moment a
 * preflight command accepts a connection target, the distance between "a local
 * rehearsal" and "a write against production" is one shell variable that
 * somebody exported in a previous session and forgot. A warning does not close
 * that distance — it scrolls past.
 *
 * So the rule is a refusal, and it is written as a classifier rather than as a
 * check inside a script, because a rule that can be unit-tested against every
 * environment shape is a rule that has actually been tested. The scripts call
 * it and exit; they do not re-implement it.
 *
 * ── libpq CHOOSES A TARGET FROM MORE THAN ONE PLACE ────────────────────────
 *
 * This is the correction that matters, and the first version of this file got
 * it wrong. It read `DATABASE_URL` and `PGHOST` and believed it had seen the
 * connection. libpq has not finished looking at that point:
 *
 *   PGHOSTADDR    is the NETWORK ADDRESS, and it WINS. When it is set, `PGHOST`
 *                 is used only for authentication and certificate matching. So
 *                 `PGHOST=localhost PGHOSTADDR=203.0.113.10` reads as loopback
 *                 and connects to 203.0.113.10. A guard that checked `PGHOST`
 *                 would have approved that.
 *   PGSERVICE     names a stanza in a service file that supplies host, port,
 *                 database and user wholesale. The environment then contains no
 *                 hostname at all, and the connection still goes somewhere.
 *   PGSERVICEFILE chooses which file those stanzas come from.
 *   hostaddr=     the URI spelling of the first.
 *   service=      the URI spelling of the second.
 *   multi-host    `PGHOST=/var/run/postgresql,remote.example.com` and the URI
 *                 forms of it offer libpq a LIST to try in order. One local
 *                 entry does not make the list local.
 *
 * And one more the first version also missed: a URI that names NO host
 * (`postgresql:///scratch`) does not mean the Unix socket — libpq falls back to
 * `PGHOST`. So "the URL is present" was never a reason to stop reading the
 * environment.
 *
 * ── SO THE RULE IS NOT "PARSE THE CONNECTION STRING" ───────────────────────
 *
 * It is: COLLECT THE LOCATION FACTS, AND REFUSE UNLESS THERE IS EXACTLY ONE
 * AND IT IS LOCAL.
 *
 * This is deliberately STRICTER than libpq rather than a reimplementation of
 * it. BP-004 needs one local database. It does not need service files, address
 * overrides or host lists, so those are refused outright instead of being
 * understood — a feature that is refused cannot be misunderstood, and a
 * classifier that tried to keep up with libpq would be a second implementation
 * of libpq's precedence rules with its own bugs.
 *
 * ── FAIL CLOSED MEANS UNPARSEABLE IS REFUSED ───────────────────────────────
 *
 * A connection string this module cannot parse is REFUSED, not accepted with a
 * shrug. "We could not tell where this points" and "this points somewhere safe"
 * are different answers, and only one of them is true.
 *
 * ── CLASSIFYING IS HALF THE JOB ────────────────────────────────────────────
 *
 * A verdict about the environment is worthless if the child process is then
 * handed a different environment. `localDatabaseEnvironment` strips the
 * selectors this module refuses to reason about, so the `psql` child receives
 * only the location mechanism that was actually validated. Authentication
 * variables are left alone: removing `PGPASSWORD` would not make anything safer
 * and would break a legitimate local setup that needs it.
 */

/** Every host a BP-004 command may reach. Nothing is added without a packet. */
export const LOCAL_DATABASE_HOSTS: readonly string[] = [
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
];

/**
 * Environment variables that can move a connection, and that BP-004 refuses
 * outright rather than interpreting.
 *
 * `PGHOSTADDR` could in principle be proven loopback. It is refused instead,
 * because BP-004 has no use for it: the only reason to name an address
 * separately from a host is to reach a host whose name does not resolve the way
 * you want, which is not a thing a local rehearsal does.
 */
export const REFUSED_LOCATION_VARIABLES: readonly string[] = [
  'PGHOSTADDR',
  'PGSERVICE',
  'PGSERVICEFILE',
];

/**
 * What the `psql` child must not inherit.
 *
 * `PGSYSCONFDIR` is here but NOT in the refusal list above, and the difference
 * is deliberate. On its own it only says where `pg_service.conf` lives, and
 * with no service named it moves nothing — refusing a run because of it would
 * be a refusal with no threat behind it. Stripping it costs nothing and removes
 * the last way a service definition could reach the child.
 */
export const STRIPPED_LOCATION_VARIABLES: readonly string[] = [
  ...REFUSED_LOCATION_VARIABLES,
  'PGSYSCONFDIR',
];

/** URI parameters that can move a connection. Same reasoning, same refusal. */
const REFUSED_URI_PARAMETERS: readonly string[] = ['hostaddr', 'service'];

/** The connection schemes a PostgreSQL URL may carry. */
const POSTGRES_SCHEMES: readonly string[] = ['postgres:', 'postgresql:'];

export type LocalDatabaseVerdict =
  | { readonly ok: true; readonly host: string; readonly reason: string }
  | { readonly ok: false; readonly problem: string };

/** A Unix socket directory rather than a hostname. */
function isSocketPath(host: string): boolean {
  return host.startsWith('/');
}

/**
 * An exact match against the allow-list, case-insensitively.
 *
 * Exact, and nothing clever. `127.0.0.1.` and `0x7f.1` both resolve to loopback
 * and both are refused here, which is the correct direction for an allow-list:
 * the cost of refusing an exotic spelling of localhost is that somebody types
 * `localhost`, and the cost of accepting one is that the next exotic spelling
 * nobody thought about is accepted too.
 */
function permitted(host: string): boolean {
  return LOCAL_DATABASE_HOSTS.includes(host.toLowerCase());
}

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** One host value: a socket directory, a loopback name, or a refusal. */
function classifyHostValue(value: string, origin: string): LocalDatabaseVerdict {
  // A LIST IS NOT A HOST. libpq would try each entry in turn, so one local
  // entry proves nothing about where the connection ends up.
  if (value.includes(',')) {
    return { ok: false, problem: `${origin} names more than one host; BP-004 connects to exactly one local database` };
  }
  if (isSocketPath(value)) {
    return { ok: true, host: value, reason: `${origin} names a local Unix socket directory` };
  }
  if (permitted(value)) {
    return { ok: true, host: value, reason: `${origin} names a loopback address` };
  }
  return { ok: false, problem: `${origin} host ${value} is not a local database host` };
}

/** `PGHOST`, or the absence of it, which is the local socket. */
function classifyPgHost(env: Readonly<Record<string, string | undefined>>): LocalDatabaseVerdict {
  const host = present(env.PGHOST);
  if (host === undefined) {
    return { ok: true, host: 'unix-socket', reason: 'no host is named anywhere: the local Unix socket' };
  }
  return classifyHostValue(host, 'PGHOST');
}

/**
 * Where this command would connect, and whether BP-004 may go there.
 *
 * The environment is passed in rather than read, so this module holds no
 * process environment of its own and the workflow tree's boundary claim is
 * unaffected by its presence.
 */
export function classifyDatabaseTarget(
  env: Readonly<Record<string, string | undefined>>,
): LocalDatabaseVerdict {
  // ── The redirectors, before any hostname is looked at ────────────────────
  //
  // FIRST, and not last. `PGHOSTADDR` beats `PGHOST`, so a classifier that
  // decided on a hostname and then checked for these would have already formed
  // the wrong opinion.
  for (const name of REFUSED_LOCATION_VARIABLES) {
    if (present(env[name]) !== undefined) {
      return {
        ok: false,
        problem: `${name} is set; BP-004 refuses every connection selector except a single local host`,
      };
    }
  }

  const url = present(env.DATABASE_URL);
  if (url === undefined) return classifyPgHost(env);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // FAIL CLOSED. A multi-host URI carrying ports (`host1:5432,host2:5432`)
    // lands here as well, which is the right answer for the right reason.
    return { ok: false, problem: 'DATABASE_URL could not be parsed as a connection URL' };
  }

  if (!POSTGRES_SCHEMES.includes(parsed.protocol.toLowerCase())) {
    return { ok: false, problem: `DATABASE_URL scheme ${parsed.protocol} is not a PostgreSQL scheme` };
  }

  for (const parameter of REFUSED_URI_PARAMETERS) {
    if (present(parsed.searchParams.get(parameter) ?? undefined) !== undefined) {
      return {
        ok: false,
        problem: `DATABASE_URL carries ${parameter}=; BP-004 refuses every connection selector except a single local host`,
      };
    }
  }

  // `postgresql:///scratch?host=/var/run/postgresql` is the socket spelling,
  // and the parameter is the host in it — so it is read, not ignored.
  const hostParameter = present(parsed.searchParams.get('host') ?? undefined);
  if (hostParameter !== undefined) return classifyHostValue(hostParameter, 'DATABASE_URL host=');

  const hostname = present(parsed.hostname);
  if (hostname !== undefined) return classifyHostValue(hostname, 'DATABASE_URL');

  // A URI WITH NO HOST DOES NOT MEAN THE SOCKET. libpq falls back to `PGHOST`
  // here, so the environment is still in play and reading it is the only way to
  // know where this would land.
  return classifyPgHost(env);
}

/**
 * The environment the `psql` child is allowed to inherit.
 *
 * Classification alone is not a control: the verdict describes the environment
 * this process read, and the child gets whatever it is handed. Stripping the
 * selectors this module refuses to reason about is what makes the two the same
 * environment.
 *
 * Authentication variables are deliberately untouched. `PGPASSWORD`,
 * `PGSSLMODE` and their neighbours say how to prove who you are once a target
 * is chosen; they cannot choose a different target, and removing them would
 * break a legitimate local setup for the appearance of tidiness.
 */
export function localDatabaseEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const sanitized: Record<string, string | undefined> = { ...env };
  for (const name of STRIPPED_LOCATION_VARIABLES) delete sanitized[name];
  return sanitized;
}

// ── The scratch database ────────────────────────────────────────────────────

/**
 * The one database name a BP-004 rehearsal may create and drop.
 *
 * It was configurable. It is not any more, and that is the whole fix: the name
 * was interpolated into `CREATE DATABASE` and `DROP DATABASE ... WITH (FORCE)`,
 * so a mistyped environment variable was a dropped database, and a hostile one
 * was a statement of the author's choosing. A rehearsal has no need to run
 * against a name somebody supplies, so there is nothing to validate — there is
 * only one name.
 *
 * The classifier below remains because the CONSTANT still has to be safe: it is
 * checked at run time, so an edit that changed it to something dangerous fails
 * closed instead of executing.
 */
export const BP004_SCRATCH_DATABASE = 'cortex_workflow_cutover_readiness';

/** Cortex-owned, lower-case, no punctuation a statement could be built from. */
const SCRATCH_DATABASE_NAME = /^cortex_[a-z0-9_]{1,50}$/;

/** Names no rehearsal may touch, whatever else it satisfies. */
const PROTECTED_DATABASES: readonly string[] = ['postgres', 'template0', 'template1'];

export type ScratchDatabaseVerdict =
  | { readonly ok: true; readonly name: string; readonly quoted: string }
  | { readonly ok: false; readonly problem: string };

/**
 * Whether a name may be created and dropped by a BP-004 rehearsal.
 *
 * The pattern admits no quote, comma, semicolon, space or hyphen, so the
 * quoting below cannot be escaped out of — and the name is quoted anyway,
 * because a guard and an escape are different mechanisms and relying on one to
 * make the other unnecessary is how the next edit to the pattern becomes an
 * injection.
 */
export function classifyScratchDatabaseName(name: string): ScratchDatabaseVerdict {
  if (!SCRATCH_DATABASE_NAME.test(name)) {
    return {
      ok: false,
      problem: `${JSON.stringify(name)} is not a Cortex scratch database name`,
    };
  }
  if (PROTECTED_DATABASES.includes(name)) {
    return { ok: false, problem: `${name} is a protected database and is never a scratch target` };
  }
  return { ok: true, name, quoted: `"${name}"` };
}
