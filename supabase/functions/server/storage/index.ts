/**
 * Runtime storage — the shadow read (MCV2-S7.4) and the cutover (MCV2-S8.1).
 *
 * KV REMAINS AUTHORITATIVE BY DEFAULT, and the shadow read still cannot change
 * a response: it measures whether the relational store agrees with the store
 * that is serving, so the dual-read phase is entered on evidence rather than
 * hope.
 *
 * `readAuthority` is the one exception, and it is deliberately the ONLY one.
 * It is the single point at which a relational record may answer a request, and
 * only for a domain a deployment has explicitly switched on. Off — which is the
 * default and the state of every deployment until an operator decides otherwise
 * — it returns the KV record by identity and reads nothing.
 *
 * Concentrating that decision in one module is what makes the rollout
 * reviewable and the rollback a switch rather than a deploy. If a second path
 * to serving a relational record ever appears, that property is gone.
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
export { createReadAuthority } from './readAuthority.ts';
export type {
  AuthorityDomain,
  AuthorityRecord,
  AuthorityReport,
  AuthoritySource,
  ReadAuthority,
  ReadAuthorityOptions,
  Resolution,
  ResolveRequest,
} from './readAuthority.ts';
export type { ShadowObservation, ShadowReader, ShadowReaderOptions } from './shadowReader.ts';
