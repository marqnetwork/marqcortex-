/**
 * The one place a `public.organization_memberships` row becomes a
 * `SubjectMembership`.
 *
 * WHY THIS IS A MODULE AND NOT TEN LINES INSIDE `index.tsx`
 *
 * The transformation decides which tenant an operator resolves into and which
 * role reaches the policy engine. It used to live inline in the Supabase edge
 * entry point, which imports Deno-only modules at load time and therefore cannot
 * be imported by a test under Node. The only coverage available was a regular
 * expression over the entry point's source — a test that proves a `.eq()` call
 * is written down, and nothing at all about what the function returns for a row.
 *
 * So the transformation moved here, where it is a pure function over plain
 * objects and can be driven with real row shapes. `index.tsx` keeps the
 * Supabase client and passes it in; it holds no filtering or mapping logic of
 * its own, so there is still exactly one answer to "who is this person a member
 * of".
 *
 * THE FILTERS ARE STATED TWICE ON PURPOSE
 *
 * The query restricts the rows the database returns; `toSubjectMemberships`
 * re-checks the same properties on whatever arrives. That is not belt and
 * braces for its own sake — PostgREST embedded-resource filters are silently
 * dropped when the relationship is not an inner join, and a schema-cache
 * difference between environments can change which shape comes back. A row that
 * slips through the query is refused here rather than admitted, and the
 * re-check is what the behavioural tests can actually exercise.
 */

import type { SubjectMembership } from '../security/actor.ts';

/** The columns the membership query selects. Everything is optional: this is
 *  a description of what a database MIGHT return, not a promise about it. */
export interface MembershipRowShape {
  readonly organization_id?: unknown;
  readonly status?: unknown;
  readonly deleted_at?: unknown;
  readonly organizations?: unknown;
  readonly roles?: unknown;
}

/**
 * PostgREST returns an embedded to-one relation as an object; a client that
 * infers the relationship as to-many returns a one-element array. Reading both
 * shapes keeps a schema-cache difference from silently emptying the role set —
 * which would look exactly like the `roles: []` defect this replaced.
 */
function embedded(value: unknown): Record<string, unknown> | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'object' && candidate !== null
    ? (candidate as Record<string, unknown>)
    : undefined;
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Turn membership rows into verified memberships.
 *
 * A row is admitted only when every one of these holds. Each is load-bearing,
 * and each has a named failure it prevents:
 *
 *   `organization_id` is a string — otherwise there is no tenant to resolve.
 *
 *   `deleted_at IS NULL` — the soft delete IS removal in this schema. A removed
 *   member who kept resolving an organization would be a revoked grant that
 *   still works.
 *
 *   `status = 'active'` — `invited` and `suspended` exist precisely so a row can
 *   be present without granting anything. Admitting them makes suspension
 *   decorative.
 *
 *   THE ORGANIZATION IS ITSELF LIVE. A membership in a soft-deleted
 *   organization is a membership in a tenant that no longer exists. Returning it
 *   as verified would let an operator keep resolving, spending budget against
 *   and writing audit records into an organization the platform has erased —
 *   and `organizations_slug_active_uidx` only holds among undeleted rows, so the
 *   slug it carries may already belong to a different, live tenant. The row is
 *   dropped rather than downgraded: a membership nobody can act under is not a
 *   weaker membership, it is not one.
 *
 * The result is sorted by organization id so the order does not depend on
 * whatever the database happened to return — `resolveOrganization` must not
 * behave differently between two identical requests.
 */
export function toSubjectMemberships(rows: unknown): SubjectMembership[] {
  if (!Array.isArray(rows)) return [];

  const admitted: SubjectMembership[] = [];
  for (const row of rows as readonly MembershipRowShape[]) {
    if (typeof row !== 'object' || row === null) continue;
    if (typeof row.organization_id !== 'string' || row.organization_id.trim() === '') continue;
    if (!isNullish(row.deleted_at)) continue;
    if (normalizedString(row.status) !== 'active') continue;

    // The organization embed is required, not optional. Its absence means the
    // join found no live organization — which is the answer, not a missing
    // field to shrug at.
    const organization = embedded(row.organizations);
    if (!organization) continue;
    if (!isNullish(organization.deleted_at)) continue;

    const slug = organization.slug;
    const roleKey = normalizedString(embedded(row.roles)?.key);

    admitted.push({
      organizationId: row.organization_id,
      slug: typeof slug === 'string' && slug !== '' ? slug : undefined,
      roles: roleKey === '' ? [] : [roleKey],
    });
  }

  admitted.sort((a, b) => (a.organizationId < b.organizationId ? -1 : a.organizationId > b.organizationId ? 1 : 0));
  return admitted;
}

/**
 * The subset of the Supabase client this lookup needs — a `select` that returns
 * a chainable filter and finally resolves. Narrow on purpose: a wider type
 * would let the lookup grow a write.
 */
export interface MembershipQueryBuilder
  extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: unknown): MembershipQueryBuilder;
  is(column: string, value: null): MembershipQueryBuilder;
}

export interface MembershipQueryClient {
  from(table: string): { select(columns: string): MembershipQueryBuilder };
}

/** The columns and embeds the query asks for, held as one string so the test
 *  and the call site cannot describe two different queries. */
export const MEMBERSHIP_SELECT =
  'organization_id, status, deleted_at, organizations!inner(slug, deleted_at), roles(key)';

export const MEMBERSHIP_TABLE = 'organization_memberships';

/**
 * Read one user's verified memberships.
 *
 * `!inner` on `organizations` is what makes the liveness filter real: with the
 * default left join PostgREST returns the membership row with a null embed
 * instead of dropping it, so a filter on the embedded column restricts nothing.
 * With the inner join the filter restricts the outer rows — and
 * `toSubjectMemberships` refuses anything that still arrives with a dead or
 * missing organization.
 *
 * The user id is the only input. No header, no body and no query parameter
 * reaches this function, so organization authority cannot be asserted by a
 * caller.
 *
 * A query error returns no memberships rather than throwing. The caller
 * (`createSupabaseAuthenticator`) treats that as "no verified membership", and
 * `resolveOrganization` then fails the request closed — a lookup failure must
 * never be the reason somebody is admitted.
 */
export async function listVerifiedMemberships(
  client: MembershipQueryClient,
  userId: string,
): Promise<SubjectMembership[]> {
  const { data, error } = await client
    .from(MEMBERSHIP_TABLE)
    .select(MEMBERSHIP_SELECT)
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .is('organizations.deleted_at', null);

  if (error) return [];
  return toSubjectMemberships(data);
}
