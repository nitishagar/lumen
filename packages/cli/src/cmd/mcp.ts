/**
 * `lumen mcp` (E2/E11/E14): stdio MCP server + onboarding payload printer.
 *
 * `--print <target>` prints ONE deterministic onboarding payload to stdout and
 * exits 0 without starting the server (E11). Serving mode: stdout carries
 * JSON-RPC protocol frames ONLY — the startup note and the cancellation note
 * go to stderr (E2). Shutdown is fully resolvable (E14): stdin EOF → graceful
 * `server.close()` → exit 0; SIGINT → run()'s AbortController aborts →
 * `server.close()` → exit 2. Ctrl-C can never hang the process: the SDK's
 * `StdioServerTransport.close()` only PAUSES stdin, so the abort path also
 * destroys stdin to release the event loop.
 */
import { EXIT } from '@lumen-seo/core';
import type { OnboardTarget } from '@lumen-seo/mcp';
import { buildMcpServer, onboardPayload } from '@lumen-seo/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CommandDeps } from '../composition/node.js';
import { buildDeps } from '../composition/node.js';
import { mcpDepsFromCommand } from '../composition/mcp.js';
import { UsageError } from '../usage-error.js';
import type { CliContext } from '../run.js';

const PRINT_TARGETS = ['json', 'claude', 'cursor', 'vscode'] as const satisfies readonly OnboardTarget[];

export const execute = async (ctx: CliContext, deps?: CommandDeps): Promise<number> => {
  const { io, signal } = ctx;

  // E11: onboarding payloads — print and exit 0, no server.
  const printFlag = ctx.flags.print;
  if (printFlag !== undefined) {
    const target = String(printFlag);
    if (!(PRINT_TARGETS as readonly string[]).includes(target)) {
      throw new UsageError(`--print must be one of: ${PRINT_TARGETS.join(', ')}`);
    }
    let remoteUrl: string | undefined;
    if (ctx.flags.url !== undefined) {
      const raw = String(ctx.flags.url);
      if (!/^https?:\/\//.test(raw)) throw new UsageError('--url must be an http(s) URL');
      remoteUrl = raw; // local dev worker URLs (localhost) are legitimate here — no SSRF guard
    }
    io.out(`${onboardPayload(target as OnboardTarget, remoteUrl)}\n`);
    return EXIT.OK;
  }

  const d = deps ?? (await buildDeps(ctx.configPathFlag));
  const server = buildMcpServer(mcpDepsFromCommand(d));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  io.err('lumen mcp: stdio transport ready\n'); // stderr ONLY (E2)

  let exit: number = EXIT.OK; // stdin close → 0; SIGINT via run()'s AbortController → 2
  const closed = new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
  const onStdinEnd = (): void => {
    void server.close(); // client disconnect → graceful stop → exit 0
  };
  process.stdin.once('end', onStdinEnd);
  const onAbort = (): void => {
    exit = EXIT.CONFIG_ERROR;
    io.err('cancelled\n');
    void server.close();
    // E14: transport.close() only pauses stdin — destroy it so the event loop
    // drains and the process can actually exit after Ctrl-C.
    process.stdin.destroy();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await closed;
  } finally {
    signal.removeEventListener('abort', onAbort);
    process.stdin.removeListener('end', onStdinEnd);
  }
  return exit;
};
