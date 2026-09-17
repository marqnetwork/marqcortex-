/**
 * READING AND WRITING THE STRATEGIC LAYER.
 *
 * Goals, decisions and risks — ONT 13.4, 14.8 and 17.6. The same two shapes
 * the organizational spine already uses, for the same two reasons:
 *
 *   READS run under the service key with an unconditional `organization_id`
 *   filter, because "which rows are this tenant's" is a question the server can
 *   answer completely and the tests can check over the query chain.
 *
 *   WRITES run under the CALLER'S OWN JWT, so the RLS policies decide whether
 *   this person may record a goal. Evaluating `strategy.manage` here would be a
 *   second copy of an authority model the database already implements and
 *   already has fourteen proven properties about.
 *
 * `organizationWrites.ts` holds the spine's version of all of this, and the two
 * files deliberately do NOT share a generic abstraction. They share a shape,
 * which is different: a single parameterised writer over eight tables would put
 * the tenant filter, the allow-list and the failure mapping one indirection
 * away from every call site that depends on them, and the next table added to
 * it would be the one that got a field map nobody read.
 */

import {
  buildAllowedRow,
  classifyWriteError,
  OrganizationWriteError,
  type FieldSpec,
  type WriteQueryClient,
} from './organizationWrites.ts';

/** The same narrow read port the spine repository declares. */
export interface StrategyQueryBuilder extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: unknown): StrategyQueryBuilder;
  is(column: string, value: null): StrategyQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): StrategyQueryBuilder;
}

export interface StrategyQueryClient {
  from(table: string): { select(columns: string): StrategyQueryBuilder };
}

export class StrategyReadError extends Error {
  readonly failure: unknown;
  constructor(message: string, failure: unknown) {
    super(message);
    this.name = 'StrategyReadError';
    this.failure = failure;
  }
}

// ── What a strategic read returns ───────────────────────────────────────────

export interface GoalRecord {
  id: string;
  statement: string;
  measure: string | null;
  targetValue: string | null;
  currentValue: string | null;
  dueOn: string | null;
  status: string;
  ownerPersonId: string | null;
}

export interface DecisionRecord {
  id: string;
  statement: string;
  alternatives: string | null;
  rationale: string | null;
  goalId: string | null;
  decidedByPersonId: string | null;
  decidedOn: string | null;
  reviewOn: string | null;
  status: string;
}

export interface RiskRecord {
  id: string;
  statement: string;
  likelihood: string;
  impact: string;
  tolerance: string;
  mitigation: string | null;
  goalId: string | null;
  ownerPersonId: string | null;
  status: string;
}

export interface StrategyRecords {
  goals: GoalRecord[];
  decisions: DecisionRecord[];
  risks: RiskRecord[];
}

export const STRATEGY_TABLES = {
  goal: 'goals',
  decision: 'decisions',
  risk: 'risks',
} as const;

export type StrategyEntityName = keyof typeof STRATEGY_TABLES;

const SELECTS: Record<StrategyEntityName, string> = {
  goal: 'id, statement, measure, target_value, current_value, due_on, status, owner_person_id',
  decision:
    'id, statement, alternatives, rationale, goal_id, decided_by_person_id, decided_on, review_on, status',
  risk:
    'id, statement, likelihood, impact, tolerance, mitigation, goal_id, owner_person_id, status',
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullable(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * One scoped read, and every strategic read goes through it.
 *
 * `organization_id = <the resolved tenant>` and `deleted_at IS NULL` are
 * applied here and cannot be skipped by a caller. The service key bypasses RLS,
 * so for anything this returns, this filter IS the boundary.
 */
async function readScoped(
  client: StrategyQueryClient,
  table: string,
  columns: string,
  organizationId: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await client
    .from(table)
    .select(columns)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) throw new StrategyReadError(`Failed to read ${table}`, error);
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/**
 * Read the whole strategic layer for one organization.
 *
 * Three flat reads rather than one nested query, for the reason the spine
 * repository gives at length: a PostgREST embed on a non-inner relation
 * restricts nothing, and the tenant filter has historically been dropped
 * silently exactly there.
 */
export async function readStrategy(
  client: StrategyQueryClient,
  organizationId: string,
): Promise<StrategyRecords> {
  const [goals, decisions, risks] = await Promise.all([
    readScoped(client, STRATEGY_TABLES.goal, SELECTS.goal, organizationId),
    readScoped(client, STRATEGY_TABLES.decision, SELECTS.decision, organizationId),
    readScoped(client, STRATEGY_TABLES.risk, SELECTS.risk, organizationId),
  ]);

  return {
    goals: goals.map((row) => ({
      id: text(row.id),
      statement: text(row.statement),
      measure: nullable(row.measure),
      targetValue: nullable(row.target_value),
      currentValue: nullable(row.current_value),
      dueOn: nullable(row.due_on),
      status: text(row.status) || 'planned',
      ownerPersonId: nullable(row.owner_person_id),
    })),
    decisions: decisions.map((row) => ({
      id: text(row.id),
      statement: text(row.statement),
      alternatives: nullable(row.alternatives),
      rationale: nullable(row.rationale),
      goalId: nullable(row.goal_id),
      decidedByPersonId: nullable(row.decided_by_person_id),
      decidedOn: nullable(row.decided_on),
      reviewOn: nullable(row.review_on),
      status: text(row.status) || 'proposed',
    })),
    risks: risks.map((row) => ({
      id: text(row.id),
      statement: text(row.statement),
      likelihood: text(row.likelihood) || 'medium',
      impact: text(row.impact) || 'medium',
      tolerance: text(row.tolerance) || 'unset',
      mitigation: nullable(row.mitigation),
      goalId: nullable(row.goal_id),
      ownerPersonId: nullable(row.owner_person_id),
      status: text(row.status) || 'open',
    })),
  };
}

/**
 * What the organization's intent looks like at a glance.
 *
 * Derived from the records rather than counted separately, so the overview and
 * the lists beneath it can never disagree.
 *
 * `decisionsWithoutRationale` is the one number here that is an OPINION, and it
 * is the canon's: ONT 14.8 lists "justified" among a Decision's defining
 * characteristics, so a decision with no rationale is an incomplete record of
 * one. Counting it is how the surface can say so without anybody having to
 * read every row.
 */
export function summariseStrategy(records: StrategyRecords): {
  goals: number;
  goalsInProgress: number;
  goalsWithoutOwner: number;
  decisions: number;
  decisionsWithoutRationale: number;
  risks: number;
  risksOutsideTolerance: number;
  risksUnassessed: number;
} {
  return {
    goals: records.goals.length,
    goalsInProgress: records.goals.filter((g) => g.status === 'in_progress').length,
    // A goal nobody owns is a goal nobody is working on.
    goalsWithoutOwner: records.goals.filter((g) => g.ownerPersonId === null).length,
    decisions: records.decisions.length,
    decisionsWithoutRationale: records.decisions.filter((d) => d.rationale === null).length,
    risks: records.risks.length,
    risksOutsideTolerance: records.risks.filter((r) => r.tolerance === 'outside').length,
    risksUnassessed: records.risks.filter((r) => r.tolerance === 'unset').length,
  };
}

// ── Writing ─────────────────────────────────────────────────────────────────

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const t = trimmed(value);
  return t === '' ? null : t;
}

function optionalId(value: unknown): string | null | undefined {
  return optionalText(value);
}

/** An ISO date, or a refusal. A malformed date reaching the database becomes a
 *  driver error the caller cannot act on; named here, it becomes a sentence. */
function optionalDate(value: unknown): string | null | undefined {
  const t = optionalText(value);
  if (t === undefined || t === null) return t;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new OrganizationWriteError('invalid', 'A date must be written as YYYY-MM-DD.');
  }
  return t;
}

function enumerated(name: string, allowed: readonly string[]) {
  return (value: unknown): string | undefined => {
    const t = trimmed(value).toLowerCase();
    if (t === '') return undefined;
    if (!allowed.includes(t)) {
      throw new OrganizationWriteError('invalid', `${name} must be one of: ${allowed.join(', ')}.`);
    }
    return t;
  };
}

/**
 * The fields each strategic entity accepts.
 *
 * Allow-lists, exactly as the spine's are: a body key that is not named here
 * never reaches the database, so `organization_id`, `id` and `deleted_at`
 * cannot be set by a caller whatever they send, and a column added to the table
 * tomorrow is safe by default rather than writable by default.
 */
export const STRATEGY_ENTITIES: Record<
  StrategyEntityName,
  { table: string; required: readonly string[]; fields: Readonly<Record<string, FieldSpec>> }
> = {
  goal: {
    table: STRATEGY_TABLES.goal,
    required: ['statement'],
    fields: {
      statement: { column: 'statement', normalise: trimmed },
      measure: { column: 'measure', normalise: optionalText },
      targetValue: { column: 'target_value', normalise: optionalText },
      currentValue: { column: 'current_value', normalise: optionalText },
      dueOn: { column: 'due_on', normalise: optionalDate },
      ownerPersonId: { column: 'owner_person_id', normalise: optionalId },
      status: {
        column: 'status',
        normalise: enumerated('status', [
          'planned', 'in_progress', 'on_hold', 'under_review', 'completed', 'cancelled',
        ]),
      },
    },
  },
  decision: {
    table: STRATEGY_TABLES.decision,
    required: ['statement'],
    fields: {
      statement: { column: 'statement', normalise: trimmed },
      alternatives: { column: 'alternatives', normalise: optionalText },
      rationale: { column: 'rationale', normalise: optionalText },
      goalId: { column: 'goal_id', normalise: optionalId },
      decidedByPersonId: { column: 'decided_by_person_id', normalise: optionalId },
      decidedOn: { column: 'decided_on', normalise: optionalDate },
      reviewOn: { column: 'review_on', normalise: optionalDate },
      status: {
        column: 'status',
        normalise: enumerated('status', ['proposed', 'decided', 'superseded', 'cancelled']),
      },
    },
  },
  risk: {
    table: STRATEGY_TABLES.risk,
    required: ['statement'],
    fields: {
      statement: { column: 'statement', normalise: trimmed },
      likelihood: { column: 'likelihood', normalise: enumerated('likelihood', ['low', 'medium', 'high']) },
      impact: { column: 'impact', normalise: enumerated('impact', ['low', 'medium', 'high']) },
      tolerance: { column: 'tolerance', normalise: enumerated('tolerance', ['unset', 'within', 'outside']) },
      mitigation: { column: 'mitigation', normalise: optionalText },
      goalId: { column: 'goal_id', normalise: optionalId },
      ownerPersonId: { column: 'owner_person_id', normalise: optionalId },
      status: {
        column: 'status',
        normalise: enumerated('status', ['open', 'mitigating', 'accepted', 'closed']),
      },
    },
  },
};

/**
 * Turn an untrusted body into the columns to write, and say what is wrong in
 * the caller's terms rather than the database's.
 *
 * The two CHECK constraints this anticipates are the ones the canon put there:
 * a `decided` decision names who decided it (ONT 14.8, "traceable"), and an
 * `accepted` risk has had its tolerance decided (ONT 17.6). Both would reach
 * the caller as "that value is not allowed" if left to PostgreSQL, which is
 * true and useless.
 */
export function buildStrategyRow(
  entity: StrategyEntityName,
  body: unknown,
  mode: 'create' | 'update',
  existing?: Partial<DecisionRecord & RiskRecord>,
): Record<string, unknown> {
  const spec = STRATEGY_ENTITIES[entity];
  const row = buildAllowedRow(spec, body, mode);

  if (entity === 'decision') {
    const status = (row.status ?? existing?.status) as string | undefined;
    if (status === 'decided') {
      const decider = 'decided_by_person_id' in row
        ? row.decided_by_person_id
        : existing?.decidedByPersonId ?? null;
      const on = 'decided_on' in row ? row.decided_on : existing?.decidedOn ?? null;
      if (!decider || !on) {
        throw new OrganizationWriteError(
          'invalid',
          'A decision that has been made needs a decider and a date.',
        );
      }
    }
  }

  if (entity === 'risk') {
    const status = (row.status ?? existing?.status) as string | undefined;
    if (status === 'accepted') {
      const tolerance = 'tolerance' in row ? row.tolerance : existing?.tolerance ?? 'unset';
      if (tolerance === 'unset' || tolerance === undefined) {
        throw new OrganizationWriteError(
          'invalid',
          'A risk can only be accepted once its tolerance has been decided.',
        );
      }
    }
  }

  return row;
}

const RETURNING: Record<StrategyEntityName, string> = SELECTS;

async function resolve(
  builder: PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Record<string, unknown>> {
  const { data, error } = await builder;
  if (error) throw classifyWriteError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    // Under RLS "does not exist" and "is not yours" are deliberately the same
    // answer; distinguishing them would confirm whether an id exists in some
    // other organization for anyone willing to guess.
    throw new OrganizationWriteError('not-found', 'That record is not in this organization.');
  }
  return row as Record<string, unknown>;
}

export async function createStrategyRow(
  client: WriteQueryClient,
  entity: StrategyEntityName,
  organizationId: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const row = buildStrategyRow(entity, body, 'create');
  // The tenant is applied AFTER the body, so a body field of the same name
  // cannot win.
  return resolve(
    client
      .from(STRATEGY_ENTITIES[entity].table)
      .insert({ ...row, organization_id: organizationId })
      .select(RETURNING[entity]),
  );
}

export async function updateStrategyRow(
  client: WriteQueryClient,
  entity: StrategyEntityName,
  organizationId: string,
  id: string,
  body: unknown,
  existing?: Partial<DecisionRecord & RiskRecord>,
): Promise<Record<string, unknown>> {
  const row = buildStrategyRow(entity, body, 'update', existing);
  return resolve(
    client
      .from(STRATEGY_ENTITIES[entity].table)
      .update(row)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .select(RETURNING[entity]),
  );
}

/** Archive, never delete. The RLS policies refuse DELETE to everybody. */
export async function archiveStrategyRow(
  client: WriteQueryClient,
  entity: StrategyEntityName,
  organizationId: string,
  id: string,
  now: string = new Date().toISOString(),
): Promise<Record<string, unknown>> {
  return resolve(
    client
      .from(STRATEGY_ENTITIES[entity].table)
      .update({ deleted_at: now })
      .eq('id', id)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .select('id'),
  );
}
