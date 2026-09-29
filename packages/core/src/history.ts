/**
 * History contract (SC-15). Core defines the interface ONLY — the JSONL
 * implementation belongs to the surfaces aspect (P4). `position` is nullable
 * (not found is `null`, never 0 — I3). Kinds segregate by store path
 * (`rank/` legacy, `audit/`); the `kind` filter defaults to `rank` so every
 * pre-kinds caller reads exactly what it read before.
 */
import type { Severity } from './severity.js';

export interface RankHistoryEntry {
  keyword: string;
  domain: string;
  position: number | null;
  provider: string;
  url?: string;
  /** ISO-8601. */
  retrievedAt: string;
}

/** Audit digest entry (Stage 3): one line per completed `lumen audit` run. */
export interface AuditHistoryEntry {
  url: string;
  score: number;
  pagesAudited: number;
  /** Partial crawls are labeled, never dressed up as finished runs. */
  incomplete: boolean;
  /** Why an incomplete run stopped (`aborted` | `time_budget` | `page_budget`); present only when `incomplete`. */
  stopReason?: string;
  countsBySeverity: Record<Severity, number>;
  provider: 'lumen-audit';
  /** ISO-8601. */
  retrievedAt: string;
}

export type HistoryEntry = RankHistoryEntry | AuditHistoryEntry;

/** Storage/query kind (`all` merges kinds sorted by retrievedAt). */
export type HistoryKind = 'rank' | 'audit' | 'all';

export interface HistoryListQuery {
  kind?: HistoryKind;
  keyword?: string;
  domain?: string;
  url?: string;
  limit?: number;
}

export interface HistoryStore {
  append(e: HistoryEntry): Promise<void>;
  list(q?: HistoryListQuery): Promise<HistoryEntry[]>;
  /** E2.3 (optional, additive — the locked {append,list} shape is unchanged):
   *  trim rotated generations, keeping `keepGenerations` newest. Returns how
   *  many generations were removed. Stores without rotation may omit it. */
  prune?(o: { keepGenerations?: number }): Promise<number>;
}

/** Rank entries carry `keyword`; audit digests do not. */
export const isRankEntry = (e: HistoryEntry): e is RankHistoryEntry =>
  typeof (e as Partial<RankHistoryEntry>).keyword === 'string';
