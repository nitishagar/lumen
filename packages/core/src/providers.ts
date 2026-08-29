/**
 * The five LOCKED provider interfaces (ARCHITECTURE.md Provider SPI) plus
 * their opts types. Every opts carries an optional `AbortSignal` (I14).
 * M1 providers refine internals only — signatures are the contract.
 */
import type { AuthoritySignal, CruxRecord, KeywordIdea, PageSpeedReport, SerpResult } from './payloads.js';

export type ProviderBoundary = 'keywords' | 'serp' | 'pagespeed' | 'crux' | 'authority';

export const PROVIDER_BOUNDARIES: readonly ProviderBoundary[] = [
  'keywords',
  'serp',
  'pagespeed',
  'crux',
  'authority',
];

export const isProviderBoundary = (v: unknown): v is ProviderBoundary =>
  typeof v === 'string' && (PROVIDER_BOUNDARIES as readonly string[]).includes(v);

export interface KeywordProvider {
  readonly name: string;
  ideas(seed: string, o: IdeasOpts): Promise<KeywordIdea[]>;
}

export interface SerpProvider {
  readonly name: string;
  search(q: string, o: SearchOpts): Promise<SerpResult[]>;
}

export interface PageSpeedProvider {
  readonly name: string;
  report(url: URL, o: PageSpeedOpts): Promise<PageSpeedReport>;
}

export interface CruxProvider {
  readonly name: string;
  record(url: URL, o: CruxOpts): Promise<CruxRecord | null>;
}

export interface AuthorityProvider {
  readonly name: string;
  authority(domain: string, o: AuthorityOpts): Promise<AuthoritySignal[]>;
}

export interface IdeasOpts {
  lang?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface SearchOpts {
  lang?: string;
  limit?: number;
  scope?: string;
  signal?: AbortSignal;
}

export interface PageSpeedOpts {
  strategy?: 'mobile' | 'desktop';
  automated?: boolean;
  signal?: AbortSignal;
}

export interface CruxOpts {
  formFactor?: 'phone' | 'desktop' | 'tablet';
  signal?: AbortSignal;
}

export interface AuthorityOpts {
  signal?: AbortSignal;
}

/** Any of the five provider kinds. */
export type AnyProvider =
  | KeywordProvider
  | SerpProvider
  | PageSpeedProvider
  | CruxProvider
  | AuthorityProvider;
