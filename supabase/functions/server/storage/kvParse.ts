/**
 * KV value parsing helpers — diagnostic domain (MCV2-S7.2-IMPLEMENT-007)
 *
 * Extracted VERBATIM from supabase/functions/server/index.tsx so the storage
 * KV adapter and the route handlers share ONE implementation instead of
 * duplicating it. Behaviour is byte-for-byte identical to the previous inline
 * definitions — this is a move, not a rewrite.
 *
 * Pure functions only: no Deno/Supabase imports, so both the Deno runtime and
 * the Node `--experimental-strip-types` test runner can import this file.
 */

// HELPER — safe JSON parse (handles JSONB that might be string or object)
export function safeJsonParse(value: any): any {
  // Handle null, undefined, empty string
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // If it's already an object (parsed by JSONB), return it
  if (typeof value === 'object') {
    try {
      if (Array.isArray(value)) return value;
      if (Object.keys(value).length === 0 && value.constructor === Object) {
        return value;
      }
      return value;
    } catch (err) {
      console.log('⚠️ Object validation error:', err);
      return null;
    }
  }

  // If it's a string, try to parse it
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return trimmed;
    }
    try {
      const parsed = JSON.parse(trimmed);
      return parsed;
    } catch (err) {
      console.log('⚠️ JSON parse error for value:', trimmed.substring(0, 100), 'Error:', err);
      return null;
    }
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  console.log('⚠️ Unknown value type in safeJsonParse:', typeof value);
  return null;
}

/**
 * Parse an array of raw kv values from getByPrefix('sub:') into submission objects.
 */
export function parseSubmissions(rawArray: any[]): any[] {
  if (!Array.isArray(rawArray)) return [];
  const results: any[] = [];
  for (const raw of rawArray) {
    try {
      const parsed = safeJsonParse(raw);
      if (parsed && typeof parsed === 'object' && parsed.id) {
        results.push(parsed);
      }
    } catch {
      // Skip unparseable entries silently
    }
  }
  return results;
}

/**
 * Sort comparator used by the submissions list route: newest `submittedAt`
 * first, tolerant of missing/invalid dates.
 */
export function sortSubmissionsBySubmittedAtDesc(a: any, b: any): number {
  try {
    const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
    const aValid = !isNaN(aTime) ? aTime : 0;
    const bValid = !isNaN(bTime) ? bTime : 0;
    return bValid - aValid;
  } catch (err) {
    console.log('Sort error for submissions:', err);
    return 0;
  }
}
