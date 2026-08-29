/**
 * Page-level payload models — `PageContext`, `Issue`, `PageReport`,
 * `SiteAuditReport`. Required fields per ARCHITECTURE.md; `PageReport` is the
 * P1-defined gap the architecture delegates here. Optional additive fields
 * (`Issue.url`, `PageReport.depth/skipped/redirectChain`,
 * `SiteAuditReport.stopReason`, summary extras) are the audit-engine A12
 * contract deltas — stringly-typed unions (`stopReason`, skip reasons) are
 * declared by audit and stored as `string` here to avoid a reverse dependency.
 */
import type { CheerioAPI } from 'cheerio'; // type-only import (BA-12): no cheerio in core's runtime graph
import type { Metric } from './provenance.js';
import type { Severity } from './severity.js';

/** `PageContext{url, status, headers, dom (cheerio load), bytes, timingMs, robotsAllowed}` */
export interface PageContext {
  url: URL;
  status: number;
  headers: Headers;
  dom: CheerioAPI;
  bytes: number;
  timingMs: number;
  robotsAllowed: boolean;
}

/** `Issue.evidence{selector?, snippet?}` — observed evidence only (I3). */
export interface IssueEvidence {
  selector?: string;
  snippet?: string;
}

/** `Issue{ruleId, severity, message, evidence{selector?,snippet?}, fixHint?}` + additive `url?` (A12). */
export interface Issue {
  ruleId: string;
  severity: Severity;
  message: string;
  evidence: IssueEvidence;
  fixHint?: string;
  /** Owning/source page URL for crawl-level issues attributed to a page (A12). */
  url?: string;
}

/**
 * `PageReport` (P1-defined): one crawled page in a `SiteAuditReport`.
 * `status`/`timingMs`/`bytes` are `null` for pages skipped before fetch
 * (e.g. robots-disallowed) — never zero-filled (I3).
 */
export interface PageReport {
  url: string;
  status: number | null;
  title?: string;
  issues: Issue[];
  /** Site audit page score; `null` when not computable (I3). */
  score: number | null;
  /** Page-level metric wrappers, keyed by metric name (I3). */
  metrics?: Record<string, Metric<number>>;
  timingMs: number | null;
  bytes: number | null;
  robotsAllowed: boolean;
  /** Crawl depth of this page (0 = seed). Additive (A12). */
  depth?: number;
  /** Skip marker — always `{ reason }`, never a bare string. Reason vocabulary is audit-owned (A4/A12). */
  skipped?: { reason: string };
  /** Ordered redirect hops followed before this page's final URL. Additive (A12). */
  redirectChain?: string[];
}

/** `SiteAuditReport.summary{countsBySeverity, score}` + audit-owned additive counts (A12). */
export interface SiteAuditReportSummary {
  countsBySeverity: Record<Severity, number>;
  score: number | null;
  pagesAudited?: number;
  pagesSkipped?: number;
  byRule?: Record<string, number>;
  /** RuleId → count of per-rule/per-page execution failures (isolated, run continued). */
  ruleErrors?: Record<string, number>;
}

/** `SiteAuditReport{id, startedAt, completedAt, pages, summary, incomplete, configSnapshot}` + additive `stopReason?`. */
export interface SiteAuditReport {
  id: string;
  /** ISO-8601. */
  startedAt: string;
  /** ISO-8601. */
  completedAt: string;
  pages: PageReport[];
  summary: SiteAuditReportSummary;
  incomplete: boolean;
  /** Resolved-config snapshot; contains env-var NAMES only, never values (I16). */
  configSnapshot: Record<string, unknown>;
  /** `'completed' | 'aborted' | 'time_budget' | 'page_budget'` — declared by audit, `string` here (A12). */
  stopReason?: string;
}
