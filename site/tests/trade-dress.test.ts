import { describe, expect, test } from 'vitest';
import { builtHtmlFiles, readDist, readSrc, srcDir, urlOf, walk } from './helpers';

/**
 * G3 — trade-dress scan (I7: look derived, not copied).
 *
 * Automated part (this file): the known-distinctive strings must not appear
 * anywhere in site source or built HTML; `pi.dev` may appear ONLY on the
 * attributions page (factual design-inspiration note).
 *
 * Manual part (standing checklist in site/README.md — asset provenance and
 * copy originality cannot be string-matched): every SVG is authored
 * in-repo; no third-party tagline/section-title set is reproduced.
 */

const ATTRIBUTIONS_PAGE = 'docs/attributions/index.html';
const ATTRIBUTIONS_SRC = 'pages/docs/attributions.astro';

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

  describe('"pi.dev" restricted to the attributions page', () => {
    test('source: only the attributions page may mention it', () => {
      for (const file of srcTextFiles) {
        const mentions = readSrc(file).toLowerCase().includes('pi.dev');
        if (mentions) expect(file).toBe(ATTRIBUTIONS_SRC);
      }
    });

    test('built HTML: only the attributions page may mention it', () => {
      for (const page of builtHtmlFiles()) {
        const mentions = readDist(page).toLowerCase().includes('pi.dev');
        if (mentions) expect(page, `${urlOf(page)} mentions pi.dev`).toBe(ATTRIBUTIONS_PAGE);
      }
    });
  });
});
