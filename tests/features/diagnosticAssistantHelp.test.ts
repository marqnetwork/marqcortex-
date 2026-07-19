/**
 * BATCH 6 — Diagnostic AIAssistant deterministic-help governance tests
 *
 * The in-diagnostic assistant (MQC-COMP-049) guides users through the
 * questionnaire. Core Rule: "Math decides priority. LLM only explains
 * decisions." These tests lock the guarantee that its guidance is produced by
 * DETERMINISTIC keyword routing — never an LLM and never randomness:
 *   - identical inputs always yield identical output (determinism),
 *   - progress milestones (first / halfway / final) route to encouragement,
 *   - question keywords route to the correct help bucket + suggestions,
 *   - the industry table is a pure static lookup,
 *   - the module imports no LLM/gateway/network dependency.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  generateContextualHelp,
  getIndustryExample,
} from '../../src/app/core/diagnosticAssistantHelp.ts';

describe('diagnostic assistant — determinism', () => {
  it('returns identical output for identical inputs (no randomness, no LLM)', () => {
    const args = [
      'How much time do you spend on this each week?',
      4,
      10,
      'Professional Services',
      [],
    ] as const;
    const a = generateContextualHelp(...args);
    const b = generateContextualHelp(...args);
    assert.deepEqual(a, b);
  });
});

describe('diagnostic assistant — progress milestones', () => {
  it('welcomes on the first question', () => {
    const msg = generateContextualHelp('Anything', 1, 10, 'Manufacturing', []);
    assert.equal(msg.type, 'encouragement');
    assert.match(msg.content, /Welcome/);
  });

  it('celebrates the halfway point', () => {
    const msg = generateContextualHelp('Anything', 5, 10, 'Manufacturing', []);
    assert.equal(msg.type, 'encouragement');
    assert.match(msg.content, /halfway/i);
  });

  it('flags the final question', () => {
    const msg = generateContextualHelp('Anything', 10, 10, 'Manufacturing', []);
    assert.equal(msg.type, 'encouragement');
    assert.match(msg.content, /Final question/i);
  });
});

describe('diagnostic assistant — keyword routing', () => {
  const cases: Array<[string, RegExp, number]> = [
    ['How many hours do you spend?', /typical week/i, 4],
    ['Describe your current process', /workflow/i, 4],
    ['How large is your team?', /everyone involved/i, 4],
    ['What is your monthly budget?', /direct costs/i, 4],
    ['What is your biggest challenge?', /bottleneck/i, 4],
    ['How do you handle your data?', /collect, organize/i, 4],
    ['What software do you use?', /main tools/i, 4],
  ];

  for (const [question, contentMatch, suggestionCount] of cases) {
    it(`routes "${question}" to a help bucket with suggestions`, () => {
      // questionNumber 3 of 10 avoids the milestone branches
      const msg = generateContextualHelp(question, 3, 10, 'Professional Services', []);
      assert.equal(msg.type, 'help');
      assert.match(msg.content, contentMatch);
      assert.equal(msg.suggestions?.length, suggestionCount);
    });
  }

  it('falls back to a known industry example when no keyword matches', () => {
    const msg = generateContextualHelp('Tell us about your business', 3, 10, 'Professional Services', []);
    assert.equal(msg.type, 'suggestion');
    assert.ok((msg.suggestions?.length ?? 0) > 0);
  });

  it('falls back to generic help for an unknown industry and no keyword', () => {
    const msg = generateContextualHelp('Tell us about your business', 3, 10, 'Nonexistent Industry', []);
    assert.equal(msg.type, 'help');
    assert.equal(msg.suggestions, undefined);
  });
});

describe('diagnostic assistant — industry table is a pure static lookup', () => {
  it('returns curated examples for a known industry', () => {
    const ex = getIndustryExample('Manufacturing', 'any question');
    assert.ok(Array.isArray(ex));
    assert.ok((ex?.length ?? 0) > 0);
  });

  it('returns null for an unknown industry', () => {
    assert.equal(getIndustryExample('Unknown', 'any question'), null);
  });

  it('ignores the question argument (lookup keyed only on industry)', () => {
    const a = getIndustryExample('Manufacturing', 'question one');
    const b = getIndustryExample('Manufacturing', 'a completely different question');
    assert.deepEqual(a, b);
  });
});

describe('diagnostic assistant — no LLM / network dependency', () => {
  it('source imports nothing (self-contained deterministic module)', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../src/app/core/diagnosticAssistantHelp.ts', import.meta.url)),
      'utf8',
    );
    // No import statements at all — proves no gateway/LLM/network coupling.
    assert.equal(/^\s*import\s/m.test(src), false);
    // Defensive: none of the AI/network primitives appear in the source.
    for (const forbidden of ['fetch(', 'openai', 'gateway', 'anthropic', 'Math.random']) {
      assert.equal(src.toLowerCase().includes(forbidden.toLowerCase()), false, `must not reference ${forbidden}`);
    }
  });
});
