/**
 * YAML sanity gate (plan M13): the composite action and its e2e workflow must
 * parse, and the workflow must reference the action by its real path — the
 * class of bug an import-walk or typo would otherwise ship silently.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const read = (p) => yaml.load(readFileSync(join(HERE, '..', p), 'utf8'));
import { join } from 'node:path';

describe('action + workflow YAML (E1.4)', () => {
  it('action/action.yml parses with the required inputs and composite runner', () => {
    const action = read('action/action.yml');
    expect(action.runs.using).toBe('composite');
    for (const input of ['url', 'baseline', 'fail-threshold', 'max-pages', 'upload-sarif', 'start-command', 'wait-on', 'source-map']) {
      expect(action.inputs[input], `input ${input}`).toBeDefined();
    }
    expect(action.inputs.url.required).toBe(true);
    const sarifStep = action.runs.steps.find((s) => String(s.name).includes('SARIF artifact'));
    expect(String(sarifStep.run)).toContain('--source-map');
    expect(String(sarifStep.env.LUMEN_SOURCE_MAP)).toContain('inputs.source-map');
    // Optional args accumulate in ARGS[@] — a flat unquoted $SOURCE_MAP would
    // glob-expand against the checkout (v0.3.0 e2e: "expects <url>" exit 2).
    for (const step of action.runs.steps.filter((s) => String(s.run ?? '').includes('npx -y @lumen-seo/cli'))) {
      expect(String(step.run)).toContain('"${ARGS[@]}"');
    }
  });

  it('the e2e workflow parses and references the action by its real path', () => {
    const wf = read('.github/workflows/lumen-action-e2e.yml');
    const steps = wf.jobs['audit-preview'].steps;
    const auditStep = steps.find((s) => s.uses && String(s.uses).startsWith('./action'));
    expect(auditStep?.uses).toBe('./action'); // not './.action' — that path does not exist
    expect(wf.permissions['security-events']).toBe('write');
    const seed = steps.find((s) => s.name && String(s.name).startsWith('Seed a regression'));
    expect(String(seed.run)).toContain('subn');
    // Verdict ownership: the audit never fails the job directly; both
    // asserts are always()-qualified so they run even after an audit failure.
    expect(auditStep['continue-on-error']).toBe(true);
    for (const name of ['Assert the audit outcome', 'Assert the green path succeeded (default runs)']) {
      const assert = steps.find((s) => s.name === name);
      expect(String(assert.if)).toContain('always()');
    }
  });
});
