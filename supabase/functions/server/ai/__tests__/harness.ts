/**
 * Test harness for the AI Control Plane.
 *
 * Builds a real control plane — the same `createControlPlane` production uses —
 * with every non-deterministic dependency replaced: a hand-driven clock,
 * sequential ids, an in-memory log sink, an immediate sleep and a stub
 * authenticator. Nothing is mocked out of the path under test: the guard, the
 * policy engine, the pipeline, the governance layer, the audit writer and the
 * metrics recorder are all the production implementations.
 *
 * That is the point of the dependency-injection design. These tests exercise
 * production code end to end with no network, no globals and no shared state
 * between cases.
 */

import type { AIControlPlane } from '../controlPlane.ts';
import type { AIAuthenticator, AuthenticatedSubject, SubjectMembership } from '../security/actor.ts';
import type { AIControlPlaneConfig } from '../runtime/config.ts';
import type { MutableClock } from '../runtime/clock.ts';
import type { LogSink } from '../observability/logger.ts';
import type { MockProviderHandle } from '../providers/mockProvider.ts';
import { createControlPlane } from '../controlPlane.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';
import { createTestClock } from '../runtime/clock.ts';
import { createSequentialIdFactory } from '../contracts/ids.ts';
import { createMemorySink } from '../observability/logger.ts';
import { createMockProvider } from '../providers/mockProvider.ts';

export interface StubSubjectOptions {
  readonly subjectId?: string;
  readonly email?: string;
  readonly roles?: readonly string[];
  readonly memberships?: readonly SubjectMembership[];
  readonly actorType?: AuthenticatedSubject['actorType'];
}

/** Authenticator that accepts one token and rejects everything else. */
export function stubAuthenticator(
  token: string,
  options: StubSubjectOptions = {},
): AIAuthenticator {
  const subject: AuthenticatedSubject = {
    subjectId: options.subjectId ?? 'user-1',
    email: options.email ?? 'consultant@marq.test',
    actorType: options.actorType ?? 'team_user',
    globalRoles: options.roles ?? ['consultant'],
    memberships: options.memberships ?? [
      { organizationId: 'acme', slug: 'acme', tier: 'enterprise', roles: ['consultant'] },
    ],
  };
  return {
    authenticate: (authorization) =>
      Promise.resolve(authorization === `Bearer ${token}` ? subject : null),
  };
}

export interface TestPlane {
  readonly plane: AIControlPlane;
  readonly clock: MutableClock;
  readonly provider: MockProviderHandle;
  /** Secondary provider, registered after the primary. Used for failover. */
  readonly backup: MockProviderHandle;
  readonly logs: { level: string; line: string }[];
  readonly config: AIControlPlaneConfig;
  /** Transport for an authenticated team caller. */
  authorized(): { authorization: string; clientIp: string };
}

export const TEST_TOKEN = 'valid-team-token';

export interface TestPlaneOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly authenticator?: AIAuthenticator;
  /** Provider registration order. Defaults to primary then backup. */
  readonly providersEnabled?: boolean;
}

export function buildTestPlane(options: TestPlaneOptions = {}): TestPlane {
  const clock = createTestClock();
  const sink: LogSink & { lines: { level: string; line: string }[] } = createMemorySink();

  const config = loadControlPlaneConfig(
    recordEnv({
      AI_PROVIDER_PREFERENCE: 'primary,backup',
      AI_LOG_LEVEL: 'debug',
      AI_RETRY_BASE_DELAY_MS: '0',
      AI_RETRY_JITTER_PERCENT: '0',
      AI_DEFAULT_ORGANIZATION_ID: 'acme',
      ...options.env,
    }),
  );

  const provider = createMockProvider({ providerId: 'primary', priority: 1 });
  const backup = createMockProvider({ providerId: 'backup', priority: 2 });

  const plane = createControlPlane({
    config,
    authenticator: options.authenticator ?? stubAuthenticator(TEST_TOKEN),
    providers: [
      { adapter: provider, certification: 'certified' },
      { adapter: backup, certification: 'certified' },
    ],
    clock,
    ids: createSequentialIdFactory(),
    logSink: sink,
    // Backoff is asserted directly in the retry unit tests; here it only needs
    // to not spend real time.
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });

  return {
    plane,
    clock,
    provider,
    backup,
    logs: sink.lines,
    config,
    authorized: () => ({ authorization: `Bearer ${TEST_TOKEN}`, clientIp: '203.0.113.10' }),
  };
}

/** A minimal valid narrative request body. */
export function narrativeInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'why_now',
    context: {
      company: 'Acme Industrial',
      industry: 'Manufacturing',
      employee_estimate: 240,
      current_version: 'v3',
      assumptions: { support_tickets_per_week: 180, monthly_revenue: 950_000 },
      top_recommendation: {
        problem_title: 'Manual intake handoffs',
        severity_score: 8,
        confidence_score: 72,
        priority_score: {
          impact_score: 9,
          feasibility_score: 7,
          risk_score: 3,
          computed_priority: 8.1,
        },
        why_first: 'Constraint resolution precedes optimisation.',
      },
      recommendation_count: 5,
    },
    ...overrides,
  };
}

/** A minimal valid section copilot request body with fact-locked fields. */
export function sectionCopilotInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    section: 'next_step_offer',
    section_label: 'Next Step Offer',
    action: 'improve',
    current_content: {
      offer_name: 'Diagnostic Audit',
      price: 12_000,
      currency: 'USD',
      duration: 'Days 1-10',
      primary_cta: 'Get Started',
    },
    context: { company: 'Acme Industrial', industry: 'Manufacturing' },
    ...overrides,
  };
}
