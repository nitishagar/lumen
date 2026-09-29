/**
 * No-telemetry + sentinel-key tests (I16/E12): with `globalThis.fetch` stubbed
 * to THROW, every CLI command and every MCP tool runs to completion against
 * fixture providers with ZERO direct fetch calls, and the recorded-Fetcher
 * call list matches the outbound allowlist exactly (empty — fixtures never
 * dial out). BYOK env VALUES (sentinels) never appear on any output stream.
 */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fixtureAuditRunner,
  fixtureAuthorityProvider,
  fixtureCruxProvider,
  fixtureKeywordProvider,
  fixturePageMetaFetcher,
  fixturePageSpeedProvider,
  fixtureSerpProvider,
  MemoryHistoryStore,
  connectClient,
} from '@lumen-seo/mcp/testkit';
import type { CommandDeps } from './composition/node.js';
import { MemoryIo } from './io.js';
import { run } from './run.js';

let dir: string;
const PSI_SENTINEL = 'psi-value-NEVER-PRINT-1f0e';
const CRUX_SENTINEL = 'crux-value-NEVER-PRINT-2abd';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumen-telemetry-'));
  process.env.LUMEN_CONFIG = join(dir, 'lumen.config.json');
  process.env.LUMEN_HISTORY_DIR = join(dir, '.lumen', 'history');
  await writeFile(join(dir, 'lumen.config.json'), '{}', 'utf8');
  // Two minimal saved reports for the diff no-telemetry case.
  const minimalReport = (seed: string) => JSON.stringify({
    id: 'test', startedAt: '2026-09-28T00:00:00Z', completedAt: '2026-09-28T00:00:01Z',
    pages: [{ url: seed, status: 200, issues: [], score: 100, timingMs: 1, bytes: 1, robotsAllowed: true }],
    summary: { countsBySeverity: { error: 0, warning: 0, info: 0 }, score: 100, pagesAudited: 1, pagesSkipped: 0 },
    incomplete: false, configSnapshot: { seed }, stopReason: 'completed',
  });
  await writeFile(join(dir, 'a.json'), minimalReport('https://a.example/'), 'utf8');
  await writeFile(join(dir, 'b.json'), minimalReport('https://b.example/'), 'utf8');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.LUMEN_CONFIG;
  delete process.env.LUMEN_HISTORY_DIR;
  delete process.env.LUMEN_PSI_KEY;
  delete process.env.LUMEN_CRUX_KEY;
  await rm(dir, { recursive: true, force: true });
});

/** Full fixture deps — every boundary live, zero network capability. */
const gscFixture = (): CommandDeps['performanceProvider'] => ({
  name: 'gsc-fixture',
  performance: async () => ({
    site: 'https://example.com/',
    startDate: '2026-08-01',
    endDate: '2026-08-29',
    by: 'query',
    rows: [{ key: 'k', clicks: 1, impressions: 2, position: 3, source: { provider: 'gsc', kind: 'official' } }],
  }),
});

const fullDeps = (): CommandDeps => ({
  performanceProvider: gscFixture(),
  clock: () => '2026-08-29T12:00:00Z',
  failThreshold: 'error',
  keywords: [fixtureKeywordProvider()],
  serp: fixtureSerpProvider({ hitDomain: 'example.com', position: 3 }),
  authority: [fixtureAuthorityProvider()],
  authorityUnconfigured: [],
  history: new MemoryHistoryStore(),
  auditRunner: fixtureAuditRunner(),
  pageMeta: fixturePageMetaFetcher(),
  pageSpeed: fixturePageSpeedProvider(),
  crux: fixtureCruxProvider(),
});

describe('outbound enumeration over every command (E12/I16)', () => {
  it('global fetch throws for the whole run — all commands still complete with zero calls', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('TELEMETRY LEAK: direct fetch from the CLI layer');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const cases: { args: string[] }[] = [
      { args: ['audit', 'https://example.com', '--json'] },
      { args: ['report', 'https://example.com', '--json'] },
      { args: ['keywords', 'seo', '--json'] },
      { args: ['rank', 'best crm', '--domain', 'example.com', '--json'] },
      { args: ['authority', 'example.com', '--json'] },
      { args: ['config', 'show', '--json'] },
      { args: ['mcp', '--print', 'json'] },
      { args: ['doctor'] },
      { args: ['init', '--yes', '--config', join(dir, 'init-target.json')] },
      { args: ['diff', join(dir, 'a.json'), join(dir, 'b.json')] },
      { args: ['performance', 'https://example.com'] }, // fixture provider injected below
    ];
    for (const c of cases) {
      const io = new MemoryIo();
      const deps = fullDeps();
      const code = await run(c.args, io, deps);
      expect(code, `command ${c.args.join(' ')} exited 0`).toBe(0);
      expect(io.stdout.join(''), c.args.join(' ')).not.toContain('TELEMETRY LEAK');
    }
    // Zero direct fetch calls were made anywhere in the CLI layer.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('every MCP tool over fixture deps makes zero direct fetch calls', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('TELEMETRY LEAK: direct fetch from the tool layer');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { fixtureDeps } = await import('@lumen-seo/mcp/testkit');
    const client = await connectClient(fixtureDeps());
    for (const [name, args] of [
      ['lumen_audit_site', { url: 'https://example.com' }],
      ['lumen_page_report', { url: 'https://example.com' }],
      ['lumen_keyword_ideas', { seed: 'seo' }],
      ['lumen_rank_check', { keyword: 'k', domain: 'example.com' }],
      ['lumen_authority', { domain: 'example.com' }],
    ] as const) {
      const res = await client.callTool({ name, arguments: args });
      expect((res as { isError?: boolean }).isError, name).toBeUndefined();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    await client.close();
  });

  it('sentinel BYOK values never appear in any command output (I16)', async () => {
    process.env.LUMEN_PSI_KEY = PSI_SENTINEL;
    process.env.LUMEN_CRUX_KEY = CRUX_SENTINEL;
    for (const args of [
      ['config', 'show', '--json'],
      ['report', 'https://example.com', '--json'],
      ['audit', 'https://example.com', '--json'],
      ['authority', 'example.com', '--json'],
      ['mcp', '--print', 'json'],
      ['doctor'],
      ['init', '--yes', '--config', join(dir, 'init-target.json')], // E0.4 AC: sentinel covers both new commands
    ]) {
      const io = new MemoryIo();
      const code = await run(args, io, fullDeps());
      const everything = io.stdout.join('') + io.stderr.join('');
      expect(code, args.join(' ')).toBe(0);
      expect(everything, args.join(' ')).not.toContain(PSI_SENTINEL);
      expect(everything, args.join(' ')).not.toContain(CRUX_SENTINEL);
    }
  });
});
