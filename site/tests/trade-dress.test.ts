import { describe, expect, test } from 'vitest';
import { builtHtmlFiles, readDist, readSrc, srcDir, urlOf, walk } from './helpers';

/**
 * G3 — trade-dress scan (I7: look derived, not copied).
 *
 * Automated part (this file): the known-distinctive strings must not appear
 * anywhere in site source or built HTML; `pi.dev` may appear ONLY on the
 * attributions page (factual design-inspiration note) and in the single
 * footer inspiration line (PLAN I8 mechanism row).
 *
 * Manual part (standing checklist in site/README.md — asset provenance and
 * copy originality cannot be string-matched): every SVG is authored
 * in-repo; no third-party tagline/section-title set is reproduced.
 */

const ATTRIBUTIONS_PAGE = 'docs/attributions/index.html';
const ATTRIBUTIONS_SRC = 'pages/docs/attributions.astro';
const FOOTER_SRC = 'components/Footer.astro';
/** The plan's single permitted footer inspiration line (I8 mechanism row). */
const INSPIRATION_LINE = 'Visual design inspired by pi.dev; tokens reimplemented from scratch';

/** Distinctive third-party strings — banned everywhere, case-insensitive. */
const bannedStrings = [
  'earendil',
  'crooked',
  'agent harness',
  'this one is yours',
  'adapt pi',
] as const;

const srcTextFiles = walk(srcDir);

describe('G3 trade-dress scan', () => {
  test.each([...bannedStrings])('banned string %j absent from site source', (needle) => {
    for (const file of srcTextFiles) {
      expect(
        readSrc(file).toLowerCase(),
        `${file} contains banned string "${needle}"`,
      ).not.toContain(needle);
    }
  });

  test.each([...bannedStrings])('banned string %j absent from built HTML', (needle) => {
    for (const page of builtHtmlFiles()) {
      expect(
        readDist(page).toLowerCase(),
        `${page} contains banned string "${needle}"`,
      ).not.toContain(needle);
    }
  });

  describe('"pi.dev" restricted to the attributions page + the footer inspiration line', () => {
    test('source: only the attributions page and the footer partial may mention it', () => {
      const allowed = new Set([ATTRIBUTIONS_SRC, FOOTER_SRC]);
      for (const file of srcTextFiles) {
        const mentions = readSrc(file).toLowerCase().includes('pi.dev');
        if (mentions) expect(allowed.has(file), `${file} mentions pi.dev`).toBe(true);
      }
    });

    test('the footer partial carries the single inspiration line', () => {
      expect(readSrc(FOOTER_SRC)).toContain(INSPIRATION_LINE);
    });

    test('built HTML: pi.dev only on the attributions page or inside a page footer', () => {
      for (const page of builtHtmlFiles()) {
        const html = readDist(page);
        const outsideFooters = html.replace(/<footer[\s\S]*?<\/footer>/g, '');
        if (page !== ATTRIBUTIONS_PAGE) {
          expect(
            outsideFooters.toLowerCase().includes('pi.dev'),
            `${urlOf(page)} mentions pi.dev outside the footer`,
          ).toBe(false);
        }
      }
    });

    test('every built page footer carries the inspiration line', () => {
      for (const page of builtHtmlFiles()) {
        const footer = readDist(page).match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? '';
        expect(footer, `${urlOf(page)} footer lacks the inspiration line`).toContain(
          INSPIRATION_LINE,
        );
      }
    });

    test('the attributions page exists and carries the inspiration note', () => {
      expect(builtHtmlFiles()).toContain(ATTRIBUTIONS_PAGE);
      const html = readDist(ATTRIBUTIONS_PAGE).toLowerCase();
      expect(html).toContain('pi.dev');
      expect(html).toContain('reimplemented from scratch');
    });
  });
});
