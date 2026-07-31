/**
 * Event contracts for the AI Control Plane event bus.
 *
 * Events are the platform's extension seam: budget alerting, provider
 * failover notification, learning-loop capture and future AI orchestration all
 * subscribe here instead of editing the execution path. Every event carries the
 * full trace identity so a subscriber can correlate without a lookup.
 *
 * Events are notifications, never control flow. A subscriber cannot alter or
 * veto an execution — that is what the policy engine is for.
 */

import type { AIErrorCode } from './errors.ts';

export type AIEventName =
  | 'ai.request.received'
  | 'ai.request.authorized'
  | 'ai.request.rejected'
  | 'ai.provider.selected'
  | 'ai.provider.attempt_failed'
  | 'ai.provider.circuit_opened'
  | 'ai.provider.circuit_closed'
  | 'ai.governance.input_redacted'
  | 'ai.governance.output_blocked'
  | 'ai.governance.fact_lock_enforced'
  | 'ai.budget.threshold_reached'
  | 'ai.budget.exceeded'
  | 'ai.spend.reserved'
  | 'ai.spend.cap_reached'
  | 'ai.request.succeeded'
  | 'ai.request.failed';

export interface AIEventIdentity {
  readonly requestId: string;
  readonly correlationId: string;
  readonly featureId: string;
  readonly organizationId: string;
  readonly actorId: string;
}

export interface AIEvent {
  readonly eventId: string;
  readonly name: AIEventName;
  readonly occurredAt: string;
  readonly identity: AIEventIdentity;
  /** Event-specific detail. Must never contain prompt or completion text. */
  readonly detail: Readonly<Record<string, string | number | boolean>>;
  readonly errorCode?: AIErrorCode;
}

export type AIEventHandler = (event: AIEvent) => void | Promise<void>;

export interface AIEventBus {
  /** Subscribe to one event name. Returns an unsubscribe function. */
  on(name: AIEventName, handler: AIEventHandler): () => void;
  /** Subscribe to every event. Returns an unsubscribe function. */
  onAny(handler: AIEventHandler): () => void;
  /**
   * Publish. Never throws and never rejects: a failing subscriber must not
   * be able to fail an AI request.
   */
  publish(event: AIEvent): void;
}
