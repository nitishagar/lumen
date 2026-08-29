/**
 * CLI-local typed errors (I15/I17): every malformed input maps to a typed
 * error; run() maps these to exit code 2 with an actionable message.
 */
import { LumenError } from '@lumen-seo/core';

/** Bad invocation: unknown command/flag, bad positional, bad flag value. */
export class UsageError extends LumenError {
  constructor(message: string) {
    super(message);
  }
}

/** A capability the invoked composition cannot serve (no provider wired). */
export class ProviderUnconfiguredError extends LumenError {
  readonly capability: string;

  constructor(capability: string, message: string) {
    super(message);
    this.capability = capability;
  }
}
