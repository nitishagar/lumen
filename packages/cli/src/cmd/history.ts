/**
 * `lumen history <audit|rank|prune>` (E2.3): the first-class trends surface
 * over the local JSONL history (promoted from `rank --history`, which stays
 * as a deprecated alias for one minor version — its note prints on stderr;
 * stdout carries exactly one document). `--since` filters client-side and
 * REMOVES the store-side limit (the store slices before filtering, which
 * would return the wrong window). `prune` trims rotated generations through
 * the store's optional `prune` (the LOCKED {append,list} port is unchanged).
 */
import { EXIT } from '@lumen-seo/core';
import type { HistoryEntry, HistoryKind } from '@lumen-seo/core';
import { isRankEntry } from '@lumen-seo/core';
import type { CommandDeps } from '../composition/node.js';
import { buildDeps } from '../composition/node.js';
import { csvRow } from '../csv.js';
import { intFlag } from '../args.js';
import { jsonDocument } from '../io.js';
import { normalizeDomain } from '../domain.js';
import type { CliContext } from '../run.js';
import { clean } from '../term.js';
import { UsageError } from '../usage-error.js';

const RANK_CSV_HEADER = 'keyword,domain,position,provider,url,retrievedAt';
const AUDIT_CSV_HEADER = 'url,score,pagesAudited,countsError,countsWarning,countsInfo,incomplete,provider,retrievedAt';

const parseSince = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/.exec(raw.trim());
  if (iso === null) throw new UsageError(`--since must be an ISO date/datetime (e.g. 2026-09-01 or 2026-09-01T00:00:00Z) — got "${clean(raw, 40)}"`);
  const normalized = raw.includes('T') ? raw : `${raw}T00:00:00Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new UsageError(`--since is not a valid date: "${clean(raw, 40)}"`);
  return date.toISOString(); // Z-form: lexicographic == chronological for our entries
};

const rowOf = (e: HistoryEntry): string =>
  isRankEntry(e)
    ? csvRow([e.keyword, e.domain, e.position, e.provider, e.url, e.retrievedAt])
    : csvRow([
        e.url,
        e.score,
        e.pagesAudited ?? '',
        e.countsBySeverity.error,
        e.countsBySeverity.warning,
        e.countsBySeverity.info,
        e.incomplete,
        e.provider,
        e.retrievedAt,
      ]);

const humanLine = (e: HistoryEntry): string =>
  isRankEntry(e)
    ? `  ${clean(e.keyword, 40)} @ ${clean(e.domain, 40)}: ${e.position === null || e.position === undefined ? 'not found' : `#${e.position}`} (${clean(e.provider)}) ${e.retrievedAt}`
    : `  ${clean(e.url, 80)}: score ${e.score ?? 'n/a'} · ${e.pagesAudited ?? '?'} pages${e.incomplete ? ' · INCOMPLETE' : ''} ${e.retrievedAt}`;

export const execute = async (ctx: CliContext, deps?: CommandDeps): Promise<number> => {
  const [sub] = ctx.positionals;
  if (sub !== 'audit' && sub !== 'rank' && sub !== 'prune') {
    throw new UsageError(`unknown history subcommand "${sub ?? ''}" — use lumen history audit | rank | prune`);
  }
  const d = deps ?? (await buildDeps(ctx.configPathFlag));
  const { io } = ctx;

  if (sub === 'prune') {
    const keep = intFlag(ctx.flags, 'keep');
    if (keep !== undefined && (keep < 1 || keep > 100)) throw new UsageError('--keep must be an integer 1..100');
    if (d.history.prune === undefined) {
      throw new UsageError('this history store does not support pruning (the JSONL store does)');
    }
    const removed = await d.history.prune({ keepGenerations: keep });
    io.out(`history: pruned ${removed} generation(s)\n`);
    return EXIT.OK;
  }

  const kind: HistoryKind = sub;
  const format = ctx.flags.format === undefined ? 'json' : String(ctx.flags.format);
  if (format !== 'json' && format !== 'csv') throw new UsageError('--format must be json or csv');
  if (ctx.flags.json === true && format === 'csv') throw new UsageError('--json and --format csv conflict — pick one output shape');
  const domainFlag = ctx.flags.domain;
  const domain = typeof domainFlag === 'string' && domainFlag !== '' ? normalizeDomain(domainFlag) : undefined;
  const since = parseSince(typeof ctx.flags.since === 'string' ? ctx.flags.since : undefined);
  const limit = intFlag(ctx.flags, 'limit');
  if (limit !== undefined && limit < 1) throw new UsageError('--limit must be >= 1');

  // I5: with --since, do NOT push limit into the store (it slices BEFORE
  // filtering); filter first, then slice client-side.
  let entries = await d.history.list({
    kind,
    ...(domain === undefined ? {} : { domain }),
    ...(since === undefined && limit !== undefined ? { limit } : {}),
  });
  if (since !== undefined) {
    entries = entries.filter((e) => e.retrievedAt >= since);
    if (limit !== undefined) entries = entries.slice(-limit);
  }

  if (format === 'csv') {
    const header = kind === 'rank' ? RANK_CSV_HEADER : AUDIT_CSV_HEADER;
    io.out(`${header}\n${entries.map(rowOf).join('\n')}${entries.length === 0 ? '' : '\n'}`);
    return EXIT.OK;
  }
  if (ctx.flags.json === true) {
    io.out(jsonDocument(entries));
    return EXIT.OK;
  }
  io.out(`history: ${kind}${domain === undefined ? '' : ` @ ${clean(domain, 60)}`}${since === undefined ? '' : ` since ${since}`} — ${entries.length} entries\n`);
  for (const e of entries.slice(-20).reverse()) io.out(`${humanLine(e)}\n`);
  if (entries.length > 20) io.out(`  … +${entries.length - 20} older (use --json or --limit)\n`);
  return EXIT.OK;
};
