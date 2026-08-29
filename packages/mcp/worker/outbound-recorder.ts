/**
 * I16 outbound recorder + fixture responder for the Miniflare tests. Lives in
 * node-side module state (the outboundService callback runs in the Vitest
 * node context, OUTSIDE workerd — the test files run inside workerd and get
 * their OWN module instance of this file, so `outboundRecorder` state is NOT
 * visible to tests; the pre-rebase `calls() == []` assertion was vacuous for
 * exactly that reason).
 *
 * Post-rebase the REAL providers fetch through the capping fetcher, Miniflare
 * intercepts every request HERE, and the host allowlist is ENFORCED here: a
 * request to any host outside OUTBOUND_HOST_ALLOWLIST is answered with a 599,
 * which the providers classify as a typed UpstreamError — so any flow that
 * depended on a non-allowlisted call fails its positive-path test instead of
 * passing silently. Wire facts: google-suggest and wikipedia-demand need no
 * key and always fetch; PSI runs keyless in trial mode (allowlisted); CrUX
 * and OpenPageRank throw NotConfiguredError before any fetch when no key
 * rides in via the x-lumen-* headers (I1).
 */

export interface OutboundCall {
  method: string;
  host: string;
  path: string;
}

/** The ONLY hosts the Worker may ever reach (I16 allowlist, active post-rebase). */
export const OUTBOUND_HOST_ALLOWLIST: readonly string[] = [
  'www.googleapis.com', // PSI (lab)
  'chromeuxreport.googleapis.com', // CrUX (field) — keyed only
  'openpagerank.com', // OPR — keyed only (the provider's getPageRank endpoint host)
  'suggestqueries.google.com', // google-suggest
  'en.wikipedia.org', // wikipedia-demand title match (pageviews live on wikimedia.org; fixtures answer no-match, so that host is never reached)
];

const recorded: OutboundCall[] = [];

/** Node-side diagnostics only — test files run in workerd and see a separate instance. */
export const outboundRecorder = {
  calls: (): readonly OutboundCall[] => recorded,
  reset: (): void => {
    recorded.length = 0;
  },
};

/** Compact provider-shaped bodies — every parser below is the REAL provider code. */
const psiBody = {
  lighthouseResult: {
    categories: {
      performance: { score: 0.92 },
      seo: { score: 0.95 },
      accessibility: { score: 0.9 },
      'best-practices': { score: 0.93 },
    },
    audits: {
      'largest-contentful-paint': { numericValue: 2100 },
      'cumulative-layout-shift': { numericValue: 0.05 },
      'total-blocking-time': { numericValue: 120 },
      'first-contentful-paint': { numericValue: 900 },
    },
  },
};

const cruxBody = {
  record: {
    metrics: {
      largest_contentful_paint: {
        percentiles: { p75: 2300 },
        histogram: [{ start: 0, end: 2500, density: 0.8 }],
      },
    },
  },
};

const oprBody = {
  domains: [{ status_code: 200, page_rank_decimal: 5.34, rank: 12345 }],
};

/** Deterministic fixture response for allowlisted upstreams (never live). */
const fixtureResponseFor = (req: Request): Response => {
  const url = new URL(req.url);
  switch (url.host) {
    case 'suggestqueries.google.com': // google-suggest parses `[string, string[]]`
      return Response.json([url.searchParams.get('q') ?? '', ['seo tools', 'seo checker', 'seo analysis', 'seo audit']]);
    case 'en.wikipedia.org': // title match: empty pages[] → no match → demand omitted (I3)
      return Response.json({ pages: [] });
    case 'www.googleapis.com': // PSI parses lighthouseResult
      return Response.json(psiBody);
    case 'chromeuxreport.googleapis.com': // CrUX parses record.metrics (keyed only)
      return Response.json(cruxBody);
    case 'openpagerank.com': // OPR parses domains[] (keyed only)
      return Response.json(oprBody);
    default:
      return Response.json({ fixture: true, for: url.host, path: url.pathname });
  }
};

export const recordAndFixture = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  recorded.push({ method: req.method, host: url.host, path: url.pathname });
  if (!(OUTBOUND_HOST_ALLOWLIST as readonly string[]).includes(url.host)) {
    // I16 enforcement (see module doc): fail the offending call loudly — the
    // provider maps HTTP >= 500 to a typed UpstreamError, degrading the leg
    // that made the call and failing any positive-path assertion on it.
    return Response.json({ error: 'OUTBOUND_HOST_NOT_IN_ALLOWLIST', host: url.host }, { status: 599 });
  }
  return fixtureResponseFor(req);
};
