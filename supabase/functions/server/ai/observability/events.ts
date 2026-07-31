/**
 * AI event bus.
 *
 * In-process publish/subscribe over the `AIEventBus` contract. This is the
 * platform's extension seam: budget alerting, provider failover notification,
 * learning-loop capture and future AI orchestration subscribe here instead of
 * editing the execution path.
 *
 * The one invariant that matters: publishing is best-effort and never throws.
 * A subscriber that fails — or returns a rejected promise — must not be able to
 * fail a customer's AI request. Subscriber failures are reported through the
 * injected `onError` callback, which the control plane wires to the logger, so a
 * broken subscriber is loud without being fatal.
 */

import type { AIEvent, AIEventBus, AIEventHandler, AIEventName } from '../contracts/events.ts';

export interface EventBusOptions {
  /** Called when a subscriber throws or rejects. Must not throw itself. */
  readonly onError?: (event: AIEvent, error: unknown) => void;
}

export function createEventBus(options: EventBusOptions = {}): AIEventBus {
  const byName = new Map<AIEventName, Set<AIEventHandler>>();
  const universal = new Set<AIEventHandler>();

  function report(event: AIEvent, error: unknown): void {
    try {
      options.onError?.(event, error);
    } catch {
      // An error reporter that itself throws must not escalate. There is
      // nothing further to do here and nothing worth failing a request over.
    }
  }

  function dispatch(handler: AIEventHandler, event: AIEvent): void {
    try {
      const result = handler(event);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) => report(event, error));
      }
    } catch (error) {
      report(event, error);
    }
  }

  return {
    on(name, handler) {
      const handlers = byName.get(name) ?? new Set<AIEventHandler>();
      handlers.add(handler);
      byName.set(name, handlers);
      return () => {
        handlers.delete(handler);
      };
    },

    onAny(handler) {
      universal.add(handler);
      return () => {
        universal.delete(handler);
      };
    },

    publish(event) {
      // Snapshot before dispatch: a handler that unsubscribes itself (a
      // one-shot alert, for example) must not mutate the set being iterated.
      for (const handler of [...(byName.get(event.name) ?? [])]) dispatch(handler, event);
      for (const handler of [...universal]) dispatch(handler, event);
    },
  };
}
