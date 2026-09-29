/**
 * google-search-console (E2.1) — NODE-ONLY SearchPerformanceProvider:
 * service-account JWT auth (RS256 via node:crypto), the searchAnalytics API,
 * a GCRA pacer, a 24h response cache, and a token cache that honors
 * `expires_in`. NEVER re-exported from the package barrel — the Worker can
 * neither run it nor bundle it (entry-isolation test enforces that).
 *
 * BYOK discipline (I16): `credentialsPath` is a PATH (from
 * `LUMEN_GSC_CREDENTIALS`); the file is read at call time and its contents —
 * and any derived secret — are NEVER logged or echoed. Errors name the path,
 * not the payload.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Fetcher } from '@lumen-seo/core';
import type { Provenance, SearchPerformanceOpts, SearchPerformanceProvider, SearchPerformanceReport, SearchPerformanceRow } from '@lumen-seo/core';
import type { CacheStore } from './cache.js';
import type { Pacer } from './throttle.js';
import { NotConfiguredError } from './errors.js';

/** Conservative documented ceiling for the Search Console API (600 queries/min). */
const GSC_RPM = 600;
const RESPONSE_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_SAFETY_MS = 60_000;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API_BASE = 'https://searchconsole.googleapis.com/webmasters/v3/sites';

export const gscProvenance: Provenance = {
  provider: 'gsc',
  kind: 'official',
  attribution: 'Google Search Console — first-party data',
};

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

interface CachedToken {
  token: string;
  /** Epoch ms after which the token must be refreshed (expires_in − 60s safety). */
  expiresAtMs: number;
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

/** One line of the JWT-bearer dance: sign, exchange, cache by expiry. */
class GscAuth {
  private cached: CachedToken | undefined;

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetcher: Fetcher,
    private readonly clock: () => number,
  ) {}

  async token(): Promise<string> {
    if (this.cached !== undefined && this.clock() < this.cached.expiresAtMs) return this.cached.token;
    const now = Math.floor(this.clock() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: SCOPE,
        aud: TOKEN_URL,
        exp: now + 3600,
        iat: now,
      }),
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claim}`);
    const signature = b64url(signer.sign(this.account.private_key));
    const assertion = `${header}.${claim}.${signature}`;

    const res = await this.fetcher.fetch(new URL(TOKEN_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (res.status !== 200) {
      // Honest, non-leaking: the response body may echo nothing useful, but we
      // never forward it (it can contain account identifiers).
      throw new Error(`GSC auth failed (HTTP ${res.status}) — check the service account and its Search Console access`);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (typeof body.access_token !== 'string') {
      throw new Error('GSC auth failed — token response had no access_token');
    }
    const ttlMs = Math.max((body.expires_in ?? 3600) * 1000 - TOKEN_REFRESH_SAFETY_MS, 60_000);
    this.cached = { token: body.access_token, expiresAtMs: this.clock() + ttlMs };
    return this.cached.token;
  }
}

export interface GscProviderOptions {
  credentialsPath: string;
  fetcher: Fetcher;
  cache: CacheStore;
  pacer: Pacer;
  clock: () => number;
}

export const createGscProvider = (o: GscProviderOptions): SearchPerformanceProvider => {
  const loadAccount = (): ServiceAccount => {
    if (o.credentialsPath === undefined || o.credentialsPath === '') {
      throw new NotConfiguredError('gsc', 'LUMEN_GSC_CREDENTIALS', 'set LUMEN_GSC_CREDENTIALS to the PATH of a service-account JSON with Search Console access');
    }
    let raw: string;
    try {
      raw = readFileSync(o.credentialsPath, 'utf8');
    } catch {
      throw new Error(`GSC credentials file not readable at ${o.credentialsPath}`);
    }
    // I2: a parse failure must NEVER echo file contents (V8 embeds a verbatim
    // fragment) — the error names the path only.
    let parsed: Partial<ServiceAccount>;
    try {
      parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    } catch {
      throw new Error(`GSC credentials file at ${o.credentialsPath} is not valid JSON`);
    }
    if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
      throw new Error(`GSC credentials file at ${o.credentialsPath} is not a service-account JSON (expected client_email + private_key)`);
    }
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  };

  // I1: ONE lazy auth per provider instance (the token cache survives calls);
  // the credential file is still read lazily per first use.
  let cachedAuth: GscAuth | undefined;
  const auth = (): GscAuth => {
    if (cachedAuth === undefined) cachedAuth = new GscAuth(loadAccount(), o.fetcher, o.clock);
    return cachedAuth;
  };

  return {
    name: 'gsc',
    async performance(site: URL, opts: SearchPerformanceOpts): Promise<SearchPerformanceReport> {
      // Response cache FIRST — a cache hit pays no auth at all.
      const cacheKey = `gsc:${site.href}:${opts.days}:${opts.by}`;
      const cached = await o.cache.get<SearchPerformanceReport>(cacheKey);
      if (cached !== undefined) return cached;

      const token = await auth().token();
      const endDate = new Date(o.clock());
      const startDate = new Date(o.clock() - opts.days * 86_400_000);
      const iso = (d: Date): string => d.toISOString().slice(0, 10);

      await o.pacer.acquire();
      const siteUrl = encodeURIComponent(site.href);
      const res = await o.fetcher.fetch(new URL(`${API_BASE}/${siteUrl}/searchAnalytics/query`), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          startDate: iso(startDate),
          endDate: iso(endDate),
          dimensions: [opts.by === 'query' ? 'query' : 'page'],
          rowLimit: 1000,
        }),
      });
      if (res.status === 403) throw new Error(`GSC denied access to ${site.href} — grant the service account Search Console access`);
      if (res.status !== 200) throw new Error(`GSC API failed (HTTP ${res.status})`);

      const body = (await res.json()) as { rows?: { keys: string[]; clicks: number; impressions: number; position?: number }[] };
      const rows: SearchPerformanceRow[] = (body.rows ?? []).map((r) => ({
        key: r.keys[0] ?? '',
        clicks: r.clicks,
        impressions: r.impressions,
        position: r.position ?? null,
        source: gscProvenance,
      }));
      const report: SearchPerformanceReport = {
        site: site.href,
        startDate: iso(startDate),
        endDate: iso(endDate),
        by: opts.by,
        rows,
      };
      await o.cache.set(cacheKey, report, o.clock() + RESPONSE_TTL_MS);
      return report;
    },
  };
};

/** GSC pacing (not in PACING_DEFAULTS — that map is builtin-name-keyed and the Worker never runs GSC). */
export const GSC_PACING = { rpm: GSC_RPM, burst: 10 } as const;
