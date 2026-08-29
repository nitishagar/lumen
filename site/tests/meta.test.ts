import { describe, expect, test } from 'vitest';
import { builtHtmlFiles, readDist, urlOf } from './helpers';

/**
 * Phase 6 meta pass — honest titles + descriptions. It would be embarrassing
 * for an SEO tool to ship duplicate titles: every built page gets a unique
 * <title> and a non-empty meta description (the 404 page included).
 */
const pages = builtHtmlFiles();

const titleOf = (html: string): string => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
const descOf = (html: string): string =>
  html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';

describe('titles and descriptions', () => {
  test('every page has a title and a description', () => {
    for (const page of pages) {
      const html = readDist(page);
      expect(titleOf(html).length, `${page} title missing/empty`).toBeGreaterThan(3);
      expect(descOf(html).length, `${page} description missing/empty`).toBeGreaterThan(20);
    }
  });

  test('titles are unique', () => {
    const seen = new Map<string, string>();
    for (const page of pages) {
      const t = titleOf(readDist(page));
      expect(seen.has(t), `duplicate title "${t}" (${page} vs ${seen.get(t) ?? ''})`).toBe(false);
      seen.set(t, page);
    }
  });

  test('descriptions are unique', () => {
    const seen = new Map<string, string>();
    for (const page of pages) {
      const d = descOf(readDist(page));
      expect(seen.has(d), `duplicate description on ${page} (also ${seen.get(d) ?? ''})`).toBe(false);
      seen.set(d, page);
    }
  });

  test('titles identify the site; docs titles identify the page', () => {
    for (const page of pages) {
      const t = titleOf(readDist(page));
      expect(t.toLowerCase().includes('lumen'), `${urlOf(page)} title does not name lumen`).toBe(true);
    }
    for (const page of pages.filter((p) => p.startsWith('docs/'))) {
      expect(titleOf(readDist(page)).endsWith('— lumen docs')).toBe(true);
    }
  });
});
