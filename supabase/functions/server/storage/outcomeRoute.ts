/**
 * Outcome GET route handler — diagnostic domain (MCV2-S7.4-REMEDIATION · G6)
 *
 * Extracts the KV-authoritative read behind `GET /submissions/:id/outcome` into
 * a small, directly-testable handler so the real route and its runtime wiring
 * (KV read → unchanged envelope → non-blocking shadow scheduling) can be
 * covered by focused tests without booting the whole Hono app.
 *
 * The response envelope is byte-identical to the pre-gateway route:
 *   { success: true, outcome: <kv value | null> }
 * SQL is never surfaced; the shadow read runs post-response via the scheduler.
 */

import {
  DiagnosticEntity,
  type DiagnosticStorageGateway,
  type ReadActor,
  type ReadResult,
} from './contracts.ts';
import { buildReadContext } from './context.ts';

export const OUTCOME_ROUTE = '/make-server-324f4fbe/submissions/:id/outcome';

export interface OutcomeRouteResult {
  /** The exact JSON body the route returns. */
  body: { success: true; outcome: unknown };
  /** Coarse shadow disposition, for telemetry/tests. Not serialised to clients. */
  shadowStatus: ReadResult<unknown>['shadowStatus'];
  /** Test-only shadow handle (never awaited by the route). */
  shadow?: ReadResult<unknown>['shadow'];
}

/**
 * Handle the authoritative Outcome read. The caller is responsible for auth
 * (verifying the team token) and for turning `body` into an HTTP response.
 */
export async function handleGetOutcome(
  deps: { gateway: DiagnosticStorageGateway },
  params: { submissionId: string; actor: ReadActor; organizationId?: string | null; requestId?: string },
): Promise<OutcomeRouteResult> {
  const ctx = buildReadContext({
    route: OUTCOME_ROUTE,
    entity: DiagnosticEntity.OUTCOME,
    actor: params.actor,
    organizationId: params.organizationId ?? null,
    requestId: params.requestId,
  });

  const result = await deps.gateway.getOutcome(params.submissionId, ctx);

  return {
    body: { success: true, outcome: result.data ?? null },
    shadowStatus: result.shadowStatus,
    shadow: result.shadow,
  };
}
