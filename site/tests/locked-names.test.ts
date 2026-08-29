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

/**
 * Astro escapes interpolated text (quotes as &quot; etc.) — compare against
 * the decoded text so "byte-exact" means what a visitor reads.
 */
const decodeHtml = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

describe('G7 locked names', () => {
  test('install snippets are byte-exact on the landing page', () => {
    const index = decodeHtml(readDist('index.html'));
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

  test('all seven locked CLI commands appear in the CLI reference', () => {
    const html = readDist('docs/cli-reference/index.html');
    for (const command of locked.cliCommands) {
      expect(html, `command "${command}" missing from CLI reference`).toContain(`lumen ${command}`);
    }
  });

  test('all seven locked providers appear on the providers page', () => {
    const html = readDist('docs/providers-byok/index.html');
    for (const provider of locked.providers) {
      expect(html, `provider "${provider}" missing from providers page`).toContain(provider);
    }
  });

  test('all five locked MCP tools + universal JSON appear on the MCP page', () => {
    const html = decodeHtml(readDist('docs/mcp-onboarding/index.html'));
    for (const tool of locked.mcpTools) {
      expect(html).toContain(tool);
    }
    expect(html).toContain(locked.snippets.claudeMcpAdd);
    expect(html).toContain(locked.snippets.mcpServersJson);
    expect(html, 'response_format note missing from the MCP page').toContain(
      locked.responseFormatNote,
    );
    for (const route of locked.restRoutes) {
      expect(html, `route "${route}" missing`).toContain(route);
    }
  });

  test('exit codes appear in the CLI reference with their locked meanings', () => {
    const html = decodeHtml(readDist('docs/cli-reference/index.html'));
    for (const { code, meaning } of locked.exitCodes) {
      expect(html, `exit code ${code} missing from the CLI reference`).toContain(String(code));
      expect(html, `meaning of exit code ${code} ("${meaning}") missing`).toContain(meaning);
    }
  });

  test('all locked config keys appear on the configuration page', () => {
    const html = readDist('docs/configuration/index.html');
    for (const key of locked.configKeys) {
      expect(html, `config key "${key}" missing from the configuration page`).toContain(key);
    }
  });

  test('local-only audit semantics + typed remote error are stated (G7c / I6)', () => {
    const html = decodeHtml(readDist('docs/mcp-onboarding/index.html'));
    // Local-only crawl semantics stated, with the typed error the remote
    // gateway returns instead of crawling — pointing at the CLI.
    expect(html.toLowerCase()).toContain('local-only');
    expect(html.toLowerCase()).toContain('local-only capability');
    expect(html, 'remote error must point at npx @lumen-seo/cli').toContain(
      `npx ${locked.packages.cli}`,
    );
    // BA-7: the Worker is deployable-but-not-deployed; stdio is primary.
    expect(html).toContain('not deployed by default');
  });

  test('config + history + threshold tokens appear in the docs', () => {
    const union = [
      readDist('docs/configuration/index.html'),
      readDist('docs/cli-reference/index.html'),
      readDist('docs/quickstart/index.html'),
    ].join('\n');
    for (const token of [locked.configFile, 'failThreshold', locked.historyDir, ...locked.cliFlags]) {
      expect(union, `token "${token}" missing from docs`).toContain(token);
    }
  });
});
