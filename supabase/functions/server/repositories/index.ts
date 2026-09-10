export { createTenancyRepository, getTenancyRepository } from './tenancyRepository.ts';
export { TenancyRepositoryError, type TenancyRepository } from './types.ts';
export {
  DiagnosticRepositoryError,
  type LeadRepository,
  type ContactRepository,
  type SubmissionRepository,
  type ReportRepository,
  type OutcomeRepository,
} from './diagnosticTypes.ts';
export { createLeadRepository } from './leadRepository.ts';
export { createContactRepository } from './contactRepository.ts';
export { createSubmissionRepository } from './submissionRepository.ts';
// `createReportRepository` is deliberately NOT re-exported: it does not exist.
// `reportRepository.ts` is a byte-identical copy of `outcomeRepository.ts` —
// a file that was created and never rewritten — so the only thing it exports
// is `createOutcomeRepository`, which line 15 already provides.
//
// This was not a dormant annotation. A named re-export of a missing member
// fails at ESM LINK time, so the first module to import this barrel would not
// have got a wrong repository; it would have failed to load at all. Nothing
// imports it yet, which is the only reason it never fired.
//
// The report repository named by MQC-SVC-015 ("client report repository with
// version history") therefore has a type in `diagnosticTypes.ts` and no
// implementation. Writing it is implementation work and is recorded as a V1
// gap, not smuggled into a type-check pass.
export { createOutcomeRepository } from './outcomeRepository.ts';
