/**
 * Request body validation primitives.
 *
 * A dependency-free structural validator. Every AI feature declares its input
 * shape here, and the AI Guard runs that declaration before a single byte of
 * caller data reaches a prompt. Nothing is passed through unvalidated: unknown
 * keys are dropped rather than forwarded, so a caller cannot smuggle extra
 * fields into a prompt template or an audit record.
 *
 * Why not a schema library: the edge bundle takes no third-party runtime
 * dependency for something this small, and a hand-written validator gives exact
 * control over the caller-safe error surface (paths, no values echoed back).
 */

export interface ValidationIssue {
  /** Dotted path to the offending field, e.g. `context.company`. */
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface Validator<T> {
  validate(value: unknown, path?: string): ValidationResult<T>;
}

/** The failure member of `ValidationResult`, named so it can be narrowed to. */
export type ValidationFailure = {
  readonly ok: false;
  readonly issues: readonly ValidationIssue[];
};

/**
 * Narrow a result to its failure member.
 *
 * A plain `if (!result.ok)` narrows only when `strictNullChecks` is on. The
 * repository type-checks this module under two boundaries with different
 * settings — `tsconfig.server.json` enables it, `tsconfig.node.json` does not —
 * so a bare discriminant check compiles in one and fails in the other. An
 * explicit type predicate narrows identically under both, which is why every
 * failure branch below goes through it.
 */
export function isFailure<T>(result: ValidationResult<T>): result is ValidationFailure {
  return result.ok === false;
}

const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const fail = (path: string, message: string): ValidationResult<never> => ({
  ok: false,
  issues: [{ path: path || '(root)', message }],
});

// ── Scalars ─────────────────────────────────────────────────────────────────

export interface StringOptions {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
  /** Collapse surrounding whitespace before validating. Defaults to true. */
  readonly trim?: boolean;
}

export function str(options: StringOptions = {}): Validator<string> {
  const { minLength = 0, maxLength = 20_000, pattern, trim = true } = options;
  return {
    validate(value, path = '') {
      if (typeof value !== 'string') return fail(path, 'must be a string');
      const candidate = trim ? value.trim() : value;
      if (candidate.length < minLength) {
        return fail(path, `must be at least ${minLength} character(s)`);
      }
      if (candidate.length > maxLength) {
        return fail(path, `must be at most ${maxLength} character(s)`);
      }
      if (pattern && !pattern.test(candidate)) return fail(path, 'has an unsupported format');
      return ok(candidate);
    },
  };
}

export function int(options: { min?: number; max?: number } = {}): Validator<number> {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = options;
  return {
    validate(value, path = '') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail(path, 'must be a finite number');
      }
      if (!Number.isInteger(value)) return fail(path, 'must be an integer');
      if (value < min || value > max) return fail(path, `must be between ${min} and ${max}`);
      return ok(value);
    },
  };
}

export function num(options: { min?: number; max?: number } = {}): Validator<number> {
  const { min = -Number.MAX_VALUE, max = Number.MAX_VALUE } = options;
  return {
    validate(value, path = '') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail(path, 'must be a finite number');
      }
      if (value < min || value > max) return fail(path, `must be between ${min} and ${max}`);
      return ok(value);
    },
  };
}

export function bool(): Validator<boolean> {
  return {
    validate(value, path = '') {
      if (typeof value !== 'boolean') return fail(path, 'must be a boolean');
      return ok(value);
    },
  };
}

/** One of a fixed set of string literals. The set is echoed in the message. */
export function literal<T extends string>(allowed: readonly T[]): Validator<T> {
  return {
    validate(value, path = '') {
      if (typeof value !== 'string' || !allowed.includes(value as T)) {
        return fail(path, `must be one of: ${allowed.join(', ')}`);
      }
      return ok(value as T);
    },
  };
}

// ── Structures ──────────────────────────────────────────────────────────────

export function arrayOf<T>(
  item: Validator<T>,
  options: { minItems?: number; maxItems?: number } = {},
): Validator<T[]> {
  const { minItems = 0, maxItems = 500 } = options;
  return {
    validate(value, path = '') {
      if (!Array.isArray(value)) return fail(path, 'must be an array');
      if (value.length < minItems) return fail(path, `must contain at least ${minItems} item(s)`);
      if (value.length > maxItems) return fail(path, `must contain at most ${maxItems} item(s)`);
      const out: T[] = [];
      const issues: ValidationIssue[] = [];
      for (let i = 0; i < value.length; i += 1) {
        const result = item.validate(value[i], `${path}[${i}]`);
        if (isFailure(result)) issues.push(...result.issues);
        else out.push(result.value);
      }
      return issues.length > 0 ? { ok: false, issues } : ok(out);
    },
  };
}

/**
 * An arbitrary JSON object the platform stores and re-serializes but never
 * interprets — for example a proposal block's current content. Depth and node
 * count are bounded so a hostile payload cannot exhaust the prompt budget or
 * the serializer.
 */
export function jsonObject(
  options: { maxDepth?: number; maxNodes?: number } = {},
): Validator<Record<string, unknown>> {
  const { maxDepth = 12, maxNodes = 5_000 } = options;
  return {
    validate(value, path = '') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(path, 'must be an object');
      }
      let nodes = 0;
      const walk = (node: unknown, depth: number): string | null => {
        nodes += 1;
        if (nodes > maxNodes) return `must contain at most ${maxNodes} values`;
        if (depth > maxDepth) return `must not nest deeper than ${maxDepth} levels`;
        if (Array.isArray(node)) {
          for (const child of node) {
            const issue = walk(child, depth + 1);
            if (issue) return issue;
          }
          return null;
        }
        if (typeof node === 'object' && node !== null) {
          for (const child of Object.values(node)) {
            const issue = walk(child, depth + 1);
            if (issue) return issue;
          }
          return null;
        }
        if (typeof node === 'function' || typeof node === 'symbol' || typeof node === 'bigint') {
          return 'must contain only JSON values';
        }
        return null;
      };
      const issue = walk(value, 0);
      if (issue) return fail(path, issue);
      return ok(value as Record<string, unknown>);
    },
  };
}

type Shape = Record<string, Validator<unknown>>;

type Infer<S extends Shape> = { [K in keyof S]: S[K] extends Validator<infer T> ? T : never };

/**
 * Object validator. Keys not declared in the shape are DROPPED — the returned
 * value contains exactly the declared fields and nothing else, so unvalidated
 * caller data can never reach a prompt or an audit record.
 */
export function object<S extends Shape>(shape: S): Validator<Infer<S>> {
  return {
    validate(value, path = '') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(path, 'must be an object');
      }
      const source = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const issues: ValidationIssue[] = [];
      for (const [key, validator] of Object.entries(shape)) {
        const childPath = path ? `${path}.${key}` : key;
        const result = validator.validate(source[key], childPath);
        if (isFailure(result)) {
          issues.push(...result.issues);
          continue;
        }
        if (result.value !== undefined) out[key] = result.value;
      }
      return issues.length > 0 ? { ok: false, issues } : ok(out as Infer<S>);
    },
  };
}

/** Makes a field optional. `undefined` and `null` both mean "absent". */
export function optional<T>(inner: Validator<T>): Validator<T | undefined> {
  return {
    validate(value, path = '') {
      if (value === undefined || value === null) return ok(undefined);
      return inner.validate(value, path);
    },
  };
}

/** Supplies a default when the field is absent. Present values are validated. */
export function withDefault<T>(inner: Validator<T>, fallback: T): Validator<T> {
  return {
    validate(value, path = '') {
      if (value === undefined || value === null) return ok(fallback);
      return inner.validate(value, path);
    },
  };
}

/** A string→string map with bounded key and value sizes. */
export function stringMap(
  options: { maxEntries?: number; maxKeyLength?: number; maxValueLength?: number } = {},
): Validator<Record<string, string>> {
  const { maxEntries = 32, maxKeyLength = 64, maxValueLength = 512 } = options;
  return {
    validate(value, path = '') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(path, 'must be an object');
      }
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > maxEntries) return fail(path, `must contain at most ${maxEntries} keys`);
      const out: Record<string, string> = {};
      for (const [key, raw] of entries) {
        if (key.length > maxKeyLength) return fail(`${path}.${key}`, 'key is too long');
        if (typeof raw !== 'string') return fail(`${path}.${key}`, 'must be a string');
        if (raw.length > maxValueLength) return fail(`${path}.${key}`, 'value is too long');
        out[key] = raw;
      }
      return ok(out);
    },
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** Render issues into a single caller-safe sentence. Values are never echoed. */
export function describeIssues(issues: readonly ValidationIssue[], limit = 5): string {
  const shown = issues.slice(0, limit).map((issue) => `${issue.path} ${issue.message}`);
  const remainder = issues.length - shown.length;
  return remainder > 0 ? `${shown.join('; ')} (+${remainder} more)` : shown.join('; ');
}
