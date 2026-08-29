/**
 * Provider payload models — required fields EXACTLY per ARCHITECTURE.md
 * (SC-9). Honesty nullability is encoded in the types (I3): values that were
 * not observed are `null` or the field is omitted, never zero-filled.
 */
import type { Provenance } from './provenance.js';

/** `KeywordIdea{term, source{provider,kind,attribution?}, estimateLabel?, lang?}` */
export interface KeywordIdea {
  term: string;
  source: Provenance;
  estimateLabel?: string;
  lang?: string;
}

/** `SerpResult{position, url, title, snippet?}` */
export interface SerpResult {
  position: number;
  url: string;
  title: string;
  snippet?: string;
}

/** Lighthouse/PSI category scores, 0–100; `null` when the category did not compute (I3). */
export interface PageSpeedScores {
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
}

/** Core web vital measurements in their canonical units (lcp/tbt/fcn ms, cls unitless); `null` when absent. */
export interface PageSpeedMetrics {
  lcp: number | null;
  cls: number | null;
  tbt: number | null;
  fcn: number | null;
}

/** `PageSpeedReport{scores{...}, metrics{...}, source{...}}` */
export interface PageSpeedReport {
  scores: PageSpeedScores;
  metrics: PageSpeedMetrics;
  source: Provenance;
}

/**
 * One histogram bin of a CrUX-style distribution. `start`/`end` are in the
 * metric's canonical unit; the final bin is open-ended (`end` omitted).
 * `density` is the fraction of page loads falling in the bin (0–1).
 */
export interface HistogramBin {
  start?: number;
  end?: number;
  density: number;
}

/** Per-metric CrUX data: 75th percentile + histogram bins. `p75` is null when insufficient data (I3). */
export interface CruxMetric {
  p75: number | null;
  histogramBins: HistogramBin[];
}

/** `CruxRecord{metrics: {name: {p75, histogramBins}}, source{...}}` — providers return `null` when not configured. */
export interface CruxRecord {
  metrics: Record<string, CruxMetric>;
  source: Provenance;
}

/** `AuthoritySignal{domain, kind:'rank'|'score', value, provider, attribution}` */
export type AuthorityKind = 'rank' | 'score';

export interface AuthoritySignal {
  domain: string;
  kind: AuthorityKind;
  value: number;
  provider: string;
  attribution: string;
}
