import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { describe, expect, test } from 'vitest';
import { builtHtmlFiles, distDir, readDist } from './helpers';

/**
 * G8 — the search index cannot die quietly. Pagefind runs post-build
 * (`pagefind --site dist`, pinned devDependency — hermetic, no network at
 * build time); the gate asserts the entry JSON exists, index chunks are
 * above a documented byte floor, and the body-scoping attributes survived
 * into the built HTML (nav/footer chrome excluded from the index).
 */
const pagefindDir = join(distDir, 'pagefind');

describe('G8 pagefind index', () => {
  test('entry JSON present', () => {
    expect(existsSync(join(pagefindDir, 'pagefind-entry.json'))).toBe(true);
    const entry = JSON.parse(readFileSync(join(pagefindDir, 'pagefind-entry.json'), 'utf8')) as {
      version?: string;
    };
    expect(typeof entry.version).toBe('string');
  });

  test('pagefind.js loader present', () => {
    expect(existsSync(join(pagefindDir, 'pagefind.js'))).toBe(true);
  });

  test('index chunks above the byte floor (8 KiB total)', () => {
    const chunks = readdirSync(join(pagefindDir, 'index')).filter((f) => f.endsWith('.pf_index'));
    expect(chunks.length).toBeGreaterThan(0);
    const bytes = chunks.reduce((sum, f) => sum + statSync(join(pagefindDir, 'index', f)).size, 0);
    expect(bytes, `index chunk bytes = ${bytes}`).toBeGreaterThanOrEqual(8 * 1024);
  });

  test('wasm bundle present', () => {
    const wasm = readdirSync(pagefindDir).filter((f) => f.endsWith('.pagefind'));
    expect(wasm.length).toBeGreaterThan(0);
  });

  test('indexed regions exclude nav/sidebar chrome', () => {
    for (const page of builtHtmlFiles()) {
      if (page === '404.html') continue;
      const $ = cheerio.load(readDist(page));
      const bodies = $('[data-pagefind-body]');
      expect(bodies.length, `${page} lacks data-pagefind-body`).toBeGreaterThan(0);
      // every nav inside an indexed region must be explicitly excluded
      // (the docs "on this page" box); header/sidebar/footer navs sit
      // outside the indexed regions entirely.
      bodies.find('nav').each((_i, el) => {
        expect($(el).attr('data-pagefind-exclude')).toBeDefined();
      });
      // the docs sidebar <aside> must never be inside an indexed region
      expect($('aside').parents('[data-pagefind-body]').length).toBe(0);
    }
    // the 404 page is deliberately excluded from the index
    expect(readDist('404.html')).not.toContain('data-pagefind-body');
  });

  test('the modal ships the lazy pagefind loader', () => {
    for (const page of ['index.html', 'docs/quickstart/index.html']) {
      expect(readDist(page)).toContain('data-base="/lumen/"');
    }
  });
});
