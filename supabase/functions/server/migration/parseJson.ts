/**
 * Safe JSON parsing with double-encoding support — MCV2-S6.2-IMPLEMENT-004
 */
import type { ParsedKvRecord } from './types.ts';

export function safeJsonParse(value: unknown): {
  parsed: unknown;
  doubleEncoded: boolean;
  error: string | null;
} {
  if (value === null || value === undefined) {
    return { parsed: null, doubleEncoded: false, error: 'null_or_undefined' };
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return { parsed: value, doubleEncoded: false, error: null };
  }

  if (typeof value === 'string') {
    try {
      const once = JSON.parse(value);
      if (typeof once === 'string') {
        try {
          return { parsed: JSON.parse(once), doubleEncoded: true, error: null };
        } catch {
          return { parsed: once, doubleEncoded: true, error: null };
        }
      }
      return { parsed: once, doubleEncoded: true, error: null };
    } catch (err) {
      return {
        parsed: null,
        doubleEncoded: false,
        error: err instanceof Error ? err.message : 'json_parse_failed',
      };
    }
  }

  return { parsed: value, doubleEncoded: false, error: null };
}

export function parseKvRecord<T = unknown>(key: string, rawValue: unknown): ParsedKvRecord<T> {
  const { parsed, doubleEncoded, error } = safeJsonParse(rawValue);
  return {
    key,
    parsed: error ? null : (parsed as T),
    parseError: error,
    doubleEncoded,
  };
}

export function emptyStringToNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function normalizeEmail(email: string | undefined | null): string | null {
  const cleaned = emptyStringToNull(email ?? null);
  return cleaned ? cleaned.toLowerCase() : null;
}

export function stableSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortKeys);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stableSortKeys(obj[key]);
        return acc;
      }, {});
  }
  return value;
}
