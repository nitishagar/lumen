/**
 * The locked `AuditRule` SPI (ARCHITECTURE.md). Audit (P2) implements rules
 * against `PageContext`; plugin rules (SC-8) satisfy the same shape.
 */
import type { Issue, PageContext } from './page.js';
import { isSeverity } from './severity.js';
import type { Severity } from './severity.js';

export interface RuleOpts {
  signal?: AbortSignal;
}

export interface AuditRule {
  readonly id: string;
  readonly severity: Severity;
  readonly categories: string[];
  check(page: PageContext, o: RuleOpts): Promise<Issue[]> | Issue[];
}

/** Minimal runtime shape check used by the Node-only plugin loader (SC-8). */
export const looksLikeAuditRule = (v: unknown): v is AuditRule => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    isSeverity(r.severity) &&
    Array.isArray(r.categories) &&
    r.categories.every((c) => typeof c === 'string') &&
    typeof r.check === 'function'
  );
};
