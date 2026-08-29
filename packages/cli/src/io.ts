/**
 * Process I/O seam (E2): stdout is a single JSON document in `--json` mode
 * and human-readable text otherwise; diagnostics NEVER touch stdout in JSON
 * mode. Everything is injectable so every command is testable in-process.
 */
export interface Io {
  /** Write to stdout (human text, or the single JSON document). */
  out(s: string): void;
  /** Write to stderr (diagnostics, notes — never protocol, never JSON payloads). */
  err(s: string): void;
}

export const ioFromProcess = (): Io => ({
  out: (s: string): void => {
    process.stdout.write(s);
  },
  err: (s: string): void => {
    process.stderr.write(s);
  },
});

/** Captured I/O for in-process tests. */
export class MemoryIo implements Io {
  readonly stdout: string[] = [];
  readonly stderr: string[] = [];

  out(s: string): void {
    this.stdout.push(s);
  }

  err(s: string): void {
    this.stderr.push(s);
  }
}

/** The single JSON document (exactly one stringify, trailing newline — E2). */
export const jsonDocument = (value: unknown): string => `${JSON.stringify(value)}\n`;
