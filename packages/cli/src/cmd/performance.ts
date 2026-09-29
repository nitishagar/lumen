/**
 * `lumen performance <site> [--days N] [--by query|page] [--json]` (E2.1):
 * first-party Google Search Console rows. Credentials are a PATH
 * (LUMEN_GSC_CREDENTIALS) read at call time — contents never logged.
 */
import { EXIT } from '@lumen-seo/core';
import { createGscProvider } from '@lumen-seo/providers/node';
import { GSC_PACING } from '@lumen-seo/providers/node';
import { GcraPacer } from '@lumen-seo/providers';
import { InMemoryCache } from '@lumen-seo/providers';
import { createNodeFetcher } from '@lumen-seo/core/node';
import type { CommandDeps } from '../composition/node.js';
import { jsonDocument } from '../io.js';
import type { CliContext } from '../run.js';
import { clean } from '../term.js';
import { ProviderUnconfiguredError, UsageError } from '../usage-error.js';

export const execute = async (ctx: CliContext, deps?: CommandDeps): Promise<number> => {
  const { io } = ctx;
  const siteRaw = ctx.positionals[0];
  if (siteRaw === undefined || siteRaw === '') throw new UsageError('a site is required (e.g. lumen performance https://example.com or sc-domain:example.com)');
  // sc-domain:x is a DOMAIN property (GSC's own form) and passes through as-is;
  // URL-prefix properties are given as their https:// URL.
  let site: URL;
  try {
    site = new URL(siteRaw);
    if (site.protocol !== 'http:' && site.protocol !== 'https:' && site.protocol !== 'sc-domain:') {
      throw new Error('scheme');
    }
  } catch {
    throw new UsageError(`invalid site "${clean(siteRaw, 80)}" — use https://example.com/ or sc-domain:example.com`);
  }
  const days = ctx.flags.days === undefined ? 28 : Number(ctx.flags.days);
  if (!Number.isInteger(days) || days < 1 || days > 500) throw new UsageError('--days must be an integer 1..500');
  const by = ctx.flags.by === undefined ? 'query' : String(ctx.flags.by);
  if (by !== 'query' && by !== 'page') throw new UsageError('--by must be query or page');

  const provider =
    deps?.performanceProvider ??
    (() => {
      const credPath = process.env.LUMEN_GSC_CREDENTIALS;
      if (credPath === undefined || credPath === '') {
        throw new ProviderUnconfiguredError('performance', 'set LUMEN_GSC_CREDENTIALS to the PATH of a service-account JSON with Search Console access');
      }
      return createGscProvider({
        credentialsPath: credPath,
        fetcher: createNodeFetcher(),
        cache: new InMemoryCache(),
        pacer: new GcraPacer(GSC_PACING.rpm, GSC_PACING.burst, Date.now, () => new Promise((r) => setTimeout(r, 1))),
        clock: Date.now,
      });
    })();

  const report = await provider.performance(site, { days, by });
  if (ctx.flags.json === true) {
    io.out(jsonDocument(report));
    return EXIT.OK;
  }
  io.out(`performance: ${clean(site.href)} — last ${days} days by ${by} (source: gsc, first-party)\n`);
  io.out('  clicks  imps    pos    key\n');
  for (const r of report.rows.slice(0, 20)) {
    io.out(`  ${String(r.clicks).padStart(6)}  ${String(r.impressions).padStart(6)}  ${r.position === null ? '   n/a' : String(r.position).padStart(5)}  ${clean(r.key, 80)}\n`);
  }
  if (report.rows.length > 20) io.out(`  … +${report.rows.length - 20} more (use --json)\n`);
  return EXIT.OK;
};
