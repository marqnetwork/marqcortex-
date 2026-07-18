/**
 * Runtime Storage Gateway — route wiring (MCV2-S7.4 → S7.8)
 *
 * Thin, best-effort helpers the KV route handlers call AFTER their authority
 * read. Every function:
 *   - returns void and never throws (a failure here cannot affect the response);
 *   - short-circuits when the domain's shadow flag is off (default);
 *   - lazily builds the SQL repositories + resolves the MARQ org only when a
 *     shadow read is actually enabled.
 *
 * Deno-only (pulls in the SQL repositories). The pure gateway/drift primitives
 * live in gateway.ts / drift.ts and are unit-tested under node.
 */
import { shadowReadWithReport } from './gateway.ts';
import { isShadowReadEnabled } from './config.ts';
import {
  projectLeadExistenceKv,
  projectLeadExistenceSql,
  projectOutcomeKv,
  projectOutcomeSql,
  projectSubmissionKv,
  projectSubmissionSql,
} from './drift.ts';
import {
  createOutcomeRepository,
  createLeadRepository,
  createSubmissionRepository,
  getTenancyRepository,
} from '../repositories/index.ts';

const MARQ_SLUG = 'marq';

let cachedOrgId: string | null = null;

/** Resolve (and cache) the MARQ organization id. Returns null if unavailable. */
async function resolveOrgId(): Promise<string | null> {
  if (cachedOrgId) return cachedOrgId;
  try {
    const tenancy = getTenancyRepository();
    const org = await tenancy.getOrganizationBySlug(MARQ_SLUG);
    cachedOrgId = org?.id ?? null;
    return cachedOrgId;
  } catch {
    return null;
  }
}

/** S7.4 — Outcome shadow read. `kvOutcome` is the parsed KV value (or null). */
export async function shadowReadOutcome(
  submissionId: string,
  kvOutcome: Record<string, unknown> | null,
): Promise<void> {
  if (!isShadowReadEnabled('outcome')) return;
  try {
    const orgId = await resolveOrgId();
    if (!orgId) return;
    const repo = createOutcomeRepository();
    await shadowReadWithReport({
      domain: 'outcome',
      key: submissionId,
      enabled: true,
      readAuthority: () => kvOutcome,
      readShadow: () => repo.getOutcomeBySubmission(submissionId, orgId),
      projectAuthority: projectOutcomeKv,
      projectShadow: (r) => projectOutcomeSql(r as Record<string, unknown> | null),
    });
  } catch {
    /* best-effort: shadow reads never affect the response */
  }
}

/** S7.6 — Lead shadow read (existence check by email). */
export async function shadowReadLeadByEmail(
  email: string,
  kvLeadId: string | null,
): Promise<void> {
  if (!isShadowReadEnabled('lead')) return;
  try {
    const orgId = await resolveOrgId();
    if (!orgId) return;
    const repo = createLeadRepository();
    await shadowReadWithReport({
      domain: 'lead',
      key: email,
      enabled: true,
      readAuthority: () => kvLeadId,
      readShadow: () => repo.lookupLeadByEmail(orgId, email),
      projectAuthority: projectLeadExistenceKv,
      projectShadow: (r) => projectLeadExistenceSql(r as Record<string, unknown> | null),
    });
  } catch {
    /* best-effort */
  }
}

/** S7.7 — Submission shadow read. `kvSubmission` is the parsed KV value. */
export async function shadowReadSubmission(
  submissionId: string,
  kvSubmission: Record<string, unknown> | null,
): Promise<void> {
  if (!isShadowReadEnabled('submission')) return;
  try {
    const orgId = await resolveOrgId();
    if (!orgId) return;
    const repo = createSubmissionRepository();
    await shadowReadWithReport({
      domain: 'submission',
      key: submissionId,
      enabled: true,
      readAuthority: () => kvSubmission,
      readShadow: () => repo.getSubmissionByLegacyKey(`sub:${submissionId}`),
      projectAuthority: projectSubmissionKv,
      projectShadow: (r) => projectSubmissionSql(r as Record<string, unknown> | null),
    });
  } catch {
    /* best-effort */
  }
}
