/**
 * Read-context factory — diagnostic domain (MCV2-S7.2-IMPLEMENT-007)
 *
 * Small helper to build a ReadContext inside route handlers. `organizationId`
 * and `actor` are server-resolved by the caller; `requestId` is generated here
 * if not supplied. Kept in its own module so both the barrel and the route
 * handler can import it without a cycle.
 */

import type { DiagnosticEntity, ReadActor, ReadContext } from './contracts.ts';

export function buildReadContext(params: {
  route: string;
  entity: DiagnosticEntity;
  actor: ReadActor;
  organizationId?: string | null;
  requestId?: string;
}): ReadContext {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?(): string } }).crypto;
  const requestId =
    params.requestId ??
    (cryptoObj && typeof cryptoObj.randomUUID === 'function'
      ? cryptoObj.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  return {
    requestId,
    organizationId: params.organizationId ?? null,
    actor: params.actor,
    route: params.route,
    entity: params.entity,
  };
}
