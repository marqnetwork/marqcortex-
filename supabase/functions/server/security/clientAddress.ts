/**
 * Who the request actually came from.
 *
 * `X-Forwarded-For` is written by the client first and appended to by every
 * proxy in between, so the header is a mix of hearsay and fact:
 *
 *     X-Forwarded-For: <client's claim>, <appended by proxy 1>, <appended by proxy 2>
 *                       └── forgeable ──┘  └────────── observed addresses ────────┘
 *
 * Each entry is the address of the peer the appending proxy heard from. So the
 * RIGHTMOST entry is the one written closest to us and is the only part a
 * caller cannot control: a client that sends `X-Forwarded-For: 1.2.3.4` gets
 * its real address appended AFTER that claim, not before it. The leftmost entry
 * — the one this codebase used to take — is whatever the caller typed.
 *
 * That mattered in two places:
 *
 *   1. The edge rate limiter keyed its per-caller bucket on it. Rotating the
 *      header gave every request a fresh bucket, so the limit never bound.
 *   2. `clientIp` is recorded in the provider-administration AUDIT TRAIL. An
 *      attacker-chosen string was being written into the forensic record of a
 *      privileged mutation.
 *
 * Reading from the right is a strict improvement under every deployment: behind
 * one or more appending proxies it is the observed address; behind none there is
 * a single entry and right and left are the same value.
 *
 * ── WHY THE VALUE IS PARSED, NOT JUST TRIMMED ──────────────────────────────
 *
 * The audit record is the second reason. A header is arbitrary bytes, and the
 * old path stored whatever arrived — a megabyte of text, or a string shaped to
 * look like a neighbouring field when someone reads the log back. Only something
 * that parses as an IPv4 or IPv6 address is stored; anything else is recorded as
 * absent, which is honest, rather than as a fabrication that reads as fact.
 */

/** The header bag, in the shape both Hono's `c.req.header` and a plain map offer. */
export type HeaderLookup = (name: string) => string | undefined | null;

/** Longest address text worth parsing: IPv6 with a zone and a port, generously. */
const MAX_ADDRESS_LENGTH = 64;

/** Longest header worth walking, so a huge forged chain is not scanned in full. */
const MAX_HEADER_LENGTH = 4_096;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIpv4(value: string): boolean {
  const match = IPV4.exec(value);
  if (!match) return false;
  // `010.1.1.1` parses as 10.1.1.1 in some resolvers and as octal in others.
  // Ambiguous is not valid.
  return match.slice(1).every((octet) => {
    if (octet.length > 1 && octet.startsWith('0')) return false;
    const n = Number(octet);
    return n >= 0 && n <= 255;
  });
}

function isIpv6(value: string): boolean {
  // One `::` at most, hex groups otherwise, with a trailing IPv4 form allowed
  // (`::ffff:127.0.0.1`). Deliberately strict: this decides what is written to
  // an audit record, so "probably an address" is not good enough.
  const body = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if (body.length === 0 || body.length > MAX_ADDRESS_LENGTH) return false;
  if (!/^[0-9A-Fa-f:.]+$/.test(body)) return false;
  if ((body.match(/::/g) ?? []).length > 1) return false;

  const [head, tail = ''] = body.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === '' ? [] : tail.split(':');
  const groups = [...headGroups, ...tailGroups];

  let expected = 8;
  const last = groups[groups.length - 1];
  if (last !== undefined && last.includes('.')) {
    if (!isIpv4(last)) return false;
    groups.pop();
    expected = 6; // the embedded IPv4 occupies the final two groups
  }

  if (groups.some((group) => group === '' || !/^[0-9A-Fa-f]{1,4}$/.test(group))) return false;
  return body.includes('::') ? groups.length <= expected : groups.length === expected;
}

/** Strip a `[v6]:port` or `v4:port` wrapper without accepting a bare `a:b`. */
function stripPort(value: string): string {
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close > 0) return value.slice(0, close + 1);
    return value;
  }
  const colons = (value.match(/:/g) ?? []).length;
  if (colons === 1) return value.slice(0, value.indexOf(':'));
  return value;
}

/** Normalize one candidate to a stored address, or `null` if it is not one. */
export function parseAddress(candidate: string): string | null {
  const trimmed = stripPort(candidate.trim());
  if (trimmed.length === 0 || trimmed.length > MAX_ADDRESS_LENGTH) return null;
  if (isIpv4(trimmed)) return trimmed;
  if (isIpv6(trimmed)) {
    return trimmed.startsWith('[') ? trimmed.slice(1, -1).toLowerCase() : trimmed.toLowerCase();
  }
  return null;
}

/**
 * The address the nearest proxy observed, or `null` when nothing verifiable was
 * present.
 *
 * `null` is a real answer and callers must treat it as one: the rate limiter
 * buckets it as a single shared scope rather than letting it through, and the
 * audit trail omits the field rather than recording a guess.
 */
export function clientAddress(header: HeaderLookup): string | null {
  const forwarded = header('x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const scanned = forwarded.length > MAX_HEADER_LENGTH
      ? forwarded.slice(-MAX_HEADER_LENGTH)
      : forwarded;
    const parts = scanned.split(',');
    // From the right: the appended, observed entries come last.
    for (let i = parts.length - 1; i >= 0; i--) {
      const address = parseAddress(parts[i]);
      if (address !== null) return address;
    }
  }

  // Only when there is no forwarding chain at all. `x-real-ip` is a single
  // value with no append semantics, so it carries no evidence of a proxy hop
  // and is the weaker source — it is the fallback, never the preference.
  const real = header('x-real-ip');
  if (typeof real === 'string' && real.length > 0) return parseAddress(real);

  return null;
}
