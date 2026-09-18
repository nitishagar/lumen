/**
 * @lumen-seo/mcp/testkit — deterministic fixture providers and harnesses
 * (B17/I9/I10): every surfaces test runs against these, never live network.
 * The pure provider fixtures live in `providers.ts` (no harness imports) so
 * the Worker fixture composition can use them without bundling the MCP SDK;
 * this entry re-exports them alongside the node-only harness pieces.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Fetcher, HistoryEntry, HistoryListQuery, SiteAuditReport } from '@lumen-seo/core';
import { countIssuesBySeverity, isRankEntry } from '@lumen-seo/core';
import type { AuditInput, AuditRunner, PageMeta, PageMetaFetcher } from '../ports.js';
import type { McpDeps } from '../server.js';
import {
  FIXED_CLOCK,
  fixtureAuthorityProvider,
  fixtureCruxProvider,
  fixtureKeywordProvider,
  fixturePageSpeedProvider,
  fixtureSerpProvider,
} from './providers.js';

export {
  FIXED_CLOCK,
  fixtureAuthorityProvider,
  fixtureCruxProvider,
  fixtureKeywordProvider,
  fixturePageSpeedProvider,
  fixtureSerpProvider,
} from './providers.js';

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

/** In-memory HistoryStore recording appends (concurrency tests, E13). Mirrors the JSONL kind semantics: kind omitted means rank. */
export class MemoryHistoryStore {
  readonly entries: HistoryEntry[] = [];
  readonly append = async (e: HistoryEntry): Promise<void> => {
    this.entries.push(e);
  };
  readonly list = async (q?: HistoryListQuery): Promise<HistoryEntry[]> => {
    const kind = q?.kind ?? 'rank';
    let all = [...this.entries];
    if (kind !== 'all') all = all.filter((e) => (kind === 'rank' ? isRankEntry(e) : !isRankEntry(e)));
    if (q?.domain !== undefined) {
      const domain = q.domain;
      all = all.filter((e) =>
        isRankEntry(e) ? e.domain === domain : hostOf(e.url) === domain,
      );
    }
    if (q?.keyword !== undefined) all = all.filter((e) => isRankEntry(e) && e.keyword === q.keyword);
    if (q?.url !== undefined) all = all.filter((e) => e.url === q.url);
    const sorted = kind === 'all' ? [...all].sort((a, b) => (a.retrievedAt < b.retrievedAt ? -1 : 1)) : all;
    return q?.limit === undefined ? sorted : sorted.slice(-q.limit);
  };
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

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
