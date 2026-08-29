import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPluginRules } from './node.js';
import { PluginLoadError } from './node.js';
import { createRuleRegistry } from './registry.js';

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const fixture = async (name: string, contents: string): Promise<{ cwd: string; path: string }> => {
  dir ??= await mkdtemp(join(tmpdir(), 'lumen-plugins-'));
  await writeFile(join(dir, name), contents);
  return { cwd: dir, path: `./${name}` };
};

describe('plugin loading (SC-8, Node-only)', () => {
  it('a valid default-exporting ESM module loads as an AuditRule', async () => {
    const { cwd, path } = await fixture(
      'valid.mjs',
      [
        'export default {',
        "  id: 'my-rule',",
        "  severity: 'info',",
        "  categories: ['seo'],",
        '  check: () => [],',
        '};',
        '',
      ].join('\n'),
    );
    const rules = await loadPluginRules([path], { cwd });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe('my-rule');
    expect(rules[0]?.severity).toBe('info');
  });

  it('a CommonJS plugin (module.exports) also satisfies the shape', async () => {
    const { cwd, path } = await fixture(
      'valid.cjs',
      ['module.exports = {', "  id: 'cjs-rule',", "  severity: 'warning',", "  categories: ['a11y'],", '  check: () => [],', '};', ''].join('\n'),
    );
    const rules = await loadPluginRules([path], { cwd });
    expect(rules[0]?.id).toBe('cjs-rule');
  });

  it('a wrong-shape default export → typed error naming the file', async () => {
    const { cwd, path } = await fixture('wrong-shape.mjs', 'export default { nope: true };\n');
    const err = await loadPluginRules([path], { cwd }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginLoadError);
    expect((err as PluginLoadError).message).toContain('wrong-shape.mjs');
  });

  it('an invalid severity in a plugin is rejected by shape validation', async () => {
    const { cwd, path } = await fixture(
      'bad-severity.mjs',
      ['export default {', "  id: 'bad',", "  severity: 'fatal',", "  categories: [],", '  check: () => [],', '};', ''].join('\n'),
    );
    await expect(loadPluginRules([path], { cwd })).rejects.toBeInstanceOf(PluginLoadError);
  });

  it('a missing file → typed error naming the file', async () => {
    const err = await loadPluginRules(['./does-not-exist.mjs'], { cwd: tmpdir() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginLoadError);
    expect((err as PluginLoadError).message).toContain('does-not-exist.mjs');
  });

  it('a module that throws on import → typed error naming the file', async () => {
    const { cwd, path } = await fixture('throws.mjs', 'throw new Error("boom");\n');
    const err = await loadPluginRules([path], { cwd }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginLoadError);
    expect((err as PluginLoadError).message).toContain('throws.mjs');
    expect((err as PluginLoadError).message).toContain('boom');
  });

  it('loaded plugin rules compose with the rule registry (plugin ids are known ids)', async () => {
    const { cwd, path } = await fixture(
      'compose.mjs',
      ['export default {', "  id: 'plugin-rule',", "  severity: 'info',", "  categories: ['seo'],", '  check: () => [],', '};', ''].join('\n'),
    );
    const pluginRules = await loadPluginRules([path], { cwd });
    const builtIn = {
      id: 'title-missing',
      severity: 'error' as const,
      categories: ['seo'],
      check: () => [],
    };
    const reg = createRuleRegistry([builtIn, ...pluginRules], { 'plugin-rule': 'warning' });
    expect(reg.effectiveSeverity('plugin-rule')).toBe('warning'); // override over plugin default
    expect(reg.list()).toHaveLength(2);
  });
});
