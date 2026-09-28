/**
 * Onboarding payload tests (E11/B15): deterministic snapshots (7 targets —
 * 4 connection × local/remote + 3 distribution artifacts), never embedding
 * key material. The site/docs aspect consumes these strings — any wording
 * change must be a visible, reviewed diff.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { onboardPayload } from './onboard.js';

const REMOTE = 'https://mcp.example.com/mcp';
const TARGETS = ['json', 'claude', 'cursor', 'vscode'] as const;
const DISTRIBUTION_TARGETS = ['mcpb', 'registry', 'claude-plugin'] as const;

describe('onboarding payloads (E11)', () => {
  it.each(TARGETS)('%s (local stdio) — snapshot', (target) => {
    expect(onboardPayload(target)).toMatchSnapshot(`onboard-${target}-local`);
  });

  it.each(TARGETS)('%s (remote http via --url) — snapshot', (target) => {
    expect(onboardPayload(target, REMOTE)).toMatchSnapshot(`onboard-${target}-remote`);
  });

  it.each(DISTRIBUTION_TARGETS)('%s (distribution artifact) — snapshot', (target) => {
    expect(onboardPayload(target)).toMatchSnapshot(`onboard-${target}`);
  });

  it('deterministic: identical inputs give byte-identical outputs (I10)', () => {
    for (const target of [...TARGETS, ...DISTRIBUTION_TARGETS]) {
      expect(onboardPayload(target)).toBe(onboardPayload(target));
      expect(onboardPayload(target, REMOTE)).toBe(onboardPayload(target, REMOTE));
    }
  });

  it('never embeds key material in connection payloads (E11/I16)', () => {
    for (const target of TARGETS) {
      for (const payload of [onboardPayload(target), onboardPayload(target, REMOTE)]) {
        expect(payload).not.toMatch(/KEY|SECRET|TOKEN|sk-/i);
      }
    }
  });

  it('distribution payloads carry env-var NAMES only — never a name paired with a value (E11/I16, PRD E0.3)', () => {
    // The distribution artifacts legitimately NAME the three BYOK env vars
    // (isSecret/sensitive declarations), so the generic /KEY/ sentinel cannot
    // apply; the pinned contract is: only the three locked names may appear,
    // and a name must never be paired with a value.
    const ALLOWED_NAMES = ['LUMEN_PSI_KEY', 'LUMEN_CRUX_KEY', 'LUMEN_OPR_KEY'];
    for (const target of DISTRIBUTION_TARGETS) {
      const payload = onboardPayload(target);
      const valuePairs = payload.match(/LUMEN_[A-Z_]+KEY["']?\s*[:=]\s*["'][^"']+["']/g) ?? [];
      expect(valuePairs, `${target} must never pair a key name with a value`).toEqual([]);
      const named = [...payload.matchAll(/LUMEN_[A-Z_]+KEY/g)].map((m) => m[0]);
      for (const name of named) expect(ALLOWED_NAMES).toContain(name);
      if (target === 'registry') {
        const parsed = JSON.parse(payload) as {
          packages: { environmentVariables: { name: string; isSecret: boolean }[] }[];
        };
        expect(parsed.packages).toHaveLength(1);
        const pkg = parsed.packages[0]!;
        for (const env of pkg.environmentVariables) {
          expect(ALLOWED_NAMES).toContain(env.name);
          expect(env.isSecret).toBe(true);
        }
      }
    }
  });

  it('distribution payloads are connection-independent: --url changes nothing', () => {
    for (const target of DISTRIBUTION_TARGETS) {
      expect(onboardPayload(target, REMOTE)).toBe(onboardPayload(target));
    }
  });

  it('registry payload mirrors the repo-root server.json — the anti-drift oracle (PRD E0.3 FR-5)', () => {
    // The ci-scripts suite cannot import TS, so the payload↔file equality is
    // pinned here where the constant lives: drift on either side fails.
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const file = JSON.parse(readFileSync(join(repoRoot, 'server.json'), 'utf8'));
    expect(JSON.parse(onboardPayload('registry'))).toEqual(file);
  });

  it('local json payload is a valid mcpServers snippet with the stdio command', () => {
    const parsed = JSON.parse(onboardPayload('json')) as {
      mcpServers: { lumen: { command: string; args: string[] } };
    };
    expect(parsed.mcpServers.lumen).toEqual({ command: 'npx', args: ['-y', '@lumen-seo/cli', 'mcp'] });
  });

  it('remote variants switch every connection target to the http server config (E11)', () => {
    expect(JSON.parse(onboardPayload('json', REMOTE))).toEqual({
      mcpServers: { lumen: { type: 'http', url: REMOTE } },
    });
    expect(onboardPayload('claude', REMOTE)).toBe(`claude mcp add --transport http lumen '${REMOTE}'`);
  });
});
