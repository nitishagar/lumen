/**
 * check-links.mjs — G6 internal link/anchor checker over the built artifact.
 *
 * Walks every built HTML file, classifies each href/src as internal or
 * external, resolves internal targets to files under dist/, and verifies
 * fragment anchors exist in the target document. External links are
 * RECORDED, never fetched (I10 determinism; BA-10).
 *
 * Zero dependencies beyond cheerio; exported as a pure function for the
 * Vitest gate.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';
import * as cheerio from 'cheerio';

export const SITE_ORIGIN = 'https://nitishagar.github.io';
export const BASE_PATH = '/lumen';

/** Recursively list files under `dir`. */
const walkFiles = (dir) => {
  const out = [];
  const visit = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(full);
    }
  };
  visit(dir);
  return out;
};

/** URL path -> dist file path (or null when it does not map to a file). */
const resolveInternal = (distDir, urlPath) => {
  let p = urlPath;
  if (p.startsWith(BASE_PATH)) p = p.slice(BASE_PATH.length);
  if (p.startsWith('/')) p = p.slice(1);
  if (p === '') return join(distDir, 'index.html');
  if (p.endsWith('/')) return join(distDir, p, 'index.html');
  return join(distDir, p);
};

/**
 * @returns {{
 *   broken: {page: string, target: string, reason: string}[],
 *   external: {page: string, target: string}[],
 *   pages: number,
 *   internalLinks: number
 * }}
 */
export function checkLinks(distDir) {
  const broken = [];
  const external = [];
  const htmlFiles = walkFiles(distDir).filter((f) => f.endsWith('.html'));
  const htmlContents = new Map(htmlFiles.map((f) => [f, readFileSync(f, 'utf8')]));
  const idsByFile = new Map();
  for (const [file, html] of htmlContents) {
    const $ = cheerio.load(html);
    idsByFile.set(file, new Set($('[id]').toArray().flatMap((el) => $(el).attr('id') ?? [])));
  }

  for (const [file, html] of htmlContents) {
    const page = file.slice(distDir.length + 1);
    const $ = cheerio.load(html);
    const attrs = [
      ...$('a[href]').toArray().map((el) => $(el).attr('href')),
      ...$('link[href]').toArray().map((el) => $(el).attr('href')),
      ...$('script[src]').toArray().map((el) => $(el).attr('src')),
      ...$('img[src]').toArray().map((el) => $(el).attr('src')),
    ].filter((v) => typeof v === 'string' && v.length > 0);

    for (const target of attrs) {
      if (target.startsWith('#')) {
        const ids = idsByFile.get(file);
        if (!ids.has(target.slice(1))) {
          broken.push({ page, target, reason: 'same-page anchor id missing' });
        }
        continue;
      }
      if (/^(https?:)?\/\//.test(target) || target.startsWith('mailto:') || target.startsWith('data:')) {
        if (target.startsWith(SITE_ORIGIN)) {
          const url = new URL(target);
          const file2 = resolveInternal(distDir, url.pathname);
          if (!htmlContents.has(file2)) {
            broken.push({ page, target, reason: 'site-absolute URL does not map to a built file' });
          }
        } else {
          external.push({ page, target });
        }
        continue;
      }
      if (target.startsWith('/')) {
        if (!target.startsWith(`${BASE_PATH}/`) && target !== BASE_PATH) {
          broken.push({ page, target, reason: 'root-absolute link missing the /lumen base' });
          continue;
        }
        const [path, frag] = target.split('#');
        const file2 = resolveInternal(distDir, path ?? '');
        if (!htmlContents.has(file2) && !exists(file2)) {
          broken.push({ page, target, reason: 'internal target not built' });
          continue;
        }
        if (frag && htmlContents.has(file2)) {
          const ids = idsByFile.get(file2);
          if (!ids?.has(frag)) {
            broken.push({ page, target, reason: `anchor id "${frag}" missing in target` });
          }
        }
        continue;
      }
      broken.push({ page, target, reason: 'relative link form not used by this site' });
    }
  }

  return {
    broken,
    external,
    pages: htmlFiles.length,
    internalLinks: htmlFiles.length,
  };
}

const exists = (p) => {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
};
