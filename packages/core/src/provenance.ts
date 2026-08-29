/**
 * Provenance — the I3 data-honesty wrapper. Every externally-sourced metric
 * value in lumen is wrapped as `Metric<T>` carrying where it came from and
 * when it was retrieved. `retrievedAt` is ALWAYS injected by the caller
 * (SC-17): these helpers never read the wall clock, so outputs and tests are
 * reproducible (I10).
 */
export type ProvenanceKind = 'official' | 'community' | 'heuristic' | 'lab' | 'field' | 'gray';

export const PROVENANCE_KINDS: readonly ProvenanceKind[] = [
  'official',
  'community',
  'heuristic',
  'lab',
  'field',
  'gray', // providers A9: undocumented endpoints (google-suggest, ddg-serp)
];

export interface Provenance {
  provider: string;
  kind: ProvenanceKind;
  attribution?: string;
}

export interface Metric<T> {
  value: T;
  source: Provenance;
  /** ISO-8601 timestamp, injected by the caller — never read from a hidden clock. */
  retrievedAt: string;
}

export const mkSource = (
  provider: string,
  kind: ProvenanceKind,
  attribution?: string,
): Provenance =>
  attribution === undefined ? { provider, kind } : { provider, kind, attribution };

export const mkMetric = <T>(value: T, source: Provenance, retrievedAt: string): Metric<T> => ({
  value,
  source,
  retrievedAt,
});
