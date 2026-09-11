/**
 * Remove comments from source, WITHOUT mistaking a string for one.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Every static scanner in this repository strips comments before searching, so
 * that an explanation of a mistake is never reported as the mistake. They all
 * did it the same way:
 *
 *     text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
 *
 * which is regex, not a lexer, and does not know that `/*` inside a string
 * literal is not a comment. Hono routes are mounted with a wildcard path:
 *
 *     app.use("/*", cors({ ... }))
 *
 * The `/*` in that STRING opens a comment as far as the regex is concerned, and
 * it runs to the next `*` + `/` in the file — 101 lines later. 4,146 characters
 * of `supabase/functions/server/index.tsx` were deleted before every scan of
 * it, and the deleted region is not an idle one: it holds the CORS policy, the
 * edge rate limiter and its 429 response.
 *
 * So `tests/security/errorDisclosure.test.ts` — the standing regression for
 * S-1 and S-10, whose own header says "a detector that knows one spelling of a
 * mistake certifies the other spellings" — could not see the rate limiter at
 * all. Nothing was disclosing in that region when this was found, which is luck
 * rather than a result: the guard was not guarding it.
 *
 * ── WHAT THIS DOES ─────────────────────────────────────────────────────────
 *
 * A single left-to-right pass that tracks whether it is inside a string, a
 * template literal, a regex literal or a comment, and only treats `/*` and `//`
 * as comment openers when it is inside none of them. Comments are replaced with
 * a space rather than deleted, so two tokens either side of one do not fuse
 * into a third that never appeared in the source.
 */

/** Characters that can precede `/` when it opens a REGEX rather than divides. */
const REGEX_ALLOWED_BEFORE = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '\n', '+', '-', '*', '%', '<', '>', '~', '^',
]);

/** The last non-whitespace character before `index`, or '' at the start. */
function previousToken(text: string, index: number): string {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!/\s/.test(text[i])) return text[i];
  }
  return '';
}

export function stripComments(text: string): string {
  let out = '';
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    // ── comments ──────────────────────────────────────────────────────────
    if (char === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      out += ' ';
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (char === '/' && next === '/') {
      const end = text.indexOf('\n', i + 2);
      out += ' ';
      i = end === -1 ? text.length : end; // keep the newline
      continue;
    }

    // ── string and template literals ──────────────────────────────────────
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      out += char;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') {
          out += text[i] + (text[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += text[i];
        if (text[i] === quote) {
          i += 1;
          break;
        }
        // An unterminated single-quoted string cannot span a line; bail rather
        // than swallowing the rest of the file, which is the very bug this
        // module exists to stop.
        if (text[i] === '\n' && quote !== '`') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // ── regex literals ────────────────────────────────────────────────────
    // `/\/\*[\s\S]*?\*\//` is a real pattern in this repository, and its body
    // contains an escaped `*/`. Treated as code it would open a comment.
    if (char === '/' && REGEX_ALLOWED_BEFORE.has(previousToken(text, i))) {
      out += char;
      i += 1;
      let inClass = false;
      while (i < text.length) {
        if (text[i] === '\\') {
          out += text[i] + (text[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (text[i] === '[') inClass = true;
        else if (text[i] === ']') inClass = false;
        out += text[i];
        if (text[i] === '/' && !inClass) {
          i += 1;
          break;
        }
        if (text[i] === '\n') {
          i += 1;
          break; // not a regex after all
        }
        i += 1;
      }
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}
