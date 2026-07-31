/**
 * Durable audit for AI executions.
 *
 * One record per execution — successful or failed — carrying everything needed
 * to answer, months later: who asked, on behalf of which organization, which
 * feature and feature version, which prompt at which version and hash, which
 * provider and model actually served it, what policy rules were evaluated, what
 * the governance layer did, what it cost, and how it ended.
 *
 * WHAT IS DELIBERATELY NOT STORED: prompt text and model output. The record
 * carries SHA-256 digests of both instead. A digest proves which exact content
 * was sent and returned — enough to detect tampering, to prove a completion came
 * from a specific prompt version, and to correlate identical inputs — without
 * turning the audit store into an uncontrolled copy of every client's business
 * data. Reproduction is still possible: prompt version plus digest identifies
 * the template exactly, and the caller's own record holds the input.
 *
 * Storage is a port. `MemoryAuditStore` backs the operational endpoint; the
 * durable KV store in ../adapters is what satisfies retention. Writes are
 * fire-and-forget by design — an audit backend outage must degrade to
 * "buffered, alerted" rather than "every AI request fails".
 */

import type { AIErrorCode } from '../contracts/errors.ts';
import type { AIRequestContext, AITokenUsage } from '../contracts/request.ts';
import type { AIPolicyDecision } from '../contracts/policy.ts';
import type { Clock } from '../runtime/clock.ts';

export type AuditOutcome = 'success' | 'failure';

export interface AIAuditRecord {
  readonly auditId: string;
  readonly recordedAt: string;

  // Trace identity
  readonly requestId: string;
  readonly correlationId: string;
  readonly causationId?: string;

  // Versioning
  readonly platformVersion: string;
  readonly contractVersion: string;
  readonly featureId: string;
  readonly featureVersion: string;

  // Identity
  readonly organizationId: string;
  readonly organizationTier: string;
  readonly actorId: string;
  readonly actorType: string;
  readonly actorRoles: readonly string[];
  readonly channel: string;
  readonly clientIp?: string;

  // Prompt provenance
  readonly promptId?: string;
  readonly promptVersion?: string;
  readonly promptHash?: string;
  readonly inputDigest?: string;
  readonly outputDigest?: string;

  // Execution
  readonly providerId?: string;
  readonly modelId?: string;
  readonly attempts: number;
  readonly failedProviders: readonly string[];
  readonly latencyMs: number;
  readonly usage?: AITokenUsage;
  readonly costMicroUsd?: number;

  // Governance and policy
  readonly policyRulesEvaluated: readonly string[];
  readonly policyViolation?: string;
  readonly inputGuard: string;
  readonly outputGuard: string;
  readonly redactedCategories: readonly string[];
  readonly governanceFlags: readonly string[];
  readonly factLockRestored: readonly string[];

  // Outcome
  readonly outcome: AuditOutcome;
  readonly errorCode?: AIErrorCode;
  readonly errorMessage?: string;
}

export interface AuditStore {
  /** Persist one record. Must not throw — failures are the store's problem. */
  append(record: AIAuditRecord): void | Promise<void>;
  /** Most recent records, newest first. Used by the operational endpoint. */
  recent(limit: number): readonly AIAuditRecord[];
  size(): number;
}

/**
 * Bounded in-memory ring buffer. Always present, even when a durable store is
 * configured, so the operations endpoint answers instantly and stays available
 * when the durable backend does not.
 */
export function createMemoryAuditStore(capacity: number): AuditStore {
  const records: AIAuditRecord[] = [];
  return {
    append(record) {
      records.push(record);
      if (records.length > capacity) records.splice(0, records.length - capacity);
    },
    recent(limit) {
      return records.slice(-limit).reverse();
    },
    size() {
      return records.length;
    },
  };
}

/**
 * Write to several stores. A failing store is isolated: the others still
 * receive the record, and the failure is surfaced through `onError` rather than
 * propagating into the request path.
 */
export function createCompositeAuditStore(
  primary: AuditStore,
  secondaries: readonly AuditStore[],
  onError: (error: unknown) => void,
): AuditStore {
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

export interface AuditWriterDependencies {
  readonly store: AuditStore;
  readonly clock: Clock;
  readonly newAuditId: () => string;
}

export interface AuditFacts {
  readonly outcome: AuditOutcome;
  readonly latencyMs: number;
  readonly attempts: number;
  readonly failedProviders?: readonly string[];
  readonly providerId?: string;
  readonly modelId?: string;
  readonly promptId?: string;
  readonly promptVersion?: string;
  readonly promptHash?: string;
  readonly inputDigest?: string;
  readonly outputDigest?: string;
  readonly usage?: AITokenUsage;
  readonly costMicroUsd?: number;
  readonly policy?: AIPolicyDecision;
  readonly inputGuard?: string;
  readonly outputGuard?: string;
  readonly redactedCategories?: readonly string[];
  readonly governanceFlags?: readonly string[];
  readonly factLockRestored?: readonly string[];
  readonly errorCode?: AIErrorCode;
  readonly errorMessage?: string;
}

export interface AuditWriter {
  record(context: AIRequestContext, facts: AuditFacts): AIAuditRecord;
  recent(limit: number): readonly AIAuditRecord[];
}

export function createAuditWriter(deps: AuditWriterDependencies): AuditWriter {
  return {
    record(context, facts) {
      const record: AIAuditRecord = {
        auditId: deps.newAuditId(),
        recordedAt: deps.clock.isoNow(),

        requestId: context.requestId,
        correlationId: context.correlationId,
        causationId: context.causationId,

        platformVersion: context.platformVersion,
        contractVersion: context.contractVersion,
        featureId: context.featureId,
        featureVersion: context.featureVersion,

        organizationId: context.organization.organizationId,
        organizationTier: context.organization.tier,
        actorId: context.actor.actorId,
        actorType: context.actor.actorType,
        actorRoles: context.actor.roles,
        channel: context.channel,
        clientIp: context.clientIp,

        promptId: facts.promptId,
        promptVersion: facts.promptVersion,
        promptHash: facts.promptHash,
        inputDigest: facts.inputDigest,
        outputDigest: facts.outputDigest,

        providerId: facts.providerId,
        modelId: facts.modelId,
        attempts: facts.attempts,
        failedProviders: facts.failedProviders ?? [],
        latencyMs: facts.latencyMs,
        usage: facts.usage,
        costMicroUsd: facts.costMicroUsd,

        policyRulesEvaluated: facts.policy?.evaluated ?? [],
        policyViolation: facts.policy?.violation
          ? `${facts.policy.violation.rule}: ${facts.policy.violation.detail}`
          : undefined,
        inputGuard: facts.inputGuard ?? 'not_reached',
        outputGuard: facts.outputGuard ?? 'not_reached',
        redactedCategories: facts.redactedCategories ?? [],
        governanceFlags: facts.governanceFlags ?? [],
        factLockRestored: facts.factLockRestored ?? [],

        outcome: facts.outcome,
        errorCode: facts.errorCode,
        errorMessage: facts.errorMessage,
      };

      deps.store.append(record);
      return record;
    },

    recent(limit) {
      return deps.store.recent(limit);
    },
  };
}
