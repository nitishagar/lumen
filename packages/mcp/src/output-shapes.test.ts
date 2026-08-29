/**
 * Output-shape contract tests (E8/I3): concise shapes are locked and minimal;
 * detailed adds full provenance/results. Every metric carries provenance
 * (source{provider,kind}, retrievedAt) and attribution arrays wherever
 * CrUX/Tranco/OPR-derived data is displayed (I8).
 */
import { describe, expect, it } from 'vitest';
import { connectClient, FIXED_CLOCK, fixtureDeps, parseToolJson } from './testkit/index.js';

describe('concise vs detailed shapes (E8)', () => {
  it('audit_site concise: locked minimal shape, pass/fail per threshold (E1 parity)', async () => {
    const client = await connectClient(fixtureDeps());
    const res = await client.callTool({
      name: 'lumen_audit_site',
      arguments: { url: 'https://example.com' },
    });
    expect(res.isError).toBeUndefined();
    const payload = parseToolJson<Record<string, unknown>>(res as never);
    expect(Object.keys(payload).sort()).toEqual(
      ['countsBySeverity', 'failThreshold', 'incomplete', 'pages', 'passesThreshold', 'score', 'topIssues', 'url'].sort(),
    );
    expect(payload.url).toBe('https://example.com/');
    expect(payload.passesThreshold).toBe(true); // fixture audit has zero issues
    expect(payload.incomplete).toBe(false);
    expect(payload.failThreshold).toBe('error');
    await client.close();
  });

  it('audit_site detailed adds per-page issues and report provenance', async () => {
    const deps = fixtureDeps({
      unconfigured: [],
    });
    const client = await connectClient(deps);
    const res = await client.callTool({
      name: 'lumen_audit_site',
      arguments: { url: 'https://example.com', response_format: 'detailed' },
    });
    const payload = parseToolJson<Record<string, unknown> & { pages: unknown[] }>(res as never);
    expect(payload.stopReason).toBeDefined();
    expect(payload.startedAt).toBeDefined();
    expect(payload.completedAt).toBeDefined();
    expect(Array.isArray(payload.pages)).toBe(true);
    expect((payload.pages as { issues: unknown[] }[])[0]?.issues).toBeDefined();
    await client.close();
  });

  it('audit_site: issues at/above threshold flip passesThreshold to false (E1 gate parity)', async () => {
    const { fixtureAuditRunner } = await import('./testkit/index.js');
    const issue = {
      ruleId: 'rule/dup-title',
      severity: 'error' as const,
      message: 'duplicate title',
      evidence: {},
    };
    const client = await connectClient({ ...fixtureDeps(), auditRunner: fixtureAuditRunner({ issues: [issue] }) });
    const res = await client.callTool({
      name: 'lumen_audit_site',
      arguments: { url: 'https://example.com' },
    });
    const payload = parseToolJson<{
      countsBySeverity: Record<string, number>;
      topIssues: { ruleId: string; severity: string; message: string }[];
      passesThreshold: boolean;
    }>(res as never);
    expect(payload.countsBySeverity).toMatchObject({ error: 1, warning: 0, info: 0 });
    expect(payload.topIssues[0]).toMatchObject({ ruleId: 'rule/dup-title', severity: 'error' });
    expect(payload.topIssues.length).toBeLessThanOrEqual(10); // E8: topIssues[≤10]
    expect(payload.passesThreshold).toBe(false);
    await client.close();
  });

  it('page_report concise: lab+field with provenance, p75-only CrUX metrics, attribution (I3/I8)', async () => {
    const client = await connectClient(fixtureDeps());
    const res = await client.callTool({
      name: 'lumen_page_report',
      arguments: { url: 'https://example.com' },
    });
    expect(res.isError).toBeUndefined();
    const payload = parseToolJson<{
      url: string;
      lab: { scores: unknown; source: { provider: string; kind: string }; retrievedAt: string };
      field: { source: { provider: string; attribution: string }; metrics: Record<string, unknown> };
      attribution: { provider: string; attribution: string }[];
      limitations: string[];
    }>(res as never);
    expect(payload.url).toBe('https://example.com/');
    expect(payload.lab.source).toMatchObject({ provider: 'fixture-psi', kind: 'lab' });
    expect(payload.lab.retrievedAt).toBe(FIXED_CLOCK());
    expect(payload.field.source).toMatchObject({ provider: 'fixture-crux' });
    expect(payload.field.source.attribution).toContain('CC BY 4.0'); // I8 CrUX attribution
    for (const metric of Object.values(payload.field.metrics)) {
      expect(Object.keys(metric as object)).toEqual(['p75']); // concise drops histogram bins
    }
    expect(payload.attribution.some((a) => a.provider === 'fixture-crux')).toBe(true);
    expect(payload.limitations.length).toBeGreaterThan(0);
    await client.close();
  });

  it('page_report degrades per leg: failed provider becomes unavailable, never zero (I3)', async () => {
    const { fixtureCruxProvider, fixturePageSpeedProvider } = await import('./testkit/index.js');
    const deps = {
      ...fixtureDeps(),
      pageSpeed: fixturePageSpeedProvider({ fail: true }),
      crux: fixtureCruxProvider({ fail: true }),
    };
    const client = await connectClient(deps);
    const res = await client.callTool({
      name: 'lumen_page_report',
      arguments: { url: 'https://example.com' },
    });
    expect(res.isError).toBeUndefined(); // legs degrade; the answer stays answerable
    const payload = parseToolJson<{ lab: { status: string }; field: { status: string } }>(res as never);
    expect(payload.lab.status).toBe('unavailable');
    expect(payload.lab).toHaveProperty('reason');
    expect(payload.field.status).toBe('unavailable');
    await client.close();
  });

  it('keyword_ideas: per-idea source + estimateLabel, attribution array (E8/I3)', async () => {
    const client = await connectClient(fixtureDeps());
    const res = await client.callTool({
      name: 'lumen_keyword_ideas',
      arguments: { seed: 'seo tool' },
    });
    const payload = parseToolJson<{
      seed: string;
      ideas: { term: string; source: { provider: string; kind: string }; estimateLabel: string }[];
      attribution: { provider: string; attribution: string }[];
    }>(res as never);
    expect(payload.seed).toBe('seo tool');
    expect(payload.ideas.length).toBeGreaterThan(0);
    for (const idea of payload.ideas) {
      expect(idea.source).toMatchObject({ provider: 'fixture-suggest' });
      expect(typeof idea.estimateLabel).toBe('string');
      expect(idea.term.startsWith('seo tool')).toBe(true);
    }
    expect(payload.attribution[0]?.provider).toBe('fixture-suggest');
    await client.close();
  });

  it('keyword_ideas: all providers failing → UPSTREAM_FAILED with provider names (I17)', async () => {
    const { fixtureKeywordProvider } = await import('./testkit/index.js');
    const deps = { ...fixtureDeps(), keyword: [fixtureKeywordProvider('fixture-suggest', { fail: true })] };
    const client = await connectClient(deps);
    const res = await client.callTool({ name: 'lumen_keyword_ideas', arguments: { seed: 'seo' } });
    expect(res.isError).toBe(true);
    const payload = parseToolJson<{ code: string; message: string }>(res as never);
    expect(payload.code).toBe('UPSTREAM_FAILED');
    expect(payload.message).toContain('fixture-suggest');
    await client.close();
  });

  it('rank_check concise: locked shape; not-found is found:false success (B11)', async () => {
    const client = await connectClient(fixtureDeps()); // fixture hits example.com at position 3
    const hit = await client.callTool({
      name: 'lumen_rank_check',
      arguments: { keyword: 'best crm', domain: 'example.com' },
    });
    const hitPayload = parseToolJson<Record<string, unknown>>(hit as never);
    expect(Object.keys(hitPayload).sort()).toEqual(
      ['domain', 'found', 'keyword', 'matchedUrl', 'position', 'provider', 'retrievedAt'].sort(),
    );
    expect(hitPayload.found).toBe(true);
    expect(hitPayload.position).toBe(3);
    expect(hitPayload.provider).toBe('fixture-serp');
    expect(hitPayload.retrievedAt).toBe(FIXED_CLOCK());

    const miss = await client.callTool({
      name: 'lumen_rank_check',
      arguments: { keyword: 'best crm', domain: 'neverthere.io' },
    });
    expect(miss.isError).toBeUndefined();
    const missPayload = parseToolJson<{ found: boolean; position: number | null }>(miss as never);
    expect(missPayload.found).toBe(false);
    expect(missPayload.position).toBeNull();
    await client.close();
  });

  it('rank_check detailed adds full SERP results + recent history (E8 detailed)', async () => {
    const client = await connectClient(fixtureDeps());
    await client.callTool({ name: 'lumen_rank_check', arguments: { keyword: 'k', domain: 'example.com' } });
    const res = await client.callTool({
      name: 'lumen_rank_check',
      arguments: { keyword: 'k', domain: 'example.com', response_format: 'detailed' },
    });
    const payload = parseToolJson<{ results: unknown[]; recentHistory?: unknown[] }>(res as never);
    expect(Array.isArray(payload.results)).toBe(true);
    expect(payload.results?.length).toBe(20); // default limit 20
    expect(Array.isArray(payload.recentHistory)).toBe(true);
    await client.close();
  });

  it('rank_check: SERP provider failure → typed error carrying the provider name (I17)', async () => {
    const { fixtureSerpProvider } = await import('./testkit/index.js');
    const deps = { ...fixtureDeps(), serp: fixtureSerpProvider({ fail: true }) };
    const client = await connectClient(deps);
    const res = await client.callTool({
      name: 'lumen_rank_check',
      arguments: { keyword: 'k', domain: 'example.com' },
    });
    expect(res.isError).toBe(true);
    const payload = parseToolJson<{ code: string; provider?: string; message: string }>(res as never);
    expect(payload.provider).toBe('fixture-serp');
    await client.close();
  });

  it('rank_check: invalid domain (port/path smuggled in) → typed INVALID_ARGUMENTS (I15)', async () => {
    const client = await connectClient(fixtureDeps());
    const res = await client.callTool({
      name: 'lumen_rank_check',
      arguments: { keyword: 'k', domain: 'example.com/evil' },
    });
    expect(res.isError).toBe(true);
    const payload = parseToolJson<{ code: string }>(res as never);
    expect(payload.code).toBe('INVALID_ARGUMENTS');
    await client.close();
  });

  it('authority: signals with attribution + retrievedAt, unconfigured listed (E8/I8)', async () => {
    const deps = fixtureDeps({ unconfigured: ['openpagerank'] }); // OPR key absent (I1)
    const client = await connectClient(deps);
    const res = await client.callTool({ name: 'lumen_authority', arguments: { domain: 'example.com' } });
    expect(res.isError).toBeUndefined();
    const payload = parseToolJson<{
      domain: string;
      signals: { provider: string; kind: string; value: number; attribution: string; retrievedAt: string }[];
      unconfigured: string[];
    }>(res as never);
    expect(payload.domain).toBe('example.com');
    expect(payload.signals[0]).toMatchObject({
      provider: 'fixture-tranco',
      kind: 'rank',
      value: 42,
      retrievedAt: FIXED_CLOCK(),
    });
    expect(payload.signals[0]?.attribution).toContain('CC BY 4.0');
    expect(payload.unconfigured).toEqual(['openpagerank']);
    await client.close();
  });
});
