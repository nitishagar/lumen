/**
 * `lumen rank <keyword> --domain <d>` (B11/E4/E14): SERP position check via
 * the configured SerpProvider. Not-found is SUCCESS (found:false,
 * position:null, exit 0). Exactly one RankHistoryEntry line is appended after
 * a successful provider result unless --no-save; `found` is derived
 * (position !== null), never persisted.
 */
import { EXIT } from '@lumen-seo/core';
import { intFlag } from '../args.js';
import type { CommandDeps } from '../composition/node.js';
import { buildDeps } from '../composition/node.js';
import { matchesDomain, normalizeDomain } from '../domain.js';
import { jsonDocument } from '../io.js';
import type { CliContext } from '../run.js';
import { clean } from '../term.js';
import { ProviderUnconfiguredError, UsageError } from '../usage-error.js';
import { validateLimit, validateSeed } from '../validate.js';

export const execute = async (ctx: CliContext, deps?: CommandDeps): Promise<number> => {
  const d = deps ?? (await buildDeps(ctx.configPathFlag));
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
