/**
 * Onboarding payload builders (E11/B15): the single source of truth the CLI
 * `lumen mcp --print` and the site docs consume — deterministic strings,
 * snapshot-tested, never embedding key material. `--url <remote>` switches
 * all four targets to the remote-HTTP variants (the Worker URL).
 */
export type OnboardTarget = 'json' | 'claude' | 'cursor' | 'vscode';

const LOCAL_SERVER = { command: 'npx', args: ['-y', '@lumen-seo/cli', 'mcp'] } as const;
const SERVER_NAME = 'lumen';

export const onboardPayload = (target: OnboardTarget, remoteUrl?: string): string => {
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
