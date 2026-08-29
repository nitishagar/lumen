import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { siteRoot, srcDir } from './helpers';

/**
 * G2 — contrast math. jsdom cannot render color (BA-9), so AA contrast is
 * guaranteed deterministically: WCAG 2.1 ratios computed from the token
 * VALUES parsed out of src/styles/tokens.css, for every enumerated fg/bg
 * pair in BOTH themes. Also asserts the no-JS media block is token-identical
 * to the [data-theme="light"] block (without-JS parity).
 */

type Tokens = Record<string, string>;

function parseBlock(css: string, selector: string): Tokens {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector not found in tokens.css: ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = css.slice(open + 1, end);
  const tokens: Tokens = {};
  for (const m of body.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[m[1] as string] = (m[2] as string).toLowerCase();
  }
  return tokens;
}

function channel(hex: string, part: number): number {
  return Number.parseInt(hex.slice(1 + part * 2, 3 + part * 2), 16) / 255;
}

function luminance(hex: string): number {
  const lin = [0, 1, 2].map((i) => {
    const c = channel(hex, i);
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const rawCss = readFileSync(join(siteRoot, 'src/styles/tokens.css'), 'utf8');
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, ''); // selectors also appear in comments
const dark = parseBlock(css, ':root {');
const light = parseBlock(css, '[data-theme="light"]');
const mediaLight = parseBlock(css, ':root:not([data-theme="dark"])');

const pairs: readonly [string, string][] = [
  ['--text', '--bg'],
  ['--text', '--surface'],
  ['--dim', '--bg'],
  ['--dim', '--surface'],
  ['--accent', '--bg'],
  ['--accent', '--surface'],
  ['--link', '--bg'],
  ['--link', '--surface'],
  ['--badge-green', '--badge-green-bg'],
  ['--badge-blue', '--badge-blue-bg'],
  ['--badge-purple', '--badge-purple-bg'],
  ['--badge-amber', '--badge-amber-bg'],
  ['--badge-red', '--badge-red-bg'],
];

describe('G2 contrast math (WCAG 2.1 AA, both themes)', () => {
  test('no-JS media block is token-identical to the light block', () => {
    expect(mediaLight).toEqual(light);
  });

  for (const [theme, tokens] of [['dark', dark], ['light', light]] as const) {
    describe(`${theme} theme`, () => {
      test.each(pairs)('%s on %s >= 4.5:1', (fg, bg) => {
        const f = tokens[fg];
        const b = tokens[bg];
        expect(f, `${fg} undefined in ${theme} tokens`).toBeDefined();
        expect(b, `${bg} undefined in ${theme} tokens`).toBeDefined();
        const r = ratio(f as string, b as string);
        expect(r, `${fg} (${f}) on ${bg} (${b}) = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  test('accent and link are distinct tokens in both themes', () => {
    expect(dark['--accent']).not.toBe(dark['--link']);
    expect(light['--accent']).not.toBe(light['--link']);
  });
});

// Keep the parser honest: source-of-truth file is where we expect it.
test('tokens.css parses with non-empty theme blocks', () => {
  expect(Object.keys(dark).length).toBeGreaterThanOrEqual(16);
  expect(Object.keys(light).length).toBeGreaterThanOrEqual(16);
  void srcDir;
});
