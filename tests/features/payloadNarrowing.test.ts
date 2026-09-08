/**
 * UI SPRINT 7 — the defect class where a 200 takes down a panel.
 *
 * THE SHAPE OF IT
 *   Every read in `src/app/lib/api.ts` ends `return data as { … }`. That is an
 *   assertion, not a check: it tells the compiler what the field will be and
 *   verifies nothing at runtime. A 200 whose body lacks the field — a partially
 *   rolled-out deploy, a gateway answering with its own payload, an error object
 *   returned with the wrong status, a route renamed server-side — yields
 *   `undefined`, the component writes `undefined` into state it has typed as an
 *   array, and the next render calls `.length` or `.map` on it and throws.
 *
 *   Reproduced in the browser against a stubbed backend on the NOTIFICATION
 *   CENTRE, which the shell renders in its header on every page: one malformed
 *   response replaced the whole console with the route error boundary. Six other
 *   components had the identical shape.
 *
 * WHAT IS GUARDED
 *   1. `asArray` and its siblings behave, including on the values that are
 *      `typeof 'number'` but unusable (`NaN`, `Infinity`) and the ones that are
 *      `typeof 'object'` but not objects (`null`, arrays).
 *   2. Every site that wrote an unchecked payload field into array state now
 *      narrows it, and none of them has quietly reverted.
 *
 * WHAT IS NOT CLAIMED
 *   This is not validation. An array of the WRONG OBJECTS still gets through;
 *   catching that needs a schema, which is a larger decision than this. The
 *   guarantee is narrower and exact: a component that asked for a list gets a
 *   list, so rendering it cannot throw.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { asArray, asNumber, asText, asObject } from '../../src/app/lib/payload.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

describe('asArray always yields something renderable', () => {
  it('passes an array through unchanged, identity included', () => {
    const input = [1, 2, 3];
    assert.equal(asArray(input), input);
    assert.deepEqual(asArray([]), []);
  });

  it('turns every non-array into an empty array', () => {
    for (const value of [undefined, null, 0, 1, '', 'abc', true, false, {}, { length: 3 }, () => {}, NaN]) {
      assert.deepEqual(asArray(value), [], `${String(value)} did not narrow`);
    }
  });

  it('rejects the array-like that is the whole point — an object with a length', () => {
    // `{ length: 3 }` satisfies `.length` and then explodes on `.map`, which is
    // exactly the failure mode a naive `value?.length ?? 0` guard leaves open.
    const narrowed = asArray({ length: 3 });
    assert.deepEqual(narrowed, []);
    assert.doesNotThrow(() => narrowed.map(x => x));
  });
});

describe('asNumber rejects the numbers that are not usable numbers', () => {
  it('passes finite numbers, including zero and negatives', () => {
    for (const value of [0, -1, 42, 3.5]) assert.equal(asNumber(value), value);
  });

  it('rejects NaN and Infinity, which are both typeof number', () => {
    assert.equal(asNumber(NaN), 0);
    assert.equal(asNumber(Infinity), 0);
    assert.equal(asNumber(-Infinity), 0);
  });

  it('rejects everything that is not a number', () => {
    for (const value of [undefined, null, '5', true, [], {}]) assert.equal(asNumber(value), 0);
  });

  it('honours an explicit fallback', () => {
    assert.equal(asNumber(undefined, -1), -1);
    assert.equal(asNumber(NaN, 7), 7);
  });
});

describe('asText and asObject', () => {
  it('treats an empty string as absent', () => {
    assert.equal(asText(''), '');
    assert.equal(asText('', 'unknown'), 'unknown');
    assert.equal(asText('hello'), 'hello');
    assert.equal(asText(0, 'unknown'), 'unknown');
  });

  it('distinguishes an object from null and from an array', () => {
    assert.deepEqual(asObject({ a: 1 }), { a: 1 });
    assert.equal(asObject(null), null);
    assert.equal(asObject([1, 2]), null, 'an array is typeof object but is not one');
    assert.equal(asObject(undefined), null);
    assert.equal(asObject('x'), null);
  });
});

describe('every site that wrote an unchecked list into state now narrows it', () => {
  const SITES: [file: string, setter: string][] = [
    ['src/app/components/EngagementActivityFeed.tsx', 'setEvents'],
    ['src/app/components/ObjectionHandlerPanel.tsx', 'setEscalations'],
    ['src/app/components/TeamManagement.tsx', 'setMembers'],
    ['src/app/components/ProposalAnnotationLayer.tsx', 'setAnnotations'],
    ['src/app/components/SubmissionNotesPanel.tsx', 'setNotes'],
    ['src/app/components/RevenueIntelligenceDashboard.tsx', 'setSnapshots'],
  ];

  for (const [file, setter] of SITES) {
    it(`${file.split('/').pop()} narrows before ${setter}`, () => {
      const source = read(file);
      assert.ok(
        source.includes("from '@/app/lib/payload'"),
        `${file} no longer imports the narrowing helper`,
      );
      // The specific regression: the raw field handed straight to the setter.
      assert.ok(
        !new RegExp(`${setter}\\(res\\.[a-zA-Z]+\\);`).test(source),
        `${file} writes an unchecked payload field into state again`,
      );
    });
  }

  it('the notification centre still narrows both of its fields', () => {
    const bell = read('src/app/components/NotificationCenter.tsx');
    assert.match(bell, /setNotifications\(Array\.isArray\(res\?\.notifications\)/);
    assert.match(bell, /Number\.isFinite\(res\.unreadCount\)/);
  });
});
