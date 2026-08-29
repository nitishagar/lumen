/**
 * @lumen-seo/mcp/testkit — deterministic fixture providers and harnesses
 * (B17/I9/I10): every surfaces test runs against these, never live network.
 * Fixtures are parameterizable (hit/fail positions, error injection) and
 * deterministic: identical inputs give identical outputs.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type {
  AuthoritySignal,
  CruxRecord,
  Fetcher,
  KeywordIdea,
  PageSpeedReport,
  SerpResult,
  SiteAuditReport,
} from '@lumen-seo/core';
import { countIssuesBySeverity, mkSource } from '@lumen-seo/core';
import type { AuditInput, AuditRunner, PageMeta, PageMetaFetcher } from '../ports.js';
import type { McpDeps } from '../server.js';

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

export const fixturePageMetaFetcher = (): PageMetaFetcher => ({
  fetch: async (url: URL): Promise<PageMeta> => ({
    url: url.href,
    title: 'Fixture page title',
    description: 'Fixture meta description',
    canonical: url.href,
    lang: 'en',
    h1: ['Fixture H1'],
  }),
});

export interface AuditFixtureOptions {
  issues?: SiteAuditReport['pages'][number]['issues'];
  incomplete?: boolean;
  fail?: boolean;
  seenInputs?: AuditInput[];
}

export const fixtureAuditRunner = (o: AuditFixtureOptions = {}): AuditRunner => ({
  run: async (input: AuditInput): Promise<SiteAuditReport> => {
    if (o.fail === true) {
      throw Object.assign(new Error('fixture audit failure (robots unreachable)'), {
        name: 'LumenRobotsUnreachableError',
        label: 'fixture-audit',
      });
    }
    o.seenInputs?.push(input);
    const issues = o.issues ?? [];
    return {
      id: 'fixture-audit',
      startedAt: '2026-08-29T12:00:00Z',
      completedAt: '2026-08-29T12:00:01Z',
      pages: [
        {
          url: input.url.href,
          status: 200,
          title: 'Fixture page',
          issues,
          score: 88,
          timingMs: 20,
          bytes: 4096,
          robotsAllowed: true,
          depth: 0,
        },
      ],
      summary: { countsBySeverity: countIssuesBySeverity(issues), score: 88, pagesAudited: 1, pagesSkipped: 0 },
      incomplete: o.incomplete === true,
      configSnapshot: {},
      stopReason: o.incomplete === true ? 'time_budget' : 'completed',
    };
  },
});

/** In-memory HistoryStore recording appends (concurrency tests, E13). */
export class MemoryHistoryStore {
  readonly entries: import('@lumen-seo/core').RankHistoryEntry[] = [];
  readonly append = async (e: import('@lumen-seo/core').RankHistoryEntry): Promise<void> => {
    this.entries.push(e);
  };
  readonly list = async (
    q?: import('@lumen-seo/core').HistoryListQuery,
  ): Promise<import('@lumen-seo/core').RankHistoryEntry[]> => {
    let all = [...this.entries];
    if (q?.domain !== undefined) all = all.filter((e) => e.domain === q.domain);
    if (q?.keyword !== undefined) all = all.filter((e) => e.keyword === q.keyword);
    return q?.limit === undefined ? all : all.slice(-q.limit);
  };
}

/** Recording Fetcher (I16): records every outbound call; never delegates. */
export const recordingFetcher = (): Fetcher & { calls: URL[] } => {
  const calls: URL[] = [];
  return {
    calls,
    fetch: async (url: URL): Promise<Response> => {
      calls.push(url);
      throw new Error(`unexpected outbound call in test: ${url.href}`);
    },
  };
};

/** The full-capability fixture composition (all five tools live). */
export const fixtureDeps = (o: { unconfigured?: string[] } = {}): McpDeps => ({
  clock: FIXED_CLOCK,
  keyword: [fixtureKeywordProvider()],
  authority: [fixtureAuthorityProvider()],
  unconfigured: o.unconfigured ?? [],
  serp: fixtureSerpProvider({ hitDomain: 'example.com', position: 3 }),
  pageSpeed: fixturePageSpeedProvider(),
  crux: fixtureCruxProvider(),
  auditRunner: fixtureAuditRunner(),
  pageMeta: fixturePageMetaFetcher(),
  history: new MemoryHistoryStore(),
});

/** The no-deps composition (the Worker's local-only shape). */
export const fixtureRemoteDeps = (o: { unconfigured?: string[] } = {}): McpDeps => ({
  clock: FIXED_CLOCK,
  keyword: [fixtureKeywordProvider()],
  authority: [fixtureAuthorityProvider()],
  unconfigured: o.unconfigured ?? [],
  // no serp, no auditRunner, no pageMeta, no history — LOCAL_ONLY shape
});

/** Connects an in-process Client to a built server (in-process transport). */
export const connectClient = async (deps: McpDeps): Promise<Client> => {
  const { buildMcpServer } = await import('../server.js');
  const server = buildMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
};

export const parseToolJson = <T>(result: { content: { type: string; text?: string }[] }): T =>
  JSON.parse(result.content[0]?.text ?? '{}') as T;
