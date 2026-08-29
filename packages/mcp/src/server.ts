/**
 * buildMcpServer — the ONE factory for the five locked lumen_* tools (I5/E6).
 * stdio (CLI) and HTTP (Worker) are composition roots over this same factory;
 * the tool set is identical on both transports. A capability absent from the
 * injected deps still registers the tool but answers with a typed
 * LOCAL_ONLY_CAPABILITY error (E6). Results are JSON-in-text (B2); handlers
 * are pure functions of (args, deps); every arg set passes the strictArgs
 * guard (E7/B7) and every URL passes the public-URL guard (I12).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { domainToASCII } from 'node:url';
import type {
  AuthorityProvider,
  CruxProvider,
  HistoryStore,
  KeywordProvider,
  LumenError,
  PageSpeedProvider,
  SerpProvider,
  SiteAuditReport,
} from '@lumen-seo/core';
import { countIssuesAtOrAbove as countAtOrAbove } from '@lumen-seo/core';
import type { AuditRunner, PageMetaFetcher } from './ports.js';
import {
  ALLOWED_ARGS,
  auditSiteSchema,
  authoritySchema,
  keywordIdeasSchema,
  pageReportSchema,
  rankCheckSchema,
} from './schemas.js';
import { LOCAL_ONLY_NOTE, localOnly } from './local-only.js';
import { strictArgs } from './strict-args.js';
import { validatePublicHttpUrl } from './url-guard.js';

export interface McpDeps {
  /** Injected ISO clock (I10 — never a hidden wall clock). */
  clock: () => string;
  keyword: readonly KeywordProvider[];
  authority: readonly AuthorityProvider[];
  /** Provider names configured but skipped for a missing BYOK key (I1/E6). */
  unconfigured?: readonly string[];
  serp?: SerpProvider;
  pageSpeed?: PageSpeedProvider;
  crux?: CruxProvider;
  auditRunner?: AuditRunner;
  pageMeta?: PageMetaFetcher;
  /** Rank history (stdio CLI only — the Worker never writes local files). */
  history?: HistoryStore;
}

const text = (payload: unknown): CallToolResult['content'] => [
  { type: 'text', text: JSON.stringify(payload) },
];
const ok = (payload: unknown): CallToolResult => ({ content: text(payload) });
const err = (payload: object): CallToolResult => ({
  isError: true,
  content: text(payload),
});

const typedError = (e: unknown): CallToolResult =>
  err({
    code: e instanceof Error && e.name ? e.name : 'INTERNAL',
    message: e instanceof Error ? e.message : String(e),
    ...(e instanceof Error && 'label' in e && typeof (e as LumenError).label === 'string'
      ? { provider: (e as LumenError).label }
      : {}),
  });

const AUDIT_DESC =
  'Bounded site SEO audit: crawls up to maxPages (default from server config, cap 10000), ' +
  'returns severity counts (error|warning|info), top issues, and passesThreshold for the ' +
  'failThreshold gate (default error; off disables; an incomplete report never passes).';
const PAGE_REPORT_DESC =
  'Page report for one URL: PageSpeed Insights lab data, CrUX field data (when includeCrux), ' +
  'and local page meta when available. Provenance on every metric; unavailable sections say why.';
const KEYWORDS_DESC =
  'Keyword ideas for a seed term from the configured suggestion/demand providers. ' +
  'Ideas are estimates — each carries its source and estimate label.';
const RANK_DESC =
  'Check where a domain ranks for a keyword in search results (best effort, provider-labeled). ' +
  'Not found in the top N is a successful found:false answer. Appends rank history when a store is wired.';
const AUTHORITY_DESC =
  'Authority signals for a domain from the configured providers (e.g. Tranco rank, Open PageRank). ' +
  'Unconfigured providers are listed, never called.';

export const buildMcpServer = (deps: McpDeps): McpServer => {
  const server = new McpServer({ name: 'lumen', version: '0.0.0' });

  server.registerTool(
    'lumen_audit_site',
    {
      title: 'Bounded site audit',
      description: deps.auditRunner === undefined ? `${AUDIT_DESC} ${LOCAL_ONLY_NOTE}` : AUDIT_DESC,
      inputSchema: auditSiteSchema,
    },
    async (args, extra) => {
      const violation = strictArgs(args, ALLOWED_ARGS.lumen_audit_site);
      if (violation !== null) return err(violation);
      if (deps.auditRunner === undefined) {
        return err(localOnly('lumen_audit_site', 'npx @lumen-seo/cli audit <url>'));
      }
      const guard = validatePublicHttpUrl(args.url);
      if (!guard.ok) return err({ code: 'INVALID_URL', message: guard.message });
      try {
        const report = await deps.auditRunner.run(
          { url: guard.url, maxPages: args.maxPages }, // no maxPages default — R8
          extra.signal,
        );
        return ok(auditPayload(report, guard.url.href, args.failThreshold, args.response_format));
      } catch (e) {
        return typedError(e);
      }
    },
  );

  server.registerTool(
    'lumen_page_report',
    {
      title: 'Page report (lab + field + meta)',
      description:
        deps.pageMeta === undefined
          ? `${PAGE_REPORT_DESC} Over remote MCP, page meta/HTML analysis is local-only.`
          : PAGE_REPORT_DESC,
      inputSchema: pageReportSchema,
    },
    async (args, extra) => {
      const violation = strictArgs(args, ALLOWED_ARGS.lumen_page_report);
      if (violation !== null) return err(violation);
      const guard = validatePublicHttpUrl(args.url);
      if (!guard.ok) return err({ code: 'INVALID_URL', message: guard.message });
      const url = guard.url;
      const retrievedAt = deps.clock();
      const lab =
        deps.pageSpeed === undefined
          ? { status: 'unavailable', reason: 'pagespeed provider not configured' }
          : await deps.pageSpeed
              .report(url, { strategy: args.strategy, signal: extra.signal })
              .then((r) => ({ ...r, retrievedAt }))
              .catch((e: unknown) => ({ status: 'unavailable', reason: reasonOf(e) }));
      const field =
        args.includeCrux && deps.crux !== undefined
          ? await deps.crux
              .record(url, { signal: extra.signal })
              .then((r) =>
                r === null
                  ? { status: 'unavailable', reason: 'no CrUX field data (insufficient coverage or key not accepted)' }
                  : r,
              )
              .catch((e: unknown) => ({ status: 'unavailable', reason: reasonOf(e) }))
          : { status: 'unavailable', reason: args.includeCrux ? 'crux provider not configured' : 'includeCrux=false' };
      const meta =
        deps.pageMeta === undefined
          ? {
              status: 'unavailable',
              reason: 'page meta/HTML analysis is local-only: npx @lumen-seo/cli report <url>',
            }
          : await deps.pageMeta
              .fetch(url, extra.signal)
              .then((r) => (r === null ? { status: 'unavailable', reason: 'page meta unavailable' } : { ...r, retrievedAt }))
              .catch((e: unknown) => ({ status: 'unavailable', reason: reasonOf(e) }));

      const attribution = [
        ...new Map(
          [
            'status' in lab ? undefined : lab.source,
            'status' in field ? undefined : field.source,
          ]
            .filter((s): s is NonNullable<typeof s> => s !== undefined)
            .map((s) => [s.provider, s.attribution ?? s.kind] as const),
        ).entries(),
      ].map(([provider, a]) => ({ provider, attribution: a }));

      const conciseField =
        'status' in field
          ? field
          : {
              source: field.source,
              metrics: Object.fromEntries(
                Object.entries(field.metrics).map(([k, m]) => [k, { p75: m.p75 }]),
              ),
            };
      return ok({
        url: url.href,
        strategy: args.strategy,
        lab:
          'status' in lab
            ? lab
            : args.response_format === 'concise'
              ? { scores: lab.scores, metrics: lab.metrics, source: lab.source, retrievedAt }
              : lab,
        field: args.response_format === 'concise' ? conciseField : field,
        meta:
          args.response_format === 'concise' && !('status' in meta)
            ? { title: meta.title, lang: meta.lang, retrievedAt }
            : meta,
        attribution,
        limitations: [
          'lab data is a single synthetic Lighthouse run, not field data',
          ...(args.includeCrux ? [] : ['field data skipped (includeCrux=false)']),
          ...(deps.pageMeta === undefined ? ['page meta/HTML analysis is local-only: npx @lumen-seo/cli report <url>'] : []),
        ],
      });
    },
  );

  server.registerTool(
    'lumen_keyword_ideas',
    {
      title: 'Keyword ideas',
      description: KEYWORDS_DESC,
      inputSchema: keywordIdeasSchema,
    },
    async (args, extra) => {
      const violation = strictArgs(args, ALLOWED_ARGS.lumen_keyword_ideas);
      if (violation !== null) return err(violation);
      if (deps.keyword.length === 0) {
        return err({
          code: 'PROVIDER_UNCONFIGURED',
          message: 'no keywords provider configured on this server',
        });
      }
      const unavailable: { provider: string; reason: string }[] = [];
      const perProvider = await Promise.all(
        deps.keyword.map(async (p) => {
          try {
            return await p.ideas(args.seed, { lang: args.lang, limit: args.limit, signal: extra.signal });
          } catch (e) {
            unavailable.push({ provider: p.name, reason: reasonOf(e) });
            return [];
          }
        }),
      );
      const ideas: import('@lumen-seo/core').KeywordIdea[] = [];
      const max = Math.max(0, ...perProvider.map((l) => l.length));
      for (let i = 0; i < max; i += 1) {
        for (const list of perProvider) {
          const item = list[i];
          if (item !== undefined) ideas.push(item);
        }
      }
      const trimmed = ideas.slice(0, args.limit);
      if (trimmed.length === 0 && unavailable.length === deps.keyword.length) {
        return err({
          code: 'UPSTREAM_FAILED',
          message: `all keywords providers failed: ${unavailable.map((u) => u.provider).join(', ')}`,
        });
      }
      const attribution = [
        ...new Map(
          trimmed
            .filter((i) => i.source.attribution !== undefined)
            .map((i) => [i.source.provider, i.source.attribution as string]),
        ).entries(),
      ].map(([provider, a]) => ({ provider, attribution: a }));
      return ok({
        seed: args.seed,
        ideas: trimmed,
        attribution,
        ...(args.response_format === 'detailed' && unavailable.length > 0 ? { unavailable } : {}),
      });
    },
  );

  server.registerTool(
    'lumen_rank_check',
    {
      title: 'SERP rank check',
      description:
        deps.serp === undefined ? `${RANK_DESC} ${LOCAL_ONLY_NOTE}` : RANK_DESC,
      inputSchema: rankCheckSchema,
    },
    async (args, extra) => {
      const violation = strictArgs(args, ALLOWED_ARGS.lumen_rank_check);
      if (violation !== null) return err(violation);
      if (deps.serp === undefined) {
        return err(localOnly('lumen_rank_check', 'npx @lumen-seo/cli rank <keyword> --domain <domain>'));
      }
      const ascii = normalizeDomainArg(args.domain);
      if (ascii === null) {
        return err({ code: 'INVALID_ARGUMENTS', message: `invalid domain: ${args.domain}` });
      }
      const serp = deps.serp;
      const retrievedAt = deps.clock();
      let results: import('@lumen-seo/core').SerpResult[];
      try {
        results = await serp.search(args.keyword, { limit: args.limit, signal: extra.signal });
      } catch (e) {
        return typedError(e);
      }
      const hostOf = (u: string): string | null => {
        try {
          return domainToASCII(new URL(u).hostname.toLowerCase());
        } catch {
          return null;
        }
      };
      const hit = results.find((r) => {
        const host = hostOf(r.url);
        return host !== null && (host === ascii || host.endsWith(`.${ascii}`));
      }) ?? null;
      // E14: append only after a successful provider result.
      if (deps.history !== undefined) {
        await deps.history.append({
          keyword: args.keyword,
          domain: ascii,
          position: hit?.position ?? null,
          provider: serp.name,
          ...(hit?.url === undefined ? {} : { url: hit.url }),
          retrievedAt,
        });
      }
      const base = {
        keyword: args.keyword,
        domain: ascii,
        found: hit !== null,
        position: hit?.position ?? null,
        matchedUrl: hit?.url,
        provider: serp.name,
        retrievedAt,
      };
      if (args.response_format === 'concise') return ok(base);
      const recentHistory = deps.history === undefined ? undefined : await deps.history.list({ domain: ascii, limit: 10 });
      return ok({ ...base, results, ...(recentHistory === undefined ? {} : { recentHistory }) });
    },
  );

  server.registerTool(
    'lumen_authority',
    {
      title: 'Authority signals',
      description: AUTHORITY_DESC,
      inputSchema: authoritySchema,
    },
    async (args, extra) => {
      const violation = strictArgs(args, ALLOWED_ARGS.lumen_authority);
      if (violation !== null) return err(violation);
      const retrievedAt = deps.clock();
      const unavailable: { provider: string; reason: string }[] = [];
      const signals = (
        await Promise.all(
          deps.authority.map(async (p) => {
            try {
              return await p.authority(args.domain, { signal: extra.signal });
            } catch (e) {
              unavailable.push({ provider: p.name, reason: reasonOf(e) });
              return [];
            }
          }),
        )
      ).flat();
      if (deps.authority.length === 0 && (deps.unconfigured ?? []).length === 0) {
        return err({
          code: 'PROVIDER_UNCONFIGURED',
          message: 'no authority provider configured on this server',
        });
      }
      return ok({
        domain: args.domain,
        signals: signals.map((s) => ({
          provider: s.provider,
          kind: s.kind,
          value: s.value,
          attribution: s.attribution,
          retrievedAt,
        })),
        unconfigured: [...(deps.unconfigured ?? [])],
        ...(args.response_format === 'detailed' && unavailable.length > 0 ? { unavailable } : {}),
      });
    },
  );

  return server;
};

const reasonOf = (e: unknown): string =>
  e instanceof Error && 'label' in e
    ? `${String((e as LumenError).label)}: ${e.message}`
    : e instanceof Error
      ? e.message
      : 'provider call failed';

/**
 * Domain argument validation for `lumen_rank_check` (I15): a bare hostname,
 * ≤253 chars, IDN normalized via `domainToASCII` — anything else (empty,
 * overlong, whitespace/control chars, URL delimiters, non-normalizable) maps
 * to null → typed INVALID_ARGUMENTS. domainToASCII silently TRUNCATES at URL
 * delimiters ("example.com/evil" -> "example.com"), so the delimiter family
 * is rejected BEFORE normalization: a malformed argument is never silently
 * rewritten into a different domain (mirrors the CLI's normalizeDomain — the
 * mcp package cannot import @lumen-seo/cli, dependency direction cli → mcp).
 */
const normalizeDomainArg = (raw: string): string | null => {
  if (raw.length === 0 || raw.length > 253) return null;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point (I15)
  if (/[\s\x00-\x1f\x7f]/.test(raw) || /[/\\?#@:]/.test(raw)) return null;
  const ascii = domainToASCII(raw.toLowerCase());
  return ascii === null || ascii === '' ? null : ascii;
};

const auditPayload = (
  report: SiteAuditReport,
  url: string,
  failThreshold: 'info' | 'warning' | 'error' | 'off',
  responseFormat: 'concise' | 'detailed',
): Record<string, unknown> => {
  const issues = report.pages.flatMap((p) => p.issues);
  const passes = !report.incomplete && countAtOrAbove(issues, failThreshold) === 0;
  const base = {
    url,
    pages: report.summary.pagesAudited ?? report.pages.length,
    score: report.summary.score,
    countsBySeverity: report.summary.countsBySeverity,
    topIssues: issues.slice(0, 10).map((i) => ({
      ruleId: i.ruleId,
      severity: i.severity,
      message: i.message,
      ...(i.url === undefined ? {} : { url: i.url }),
    })),
    passesThreshold: passes,
    incomplete: report.incomplete,
    failThreshold,
  };
  if (responseFormat === 'concise') return base;
  return {
    ...base,
    stopReason: report.stopReason,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    pages: report.pages.map((p) => ({
      url: p.url,
      score: p.score,
      issues: p.issues,
      ...(p.skipped === undefined ? {} : { skipped: p.skipped }),
    })),
  };
};
