import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { builtHtmlFiles, distDir, readDist, requiredCssVars } from './helpers';

/**
 * G1 — token conformance: every required CSS variable defined in tokens.css
 * must survive into the built stylesheet, and the theming machinery
 * (data-theme selector, OS-preference media query, reduced-motion block)
 * must be present in shipped CSS.
 */
describe('G1 token conformance', () => {
  const assets = join(distDir, 'assets');
  const cssFiles = readdirSync(assets).filter((f) => f.endsWith('.css'));
  const css = cssFiles.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');

  test('built stylesheet exists', () => {
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  test.each(requiredCssVars)('%s defined in built css', (name) => {
    expect(css, `${name} missing from built css`).toMatch(new RegExp(`${name}:`));
  });

  test('light theme selector ships', () => {
    expect(css).toMatch(/\[data-theme=('|")?light\1?\]/);
  });

  test('no-JS OS-preference light block ships', () => {
    expect(css).toMatch(/prefers-color-scheme:\s*light/);
    expect(css).toMatch(/:root:not\(\[data-theme=('|")?dark\1?\]\)/);
  });

  test('prefers-reduced-motion block ships', () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  test('every built page links a stylesheet', () => {
    for (const page of builtHtmlFiles()) {
      expect(readDist(page)).toMatch(/rel="stylesheet"/);
    }
  });
});
