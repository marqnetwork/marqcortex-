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

  // ── Organization spend administration (AI-01 Batch 4D remediation, HIGH-1) ─
  //
  // DISTINCT ACTION NAMES, not the platform ones with a different target. The
  // question an incident review asks is "did anyone touch MARQ's ceiling?" and
  // "did anyone touch a customer's?", and answering the first must not require
  // reading every record's target to find out which estate it was about. The
  // organization the ledger belongs to rides in `organizationScope` and in the
  // target, so a filter by tenant works as well as a filter by action.
  //
  // Neither record ever carries credential material: the recorded facts are the
  // scope name, the cap, the settled and reserved amounts and the hold count —
  // the same shape `spendFacts` records for the platform ledger.
  organizationSpendReset: 'ai.admin.organization.spend.reset',
  organizationSpendCapRaised: 'ai.admin.organization.spend.cap_raised',

  // ── Provider administration (AI-01 Batch 4C) ──────────────────────────────
  //
  // A DISTINCT action per lifecycle event, not one `credential.changed`.
  // "A key was stored", "a key was replaced" and "a key was withdrawn" are the
  // three questions an incident review actually asks, and a single action name
  // would make each of them a search through change maps.
  //
  // None of these records ever carries the secret. See `toChangeMap` and the
  // provider administration service: the recorded facts are the credential id,
  // the keyed fingerprint, the last four characters where safe, the source and
  // the timestamps.
  providerConfigured: 'ai.admin.provider.configured',
  credentialCreated: 'ai.admin.provider.credential.created',
  credentialRotated: 'ai.admin.provider.credential.rotated',
  credentialRevoked: 'ai.admin.provider.credential.revoked',
  modelEnabled: 'ai.admin.provider.model.enabled',
  modelDisabled: 'ai.admin.provider.model.disabled',

  // ── Self-hosted providers (AI-01 Batch 4E) ────────────────────────────────
  //
  // ITS OWN ACTION, not `providerConfigured`. Defining a self-hosted provider
  // is the one administrative act that decides WHICH HOST the runtime dials,
  // and "who pointed Cortex at an endpoint, and at which one" is a question an
  // incident review has to be able to answer with a filter rather than by
  // reading every provider change ever made.
  //
  // The recorded facts are the provider key, the runtime category, the endpoint
  // HOST, the model count and the credential requirement. Never a credential,
  // and never a configuration value that failed the key-material scan.
  selfHostedProviderDefined: 'ai.admin.provider.self_hosted.defined',

  // ── Customer BYOK (AI-01 Batch 4D) ────────────────────────────────────────
  //
  // WRITTEN TO THE SAME TRAIL, WITH DISTINCT NAMES. One append-only
  // administrative record, one writer, one storage port — a second trail for
  // customer actions would be a second place for an append to be forgotten, and
  // a reviewer asking "who touched credentials in this window" would have to
  // know to look in two.
  //
  // The names are prefixed `ai.byok.` rather than `ai.admin.provider.` so the
  // two estates are separable by a text filter: "every change to MARQ's own
  // provider credentials" and "every change to a customer's" are the two
  // questions an incident review asks, and one action name for both would make
  // each of them a search through change maps.
  //
  // NONE of these records ever carries a secret. The recorded facts are the
  // provider key, the organization, the credential id, the keyed fingerprint,
  // the last four characters where safe, and the timestamps — the same set the
  // platform actions record, minus nothing and plus nothing.
  byokConfigured: 'ai.byok.credential.configured',
  byokRotated: 'ai.byok.credential.rotated',
  byokRevoked: 'ai.byok.credential.revoked',
  byokFallbackChanged: 'ai.byok.fallback.changed',
  byokAccessDenied: 'ai.byok.access.denied',
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
  /**
   * The tier the actor acted at.
   *
   * `customer_byok_admin` (AI-01 Batch 4D) is a CUSTOMER organization
   * administrator acting on their own tenant's credentials. It is deliberately
   * not folded into `organization_admin`: that name means a tier on MARQ's
   * administration surface, and a reviewer must be able to tell an action taken
   * over MARQ's estate from one taken over a customer's without reading the
   * action name as well.
   */
  readonly actorRole: AIAdminRole | 'unauthorized' | 'customer_byok_admin';
  /**
   * Organizations the actor could act for. Empty means platform-wide.
   *
   * For a BYOK record this is exactly one entry — the organization the action
   * was scoped to — so "which customer was this?" is answerable from the record
   * without joining anything.
   */
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
  readonly actorRole: AIAdminRole | 'unauthorized' | 'customer_byok_admin';
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
