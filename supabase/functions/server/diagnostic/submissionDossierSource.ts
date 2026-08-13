/**
 * The production submission source for the certified readiness review.
 *
 * Parts 7A–7E shipped the capability with its dossier port UNSUPPLIED, and the
 * bootstrap refused to register anything without one. This is that port, over
 * the submissions the platform actually holds: the record a diagnostic writes
 * at `sub:{id}`, read back and described in the terms the review needs.
 *
 * ── WHAT THE STORED RECORD HAS, AND WHAT IT DOES NOT ───────────────────────
 *
 * A submission carries the industry the client picked (`industryId`), the
 * answers they typed keyed by question id, the company, the status and the
 * time. It does NOT carry what each question asked or the section it was asked
 * under — the client renders those from the question catalogue — and the
 * deterministic authority needs the section: it reads `answer.category` to
 * count how many sections a domain's evidence spans, so every answer arriving
 * under one blank section would change the score rather than merely lose a
 * label. `questionCatalogue.ts` supplies both, keyed by the industry the client
 * chose and the id the answer is stored under. Nothing here is inferred from
 * the answer text.
 *
 * ── READ ONLY, AND REFUSING IS A RESULT ────────────────────────────────────
 *
 * The port has one method and it reads. There is no writer anywhere in this
 * module, which is how Part 7A's "the readiness manager may not alter a
 * submission, an answer or a status" stays structural rather than remembered.
 *
 * And a submission this module cannot describe TRUTHFULLY does not resolve. An
 * unknown industry, an answer under a question the catalogue does not contain,
 * an unreadable row: each returns `undefined`, which the dossier tool reports
 * as `diagnostic_submission_not_found`, and each is logged with its reason. The
 * alternative — a dossier with guessed sections — is a review that reads as
 * authoritative and describes a business nobody has.
 *
 * ── TENANCY ────────────────────────────────────────────────────────────────
 *
 * Key-value submissions predate the tenancy tables and carry no organization of
 * their own; the migration engine assigns them to the MARQ organization for
 * exactly that reason. This source therefore takes the organization that owns
 * them as a resolved fact from the deployment, and answers only for that
 * organization. Any other tenant naming any submission id gets `undefined`, and
 * so does every caller when the owner cannot be resolved at all — a submission
 * whose tenant is unknown is not a submission anyone may read.
 */

import type {
  DiagnosticAnswer,
  DiagnosticSubmissionDossier,
} from '../ai/business/diagnostic/contracts/dossier.ts';
import {
  DIAGNOSTIC_DOSSIER_BOUNDS,
  SUBMISSION_ID_PATTERN,
} from '../ai/business/diagnostic/contracts/dossier.ts';
import type { DiagnosticDossierStore } from '../ai/business/diagnostic/persistence/ports.ts';
import {
  DIAGNOSTIC_INDUSTRY_LABELS,
  diagnosticQuestionsFor,
  resolveDiagnosticIndustry,
} from './questionCatalogue.ts';

export interface SubmissionDossierSourceOptions {
  /** Durable key-value read. The same port every other durable store takes. */
  readonly read: (key: string) => Promise<unknown>;
  /**
   * The organization that owns key-value submissions, resolved by the
   * deployment. `undefined` means it could not be resolved, and every read then
   * answers `undefined` rather than falling back to a tenant.
   */
  readonly ownerOrganizationId: () => Promise<string | undefined>;
  /** Reports a submission that exists and cannot be described truthfully. */
  readonly onUnreadable?: (submissionId: string, detail: string) => void;
}

/** The stored submission, as much of it as a dossier is built from. */
interface StoredSubmission {
  readonly company?: unknown;
  readonly industry?: unknown;
  readonly industryId?: unknown;
  readonly employees?: unknown;
  readonly answers?: unknown;
  readonly submittedAt?: unknown;
  readonly status?: unknown;
}

/**
 * `diagnosticEngine.estimateEmployees`, verbatim.
 *
 * A submission stores a size BAND as free text ("11-50", "Not specified"); the
 * portfolio engine steps its feasibility and risk scores on a number. The
 * canonical mapping between them lives in `src/app/utils/diagnosticEngine.ts`
 * and is mirrored here for the same reason the question catalogue is — including
 * its default of 25 for an unstated size, because a 0 would be a claim that the
 * business has no employees.
 */
function estimateEmployees(sizeString: string): number {
  if (!sizeString) return 25;
  const lower = sizeString.toLowerCase();
  if (lower.includes('1-10') || lower.includes('1 -') || lower.includes('solo') || lower.includes('micro')) return 5;
  if (lower.includes('11-50') || lower.includes('11 -') || lower.includes('small')) return 30;
  if (lower.includes('51-200') || lower.includes('51 -') || lower.includes('medium')) return 100;
  if (lower.includes('201-500') || lower.includes('201 -')) return 350;
  if (lower.includes('500') || lower.includes('enterprise') || lower.includes('large')) return 750;
  return 25;
}

/**
 * Parse a stored row.
 *
 * Rows are written with `JSON.stringify`, and some legacy writers stringified an
 * already-encoded string. Both are read; anything else is unreadable.
 */
function parseRow(raw: unknown): StoredSubmission | undefined {
  let value = raw;
  for (let attempt = 0; attempt < 2 && typeof value === 'string'; attempt += 1) {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as StoredSubmission;
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function createKvSubmissionDossierSource(
  options: SubmissionDossierSourceOptions,
): DiagnosticDossierStore {
  const refuse = (submissionId: string, detail: string): undefined => {
    options.onUnreadable?.(submissionId, detail);
    return undefined;
  };

  return {
    async load(
      organizationId: string,
      submissionId: string,
    ): Promise<DiagnosticSubmissionDossier | undefined> {
      // The id becomes a storage key, so it is checked against the same pattern
      // the tool's input schema declares before it is used as one.
      if (!SUBMISSION_ID_PATTERN.test(submissionId)) return undefined;

      const owner = await options.ownerOrganizationId();
      if (owner === undefined || owner !== organizationId) return undefined;

      const stored = parseRow(await options.read(`sub:${submissionId}`));
      if (stored === undefined) return undefined;

      // The industry decides which questions were asked, so it decides whether
      // this submission can be described at all.
      const industry = resolveDiagnosticIndustry(
        typeof stored.industryId === 'string' ? stored.industryId : undefined,
        typeof stored.industry === 'string' ? stored.industry : undefined,
      );
      if (industry === undefined) {
        return refuse(
          submissionId,
          'its industry matches no question catalogue, so no answer can be attributed to a section',
        );
      }

      const questions = diagnosticQuestionsFor(industry);
      const storedAnswers =
        typeof stored.answers === 'object' && stored.answers !== null && !Array.isArray(stored.answers)
          ? (stored.answers as Record<string, unknown>)
          : {};

      // AN ANSWER THE CATALOGUE CANNOT NAME IS A REFUSAL, not a silent drop.
      // Dropping it would change the evidence the authority scores and leave no
      // trace that anything was missing.
      const known = new Set(questions.map((question) => String(question.id)));
      for (const key of Object.keys(storedAnswers)) {
        if (!known.has(key)) {
          return refuse(
            submissionId,
            `it answers question ${key}, which the ${industry} catalogue does not ask`,
          );
        }
      }

      // Catalogue order, and only questions that were actually answered — the
      // rule `questionRegistry.annotateResponses` applies. How many were ASKED
      // travels separately, as `totalQuestions`.
      const answers: DiagnosticAnswer[] = [];
      for (const question of questions) {
        const raw = storedAnswers[String(question.id)];
        if (raw === undefined || raw === null) continue;
        const text = String(raw);
        if (text.trim().length === 0) continue;
        answers.push({
          questionId: question.id,
          questionText: question.question.slice(0, DIAGNOSTIC_DOSSIER_BOUNDS.questionText.max),
          category: question.category.slice(0, DIAGNOSTIC_DOSSIER_BOUNDS.category.max),
          // Clipped at the bound the dossier contract declares. The words are
          // the client's; what the bound removes is length, not meaning.
          answer: text.slice(0, DIAGNOSTIC_DOSSIER_BOUNDS.answerText.max),
        });
      }

      return {
        submissionId,
        organizationId: owner,
        company: boundedText(stored.company, DIAGNOSTIC_DOSSIER_BOUNDS.company.max),
        // The catalogue's name for the industry the client chose, not the label
        // stored beside it — see `DIAGNOSTIC_INDUSTRY_LABELS`.
        industry: DIAGNOSTIC_INDUSTRY_LABELS[industry],
        employeeEstimate: estimateEmployees(
          typeof stored.employees === 'string' ? stored.employees : '',
        ),
        totalQuestions: questions.length,
        answers,
        submittedAt: boundedText(stored.submittedAt, 40),
        status: boundedText(stored.status, 40),
      };
    },
  };
}
