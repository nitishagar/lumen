/**
 * stdio composition root (PLAN Approach #1): maps the CLI's CommandDeps —
 * full provider registry (via @lumen-seo/mcp testkit fixtures until the
 * Phase 6 rebase), the AuditRunner port, the PageMetaFetcher port, and the
 * JSONL history store — onto the McpDeps shape consumed by the single
 * `buildMcpServer` factory. Transport parity (I5): this is the ONLY mapping
 * the stdio transport needs; the Worker has its own composition over the
 * same factory.
 */
import type { McpDeps } from '@lumen-seo/mcp';
import type { CommandDeps } from './node.js';

export const mcpDepsFromCommand = (d: CommandDeps): McpDeps => ({
  clock: d.clock,
  keyword: d.keywords,
  authority: d.authority,
  unconfigured: d.authorityUnconfigured,
  serp: d.serp,
  pageSpeed: d.pageSpeed,
  crux: d.crux,
  auditRunner: d.auditRunner,
  pageMeta: d.pageMeta,
  history: d.history,
});
