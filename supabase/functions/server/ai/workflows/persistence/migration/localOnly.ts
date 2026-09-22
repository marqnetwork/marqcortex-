/**
 * The local-only database guard (BP-004 / A2, §15).
 *
 * ── LOAD-BEARING, AND A WARNING WOULD NOT BE ───────────────────────────────
 *
 * BP-004 proves a migration WITHOUT touching a hosted system. The moment a
 * preflight command accepts a connection string, the distance between "a local
 * rehearsal" and "a write against production" is one shell variable that
 * somebody exported in a previous session and forgot. A warning does not close
 * that distance — it scrolls past.
 *
 * So the rule is a refusal, and it is written as a classifier rather than as a
 * check inside a script, because a rule that can be unit-tested against every
 * connection string shape is a rule that has actually been tested. The scripts
 * call it and exit; they do not re-implement it.
 *
 * ── FAIL CLOSED MEANS UNPARSEABLE IS REFUSED ───────────────────────────────
 *
 * A connection string this module cannot parse is REFUSED, not accepted with a
 * shrug. "We could not tell where this points" and "this points somewhere safe"
 * are different answers, and only one of them is true.
 *
 * ── WHAT IS PERMITTED ──────────────────────────────────────────────────────
 *
 * The loopback names, and a local Unix socket — which is how this repository's
 * other live database suites already reach a database, and which cannot leave
 * the machine at all.
 */

/** Every host a BP-004 command may reach. Nothing is added without a packet. */
export const LOCAL_DATABASE_HOSTS: readonly string[] = [
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
];

/** The connection schemes a PostgreSQL URL may carry. */
const POSTGRES_SCHEMES: readonly string[] = ['postgres:', 'postgresql:'];

export type LocalDatabaseVerdict =
  | { readonly ok: true; readonly host: string; readonly reason: string }
  | { readonly ok: false; readonly problem: string };

/** A Unix socket directory rather than a hostname. */
function isSocketPath(host: string): boolean {
  return host.startsWith('/');
}

function permitted(host: string): boolean {
  return LOCAL_DATABASE_HOSTS.includes(host.toLowerCase());
}

/**
 * Where a connection string points, and whether BP-004 may go there.
 *
 * The environment is passed in rather than read, so this module holds no
 * `Deno.env` and no `process.env` and the workflow tree's boundary claim is
 * unaffected by its presence.
 */
export function classifyDatabaseTarget(
  env: Readonly<Record<string, string | undefined>>,
): LocalDatabaseVerdict {
  const url = env.DATABASE_URL?.trim();

  if (url === undefined || url === '') {
    const host = env.PGHOST?.trim();
    if (host === undefined || host === '') {
      return {
        ok: true,
        host: 'unix-socket',
        reason: 'no DATABASE_URL and no PGHOST: the local Unix socket',
      };
    }
    if (isSocketPath(host)) {
      return { ok: true, host, reason: 'PGHOST names a local Unix socket directory' };
    }
    if (permitted(host)) return { ok: true, host, reason: 'PGHOST names a loopback address' };
    return { ok: false, problem: `PGHOST=${host} is not a local database host` };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // FAIL CLOSED. See the header.
    return { ok: false, problem: 'DATABASE_URL could not be parsed as a connection URL' };
  }

  if (!POSTGRES_SCHEMES.includes(parsed.protocol.toLowerCase())) {
    return { ok: false, problem: `DATABASE_URL scheme ${parsed.protocol} is not a PostgreSQL scheme` };
  }

  // `postgresql:///db?host=/var/run/postgresql` is the socket form, and the
  // query parameter is the host in that spelling — so it is read, not ignored.
  const hostParameter = parsed.searchParams.get('host')?.trim();
  if (hostParameter !== undefined && hostParameter !== '') {
    if (isSocketPath(hostParameter)) {
      return {
        ok: true,
        host: hostParameter,
        reason: 'DATABASE_URL names a local Unix socket directory',
      };
    }
    if (!permitted(hostParameter)) {
      return { ok: false, problem: `DATABASE_URL host=${hostParameter} is not a local database host` };
    }
  }

  const hostname = parsed.hostname;
  if (hostname === '') {
    return { ok: true, host: 'unix-socket', reason: 'DATABASE_URL names no host: the local socket' };
  }
  if (!permitted(hostname)) {
    return { ok: false, problem: `DATABASE_URL host ${hostname} is not a local database host` };
  }
  return { ok: true, host: hostname, reason: 'DATABASE_URL names a loopback address' };
}
