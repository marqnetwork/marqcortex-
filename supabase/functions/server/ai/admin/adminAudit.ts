/**
 * Administrative change trail.
 *
 * A second, deliberately separate record from the AI execution audit. They
 * answer different questions and a reviewer must never have to disentangle them:
 *
 *   observability/audit.ts   what the platform DID — one record per AI request.
 *   this module              what an administrator CHANGED — one record per
 *                            accepted mutation, with the before and after.
 *
 * Three properties, and each one is the reason an auditor trusts the trail:
 *
 *   APPEND ONLY. The interface has `append`, `recent` and `size`. There is no
 *   update, no delete, no `clear` outside the in-memory test store. A trail an
 *   administrator can edit is a trail that proves nothing about administrators.
 *
 *   EVERY CHANGE CARRIES A REASON. The service refuses a mutation with no
 *   reason before it reaches the plane, so "why is the kill switch engaged?"
 *   has an answer that does not depend on somebody remembering to write one.
 *
 *   BEFORE AND AFTER, NOT A DIFF. The record stores both sides as bounded
 *   scalar maps. A diff is derived; a diff computed at write time is a claim
 *   about state nobody can re-check later.
 *
 * WHAT IS DELIBERATELY NOT STORED: anything unbounded. Values are stringified
 * and truncated, so a record cannot become a copy of a settings blob and a
 * malformed field cannot make the store unreadable.
 */

import type { Clock } from '../runtime/clock.ts';
import type { AIAdminRole } from './rbac.ts';

/** Every administrative operation the platform recognises. */
export const ADMIN_ACTION = {
  settingsUpdated: 'ai.admin.settings.updated',
  aiEnabled: 'ai.admin.ai.enabled',
  aiDisabled: 'ai.admin.ai.disabled',
  emergencyStopEngaged: 'ai.admin.emergency_stop.engaged',
  emergencyStopReleased: 'ai.admin.emergency_stop.released',
  realRequestsEnabled: 'ai.admin.real_requests.enabled',
  realRequestsDisabled: 'ai.admin.real_requests.disabled',
  providerUpdated: 'ai.admin.provider.updated',
  providerEnabled: 'ai.admin.provider.enabled',
  providerDisabled: 'ai.admin.provider.disabled',
  modelPinned: 'ai.admin.model.pinned',
  budgetUpdated: 'ai.admin.budget.updated',
  spendReset: 'ai.admin.spend.reset',
  spendCapRaised: 'ai.admin.spend.cap_raised',
  accessDenied: 'ai.admin.access.denied',
} as const;

export type AdminAction = (typeof ADMIN_ACTION)[keyof typeof ADMIN_ACTION];

/** Bounded scalars. Anything larger belongs in the settings record, not here. */
export type AdminChangeMap = Readonly<Record<string, string>>;

export interface AdminAuditRecord {
  readonly adminAuditId: string;
  readonly recordedAt: string;
  readonly action: AdminAction;
  readonly outcome: 'applied' | 'rejected';
  readonly actorId: string;
  readonly actorEmail?: string;
  readonly actorRole: AIAdminRole | 'unauthorized';
  /** Organizations the actor could act for. Empty means platform-wide. */
  readonly organizationScope: readonly string[];
  /** What was changed — a provider id, a scope name, a setting group. */
  readonly target?: string;
  readonly reason: string;
  readonly before: AdminChangeMap;
  readonly after: AdminChangeMap;
  /** Configuration version produced by this change, when one was. */
  readonly configurationVersion?: number;
  readonly correlationId?: string;
  readonly clientIp?: string;
  /** Set when `outcome` is `rejected`. */
  readonly rejectionCode?: string;
}

/**
 * Storage port. Append and read. Note what is missing and note that it is
 * missing on purpose — there is no way to express "modify a past record"
 * through this interface, so no implementation can offer one.
 */
export interface AdminAuditStore {
  append(record: AdminAuditRecord): void | Promise<void>;
  recent(limit: number): readonly AdminAuditRecord[];
  size(): number;
}

const MAX_VALUE_LENGTH = 200;
const MAX_ENTRIES = 40;

/**
 * Coerce arbitrary settings values into a bounded scalar map.
 *
 * Arrays become comma-joined strings and objects become JSON, both truncated.
 * The trail records what changed in a form a human reads in an incident review;
 * the authoritative value lives in the settings record the change produced.
 */
export function toChangeMap(values: Readonly<Record<string, unknown>>): AdminChangeMap {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (Object.keys(out).length >= MAX_ENTRIES) break;
    if (value === undefined) continue;
    out[key.slice(0, 60)] = stringify(value).slice(0, MAX_VALUE_LENGTH);
  }
  return out;
}

function stringify(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.map((entry) => stringify(entry)).join(',');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? '';
    } catch {
      return '[unserializable]';
    }
  }
  return String(value);
}

/** Only the keys whose values differ. What a reviewer reads first. */
export function changedKeys(before: AdminChangeMap, after: AdminChangeMap): readonly string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => before[key] !== after[key]).sort();
}

/** Bounded in-memory ring buffer. Always present, even with a durable store. */
export function createMemoryAdminAuditStore(capacity: number): AdminAuditStore {
  const records: AdminAuditRecord[] = [];
  return {
    append(record) {
      records.push(record);
      if (records.length > capacity) records.splice(0, records.length - capacity);
    },
    recent: (limit) => records.slice(-limit).reverse(),
    size: () => records.length,
  };
}

/**
 * Write to several stores. A failing durable store must not fail the
 * administrative action that produced the record — but it must be loud, which
 * is what `onError` is for.
 */
export function createCompositeAdminAuditStore(
  primary: AdminAuditStore,
  secondaries: readonly AdminAuditStore[],
  onError: (error: unknown) => void,
): AdminAuditStore {
  return {
    append(record) {
      primary.append(record);
      for (const store of secondaries) {
        try {
          const result = store.append(record);
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch(onError);
          }
        } catch (error) {
          onError(error);
        }
      }
    },
    recent: (limit) => primary.recent(limit),
    size: () => primary.size(),
  };
}

export interface AdminAuditFacts {
  readonly action: AdminAction;
  readonly outcome: 'applied' | 'rejected';
  readonly actorId: string;
  readonly actorEmail?: string;
  readonly actorRole: AIAdminRole | 'unauthorized';
  readonly organizationScope?: readonly string[];
  readonly target?: string;
  readonly reason: string;
  readonly before?: AdminChangeMap;
  readonly after?: AdminChangeMap;
  readonly configurationVersion?: number;
  readonly correlationId?: string;
  readonly clientIp?: string;
  readonly rejectionCode?: string;
}

export interface AdminAuditWriter {
  record(facts: AdminAuditFacts): AdminAuditRecord;
  recent(limit: number): readonly AdminAuditRecord[];
  size(): number;
}

export function createAdminAuditWriter(deps: {
  readonly store: AdminAuditStore;
  readonly clock: Clock;
  readonly newAuditId: () => string;
}): AdminAuditWriter {
  return {
    record(facts) {
      const record: AdminAuditRecord = {
        adminAuditId: deps.newAuditId(),
        recordedAt: deps.clock.isoNow(),
        action: facts.action,
        outcome: facts.outcome,
        actorId: facts.actorId,
        actorEmail: facts.actorEmail,
        actorRole: facts.actorRole,
        organizationScope: facts.organizationScope ?? [],
        target: facts.target,
        reason: facts.reason,
        before: facts.before ?? {},
        after: facts.after ?? {},
        configurationVersion: facts.configurationVersion,
        correlationId: facts.correlationId,
        clientIp: facts.clientIp,
        rejectionCode: facts.rejectionCode,
      };
      deps.store.append(record);
      return record;
    },
    recent: (limit) => deps.store.recent(limit),
    size: () => deps.store.size(),
  };
}
