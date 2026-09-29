/**
 * `lumen rank <keyword> --domain <d>` (B11/E4/E14): SERP position check via
 * the configured SerpProvider. Not-found is SUCCESS (found:false,
 * position:null, exit 0). Exactly one RankHistoryEntry line is appended after
 * a successful provider result unless --no-save; `found` is derived
 * (position !== null), never persisted.
 *
 * `lumen rank --history [--kind rank|audit] [--format json|csv] [--domain <d>]
 * [--limit N]` (Stage 3): reads stored history instead of searching — no
 * positional, no provider call, no writes. `--no-save` and `--json --format
 * csv` are UsageErrors here; unknown `--kind`/`--format` fail listing the
 * valid options. Exit 0 on success, 2 on usage/config error (never 1:
 * reading history is not a gate).
 */
import { EXIT, isRankEntry } from '@lumen-seo/core';
import type { HistoryEntry } from '@lumen-seo/core';
import { intFlag } from '../args.js';
import type { CommandDeps } from '../composition/node.js';
import { buildDeps } from '../composition/node.js';
import { matchesDomain, normalizeDomain } from '../domain.js';
import { jsonDocument } from '../io.js';
import { createGscProvider } from '@lumen-seo/providers/node';
import { GSC_PACING } from '@lumen-seo/providers/node';
import { GcraPacer, InMemoryCache } from '@lumen-seo/providers';
import { createNodeFetcher } from '@lumen-seo/core/node';
import type { CliContext } from '../run.js';
import { clean } from '../term.js';
import { ProviderUnconfiguredError, UsageError } from '../usage-error.js';
import { validateLimit, validateSeed } from '../validate.js';

const HISTORY_KINDS = ['rank', 'audit'] as const;
type HistoryKind = (typeof HISTORY_KINDS)[number];
const HISTORY_FORMATS = ['json', 'csv'] as const;
type HistoryFormat = (typeof HISTORY_FORMATS)[number];

const RANK_CSV_HEADER = 'keyword,domain,position,provider,url,retrievedAt';
const AUDIT_CSV_HEADER =
  'url,score,pagesAudited,countsError,countsWarning,countsInfo,incomplete,provider,retrievedAt';

const csvCell = (v: string | number | boolean | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralize spreadsheet-formula starters (= @); a leading '-' stays
  // faithful (legit keywords) and cannot open a formula cell on its own.
  const body = /^[=@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(body) ? `"${body.replace(/"/g, '""')}"` : body;
};

const rankRow = (e: HistoryEntry): string =>
  isRankEntry(e)
    ? [e.keyword, e.domain, e.position, e.provider, e.url, e.retrievedAt].map(csvCell).join(',')
    : [
        e.url,
        e.score,
        e.pagesAudited,
        e.countsBySeverity.error,
        e.countsBySeverity.warning,
        e.countsBySeverity.info,
        e.incomplete,
        e.provider,
        e.retrievedAt,
      ]
        .map(csvCell)
        .join(',');

const humanHistory = (kind: HistoryKind, entries: readonly HistoryEntry[]): string => {
  const lines = [`history (${kind}): ${entries.length} entries`];
  for (const e of entries) {
    if (isRankEntry(e)) {
      lines.push(
        `  ${clean(e.keyword)} — ${clean(e.domain)}: ${e.position === null ? 'not found' : `position ${e.position}`} (${clean(e.provider)}, ${clean(e.retrievedAt)})`,
      );
    } else {
      lines.push(
        `  ${clean(e.url)}: score ${e.score}, ${e.pagesAudited} pages${e.incomplete ? ' (incomplete)' : ''} (${clean(e.retrievedAt)})`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
};

const readHistory = async (ctx: CliContext, d: CommandDeps): Promise<number> => {
  if (ctx.flags['no-save'] === true) {
    throw new UsageError('lumen rank --history reads history — --no-save does not apply here');
  }
  const kindFlag = ctx.flags.kind;
  const kind: HistoryKind =
    kindFlag === undefined
      ? 'rank'
      : (HISTORY_KINDS as readonly string[]).includes(String(kindFlag))
        ? (kindFlag as HistoryKind)
        : (() => {
            throw new UsageError(`--kind must be one of: ${HISTORY_KINDS.join(', ')}`);
          })();
  const formatFlag = ctx.flags.format;
  const format: HistoryFormat =
    formatFlag === undefined
      ? 'json'
      : (HISTORY_FORMATS as readonly string[]).includes(String(formatFlag))
        ? (formatFlag as HistoryFormat)
        : (() => {
            throw new UsageError(`--format must be one of: ${HISTORY_FORMATS.join(', ')}`);
          })();
  if (ctx.flags.json === true && format === 'csv') {
    throw new UsageError('--json and --format csv conflict — pick one output shape');
  }
  const domainFlag = ctx.flags.domain;
  const domain = typeof domainFlag === 'string' && domainFlag !== '' ? normalizeDomain(domainFlag) : undefined;
  const limit = validateLimit(intFlag(ctx.flags, 'limit'));
  const entries = await d.history.list({ kind, ...(domain === undefined ? {} : { domain }), limit });
  const { io } = ctx;
  if (format === 'csv') {
    const header = kind === 'rank' ? RANK_CSV_HEADER : AUDIT_CSV_HEADER;
    io.out(`${header}\n${entries.map(rankRow).join('\n')}${entries.length === 0 ? '' : '\n'}`);
    return EXIT.OK;
  }
  if (ctx.flags.json === true) {
    io.out(jsonDocument(entries));
    return EXIT.OK;
  }
  io.out(humanHistory(kind, entries));
  return EXIT.OK;
};

export const execute = async (ctx: CliContext, deps?: CommandDeps): Promise<number> => {
  const d = deps ?? (await buildDeps(ctx.configPathFlag));
  if (ctx.flags.history === true) return readHistory(ctx, d);
  const keyword = validateSeed(ctx.positionals[0] ?? '', 'keyword');
  const domainFlag = ctx.flags.domain;
  if (typeof domainFlag !== 'string' || domainFlag === '') {
    throw new UsageError('rank requires --domain <domain> — run "lumen rank --help" for usage');
  }
  const domain = normalizeDomain(domainFlag);
  const limit = validateLimit(intFlag(ctx.flags, 'limit'));

  if (d.serp === undefined) {
    throw new ProviderUnconfiguredError(
      'serp',
      'no serp provider configured — set "providers.serp" in lumen.config.json',
    );
  }
  // E2.1: GSC average position is FIRST-PARTY when configured — preferred
  // over the best-effort SERP scrape (never both for one check). The
  // provenance says which source produced the number.
  const gscProvider = d.performanceProvider;
  const credPath = process.env.LUMEN_GSC_CREDENTIALS;
  if (gscProvider !== undefined || (credPath !== undefined && credPath !== '')) {
    const gsc =
      gscProvider ??
      createGscProvider({
        credentialsPath: credPath!,
        fetcher: createNodeFetcher(),
        cache: new InMemoryCache(),
        pacer: new GcraPacer(GSC_PACING.rpm, GSC_PACING.burst, Date.now, () => new Promise((r) => setTimeout(r, 1))),
        clock: Date.now,
      });
    let perf;
    try {
      perf = await gsc.performance(new URL(`https://${domain}`), { days: 28, by: 'query' });
    } catch (e) {
      // GSC failure degrades to the labeled SERP path — rank never hard-fails
      // on a first-party outage it can answer without.
      ctx.io.err(`GSC unavailable (${clean(e instanceof Error ? e.message : String(e), 160)}) — falling back to the SERP provider\n`);
      perf = undefined;
    }
    const row = perf?.rows.find((r) => r.key.toLowerCase() === keyword.toLowerCase());
    if (row !== undefined) {
      const retrievedAt = d.clock();
      if (ctx.flags['no-save'] !== true) {
        await d.history.append({
          keyword,
          domain,
          position: row.position === null ? null : Math.round(row.position),
          provider: 'gsc',
          retrievedAt,
        });
      }
      const { io } = ctx;
      const result = {
        keyword,
        domain,
        found: row.position !== null,
        position: row.position === null ? null : Math.round(row.position),
        matchedUrl: undefined,
        provider: 'gsc',
        source: 'first-party (Google Search Console average position, 28 days)',
        retrievedAt,
      };
      if (ctx.flags.json === true) {
        io.out(jsonDocument(result));
        return EXIT.OK;
      }
      io.out(`rank: ${clean(keyword)} — ${clean(domain)}\n`);
      io.out(`  position: ${result.position === null ? 'n/a' : result.position} (gsc average, 28d — first-party)\n`);
      io.out(`  clicks: ${row.clicks} / impressions: ${row.impressions}\n`);
      io.out('  note: queried the https:// URL-prefix property (sc-domain: domain properties are not supported by rank)\n');
      return EXIT.OK;
    }
    // no GSC row for this keyword — fall through to the SERP path, labeled.
  }

  const serp = d.serp;
  const retrievedAt = d.clock();
  const results = await serp.search(keyword, { limit, signal: ctx.signal });
  const hit = results.find((r) => matchesDomain(r.url, domain)) ?? null;

  if (ctx.flags['no-save'] !== true) {
    await d.history.append({
      keyword,
      domain,
      position: hit?.position ?? null,
      provider: serp.name,
      ...(hit?.url === undefined ? {} : { url: hit.url }),
      retrievedAt,
    });
  }

  const result = {
    keyword,
    domain,
    found: hit !== null,
    position: hit?.position ?? null,
    matchedUrl: hit?.url,
    provider: serp.name,
    retrievedAt,
  };
  const { io } = ctx;
  if (ctx.flags.json === true) {
    io.out(jsonDocument(result));
    return EXIT.OK;
  }
  io.out(`rank: ${clean(keyword)} — ${clean(domain)}\n`);
  if (hit === null) {
    io.out(`  not found in top ${limit} (provider: ${clean(serp.name)})\n`);
  } else {
    io.out(`  position: ${hit.position} of ${results.length}\n`);
    io.out(`  url: ${clean(hit.url, 300)}\n`);
  }
  io.out(`  provider: ${clean(serp.name)}  retrieved: ${clean(retrievedAt)}\n`);
  return EXIT.OK;
};
