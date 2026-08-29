import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { builtHtmlFiles, distDir, readDist } from './helpers';

/**
 * Build-output contract (PLAN Phase 1) — the artifact ci-deploy uploads must
 * contain the required entry files, and Pages-base asset URLs must be baked
 * into the built HTML.
 */
describe('build artifact contract', () => {
  const required = ['index.html', '404.html', 'sitemap.xml', 'robots.txt'];

  test.each(required)('dist/%s exists', (file) => {
    expect(existsSync(join(distDir, file)), `dist/${file} missing`).toBe(true);
  });

  test('no source maps ship in the artifact', () => {
    const maps = readdirSync(distDir, { recursive: true }).filter((f) =>
      String(f).endsWith('.map'),
    );
    expect(maps).toEqual([]);
  });

  test('built pages reference the /lumen/ base for assets and links', () => {
    const pages = builtHtmlFiles();
    expect(pages.length).toBeGreaterThan(0);
    const index = readDist('index.html');
    expect(index).toContain('href="/lumen/favicon.svg"');
    expect(index).toContain('/lumen/assets/');
  });

  test('robots.txt references the sitemap at the canonical Pages URL', () => {
    const robots = readDist('robots.txt');
    expect(robots).toContain('Sitemap: https://nitishagar.github.io/lumen/sitemap.xml');
    const sitemap = readFileSync(join(distDir, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://nitishagar.github.io/lumen/</loc>');
  });
});
