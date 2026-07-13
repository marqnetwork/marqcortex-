/**
 * Migration engine shared types — MCV2-S6.2-IMPLEMENT-004
 */
export type MigrationMode = 'inventory' | 'simulation' | 'backfill' | 'reconcile' | 'rollback';

export type MigrationRunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type CheckpointStatus = 'running' | 'paused' | 'completed' | 'failed';

export type QuarantineRetryStatus = 'pending' | 'retrying' | 'resolved' | 'abandoned';

export type LeadKvSource = 'lead_magnet' | 'exit_intent' | string;

export interface KvRecord {
  key: string;
  rawValue: unknown;
}

export interface ParsedKvRecord<T = unknown> {
  key: string;
  parsed: T | null;
  parseError: string | null;
  doubleEncoded: boolean;
}

export interface MigrationRunRecord {
  id: string;
  organization_id: string;
  migration_name: string;
  mode: MigrationMode;
  status: MigrationRunStatus;
  started_at: string;
  completed_at: string | null;
  requested_by: string | null;
  source_namespace: string | null;
  batch_size: number;
  last_cursor: string | null;
  total_discovered: number;
  total_processed: number;
  total_inserted: number;
  total_updated: number;
  total_skipped: number;
  total_quarantined: number;
  total_failed: number;
  checksum: string | null;
  metadata: Record<string, unknown>;
  error_summary: unknown[];
}

export interface MigrationCheckpointRecord {
  id: string;
  run_id: string;
  namespace: string;
  last_key: string | null;
  batch_number: number;
  processed_count: number;
  checksum: string | null;
  status: CheckpointStatus;
  updated_at: string;
}

export interface QuarantineInput {
  run_id: string;
  organization_id: string;
  source_namespace: string;
  source_key: string;
  source_payload: unknown;
  reason_code: string;
  reason_detail?: string;
  target_table?: string;
}

export interface LeadKvPayload {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  website?: string;
  source?: LeadKvSource;
  capturedAt?: string;
}

export type RecordClassification =
  | 'migrated'
  | 'duplicate'
  | 'index_only'
  | 'quarantined'
  | 'skipped';

export interface NormalizedLeadContact {
  legacyKvKey: string;
  legacyId: string;
  organizationId: string;
  email: string;
  fullName: string | null;
  companyName: string | null;
  phone: string | null;
  website: string | null;
  status: 'captured' | 'exit_intent' | 'new';
  leadSourceKey: string;
  capturedAt: string;
  metadata: Record<string, unknown>;
  contactLegacyKvKey: string;
  inferredFields: string[];
}

export type NormalizationResult =
  | {
      ok: true;
      record: NormalizedLeadContact;
      classification: RecordClassification;
    }
  | {
      ok: false;
      reasonCode: string;
      reasonDetail: string;
      classification: 'quarantined';
    };

export interface InventoryReport {
  generatedAt: string;
  namespaces: Record<string, NamespaceInventory>;
  duplicateEmails: string[];
  orphanedLeadEmailMappings: string[];
  indexOnlyRecords: string[];
  summary: {
    totalRecords: number;
    malformedCount: number;
    doubleEncodedCount: number;
    missingRequiredCount: number;
  };
}

export interface NamespaceInventory {
  prefix: string;
  totalCount: number;
  malformedCount: number;
  doubleEncodedCount: number;
  missingRequiredCount: number;
  sampleKeys: string[];
}

export interface SimulationReport {
  generatedAt: string;
  runId: string | null;
  discoveredRecords: number;
  validRecords: number;
  normalizationRequired: number;
  duplicates: number;
  quarantined: number;
  predictedLeads: number;
  predictedContacts: number;
  predictedContactMethods: number;
  unresolvedMappings: string[];
  checksumSource: string;
  checksumTarget: string;
  thresholdsPassed: boolean;
  details: Record<string, unknown>;
}

export interface ReconciliationResult {
  domain: string;
  sourceCount: number;
  targetCount: number;
  missingCount: number;
  duplicateCount: number;
  orphanCount: number;
  mismatchCount: number;
  sampleSize: number;
  sampleMismatchCount: number;
  checksumSource: string;
  checksumTarget: string;
  thresholdPassed: boolean;
  classifications: Record<RecordClassification, number>;
  unclassifiedCount: number;
  details: Record<string, unknown>;
}

export interface MigrationEngineOptions {
  organizationId: string;
  batchSize?: number;
  writeControlRecords?: boolean;
  requestedBy?: string;
  reportsDir?: string;
}

export interface CliFlags {
  mode: MigrationMode;
  domain?: string;
  dryRun?: boolean;
  resume?: boolean;
  runId?: string;
  confirm?: boolean;
  writeControlRecords?: boolean;
  batchSize?: number;
  reportsDir?: string;
  keyPrefixFilter?: string;
  maxBatches?: number;
}

export interface KvReader {
  scanPrefix(
    prefix: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ records: KvRecord[]; nextCursor: string | null; hasMore: boolean }>;
  countPrefix(prefix: string): Promise<number>;
  getKey(key: string): Promise<unknown | null>;
}

export class MigrationEngineError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'MigrationEngineError';
    this.code = code;
  }
}
