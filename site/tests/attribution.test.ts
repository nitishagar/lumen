import { describe, expect, test } from 'vitest';
import locked from '../src/data/locked-names.json';
import { builtHtmlFiles, readDist } from './helpers';

/**
 * G9 — license & attribution presence (I8).
 *
 * Every built page's footer links the Apache-2.0 license; the attributions
 * page carries the CrUX CC BY 4.0 notice (verbatim sentence + license URL +
 * methodology URL) and the Tranco attribution; the providers page states
 * BYOK skip-when-absent semantics and the env-var names.
 */
const footerOf = (html: string): string => {
  const start = html.indexOf('<footer');
  const end = html.indexOf('</footer>', start);
  return html.slice(start, end);
};

describe('G9 attribution presence', () => {
  test('every built page footer links the Apache-2.0 license', () => {
    for (const page of builtHtmlFiles()) {
      const footer = footerOf(readDist(page));
      expect(footer, `${page} has no footer`).not.toBe('');
      expect(footer, `${page} footer lacks the license href`).toContain(`href="${locked.licenseUrl}"`);
      expect(footer, `${page} footer lacks the license name`).toContain('Apache-2.0');
      expect(footer, `${page} footer lacks the attributions link`).toContain('/lumen/docs/attributions/');
      expect(footer, `${page} footer lacks the changelog link`).toContain(
        `href="${locked.changelogUrl}"`,
      );
    }
  });

  test('attributions page: CrUX CC BY 4.0 (verbatim + URLs)', () => {
    const html = readDist('docs/attributions/index.html');
    expect(html).toContain(
      'The CrUX datasets from Google are licensed under the Creative Commons Attribution 4.0 International license.',
    );
    expect(html).toContain('https://creativecommons.org/licenses/by/4.0/');
    expect(html).toContain('https://developer.chrome.com/docs/crux/methodology');
    expect(html).toContain('CC BY 4.0');
  });

  test('attributions page: Tranco + Open PageRank + Wikimedia + Apache-2.0', () => {
    const html = readDist('docs/attributions/index.html');
    expect(html).toContain('Tranco');
    expect(html).toContain('tranco-list.eu');
    expect(html).toContain('Open PageRank');
    expect(html).toContain('Wikimedia');
    expect(html).toContain(locked.licenseUrl);
  });

  test('providers page: skip-when-absent semantics + env-var names', () => {
    const html = readDist('docs/providers-byok/index.html');
    expect(html.toLowerCase()).toContain('not configured');
    expect(html).toContain('never a crash');
    for (const envVar of locked.envVars) {
      expect(html, `${envVar} missing from providers page`).toContain(envVar);
    }
  });
});
