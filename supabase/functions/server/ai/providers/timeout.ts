/**
 * Timeout management for provider attempts.
 *
 * Every provider call runs under a deadline. Without one, a hung upstream
 * connection holds an edge invocation open until the platform's own limit kills
 * it — the caller waits the maximum, no useful error is produced, and the
 * request never gets the chance to fail over to a healthy provider.
 *
 * Two guarantees this module provides that a bare `setTimeout` does not:
 *
 *   The timer is always cleared. A leaked timer keeps an edge isolate alive
 *   past the response, which is billed time and, at volume, a memory leak.
 *
 *   Abort is distinguishable. A caller-triggered abort and a deadline expiry
 *   both surface as an aborted fetch; conflating them would report a client
 *   disconnect as a provider timeout and open a circuit that should stay closed.
 */

import { AIError } from '../contracts/errors.ts';

export interface TimeoutHandle {
  readonly signal: AbortSignal;
  /** True once the deadline has fired. */
  readonly expired: () => boolean;
  /** Always call. Idempotent. */
  readonly cancel: () => void;
}

export function startTimeout(timeoutMs: number, parent?: AbortSignal): TimeoutHandle {
  const controller = new AbortController();
  let expired = false;

  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);

  const onParentAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener('abort', onParentAbort, { once: true });
  }

  let cancelled = false;
  return {
    signal: controller.signal,
    expired: () => expired,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

/**
 * Run `work` under a deadline. The handle is passed in so the caller can hand
 * the same signal to the provider adapter, letting an in-flight HTTP request be
 * cancelled rather than merely abandoned.
 */
export async function withTimeout<T>(
  timeoutMs: number,
  providerId: string,
  work: (handle: TimeoutHandle) => Promise<T>,
  parent?: AbortSignal,
): Promise<T> {
  const handle = startTimeout(timeoutMs, parent);
  try {
    return await work(handle);
  } catch (error) {
    if (handle.expired()) {
      throw new AIError('PROVIDER_TIMEOUT', 'The AI provider did not respond in time.', {
        providerId,
        diagnostics: `timeout after ${timeoutMs}ms`,
        cause: error,
      });
    }
    throw error;
  } finally {
    handle.cancel();
  }
}
