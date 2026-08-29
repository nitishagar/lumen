/**
 * `lumen report <url>` (E1/I1/I3/E8): PSI lab + CrUX field + local page meta.
 * Each leg degrades independently to `{status:"unavailable", reason}` — a
 * missing BYOK key or a failed provider never crashes the report and never
 * zero-fills (I3); the command exits 0 while any leg is answerable.
 * Provenance (source + retrievedAt) rides on every metric.
 */
import { EXIT, LumenError } from '@lumen-seo/core';
import type { CruxRecord, PageSpeedReport } from '@lumen-seo/core';
import type { PageMeta } from '@lumen-seo/mcp/ports';
import { validatePublicHttpUrl } from '@lumen-seo/mcp/url-guard';
import type { CommandDeps } from '../composition/node.js';
import { buildDeps } from '../composition/node.js';
import { jsonDocument } from '../io.js';
import type { CliContext } from '../run.js';
import { clean } from '../term.js';
import { UsageError } from '../usage-error.js';

export interface Unavailable {
  status: 'unavailable';
  reason: string;
}

type Lab = (PageSpeedReport & { retrievedAt: string }) | Unavailable;
type Field = CruxRecord | Unavailable;
type Meta = (PageMeta & { retrievedAt: string }) | Unavailable;

export const execute = async (ctx: CliContext, deps?: CommandDeps): Promise<number> => {
  const d = deps ?? (await buildDeps(ctx.configPathFlag));
  const guard = validatePublicHttpUrl(ctx.positionals[0]);
  if (!guard.ok) throw new UsageError(guard.message);
  const url = guard.url;

  const strategyFlag = ctx.flags.strategy === undefined ? 'mobile' : String(ctx.flags.strategy);
  if (strategyFlag !== 'mobile' && strategyFlag !== 'desktop') {
    throw new UsageError('--strategy must be mobile or desktop');
  }

  const retrievedAt = d.clock();
  const reason = (r: string | undefined, fallback: string): string => r ?? fallback;

  const labP: Promise<Lab> =
    d.pageSpeed === undefined
      ? Promise.resolve(unavailable(reason(d.pagespeedUnconfigured, 'pagespeed provider not configured — set "providers.pagespeed" in lumen.config.json')))
      : d.pageSpeed
          .report(url, { strategy: strategyFlag, signal: ctx.signal })
          .then((r) => ({ ...r, retrievedAt }))
          .catch((err: unknown) => unavailable(legReason(err)));
  const fieldP: Promise<Field> =
    d.crux === undefined
      ? Promise.resolve(unavailable(reason(d.cruxUnconfigured, 'crux provider not configured — set "providers.crux" in lumen.config.json (BYOK)')))
      : d.crux
          .record(url, { signal: ctx.signal })
          .then((r) => (r === null ? unavailable('no CrUX field data for this URL (insufficient coverage or key not accepted)') : r))
          .catch((err: unknown) => unavailable(legReason(err)));
  const metaP: Promise<Meta> =
    d.pageMeta === undefined
      ? Promise.resolve(unavailable('local page-meta fetch is not wired in this build'))
      : d.pageMeta
          .fetch(url, ctx.signal)
          .then((r) => (r === null ? unavailable('page meta unavailable') : { ...r, retrievedAt }))
          .catch((err: unknown) => unavailable(legReason(err)));

  const [lab, field, meta] = await Promise.all([labP, fieldP, metaP]);

  const sources: { provider: string; attribution: string }[] = [];
  if (!('status' in lab)) sources.push({ provider: lab.source.provider, attribution: lab.source.attribution ?? lab.source.kind });
  if (!('status' in field)) sources.push({ provider: field.source.provider, attribution: field.source.attribution ?? field.source.kind });
  const attribution = [
    ...new Map(sources.filter((s) => s.attribution !== undefined).map((s) => [s.provider, s])).values(),
  ].map(({ provider, attribution: attributionText }) => ({ provider, attribution: attributionText }));

  const result = {
    url: url.href,
    strategy: strategyFlag,
    lab,
    field,
    meta,
    attribution,
    limitations: [
      'lab data is a single synthetic Lighthouse run, not field data',
      'field data covers Chromium-origin traffic only',
    ],
  };

  const { io } = ctx;
  if (ctx.flags.json === true) {
    io.out(jsonDocument(result));
    return EXIT.OK;
  }
  io.out(`report: ${clean(url.href)} (${strategyFlag})\n`);
  if ('status' in lab) io.out(`  lab: unavailable — ${clean(lab.reason, 160)}\n`);
  else {
    io.out(
      `  lab: performance ${lab.scores.performance ?? 'n/a'}  lcp ${lab.metrics.lcp ?? 'n/a'}ms  cls ${lab.metrics.cls ?? 'n/a'} (${clean(lab.source.provider)})\n`,
    );
  }
  if ('status' in field) io.out(`  field: unavailable — ${clean(field.reason, 160)}\n`);
  else {
    const first = Object.keys(field.metrics)[0];
    const p75 = first === undefined ? '' : ` ${first} p75 ${field.metrics[first]?.p75 ?? 'n/a'}`;
    io.out(`  field: crux${p75} (${clean(field.source.provider)})\n`);
  }
  if ('status' in meta) io.out(`  meta: unavailable — ${clean(meta.reason, 160)}\n`);
  else {
    io.out(
      `  meta: title: ${clean(meta.title ?? 'n/a', 120)}\n  h1: ${clean(meta.h1[0] ?? 'n/a', 120)} (${clean(meta.lang ?? 'n/a')})\n`,
    );
  }
  return EXIT.OK;
};

const unavailable = (reasonText: string): Unavailable => ({ status: 'unavailable', reason: reasonText });

const legReason = (err: unknown): string =>
  err instanceof LumenError ? `${err.label ?? err.name}: ${err.message}` : 'provider call failed';
