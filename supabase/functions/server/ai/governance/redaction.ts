/**
 * PII redaction.
 *
 * Applied to every prompt before it leaves the platform. A third-party model
 * provider is an external processor: anything sent to it has left MARQ's
 * boundary and may be logged, retained or reviewed under the provider's terms,
 * not MARQ's. Diagnostic answers are free text written by client staff and
 * routinely contain names, work emails, direct phone numbers and occasionally
 * pasted credentials.
 *
 * Redaction is placeholder substitution, not deletion: `[REDACTED_EMAIL]` keeps
 * the sentence grammatical so the model still reads coherent context, while the
 * value itself never crosses the boundary.
 *
 * Order matters. Credentials are matched before anything else, because an API
 * key can contain substrings that later patterns would otherwise partially
 * rewrite, leaving a mangled but still-recognisable secret in the prompt.
 */

export type PIICategory =
  | 'credential'
  | 'email'
  | 'phone'
  | 'payment_card'
  | 'national_id'
  | 'ip_address';

interface RedactionRule {
  readonly category: PIICategory;
  readonly pattern: RegExp;
  readonly placeholder: string;
}

/**
 * Rules run in declaration order. Each pattern is global and stateless at call
 * time — `String.replace` with a fresh regex avoids `lastIndex` carry-over
 * between calls, which is why the array is rebuilt per rule rather than shared.
 */
const RULES: readonly RedactionRule[] = [
  {
    // Provider keys and bearer tokens. Deliberately broad: a false positive
    // costs a placeholder in a prompt, a false negative leaks a live secret.
    category: 'credential',
    pattern: /\b(?:sk|pk|rk|api|key|token|secret|bearer)[-_ ]?[A-Za-z0-9_-]{16,}\b/gi,
    placeholder: '[REDACTED_CREDENTIAL]',
  },
  {
    category: 'credential',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    placeholder: '[REDACTED_CREDENTIAL]',
  },
  {
    category: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    placeholder: '[REDACTED_EMAIL]',
  },
  {
    // 13–19 digits with optional separators — the payment card range.
    category: 'payment_card',
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    placeholder: '[REDACTED_CARD]',
  },
  {
    // International and North American formats. Requires a separator or a
    // leading +, so bare 7-digit integers in ROI figures are not swallowed.
    category: 'phone',
    pattern: /(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?|\b\d{2,4}[ .-])\d{3,4}[ .-]\d{3,4}\b/g,
    placeholder: '[REDACTED_PHONE]',
  },
  {
    category: 'national_id',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    placeholder: '[REDACTED_ID]',
  },
  {
    category: 'ip_address',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/g,
    placeholder: '[REDACTED_IP]',
  },
];

export interface RedactionOutcome {
  readonly text: string;
  /** Categories actually removed, sorted. Empty when nothing matched. */
  readonly categories: readonly PIICategory[];
  readonly replacements: number;
}

/** Redact a single string. Pure — the input is never mutated. */
export function redact(text: string): RedactionOutcome {
  let output = text;
  const found = new Set<PIICategory>();
  let replacements = 0;

  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    output = output.replace(pattern, (match) => {
      // A run of digits inside a longer alphanumeric token is not a card
      // number; require the match to be digits and separators only.
      if (rule.category === 'payment_card' && match.replace(/[ -]/g, '').length < 13) {
        return match;
      }
      found.add(rule.category);
      replacements += 1;
      return rule.placeholder;
    });
  }

  return {
    text: output,
    categories: [...found].sort(),
    replacements,
  };
}

/** Redact every message in a conversation, aggregating what was found. */
export function redactAll(texts: readonly string[]): {
  texts: readonly string[];
  categories: readonly PIICategory[];
  replacements: number;
} {
  const found = new Set<PIICategory>();
  let replacements = 0;
  const out = texts.map((text) => {
    const outcome = redact(text);
    for (const category of outcome.categories) found.add(category);
    replacements += outcome.replacements;
    return outcome.text;
  });
  return { texts: out, categories: [...found].sort(), replacements };
}

/** True when the text contains anything the redactor would remove. */
export function containsPII(text: string): boolean {
  return redact(text).replacements > 0;
}
