/**
 * Read-only KV prefix scanner — MCV2-S6.2-IMPLEMENT-004
 * Never writes to kv_store_324f4fbe.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { KV_TABLE, matchesKeyFilter } from './config.ts';
import type { KvReader, KvRecord } from './types.ts';
import { throwOnError } from './client.ts';

export interface KvReaderOptions {
  keyPrefixFilter?: string;
}

export function createKvReader(client: SupabaseClient, options: KvReaderOptions = {}): KvReader {
  const { keyPrefixFilter } = options;

  function filterRecords(records: KvRecord[]): KvRecord[] {
    if (!keyPrefixFilter) return records;
    return records.filter((r) => matchesKeyFilter(r.key, keyPrefixFilter));
  }

  return {
    async scanPrefix(prefix, cursor, limit) {
      let query = client
        .from(KV_TABLE)
        .select('key, value')
        .like('key', `${prefix}%`)
        .order('key', { ascending: true })
        .limit(keyPrefixFilter ? limit * 4 : limit);

      if (cursor) {
        query = query.gt('key', cursor);
      }

      const { data, error } = await query;
      throwOnError(error, 'kvReader.scanPrefix');

      let records: KvRecord[] = (data ?? []).map((row) => ({
        key: row.key as string,
        rawValue: row.value,
      }));
      records = filterRecords(records).slice(0, limit);

      const nextCursor = records.length > 0 ? records[records.length - 1].key : cursor;
      return {
        records,
        nextCursor: records.length === limit ? nextCursor : null,
        hasMore: records.length === limit,
      };
    },

    async countPrefix(prefix) {
      const { count, error } = await client
        .from(KV_TABLE)
        .select('key', { count: 'exact', head: true })
        .like('key', `${prefix}%`);
      throwOnError(error, 'kvReader.countPrefix');
      return count ?? 0;
    },

    async getKey(key) {
      const { data, error } = await client
        .from(KV_TABLE)
        .select('value')
        .eq('key', key)
        .maybeSingle();
      throwOnError(error, 'kvReader.getKey');
      return data?.value ?? null;
    },
  };
}

/** In-memory KV reader for unit tests */
export function createInMemoryKvReader(store: Record<string, unknown>): KvReader {
  const keys = Object.keys(store).sort();
  return {
    async scanPrefix(prefix, cursor, limit) {
      const filtered = keys.filter((k) => k.startsWith(prefix));
      const startIdx = cursor ? filtered.findIndex((k) => k > cursor) : 0;
      const slice = filtered.slice(startIdx >= 0 ? startIdx : filtered.length, (startIdx >= 0 ? startIdx : 0) + limit);
      const records = slice.map((key) => ({ key, rawValue: store[key] }));
      const nextCursor = records.length > 0 ? records[records.length - 1].key : cursor;
      return {
        records,
        nextCursor: records.length === limit ? nextCursor : null,
        hasMore: records.length === limit,
      };
    },
    async countPrefix(prefix) {
      return keys.filter((k) => k.startsWith(prefix)).length;
    },
    async getKey(key) {
      return store[key] ?? null;
    },
  };
}
