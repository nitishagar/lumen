/**
 * Hand-written fixture payloads (BA10) — see ./README.md for the shape
 * provenance of each. Served through the injected fake fetcher only.
 */

// --- google-suggest (A5) -----------------------------------------------------
export const googleSuggestJson = JSON.stringify(['coffee grinder', ['coffee grinder', 'coffee grinder brush', 'coffee grinder manual', 'coffee grinder electric']]);

// --- wikipedia-demand (A3/BA4) ----------------------------------------------
export const wikiTitleHit = JSON.stringify({
  pages: [{ id: 5320922, key: 'Coffee_grinder', title: 'Coffee grinder' }],
});
export const wikiTitleMiss = JSON.stringify({ pages: [] });
export const wikiPageviewsItems = Array.from({ length: 28 }, (_, i) => ({
  project: 'en.wikipedia',
  article: 'Coffee_grinder',
  granularity: 'daily',
  timestamp: `202607${String(1 + i).padStart(2, '0')}00`,
  access: 'all-access',
  agent: 'all-agents',
  views: 100 + i,
}));
export const wikiPageviews = JSON.stringify({ items: wikiPageviewsItems });
export const wikiPageviewsTotal = wikiPageviewsItems.reduce((s, it) => s + it.views, 0);

// --- pagespeed (A4/BA5/BA7) ---------------------------------------------------
export const psiReport = JSON.stringify({
  lighthouseResult: {
    categories: {
      performance: { id: 'performance', score: 0.98 },
      seo: { id: 'seo', score: 1 },
      accessibility: { id: 'accessibility', score: 0.87 },
      'best-practices': { id: 'best-practices', score: 0.93 },
    },
    audits: {
      'largest-contentful-paint': { id: 'largest-contentful-paint', numericValue: 2210, displayValue: '2.2 s' },
      'cumulative-layout-shift': { id: 'cumulative-layout-shift', numericValue: 0.05, displayValue: '0.05' },
      'total-blocking-time': { id: 'total-blocking-time', numericValue: 310, displayValue: '310 ms' },
      'first-contentful-paint': { id: 'first-contentful-paint', numericValue: 940, displayValue: '0.9 s' },
    },
  },
  loadingExperience: {
    metrics: {
      'FIRST_CONTENTFUL_PAINT': { percentile: 1200, category: 'FAST', distributions: [] },
      'LARGEST_CONTENTFUL_PAINT': { percentile: 2450, category: 'AVERAGE', distributions: [] },
      'CUMULATIVE_LAYOUT_SHIFT': { percentile: 0.06, category: 'FAST', distributions: [] },
      'INTERACTION_TO_NEXT_PAINT': { percentile: 180, category: 'FAST', distributions: [] },
    },
    overall_category: 'AVERAGE',
    origin_fallback: false,
  },
  analysisUTCTimestamp: '2026-08-27T10:00:00Z',
});

export const psiReportNoField = JSON.stringify({
  lighthouseResult: {
    categories: { performance: { score: 0.5 } }, // missing categories → null scores (honesty)
    audits: {}, // missing audits → null metrics (honesty)
  },
  // no loadingExperience at all — low-traffic origin (I3: omitted, never zeroed)
});

export const psiErrorQuota = JSON.stringify({
  error: { code: 403, message: 'Rate Limit Exceeded', errors: [] },
});

// --- crux (A1/A8/BA6) ---------------------------------------------------------
export const cruxRecord = JSON.stringify({
  record: {
    key: { formFactor: 'PHONE', collectionPeriod: { first: '2026-08-01', last: '2026-08-29' } },
    metrics: {
      largest_contentful_paint: {
        percentiles: { p75: 2312 },
        histogram: [
          { start: 0, end: 2500, density: 0.71 },
          { start: 2500, density: 0.29 },
        ],
      },
      cumulative_layout_shift: {
        percentiles: { p75: 0.08 },
        histogram: [
          { start: 0, end: 0.1, density: 0.81 },
          { start: 0.1, density: 0.19 },
        ],
      },
      interaction_to_next_paint: {
        percentiles: { p75: 120 },
        histogram: [
          { start: 0, end: 200, density: 0.9 },
          { start: 200, density: 0.1 },
        ],
      },
    },
  },
  urlNormalizationDetails: { normalizedUrl: 'https://example.com/' },
});

// --- openpagerank (A2/BA8) ----------------------------------------------------
export const oprSingle = JSON.stringify({
  domains: [
    {
      domain: 'example.com',
      page_rank_integer: '6',
      page_rank_decimal: '6.15',
      rank: '4821',
      status_code: 200,
    },
  ],
});
export const oprQuotaError = JSON.stringify({
  domains: [{ domain: 'example.com', error: 'Monthly quota exceeded. Upgrade your plan or wait for the reset.', status_code: 429 }],
});
export const oprDomainError = JSON.stringify({
  domains: [{ domain: 'nope.example', error: 'Domain not found', status_code: 404 }],
});

// --- tranco (A7/BA3) ----------------------------------------------------------
export const trancoMeta = JSON.stringify({ list_id: 'L5ZQ4', download_path: '/download/L5ZQ4' });
export const trancoCsvRows = [
  '1,google.com',
  '2,youtube.com',
  '3,facebook.com',
  '4,example.com',
  '5,wikipedia.org',
];
export const trancoCsv = trancoCsvRows.join('\n') + '\n';

// --- ddg-serp (A6) ------------------------------------------------------------
export const ddgHtml = `<!DOCTYPE html><html><body>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fcoffee%2Fgrinders&amp;rut=abc">Best coffee grinders 2026</a></h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fcoffee%2Fgrinders&amp;rut=abc">Ten hand-tested grinders, from blade to burr.</a>
</div>
<div class="result result--ad">
  <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsponsored.example%2Fgrinder">AD: Buy grinders here</a></h2>
</div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://wiki.coffee.example/Burr_grinder">Burr grinder guide</a></h2>
  <a class="result__snippet" href="https://wiki.coffee.example/Burr_grinder">Everything about burr grinding.</a>
</div>
</body></html>`;

export const ddgLite = `<!DOCTYPE html><html><body><table>
<tr><td>1.</td><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fcoffee%2Fgrinders&amp;rut=xyz" class="result-link">Best coffee grinders 2026</a></td></tr>
<tr><td class="result-snippet">Ten hand-tested grinders, from blade to burr.</td></tr>
<tr><td>2.</td><td><a rel="nofollow" href="https://wiki.coffee.example/Burr_grinder" class="result-link">Burr grinder guide</a></td></tr>
<tr><td class="result-snippet">Everything about burr grinding.</td></tr>
</table></body></html>`;

export const ddgHtmlWithChallengeWords = `<!DOCTYPE html><html><body>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsecurity.example%2Fcaptcha">How to solve every CAPTCHA</a></h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsecurity.example%2Fcaptcha">Anomaly detection in challenge-response systems.</a>
</div>
</body></html>`;

export const ddgChallenge = `<!DOCTYPE html><html><body><div class="content"><h1> anomaly detected </h1><p>If this persists, please complete the captcha below.</p></div></body></html>`;

export const ddgNoResults = `<!DOCTYPE html><html><body><div class="no-results">No results</div></body></html>`;

export const ddgDrift = `<!DOCTYPE html><html><body><div class="brand-new-layout"><p>Completely redesigned</p></div></body></html>`;
