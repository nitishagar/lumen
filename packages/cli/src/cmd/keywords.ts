/**
 * `lumen keywords <seed>` — merged keyword ideas from the configured (ready)
 * KeywordProviders. Every idea carries per-item provenance (I3); a provider
 * that fails degrades to an `unavailable` entry, never a crash (I17). Ideas
 * from multiple providers interleave deterministically (provider order, then
 * rank) and cap at --limit.
 */
import { EXIT, LumenError } from '@lumen-seo/core';
import type { KeywordIdea } from '@lumen-seo/core';
import { intFlag } from '../args.js';
import type { CommandDeps } from '../composition/node.js';
import { buildDeps } from '../composition/node.js';
import { jsonDocument } from '../io.js';
import type { CliContext } from '../run.js';
import { clean } from '../term.js';
import { ProviderUnconfiguredError } from '../usage-error.js';
import { validateLang, validateLimit, validateSeed } from '../validate.js';

/** Round-robin interleave (provider order, then rank) — deterministic (I10). */
const interleave = (perProvider: KeywordIdea[][]): KeywordIdea[] => {
  const out: KeywordIdea[] = [];
  const max = Math.max(0, ...perProvider.map((l) => l.length));
  for (let i = 0; i < max; i += 1) {
    for (const list of perProvider) {
      const item = list[i];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
};

export const execute = async (ctx: CliContext, deps?: CommandDeps): Promise<number> => {
  const d = deps ?? (await buildDeps(ctx.configPathFlag));
  const seed = validateSeed(ctx.positionals[0] ?? '');
  const limit = validateLimit(intFlag(ctx.flags, 'limit'));
  const lang = validateLang(ctx.flags.lang);

  if (d.keywords.length === 0) {
    throw new ProviderUnconfiguredError(
      'keywords',
      'no keywords provider configured — set "providers.keywords" in lumen.config.json',
    );
  }

  const unavailable: { provider: string; reason: string }[] = [];
  const perProvider = await Promise.all(
    d.keywords.map(async (p) => {
      try {
        return await p.ideas(seed, { limit, lang, signal: ctx.signal });
      } catch (err) {
        const reason = err instanceof LumenError ? err.message : 'provider call failed';
        unavailable.push({ provider: p.name, reason });
        return [];
      }
    }),
  );
  const ideas = interleave(perProvider).slice(0, limit);
  if (ideas.length === 0 && unavailable.length === d.keywords.length) {
    throw new LumenError(`all keywords providers failed: ${unavailable.map((u) => u.provider).join(', ')}`);
  }

  const attribution = [
    ...new Map(
      ideas
        .filter((i) => i.source.attribution !== undefined)
        .map((i) => [i.source.provider, i.source.attribution as string]),
    ).entries(),
  ].map(([provider, attributionText]) => ({ provider, attribution: attributionText }));

  const result = { seed, ideas, attribution, ...(unavailable.length > 0 ? { unavailable } : {}) };
  const { io } = ctx;
  if (ctx.flags.json === true) {
    io.out(jsonDocument(result));
    return EXIT.OK;
  }
  io.out(`keyword ideas for "${clean(seed)}" (limit ${limit}${lang === undefined ? '' : `, lang ${clean(lang)}`})\n`);
  for (const idea of ideas) {
    const label = idea.estimateLabel === undefined ? '' : ` [${clean(idea.estimateLabel, 40)}]`;
    io.out(`  ${clean(idea.term, 120)}${label} — ${clean(idea.source.provider)}/${clean(idea.source.kind)}\n`);
  }
  for (const u of unavailable) io.out(`  (unavailable: ${clean(u.provider)} — ${clean(u.reason, 120)})\n`);
  return EXIT.OK;
};
