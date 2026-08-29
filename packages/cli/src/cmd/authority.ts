/**
 * `lumen authority <domain>` — authority signals from the configured (ready)
 * AuthorityProviders. Providers skipped for a missing BYOK key are listed in
 * `unconfigured` (I1/E5); provider failures degrade to `unavailable` (I17).
 * Every signal carries attribution + retrievedAt (I3/I8).
 */
import { EXIT, LumenError } from '@lumen-seo/core';
import type { CommandDeps } from '../composition/node.js';
import { buildDeps } from '../composition/node.js';
import { normalizeDomain } from '../domain.js';
import { jsonDocument } from '../io.js';
import type { CliContext } from '../run.js';
import { clean } from '../term.js';
import { ProviderUnconfiguredError } from '../usage-error.js';

export const execute = async (ctx: CliContext, deps?: CommandDeps): Promise<number> => {
  const d = deps ?? (await buildDeps(ctx.configPathFlag));
  const domain = normalizeDomain(ctx.positionals[0] ?? '');

  if (d.authority.length === 0) {
    if (d.authorityUnconfigured.length > 0) {
      // All configured providers are BYOK-gated and their keys are absent —
      // an explicit, honest answer (I1), not an error.
      const result = { domain, signals: [], unconfigured: [...d.authorityUnconfigured] };
      if (ctx.flags.json === true) ctx.io.out(jsonDocument(result));
      else {
        ctx.io.out(`authority: ${clean(domain)}\n`);
        for (const p of d.authorityUnconfigured) {
          ctx.io.out(`  ${clean(p)}: unconfigured (set its BYOK env var — see "lumen config show")\n`);
        }
      }
      return EXIT.OK;
    }
    throw new ProviderUnconfiguredError(
      'authority',
      'no authority provider configured — set "providers.authority" in lumen.config.json',
    );
  }

  const retrievedAt = d.clock();
  const unavailable: { provider: string; reason: string }[] = [];
  const signals = (
    await Promise.all(
      d.authority.map(async (p) => {
        try {
          return await p.authority(domain, { signal: ctx.signal });
        } catch (err) {
          const reason = err instanceof LumenError ? err.message : 'provider call failed';
          unavailable.push({ provider: p.name, reason });
          return [];
        }
      }),
    )
  ).flat();

  const result = {
    domain,
    signals: signals.map((s) => ({
      provider: s.provider,
      kind: s.kind,
      value: s.value,
      attribution: s.attribution,
      retrievedAt,
    })),
    unconfigured: [...d.authorityUnconfigured],
    ...(unavailable.length > 0 ? { unavailable } : {}),
  };
  const { io } = ctx;
  if (ctx.flags.json === true) {
    io.out(jsonDocument(result));
    return EXIT.OK;
  }
  io.out(`authority: ${clean(domain)}\n`);
  for (const s of result.signals) {
    io.out(`  ${clean(s.provider)}/${clean(s.kind)}: ${s.value} — ${clean(s.attribution, 120)}\n`);
  }
  for (const p of result.unconfigured) {
    io.out(`  ${clean(p)}: unconfigured (set its BYOK env var — see "lumen config show")\n`);
  }
  for (const u of unavailable) io.out(`  (unavailable: ${clean(u.provider)} — ${clean(u.reason, 120)})\n`);
  return EXIT.OK;
};
