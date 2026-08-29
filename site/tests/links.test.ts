import { describe, expect, test } from 'vitest';
import { checkLinks } from '../scripts/check-links.mjs';
import { builtHtmlFiles, distDir } from './helpers';

/**
 * G6 — internal link/anchor checker. External links are recorded, never
 * fetched (determinism); only same-site targets are validated against the
 * built artifact.
 */
const result = checkLinks(distDir);

describe('G6 internal links', () => {
  test('covers the full built page set', () => {
    expect(result.pages).toBe(builtHtmlFiles().length);
    expect(result.pages).toBeGreaterThanOrEqual(9);
  });

  test('zero broken internal links/anchors', () => {
    expect(result.broken).toEqual([]);
  });

  test('a real internal link graph was walked (not vacuously zero links)', () => {
    // Structural guard: the checker must have classified a non-trivial number
    // of internal targets (nav + footer + cross-links + on-this-page anchors),
    // so "zero broken" can never pass on an artifact with no links.
    expect(result.internalLinks).toBeGreaterThanOrEqual(40);
  });

  test('external links are recorded (not fetched) and all https', () => {
    for (const { target } of result.external) {
      expect(target.startsWith('https://'), `non-https external link: ${target}`).toBe(true);
    }
    expect(result.external.length).toBeGreaterThan(0);
  });
});
