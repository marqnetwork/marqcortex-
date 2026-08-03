/**
 * Durable storage for the administration layer, backed by the platform
 * key-value store.
 *
 * Two stores with deliberately opposite failure policies, for the same reason
 * the spend ledger and the audit store differ:
 *
 *   Settings — FAIL LOUD, DEGRADE SAFE. A read failure or an unreadable blob
 *   does not stop the plane: it runs on the deployment baseline, which is the
 *   safe posture by construction (real requests only if the environment
 *   permitted them, budgets as configured). A WRITE failure propagates, because
 *   a settings change that was not persisted has not happened, and a console
 *   that reports success for a change that vanishes on the next isolate is
 *   worse than one that reports failure.
 *
 *   Administrative trail — NEVER THROWS. An audit backend outage must not fail
 *   the administrative action that produced the record; it must be loud. The
 *   in-memory trail always holds the record regardless, so the console still
 *   shows it while durable storage is unavailable.
 *
 * Settings live at ONE key. There is exactly one operational configuration for
 * the platform, and giving it a key per anything would invite a second one.
 */

import type { AdminAuditRecord, AdminAuditStore } from '../admin/adminAudit.ts';
import type { AdminSettingsStore } from '../admin/settingsStore.ts';
import type { AIControlPlaneConfig } from '../runtime/config.ts';
import { parseStoredSettings, settingsConflict } from '../admin/settingsStore.ts';
import type { AIOperationalSettings } from '../runtime/operationalSettings.ts';

export type KvAdminReader = (key: string) => Promise<unknown>;
export type KvAdminWriter = (key: string, value: unknown) => Promise<void>;
/**
 * Atomic compare-and-swap over the key-value store.
 *
 * Contract: write `value` at `key` if and only if the record currently stored
 * there carries `expectedVersion` as its `configurationVersion` — or, when
 * `expectedVersion` is `NO_STORED_VERSION`, if and only if no record exists.
 * Resolve true when the write happened and false when the precondition did not
 * hold. The comparison and the write MUST be a single storage operation; an
 * implementation that reads and then writes does not satisfy this contract.
 */
export type KvAdminConditionalWriter = (
  key: string,
  expectedVersion: number,
  value: unknown,
) => Promise<boolean>;

/** The single key holding the platform's AI operational settings. */
export const ADMIN_SETTINGS_KEY = 'ai:admin:settings';

const SETTINGS_SCHEMA = 'ai.admin.settings.v1';
const TRAIL_SCHEMA = 'ai.admin.audit.v1';

export interface KvAdminSettingsStoreOptions {
  readonly read: KvAdminReader;
  readonly write: KvAdminWriter;
  /**
   * Atomic conditional write. Returns true when the stored record was still at
   * `expectedVersion` and the write happened, false when it was not.
   *
   * REQUIRED, and required for a reason. The previous implementation compared a
   * version it had just read and then wrote in a second round trip, which is a
   * time-of-check-to-time-of-use window: two isolates could both observe
   * version N and both write N+1, losing one change and putting two different
   * configurations under one version number. A conditional write has no such
   * window because the comparison and the write are one statement.
   */
  readonly compareAndSwap: KvAdminConditionalWriter;
  /** Deployment configuration, for normalising whatever storage returns. */
  readonly config: AIControlPlaneConfig;
  readonly now: () => string;
  readonly onCorrupt?: (detail: string) => void;
}

/**
 * Values may come back as an object or as a JSON string depending on how the
 * key-value layer stored them. Both are handled here rather than in the parser,
 * so `parseStoredSettings` sees one shape.
 */
function coerce(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return 'unparseable';
  }
}

export function createKvAdminSettingsStore(
  options: KvAdminSettingsStoreOptions,
): AdminSettingsStore {
  return {
    /**
     * THE canonical read path. Everything that loads durable settings goes
     * through here — bootstrap hydration and the control plane's live refresh
     * alike — so both apply the same parsing, the same bounds and the same
     * deployment envelope.
     *
     * Normalising here rather than at each caller is the fix for a real defect:
     * hydration ran the record through `parseStoredSettings` and the refresh
     * path adopted it raw, so an out-of-bounds retry curve or a malformed
     * provider id could reach the live overlay through the second path and not
     * the first. Two readers of one record with two contracts is one contract
     * too many.
     */
    async load(): Promise<AIOperationalSettings | undefined> {
      const raw = coerce(await options.read(ADMIN_SETTINGS_KEY));
      if (raw === 'unparseable') {
        // Reported here and treated as "nothing stored", so the plane starts on
        // the deployment baseline. Throwing would turn a corrupt settings blob
        // into a startup failure, which is a strictly worse outcome than
        // running on the configuration the environment already describes.
        options.onCorrupt?.('stored AI operational settings are not valid JSON');
        return undefined;
      }
      if (raw === undefined || raw === null) return undefined;

      const { settings, recovered } = parseStoredSettings(raw, options.config, options.now());
      if (recovered) {
        options.onCorrupt?.('stored AI operational settings could not be parsed');
        return undefined;
      }
      return settings;
    },

    /**
     * ONE atomic conditional write. No read, and therefore no window.
     *
     * `compareAndSwap` resolves false when the stored version was not
     * `expectedVersion`; that is a lost race, not a storage failure, and it
     * surfaces as the same typed CONFLICT a caller gets from any other store.
     * The administration layer re-reads and re-applies on that code, so a lost
     * race becomes a merge rather than a lost change.
     */
    async save(settings, expectedVersion) {
      const won = await options.compareAndSwap(
        ADMIN_SETTINGS_KEY,
        expectedVersion,
        { ...settings, _schema: SETTINGS_SCHEMA },
      );
      if (!won) throw settingsConflict(expectedVersion, expectedVersion);
    },
  };
}

export interface KvAdminAuditStoreOptions {
  readonly write: KvAdminWriter;
  /** Stamped on each record so a retention sweep can act without re-deriving. */
  readonly retentionDays: number;
  readonly onError?: (error: unknown) => void;
}

/**
 * `ai:admin:audit:{yyyy-mm-dd}:{adminAuditId}` — date-partitioned, so retention
 * is a prefix operation and a day's changes are enumerable without scanning.
 *
 * Not tenant-scoped, unlike the execution audit: administrative changes are
 * platform-wide by nature, and filing them under one organization would imply
 * a scope they do not have.
 */
export function adminAuditKeyFor(record: AdminAuditRecord): string {
  const day = record.recordedAt.slice(0, 10);
  return `ai:admin:audit:${day}:${record.adminAuditId}`;
}

export function createKvAdminAuditStore(options: KvAdminAuditStoreOptions): AdminAuditStore {
  return {
    async append(record: AdminAuditRecord): Promise<void> {
      try {
        await options.write(adminAuditKeyFor(record), {
          ...record,
          _retentionDays: options.retentionDays,
          _schema: TRAIL_SCHEMA,
        });
      } catch (error) {
        options.onError?.(error);
      }
    },

    // A write-through store holds nothing to read back; the composite store
    // reads from the in-memory trail.
    recent: () => [],
    size: () => 0,
  };
}
