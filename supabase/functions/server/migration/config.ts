/**
 * Migration engine configuration — MCV2-S6.2-IMPLEMENT-004
 */
import type { MigrationMode } from './types.ts';

export const DEFAULT_BATCH_SIZE = 50;

export const LEAD_NAMESPACES = ['lead:', 'lead_email:'] as const;

export const LEAD_ENTITY_PREFIX = 'lead:';

export const LEAD_EMAIL_INDEX_PREFIX = 'lead_email:';

export const MIGRATION_NAME_LEADS = 'leads_contacts_v1';

export const KV_TABLE = 'kv_store_324f4fbe';

export const MIGRATION_METADATA_KEY = 'migration_run_id';

export const MAX_RETRY_BATCHES = 3;

export const RECONCILIATION_SAMPLE_SIZE = 100;

/** Disposable live-validation fixture prefix (MCV2-S6.3) */
export const S6VALIDATE_KV_PREFIX = 'lead:s6validate:';

export const S6VALIDATE_EMAIL_INDEX_PREFIX = 'lead_email:s6validate:';

export function isS6ValidateKey(key: string): boolean {
  return key.startsWith(S6VALIDATE_KV_PREFIX) || key.startsWith(S6VALIDATE_EMAIL_INDEX_PREFIX);
}

export function matchesKeyFilter(key: string, keyPrefixFilter?: string): boolean {
  if (!keyPrefixFilter) return true;
  if (keyPrefixFilter === 's6validate') return isS6ValidateKey(key);
  return key.startsWith(keyPrefixFilter);
}

export function resolveBatchSize(value?: number): number {
  const size = value ?? DEFAULT_BATCH_SIZE;
  if (size < 1 || size > 500) {
    throw new Error(`batchSize must be between 1 and 500, got ${size}`);
  }
  return size;
}

export function isWriteMode(mode: MigrationMode, dryRun?: boolean): boolean {
  if (dryRun) return false;
  return mode === 'backfill' || mode === 'rollback';
}

export function shouldWriteControlRecords(
  mode: MigrationMode,
  writeControlRecords?: boolean,
): boolean {
  if (writeControlRecords === false) return false;
  return mode !== 'inventory' || writeControlRecords === true;
}
