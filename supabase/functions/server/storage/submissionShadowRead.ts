/**
 * Submission shadow read, wired — MCV2-S7.7.
 *
 * The same shape as the outcome wiring, over the platform's core entity, and
 * deliberately its own switch: `MCV2_SHADOW_READ_SUBMISSIONS`.
 *
 * ── WHY THE SWITCHES ARE SEPARATE ──────────────────────────────────────────
 *
 * One switch for both domains would mean an operator who wanted to watch the
 * outcome domain had to accept the cost on the busiest read path on the
 * platform, and an operator who found a problem on submissions could only stop
 * it by blinding themselves to outcomes as well. Per-domain switches make the
 * instrument something an operator can aim.
 *
 * They share ONE reader, so the report is one report and the deadline is one
 * deadline. Two readers would be two bounded ledgers to consult and two places
 * for the bound to drift apart.
 */

import { createSubmissionRepository } from '../repositories/submissionRepository.ts';
import { createServiceClient } from '../repositories/repositoryClient.ts';
import { outcomeShadowReader } from './outcomeShadowRead.ts';
import {
  SUBMISSION_FIELDS,
  projectKvSubmission,
  projectSqlSubmission,
  submissionKvKey,
} from './submissionProjection.ts';

function readBool(key: string): boolean {
  const raw = Deno.env.get(key);
  return raw === 'true' || raw === '1';
}

// Inferred rather than annotated, so this module names no vendor SDK type.
let client: ReturnType<typeof createServiceClient> | undefined;

/** The service client, built on first use. Throws into the reader's absorber. */
function serviceClient(): ReturnType<typeof createServiceClient> {
  if (!client) client = createServiceClient();
  return client;
}

/**
 * Observe one submission read.
 *
 * `kvRecord` is the record the caller WAS ACTUALLY SERVED. Never throws, never
 * delays a caller past the shared deadline, and returns nothing.
 */
export function observeSubmissionRead(submissionId: string, kvRecord: unknown): Promise<void> {
  if (!submissionShadowReadEnabled()) return Promise.resolve();
  const key = submissionKvKey(submissionId);
  return outcomeShadowReader.observe({
    domain: 'submission',
    key,
    fields: SUBMISSION_FIELDS,
    kv: projectKvSubmission(kvRecord),
    loadSql: () => createSubmissionRepository(serviceClient()).getSubmissionByLegacyKey(key),
    project: projectSqlSubmission,
  });
}

/** Whether submission shadow reads are currently switched on. */
export function submissionShadowReadEnabled(): boolean {
  return readBool('MCV2_SHADOW_READ_SUBMISSIONS');
}
