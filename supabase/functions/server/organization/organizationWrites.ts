/**
 * CHANGING THE ORGANIZATIONAL SPINE.
 *
 * CP-3 built the spine and showed it. It could not be written to, so against a
 * live project every surface it fed was permanently empty — a capability whose
 * data path did not exist. This is that data path.
 *
 * ── THE AUTHORIZATION DECISION, AND WHY IT IS NOT MADE IN THIS FILE ─────────
 *
 * Every read in `organizationRepository.ts` runs under the SERVICE KEY, which
 * bypasses RLS, so its own `organization_id` filter is the boundary. That is
 * correct for a read: "which rows belong to this tenant" is a question the
 * server can answer completely and the tests can check over the query chain.
 *
 * A write asks a second question the server cannot answer from what it already
 * holds: **may this person reshape this organization?** Answering it here would
 * mean reading `role_permissions` and evaluating `organization.structure.manage`
 * in TypeScript — a second implementation of an authority model the database
 * already implements, already enforces, and already has ten proven properties
 * about. CP-3's brief forbade exactly that, and it would be the copy that drifts.
 *
 * So writes DO NOT use the service key. They run under a client carrying the
 * CALLER'S OWN JWT, and the RLS policies installed by
 * `20260917120001_cortex_organizational_spine_rls.sql` are the authorization:
 *
 *   INSERT / UPDATE  — `cortex.has_permission(organization_id, 'organization.structure.manage')`
 *   DELETE           — refused to everybody; archiving is an UPDATE of `deleted_at`
 *
 * A viewer's write is refused by PostgreSQL, not by an `if` statement. That is
 * what "UI visibility is not authorization" means in practice, and it is why the
 * proof in `scripts/organizational-spine-scenarios.mjs` is proof of the running
 * product rather than of an unused policy.
 *
 * ── THE TENANT IS NEVER TAKEN FROM THE REQUEST ─────────────────────────────
 *
 * `organization_id` is written by the server from the resolved workspace on
 * every insert, and is NOT an accepted field on any update. The field maps
 * below are allow-lists, not deny-lists: a body key that is not named is
 * dropped, so a new column cannot become writable by being added to the table.
 *
 * RLS would refuse a cross-tenant write anyway. Both are here because the day
 * one of them is wrong should not be the day a tenant boundary moves.
 */

/** The narrow client these writes need. Deliberately smaller than the real one. */
export interface WriteQueryBuilder extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: unknown): WriteQueryBuilder;
  is(column: string, value: null): WriteQueryBuilder;
  select(columns?: string): WriteQueryBuilder;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface WriteQueryClient {
  from(table: string): {
    insert(values: Record<string, unknown>): WriteQueryBuilder;
    update(values: Record<string, unknown>): WriteQueryBuilder;
  };
}

/** Why a write did not happen. Each maps to a different HTTP status. */
export type WriteFailure =
  /** The body was wrong. 400. */
  | 'invalid'
  /** RLS refused: no `organization.structure.manage` in this organization. 403. */
  | 'forbidden'
  /** The row is not in this tenant, or does not exist. 404. */
  | 'not-found'
  /** A uniqueness or foreign-key constraint said no. 409. */
  | 'conflict'
  /** Anything else. 500. */
  | 'failed';

export class OrganizationWriteError extends Error {
  readonly failure: WriteFailure;
  /** What the caller may be told. Never the driver's message. */
  readonly detail: string;

  constructor(failure: WriteFailure, detail: string) {
    super(detail);
    this.name = 'OrganizationWriteError';
    this.failure = failure;
    this.detail = detail;
  }
}

/**
 * Literal types, not `number`: Hono's `c.json` takes a `ContentfulStatusCode`,
 * and a widened `number` here would force a cast at every call site — which is
 * exactly where a wrong status would stop being a type error.
 */
export const WRITE_STATUS = {
  invalid: 400,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  failed: 500,
} as const satisfies Record<WriteFailure, number>;

// ── Reading a PostgREST error ───────────────────────────────────────────────

/**
 * Turn a driver error into one of the five failures.
 *
 * `42501` is `insufficient_privilege`; PostgREST reports an RLS refusal on
 * INSERT as `42501` or as its own `PGRST301`-family codes depending on version,
 * so the message is read as well as the code. `23505` is a unique violation and
 * `23503` a foreign-key violation — both are the caller asking for something
 * the organization's own shape forbids, which is a conflict and not a crash.
 *
 * Nothing from the driver is returned to the caller. A PostgREST error body can
 * name columns, constraints and the failing values, and an operator typing a
 * colleague's email address should not be shown a constraint definition.
 */
export function classifyWriteError(error: unknown): OrganizationWriteError {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const text = typeof message === 'string' ? message : '';

  if (code === '42501' || /row-level security|permission denied|insufficient/i.test(text)) {
    return new OrganizationWriteError(
      'forbidden',
      'Your account cannot change this organization’s structure.',
    );
  }
  if (code === '23505') {
    return new OrganizationWriteError('conflict', 'Something with that key or email already exists.');
  }
  if (code === '23503') {
    return new OrganizationWriteError(
      'conflict',
      'That references a department, team or person which is not in this organization.',
    );
  }
  if (code === '23514') {
    return new OrganizationWriteError('invalid', 'That value is not allowed for this field.');
  }
  return new OrganizationWriteError('failed', 'The change could not be saved.');
}

// ── Field normalisation ─────────────────────────────────────────────────────

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** `organizations.slug`-style normalisation, matching the `*_key_normalized` CHECKs. */
function normalisedKey(value: unknown): string {
  return trimmed(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** An empty string is not a value. `null` means "clear this", and that is different. */
function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = trimmed(value);
  return text === '' ? null : text;
}

function optionalId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = trimmed(value);
  return text === '' ? null : text;
}

function optionalEmail(value: unknown): string | null | undefined {
  const text = optionalText(value);
  if (text === undefined || text === null) return text;
  // The `people_email_normalized` CHECK requires a lower-cased, trimmed value.
  // Normalising rather than rejecting: an operator typing `Ada@Example.com` has
  // not made a mistake, and a 400 for a capital letter would be a bad product.
  return text.toLowerCase();
}

const PERSON_STATUSES = new Set(['active', 'invited', 'inactive']);

// ── What each entity accepts ────────────────────────────────────────────────

export interface SpineEntitySpec {
  readonly table: string;
  /** Required on create, in the order they are validated. */
  readonly required: readonly string[];
  /** Body key -> column, with its normaliser. Anything not here is dropped. */
  readonly fields: Readonly<Record<string, { column: string; normalise: (v: unknown) => unknown }>>;
}

const NAME_FIELD = { column: 'name', normalise: trimmed };
const KEY_FIELD = { column: 'key', normalise: normalisedKey };
const DESCRIPTION_FIELD = { column: 'description', normalise: optionalText };

export const SPINE_ENTITIES = {
  businessUnit: {
    table: 'business_units',
    required: ['name'],
    fields: { name: NAME_FIELD, key: KEY_FIELD, description: DESCRIPTION_FIELD },
  },
  department: {
    table: 'departments',
    required: ['name'],
    fields: {
      name: NAME_FIELD,
      key: KEY_FIELD,
      description: DESCRIPTION_FIELD,
      businessUnitId: { column: 'business_unit_id', normalise: optionalId },
      leadPersonId: { column: 'lead_person_id', normalise: optionalId },
    },
  },
  team: {
    table: 'teams',
    required: ['name'],
    fields: {
      name: NAME_FIELD,
      key: KEY_FIELD,
      description: DESCRIPTION_FIELD,
      departmentId: { column: 'department_id', normalise: optionalId },
      leadPersonId: { column: 'lead_person_id', normalise: optionalId },
    },
  },
  person: {
    table: 'people',
    required: ['fullName'],
    fields: {
      fullName: { column: 'full_name', normalise: trimmed },
      email: { column: 'email', normalise: optionalEmail },
      positionTitle: { column: 'position_title', normalise: optionalText },
      departmentId: { column: 'department_id', normalise: optionalId },
      reportsToPersonId: { column: 'reports_to_person_id', normalise: optionalId },
      status: {
        column: 'status',
        normalise: (v: unknown) => {
          const text = trimmed(v).toLowerCase();
          return text === '' ? undefined : text;
        },
      },
      // `user_id` is ABSENT on purpose, and its absence is load-bearing.
      //
      // Linking a person to an auth account is granting console access by
      // another route: it decides what `organization_memberships` means for
      // that human. `organization.structure.manage` is authority over the SHAPE
      // of the organization, not over who may sign in — those are different
      // permissions in the catalogue and this surface holds only the first.
      // Whoever builds account linking must do it where membership is granted.
    },
  },
} as const satisfies Record<string, SpineEntitySpec>;

export type SpineEntityName = keyof typeof SPINE_ENTITIES;

// ── Building the row ────────────────────────────────────────────────────────

/**
 * Turn an untrusted body into the columns to write.
 *
 * An allow-list, not a filter: a key the spec does not name never reaches the
 * database, so `organization_id`, `id`, `deleted_at` and `user_id` cannot be
 * set by a caller whatever they send.
 *
 * `undefined` after normalisation means "not supplied" and is omitted, which is
 * what makes a PATCH partial. `null` means "clear this" and IS written — the
 * difference is how a reporting line gets removed.
 */
export function buildSpineRow(
  entity: SpineEntityName,
  body: unknown,
  mode: 'create' | 'update',
): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new OrganizationWriteError('invalid', 'A JSON object is required.');
  }
  const spec: SpineEntitySpec = SPINE_ENTITIES[entity];
  const source = body as Record<string, unknown>;
  const row: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(spec.fields)) {
    if (!(key in source)) continue;
    const value = field.normalise(source[key]);
    if (value === undefined) continue;
    row[field.column] = value;
  }

  if (mode === 'create') {
    for (const key of spec.required) {
      const column = spec.fields[key].column;
      if (typeof row[column] !== 'string' || (row[column] as string) === '') {
        throw new OrganizationWriteError('invalid', `${key} is required.`);
      }
    }
    // A key that was not supplied is derived from the name rather than demanded.
    // Every table with a `key` has a `*_key_normalized` CHECK and a per-tenant
    // uniqueness index; an operator naming a department "Client Services"
    // should not also have to invent `client-services`.
    if ('key' in spec.fields && !row.key) {
      const derived = normalisedKey(row[spec.fields.name?.column ?? 'name']);
      if (derived === '') {
        throw new OrganizationWriteError('invalid', 'name must contain a letter or a number.');
      }
      row.key = derived;
    }
  }

  if (entity === 'person' && typeof row.status === 'string' && !PERSON_STATUSES.has(row.status)) {
    throw new OrganizationWriteError(
      'invalid',
      'status must be one of: active, invited, inactive.',
    );
  }

  if (mode === 'update' && Object.keys(row).length === 0) {
    throw new OrganizationWriteError('invalid', 'No changeable field was supplied.');
  }

  return row;
}

// ── The writes ──────────────────────────────────────────────────────────────

/** The columns a write returns, so the surface can render without a second read. */
const RETURNING: Record<SpineEntityName, string> = {
  businessUnit: 'id, key, name, description',
  department: 'id, key, name, description, business_unit_id, lead_person_id',
  team: 'id, key, name, description, department_id, lead_person_id',
  person:
    'id, full_name, email, position_title, department_id, reports_to_person_id, status, user_id',
};

async function resolve(
  builder: PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Record<string, unknown>> {
  const { data, error } = await builder;
  if (error) throw classifyWriteError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    // An UPDATE that matched nothing returns no row. Under RLS that is
    // ambiguous by design — the row may not exist, or may belong to a tenant
    // this caller cannot see — and the two must NOT be told apart, because
    // distinguishing them would answer "does this id exist in some other
    // organization?" for anyone willing to guess.
    throw new OrganizationWriteError('not-found', 'That record is not in this organization.');
  }
  return row as Record<string, unknown>;
}

/**
 * Create one spine row.
 *
 * `organization_id` comes from the resolved workspace and is applied AFTER the
 * body has been mapped, so a body field of the same name cannot win.
 */
export async function createSpineRow(
  client: WriteQueryClient,
  entity: SpineEntityName,
  organizationId: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const row = buildSpineRow(entity, body, 'create');
  return resolve(
    client
      .from(SPINE_ENTITIES[entity].table)
      .insert({ ...row, organization_id: organizationId })
      .select(RETURNING[entity]),
  );
}

/**
 * Update one spine row, within one organization.
 *
 * Both `id` and `organization_id` are matched. RLS already restricts the rows
 * this caller can touch; the explicit tenant predicate is what makes a wrong id
 * a miss rather than a cross-tenant write that RLS happens to be the only thing
 * standing in front of.
 *
 * `deleted_at IS NULL` is matched too: an archived row is not editable, and
 * silently resurrecting one by editing it would make archiving reversible by
 * accident rather than on purpose.
 */
export async function updateSpineRow(
  client: WriteQueryClient,
  entity: SpineEntityName,
  organizationId: string,
  id: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const row = buildSpineRow(entity, body, 'update');
  if (entity === 'person' && row.reports_to_person_id === id) {
    // `people_no_self_report` would refuse this as a CHECK violation, which
    // would reach the caller as "that value is not allowed". Saying what is
    // actually wrong is worth four lines.
    throw new OrganizationWriteError('invalid', 'A person cannot report to themselves.');
  }
  return resolve(
    client
      .from(SPINE_ENTITIES[entity].table)
      .update(row)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .select(RETURNING[entity]),
  );
}

/**
 * Archive one spine row.
 *
 * An UPDATE, never a DELETE. The RLS policies refuse DELETE to everybody, and
 * for a reason worth restating: a hard delete would take reporting lines and
 * team memberships with it through the composite foreign keys, silently
 * detaching people from a structure nobody asked to change.
 */
export async function archiveSpineRow(
  client: WriteQueryClient,
  entity: SpineEntityName,
  organizationId: string,
  id: string,
  now: string = new Date().toISOString(),
): Promise<Record<string, unknown>> {
  return resolve(
    client
      .from(SPINE_ENTITIES[entity].table)
      .update({ deleted_at: now })
      .eq('id', id)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .select('id'),
  );
}

// ── Team membership ─────────────────────────────────────────────────────────

/**
 * Put a person on a team, or change whether they lead it.
 *
 * Both ids are the caller's, and neither is trusted: the row carries the
 * server's `organization_id`, and `team_memberships`' two composite foreign
 * keys then make a cross-tenant pairing unrepresentable — a person from another
 * organization is not rejected by a check here, the row simply cannot exist.
 */
export async function addTeamMember(
  client: WriteQueryClient,
  organizationId: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  if (!body || typeof body !== 'object') {
    throw new OrganizationWriteError('invalid', 'A JSON object is required.');
  }
  const { teamId, personId, isLead } = body as Record<string, unknown>;
  const team = trimmed(teamId);
  const person = trimmed(personId);
  if (team === '' || person === '') {
    throw new OrganizationWriteError('invalid', 'teamId and personId are required.');
  }
  return resolve(
    client
      .from('team_memberships')
      .insert({
        organization_id: organizationId,
        team_id: team,
        person_id: person,
        is_lead: isLead === true,
      })
      .select('team_id, person_id, is_lead'),
  );
}

/** Take a person off a team. Soft, like everything else on the spine. */
export async function removeTeamMember(
  client: WriteQueryClient,
  organizationId: string,
  teamId: string,
  personId: string,
  now: string = new Date().toISOString(),
): Promise<Record<string, unknown>> {
  return resolve(
    client
      .from('team_memberships')
      .update({ deleted_at: now })
      .eq('organization_id', organizationId)
      .eq('team_id', teamId)
      .eq('person_id', personId)
      .is('deleted_at', null)
      .select('team_id, person_id'),
  );
}
