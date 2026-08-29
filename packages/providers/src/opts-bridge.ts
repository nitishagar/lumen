/**
 * The single adaptation point between core opts shapes and provider-local
 * query opts (BA12). Core opts are minimal and locked; where a provider
 * needs more (e.g. CrUX `scope`), the runtime extension is read HERE and
 * nowhere else, so a future core opts change is a one-file fix.
 */
import type { AuthorityOpts, CruxOpts, IdeasOpts, PageSpeedOpts, SearchOpts } from '@lumen-seo/core';

/** google-suggest query opts. */
export interface SuggestOpts {
  lang: string;
  limit?: number;
}

export const toSuggestOpts = (o: IdeasOpts): SuggestOpts => ({ lang: o.lang ?? 'en', limit: o.limit });

/** wikipedia-demand opts (v1 is en.wikipedia-only, BA4). */
export interface DemandOpts {
  lang: string;
}

export const toDemandOpts = (o: IdeasOpts): DemandOpts => ({ lang: o.lang ?? 'en' });

/** ddg-serp query opts. */
export interface SerpQueryOpts {
  lang: string;
  limit: number;
}

export const toSerpQueryOpts = (o: SearchOpts): SerpQueryOpts => ({ lang: o.lang ?? 'en', limit: o.limit ?? 20 });

/**
 * CrUX query opts. Core's locked `CruxOpts` has only `formFactor`; the
 * optional `scope` extension (origin vs url) is honored when a caller
 * passes it, defaulting to origin scope (better data availability and one
 * quota unit per site rather than per page).
 */
export interface CruxQueryOpts {
  formFactor: 'phone' | 'desktop' | 'tablet';
  scope: 'origin' | 'url';
}

export const toCruxQueryOpts = (o: CruxOpts): CruxQueryOpts => {
  const ext = o as CruxOpts & { scope?: 'origin' | 'url' };
  return { formFactor: o.formFactor ?? 'phone', scope: ext.scope ?? 'origin' };
};

/** PageSpeed query opts (BA5: `automated` defaults to false — trial-keyless allowed). */
export interface ReportQueryOpts {
  strategy: 'mobile' | 'desktop';
  automated: boolean;
}

export const toReportQueryOpts = (o: PageSpeedOpts): ReportQueryOpts => ({
  strategy: o.strategy ?? 'mobile',
  automated: o.automated ?? false,
});

/** Authority lookups carry no query knobs today; the bridge keeps the seam symmetric. */
export const toAuthorityQueryOpts = (o: AuthorityOpts): AuthorityOpts => o;
