/**
 * Onboarding payload builders (E11/B15): the single source of truth the CLI
 * `lumen mcp --print` and the site docs consume — deterministic strings,
 * snapshot-tested, never embedding key material. `--url <remote>` switches
 * the four connection targets to the remote-HTTP variants (the Worker URL);
 * the three distribution targets (`mcpb`, `registry`, `claude-plugin`)
 * describe artifacts, not connections, so `--url` leaves them unchanged.
 *
 * `registry` mirrors the repo-root `server.json` and `mcpb`/`claude-plugin`
 * summarize the repo-root `mcpb/` + `.claude-plugin/` artifacts —
 * `onboard.test.ts` (payload↔file, via fs) and `test/onboard-artifacts.test.mjs`
 * (file shapes) fail when the files and these payloads drift apart
 * (PRD E0.3 FR-5: the onboarding code stays the source of truth).
 */
export type OnboardTarget = 'json' | 'claude' | 'cursor' | 'vscode' | 'mcpb' | 'registry' | 'claude-plugin';

const LOCAL_SERVER = { command: 'npx', args: ['-y', '@lumen-seo/cli', 'mcp'] } as const;
const SERVER_NAME = 'lumen';
const RELEASES_URL = 'https://github.com/nitishagar/lumen/releases';

/** Must stay deep-equal to the repo-root `server.json` (anti-drift test). */
const REGISTRY_SERVER_JSON = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
  name: 'io.github.nitishagar/lumen',
  description:
    'Deterministic, honest SEO audits as MCP tools: bounded polite site audit with 20 built-in rules, keyword ideas, rank checks, and CWV page reports — free/BYOK providers only, provenance on every number.',
  repository: { url: 'https://github.com/nitishagar/lumen', source: 'github' },
  version: '0.3.0',
  packages: [
    {
      registryType: 'npm',
      identifier: '@lumen-seo/cli',
      version: '0.3.0',
      transport: { type: 'stdio' },
      environmentVariables: [
        {
          name: 'LUMEN_PSI_KEY',
          description:
            'Google PageSpeed Insights API key — enables the CWV lab leg of page reports. Optional; without it that leg reports not-configured.',
          isRequired: false,
          format: 'string',
          isSecret: true,
        },
        {
          name: 'LUMEN_CRUX_KEY',
          description:
            'Chrome UX Report API key — enables field CWV data. Optional; without it that leg reports not-configured.',
          isRequired: false,
          format: 'string',
          isSecret: true,
        },
        {
          name: 'LUMEN_OPR_KEY',
          description:
            'Open PageRank API key — enables the OPR authority signal. Optional; without it that signal reports not-configured.',
          isRequired: false,
          format: 'string',
          isSecret: true,
        },
      ],
    },
  ],
} as const;

const MARKETPLACE_NAME = 'nitishagar-lumen';

const mcpbSummary = (): string =>
  [
    '# lumen.mcpb — Claude Desktop bundle',
    `Install: download lumen.mcpb from ${RELEASES_URL} and double-click it (Claude Desktop → Settings → Extensions also works).`,
    'Requires Node >= 22 — the bundle is a thin launcher that runs the npm package (`npx -y @lumen-seo/cli mcp`).',
    'Optional keys, names only, prompted in Claude Desktop and delivered as env vars: LUMEN_PSI_KEY, LUMEN_CRUX_KEY, LUMEN_OPR_KEY.',
  ].join('\n');

const claudePluginSummary = (): string =>
  [
    '# lumen Claude Code plugin',
    `/plugin marketplace add nitishagar/lumen`,
    `/plugin install ${SERVER_NAME}@${MARKETPLACE_NAME}`,
    'Ships the lumen MCP server (stdio, `npx -y @lumen-seo/cli mcp`) and the seo-check skill (audit → ranked fixes → re-audit).',
  ].join('\n');

export const onboardPayload = (target: OnboardTarget, remoteUrl?: string): string => {
  if (target === 'mcpb') return mcpbSummary();
  if (target === 'claude-plugin') return claudePluginSummary();
  if (target === 'registry') return JSON.stringify(REGISTRY_SERVER_JSON, null, 2);
  const cfg = remoteUrl === undefined ? LOCAL_SERVER : { type: 'http', url: remoteUrl };
  if (target === 'json') {
    return JSON.stringify({ mcpServers: { [SERVER_NAME]: cfg } }, null, 2);
  }
  if (target === 'claude') {
    if (remoteUrl === undefined) {
      return `claude mcp add --transport stdio ${SERVER_NAME} -- npx -y @lumen-seo/cli mcp`;
    }
    // POSIX single-quote the URL (red-team round 1): a raw interpolation let
    // a crafted URL smuggle extra flags into the copy-paste command. Each '
    // becomes the POSIX escape sequence '\'' (close, escaped quote, reopen).
    const quoted = `'${remoteUrl.replaceAll("'", `'\\''`)}'`;
    return `claude mcp add --transport http ${SERVER_NAME} ${quoted}`;
  }
  if (target === 'cursor') {
    const config = Buffer.from(JSON.stringify(cfg)).toString('base64');
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${config}`;
  }
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER_NAME, server: cfg }))}`;
};
