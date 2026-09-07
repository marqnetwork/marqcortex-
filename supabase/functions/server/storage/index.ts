/**
 * Runtime storage shadow read — MCV2-S7.4.
 *
 * KV REMAINS AUTHORITATIVE. Nothing exported here returns a relational record
 * to a route, and nothing here can change a response. The module measures
 * whether the relational store agrees with the store that is serving, so the
 * dual-read phase can be entered on evidence rather than on hope.
 */

export type {
  DivergenceKind,
  DomainShadowSummary,
  FieldDivergence,
  FieldSpec,
  ShadowDomain,
  ShadowFailureKind,
  ShadowReadRecord,
  ShadowReadReport,
} from './contracts.ts';
export type { Projection } from './compare.ts';
export { compareField, compareProjections } from './compare.ts';
export {
  OUTCOME_FIELDS,
  OUTCOME_KV_PREFIX,
  outcomeKvKey,
  projectKvOutcome,
  projectSqlOutcome,
  submissionIdFromLegacyKey,
} from './outcomeProjection.ts';
export {
  SUBMISSION_FIELDS,
  SUBMISSION_KV_PREFIX,
  canonicalSubmissionPriority,
  canonicalSubmissionStatus,
  projectKvSubmission,
  projectSqlSubmission,
  submissionKvKey,
} from './submissionProjection.ts';
export { createShadowReader } from './shadowReader.ts';
export type { ShadowObservation, ShadowReader, ShadowReaderOptions } from './shadowReader.ts';
