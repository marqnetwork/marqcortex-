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
import { NO_STORED_VERSION, settingsConflict } from '../admin/settingsStore.ts';
import type { AIOperationalSettings } from '../runtime/operationalSettings.ts';

export type KvAdminReader = (key: string) => Promise<unknown>;
export type KvAdminWriter = (key: string, value: unknown) => Promise<void>;

/** The single key holding the platform's AI operational settings. */
export const ADMIN_SETTINGS_KEY = 'ai:admin:settings';

const SETTINGS_SCHEMA = 'ai.admin.settings.v1';
const TRAIL_SCHEMA = 'ai.admin.audit.v1';

export interface KvAdminSettingsStoreOptions {
  readonly read: KvAdminReader;
  readonly write: KvAdminWriter;
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
      // Deliberately untyped at the boundary. `parseStoredSettings` normalises
      // every field, so a stored value that no longer matches the current shape
      // degrades field by field instead of being trusted wholesale.
      return raw as AIOperationalSettings | undefined;
    },

    async save(settings, expectedVersion) {
      // Read-then-write compare-and-swap.
      //
      // This is honest about what the injected key-value port can do: it offers
      // a read and a write, not an atomic conditional write, so the guarantee
      // here is "no write proceeds on a version it did not observe" rather than
      // a hardware-level CAS. It closes the window that matters — two
      // administrators seconds apart, which is the realistic case — and it
      // narrows, but does not eliminate, the window of two writes landing
      // inside the same read-modify-write. Closing that one needs a conditional
      // write primitive from the storage layer; it is recorded as a remaining
      // finding rather than papered over here.
      const current = coerce(await options.read(ADMIN_SETTINGS_KEY));
      const storedVersion =
        current === 'unparseable' || current === undefined
          ? NO_STORED_VERSION
          : ((current as { configurationVersion?: number }).configurationVersion ??
            NO_STORED_VERSION);
      if (storedVersion !== expectedVersion) {
        throw settingsConflict(expectedVersion, storedVersion);
      }
      await options.write(ADMIN_SETTINGS_KEY, { ...settings, _schema: SETTINGS_SCHEMA });
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
