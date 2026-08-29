import { describe, expect, it } from 'vitest';
import type { CruxRecord, PageSpeedReport } from '@lumen-seo/core';
import { LumenError, mkSource } from '@lumen-seo/core';
import { execute as report } from './cmd/report.js';
import type { CommandDeps } from './composition/node.js';
import { MemoryIo } from './io.js';
import { run } from './run.js';
import type { CliContext } from './run.js';

const AT = '2026-08-29T09:30:00Z';

const fixturePageSpeed = (o: { fail?: boolean } = {}): PageSpeedProviderLike => ({
  name: 'fixture-psi',
  report: async (): Promise<PageSpeedReport> => {
    if (o.fail) throw new LumenError('quota exceeded', 'fixture-psi');
    return {
      scores: { performance: 84, seo: 92, accessibility: 96, bestPractices: 100 },
      metrics: { lcp: 2400, cls: 0.11, tbt: 180, fcn: 1600 },
      source: mkSource('fixture-psi', 'lab', 'PSI fixture data'),
    };
  },
});
type PageSpeedProviderLike = { name: string; report: (u: URL, o?: { strategy?: 'mobile' | 'desktop' }) => Promise<PageSpeedReport> };

const fixtureCrux = (o: { null?: boolean; fail?: boolean } = {}) => ({
  name: 'fixture-crux',
  record: async (): Promise<CruxRecord | null> => {
    if (o.fail) throw new LumenError('key invalid', 'fixture-crux');
    if (o.null) return null;
    return {
      metrics: { lcp: { p75: 2800, histogramBins: [{ start: 0, end: 2500, density: 0.4 }, { start: 2500, density: 0.6 }] } },
      source: mkSource('fixture-crux', 'field', 'CrUX data is CC BY 4.0'),
    };
  },
});

const fixtureMeta = () => ({
  fetch: async (u: URL) => ({
    url: u.href,
    title: 'Fixture <title>',
    description: 'desc',
    canonical: u.href,
    lang: 'en',
    h1: ['Main H1'],
  }),
});

const ctx = (
  args: string[],
  flags: Record<string, string | boolean> = {},
): CliContext & { io: MemoryIo } => {
  const io = new MemoryIo();
  return { io, signal: new AbortController().signal, positionals: args, flags };
};

const depsWith = (over: Partial<CommandDeps> = {}): CommandDeps => ({
  clock: () => AT,
  failThreshold: 'error',
  keywords: [],
  authority: [],
  authorityUnconfigured: [],
  history: { append: async () => undefined, list: async () => [] },
  pageMeta: fixtureMeta(),
  ...over,
});

describe('report command (I1/I3/E8)', () => {
  it('full report: lab + field + meta with provenance and attribution', async () => {
    const c = ctx(['https://example.com'], { json: true });
    expect(await report(c, depsWith({ pageSpeed: fixturePageSpeed(), crux: fixtureCrux() }))).toBe(0);
    const doc = JSON.parse(c.io.stdout.join('')) as {
      url: string;
      strategy: string;
      lab: PageSpeedReport & { retrievedAt: string };
      field: CruxRecord;
      meta: { title: string; h1: string[]; retrievedAt: string };
      attribution: { provider: string; attribution: string }[];
    };
    expect(doc.url).toBe('https://example.com/');
    expect(doc.strategy).toBe('mobile'); // default
    expect(doc.lab.scores.performance).toBe(84);
    expect(doc.lab.retrievedAt).toBe(AT);
    expect(doc.field.metrics.lcp?.p75).toBe(2800);
    expect(doc.meta.h1).toEqual(['Main H1']);
    expect(doc.attribution).toEqual([
      { provider: 'fixture-psi', attribution: 'PSI fixture data' },
      { provider: 'fixture-crux', attribution: 'CrUX data is CC BY 4.0' },
    ]);
  });

  it('BYOK-absent providers degrade to unavailable with a reason; exit stays 0 (I1/I3)', async () => {
    const c = ctx(['https://example.com'], { json: true });
    const code = await report(
      c,
      depsWith({
        pageSpeed: undefined,
        pagespeedUnconfigured: 'provider "fixture-psi" selected for pagespeed is unconfigured (BYOK env var not set)',
        crux: undefined,
        cruxUnconfigured: 'provider "fixture-crux" selected for crux is unconfigured (BYOK env var not set)',
      }),
    );
    expect(code).toBe(0);
    const doc = JSON.parse(c.io.stdout.join('')) as {
      lab: { status: string; reason: string };
      field: { status: string; reason: string };
      meta: { title: string };
    };
    expect(doc.lab.status).toBe('unavailable');
    expect(doc.lab.reason).toContain('BYOK env var not set');
    expect(doc.field.status).toBe('unavailable');
    expect(doc.meta.title).toBe('Fixture <title>'); // meta still served locally
  });

  it('crux null (no coverage) is an honest unavailable, not zero-filled', async () => {
    const c = ctx(['https://example.com'], { json: true });
    await report(c, depsWith({ pageSpeed: fixturePageSpeed(), crux: fixtureCrux({ null: true }) }));
    const doc = JSON.parse(c.io.stdout.join('')) as { field: { status: string; reason: string } };
    expect(doc.field.status).toBe('unavailable');
    expect(doc.field.reason).toContain('insufficient coverage');
  });

  it('failing providers degrade per-field with the provider name (I17)', async () => {
    const c = ctx(['https://example.com'], { json: true });
    const code = await report(
      c,
      depsWith({ pageSpeed: fixturePageSpeed({ fail: true }), crux: fixtureCrux({ fail: true }) }),
    );
    expect(code).toBe(0);
    const doc = JSON.parse(c.io.stdout.join('')) as {
      lab: { reason: string };
      field: { reason: string };
    };
    expect(doc.lab.reason).toContain('fixture-psi');
    expect(doc.field.reason).toContain('fixture-crux');
  });

  it('desktop strategy is plumbed; bad strategy/urls are usage errors (exit 2)', async () => {
    const spy = { strategy: undefined as string | undefined };
    const ps = {
      name: 'fixture-psi',
      report: async (_u: URL, o?: { strategy?: 'mobile' | 'desktop' }): Promise<PageSpeedReport> => {
        spy.strategy = o?.strategy;
        return { scores: { performance: 1, seo: 1, accessibility: 1, bestPractices: 1 }, metrics: { lcp: 1, cls: 1, tbt: 1, fcn: 1 }, source: mkSource('fixture-psi', 'lab') };
      },
    };
    await report(ctx(['https://example.com'], { strategy: 'desktop', json: true }), depsWith({ pageSpeed: ps }));
    expect(spy.strategy).toBe('desktop');
    const io = new MemoryIo();
    expect(await run(['report', 'https://example.com', '--strategy', 'tablet'], io, depsWith({ pageSpeed: ps }))).toBe(2);
    expect(await run(['report', 'https://192.168.1.1/'], new MemoryIo(), depsWith())).toBe(2); // SSRF guard (I12)
    expect(await run(['report', 'http://[::1]/'], new MemoryIo(), depsWith())).toBe(2);
  });

  it('human mode renders unavailable legs and never zero-fills', async () => {
    const c = ctx(['https://example.com'], {});
    await report(c, depsWith({ pageSpeed: undefined }));
    const text = c.io.stdout.join('');
    expect(text).toContain('unavailable');
    expect(text).not.toMatch(/performance null/);
  });
});
