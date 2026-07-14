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
    // Verify it's a valid object (not null, not broken)
    try {
      // Make sure it's not an array of primitives or malformed object
      if (Array.isArray(value)) return value;
      // Ensure the object is serializable and not corrupted
      if (Object.keys(value).length === 0 && value.constructor === Object) {
        // Empty object is valid
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

    // Empty string after trim
    if (!trimmed) return null;

    // Check if it looks like JSON
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      // Not a JSON object/array, might be a plain string value or ISO date
      // Just return the trimmed string
      return trimmed;
    }

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(trimmed);
      return parsed;
    } catch (err) {
      console.log('⚠️ JSON parse error for value:', trimmed.substring(0, 100), 'Error:', err);
      return null;
    }
  }

  // For primitives (numbers, booleans), return as-is
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  // Unknown type
  console.log('⚠️ Unknown value type in safeJsonParse:', typeof value);
  return null;
}

/**
 * Parse an array of raw kv values from getByPrefix('sub:') into submission objects.
 * Filters out non-submission entries (e.g. simple string email-to-id mappings
 * from sub_email: keys that might get matched) and malformed JSON, returning
 * only valid submission objects that have an `id` property.
 */
export function parseSubmissions(rawArray: any[]): any[] {
  if (!Array.isArray(rawArray)) return [];
  const results: any[] = [];
  for (const raw of rawArray) {
    try {
      const parsed = safeJsonParse(raw);
      // A valid submission must be an object with an id field
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
 * first, tolerant of missing/invalid dates. Extracted verbatim from the inline
 * sort in `GET /submissions`.
 */
export function sortSubmissionsBySubmittedAtDesc(a: any, b: any): number {
  try {
    const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
    // Handle invalid dates (NaN)
    const aValid = !isNaN(aTime) ? aTime : 0;
    const bValid = !isNaN(bTime) ? bTime : 0;
    return bValid - aValid;
  } catch (err) {
    console.log('Sort error for submissions:', err);
    return 0;
  }
}
