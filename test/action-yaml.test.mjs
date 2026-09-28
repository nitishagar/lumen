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
    for (const input of ['url', 'baseline', 'fail-threshold', 'max-pages', 'upload-sarif', 'start-command', 'wait-on']) {
      expect(action.inputs[input], `input ${input}`).toBeDefined();
    }
    expect(action.inputs.url.required).toBe(true);
  });

  it('the e2e workflow parses and references the action by its real path', () => {
    const wf = read('.github/workflows/lumen-action-e2e.yml');
    const steps = wf.jobs['audit-preview'].steps;
    const auditStep = steps.find((s) => s.uses && String(s.uses).startsWith('./action'));
    expect(auditStep?.uses).toBe('./action'); // not './.action' — that path does not exist
    expect(wf.permissions['security-events']).toBe('write');
    const seed = steps.find((s) => s.name && String(s.name).startsWith('Seed a regression'));
    expect(String(seed.run)).toContain('subn');
  });
});
