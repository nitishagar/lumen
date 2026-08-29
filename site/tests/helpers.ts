/**
 * Shared helpers for the site gate suite. Everything operates on files on
 * disk under site/dist (built artifact) and site/src (source) — zero
 * network, zero wall clock (I10).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const siteRoot = resolve(import.meta.dirname, '..');
export const srcDir = join(siteRoot, 'src');
export const distDir = join(siteRoot, 'dist');

/** Recursively list files under `dir`, relative to `dir` itself. */
export function walk(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(relative(dir, full));
    }
  };
  visit(dir);
  return out.sort();
}

/** All built HTML files (dist-relative paths, e.g. `docs/quickstart/index.html`). */
export function builtHtmlFiles(): string[] {
  return walk(distDir).filter((f) => f.endsWith('.html'));
}

export function readDist(rel: string): string {
  return readFileSync(join(distDir, rel), 'utf8');
}

/** Concatenation of all built JS bundles (for behavior-presence assertions). */
export function builtJs(): string {
  const assets = join(distDir, 'assets');
  return readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
    .join('\n');
}

export function readSrc(rel: string): string {
  return readFileSync(join(srcDir, rel), 'utf8');
}

/** The body inner HTML of a built page (for jsdom/axe injection). */
export function bodyOf(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (match === null) throw new Error('built page has no <body>');
  return match[1] as string;
}

/** dist-relative path of a built page → its public URL path (/lumen/…). */
export function urlOf(builtRel: string): string {
  const path = builtRel === 'index.html' ? '/' : builtRel.replace(/index\.html$/, '');
  return `/lumen${path}`;
}

/** Every CSS custom property the design system must define (G1). */
export const requiredCssVars = [
  '--bg',
  '--surface',
  '--border',
  '--hover',
  '--text',
  '--dim',
  '--accent',
  '--link',
  '--badge-green',
  '--badge-green-bg',
  '--badge-blue',
  '--badge-blue-bg',
  '--badge-purple',
  '--badge-purple-bg',
  '--badge-amber',
  '--badge-amber-bg',
  '--badge-red',
  '--badge-red-bg',
  '--font-sans',
  '--font-mono',
  '--radius-card',
  '--radius-btn',
  '--radius-code',
  '--radius-pill',
  '--root-size',
  '--speed',
] as const;
