/**
 * The health signal sources this deployment actually has — §IV-51.
 *
 * Every source here reads something that ALREADY EXISTS. §IV-51 excludes
 * monitoring instrumentation from this phase, so nothing below adds a probe, a
 * timer or a collector: the framework rolls up signals the platform already
 * publishes, and where it publishes none, the dimension says `unknown`.
 *
 * Each factory takes what it reads as a parameter rather than importing it, so
 * this file can be exercised without a control plane, a key-value store or a
 * database — and so a subsystem never has to depend on health to be observed.
 */

import type { HealthSignal, HealthSignalSource } from './contracts.ts';

/** The AI control plane's own opinion, mapped onto the framework's states. */
export function aiControlPlaneSource(
  read: () => { status: 'healthy' | 'degraded' | 'unhealthy'; issues: readonly string[] } | null,
): HealthSignalSource {
  return {
    dimension: 'ai',
    name: 'ai.control_plane',
    collect(): HealthSignal {
      const health = read();
      if (!health) {
        return {
          name: 'ai.control_plane',
          state: 'unknown',
          detail: 'the AI control plane has not been initialised in this isolate',
        };
      }
      return {
        name: 'ai.control_plane',
        state: health.status,
        detail:
          health.issues.length === 0
            ? 'no configuration issues reported'
            : `${health.issues.length} configuration issue(s): ${health.issues[0]}`,
      };
    },
  };
}

/**
 * Whether AI execution is permitted at all.
 *
 * A stopped platform is DEGRADED, never unhealthy: an administrator engaging
 * the emergency stop is the control working, and a health page that turned red
 * for it would teach operators that red means nothing.
 */
export function aiGovernanceSource(
  read: () => { aiEnabled: boolean; emergencyStopEngaged: boolean; configurationVersion: number } | null,
): HealthSignalSource {
  return {
    dimension: 'ai',
    name: 'ai.governance',
    collect(): HealthSignal {
      const state = read();
      if (!state) {
        return {
          name: 'ai.governance',
          state: 'unknown',
          detail: 'the administrative overlay could not be read',
        };
      }
      if (state.emergencyStopEngaged) {
        return {
          name: 'ai.governance',
          state: 'degraded',
          detail: `AI is stopped by the emergency switch (configuration ${state.configurationVersion})`,
        };
      }
      if (!state.aiEnabled) {
        return {
          name: 'ai.governance',
          state: 'degraded',
          detail: `AI is switched off by an administrator (configuration ${state.configurationVersion})`,
        };
      }
      return {
        name: 'ai.governance',
        state: 'healthy',
        detail: `AI is enabled under configuration ${state.configurationVersion}`,
      };
    },
  };
}

/** Whether the authoritative store answers a round trip. */
export function storageSource(probe: () => Promise<boolean>): HealthSignalSource {
  return {
    dimension: 'platform',
    name: 'platform.storage',
    async collect(): Promise<HealthSignal> {
      const ok = await probe();
      return {
        name: 'platform.storage',
        state: ok ? 'healthy' : 'unhealthy',
        // Named as the authority it currently is. When SQL becomes
        // authoritative this signal changes with it, and until then a health
        // page that implied otherwise would be describing a platform that does
        // not exist yet.
        detail: ok
          ? 'the authoritative key-value store completed a write-read-delete'
          : 'the authoritative key-value store did not return what was written',
      };
    },
  };
}

/**
 * The KV→SQL migration's own instrument.
 *
 * DEGRADED when the shadow read is reporting divergence, `unknown` when it is
 * switched off — which is the common case and is honest. It is a PLATFORM
 * signal rather than a product one: it says whether the platform's stores agree
 * about the data, not whether customers are getting value.
 */
export function shadowReadSource(
  read: () => {
    enabled: boolean;
    domains: readonly { domain: string; diverged: number; mismatchRatePercent: number | null }[];
  },
): HealthSignalSource {
  return {
    dimension: 'platform',
    name: 'platform.store_agreement',
    collect(): HealthSignal {
      const report = read();
      if (!report.enabled) {
        return {
          name: 'platform.store_agreement',
          state: 'unknown',
          detail: 'the shadow read is switched off, so the stores are not being compared',
        };
      }
      const diverged = report.domains.filter((domain) => domain.diverged > 0);
      if (diverged.length === 0) {
        return {
          name: 'platform.store_agreement',
          state: 'healthy',
          detail: 'every compared record agreed across both stores',
        };
      }
      return {
        name: 'platform.store_agreement',
        state: 'degraded',
        detail:
          `${diverged.length} domain(s) reporting divergence: ` +
          diverged
            .map((domain) => `${domain.domain} at ${domain.mismatchRatePercent ?? 0}%`)
            .join(', '),
      };
    },
  };
}

/**
 * Product health, from the progression signals §IV-51 names.
 *
 * `unknown` when nothing has happened yet rather than `healthy`: a platform
 * with no submissions is not delivering effortless value, it is idle, and a
 * green light for an empty estate is the same lie as a green light for an
 * unwired probe.
 *
 * There is deliberately NO THRESHOLD here. §IV-48 puts numeric targets out of
 * scope for this phase, so this reports what the counts ARE and refuses to
 * grade them.
 */
export function productProgressionSource(
  read: () => Promise<{ submissions: number; analysed: number; outcomes: number }>,
): HealthSignalSource {
  return {
    dimension: 'product',
    name: 'product.progression',
    async collect(): Promise<HealthSignal> {
      const counts = await read();
      if (counts.submissions === 0) {
        return {
          name: 'product.progression',
          state: 'unknown',
          detail: 'no submissions have been recorded, so there is no progression to report',
        };
      }
      return {
        name: 'product.progression',
        state: 'healthy',
        detail:
          `${counts.submissions} submission(s), ${counts.analysed} analysed, ` +
          `${counts.outcomes} with a recorded outcome. No target is applied — ` +
          'numeric targets are out of scope for this phase (blueprint IV-48)',
      };
    },
  };
}

/**
 * Organizational health, honestly.
 *
 * §IV-51 defines it as operating coherently under the governance frame — clear
 * authority, alignment to the Constitution, no drift — and most of that is a
 * human judgement made in review rather than a probe. What IS readable at
 * runtime is whether the governed configuration can be read at all and which
 * version is in force.
 *
 * So this source reports `unknown` even when it succeeds, with a detail that
 * says why. It is not a failure and it is not a pass: it is the framework
 * declining to claim a green light for a dimension nothing measures.
 */
export function governanceFrameSource(
  read: () => { configurationVersion: number; updatedBy: string } | null,
): HealthSignalSource {
  return {
    dimension: 'organizational',
    name: 'organizational.governance_frame',
    collect(): HealthSignal {
      const state = read();
      if (!state) {
        return {
          name: 'organizational.governance_frame',
          state: 'unknown',
          detail: 'the governed configuration could not be read',
        };
      }
      return {
        name: 'organizational.governance_frame',
        state: 'unknown',
        detail:
          `configuration ${state.configurationVersion}, last changed by ${state.updatedBy}. ` +
          'Organizational health is a governance judgement made in review, not a probe — ' +
          'this dimension is deliberately not claimed as healthy by a machine',
      };
    },
  };
}
