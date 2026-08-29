/**
 * Onboarding payload tests (E11/B15): 8 deterministic snapshots (4 targets ×
 * local/remote), never embedding key material. The site/docs aspect consumes
 * these strings — any wording change must be a visible, reviewed diff.
 */
import { describe, expect, it } from 'vitest';
import { onboardPayload } from './onboard.js';

const REMOTE = 'https://mcp.example.com/mcp';
const TARGETS = ['json', 'claude', 'cursor', 'vscode'] as const;

describe('onboarding payloads (E11)', () => {
  it.each(TARGETS)('%s (local stdio) — snapshot', (target) => {
    expect(onboardPayload(target)).toMatchSnapshot(`onboard-${target}-local`);
  });

  it.each(TARGETS)('%s (remote http via --url) — snapshot', (target) => {
    expect(onboardPayload(target, REMOTE)).toMatchSnapshot(`onboard-${target}-remote`);
  });

  it('deterministic: identical inputs give byte-identical outputs (I10)', () => {
    for (const target of TARGETS) {
      expect(onboardPayload(target)).toBe(onboardPayload(target));
      expect(onboardPayload(target, REMOTE)).toBe(onboardPayload(target, REMOTE));
    }
  });

  it('never embeds key material (E11/I16)', () => {
    for (const target of TARGETS) {
      for (const payload of [onboardPayload(target), onboardPayload(target, REMOTE)]) {
        expect(payload).not.toMatch(/KEY|SECRET|TOKEN|sk-/i);
      }
    }
  });

  it('local json payload is a valid mcpServers snippet with the stdio command', () => {
    const parsed = JSON.parse(onboardPayload('json')) as {
      mcpServers: { lumen: { command: string; args: string[] } };
    };
    expect(parsed.mcpServers.lumen).toEqual({ command: 'npx', args: ['-y', '@lumen-seo/cli', 'mcp'] });
  });

  it('remote variants switch every target to the http server config (E11)', () => {
    expect(JSON.parse(onboardPayload('json', REMOTE))).toEqual({
      mcpServers: { lumen: { type: 'http', url: REMOTE } },
    });
    expect(onboardPayload('claude', REMOTE)).toBe(`claude mcp add --transport http lumen ${REMOTE}`);
  });
});
