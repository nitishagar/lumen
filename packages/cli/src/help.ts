/**
 * Deterministic usage text (E15). Help is printed to stdout with exit 0 for
 * bare `lumen`, `--help`/`-h`, and `<command> --help` — intercepted BEFORE
 * strict flag parsing so help is never a usage error. `help` is NOT a
 * subcommand. Snapshot-tested; wording changes are visible diffs.
 */
import type { Io } from './io.js';

export const ROOT_USAGE = `lumen — see your site clearly.

Usage:
  lumen <command> [flags]

Commands:
  audit <url>          Bounded site audit (exit 1 on issues at/above failThreshold)
  report <url>         Page report: PSI lab + CrUX field + local page meta
  keywords <seed>      Keyword ideas from configured providers
  rank <keyword>       SERP position check for --domain (appends history)
  authority <domain>   Authority signals from configured providers
  mcp                  MCP server over stdio (or --print onboarding payloads)
  config show          Resolved config (BYOK env NAMES + set-flag only)

Global flags:
  --config <path>      Config file (default ./lumen.config.json, env LUMEN_CONFIG)
  --help, -h           Usage for lumen or a command (also on bare invocation)

Run "lumen <command> --help" for command flags. Every command accepts --json
(exactly one JSON document on stdout). Exit codes: 0 ok, 1 audit gate failed,
2 usage/config/provider error.`;

const usage = (title: string, usageLine: string, flags: string[], notes: string[] = []): string =>
  [
    title,
    '',
    `Usage: ${usageLine}`,
    '',
    'Flags:',
    ...flags.map((f) => `  ${f}`),
    ...(notes.length > 0 ? ['', ...notes] : []),
  ].join('\n');

const USAGE_BY_COMMAND: Record<string, string> = {
  audit: usage(
    'lumen audit — bounded site audit',
    'lumen audit <url> [--max-pages N] [--out report.json] [--fail-threshold S] [--json]',
    [
      '--max-pages N      Crawl budget override (default: config crawl.maxPages = 100, clamp 10000)',
      '--out <path>       Write the full report JSON atomically (tmp + rename)',
      '--fail-threshold S info | warning | error | off (default: config, else error)',
      '--json             One JSON document on stdout',
    ],
    [
      'Exit codes: 0 under threshold; 1 issues at/above failThreshold or incomplete; 2 error.',
      '"off" never gates on severity, but an incomplete report still fails the gate.',
    ],
  ),
  report: usage(
    'lumen report — page report (PSI lab + CrUX field + local page meta)',
    'lumen report <url> [--strategy mobile|desktop] [--json]',
    [
      '--strategy S       mobile | desktop (default mobile)',
      '--json             One JSON document on stdout',
    ],
    ['Provenance on every metric; unavailable providers are labeled, never zero-filled.'],
  ),
  keywords: usage(
    'lumen keywords — keyword ideas',
    'lumen keywords <seed> [--limit N] [--lang L] [--json]',
    [
      '--limit N          1..50 (default 20)',
      '--lang L           BCP-47 style language code (default provider choice)',
      '--json             One JSON document on stdout',
    ],
  ),
  rank: usage(
    'lumen rank — SERP position check',
    'lumen rank <keyword> --domain <domain> [--limit N] [--no-save] [--json]',
    [
      '--domain <domain>  Required. Domain to find in the results',
      '--limit N          1..50 results fetched (default 20)',
      '--no-save          Do not append to rank history',
      '--json             One JSON document on stdout',
    ],
    ['Not found in top N is success (found:false, position:null). One history line per run.'],
  ),
  authority: usage(
    'lumen authority — authority signals',
    'lumen authority <domain> [--json]',
    ['--json              One JSON document on stdout'],
    ['Unconfigured (BYOK-missing) providers are listed, never called.'],
  ),
  mcp: usage(
    'lumen mcp — MCP server (stdio) and onboarding payloads',
    'lumen mcp [--print json|claude|cursor|vscode] [--url <remote>] [--json]',
    [
      '--print <target>   Print the onboarding payload and exit 0 (no server)',
      '--url <remote>     Remote worker URL for --print payloads',
      '--json             Accepted for uniformity; stdout is protocol-only while serving',
    ],
    ['Serving mode: stdout carries JSON-RPC only. stdin close -> exit 0; SIGINT -> exit 2.'],
  ),
  config: usage('lumen config show — resolved config', 'lumen config show [--json]', [
    '--json              One JSON document on stdout',
  ]),
};

export const printRootHelp = (io: Io): void => {
  io.out(`${ROOT_USAGE}\n`);
};

export const printCommandHelp = (command: string, io: Io): boolean => {
  const text = USAGE_BY_COMMAND[command];
  if (text === undefined) return false;
  io.out(`${text}\n`);
  return true;
};
