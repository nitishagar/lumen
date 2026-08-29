/**
 * Args-only dispatch (B1): Node 22 built-in `node:util` `parseArgs` in strict
 * mode. Help/bare invocation is intercepted BEFORE strict parsing (E15) so
 * `--help` is never a usage error. The global `--config <path>` flag is
 * extracted before command parsing so it applies uniformly (B12). Unknown
 * commands/flags map to UsageError → exit 2 (I15).
 */
import { parseArgs } from 'node:util';
import type { Io } from './io.js';
import { printCommandHelp, printRootHelp } from './help.js';
import { UsageError } from './usage-error.js';

export const COMMAND_NAMES = ['audit', 'report', 'keywords', 'rank', 'authority', 'mcp', 'config'] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

export const isCommandName = (v: string): v is CommandName =>
  (COMMAND_NAMES as readonly string[]).includes(v);

type OptionSpec = Record<string, { type: 'string' } | { type: 'boolean' }>;

const OPTIONS: Record<CommandName, OptionSpec> = {
  audit: {
    'max-pages': { type: 'string' },
    out: { type: 'string' },
    'fail-threshold': { type: 'string' },
    json: { type: 'boolean' },
  },
  report: { strategy: { type: 'string' }, json: { type: 'boolean' } },
  keywords: { limit: { type: 'string' }, lang: { type: 'string' }, json: { type: 'boolean' } },
  rank: {
    domain: { type: 'string' },
    limit: { type: 'string' },
    'no-save': { type: 'boolean' },
    json: { type: 'boolean' },
  },
  authority: { json: { type: 'boolean' } },
  mcp: { print: { type: 'string' }, url: { type: 'string' }, json: { type: 'boolean' } },
  config: { json: { type: 'boolean' } },
};

const POSITIONALS: Record<CommandName, readonly string[]> = {
  audit: ['url'],
  report: ['url'],
  keywords: ['seed'],
  rank: ['keyword'],
  authority: ['domain'],
  mcp: [],
  config: ['subcommand'],
};

export interface Invocation {
  readonly command: CommandName;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
  /** `--config <path>` when given (else LUMEN_CONFIG / ./lumen.config.json). */
  readonly configPathFlag?: string;
}

/**
 * Help contract (E15): bare invocation, `--help`/`-h` as the first token, and
 * `--help`/`-h` anywhere after a command name print usage to stdout. Runs
 * BEFORE strict parseArgs so help is never rejected as an unknown flag.
 * Returns true when help was printed (exit 0, no further parsing).
 */
export const interceptHelp = (argv: readonly string[], io: Io): boolean => {
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h') {
    printRootHelp(io);
    return true;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    if (!printCommandHelp(first, io)) printRootHelp(io);
    return true;
  }
  return false;
};

/** Extracts the global `--config <path>` / `--config=<path>` flag (B12). */
export const extractConfigFlag = (
  argv: readonly string[],
): { argv: string[]; config?: string } => {
  const out: string[] = [];
  let config: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--config') {
      const v = argv[i + 1];
      if (v === undefined) throw new UsageError('--config requires a path value');
      config = v;
      i += 1;
    } else if (a.startsWith('--config=')) {
      const v = a.slice('--config='.length);
      if (v === '') throw new UsageError('--config requires a path value');
      config = v;
    } else {
      out.push(a);
    }
  }
  return { argv: out, config };
};

/** Strict command parse (throws UsageError on any malformed invocation — I15). */
export const parseCommand = (rawArgv: readonly string[]): Invocation => {
  const { argv, config } = extractConfigFlag(rawArgv);
  const [name, ...rest] = argv;
  if (name === undefined) throw new UsageError('missing command — run "lumen --help" for usage');
  if (!isCommandName(name)) {
    throw new UsageError(`unknown command "${name}" — run "lumen --help" for usage`);
  }
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: rest,
      options: OPTIONS[name],
      strict: true,
      allowPositionals: true,
    });
  } catch (e) {
    throw new UsageError(`${(e as Error).message} — run "lumen ${name} --help" for usage`);
  }
  const values = parsed.values as Record<string, string | boolean>;
  const positionals = parsed.positionals;
  const want = POSITIONALS[name];
  if (positionals.length !== want.length) {
    throw new UsageError(
      `lumen ${name} expects ${want.length === 0 ? 'no positional arguments' : want.map((w) => `<${w}>`).join(' ')}` +
        ` — run "lumen ${name} --help" for usage`,
    );
  }
  if (name === 'config' && positionals[0] !== 'show') {
    throw new UsageError(`unknown config subcommand "${positionals[0]}" — only "lumen config show" exists`);
  }
  return { command: name, positionals, flags: values, configPathFlag: config };
};

/** Integer flag with typed error (flags arrive as strings — B1 manual coercion). */
export const intFlag = (flags: Readonly<Record<string, string | boolean>>, name: string): number | undefined => {
  const v = flags[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !/^[0-9]+$/.test(v)) {
    throw new UsageError(`--${name} requires an integer, got "${String(v)}"`);
  }
  return Number(v);
};
