import { describe, expect, it } from 'vitest';
import type {
  AuthorityProvider,
  CruxProvider,
  KeywordProvider,
  PageSpeedProvider,
  SerpProvider,
} from '@lumen-seo/core';
import { createBuiltInProviders } from './registry-wiring.js';
import { ATTRIBUTION } from './provenance.js';
import { FakeClock, fakeFetcher, htmlResponse, jsonResponse, makeDeps, textResponse } from './testing.js';
import {
  cruxRecord,
  ddgHtml,
  googleSuggestJson,
  oprSingle,
  psiReport,
  trancoCsv,
  trancoMeta,
  wikiPageviews,
  wikiTitleHit,
} from './fixtures/index.js';

const NOW = Date.UTC(2026, 7, 29);
const KEY = 'LUMEN_TEST_KEY_123';
const VALID_KINDS = ['official', 'community', 'heuristic', 'lab', 'field', 'gray'] as const;

const isIso = (v: unknown): boolean => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/**
 * One fetcher answering every provider's happy fixture at once, so the whole
 * built-in family can be swept in a single deterministic pass (I3/I8).
 */
const happyFetcher = fakeFetcher((url) => {
  if (url.hostname === 'suggestqueries.google.com') return jsonResponse(googleSuggestJson);
  if (url.hostname === 'en.wikipedia.org') return jsonResponse(wikiTitleHit);
  if (url.hostname === 'wikimedia.org') return jsonResponse(wikiPageviews);
  if (url.hostname === 'www.googleapis.com') return jsonResponse(psiReport);
  if (url.hostname === 'chromeuxreport.googleapis.com') return jsonResponse(cruxRecord);
  if (url.hostname === 'openpagerank.com') return jsonResponse(oprSingle);
  if (url.hostname === 'tranco-list.eu') {
    return url.pathname.startsWith('/api/lists/date/') ? jsonResponse(trancoMeta) : textResponse(trancoCsv, 200, 'text/csv');
  }
  if (url.hostname === 'html.duckduckgo.com') return htmlResponse(ddgHtml);
  throw new Error(`unexpected fixture host ${url.hostname}`);
});

describe('TC-SHARED-6: provenance sweep over every built-in provider', () => {
  const clock = new FakeClock(NOW);
  const built = createBuiltInProviders(
    {},
    makeDeps(happyFetcher, clock, { env: { LUMEN_PSI_KEY: KEY, LUMEN_CRUX_KEY: KEY, LUMEN_OPR_KEY: KEY } }),
  );
  const providers = {
    'google-suggest': built['google-suggest'] as KeywordProvider,
    'wikipedia-demand': built['wikipedia-demand'] as KeywordProvider,
    pagespeed: built.pagespeed as PageSpeedProvider,
    crux: built.crux as CruxProvider,
    openpagerank: built.openpagerank as AuthorityProvider,
    tranco: built.tranco as AuthorityProvider,
    'ddg-serp': built['ddg-serp'] as SerpProvider,
  };

  it('google-suggest: gray + estimateLabel + attribution + retrievedAt on every idea', async () => {
    const ideas = await providers['google-suggest'].ideas('coffee grinder', {});
    expect(ideas.length).toBeGreaterThan(0);
    for (const idea of ideas) {
      expect(idea.source.provider).toBe('google-suggest');
      expect(VALID_KINDS).toContain(idea.source.kind);
      expect(idea.source.kind).toBe('gray');
      expect(idea.source.attribution).toBeTruthy();
      expect(isIso(idea.retrievedAt)).toBe(true);
      expect(idea.estimateLabel).toBeTruthy();
    }
  });

  it('wikipedia-demand: heuristic + estimateLabel (demand proxy)', async () => {
    const ideas = await providers['wikipedia-demand'].ideas('coffee grinder', {});
    expect(ideas).toHaveLength(1);
    const idea = ideas[0]!;
    expect(idea.source.kind).toBe('heuristic');
    expect(idea.source.attribution).toBeTruthy();
    expect(isIso(idea.retrievedAt)).toBe(true);
    expect(idea.estimateLabel).toContain('demand proxy, not search volume');
  });

  it('pagespeed: lab source on the report, field source in the field block', async () => {
    const report = await providers.pagespeed.report(new URL('https://example.com/'), {});
    expect(report.source.provider).toBe('pagespeed');
    expect(report.source.kind).toBe('lab');
    expect(report.source.attribution).toBeTruthy();
    expect(isIso(report.retrievedAt)).toBe(true);
    expect(report.field?.source.kind).toBe('field');
    expect(report.field?.source.attribution).toBeTruthy();
  });

  it('crux: field kind and the VERBATIM CC BY 4.0 attribution on the record', async () => {
    const record = await providers.crux.record(new URL('https://example.com/'), {});
    expect(record).not.toBeNull();
    expect(record!.source.kind).toBe('field');
    expect(record!.source.attribution).toBe(ATTRIBUTION.crux);
    expect(record!.source.attribution).toContain(
      'The CrUX datasets from Google are licensed under the Creative Commons Attribution 4.0 International license',
    );
    expect(isIso(record!.retrievedAt)).toBe(true);
  });

  it('openpagerank: heuristic signals carry attribution + estimateLabel + retrievedAt', async () => {
    const signals = await providers.openpagerank.authority('example.com', {});
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(s.provider).toBe('openpagerank');
      expect(s.attribution).toBe(ATTRIBUTION.openpagerank);
      expect(s.estimateLabel).toBeTruthy();
      expect(isIso(s.retrievedAt)).toBe(true);
      expect(s.value).toBeDefined(); // never value: undefined (I3)
    }
  });

  it('tranco: community signals carry attribution + disclosed list label + retrievedAt', async () => {
    const signals = await providers.tranco.authority('example.com', {});
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(s.provider).toBe('tranco');
      expect(s.attribution).toBe(ATTRIBUTION.tranco);
      expect(s.estimateLabel).toMatch(/Tranco rank \(list/);
      expect(isIso(s.retrievedAt)).toBe(true);
    }
  });

  it('ddg-serp: gray + best-effort estimateLabel on every result', async () => {
    const results = await providers['ddg-serp'].search('coffee grinder', {});
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.source!.provider).toBe('ddg-serp');
      expect(r.source!.kind).toBe('gray');
      expect(r.source!.attribution).toBeTruthy();
      expect(r.estimateLabel).toBeTruthy();
      expect(isIso(r.retrievedAt)).toBe(true);
    }
  });
});

describe('TC-SHARED-8: an injected fake key never leaks into any error output (I16)', () => {
  it('no message/detail/stringified error from keyed providers contains the key', async () => {
    const failing = fakeFetcher(() => new Response('upstream broke', { status: 500 }));
    const clock = new FakeClock(NOW);
    const built = createBuiltInProviders(
      {},
      makeDeps(failing, clock, { env: { LUMEN_PSI_KEY: KEY, LUMEN_CRUX_KEY: KEY, LUMEN_OPR_KEY: KEY } }),
    );
    const psi = built.pagespeed as PageSpeedProvider;
    const crux = built.crux as CruxProvider;
    const opr = built.openpagerank as AuthorityProvider;
    const errors: unknown[] = [];
    const attempts: Array<Promise<unknown>> = [
      psi.report(new URL('https://example.com/'), {}).catch((e: unknown) => errors.push(e)),
      crux.record(new URL('https://example.com/'), {}).catch((e: unknown) => errors.push(e)),
      opr.authority('example.com', {}).catch((e: unknown) => errors.push(e)),
    ];
    await Promise.all(attempts);
    expect(errors).toHaveLength(3);
    for (const e of errors) {
      expect(JSON.stringify(e)).not.toContain(KEY);
      expect(String((e as Error).message)).not.toContain(KEY);
    }
    // URLs carrying a key param are redactable on demand
    const { redactUrl } = await import('./redact.js');
    expect(redactUrl(`https://x.example/api?key=${KEY}`)).not.toContain(KEY);
  });
});
