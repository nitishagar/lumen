/**
 * run() — the ONLY place exit codes are produced (E1). 0 = ok (audit also:
 * under threshold), 1 = audit gate failed, 2 = usage/config/provider error
 * (including SIGINT cancellation). The bin sets `process.exitCode` from this
 * value and NEVER calls process.exit() on success paths, so stdout flushes.
 *
 * SIGINT (E14): one AbortController per run; every command receives its
 * signal (audit → partial report labeled incomplete, mcp → exit 2 shutdown).
 */
import { AbortedError, ConfigError, EXIT, LumenError } from '@lumen-seo/core';
import type { CommandName } from './args.js';
import { interceptHelp, parseCommand } from './args.js';
import { execute as configShow } from './cmd/config-show.js';
import type { Io } from './io.js';
import { ioFromProcess } from './io.js';
import { clean } from './term.js';
import { UsageError } from './usage-error.js';

export { EXIT };

/** Per-run execution context handed to every command. */
export interface CliContext {
  readonly io: Io;
  readonly signal: AbortSignal;
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly configPathFlag?: string;
}

const reportError = (err: unknown, io: Io): number => {
  if (err instanceof UsageError) {
    io.err(`error: ${clean(err.message, 400)}\n`);
    return EXIT.CONFIG_ERROR;
  }
  if (err instanceof ConfigError) {
    io.err(`config error: ${clean(err.message, 1000)}\n`);
    return EXIT.CONFIG_ERROR;
  }
  if (err instanceof LumenError) {
    const label = err.label === undefined ? '' : ` (provider: ${clean(err.label, 80)})`;
    io.err(`error: ${err.name}: ${clean(err.message, 400)}${label}\n`);
    return EXIT.CONFIG_ERROR;
  }
  const message = err instanceof Error ? err.message : String(err);
  io.err(`internal error: ${clean(message, 400)}\n`); // B18: truncated, no stack on any stream
  return EXIT.CONFIG_ERROR;
};

export const run = async (argv: readonly string[], io: Io = ioFromProcess()): Promise<number> => {
  const ac = new AbortController();
  const onSigint = (): void => {
    ac.abort(new AbortedError('SIGINT'));
  };
  process.on('SIGINT', onSigint);
  try {
    if (interceptHelp(argv, io)) return EXIT.OK; // E15: help is never a usage error
    const invocation = parseCommand(argv);
    const ctx: CliContext = {
      io,
      signal: ac.signal,
      flags: invocation.flags,
      configPathFlag: invocation.configPathFlag,
    };
    return await dispatch(invocation.command, ctx);
  } catch (err) {
    if (ac.signal.aborted) {
      io.err('cancelled\n');
      return EXIT.CONFIG_ERROR; // E14: SIGINT → exit 2
    }
    return reportError(err, io);
  } finally {
    process.off('SIGINT', onSigint);
  }
};

const dispatch = (command: CommandName, ctx: CliContext): Promise<number> => {
  switch (command) {
    case 'config':
      return configShow(ctx);
    default: {
      const never: never = command;
      throw new Error(`unhandled command ${String(never)}`);
    }
  }
};
