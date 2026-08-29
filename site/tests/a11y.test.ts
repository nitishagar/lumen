// @vitest-environment jsdom
import { axe, toHaveNoViolations } from 'jest-axe';
import { describe, expect, test } from 'vitest';
import { bodyOf, builtHtmlFiles, builtJs, readDist, urlOf } from './helpers';

/**
 * G5 — accessibility: jest-axe (axe-core in jsdom) over 100% of built pages,
 * plus the structural keyboard/landmark assertions. Known jsdom blind spots
 * (BA-9): rendered color contrast is covered deterministically by G2, and
 * real focus behavior by structural assertions + a manual pass.
 */
expect.extend(toHaveNoViolations);

const pages = builtHtmlFiles();

describe('G5 structure (every built page)', () => {
  test('page set is non-empty', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  for (const page of pages) {
    describe(urlOf(page), () => {
      const html = readDist(page);

      test('html lang="en"', () => {
        expect(html).toMatch(/<html[^>]*\slang="en"/);
      });

      test('has a skip link targeting #main before main', () => {
        const skipIdx = html.indexOf('class="skip-link"');
        const mainIdx = html.indexOf('<main id="main"');
        expect(skipIdx).toBeGreaterThan(-1);
        expect(mainIdx).toBeGreaterThan(skipIdx);
      });

      test('landmarks: nav, main, footer', () => {
        expect(html).toMatch(/<nav[\s>]/);
        expect(html).toMatch(/<main id="main">/);
        expect(html).toMatch(/<footer[\s>]/);
      });

      test('exactly one h1', () => {
        expect(html.match(/<h1[\s>]/g)?.length ?? 0).toBe(1);
      });

      test('theme toggle + search trigger are buttons', () => {
        expect(html).toMatch(/<button[^>]*data-theme-toggle/);
        expect(html).toMatch(/<button[^>]*data-search-trigger/);
      });

      test('search modal is a labelled dialog', () => {
        expect(html).toMatch(/role="dialog"/);
        expect(html).toMatch(/aria-modal="true"/);
      });

      test('viewport + description present', () => {
        expect(html).toMatch(/name="viewport"/);
        expect(html).toMatch(/name="description"/);
      });

      test('jest-axe: zero violations', async () => {
        const results = await axe(bodyOf(html), {
          rules: {
            // Rendered contrast cannot be measured in jsdom; guaranteed
            // mathematically over the token pairs by G2 instead.
            'color-contrast': { enabled: false },
          },
        });
        expect(results).toHaveNoViolations();
      });
    });
  }
});

describe('G5 install tabs (landing page)', () => {
  const html = readDist('index.html');

  test('ARIA tabs pattern present', () => {
    expect(html.match(/role="tab"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/role="tablist"/);
    expect(html).toMatch(/aria-selected="true"/);
    expect(html.match(/role="tabpanel"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  test('tab keyboard semantics ship in the bundle', () => {
    const js = builtJs();
    expect(js).toMatch(/ArrowRight/);
    expect(js).toMatch(/ArrowLeft/);
  });
});

describe('G5 client behavior ships in the bundle', () => {
  test('theme cycling persists via localStorage key', () => {
    const js = builtJs();
    expect(js).toContain('lumen-theme');
  });

  test('search keydown + escape handling present', () => {
    const js = builtJs();
    expect(js).toMatch(/Escape/);
    expect(js).toMatch(/ctrlKey/);
    expect(js).toMatch(/pagefind/);
  });
});
