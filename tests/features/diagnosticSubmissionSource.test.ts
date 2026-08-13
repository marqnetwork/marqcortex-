/**
 * AI-01 BATCH 3B — THE PRODUCTION SUBMISSION SOURCE
 *
 * The certified readiness review reads a dossier: a submission, its answers, and
 * the SECTION each answer was asked under. Parts 7A–7E shipped with that port
 * unsupplied, because a stored submission records the answer and not the section
 * it was asked under, and a blank section is a wrong readiness result rather
 * than a missing one — `answer.category` is what the scoring engine counts to
 * decide how many sections a domain's evidence spans.
 *
 * `supabase/functions/server/diagnostic/` closes that: the question catalogue,
 * mirrored from the client's canonical one, and a read-only source that rebuilds
 * a dossier from the stored record. This suite holds both halves.
 *
 * ── THE MIRROR IS THE FIRST THING ASSERTED ─────────────────────────────────
 *
 * The canonical catalogue is DOM source authored against the Vite `@/…` aliases
 * and cannot be imported into the edge boundary — the same constraint
 * `readinessAuthority.ts` carries for the canonical scoring engines, answered
 * the same way. The client sources are PARSED here and compared field by field
 * against the server catalogue, so a question edited on one side and not the
 * other fails this suite instead of producing a review that describes an answer
 * with the wrong question.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DIAGNOSTIC_INDUSTRY_KEYS,
  DIAGNOSTIC_INDUSTRY_LABELS,
  DIAGNOSTIC_QUESTION_CATALOGUE,
  resolveDiagnosticIndustry,
} from '../../supabase/functions/server/diagnostic/questionCatalogue.ts';
import { createKvSubmissionDossierSource } from '../../supabase/functions/server/diagnostic/submissionDossierSource.ts';
import { computeReadinessAuthority } from '../../supabase/functions/server/ai/business/diagnostic/deterministic/readinessAuthority.ts';
import type { DiagnosticSubmissionDossier } from '../../supabase/functions/server/ai/business/diagnostic/contracts/dossier.ts';
import { diagnosticDossierSchema } from '../../supabase/functions/server/ai/business/diagnostic/contracts/dossier.ts';

// ── The canonical catalogue, read out of the client source ──────────────────

/** Read one JS string literal. `start` is the index of the opening quote. */
function readString(text: string, start: number): { value: string; end: number } | null {
  const quote = text[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let out = '';
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i += 1;
      continue;
    }
    if (ch === quote) return { value: out, end: i };
    out += ch;
  }
  return null;
}

/** The `[ … ]` an exported question array spans, string literals respected. */
function arraySpan(text: string, name: string): string {
  const at = text.indexOf(`export const ${name}`);
  assert.ok(at >= 0, `${name} must exist in the canonical source`);
  const open = text.indexOf('[', at);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const str = readString(text, i);
      assert.ok(str, 'a string literal in the canonical source is unterminated');
      i = str.end;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error(`unterminated array ${name}`);
}

interface ParsedQuestion {
  id: number;
  category: string | null;
  question: string | null;
}

function parseQuestions(block: string): ParsedQuestion[] {
  const out: ParsedQuestion[] = [];
  const idPattern = /(^|[\s{,])id:\s*(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = idPattern.exec(block)) !== null) {
    const from = match.index;
    const rest = block.slice(from);
    const field = (name: string): string | null => {
      const found = new RegExp(`(^|[\\s{,])${name}:\\s*`).exec(rest);
      if (!found) return null;
      const str = readString(block, from + found.index + found[0].length);
      return str ? str.value : null;
    };
    out.push({ id: Number(match[2]), category: field('category'), question: field('question') });
  }
  return out;
}

const CLIENT_SOURCES = {
  form: readFileSync('src/app/components/DiagnosticForm.tsx', 'utf8'),
  industrial: readFileSync('src/app/components/IndustrialQuestions.tsx', 'utf8'),
  universal: readFileSync('src/app/components/UniversalQuestions.tsx', 'utf8'),
};

/** Industry key → the canonical array it is rendered from. */
const CANONICAL_ARRAYS: Readonly<Record<string, readonly [string, string]>> = {
  ecommerce: ['form', 'ecommerceQuestions'],
  saas: ['form', 'saasQuestions'],
  agency: ['form', 'agencyQuestions'],
  healthcare: ['form', 'healthcareQuestions'],
  creators: ['form', 'creatorsQuestions'],
  nonprofit: ['form', 'nonprofitQuestions'],
  government: ['form', 'governmentQuestions'],
  manufacturing: ['industrial', 'industrialQuestions'],
  other: ['universal', 'universalQuestions'],
};

function canonicalQuestions(industry: string): ParsedQuestion[] {
  const [source, name] = CANONICAL_ARRAYS[industry];
  return parseQuestions(arraySpan(CLIENT_SOURCES[source as keyof typeof CLIENT_SOURCES], name));
}

describe('the server question catalogue mirrors the canonical client catalogue', () => {
  it('covers every industry the client renders, and no other', () => {
    assert.deepEqual(
      [...DIAGNOSTIC_INDUSTRY_KEYS].sort(),
      Object.keys(CANONICAL_ARRAYS).sort(),
      'the server catalogue and the client question sets name different industries',
    );
  });

  for (const industry of DIAGNOSTIC_INDUSTRY_KEYS) {
    it(`reproduces every ${industry} question, its id, its section and its order`, () => {
      const canonical = canonicalQuestions(industry);
      assert.ok(canonical.length > 0, 'the canonical source must yield questions');
      assert.deepEqual(
        DIAGNOSTIC_QUESTION_CATALOGUE[industry].map((question) => ({
          id: question.id,
          category: question.category,
          question: question.question,
        })),
        canonical,
        `the ${industry} catalogue has drifted from the client source`,
      );
    });
  }

  it('names each industry as the canonical alias table does', () => {
    // `questionRegistry.INDUSTRY_ALIASES` is where a display name and an
    // industry id are tied together. The dossier carries the display name, so a
    // rename there must not leave this file describing the old one.
    const registry = readFileSync('src/app/utils/questionRegistry.ts', 'utf8');
    for (const industry of DIAGNOSTIC_INDUSTRY_KEYS) {
      const label = DIAGNOSTIC_INDUSTRY_LABELS[industry];
      assert.ok(
        registry.includes(`'${label}': '${industry}'`),
        `${label} is not the canonical display name for ${industry}`,
      );
    }
  });

  it('resolves an industry only on an exact match', () => {
    assert.equal(resolveDiagnosticIndustry('manufacturing'), 'manufacturing');
    assert.equal(resolveDiagnosticIndustry('Manufacturing / Supply Chain'), 'manufacturing');
    assert.equal(resolveDiagnosticIndustry(undefined, 'SaaS / Software'), 'saas');
    // The stored id wins over the label beside it, because `industryLabel()` in
    // `index.tsx` maps several ids to the wrong name and the id is what the
    // client picker actually wrote.
    assert.equal(resolveDiagnosticIndustry('manufacturing', 'Non-Profit / Education'), 'manufacturing');
    // No substring guessing and no fallback to `other`.
    assert.equal(resolveDiagnosticIndustry('industrial'), undefined);
    assert.equal(resolveDiagnosticIndustry('mostly saas, some agency'), undefined);
    assert.equal(resolveDiagnosticIndustry(undefined, undefined), undefined);
  });
});

// ── The source, over stored submissions ─────────────────────────────────────

const OWNER = 'org-marq';
const OTHER = 'org-globex';

interface StoredRow {
  readonly [key: string]: unknown;
}

function sourceOver(
  rows: Readonly<Record<string, unknown>>,
  options: { owner?: string | undefined; refusals?: string[] } = {},
) {
  const refusals = options.refusals ?? [];
  return createKvSubmissionDossierSource({
    read: (key: string) => Promise.resolve(rows[key]),
    ownerOrganizationId: () =>
      Promise.resolve('owner' in options ? options.owner : OWNER),
    onUnreadable: (submissionId: string, detail: string) =>
      refusals.push(`${submissionId}: ${detail}`),
  });
}

function storedSubmission(overrides: StoredRow = {}): string {
  return JSON.stringify({
    id: 'SUB-1',
    company: 'Northwind Metals',
    email: 'ops@northwind.test',
    industry: 'Non-Profit / Education',
    industryId: 'manufacturing',
    employees: '51-200',
    submittedAt: '2026-02-01T09:30:00.000Z',
    status: 'new',
    answers: {
      '1': 'We assemble to order and everything is tracked on a spreadsheet by hand.',
      '4': 'Handoffs between shifts are manual and rework is discovered late.',
      '8': 'Production planning, inventory and purchasing are three separate systems.',
    },
    ...overrides,
  });
}

async function loadDossier(
  rows: Readonly<Record<string, unknown>>,
  submissionId = 'SUB-1',
  options: { owner?: string | undefined; refusals?: string[]; organizationId?: string } = {},
): Promise<DiagnosticSubmissionDossier | undefined> {
  const source = sourceOver(rows, options);
  return source.load(options.organizationId ?? OWNER, submissionId);
}

describe('the production submission source rebuilds a truthful dossier', () => {
  it('names every answer with the question and section it was asked under', async () => {
    const dossier = await loadDossier({ 'sub:SUB-1': storedSubmission() });
    assert.ok(dossier, 'the submission must resolve');

    const catalogue = DIAGNOSTIC_QUESTION_CATALOGUE.manufacturing;
    assert.deepEqual(
      dossier.answers.map((entry) => ({
        questionId: entry.questionId,
        questionText: entry.questionText,
        category: entry.category,
      })),
      [1, 4, 8].map((id) => {
        const question = catalogue.find((entry) => entry.id === id);
        assert.ok(question);
        return { questionId: id, questionText: question.question, category: question.category };
      }),
      'an answer is attributed to a question or a section it was not asked under',
    );

    // THREE ANSWERS, THREE SECTIONS — the fact the scoring engine reads.
    assert.equal(new Set(dossier.answers.map((entry) => entry.category)).size, 3);
    assert.equal(dossier.answers.every((entry) => entry.category.length > 0), true);
  });

  it('states what the diagnostic asked, not only what was answered', async () => {
    const dossier = await loadDossier({ 'sub:SUB-1': storedSubmission() });
    assert.ok(dossier);
    assert.equal(dossier.totalQuestions, DIAGNOSTIC_QUESTION_CATALOGUE.manufacturing.length);
    assert.equal(dossier.answers.length, 3);
  });

  it('carries the industry the client chose, not the label stored beside it', async () => {
    // The stored record says `Non-Profit / Education` because `industryLabel()`
    // maps `manufacturing` to the wrong name. The industry drives the scoring
    // engine's adjustment, so the dossier carries the one the picker wrote.
    const dossier = await loadDossier({ 'sub:SUB-1': storedSubmission() });
    assert.ok(dossier);
    assert.equal(dossier.industry, 'Manufacturing / Supply Chain');
  });

  it('reads company, status, time and size from the record', async () => {
    const dossier = await loadDossier({ 'sub:SUB-1': storedSubmission() });
    assert.ok(dossier);
    assert.equal(dossier.submissionId, 'SUB-1');
    assert.equal(dossier.organizationId, OWNER);
    assert.equal(dossier.company, 'Northwind Metals');
    assert.equal(dossier.status, 'new');
    assert.equal(dossier.submittedAt, '2026-02-01T09:30:00.000Z');
    // `estimateEmployees`, verbatim: the 51-200 band is 100, and an unstated
    // size is 25 rather than a claim that nobody works there.
    assert.equal(dossier.employeeEstimate, 100);
    const unstated = await loadDossier({
      'sub:SUB-1': storedSubmission({ employees: 'Not specified' }),
    });
    assert.equal(unstated?.employeeEstimate, 25);
  });

  it('skips a blank answer and keeps catalogue order', async () => {
    const dossier = await loadDossier({
      'sub:SUB-1': storedSubmission({
        answers: { '8': 'Three separate systems.', '1': '   ', '4': 'Rework found late.' },
      }),
    });
    assert.ok(dossier);
    assert.deepEqual(dossier.answers.map((entry) => entry.questionId), [4, 8]);
  });

  it('satisfies the dossier contract the tool validates its output against', async () => {
    const dossier = await loadDossier({
      'sub:SUB-1': storedSubmission({
        // Longer than the contract's answer bound, which the source clips.
        answers: { '1': 'a'.repeat(5_000) },
      }),
    });
    assert.ok(dossier);
    const validated = diagnosticDossierSchema.validate(dossier);
    assert.equal(validated.ok, true, 'the dossier must satisfy its declared schema');
    assert.equal(dossier.answers[0].answer.length, 4_000);
  });

  it('reads a row that was encoded twice', async () => {
    const dossier = await loadDossier({ 'sub:SUB-1': JSON.stringify(storedSubmission()) });
    assert.ok(dossier);
    assert.equal(dossier.company, 'Northwind Metals');
  });
});

describe('the production submission source refuses what it cannot describe', () => {
  it('refuses a submission whose industry matches no catalogue', async () => {
    const refusals: string[] = [];
    const dossier = await loadDossier(
      { 'sub:SUB-1': storedSubmission({ industryId: 'logistics', industry: 'Freight' }) },
      'SUB-1',
      { refusals },
    );
    assert.equal(dossier, undefined);
    assert.equal(refusals.length, 1, 'the refusal must say why');
    assert.match(refusals[0], /industry/);
  });

  it('refuses a submission answering a question its catalogue does not ask', async () => {
    // Dropping the answer instead would change the evidence the authority
    // scores and leave no trace that anything was missing.
    const refusals: string[] = [];
    const dossier = await loadDossier(
      { 'sub:SUB-1': storedSubmission({ answers: { '1': 'By hand.', '99': 'Orphaned answer.' } }) },
      'SUB-1',
      { refusals },
    );
    assert.equal(dossier, undefined);
    assert.match(refusals[0], /question 99/);
  });

  it('resolves nothing for a missing, unreadable or malformed row', async () => {
    assert.equal(await loadDossier({}), undefined);
    assert.equal(await loadDossier({ 'sub:SUB-1': '{not json' }), undefined);
    assert.equal(await loadDossier({ 'sub:SUB-1': '"a plain string"' }), undefined);
    assert.equal(await loadDossier({ 'sub:SUB-1': '[]' }), undefined);
  });

  it('never builds a storage key from an id the contract would reject', async () => {
    const reads: string[] = [];
    const source = createKvSubmissionDossierSource({
      read: (key: string) => {
        reads.push(key);
        return Promise.resolve(undefined);
      },
      ownerOrganizationId: () => Promise.resolve(OWNER),
    });
    assert.equal(await source.load(OWNER, 'sub:../other'), undefined);
    assert.equal(await source.load(OWNER, ''), undefined);
    assert.deepEqual(reads, [], 'a malformed id must never reach the store');
  });
});

describe('the production submission source answers for one tenant only', () => {
  it('resolves nothing for an organization that does not own the submissions', async () => {
    const dossier = await loadDossier({ 'sub:SUB-1': storedSubmission() }, 'SUB-1', {
      organizationId: OTHER,
    });
    assert.equal(dossier, undefined, 'another tenant must not read a submission');
  });

  it('resolves nothing at all when the owning organization is unknown', async () => {
    // A submission whose tenant cannot be resolved is not a submission anyone
    // may read — including the tenant that would have owned it.
    const dossier = await loadDossier({ 'sub:SUB-1': storedSubmission() }, 'SUB-1', {
      owner: undefined,
    });
    assert.equal(dossier, undefined);
  });

  it('states the owning organization on the dossier it returns', async () => {
    const dossier = await loadDossier({ 'sub:SUB-1': storedSubmission() });
    assert.equal(dossier?.organizationId, OWNER);
  });
});

// ── What the sections actually buy the deterministic authority ──────────────

describe('the sections a dossier carries reach the deterministic authority', () => {
  const rows = { 'sub:SUB-1': storedSubmission() };

  it('produces the same authority for the same submission, every time', async () => {
    const first = await loadDossier(rows);
    const second = await loadDossier(rows);
    assert.ok(first && second);
    assert.deepEqual(first, second, 'the same stored row must rebuild the same dossier');
    assert.equal(
      computeReadinessAuthority(first).authorityDigest,
      computeReadinessAuthority(second).authorityDigest,
      'the authority must be a pure function of the dossier',
    );
  });

  it('scores a submission differently from one whose sections were blanked', async () => {
    // The defect this source exists to prevent: with one unnamed section, every
    // domain's evidence spans exactly one section and the cross-section
    // component of the score disappears. The result is not missing, it is wrong.
    const dossier = await loadDossier(rows);
    assert.ok(dossier);
    const blanked: DiagnosticSubmissionDossier = {
      ...dossier,
      answers: dossier.answers.map((entry) => ({ ...entry, category: '' })),
    };

    const named = computeReadinessAuthority(dossier);
    const unnamed = computeReadinessAuthority(blanked);
    assert.notEqual(named.authorityDigest, unnamed.authorityDigest);
    assert.notDeepEqual(
      named.readiness.domainScores,
      unnamed.readiness.domainScores,
      'blanking every section must change the score the authority reports',
    );
  });
});
