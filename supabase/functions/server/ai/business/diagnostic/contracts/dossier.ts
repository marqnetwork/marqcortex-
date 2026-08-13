/**
 * The diagnostic submission dossier (AI-01 Batch 3B, Part 7B).
 *
 * What a readiness review is ABOUT: one submitted diagnostic, its answers, and
 * the few facts about the business the deterministic engines need. It is read
 * by a tool, never written by one — Part 7A's contract says the readiness
 * manager may not alter a submission, a diagnostic answer or a submission
 * status, and the shape below is one half of how that is enforced: there is no
 * writer for this type anywhere in this tree, and the agent's only route to a
 * dossier is a `read_only` tool.
 *
 * ── EVERY ANSWER IS UNTRUSTED TEXT ─────────────────────────────────────────
 *
 * `DiagnosticAnswer.answer` is free text a client typed. It reaches the
 * deterministic engines as DATA — they classify it by keyword and never
 * interpret it — and it reaches a model only inside an explicit fence (see
 * `agent/context.ts`). Nothing in this file, and nothing that reads it, may
 * treat it as an instruction, a field name or a path.
 *
 * ── AND THE ORGANIZATION IS NOT ON THE INPUT ───────────────────────────────
 *
 * The dossier RECORD carries `organizationId`, because a stored record has to
 * say whose it is. No tool INPUT does: every tool in this capability resolves
 * the tenant from `invocation.organizationId`, which the tool gateway sets from
 * the run, and an `organizationId` a caller put in a payload is dropped by the
 * declared schema before the executor sees it.
 */

import type { Validator } from '../../../security/validation.ts';
import { arrayOf, int, object, str } from '../../../security/validation.ts';

/** One answered diagnostic question. `answer` is untrusted client text. */
export interface DiagnosticAnswer {
  readonly questionId: number;
  readonly questionText: string;
  /** The section the question belongs to. Drives one scoring component. */
  readonly category: string;
  readonly answer: string;
}

export interface DiagnosticSubmissionDossier {
  readonly submissionId: string;
  /** Whose submission this is. Set by the store, never by a payload. */
  readonly organizationId: string;
  readonly company: string;
  readonly industry: string;
  readonly employeeEstimate: number;
  /**
   * Questions the diagnostic ASKED, answered or not.
   *
   * Separate from `answers.length` because completeness is the ratio of the two
   * and a submission that answered four of fourteen is a different fact from
   * one that answered four of four.
   */
  readonly totalQuestions: number;
  readonly answers: readonly DiagnosticAnswer[];
  readonly submittedAt: string;
  /**
   * The submission's lifecycle status, verbatim.
   *
   * READ-ONLY here in the strongest sense available: this capability ships no
   * tool that writes it, so the agent cannot change a submission's status even
   * by accident. Carried because a reviewer needs to know whether they are
   * reviewing a draft or a submitted diagnostic.
   */
  readonly status: string;
}

export const DIAGNOSTIC_DOSSIER_BOUNDS = {
  answers: { min: 0, max: 64 },
  answerText: { max: 4_000 },
  questionText: { max: 500 },
  category: { max: 120 },
  company: { max: 200 },
  industry: { max: 120 },
  employeeEstimate: { min: 0, max: 1_000_000 },
  totalQuestions: { min: 0, max: 64 },
} as const;

export const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export const diagnosticAnswerSchema: Validator<DiagnosticAnswer> = object({
  questionId: int({ min: 0, max: 10_000 }),
  questionText: str({ maxLength: DIAGNOSTIC_DOSSIER_BOUNDS.questionText.max }),
  category: str({ maxLength: DIAGNOSTIC_DOSSIER_BOUNDS.category.max }),
  answer: str({ maxLength: DIAGNOSTIC_DOSSIER_BOUNDS.answerText.max }),
}) as Validator<DiagnosticAnswer>;

/**
 * The dossier as a tool returns it.
 *
 * `organizationId` is present in the OUTPUT schema and absent from every input
 * schema, which is the asymmetry the tenant guarantee rests on: a reader is
 * told whose record they got, and a caller is never asked whose record they
 * want.
 */
export const diagnosticDossierSchema: Validator<DiagnosticSubmissionDossier> = object({
  submissionId: str({ maxLength: 64, pattern: SUBMISSION_ID_PATTERN }),
  organizationId: str({ maxLength: 64 }),
  company: str({ maxLength: DIAGNOSTIC_DOSSIER_BOUNDS.company.max }),
  industry: str({ maxLength: DIAGNOSTIC_DOSSIER_BOUNDS.industry.max }),
  employeeEstimate: int(DIAGNOSTIC_DOSSIER_BOUNDS.employeeEstimate),
  totalQuestions: int(DIAGNOSTIC_DOSSIER_BOUNDS.totalQuestions),
  answers: arrayOf(diagnosticAnswerSchema, {
    minItems: DIAGNOSTIC_DOSSIER_BOUNDS.answers.min,
    maxItems: DIAGNOSTIC_DOSSIER_BOUNDS.answers.max,
  }),
  submittedAt: str({ maxLength: 40 }),
  status: str({ maxLength: 40 }),
}) as Validator<DiagnosticSubmissionDossier>;
