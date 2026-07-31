/**
 * PHASE 1B TASK 28 — inert href on an imported Desktop06 span
 *
 * The generated Desktop06 markup contained an anchor whose only child span
 * repeated the anchor's own `href`:
 *
 *     <a className="… underline" href="https://gumroad.com/a/392336499/lvDpQ">
 *       <span className="…" href="https://gumroad.com/a/392336499/lvDpQ">
 *         purchasing full version
 *       </span>
 *     </a>
 *
 * `href` is not a valid prop on `HTMLSpanElement`, so React never rendered it as
 * a navigable link — the attribute was inert, duplicated from the parent that
 * actually carries the navigation. TypeScript flagged it as TS2322.
 *
 * The fix removes that one prop. The anchor, its `href`, the link text, every
 * className and the surrounding generated markup are untouched, so nothing about
 * what a user sees or clicks changes.
 *
 * TESTING APPROACH (documented limitation — the established pattern in
 * frontendRuntimeDefects.test.ts and teamSessionKeys.test.ts)
 *   Desktop06 is a .tsx module of generated markup, the repository ships no React
 *   test renderer, and the test runner strips types but does not transform JSX —
 *   so the component cannot be imported and rendered here. The guarantees are
 *   enforced structurally against the production source. Assertions are
 *   pattern-based, never line-number-based.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DESKTOP06_REL = 'src/imports/Desktop06.tsx';
const LINK_URL = 'https://gumroad.com/a/392336499/lvDpQ';
const LINK_TEXT = 'purchasing full version';

const source = readFileSync(join(REPO_ROOT, DESKTOP06_REL), 'utf8');

/** The `<a …>…</a>` element that wraps the upsell link, tag to closing tag. */
function upsellAnchor(): string {
  const start = source.indexOf('<a ');
  assert.notEqual(start, -1, 'the upsell anchor was removed from Desktop06');
  const end = source.indexOf('</a>', start);
  assert.notEqual(end, -1, 'the upsell anchor is unterminated');
  return source.slice(start, end + '</a>'.length);
}

/** The paragraph block the anchor lives in, so sibling spans are in scope too. */
function upsellBlock(): string {
  const start = source.indexOf('<p className="css-4hzbpn text-[16px]">');
  assert.notEqual(start, -1, 'the upsell paragraph was renamed or removed');
  const end = source.indexOf('</p>', start);
  assert.notEqual(end, -1, 'the upsell paragraph is unterminated');
  return source.slice(start, end + '</p>'.length);
}

describe('Desktop06 upsell link', () => {
  it('keeps the exact URL on the parent anchor', () => {
    const anchor = upsellAnchor();
    assert.ok(anchor.startsWith('<a '), 'the anchor element changed tag');
    assert.ok(anchor.includes(`href="${LINK_URL}"`), 'the anchor lost its href or the URL changed');
  });

  it('keeps the anchor className unchanged', () => {
    assert.ok(
      upsellAnchor().includes(
        'className="[text-decoration-skip-ink:none] cursor-pointer decoration-solid leading-[20px] text-[#62f783] underline"',
      ),
      'the anchor className changed',
    );
  });

  it('keeps the visible link text unchanged', () => {
    assert.ok(upsellAnchor().includes(LINK_TEXT), 'the link text changed');
  });

  it('keeps the span nested inside the anchor', () => {
    const anchor = upsellAnchor();
    const spanStart = anchor.indexOf('<span ');
    assert.notEqual(spanStart, -1, 'the inner span was removed rather than de-propped');
    assert.ok(
      anchor.indexOf(LINK_TEXT) > spanStart,
      'the link text is no longer inside the inner span',
    );
    assert.ok(
      anchor.includes(
        '<span className="[text-decoration-skip-ink:none] decoration-solid leading-[20px]">',
      ),
      'the inner span className changed',
    );
  });

  it('carries no href on any span in the block', () => {
    for (const span of upsellBlock().match(/<span\b[^>]*>/g) ?? []) {
      assert.equal(/\bhref=/.test(span), false, `a span still carries href: ${span}`);
    }
  });

  it('carries no href on any span anywhere in the generated module', () => {
    for (const span of source.match(/<span\b[^>]*>/g) ?? []) {
      assert.equal(/\bhref=/.test(span), false, `a span still carries href: ${span}`);
    }
  });

  it('leaves exactly one occurrence of the URL, on the anchor', () => {
    const occurrences = source.split(LINK_URL).length - 1;
    assert.equal(occurrences, 1, `expected the URL once, found it ${occurrences} times`);
  });
});
