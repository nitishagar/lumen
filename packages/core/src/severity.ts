/**
 * Severity vocabulary — closed, ordered `info < warning < error` (RECONCILIATION R1).
 * `failThreshold` extends this with `'off'` (see config.ts / gate.ts).
 */
export type Severity = 'error' | 'warning' | 'info';

export const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];

export const isSeverity = (v: unknown): v is Severity =>
  typeof v === 'string' && (SEVERITIES as readonly string[]).includes(v);
