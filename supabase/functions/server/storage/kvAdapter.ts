/**
 * KV diagnostic adapter — diagnostic domain (MCV2-S7.2-IMPLEMENT-007)
 *
 * The canonical, read-only KV access surface for the diagnostic reads migrated
 * in Phase 1. It reuses the existing KV helper (injected as `KvDiagnosticPort`)
 * and the shared parsing helpers so behaviour matches the previous inline route
 * logic EXACTLY:
 *
 *   - submission reads use `safeJsonParse` (as the routes did)
 *   - outcome reads use `JSON.parse` on truthy raw, else null (as the route did)
 *   - list read filters via `parseSubmissions` and sorts newest-first
 *   - "found" mirrors the routes' `if (!raw)` truthiness check
 *
 * No writes. No mutation. No SQL. No global state.
 */

import { StorageReadError, type KvDiagnosticAdapter, type KvDiagnosticPort } from './contracts.ts';
import { parseSubmissions, safeJsonParse, sortSubmissionsBySubmittedAtDesc } from './kvParse.ts';

const SUBMISSION_PREFIX = 'sub:';
const OUTCOME_PREFIX = 'outcome:';

export function createKvDiagnosticAdapter(kv: KvDiagnosticPort): KvDiagnosticAdapter {
  return {
    /**
     * GET /submissions/:id and GET /client/submission/:id equivalent read.
     * Mirrors: `const raw = await kv.get('sub:'+id); if(!raw) 404; safeJsonParse(raw)`.
     * `found = !!raw` reproduces the route's `if (!raw)` branch precisely, so the
     * caller can 404 on missing while still returning `null` for present-but-null.
     */
    async getSubmission(id: string): Promise<{ data: unknown; found: boolean }> {
      let raw: unknown;
      try {
        raw = await kv.get(`${SUBMISSION_PREFIX}${id}`);
      } catch (err) {
        throw new StorageReadError('KV read failed for submission', 'KV_READ_ERROR', err);
      }
      const found = !!raw;
      return { data: found ? safeJsonParse(raw) : null, found };
    },

    /**
     * GET /submissions equivalent read. Mirrors the route's prefix scan, the
     * non-array safety fallback (-> empty), `parseSubmissions`, and the
     * newest-first sort. KV errors surface as StorageReadError so the route can
     * reproduce its "Database error" 500 envelope.
     */
    async listSubmissions(): Promise<{ data: unknown[]; found: boolean }> {
      let rawArray: unknown;
      try {
        rawArray = await kv.getByPrefix(SUBMISSION_PREFIX);
      } catch (err) {
        throw new StorageReadError('KV read failed for submission list', 'KV_READ_ERROR', err);
      }
      if (!Array.isArray(rawArray)) {
        return { data: [], found: false };
      }
      const parsed = parseSubmissions(rawArray).sort(sortSubmissionsBySubmittedAtDesc);
      return { data: parsed, found: parsed.length > 0 };
    },

    /**
     * GET /submissions/:id/outcome equivalent read.
     * Mirrors: `const raw = await kv.get('outcome:'+id); raw ? JSON.parse(raw) : null`.
     * Deliberately uses JSON.parse (not safeJsonParse) to preserve the route's
     * exact behaviour, including throwing on malformed raw (caught by the route).
     */
    async getOutcome(submissionId: string): Promise<{ data: unknown; found: boolean }> {
      let raw: unknown;
      try {
        raw = await kv.get(`${OUTCOME_PREFIX}${submissionId}`);
      } catch (err) {
        throw new StorageReadError('KV read failed for outcome', 'KV_READ_ERROR', err);
      }
      const found = !!raw;
      // Match route semantics exactly: JSON.parse on truthy raw, else null.
      const data = raw ? JSON.parse(raw as string) : null;
      return { data, found };
    },
  };
}
