/**
 * `lumen indexnow submit <urls… | --from-sitemap <url>>` (E2.2) — lumen's
 * FIRST WRITE ACTION. Dry run by default (prints the exact payload + target,
 * never POSTs); `--yes` submits. The key file MUST be hosted and verifiable
 * at `https://<host>/<key>.txt` before anything is sent (mismatch refuses,
 * exit 2, zero POSTs). All fetches go through the guarded fetcher (SSRF);
 * verification happens in the CLI (the deps seam injects the transport for
 * tests). Never exposed as an MCP tool (PRD: CLI-only in v0.6).
 */
import { EXIT } from '@lumen-seo/core';
import { createNodeFetcher } from '@lumen-seo/core/node';
import type { Fetcher } from '@lumen-seo/core';
import type { CommandDeps } from '../composition/node.js';
import type { CliContext } from '../run.js';
import { clean } from '../term.js';
import { UsageError } from '../usage-error.js';

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS = 10_000;

export interface IndexNowDeps {
  /** Injectable transport seam (tests); default = the guarded node fetcher. */
  fetcher?: Fetcher;
}

/** Injectable transport seam (tests / the no-telemetry harness); default = the guarded node fetcher. */
const depsFor = (deps?: unknown): Fetcher =>
  (deps as { fetcher?: Fetcher } | undefined)?.fetcher ?? createNodeFetcher();

/** Extracts sitemap <loc> URLs (same-origin only, capped). */
const urlsFromSitemap = async (fetcher: Fetcher, sitemapUrl: URL, signal: AbortSignal | undefined): Promise<string[]> => {
  const res = await fetcher.fetch(sitemapUrl, { redirect: 'manual', signal });
  if (res.status !== 200) throw new UsageError(`sitemap ${sitemapUrl.href} returned HTTP ${res.status}`);
  const body = (await res.text()).slice(0, 2_000_000);
  const locs = [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
  const sameHost = locs
    .map((loc) => {
      try {
        return new URL(loc, sitemapUrl);
      } catch {
        return undefined;
      }
    })
    .filter((u): u is URL => u !== undefined && u.origin === sitemapUrl.origin)
    .map((u) => u.href);
  if (sameHost.length === 0) throw new UsageError(`sitemap ${sitemapUrl.href} contained no usable same-origin URLs`);
  return sameHost.slice(0, MAX_URLS);
};

export const execute = async (ctx: CliContext, deps?: CommandDeps): Promise<number> => {
  const { io, signal } = ctx;
  const urls = ctx.positionals.slice(1).map((raw) => {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme');
      return u;
    } catch {
      throw new UsageError(`invalid URL "${clean(raw, 80)}"`);
    }
  });
  const key = ctx.flags.key !== undefined ? String(ctx.flags.key) : process.env.LUMEN_INDEXNOW_KEY;
  if (key === undefined || key === '') {
    throw new UsageError('an IndexNow key is required — pass --key <key> or set LUMEN_INDEXNOW_KEY');
  }
  const fetcher = depsFor(deps);

  const sitemapFlag = ctx.flags['from-sitemap'];
  let allUrls: URL[];
  if (sitemapFlag !== undefined) {
    let sitemapUrl: URL;
    try {
      sitemapUrl = new URL(String(sitemapFlag));
    } catch {
      throw new UsageError(`invalid sitemap URL "${clean(String(sitemapFlag), 80)}"`);
    }
    allUrls = (await urlsFromSitemap(fetcher, sitemapUrl, signal)).map((u) => new URL(u));
  } else {
    allUrls = urls;
  }
  if (allUrls.length > MAX_URLS) {
    allUrls = allUrls.slice(0, MAX_URLS);
    io.err(`capped at ${MAX_URLS} URLs\n`);
  }
  if (allUrls.length === 0) throw new UsageError('no URLs to submit');

  // Group by host: IndexNow keys are per-host; one submission per host.
  const byHost = new Map<string, URL[]>();
  for (const u of allUrls) {
    const list = byHost.get(u.host) ?? [];
    list.push(u);
    byHost.set(u.host, list);
  }

  // Key-file verification per host: GET https://<host>/<key>.txt must return the key EXACTLY.
  for (const [host, hostUrls] of byHost) {
    const anyUrl = hostUrls[0]!;
    const verifyUrl = new URL(`/${key}.txt`, anyUrl);
    const res = await fetcher.fetch(verifyUrl, { redirect: 'manual', signal });
    const body = res.status === 200 ? (await res.text()).trim() : '';
    if (res.status !== 200 || body !== key) {
      throw new UsageError(
        `key verification failed for ${host}: GET ${verifyUrl.href} returned ${res.status === 200 ? `a mismatching body (expected the key)` : `HTTP ${res.status}`} — host the key file first`,
      );
    }
  }

  const submit = ctx.flags.yes === true;
  const payloadFor = (host: string, hostUrls: URL[]): string =>
    JSON.stringify(
      {
        host,
        key,
        keyLocation: `https://${host}/${key}.txt`,
        urlList: hostUrls.map((u) => u.href),
      },
      null,
      2,
    );

  if (!submit) {
    io.out(`indexnow: DRY RUN (${allUrls.length} URL(s), ${byHost.size} host(s)) — pass --yes to submit\n`);
    for (const [host, hostUrls] of byHost) {
      io.out(`POST ${INDEXNOW_ENDPOINT}\n${payloadFor(host, hostUrls)}\n`);
    }
    return EXIT.OK;
  }

  let failures = 0;
  for (const [host, hostUrls] of byHost) {
    const res = await fetcher.fetch(new URL(INDEXNOW_ENDPOINT), {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: payloadFor(host, hostUrls),
      signal,
    });
    // IndexNow: 200/202 = accepted; anything else = failure for that host.
    if (res.status === 200 || res.status === 202) {
      io.out(`indexnow: ${host} — accepted (${hostUrls.length} URL(s))\n`);
    } else {
      failures += 1;
      io.err(`indexnow: ${host} — HTTP ${res.status}\n`);
    }
  }
  return failures === 0 ? EXIT.OK : EXIT.CONFIG_ERROR;
};
