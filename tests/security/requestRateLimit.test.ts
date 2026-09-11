/**
 * The edge rate limiter and the address it keys on — S-2 and S-3.
 *
 * Both findings came from the same mistake: `X-Forwarded-For.split(',')[0]` is
 * the part of the header the CALLER wrote. It was the rate limiter's bucket key,
 * so rotating it turned the limiter off; and it was the `clientIp` recorded in
 * the provider-administration audit trail, so it wrote an attacker-chosen string
 * into the forensic record of a privileged mutation.
 *
 * The tests below are written as the attack first — the rotation, the forged
 * left-hand entry, the flood — and then the property that must hold under it.
 * Several of them fail against the code this replaces; that is the point.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clientAddress, parseAddress } from '../../supabase/functions/server/security/clientAddress.ts';
import {
  createRequestRateLimiter,
  DEFAULT_MAX_PER_CALLER,
} from '../../supabase/functions/server/security/requestRateLimit.ts';

/** A header bag in the shape `c.req.header` presents. */
function headers(bag: Record<string, string>) {
  return (name: string) => bag[name.toLowerCase()];
}

describe('client address — the forwarding chain is read from the right', () => {
  it('takes the entry the nearest proxy appended, not the one the caller sent', () => {
    // The caller wrote `1.2.3.4`; the proxy appended what it actually saw.
    const address = clientAddress(headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }));
    assert.equal(address, '203.0.113.7');
  });

  it('is unchanged by anything the caller prepends', () => {
    const real = '203.0.113.7';
    const forged = ['', '9.9.9.9', 'not-an-ip', '::1', '127.0.0.1, 10.0.0.1'];
    for (const prefix of forged) {
      const chain = prefix.length > 0 ? `${prefix}, ${real}` : real;
      assert.equal(
        clientAddress(headers({ 'x-forwarded-for': chain })),
        real,
        `prefix ${JSON.stringify(prefix)} changed the derived address`,
      );
    }
  });

  it('behaves identically when there is no proxy at all', () => {
    assert.equal(clientAddress(headers({ 'x-forwarded-for': '203.0.113.7' })), '203.0.113.7');
  });

  it('records nothing rather than recording a fabrication', () => {
    // Everything here would have been written verbatim into the audit trail.
    for (const junk of [
      'unknown',
      'null',
      '<script>alert(1)</script>',
      '1.2.3.4" role="platform_admin',
      'x'.repeat(10_000),
      '999.999.999.999',
      '010.1.1.1',
      '   ',
    ]) {
      assert.equal(
        clientAddress(headers({ 'x-forwarded-for': junk })),
        null,
        `${junk.slice(0, 24)} was accepted as an address`,
      );
    }
  });

  it('accepts the address forms that really arrive', () => {
    assert.equal(parseAddress('203.0.113.7'), '203.0.113.7');
    assert.equal(parseAddress('203.0.113.7:44321'), '203.0.113.7');
    assert.equal(parseAddress('2001:db8::1'), '2001:db8::1');
    assert.equal(parseAddress('[2001:db8::1]:8443'), '2001:db8::1');
    assert.equal(parseAddress('::ffff:127.0.0.1'), '::ffff:127.0.0.1');
    assert.equal(parseAddress('::1'), '::1');
  });

  it('prefers the forwarding chain over x-real-ip, and falls back to it', () => {
    assert.equal(
      clientAddress(headers({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '9.9.9.9' })),
      '203.0.113.7',
    );
    assert.equal(clientAddress(headers({ 'x-real-ip': '9.9.9.9' })), '9.9.9.9');
    assert.equal(clientAddress(headers({})), null);
  });
});

describe('edge rate limiter — the limit binds under the bypass attempt', () => {
  it('refuses the caller after its allowance regardless of what it prepends', () => {
    const limiter = createRequestRateLimiter({ now: () => 1_000 });
    let refused = 0;

    // The attack: a different forged left-hand entry on every single request.
    for (let i = 0; i < DEFAULT_MAX_PER_CALLER + 40; i++) {
      const decision = limiter.check(
        headers({ 'x-forwarded-for': `10.0.${(i >> 8) & 255}.${i & 255}, 203.0.113.7` }),
      );
      if (!decision.allowed) refused++;
    }

    assert.equal(refused, 40, 'rotation still bought extra requests');
    assert.equal(limiter.size(), 1, 'rotation still created a bucket per request');
  });

  it('shares one bucket across callers it cannot identify', () => {
    const limiter = createRequestRateLimiter({ now: () => 1_000, maxPerCaller: 3 });
    // No usable header at all, each time by a different route to "unknown".
    assert.equal(limiter.check(headers({})).allowed, true);
    assert.equal(limiter.check(headers({ 'x-forwarded-for': 'bogus' })).allowed, true);
    assert.equal(limiter.check(headers({ 'x-real-ip': '' })).allowed, true);
    assert.equal(limiter.check(headers({ 'x-forwarded-for': 'also-bogus' })).allowed, false);
  });

  it('keeps distinct real callers independent', () => {
    const limiter = createRequestRateLimiter({ now: () => 1_000, maxPerCaller: 2 });
    const a = headers({ 'x-forwarded-for': '203.0.113.7' });
    const b = headers({ 'x-forwarded-for': '203.0.113.8' });

    assert.equal(limiter.check(a).allowed, true);
    assert.equal(limiter.check(a).allowed, true);
    assert.equal(limiter.check(a).allowed, false);
    // b is untouched by a exhausting its own allowance.
    assert.equal(limiter.check(b).allowed, true);
    assert.equal(limiter.check(b).allowed, true);
    assert.equal(limiter.check(b).allowed, false);
  });

  it('never tracks more callers than its cap, however many arrive', () => {
    const limiter = createRequestRateLimiter({ now: () => 1_000, maxTrackedCallers: 50 });
    for (let i = 0; i < 5_000; i++) {
      limiter.check(headers({ 'x-forwarded-for': `198.51.${(i >> 8) & 255}.${i & 255}` }));
    }
    assert.equal(limiter.size(), 50, 'the map grew past its cap');
  });

  it('releases a caller once its window has passed', () => {
    let clock = 1_000;
    const limiter = createRequestRateLimiter({
      now: () => clock,
      maxPerCaller: 1,
      windowMs: 60_000,
    });
    const caller = headers({ 'x-forwarded-for': '203.0.113.7' });

    assert.equal(limiter.check(caller).allowed, true);
    assert.equal(limiter.check(caller).allowed, false);
    clock += 60_001;
    assert.equal(limiter.check(caller).allowed, true, 'the window never reopened');
  });

  it('holds an isolate-wide ceiling that no per-caller spread gets past', () => {
    const limiter = createRequestRateLimiter({
      now: () => 1_000,
      maxPerCaller: 10,
      maxTotal: 25,
      maxTrackedCallers: 10_000,
    });

    // A distributed flood: every request from a genuinely different address, so
    // no per-caller bucket is ever near its own limit.
    let allowed = 0;
    for (let i = 0; i < 200; i++) {
      if (limiter.check(headers({ 'x-forwarded-for': `198.51.${(i >> 8) & 255}.${i & 255}` })).allowed) {
        allowed++;
      }
    }
    assert.equal(allowed, 25, 'the ceiling did not bind on a distributed flood');
  });

  it('reports headers a client can actually back off on', () => {
    const limiter = createRequestRateLimiter({ now: () => 60_000, maxPerCaller: 2, windowMs: 60_000 });
    const caller = headers({ 'x-forwarded-for': '203.0.113.7' });

    const first = limiter.check(caller);
    assert.equal(first.limit, 2);
    assert.equal(first.remaining, 1);
    assert.equal(first.resetSeconds, 120, 'reset is not the epoch second the window ends');

    limiter.check(caller);
    const refused = limiter.check(caller);
    assert.equal(refused.allowed, false);
    assert.equal(refused.remaining, 0);
    assert.equal(refused.refusedBy, 'caller');
  });
});

describe('the raw header never becomes a caller identity again', () => {
  const SERVER = new URL('../../supabase/functions/server/', import.meta.url);

  /** Every .ts/.tsx under the deployed server, excluding its tests. */
  async function serverSources(dir: URL): Promise<URL[]> {
    const { readdir } = await import('node:fs/promises');
    const found: URL[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) found.push(...(await serverSources(child)));
      else if (/\.tsx?$/.test(entry.name)) found.push(child);
    }
    return found;
  }

  it('no deployed source reads the leftmost forwarded-for entry', async () => {
    const { readFile } = await import('node:fs/promises');
    const offenders: string[] = [];

    for (const file of await serverSources(SERVER)) {
      const source = await readFile(file, 'utf8');
      // The exact shape the five route files carried, and the near variants of
      // it: any indexing into a split of the forwarding header.
      const pattern = /header\(\s*['"]x-forwarded-for['"]\s*\)[\s\S]{0,80}?\.split\(|x-forwarded-for['"][\s\S]{0,40}?\.split\([^)]*\)\s*\[\s*0\s*\]/gi;
      if (pattern.test(source)) offenders.push(file.pathname);
    }

    assert.deepEqual(
      offenders,
      [],
      'these read the caller-written half of X-Forwarded-For; use clientAddress() instead',
    );
  });

  it('the only place that reads the header at all is clientAddress', async () => {
    const { readFile } = await import('node:fs/promises');
    const readers: string[] = [];

    for (const file of await serverSources(SERVER)) {
      if (file.pathname.endsWith('/security/clientAddress.ts')) continue;
      const source = await readFile(file, 'utf8');
      // Comments explain the header; only code that calls header() reads it.
      if (/header\(\s*['"]x-(forwarded-for|real-ip)['"]\s*\)/i.test(source)) {
        readers.push(file.pathname);
      }
    }

    assert.deepEqual(readers, [], 'the forwarding headers have a single reader by design');
  });
});
