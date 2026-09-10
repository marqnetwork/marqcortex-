/**
 * Report repository — MQC-SVC-015 / MCV2-S5-IMPLEMENT-002 (not wired to routes)
 *
 * The client report and its version history. Two tables, and they are NOT the
 * same shape:
 *
 *   `reports`          audited and SOFT-DELETED — created_at/updated_at,
 *                      created_by/updated_by, deleted_at.
 *   `report_versions`  append-only — created_at/created_by and nothing else.
 *                      No `updated_at`, no `updated_by`, no `deleted_at`.
 *
 * That asymmetry is the schema's, not an oversight here: a version is a record
 * of what was generated at a moment, so there is nothing to update and nothing
 * to soft-delete. Every read below filters `deleted_at` on `reports` and does
 * NOT on `report_versions`, because the column does not exist there and a
 * filter on it would make every version query fail.
 *
 * Tenancy: the service client bypasses RLS, so scoping by `organization_id` on
 * every read and write is the isolation guarantee at this layer, exactly as in
 * the sibling repositories.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2.49.8';
import type {
  ReportListFilter,
  ReportRecord,
  ReportVersionRecord,
} from '../../../../src/types/diagnostic.database.types.ts';
import type { ReportRepository } from './diagnosticTypes.ts';
import { DiagnosticRepositoryError } from './diagnosticTypes.ts';
import { createServiceClient, mapRow, throwOnError } from './repositoryClient.ts';

/**
 * Columns a patch may never move.
 *
 * `updateReport` takes `Partial<ReportRecord>`, which structurally includes the
 * identity and tenancy columns. Spreading such a patch straight into the update
 * would let `organization_id` be rewritten — the row is found by the caller's
 * organization and then handed to a different one, which is a cross-tenant
 * write dressed as an edit. Provenance (`created_at`, `created_by`) and the
 * soft-delete flag are stripped for the same reason: a patch is not the place
 * to rewrite when a report was made, by whom, or whether it still exists.
 */
const IMMUTABLE_REPORT_COLUMNS = [
  'id',
  'organization_id',
  'submission_id',
  'created_at',
  'created_by',
  'deleted_at',
] as const;

function sanitizeReportPatch(patch: Partial<ReportRecord>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...patch };
  for (const column of IMMUTABLE_REPORT_COLUMNS) delete next[column];
  return next;
}

export function createReportRepository(client?: SupabaseClient): ReportRepository {
  const db = client ?? createServiceClient();

  return {
    async createReport(input) {
      const { data, error } = await db
        .from('reports')
        .insert({
          organization_id: input.organization_id,
          submission_id: input.submission_id,
          status: input.status ?? 'draft',
          title: input.title ?? null,
          current_version: input.current_version ?? 1,
          metadata: input.metadata ?? {},
          created_by: input.created_by ?? null,
          updated_by: input.updated_by ?? null,
        })
        .select('*')
        .single();
      throwOnError(error, 'createReport');
      return data as ReportRecord;
    },

    async getReportById(id, organizationId) {
      const { data, error } = await db
        .from('reports')
        .select('*')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .maybeSingle();
      throwOnError(error, 'getReportById');
      return mapRow<ReportRecord>(data as Record<string, unknown> | null);
    },

    /**
     * The current report for a submission.
     *
     * `reports_submission_idx` is NOT unique, so a submission may carry more
     * than one report — a regenerated diagnostic is a second row, not an edit
     * of the first. "The report for this submission" therefore has to name
     * which one, and it is the most recent: ordered by `created_at` descending
     * with `id` as the tie-break, so two reports written in the same clock tick
     * still resolve to one answer rather than to whichever the planner
     * happened to return.
     */
    async getReportBySubmission(submissionId, organizationId) {
      const { data, error } = await db
        .from('reports')
        .select('*')
        .eq('submission_id', submissionId)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      throwOnError(error, 'getReportBySubmission');
      return mapRow<ReportRecord>(data as Record<string, unknown> | null);
    },

    async updateReport(id, organizationId, patch) {
      const { data, error } = await db
        .from('reports')
        .update({
          ...sanitizeReportPatch(patch),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .select('*')
        .single();
      throwOnError(error, 'updateReport');
      return data as ReportRecord;
    },

    async listReports(filter) {
      let q = db
        .from('reports')
        .select('*')
        .eq('organization_id', filter.organizationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (filter.submissionId) q = q.eq('submission_id', filter.submissionId);
      if (filter.status) q = q.eq('status', filter.status);
      const limit = Math.min(filter.limit ?? 50, 200);
      const offset = filter.offset ?? 0;
      const { data, error } = await q.range(offset, offset + limit - 1);
      throwOnError(error, 'listReports');
      return (data ?? []) as ReportRecord[];
    },

    /**
     * Append a version to a report's history.
     *
     * The parent is checked first, IN THE CALLER'S ORGANIZATION.
     *
     * When this was written the database did not enforce it: `report_id` and
     * `organization_id` were two independent fields and only the first was
     * foreign-keyed, so a version could be written against another tenant's
     * report. The G2 audit found the same hole in all FOURTEEN parent-child
     * relationships and closed it in the schema
     * (`20260910120000_cortex_tenancy_composite_keys.sql`), so the invariant no
     * longer depends on this read.
     *
     * The read stays for what it now does: turn a would-be foreign-key
     * violation — a 500 carrying a constraint name — into the same
     * `DiagnosticRepositoryError('NOT_FOUND')` every other miss in this file
     * reports. That is an error-shape decision, not the enforcement, and the
     * distinction matters: nobody should read this and believe the guard is
     * what stands between the tenants.
     *
     * `reports.current_version` is deliberately NOT advanced. The canonical
     * interface keeps `createReportVersion` and `updateReport` separate, so
     * which version a report currently points at is the caller's decision —
     * a draft version can exist without becoming the published one. Coupling
     * them here would invent a policy the contract does not state.
     */
    async createReportVersion(input) {
      const { data: parent, error: parentError } = await db
        .from('reports')
        .select('id')
        .eq('id', input.report_id)
        .eq('organization_id', input.organization_id)
        .is('deleted_at', null)
        .maybeSingle();
      throwOnError(parentError, 'createReportVersion');
      if (!parent) {
        throw new DiagnosticRepositoryError(
          'createReportVersion: report not found in this organization',
          'NOT_FOUND',
        );
      }

      const { data, error } = await db
        .from('report_versions')
        .insert({
          organization_id: input.organization_id,
          report_id: input.report_id,
          version_number: input.version_number,
          content: input.content,
          generated_at: input.generated_at ?? new Date().toISOString(),
          generated_by: input.generated_by ?? null,
          is_published: input.is_published ?? false,
          created_by: input.created_by ?? null,
        })
        .select('*')
        .single();
      throwOnError(error, 'createReportVersion');
      return data as ReportVersionRecord;
    },

    async getReportVersion(reportId, versionNumber, organizationId) {
      const { data, error } = await db
        .from('report_versions')
        .select('*')
        .eq('report_id', reportId)
        .eq('version_number', versionNumber)
        .eq('organization_id', organizationId)
        .maybeSingle();
      throwOnError(error, 'getReportVersion');
      return mapRow<ReportVersionRecord>(data as Record<string, unknown> | null);
    },

    /** Oldest version first — a history reads forward. */
    async listReportVersions(reportId, organizationId) {
      const { data, error } = await db
        .from('report_versions')
        .select('*')
        .eq('report_id', reportId)
        .eq('organization_id', organizationId)
        .order('version_number', { ascending: true });
      throwOnError(error, 'listReportVersions');
      return (data ?? []) as ReportVersionRecord[];
    },
  };
}
