/**
 * Deterministic provider fixtures, testkit layer 1 (B17/I9/I10): implement the
 * core SPI with ZERO harness imports (no MCP SDK, no Node built-ins) so both
 * the node test suite and the WORKER bundle can use them. Parameterizable
 * (hit/fail positions, error injection), fully deterministic: identical inputs
 * give identical outputs.
 */
import type {
  AuthoritySignal,
  CruxRecord,
  KeywordIdea,
  PageSpeedReport,
  SerpResult,
} from '@lumen-seo/core';
import { mkSource } from '@lumen-seo/core';

export const FIXED_CLOCK = (): string => '2026-08-29T12:00:00Z';

export interface SerpFixtureOptions {
  hitDomain?: string;
  position?: number;
  fail?: boolean;
}

export const fixtureSerpProvider = (o: SerpFixtureOptions = {}) => ({
  name: 'fixture-serp',
  search: async (q: string, opts: { limit?: number } = {}): Promise<SerpResult[]> => {
    if (o.fail === true) throw Object.assign(new Error(`fixture serp failure for "${q}"`), { name: 'RetryExhaustedError', label: 'fixture-serp' });
    const n = opts.limit ?? 20;
    const results: SerpResult[] = Array.from({ length: n }, (_, i) => ({
      position: i + 1,
      url: `https://other${i}.example/r`,
      title: `Result ${i + 1}`,
    }));
    if (o.hitDomain !== undefined && o.position !== undefined && o.position !== null && o.position >= 1) {
      const idx = Math.min(o.position, n) - 1;
      results[idx] = { position: idx + 1, url: `https://${o.hitDomain}/hit`, title: 'The hit' };
    }
    return results;
  },
});

const SUFFIXES = ['tutorial', 'examples', 'checker', 'vs alternatives', 'pricing', '2026'];

export const fixtureKeywordProvider = (name = 'fixture-suggest', o: { fail?: boolean } = {}) => ({
  name,
  ideas: async (seed: string, opts: { limit?: number } = {}): Promise<KeywordIdea[]> => {
    if (o.fail === true) throw Object.assign(new Error('fixture keywords failure'), { name: 'RetryExhaustedError', label: name });
    const n = opts.limit ?? 20;
    return SUFFIXES.slice(0, Math.min(SUFFIXES.length, n)).map((suffix, i) => ({
      term: `${seed} ${suffix}`,
      source: mkSource(name, 'community', `${name} suggestions, CC-BY`),
      estimateLabel: i % 2 === 0 ? 'rough estimate' : 'modeled estimate',
    }));
  },
});

export const fixtureAuthorityProvider = (name = 'fixture-tranco', value = 42, o: { fail?: boolean } = {}) => ({
  name,
  authority: async (domain: string): Promise<AuthoritySignal[]> => {
    if (o.fail === true) throw Object.assign(new Error('fixture authority failure'), { name: 'RetryExhaustedError', label: name });
    return [{ domain, kind: 'rank' as const, value, provider: name, attribution: `${name} list, CC BY 4.0` }];
  },
});

export const fixturePageSpeedProvider = (o: { fail?: boolean } = {}) => ({
  name: 'fixture-psi',
  report: async (): Promise<PageSpeedReport> => {
    if (o.fail === true) throw Object.assign(new Error('quota exceeded'), { name: 'RetryExhaustedError', label: 'fixture-psi' });
    return {
      scores: { performance: 84, seo: 92, accessibility: 96, bestPractices: 100 },
      metrics: { lcp: 2400, cls: 0.11, tbt: 180, fcn: 1600 },
      source: mkSource('fixture-psi', 'lab', 'PageSpeed Insights fixture data'),
    };
  },
});

export const fixtureCruxProvider = (o: { none?: boolean; fail?: boolean } = {}) => ({
  name: 'fixture-crux',
  record: async (): Promise<CruxRecord | null> => {
    if (o.fail === true) throw Object.assign(new Error('key invalid'), { name: 'RetryExhaustedError', label: 'fixture-crux' });
    if (o.none === true) return null;
    return {
      metrics: {
        lcp: {
          p75: 2800,
          histogramBins: [
            { start: 0, end: 2500, density: 0.41 },
            { start: 2500, density: 0.59 },
          ],
        },
      },
      source: mkSource('fixture-crux', 'field', 'CrUX data is CC BY 4.0'),
    };
  },
});
