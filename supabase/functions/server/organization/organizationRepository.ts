/**
 * READING THE ORGANIZATIONAL SPINE.
 *
 * The spine is five tables — `business_units`, `departments`, `people`,
 * `teams`, `team_memberships` — and this module is the one way a route reads
 * them. Everything it returns is scoped to ONE organization, and that
 * organization is always the one `resolveWorkspaceForUser` produced from the
 * authenticated membership relationship.
 *
 * THE TENANT ID IS A PARAMETER, AND THAT IS THE DANGEROUS PART
 *
 * `organizationId` has to be an argument — the repository cannot authenticate
 * anybody — so the only thing standing between this module and a cross-tenant
 * read is the discipline of its callers. Two things enforce it rather than
 * hope for it:
 *
 *   Every query filters on `organization_id` unconditionally. There is no code
 *   path here that reads a spine table without it, and no parameter that can
 *   turn the filter off. `tests/features/organizationSpine.test.ts` asserts it
 *   over the recorded query chain, not over the source text.
 *
 *   The ROUTES never read an organization id off a request. They call
 *   `resolveWorkspaceForUser` and pass what it returned. A caller-supplied
 *   tenant is not rejected by validation; there is nowhere to put one.
 *
 * Both of those are the layer ABOVE the real guarantee. The database refuses
 * the same crossings on its own — RLS on all five tables, composite foreign
 * keys that make a cross-tenant reference unrepresentable — and that is proven
 * empirically against real PostgreSQL by
 * `scripts/organizational-spine-scenarios.mjs`. This module's job is to not be
 * the reason the console never reaches those refusals.
 *
 * SERVICE ROLE, AND WHY THE SCOPE IS NOT THEREFORE DECORATIVE
 *
 * The edge function holds the service key, which bypasses RLS. So the filter
 * here IS the boundary for anything this module returns, and it is written
 * that way: one helper applies it, and every read goes through the helper.
 */

/**
 * The narrow slice of a PostgREST client this module needs.
 *
 * `select` / `eq` / `is` / `order` and nothing else — deliberately smaller than
 * the real client so a read cannot quietly grow into a write.
 */
export interface SpineQueryBuilder extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: unknown): SpineQueryBuilder;
  is(column: string, value: null): SpineQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): SpineQueryBuilder;
}

export interface SpineQueryClient {
  from(table: string): { select(columns: string): SpineQueryBuilder };
}

export class OrganizationReadError extends Error {
  /** The driver error, kept for the server log and never for the response. */
  readonly failure: unknown;

  constructor(message: string, failure: unknown) {
    super(message);
    this.name = 'OrganizationReadError';
    this.failure = failure;
  }
}

// ── What a spine read returns ───────────────────────────────────────────────

export interface BusinessUnitRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

export interface DepartmentRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  businessUnitId: string | null;
  leadPersonId: string | null;
}

export interface PersonRecord {
  id: string;
  fullName: string;
  email: string | null;
  positionTitle: string | null;
  departmentId: string | null;
  reportsToPersonId: string | null;
  status: string;
  /**
   * Whether this person also has console credentials.
   *
   * A BOOLEAN, never the auth user id. ONT 12.3 is explicit that not every
   * Identity is an active User, so `people.user_id` is nullable and a person
   * without a login is an ordinary, first-class member of the organization —
   * not a broken record. What the surface needs to know is whether the person
   * can sign in; the id itself is an authentication detail with no business on
   * an organizational roster, so it does not leave the server.
   */
  hasConsoleAccess: boolean;
}

export interface TeamRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  departmentId: string | null;
  leadPersonId: string | null;
}

export interface TeamMembershipRecord {
  teamId: string;
  personId: string;
  isLead: boolean;
}

export interface OrganizationStructure {
  businessUnits: BusinessUnitRecord[];
  departments: DepartmentRecord[];
  people: PersonRecord[];
  teams: TeamRecord[];
  teamMemberships: TeamMembershipRecord[];
}

// ── The one scoped read ─────────────────────────────────────────────────────

/** Table names, stated once so a query and its test cannot describe two tables. */
export const SPINE_TABLES = {
  businessUnits: 'business_units',
  departments: 'departments',
  people: 'people',
  teams: 'teams',
  teamMemberships: 'team_memberships',
} as const;

/**
 * Every spine read, in one place.
 *
 * `organization_id = <the resolved tenant>` and `deleted_at IS NULL` are
 * applied here and cannot be skipped by a caller: a read that forgot either
 * would return another tenant's rows or resurrect deleted ones, and neither is
 * a mistake worth leaving to a reviewer to catch.
 */
async function readScoped(
  client: SpineQueryClient,
  table: string,
  columns: string,
  organizationId: string,
  orderBy: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await client
    .from(table)
    .select(columns)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order(orderBy, { ascending: true });

  if (error) {
    throw new OrganizationReadError(
      `Failed to read ${table}`,
      error,
    );
  }
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function id(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Read the whole spine for one organization.
 *
 * Five reads rather than one nested query, because PostgREST embeds are the
 * place the tenant filter has historically been dropped silently — an embedded
 * filter on a non-inner relation restricts nothing, which is the same defect
 * `membershipDirectory` documents at length. Five flat, individually scoped
 * reads cannot have that failure, and the joining happens in the browser where
 * it decides only layout.
 */
export async function readOrganizationStructure(
  client: SpineQueryClient,
  organizationId: string,
): Promise<OrganizationStructure> {
  const [units, departments, people, teams, memberships] = await Promise.all([
    readScoped(client, SPINE_TABLES.businessUnits,
      'id, key, name, description', organizationId, 'name'),
    readScoped(client, SPINE_TABLES.departments,
      'id, key, name, description, business_unit_id, lead_person_id', organizationId, 'name'),
    readScoped(client, SPINE_TABLES.people,
      'id, full_name, email, position_title, department_id, reports_to_person_id, status, user_id',
      organizationId, 'full_name'),
    readScoped(client, SPINE_TABLES.teams,
      'id, key, name, description, department_id, lead_person_id', organizationId, 'name'),
    readScoped(client, SPINE_TABLES.teamMemberships,
      'team_id, person_id, is_lead', organizationId, 'team_id'),
  ]);

  return {
    businessUnits: units.map((row) => ({
      id: text(row.id),
      key: text(row.key),
      name: text(row.name),
      description: nullableText(row.description),
    })),
    departments: departments.map((row) => ({
      id: text(row.id),
      key: text(row.key),
      name: text(row.name),
      description: nullableText(row.description),
      businessUnitId: id(row.business_unit_id),
      leadPersonId: id(row.lead_person_id),
    })),
    people: people.map((row) => ({
      id: text(row.id),
      fullName: text(row.full_name),
      email: nullableText(row.email),
      positionTitle: nullableText(row.position_title),
      departmentId: id(row.department_id),
      reportsToPersonId: id(row.reports_to_person_id),
      status: text(row.status) || 'active',
      // The auth user id is READ and immediately reduced to a boolean. It is
      // never placed on the record, so it cannot reach the wire by accident.
      hasConsoleAccess: id(row.user_id) !== null,
    })),
    teams: teams.map((row) => ({
      id: text(row.id),
      key: text(row.key),
      name: text(row.name),
      description: nullableText(row.description),
      departmentId: id(row.department_id),
      leadPersonId: id(row.lead_person_id),
    })),
    teamMemberships: memberships.map((row) => ({
      teamId: text(row.team_id),
      personId: text(row.person_id),
      isLead: row.is_lead === true,
    })),
  };
}

/**
 * The headline numbers for the organization overview.
 *
 * Derived from the structure rather than counted separately, so the overview
 * and the lists beneath it can never disagree about how many people there are.
 */
export function summariseStructure(structure: OrganizationStructure): {
  people: number;
  peopleWithoutConsoleAccess: number;
  departments: number;
  teams: number;
  businessUnits: number;
  unassignedPeople: number;
} {
  return {
    people: structure.people.length,
    peopleWithoutConsoleAccess: structure.people.filter((p) => !p.hasConsoleAccess).length,
    departments: structure.departments.length,
    teams: structure.teams.length,
    businessUnits: structure.businessUnits.length,
    // People with no department. Named rather than hidden: an organization
    // where half the roster sits outside the structure is a fact the person
    // looking at it needs, not a rounding error.
    unassignedPeople: structure.people.filter((p) => p.departmentId === null).length,
  };
}
