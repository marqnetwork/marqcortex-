/**
 * Edge bootstrap for the AI Control Plane.
 *
 * The one place that reads the runtime environment and assembles the production
 * dependency graph. Everything under `ai/` above this file is pure, injectable
 * and runnable under a plain Node test runner; the platform-specific pieces
 * (auth verification, durable storage) arrive here as injected functions, so
 * this module takes no Supabase or Deno import of its own.
 *
 * The plane is created once per isolate and memoised. Creating it per request
 * would reset the circuit breakers, rate limit windows and budget ledgers on
 * every call, which would quietly disable three of the platform's protections.
 */

import type { AIControlPlane, ControlPlaneOptions } from './controlPlane.ts';
import type { MembershipLookup, UserLookup } from './adapters/supabaseAuthenticator.ts';
import type { KvWriter } from './adapters/kvAuditStore.ts';
import type { KvSpendReader } from './adapters/kvSpendStore.ts';
import type { AuditStore } from './observability/audit.ts';
import type { SpendStore } from './policy/spendLedger.ts';
import type { EnvSource } from './runtime/env.ts';
import { createControlPlane } from './controlPlane.ts';
import { loadControlPlaneConfig } from './runtime/config.ts';
import { readBool, runtimeEnv } from './runtime/env.ts';
import { systemClock } from './runtime/clock.ts';
import { createSupabaseAuthenticator, denyAllAuthenticator } from './adapters/supabaseAuthenticator.ts';
import { createKvAuditStore } from './adapters/kvAuditStore.ts';
import { createKvSpendStore } from './adapters/kvSpendStore.ts';
import { createOpenAIProvider } from './providers/openaiProvider.ts';
import { createAnthropicProvider } from './providers/anthropicProvider.ts';
import { createMockProvider } from './providers/mockProvider.ts';

export interface BootstrapDependencies {
  /** Verify a bearer token and return the auth subject. */
  readonly getUser?: UserLookup;
  /** Resolve the organizations a subject belongs to. */
  readonly listMemberships?: MembershipLookup;
  /** Durable key-value write, used for the audit store and the spend ledger. */
  readonly kvWrite?: KvWriter;
  /** Durable key-value read. Required for the spend ledger to be durable. */
  readonly kvRead?: KvSpendReader;
  /** Override the environment source. Production reads the runtime. */
  readonly env?: EnvSource;
}

let plane: AIControlPlane | undefined;

/**
 * Build the production control plane. Idempotent per isolate: repeated calls
 * return the same instance so circuit, rate limit and budget state survive
 * across requests.
 */
export function initializeControlPlane(deps: BootstrapDependencies = {}): AIControlPlane {
  if (plane) return plane;

  const env = deps.env ?? runtimeEnv();
  const config = loadControlPlaneConfig(env);

  const authenticator = deps.getUser
    ? createSupabaseAuthenticator({
        getUser: deps.getUser,
        listMemberships: deps.listMemberships,
        clock: systemClock,
        onError: (stage, error) =>
          console.error(
            `[ai] authenticator ${stage} lookup failed:`,
            error instanceof Error ? error.message : String(error),
          ),
      })
    : // Fail closed. Without a way to verify credentials the plane rejects
      // every request rather than admitting unauthenticated traffic.
      denyAllAuthenticator;

  const auditStores: AuditStore[] = [];
  if (config.audit.durable && deps.kvWrite) {
    auditStores.push(
      createKvAuditStore({
        write: deps.kvWrite,
        retentionDays: config.audit.retentionDays,
        onError: (error) =>
          console.error(
            '[ai] durable audit write failed:',
            error instanceof Error ? error.message : String(error),
          ),
      }),
    );
  }

  const providers: ControlPlaneOptions['providers'][number][] = [
    { adapter: createOpenAIProvider({ env }), certification: 'certified' },
    { adapter: createAnthropicProvider({ env }), certification: 'certified' },
  ];

  // The mock provider is registered BY DEFAULT.
  //
  // Registering it is not the same as using it: it is declared non-production
  // and non-billable, so the health endpoint reports a deployment serving on it
  // as `degraded` rather than `healthy`, and it is never preferred over a real
  // provider once `AI_ALLOW_REAL_REQUESTS=true`. What its presence guarantees is
  // that a deployment which has NOT authorised real spending still has
  // something to serve — the alternative is a platform that either fails every
  // AI request or quietly starts spending because a key happened to be set.
  if (readBool(env, 'AI_ENABLE_MOCK_PROVIDER', true)) {
    providers.push({ adapter: createMockProvider(), certification: 'testing' });
  }

  // Durable spend ledger. Without it the MARQ ceiling is isolate-local and a
  // recycled isolate rediscovers a $0 balance, which is precisely the failure
  // the ceiling exists to prevent — so its absence is reported loudly.
  let spendStore: SpendStore | undefined;
  if (config.spend.durable && deps.kvRead && deps.kvWrite) {
    spendStore = createKvSpendStore({
      read: deps.kvRead,
      write: deps.kvWrite,
      onCorrupt: (scope, detail) =>
        console.error(`[ai] spend ledger ${scope} is unreadable: ${detail}`),
    });
  } else if (config.spend.durable) {
    console.error(
      '[ai] AI_SPEND_DURABLE is on but no key-value port was injected — ' +
        'the MARQ spend ceiling is isolate-local and will not survive a restart.',
    );
  }

  plane = createControlPlane({ config, authenticator, providers, auditStores, spendStore });
  return plane;
}

/** The initialised plane, or `undefined` before bootstrap. */
export function getControlPlane(): AIControlPlane | undefined {
  return plane;
}

/** Drop the memoised plane. Test and local-tooling use only. */
export function resetControlPlaneForTests(): void {
  plane = undefined;
}
