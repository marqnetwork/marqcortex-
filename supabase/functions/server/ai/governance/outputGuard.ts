/**
 * Output Guard — validates model output before any caller or datastore sees it.
 *
 * The rules split into two tiers, and the distinction is deliberate:
 *
 *   HARD (blocked)   Structural failure or a compliance risk MARQ cannot ship:
 *                    empty output, output over the size ceiling, unparseable
 *                    JSON, missing required fields, guarantee language. Blocked
 *                    output is never returned. It is retryable and
 *                    failoverable — a different attempt or provider may comply.
 *
 *   SOFT (flagged)   House style, chiefly the banned-jargon list. Returned to
 *                    the caller and recorded on the governance trace and the
 *                    metrics stream. Failing a request because the model wrote
 *                    "streamline" would trade a real outage for a cosmetic
 *                    defect, and the human reviewing the draft can fix a word.
 *
 * Guarantee language is hard because a proposal that promises "guaranteed ROI"
 * is a commercial commitment the consultancy has not made. That is a contract
 * exposure, not a style preference.
 */

import type { AIGovernanceRules } from '../contracts/policy.ts';
import type { AIResponseFormat } from '../contracts/request.ts';
import { AIError } from '../contracts/errors.ts';

export interface OutputGuardOutcome {
  readonly content: string;
  readonly status: 'pass' | 'flagged';
  /** Soft-rule violations found. Recorded, never fatal. */
  readonly flags: readonly string[];
  /** Present when the feature declared `json_object`. */
  readonly parsed?: Record<string, unknown>;
}

/**
 * Phrases that assert a guaranteed commercial outcome. Matched
 * case-insensitively against the whole completion.
 */
const GUARANTEE_PATTERNS: readonly RegExp[] = [
  /\bguarantee(?:d|s)?\s+(?:roi|return|result|outcome|revenue|savings?|success)\b/i,
  /\b(?:roi|return|revenue|savings?)\s+(?:is|are)\s+guaranteed\b/i,
  /\bwill\s+(?:definitely|certainly|absolutely)\s+(?:increase|reduce|save|deliver)\b/i,
  /\bcertain\s+to\s+(?:increase|reduce|save|deliver|achieve)\b/i,
  /\bwe\s+guarantee\b/i,
  /\bno\s+risk\s+(?:whatsoever|at\s+all)\b/i,
];

/** House-style bans. Soft: recorded on the trace, never fatal. */
const BANNED_JARGON: readonly string[] = [
  'optimize',
  'optimise',
  'leverage',
  'synergy',
  'paradigm',
  'holistic',
  'robust',
  'utilize',
  'utilise',
  'seamless',
  'streamline',
];

export function applyOutputGuard(
  raw: string,
  rules: AIGovernanceRules,
  responseFormat: AIResponseFormat,
): OutputGuardOutcome {
  const content = raw.trim();

  if (content === '') {
    throw new AIError('INVALID_MODEL_OUTPUT', 'The AI provider returned an empty response.', {
      diagnostics: 'output guard: empty content',
    });
  }

  if (content.length > rules.maxOutputChars) {
    throw new AIError('OUTPUT_GUARD_BLOCKED', 'The AI response exceeded the permitted length.', {
      diagnostics: `output guard: ${content.length} chars exceeds ${rules.maxOutputChars}`,
    });
  }

  if (rules.forbidGuaranteeLanguage) {
    const offending = GUARANTEE_PATTERNS.find((pattern) => pattern.test(content));
    if (offending) {
      throw new AIError('OUTPUT_GUARD_BLOCKED', 'The AI response contained prohibited guarantee language.', {
        diagnostics: `output guard: guarantee pattern ${offending.source}`,
      });
    }
  }

  let parsed: Record<string, unknown> | undefined;
  if (rules.enforceResponseFormat && responseFormat === 'json_object') {
    parsed = parseJsonObject(content);
  }

  const flags: string[] = [];
  if (rules.enforceToneBans) {
    const lowered = content.toLowerCase();
    for (const word of BANNED_JARGON) {
      // Word boundaries so "optimizer" in a tool name is not a violation but
      // "optimize" as a verb is.
      if (new RegExp(`\\b${word}\\b`).test(lowered)) flags.push(`tone:${word}`);
    }
  }

  return {
    content,
    status: flags.length > 0 ? 'flagged' : 'pass',
    flags,
    parsed,
  };
}

/**
 * Parse a JSON object from model output.
 *
 * Models sometimes wrap JSON in a markdown fence despite instruction. Stripping
 * a fence is a normalisation, not a leniency — the payload inside must still be
 * a valid object with the required fields, and anything else fails.
 */
export function parseJsonObject(content: string): Record<string, unknown> {
  const candidate = stripCodeFence(content);
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    throw new AIError('INVALID_MODEL_OUTPUT', 'The AI response was not valid JSON.', {
      diagnostics: `output guard: unparseable JSON, first 120 chars: ${candidate.slice(0, 120)}`,
    });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AIError('INVALID_MODEL_OUTPUT', 'The AI response was not a JSON object.', {
      diagnostics: 'output guard: JSON root is not an object',
    });
  }
  return value as Record<string, unknown>;
}

/** Assert required top-level fields. Reported together, not one at a time. */
export function assertRequiredFields(
  parsed: Record<string, unknown>,
  required: readonly string[],
): void {
  const missing = required.filter((field) => !(field in parsed));
  if (missing.length > 0) {
    throw new AIError('INVALID_MODEL_OUTPUT', 'The AI response was missing required fields.', {
      diagnostics: `output guard: missing fields ${missing.join(', ')}`,
    });
  }
}

function stripCodeFence(content: string): string {
  const fenced = content.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  return fenced ? fenced[1].trim() : content;
}
