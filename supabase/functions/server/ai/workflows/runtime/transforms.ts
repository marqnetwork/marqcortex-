/**
 * Deterministic transforms (AI-01 Batch 3B).
 *
 * A `transform` node computes an answer WITHOUT a model. That is the cheapest
 * possible AI optimization — the call that never happens — and it is the reason
 * this registry exists alongside the predicate registry: the two share the same
 * shape and the same refusal to interpret anything a definition supplies as
 * code.
 *
 * THE AVOIDED CALL IS MEASURED, NOT ASSERTED. A transform that declares
 * `avoidsModelCall` must also name the model profile it replaced and the tokens
 * that call would have used; the registry refuses the definition otherwise. The
 * avoided-call ledger then prices those tokens against that profile's versioned
 * indicative rate. So "we saved $0.004" is always a subtraction between two
 * numbers a reviewer can check, never a figure the engine invented.
 *
 * WHAT A TRANSFORM MAY DO. Read its mapped input, compute, return a bounded
 * JSON value. It has no clock of its own (the engine passes one), no store, no
 * network and no randomness. Two runs over the same input produce the same
 * output, which is what makes a transform cacheable and a test meaningful.
 */

import { workflowFailure } from '../contracts/failures.ts';
import { canonicalBytes } from '../../agents/runtime/digest.ts';

export const TRANSFORM_BOUNDS = {
  maxOutputBytes: 32 * 1024,
  maxArrayItems: 500,
  maxStringLength: 20_000,
} as const;

export interface TransformInput {
  /** The node's resolved input, from its `inputMapping`. */
  readonly value: Readonly<Record<string, unknown>>;
  readonly args: Readonly<Record<string, string | number | boolean>>;
  /** Deterministic clock reading. A transform never reads the wall clock. */
  readonly nowIso: string;
  readonly context: {
    readonly workflowRunId: string;
    readonly nodeId: string;
    readonly branchId?: string;
  };
}

export type Transform = (input: TransformInput) => unknown;

export interface TransformRegistry {
  register(transformId: string, transform: Transform): void;
  find(transformId: string): Transform | undefined;
  list(): readonly string[];
}

const TRANSFORM_ID = /^transform\.[a-z0-9]+(\.[a-z0-9_]+)*$/;

export function createTransformRegistry(): TransformRegistry {
  const transforms = new Map<string, Transform>();
  return {
    register(transformId, transform) {
      if (!TRANSFORM_ID.test(transformId)) {
        throw workflowFailure('invalid_node', 'That transform identifier is not valid.', {
          diagnostics: `transform id "${transformId}" must look like transform.text.normalize`,
        });
      }
      if (transforms.has(transformId)) {
        throw workflowFailure('invalid_node', 'That transform is already registered.', {
          diagnostics: `duplicate transform ${transformId}`,
        });
      }
      transforms.set(transformId, transform);
    },
    find: (transformId) => transforms.get(transformId),
    list: () => [...transforms.keys()].sort(),
  };
}

// ── Readers ─────────────────────────────────────────────────────────────────

function stringField(input: TransformInput, key: string): string {
  const value = input.value[key];
  if (typeof value !== 'string') {
    throw workflowFailure('invalid_node', 'That transform received the wrong kind of value.', {
      workflowRunId: input.context.workflowRunId,
      nodeId: input.context.nodeId,
      diagnostics: `field "${key}" must be a string`,
    });
  }
  return value.slice(0, TRANSFORM_BOUNDS.maxStringLength);
}

function arrayField(input: TransformInput, key: string): readonly unknown[] {
  const value = input.value[key];
  if (!Array.isArray(value)) {
    throw workflowFailure('invalid_node', 'That transform received the wrong kind of value.', {
      workflowRunId: input.context.workflowRunId,
      nodeId: input.context.nodeId,
      diagnostics: `field "${key}" must be an array`,
    });
  }
  return value.slice(0, TRANSFORM_BOUNDS.maxArrayItems);
}

// ── The shipped transforms ──────────────────────────────────────────────────

export const TRANSFORM = {
  normalizeText: 'transform.text.normalize',
  classifyLength: 'transform.text.classify_length',
  dedupeStrings: 'transform.list.dedupe_strings',
  countItems: 'transform.list.count',
  mergeRecords: 'transform.record.merge',
  pickFields: 'transform.record.pick',
  stamp: 'transform.meta.stamp',
} as const;

export function registerDefaultTransforms(registry: TransformRegistry): void {
  registry.register(TRANSFORM.normalizeText, (input) => {
    const text = stringField(input, 'text');
    return {
      // Collapsed whitespace and a trimmed body. Deliberately NOT lower-cased:
      // a normalizer that destroys case destroys information a later node may
      // need, and "normalize" must not mean "lossy".
      text: text.replace(/\s+/g, ' ').trim(),
      characters: text.trim().length,
    };
  });

  registry.register(TRANSFORM.classifyLength, (input) => {
    const text = stringField(input, 'text').trim();
    const short = typeof input.args.shortMax === 'number' ? input.args.shortMax : 200;
    const long = typeof input.args.longMin === 'number' ? input.args.longMin : 2_000;
    const label = text.length <= short ? 'short' : text.length >= long ? 'long' : 'medium';
    return { label, characters: text.length };
  });

  registry.register(TRANSFORM.dedupeStrings, (input) => {
    const items = arrayField(input, 'items');
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const item of items) {
      if (typeof item !== 'string') continue;
      const key = item.trim();
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      unique.push(key);
    }
    return { items: unique, removed: items.length - unique.length };
  });

  registry.register(TRANSFORM.countItems, (input) => {
    const items = arrayField(input, 'items');
    return { count: items.length };
  });

  registry.register(TRANSFORM.mergeRecords, (input) => {
    // Ordered merge over the DECLARED field order, so the result is a function
    // of the mapping rather than of object iteration order.
    const merged: Record<string, unknown> = {};
    for (const key of Object.keys(input.value).sort()) {
      const candidate = input.value[key];
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue;
      for (const [field, value] of Object.entries(candidate as Record<string, unknown>).sort(
        ([a], [b]) => a.localeCompare(b),
      )) {
        if (value !== undefined) merged[field] = value;
      }
    }
    return { merged };
  });

  registry.register(TRANSFORM.pickFields, (input) => {
    const source = input.value.record;
    const fields = typeof input.args.fields === 'string' ? input.args.fields.split(',') : [];
    const picked: Record<string, unknown> = {};
    if (typeof source === 'object' && source !== null && !Array.isArray(source)) {
      for (const field of fields.map((entry) => entry.trim()).filter((entry) => entry !== '')) {
        if (Object.prototype.hasOwnProperty.call(source, field)) {
          picked[field] = (source as Record<string, unknown>)[field];
        }
      }
    }
    return { picked };
  });

  registry.register(TRANSFORM.stamp, (input) => ({
    at: input.nowIso,
    workflowRunId: input.context.workflowRunId,
    nodeId: input.context.nodeId,
  }));
}

/** Run a named transform, bounding whatever it produces. */
export function runTransform(
  registry: TransformRegistry,
  transformId: string,
  input: TransformInput,
): unknown {
  const transform = registry.find(transformId);
  if (!transform) {
    throw workflowFailure('invalid_node', 'That node uses an unknown transform.', {
      workflowRunId: input.context.workflowRunId,
      nodeId: input.context.nodeId,
      diagnostics: `transform ${transformId} is not registered`,
    });
  }
  const output = transform(input);
  const bytes = canonicalBytes(output);
  if (bytes === undefined || bytes > TRANSFORM_BOUNDS.maxOutputBytes) {
    throw workflowFailure('invalid_node', 'That transform produced more data than the engine stores.', {
      workflowRunId: input.context.workflowRunId,
      nodeId: input.context.nodeId,
      diagnostics: `transform output ${bytes ?? 'unserializable'} bytes above ${TRANSFORM_BOUNDS.maxOutputBytes}`,
    });
  }
  return output;
}
