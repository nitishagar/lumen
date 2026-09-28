/**
 * `lumen authority` first-run hint tests (PRD E0.4 FR-3, reviewer finding C1):
 * the "run lumen doctor" hint must fire in BOTH reachable not-configured
 * shapes — the composition skip rule (early-return branch) and a wired
 * provider failing with the typed NotConfiguredError at call time — and must
 * NEVER appear in --json output (the JSON contract is unchanged).
 */
import { describe, expect, it } from 'vitest';
import { fixtureAuthorityProvider } from '@lumen-seo/mcp/testkit';
import { NotConfiguredError } from '@lumen-seo/providers';
import type { CommandDeps } from './composition/node.js';
import { MemoryIo } from './io.js';
import { execute as authority } from './cmd/authority.js';
import type { CliContext } from './run.js';

const depsWith = (over: Partial<CommandDeps> = {}): CommandDeps => ({
  clock: () => '2026-08-29T09:30:00Z',
  failThreshold: 'error',
  keywords: [],
  authority: [],
  authorityUnconfigured: [],
  history: { append: async () => undefined, list: async () => [] },
  ...over,
});

const ctx = (flags: Record<string, string | boolean> = {}): CliContext & { io: MemoryIo } => {
  const io = new MemoryIo();
  return {
    io,
    signal: new AbortController().signal,
    positionals: ['example.com'],
    flags,
    configPathFlag: undefined,
  };
};

describe('authority first-run hint (FR-3)', () => {
  it('skip-rule branch: all authority providers unconfigured → hint in human mode, not in --json', async () => {
    const human = ctx({});
    const code = await authority(human, depsWith({ authority: [], authorityUnconfigured: ['tranco', 'openpagerank'] }));
    expect(code).toBe(0);
    const text = human.io.stdout.join('');
    expect(text).toContain('unconfigured');
    expect(text).toContain('run "lumen doctor" for key setup.');

    const json = ctx({ json: true });
    await authority(json, depsWith({ authority: [], authorityUnconfigured: ['tranco'] }));
    const out = json.io.stdout.join('');
    expect(JSON.parse(out)).toMatchObject({ domain: 'example.com', signals: [], unconfigured: ['tranco'] });
    expect(out).not.toContain('lumen doctor');
  });

  it('wired provider failing with NotConfiguredError → hint fires; JSON payload keeps unavailable', async () => {
    const failing = {
      name: 'fixture-openpagerank',
      authority: async () => {
        throw new NotConfiguredError('openpagerank', 'LUMEN_OPR_KEY', 'https://www.openpagerank.com/');
      },
    };
    const human = ctx({});
    const code = await authority(human, depsWith({ authority: [failing] }));
    expect(code).toBe(0);
    const text = human.io.stdout.join('');
    expect(text).toContain('unavailable');
    expect(text).toContain('run "lumen doctor" for key setup.');

    const json = ctx({ json: true });
    await authority(json, depsWith({ authority: [failing] }));
    const out = json.io.stdout.join('');
    const doc = JSON.parse(out) as { unavailable: { provider: string }[] };
    expect(doc.unavailable[0]?.provider).toBe('fixture-openpagerank');
    expect(out).not.toContain('lumen doctor');
  });

  it('healthy signals → no hint', async () => {
    const human = ctx({});
    await authority(human, depsWith({ authority: [fixtureAuthorityProvider()] }));
    expect(human.io.stdout.join('')).not.toContain('lumen doctor');
    expect(human.io.stdout.join('')).toContain('42');
  });
});
