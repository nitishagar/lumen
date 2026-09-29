/**
 * contract-counts.test.mjs — README/docs ↔ registry drift gate (PRD hygiene
 * P0 "README ↔ npm drift check", P-Honest applies to marketing). The
 * ci-scripts project is dependency-free plain Node, so the TS registries are
 * parsed from source by regex — the same tables the code itself loads:
 *
 *   rules    — `packages/audit/src/rules/rule-set.ts` `{ id: '…'` rows
 *   commands — `packages/cli/src/args.ts` COMMAND_NAMES literal
 *   tools    — `packages/mcp/src/schemas.ts` TOOL_NAMES literal
 *
 * Every count sentence the known prose patterns match must equal the
 * registry counts, and each guarded file must produce at least one hit (a
 * wording change that escapes the patterns fails loudly here rather than
 * decorating a green build with a stale number).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** Entries like `{ id: 'title-missing', … }` in the built-in rule table. */
const ruleRegistry = () => {
  const src = read('packages/audit/src/rules/rule-set.ts');
  const ids = [...src.matchAll(/\{\s*id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
  if (ids.length === 0) throw new Error('no rule ids parsed from rule-set.ts — regex or table moved');
  return [...new Set(ids)].sort();
};

/** `export const X = ['a', 'b', …] as const` first array literal. */
const constArray = (file, name) => {
  const src = read(file);
  const m = src.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (m === null) throw new Error(`${name} literal not found in ${file}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

/** Every `\d+` the prose patterns pin, with at least one hit required. */
const proseCounts = (text, source) => {
  const patterns = [/(\d+) built-in rule/g, /ships (\d+) built-in/g, /The (\d+) rules/g, /the (\d+) rules/g];
  const hits = [];
  for (const p of patterns) {
    for (const m of text.matchAll(p)) hits.push({ n: Number(m[1]), source, pattern: p.source });
  }
  return hits;
};

describe('contract counts — prose, locked-names, and registries agree (I4)', () => {
  const rules = ruleRegistry();
  const commands = constArray('packages/cli/src/args.ts', 'COMMAND_NAMES');
  const tools = constArray('packages/mcp/src/schemas.ts', 'TOOL_NAMES');
  const locked = JSON.parse(read('site/src/data/locked-names.json'));

  it('registry counts are parsed (guard against silent regex rot)', () => {
    expect(rules.length).toBeGreaterThan(0);
    expect(commands.length).toBeGreaterThan(0);
    expect(tools.length).toBeGreaterThan(0);
  });

  it('locked-names arrays equal the registries', () => {
    const subcommandOf = { config: 'config show', indexnow: 'indexnow submit' };
    expect(locked.cliCommands).toEqual(commands.map((c) => subcommandOf[c] ?? c));
    expect(locked.mcpTools).toEqual(tools);
  });

  it('root README prose counts equal the rule registry', () => {
    const hits = proseCounts(read('README.md'), 'README.md');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.n, `${h.pattern} in README.md`).toBe(rules.length);
  });

  it('rules-reference prose counts equal the rule registry', () => {
    const hits = proseCounts(read('site/src/pages/docs/rules-reference.astro'), 'rules-reference.astro');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.n, `${h.pattern} in rules-reference.astro`).toBe(rules.length);
  });

  it('CHANGELOG 0.3.0 claims the shipped rule count', () => {
    const changelog = read('CHANGELOG.md');
    const section = changelog.split('## [0.3.0]')[1]?.split('## [')[0];
    expect(section, 'CHANGELOG has a [0.3.0] section').toBeDefined();
    expect(section).toMatch(new RegExp(`\\b${rules.length} (built-in )?rules\\b`));
  });

  it('package README for cli does not contradict the rule registry', () => {
    const text = read('packages/cli/README.md');
    const hits = proseCounts(text, 'packages/cli/README.md');
    for (const h of hits) expect(h.n, `${h.pattern} in packages/cli/README.md`).toBe(rules.length);
  });
});
