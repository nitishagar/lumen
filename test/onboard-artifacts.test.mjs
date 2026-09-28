/**
 * onboard-artifacts.test.mjs — artifact shape checks (PRD E0.3): `server.json`,
 * `mcpb/manifest.json`, and the plugin manifests are repo-root files the
 * release workflow consumes. This test shape-checks them against the mcpb
 * v0.3 / marketplace / registry contracts. The payload↔file anti-drift
 * comparison lives in `packages/mcp/src/onboard.test.ts` (the ci-scripts
 * project is dependency-free plain Node and cannot import the TS payload).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

const BYOK_ENV_NAMES = ['LUMEN_PSI_KEY', 'LUMEN_CRUX_KEY', 'LUMEN_OPR_KEY'];

describe('distribution artifacts ↔ shipped onboarding payloads (I1/I2/I6)', () => {
  const serverJson = readJson('server.json');
  const mcpbManifest = readJson('mcpb/manifest.json');
  const marketplace = readJson('.claude-plugin/marketplace.json');
  const pluginJson = readJson('plugin-lumen/.claude-plugin/plugin.json');
  const pluginMcp = readJson('plugin-lumen/.mcp.json');

  it('server.json matches the registry schema shape pinned 2026-09-28', () => {
    expect(serverJson.$schema).toBe('https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
    expect(serverJson.name).toBe('io.github.nitishagar/lumen');
    expect(serverJson.repository).toEqual({ url: 'https://github.com/nitishagar/lumen', source: 'github' });
    expect(serverJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(serverJson.packages).toHaveLength(1);
    const pkg = serverJson.packages[0];
    expect(pkg.registryType).toBe('npm');
    expect(pkg.identifier).toBe('@lumen-seo/cli');
    expect(pkg.transport).toEqual({ type: 'stdio' });
    expect(pkg.version).toBe(serverJson.version);
    expect(pkg.environmentVariables.map((e) => e.name)).toEqual(BYOK_ENV_NAMES);
    for (const env of pkg.environmentVariables) {
      expect(env.isSecret).toBe(true);
      expect(env.isRequired).toBe(false);
    }
  });

  it('packages/cli/package.json carries the matching mcpName (registry validation)', () => {
    const cli = readJson('packages/cli/package.json');
    expect(cli.mcpName).toBe(serverJson.name);
  });

  it('mcpb manifest is a valid v0.3 node manifest with the BYOK env delivery', () => {
    expect(mcpbManifest.manifest_version).toBe('0.3');
    expect(mcpbManifest.server.type).toBe('node');
    expect(mcpbManifest.server.entry_point).toBe('server.js');
    expect(mcpbManifest.server.mcp_config.command).toBe('node');
    expect(mcpbManifest.server.mcp_config.args).toEqual(['${__dirname}/server.js']);
    // user_config keys must be delivered as env vars (PRD E0.3 FR-2).
    for (const name of BYOK_ENV_NAMES) {
      expect(mcpbManifest.server.mcp_config.env[name]).toBe(`\${user_config.${name}}`);
      expect(mcpbManifest.user_config[name]).toMatchObject({ type: 'string', sensitive: true, required: false });
    }
    expect(Object.keys(mcpbManifest.user_config).sort()).toEqual([...BYOK_ENV_NAMES].sort());
    expect(mcpbManifest.compatibility.runtimes.node).toBe('>=22');
    expect(mcpbManifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('mcpb launcher exists and only spawns the npm package', () => {
    const src = read('mcpb/server.js');
    expect(src).toContain("spawn('npx'");
    expect(src).toContain('@lumen-seo/cli');
    expect(src).not.toMatch(/https?:\/\/(?!github\.com\/nitishagar)/); // no third-party endpoints
  });

  it('claude plugin marketplace + plugin manifests are consistent', () => {
    expect(marketplace.name).toBe('nitishagar-lumen');
    const entry = marketplace.plugins.find((p) => p.name === 'lumen');
    expect(entry).toBeDefined();
    expect(entry.source).toBe('./plugin-lumen');
    expect(pluginJson.name).toBe('lumen');
    expect(pluginJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pluginMcp.mcpServers.lumen).toEqual({ command: 'npx', args: ['-y', '@lumen-seo/cli', 'mcp'] });
  });

  it('skill file exists and names only locked MCP tools', () => {
    const skill = read('plugin-lumen/skills/seo-check/SKILL.md');
    expect(skill).toContain('lumen_audit_site');
    const toolNames = [...new Set([...skill.matchAll(/lumen_[a-z_]+/g)].map((m) => m[0]))];
    const LOCKED_TOOLS = [
      'lumen_audit_site',
      'lumen_page_report',
      'lumen_keyword_ideas',
      'lumen_rank_check',
      'lumen_authority',
    ];
    for (const name of toolNames) expect(LOCKED_TOOLS, `${name} is not a locked tool name`).toContain(name);
    expect(skill.length).toBeGreaterThan(200);
  });

  it('committed artifact versions stay in lockstep (release-prep bumps all together)', () => {
    expect(mcpbManifest.version).toBe(serverJson.version);
    expect(pluginJson.version).toBe(serverJson.version);
  });
});
