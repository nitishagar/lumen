/**
 * Corpus loader tests (Stage 1): loud admission for the locked adversary
 * registry (sizes, ids, tools, faults, secret-free args, id filter).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCorpus, selectCases } from './corpus.js';

const CORPUS = new URL('../evals/data/adversaries.json', import.meta.url);

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

const writeCorpus = async (value: unknown): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'lumen-corpus-'));
  dirs.push(dir);
  const file = join(dir, 'adversaries.json');
  await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  return file;
};

const validEntry = () => ({
  id: 'probe-one',
  tool: 'lumen_authority',
  args: { domain: 'example.com' },
  providerFaults: [],
  expect: { isError: false },
});

describe('corpus admission', () => {
  it('loads the committed corpus with unique ids', () => {
    const cases = loadCorpus(CORPUS);
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('rejects secret-bearing arg URLs (corpus must be secret-free)', async () => {
    const file = await writeCorpus([
      { ...validEntry(), args: { domain: 'example.com', url: 'https://x.example/?key=ABC' } },
    ]);
    expect(() => loadCorpus(file)).toThrow(/secret-free/);
  });

  it('rejects unknown tools listing the valid five', async () => {
    const file = await writeCorpus([{ ...validEntry(), tool: 'lumen_hack' }]);
    expect(() => loadCorpus(file)).toThrow(/Valid: lumen_audit_site/);
  });

  it('rejects unknown faults and bad ids and duplicates', async () => {
    const badFault = await writeCorpus([
      { ...validEntry(), providerFaults: [{ capability: 'serp', fault: 'nuke' }] },
    ]);
    expect(() => loadCorpus(badFault)).toThrow(/Valid: rate-limited-429/);
    const badId = await writeCorpus([{ ...validEntry(), id: 'Bad_ID!' }]);
    expect(() => loadCorpus(badId)).toThrow(/must match/);
    const dupes = await writeCorpus([validEntry(), validEntry()]);
    expect(() => loadCorpus(dupes)).toThrow(/duplicate adversary id/);
  });

  it('rejects malformed fault specs at load, before any case executes', async () => {
    const latency = await writeCorpus([
      { ...validEntry(), providerFaults: [{ capability: 'serp', fault: 'timeout', latencyMs: 900 }] },
    ]);
    expect(() => loadCorpus(latency)).toThrow(/latencyMs must be an integer 0..250/);
    const index = await writeCorpus([
      { ...validEntry(), providerFaults: [{ capability: 'serp', fault: 'timeout', providerIndex: 1 }] },
    ]);
    expect(() => loadCorpus(index)).toThrow(/providerIndex is only meaningful for keyword\/authority/);
    const slot = await writeCorpus([
      {
        ...validEntry(),
        providerFaults: [
          { capability: 'serp', fault: 'timeout' },
          { capability: 'serp', fault: 'throw' },
        ],
      },
    ]);
    expect(() => loadCorpus(slot)).toThrow(/duplicate fault for provider slot serp\[0\]/);
  });

  it('rejects non-array roots and invalid JSON', async () => {
    const obj = await writeCorpus({ id: 'x' });
    expect(() => loadCorpus(obj)).toThrow(/root must be an array/);
    const bad = await writeCorpus('{nope');
    expect(() => loadCorpus(bad)).toThrow(/not valid JSON/);
  });
});

describe('SWARM_ONLY selection', () => {
  it('filters by id and fails unknown ids with the valid list', () => {
    const cases = loadCorpus(CORPUS);
    const one = selectCases(cases, cases[0]?.id ?? '');
    expect(one).toHaveLength(1);
    expect(() => selectCases(cases, 'no-such-adversary')).toThrow(/valid:/);
  });
});
