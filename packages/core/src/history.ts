/**
 * Rank-history contract (SC-15). Core defines the interface ONLY — the JSONL
 * implementation belongs to the surfaces aspect (P4). `position` is nullable
 * (not found is `null`, never 0 — I3).
 */
export interface RankHistoryEntry {
  keyword: string;
  domain: string;
  position: number | null;
  provider: string;
  url?: string;
  /** ISO-8601. */
  retrievedAt: string;
}

export interface HistoryListQuery {
  keyword?: string;
  domain?: string;
  limit?: number;
}

export interface HistoryStore {
  append(e: RankHistoryEntry): Promise<void>;
  list(q?: HistoryListQuery): Promise<RankHistoryEntry[]>;
}
