import { describe, expect, it } from 'vitest';
import type { AuditRule, Issue } from '@lumen-seo/core';
import { DEFAULT_THRESHOLDS } from '../types.js';
import type { RuleContext } from '../types.js';
import { makePage } from '../testing/page.js';
import { canonicalPresent, descriptionLength, descriptionMissing, robotsNoindex, titleLength, titleMissing } from './meta.js';
import { h1Missing, h1Multiple, imageAltCoverage, langAttr } from './content.js';
import { insecureHttp, mixedContent, responseLatency, statusError, viewportMeta } from './technical.js';
import { brokenInternalLink, redirectChain } from './links.js';
import { ogTagsMissing } from './social.js';

const t = DEFAULT_THRESHOLDS;
const ctx: RuleContext = { depth: 0, isSeed: true }; // RuleContext is a structural superset of core's RuleOpts
const run = async (rule: AuditRule, html: string, o?: Parameters<typeof makePage>[1]): Promise<Issue[]> =>
  rule.check(makePage(html, o), ctx);

describe('built-in rules (per-page, table-driven)', () => {
  it('rule title-missing: fires on empty title, silent on present title', async () => {
    const rule = titleMissing('error');
    expect((await run(rule, '<html><head><title></title></head></html>'))).toHaveLength(1);
    expect((await run(rule, '<html><head><title>   </title></head></html>'))).toHaveLength(1);
    expect((await run(rule, '<html><head><title>Real title here</title></head></html>'))).toEqual([]);
    expect((await run(rule, '<html><body></body></html>'))).toHaveLength(1);
  });

  it('rule title-length: silent in range, fires short and long', async () => {
    const rule = titleLength('warning', t);
    expect(await run(rule, '<html><head><title>This title is exactly right</title></head></html>')).toEqual([]); // 32 chars
    expect((await run(rule, '<html><head><title>tiny</title></head></html>'))).toHaveLength(1); // < 15
    const long = 'x'.repeat(66);
    expect(long.length).toBeGreaterThan(65); // fixture sanity
    expect((await run(rule, `<html><head><title>${long}</title></head></html>`))).toHaveLength(1);
  });

  it('rule description-missing: fires on absent/empty, silent on present', async () => {
    const rule = descriptionMissing('error');
    expect((await run(rule, '<html><head></head></html>'))).toHaveLength(1);
    expect((await run(rule, '<html><head><meta name="description" content=""></head></html>'))).toHaveLength(1);
    expect(await run(rule, '<html><head><meta name="description" content="A real description"></head></html>')).toEqual([]);
  });

  it('rule description-length: silent in range, fires out of range', async () => {
    const rule = descriptionLength('warning', t);
    const ok = 'd'.repeat(80);
    expect(await run(rule, `<html><head><meta name="description" content="${ok}"></head></html>`)).toEqual([]);
    const short = 'd'.repeat(10);
    expect((await run(rule, `<html><head><meta name="description" content="${short}"></head></html>`))).toHaveLength(1);
    const long = 'd'.repeat(200);
    expect((await run(rule, `<html><head><meta name="description" content="${long}"></head></html>`))).toHaveLength(1);
  });

  it('rule h1-missing: fires with zero h1, silent with one', async () => {
    const rule = h1Missing('error');
    expect((await run(rule, '<html><body><p>no heading</p></body></html>'))).toHaveLength(1);
    expect(await run(rule, '<html><body><h1>Main</h1></body></html>')).toEqual([]);
  });

  it('rule h1-multiple: fires with two h1s, silent with one', async () => {
    const rule = h1Multiple('info');
    expect((await run(rule, '<html><body><h1>a</h1><h1>b</h1></body></html>'))).toHaveLength(1);
    expect(await run(rule, '<html><body><h1>a</h1><h2>b</h2></body></html>')).toEqual([]);
  });

  it('rule canonical-present: info when absent, warning when multiple, silent when exactly one', async () => {
    const rule = canonicalPresent('info');
    const absent = await run(rule, '<html><head></head></html>');
    expect(absent).toHaveLength(1);
    expect(absent[0]?.severity).toBe('info');
    const multiple = await run(rule, '<html><head><link rel="canonical" href="/a"><link rel="canonical" href="/b"></head></html>');
    expect(multiple).toHaveLength(1);
    expect(multiple[0]?.severity).toBe('warning'); // per-issue severity bump
    expect(await run(rule, '<html><head><link rel="canonical" href="/a"></head></html>')).toEqual([]);
  });

  it('rule lang-attr: fires on missing and invalid tags, silent on BCP-47-ish', async () => {
    const rule = langAttr('warning');
    expect((await run(rule, '<html><body></body></html>'))).toHaveLength(1);
    expect((await run(rule, '<html lang="123"><body></body></html>'))).toHaveLength(1);
    expect(await run(rule, '<html lang="en"><body></body></html>')).toEqual([]);
    expect(await run(rule, '<html lang="pt-BR"><body></body></html>')).toEqual([]);
    expect(await run(rule, '<html lang="zh-Hans-CN"><body></body></html>')).toEqual([]);
  });

  it('rule viewport-meta: fires when absent, silent when present', async () => {
    const rule = viewportMeta('warning');
    expect((await run(rule, '<html><head></head></html>'))).toHaveLength(1);
    expect(await run(rule, '<html><head><meta name="viewport" content="width=device-width"></head></html>')).toEqual([]);
  });

  it('rule image-alt-coverage: alt="" counts as present; one aggregate issue with coverage', async () => {
    const rule = imageAltCoverage('warning');
    expect(await run(rule, '<html><body><img src="a.png" alt="A"><img src="b.png" alt=""></body></html>')).toEqual([]);
    const missing = await run(rule, '<html><body><img src="a.png" alt="A"><img src="b.png"></body></html>');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('1 of 2');
    expect(missing[0]?.message).toContain('50%');
    expect((await run(rule, '<html><body></body></html>'))).toEqual([]); // no images -> silent
  });

  it('rule robots-noindex: meta and X-Robots-Tag variants, silent when indexable', async () => {
    const rule = robotsNoindex('info');
    expect((await run(rule, '<html><head><meta name="robots" content="noindex, nofollow"></head></html>'))).toHaveLength(1);
    const header = await run(rule, '<html><head></head></html>', { headers: { 'x-robots-tag': 'noindex' } });
    expect(header).toHaveLength(1);
    expect(header[0]?.message).toContain('X-Robots-Tag');
    expect(await run(rule, '<html><head><meta name="robots" content="index, follow"></head></html>')).toEqual([]);
  });

  it('rule status-error: fires at >= 400, silent below', async () => {
    const rule = statusError('error');
    expect((await run(rule, '<html></html>', { status: 404 }))).toHaveLength(1);
    expect((await run(rule, '<html></html>', { status: 503 }))).toHaveLength(1);
    expect(await run(rule, '<html></html>', { status: 200 })).toEqual([]);
    expect(await run(rule, '<html></html>', { status: 301 })).toEqual([]);
  });

  it('rule insecure-http: fires on http: pages only', async () => {
    const rule = insecureHttp('warning');
    expect((await run(rule, '<html></html>', { url: 'http://example.com/p' }))).toHaveLength(1);
    expect(await run(rule, '<html></html>', { url: 'https://example.com/p' })).toEqual([]);
  });

  it('rule mixed-content: flags http: subresources only on https: pages, one issue with count', async () => {
    const rule = mixedContent('error');
    const httpsPage =
      '<html><head><script src="http://cdn.example/j.js"></script><link rel="stylesheet" href="http://cdn.example/s.css"></head>' +
      '<body><img src="http://img.example/i.png"><iframe src="http://frame.example/f"></iframe>' +
      '<img src="/ok.png"><script src="/ok.js"></script></body></html>';
    const issues = await run(rule, httpsPage, { url: 'https://example.com/p' });
    expect(issues).toHaveLength(1); // one aggregate issue per page
    expect(issues[0]?.message).toContain('4 insecure');
    expect(issues[0]?.evidence.snippet).toContain('http://cdn.example/j.js');
    // http page with http subresources -> silent (nothing to mix)
    expect(await run(rule, httpsPage, { url: 'http://example.com/p' })).toEqual([]);
    // https page fully secure -> silent
    expect(await run(rule, '<html><body><img src="/a.png"></body></html>', { url: 'https://example.com/p' })).toEqual([]);
  });

  it('rule response-latency: fires above threshold, silent at/below', async () => {
    const rule = responseLatency('warning', t);
    expect((await run(rule, '<html></html>', { timingMs: 1_501 }))).toHaveLength(1);
    expect(await run(rule, '<html></html>', { timingMs: 1_500 })).toEqual([]);
    expect(await run(rule, '<html></html>', { timingMs: 10 })).toEqual([]);
  });

  it('rule og-tags-missing: one issue listing the missing set, silent when complete', async () => {
    const rule = ogTagsMissing('info');
    const none = await run(rule, '<html><head></head></html>');
    expect(none).toHaveLength(1);
    expect(none[0]?.message).toContain('og:title');
    expect(none[0]?.message).toContain('og:description');
    expect(none[0]?.message).toContain('og:image');
    const partial = await run(rule, '<html><head><meta property="og:title" content="T"></head></html>');
    expect(partial[0]?.message).toContain('og:image');
    expect(partial[0]?.message).not.toContain('og:title');
    const complete =
      '<html><head><meta property="og:title" content="T"><meta property="og:description" content="D"><meta property="og:image" content="I"></head></html>';
    expect(await run(rule, complete)).toEqual([]);
  });
});

const mkIndex = (pages: { url: string; status: number; finalUrl?: string; hops?: number }[], outLinks: Record<string, { href: string; url: string; internal: boolean }[]> = {}) => {
  const entries = pages.map((p) => ({ url: p.url, status: p.status, depth: 0, hops: p.hops ?? 0, finalUrl: p.finalUrl ?? p.url }));
  const map = new Map(entries.map((e) => [e.url, e]));
  return {
    pages: entries,
    outLinks: new Map(Object.entries(outLinks)),
    statusOf: (url: string) => {
      const e = map.get(url);
      return e === undefined ? undefined : { status: e.status, finalUrl: e.finalUrl };
    },
  };
};

describe('built-in rules (crawl-level)', () => {
  it('rule broken-internal-link: fires for fetched targets with status >= 400, evidence is the anchor', () => {
    const rule = brokenInternalLink('error');
    const index = mkIndex(
      [
        { url: 'https://example.com/', status: 200 },
        { url: 'https://example.com/gone', status: 404 },
      ],
      {
        'https://example.com/': [
          { href: '/gone', url: 'https://example.com/gone', internal: true },
          { href: '/fine', url: 'https://example.com/fine', internal: true },
          { href: 'https://elsewhere.example/x', url: 'https://elsewhere.example/x', internal: false },
        ],
      },
    );
    const issues = rule.checkCrawl(index, { depth: 0, isSeed: true });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.url).toBe('https://example.com/'); // owning page
    expect(issues[0]?.message).toContain('404');
    expect(issues[0]?.evidence.selector).toContain('a[href="/gone"]');
  });

  it('rule broken-internal-link: silent when target was never fetched (honesty)', () => {
    const rule = brokenInternalLink('error');
    const index = mkIndex(
      [{ url: 'https://example.com/', status: 200 }],
      { 'https://example.com/': [{ href: '/never-fetched', url: 'https://example.com/never-fetched', internal: true }] },
    );
    expect(rule.checkCrawl(index, { depth: 0, isSeed: true })).toEqual([]);
  });

  it('rule redirect-chain: silent without redirect, fires when the requested URL redirected', () => {
    const rule = redirectChain('warning');
    const index = mkIndex([
      { url: 'https://example.com/direct', status: 200 },
      { url: 'https://example.com/old', status: 200, finalUrl: 'https://example.com/new', hops: 1 },
    ]);
    const issues = rule.checkCrawl(index, { depth: 0, isSeed: true });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.url).toBe('https://example.com/old');
    expect(issues[0]?.evidence.snippet).toContain('https://example.com/new');
  });
});
