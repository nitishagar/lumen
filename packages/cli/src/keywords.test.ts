import { describe, expect, it } from 'vitest';
import type { KeywordIdea } from '@lumen-seo/core';
import { LumenError, mkSource } from '@lumen-seo/core';
import { execute as authority } from './cmd/authority.js';
import { execute as keywords } from './cmd/keywords.js';
import type { CommandDeps } from './composition/node.js';
import { JsonlHistoryStore } from './history/jsonl-store.js';
import { MemoryIo } from './io.js';
import { run } from './run.js';
import type { CliContext } from './run.js';

const AT = '2026-08-29T12:00:00Z';

const idea = (term: string, provider: string, attribution?: string): KeywordIdea => ({
  term,
  source: mkSource(provider, 'community', attribution),
  estimateLabel: 'rough estimate',
});

const fixtureKeywords = (name: string, terms: string[], opts: { fail?: boolean } = {}) => ({
  name,
  ideas: async (): Promise<KeywordIdea[]> => {
    if (opts.fail) throw new LumenError('upstream gone', name);
    return terms.map((t) => idea(t, name, `${name} data is CC-BY`));
  },
});

const ctx = (
  args: string[],
  flags: Record<string, string | boolean> = {},
): CliContext & { io: MemoryIo } => {
  const io = new MemoryIo();
  return { io, signal: new AbortController().signal, positionals: args, flags };
};

const baseDeps = (over: Partial<CommandDeps> = {}): CommandDeps => ({
  clock: () => AT,
  failThreshold: 'error',
  keywords: [],
  authority: [],
  authorityUnconfigured: [],
  history: new JsonlHistoryStore('/nonexistent-lumen-test'),
  ...over,
});

describe('keywords command (I3/I10/I17)', () => {
  it('returns ideas with per-item provenance and attribution collection', async () => {
    const c = ctx(['best cms'], { json: true });
    const code = await keywords(
      c,
      baseDeps({ keywords: [fixtureKeywords('fixture-suggest', ['best cms', 'best cms 2026'])] }),
    );
    expect(code).toBe(0);
    const doc = JSON.parse(c.io.stdout.join('')) as {
      seed: string;
      ideas: KeywordIdea[];
      attribution: { provider: string; attribution: string }[];
    };
    expect(doc.seed).toBe('best cms');
    expect(doc.ideas).toHaveLength(2);
    expect(doc.ideas[0]).toMatchObject({
      term: 'best cms',
      source: { provider: 'fixture-suggest', kind: 'community' },
      estimateLabel: 'rough estimate',
    });
    expect(doc.attribution).toEqual([
      { provider: 'fixture-suggest', attribution: 'fixture-suggest data is CC-BY' },
    ]);
  });

  it('interleaves multiple providers deterministically and caps at --limit', async () => {
    const c = ctx(['seed'], { json: true, limit: '3' });
    await keywords(
      c,
      baseDeps({
        keywords: [
          fixtureKeywords('a-suggest', ['a1', 'a2', 'a3', 'a4']),
          fixtureKeywords('b-wiki', ['b1', 'b2']),
        ],
      }),
    );
    const doc = JSON.parse(c.io.stdout.join('')) as { ideas: { term: string }[] };
    expect(doc.ideas.map((i) => i.term)).toEqual(['a1', 'b1', 'a2']); // round-robin, cap 3
  });

  it('a failing provider degrades to unavailable; the command still exits 0', async () => {
    const c = ctx(['seed'], { json: true });
    const code = await keywords(
      c,
      baseDeps({
        keywords: [fixtureKeywords('good', ['g1']), fixtureKeywords('bad', ['x'], { fail: true })],
      }),
    );
    expect(code).toBe(0);
    const doc = JSON.parse(c.io.stdout.join('')) as {
      ideas: { term: string }[];
      unavailable: { provider: string; reason: string }[];
    };
    expect(doc.ideas.map((i) => i.term)).toEqual(['g1']);
    expect(doc.unavailable).toEqual([{ provider: 'bad', reason: 'upstream gone' }]);
  });

  it('all providers failing exits 2 naming the providers', async () => {
    const io = new MemoryIo();
    const code = await run(
      ['keywords', 'seed'],
      io,
      baseDeps({ keywords: [fixtureKeywords('bad', ['x'], { fail: true })] }),
    );
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('bad');
  });

  it('no provider configured exits 2 with an actionable message', async () => {
    const io = new MemoryIo();
    const code = await run(['keywords', 'seed'], io, baseDeps());
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('no keywords provider configured');
  });

  it('validates seed and limit (I15)', async () => {
    await expect(keywords(ctx(['']), baseDeps({ keywords: [fixtureKeywords('p', ['x'])] }))).rejects.toThrow(
      /seed must not be empty/,
    );
    await expect(
      keywords(ctx(['x'.repeat(121)], {}), baseDeps({ keywords: [fixtureKeywords('p', ['x'])] })),
    ).rejects.toThrow(/120/);
    await expect(
      keywords(ctx(['s'], { limit: '0' }), baseDeps({ keywords: [fixtureKeywords('p', ['x'])] })),
    ).rejects.toThrow(/between 1 and 50/);
  });
});

describe('authority command (I1/I3/I8)', () => {
  const fixtureAuthority = (name: string, value: number, opts: { fail?: boolean } = {}) => ({
    name,
    authority: async (domain: string) => {
      if (opts.fail) throw new LumenError('no key', name);
      return [{ domain, kind: 'rank' as const, value, provider: name, attribution: `${name} list, CC BY` }];
    },
  });

  it('returns signals with attribution + retrievedAt', async () => {
    const c = ctx(['example.com'], { json: true });
    const code = await authority(c, baseDeps({ authority: [fixtureAuthority('fixture-tranco', 42)] }));
    expect(code).toBe(0);
    const doc = JSON.parse(c.io.stdout.join('')) as {
      domain: string;
      signals: { provider: string; kind: string; value: number; attribution: string; retrievedAt: string }[];
    };
    expect(doc.domain).toBe('example.com');
    expect(doc.signals).toEqual([
      {
        provider: 'fixture-tranco',
        kind: 'rank',
        value: 42,
        attribution: 'fixture-tranco list, CC BY',
        retrievedAt: AT,
      },
    ]);
  });

  it('BYOK-missing providers are listed as unconfigured, never invoked (I1)', async () => {
    const c = ctx(['example.com'], { json: true });
    const code = await authority(c, baseDeps({ authorityUnconfigured: ['fixture-opr'] }));
    expect(code).toBe(0);
    const doc = JSON.parse(c.io.stdout.join('')) as { signals: unknown[]; unconfigured: string[] };
    expect(doc.signals).toEqual([]);
    expect(doc.unconfigured).toEqual(['fixture-opr']);
  });

  it('composition BYOK rule: configured-but-unset env name means skip (I1)', async () => {
    const { byokReady } = await import('./composition/node.js');
    const { DEFAULT_CONFIG } = await import('@lumen-seo/core');
    const config = { ...DEFAULT_CONFIG, byok: { 'fixture-opr': 'LUMEN_OPR_KEY' } };
    const had = process.env.LUMEN_OPR_KEY;
    delete process.env.LUMEN_OPR_KEY;
    expect(byokReady(config, 'fixture-opr')).toBe(false); // skip + mark unconfigured
    expect(byokReady(config, 'other')).toBe(true); // no declared key requirement
    process.env.LUMEN_OPR_KEY = 'x';
    expect(byokReady(config, 'fixture-opr')).toBe(true);
    if (had === undefined) delete process.env.LUMEN_OPR_KEY;
    else process.env.LUMEN_OPR_KEY = had;
  });

  it('all-configured-but-unconfigured providers is still an honest exit-0 answer', async () => {
    const c = ctx(['example.com'], { json: true });
    const code = await authority(c, baseDeps({ authorityUnconfigured: ['fixture-opr'] }));
    expect(code).toBe(0);
    expect(JSON.parse(c.io.stdout.join('')).unconfigured).toEqual(['fixture-opr']);
  });

  it('no provider configured exits 2', async () => {
    const io = new MemoryIo();
    const code = await run(['authority', 'example.com'], io, baseDeps());
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('no authority provider configured');
  });

  it('failing providers degrade to unavailable; IDN domains are normalized', async () => {
    const c = ctx(['münchen.de'], { json: true });
    const code = await authority(
      c,
      baseDeps({
        authority: [fixtureAuthority('fixture-tranco', 1), fixtureAuthority('fixture-opr', 9, { fail: true })],
      }),
    );
    expect(code).toBe(0);
    const doc = JSON.parse(c.io.stdout.join('')) as {
      domain: string;
      signals: unknown[];
      unavailable: { provider: string }[];
    };
    expect(doc.domain).toBe('xn--mnchen-3ya.de');
    expect(doc.signals).toHaveLength(1);
    expect(doc.unavailable).toEqual([{ provider: 'fixture-opr', reason: 'no key' }]);
  });
});
