import { describe, expect, test } from 'vitest';
import locked from '../src/data/locked-names.json';
import { builtHtmlFiles, readDist } from './helpers';

/**
 * G7 — locked-name conformance (RENAMES.md is authoritative).
 *
 * (a) install snippets on the landing page match the locked strings
 *     byte-for-byte;
 * (b) the `lumen_[a-z_]+` sweep over ALL built HTML yields only locked MCP
 *     tool names (catches typo'd tools in prose);
 * (c) the locked MCP tools all appear somewhere in the docs;
 * (d) product/package/config tokens are spelled as locked.
 */
const allHtml = () => builtHtmlFiles().map((p) => readDist(p)).join('\n');

describe('G7 locked names', () => {
  test('install snippets are byte-exact on the landing page', () => {
    const index = readDist('index.html');
    for (const snippet of [
      locked.snippets.installGlobal,
      locked.snippets.npxAudit,
      locked.snippets.claudeMcpAdd,
    ]) {
      expect(index, `missing byte-exact snippet: ${snippet}`).toContain(snippet);
    }
  });

  test('every lumen_* token in built HTML is a locked MCP tool', () => {
    const seen = new Set<string>();
    for (const page of builtHtmlFiles()) {
      for (const m of readDist(page).matchAll(/lumen_[a-z_]+/g)) seen.add(m[0]);
    }
    const unlocked = [...seen].filter((t) => !locked.mcpTools.includes(t));
    expect(unlocked, 'unlocked lumen_* tokens found in built HTML').toEqual([]);
    expect(seen.size).toBe(locked.mcpTools.length);
  });

  test('all five locked MCP tools appear in the built site', () => {
    const html = allHtml();
    for (const tool of locked.mcpTools) {
      expect(html, `${tool} never mentioned`).toContain(tool);
    }
  });

  test('locked product tokens are spelled as locked', () => {
    const html = allHtml();
    for (const token of [
      locked.product,
      locked.packages.cli,
      locked.cliBin,
      locked.configFile,
    ]) {
      expect(html).toContain(token);
    }
    // The old codename must not survive anywhere in the built site.
    expect(html.toLowerCase()).not.toContain('seolite');
  });

  test('tagline renders on the landing page', () => {
    expect(readDist('index.html')).toContain(locked.tagline);
  });
});
