/**
 * UI SPRINT 7 — the public funnel, swept the same way the console was.
 *
 * HOW THESE WERE FOUND
 *   By driving the landing page, the lead capture, the diagnostic and the score
 *   page in Chromium at 1440px and 390px, and asking the DOM which interactive
 *   elements had no accessible name and whether the document scrolled
 *   horizontally.
 *
 * WHAT THE SWEEP FOUND
 *   * THE LEAD CAPTURE FORM — the entry to the entire acquisition funnel — had
 *     FOUR unlabelled inputs. Each `<label>` had no `htmlFor` and wrapped
 *     nothing, so all four were styled paragraphs beside unnamed controls: a
 *     screen reader announced "edit text, blank" four times, and clicking a
 *     label focused nothing. It was also the only route in the funnel with no
 *     `<main>` landmark.
 *
 *   * THE LANDING PAGE SCROLLED SIDEWAYS ON A PHONE. Several sections enter
 *     with `initial={{ x: -20 }}`, which places the element 20px outside the
 *     viewport until `whileInView` fires. With nothing clipping that, the
 *     document grew to 394px at a 390px viewport, so the whole layout could be
 *     swiped off its own left edge. The hero and the closing CTA already
 *     clipped; the eight bands between them did not.
 *
 * These are structural assertions against the production source, following this
 * directory's pattern for `.tsx` (the runner strips types but does not
 * transform JSX). The behaviour itself was verified in the browser: four named
 * inputs, one main landmark, no horizontal overflow at 390, 768 or 1440, and
 * the funnel still walking from capture through to the diagnostic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('the lead capture form is usable without sight', () => {
  const capture = read('src/app/components/LeadMagnetCapture.tsx');

  const FIELDS = [
    ['lead-name', 'Full Name'],
    ['lead-email', 'Email Address'],
    ['lead-phone', 'Phone Number'],
    ['lead-website', 'Company Website'],
  ] as const;

  for (const [id, label] of FIELDS) {
    it(`${label} is attached to its control`, () => {
      assert.ok(capture.includes(`htmlFor="${id}"`), `${label}'s label has no htmlFor`);
      assert.ok(capture.includes(`id="${id}"`), `${label}'s input has no id`);
    });
  }

  it('leaves no label detached', () => {
    // Any remaining `<label>` in this file that carries no `htmlFor` is a
    // styled paragraph beside an unnamed control.
    const labels = capture.match(/<label(?![^>]*htmlFor)[^>]*>/g) ?? [];
    assert.deepEqual(labels, [], `detached labels remain: ${labels.join(', ')}`);
  });

  it('hides the decorative field icons', () => {
    for (const icon of ['User', 'Mail', 'Phone', 'Globe']) {
      assert.match(
        capture,
        new RegExp(`<${icon} className="absolute[^"]*"\\s+aria-hidden="true"`),
        `the ${icon} field icon is announced to a screen reader`,
      );
    }
  });

  it('is a main landmark, like every other route in the funnel', () => {
    // Both screens — the form and its success state.
    const opens = capture.match(/<main className="min-h-screen/g) ?? [];
    assert.equal(opens.length, 2, 'the capture route has lost a main landmark');
    assert.equal((capture.match(/^    <\/main>$/gm) ?? []).length, 2, 'a main landmark is unclosed');
  });
});

describe('the landing page does not scroll sideways', () => {
  const landing = stripComments(read('src/app/components/LandingPage.tsx'));

  it('clips every band that hosts a travelling entry animation', () => {
    const sections = landing.match(/<section[^>]*className="[^"]*"/g) ?? [];
    assert.ok(sections.length >= 8, `expected the landing bands, found ${sections.length}`);
    for (const section of sections) {
      assert.match(
        section,
        /overflow-hidden|overflow-x-clip/,
        `a landing section clips nothing: ${section.slice(0, 90)}`,
      );
    }
  });

  it('uses clip rather than hidden on the bands', () => {
    // `overflow-x-hidden` creates a scroll container, which breaks
    // `position: sticky` inside the band and steals scroll anchoring.
    // `overflow-x-clip` cuts the overflow with neither side effect.
    assert.ok(landing.includes('overflow-x-clip'), 'the bands are no longer clipped');
    assert.ok(
      !/<section[^>]*overflow-x-hidden/.test(landing),
      'a band is using overflow-x-hidden, which creates a scroll container',
    );
  });

  it('still animates — the fix clips, it does not remove the motion', () => {
    // If a future change "fixes" the overflow by deleting the animation, the
    // clipping was never the point and this says so.
    assert.match(landing, /initial=\{\{ opacity: 0, x: -20 \}\}/);
  });
});

describe('the diagnostic can be answered without sight', () => {
  const form = read('src/app/components/DiagnosticForm.tsx');

  it('makes the question the accessible name of whatever answers it', () => {
    // Each control had only a placeholder, which is not a name and vanishes the
    // moment the user types. On the product's primary journey a screen-reader
    // user was asked fourteen questions they could not hear.
    assert.match(form, /id="diagnostic-question"/);
    const labelled = form.match(/aria-labelledby="diagnostic-question"/g) ?? [];
    assert.ok(labelled.length >= 2, `only ${labelled.length} controls point at the question`);
  });

  it('declares the position in the form as a progressbar', () => {
    assert.match(form, /role="progressbar"/);
    assert.match(form, /aria-valuenow=\{currentStep \+ 1\}/);
    assert.match(form, /aria-valuemax=\{questions\.length\}/);
    assert.match(form, /aria-valuetext=\{`Question \$\{currentStep \+ 1\} of \$\{questions\.length\}`\}/);
  });

  it('announces moving between questions', () => {
    // The step change swapped the heading and grew the bar, and said nothing.
    assert.match(form, /aria-live="polite"\s*\n\s*aria-atomic="true"/);
  });
});

describe('the floating assistant is a named control', () => {
  const assistant = read('src/app/components/AIAssistant.tsx');

  it('names itself and reports its state', () => {
    // Icon-only, floating over every page of the funnel, and announced as
    // "button" and nothing else. One control opens and closes, so the name
    // carries the state too.
    assert.match(assistant, /aria-label=\{isOpen \? 'Close the assistant' : 'Open the assistant'\}/);
    assert.match(assistant, /aria-expanded=\{isOpen\}/);
  });

  it('gives the notification dot words', () => {
    assert.match(assistant, /<span className="sr-only">The assistant has something for you<\/span>/);
  });
});
