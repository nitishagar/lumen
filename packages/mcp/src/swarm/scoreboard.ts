/**
 * Swarm scoreboard (Stage 1): append-only JSONL finding ledger. One small
 * O_APPEND write per completed case, serialized through an in-process
 * promise queue — the `JsonlHistoryStore` durability pattern
 * (`@lumen-seo/cli` history), NOT whole-file temp-rename (which would be
 * read-modify-write and clobber across writers). Lines are capped at 4KB
 * (reasons truncate to fit); every URL string passes through the shared
 * `redactUrl` so secret-bearing values can never land in the artifact.
 * Appends happen only on case completion — a cancelled run leaves no
 * partial line. Default path is `.evalite/` (gitignored); `SWARM_SCOREBOARD`
 * overrides it (tests point at a temp dir).
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { redactUrl } from '@lumen-seo/providers';

export type SwarmVerdict = 'pass' | 'fail' | 'unscored';

export interface SwarmFinding {
  adversary: string;
  tool: string;
  verdict: SwarmVerdict;
  reason: string;
  retrievedAt: string;
}

/** Single-line cap: every write is one small atomic append. */
export const MAX_SCOREBOARD_LINE_BYTES = 4096;

const URL_TOKEN_RE = /https?:\/\/[^\s"'`<>]+/gi;

/** Redacts secret-bearing URL substrings; leaves all other text byte-identical. */
const scrubString = (s: string): string =>
  s.replace(URL_TOKEN_RE, (token) => {
    const clean = token.replace(/[.,;!?)\]]+$/, '');
    const tail = token.slice(clean.length);
    try {
      const redacted = redactUrl(new URL(clean));
      return (redacted === clean ? token : redacted) + tail;
    } catch {
      return token;
    }
  });

const scrubValue = (value: unknown): unknown => {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubValue(v)]));
  }
  return value;
};

export const defaultScoreboardPath = (): string =>
  process.env.SWARM_SCOREBOARD ?? '.evalite/swarm-scoreboard.jsonl';

export class Scoreboard {
  readonly #file: string;
  #queue: Promise<unknown> = Promise.resolve();
  #ensured = false;

  constructor(file: string = defaultScoreboardPath()) {
    this.#file = file;
  }

  /** Serialized append (queue never wedges on failure — mirrors history). */
  append(finding: Omit<SwarmFinding, 'retrievedAt'> & { retrievedAt?: string }): Promise<void> {
    const task = this.#queue.then(() => this.#write(finding));
    this.#queue = task.catch(() => undefined);
    return task;
  }

  async #write(finding: Omit<SwarmFinding, 'retrievedAt'> & { retrievedAt?: string }): Promise<void> {
    if (!this.#ensured) {
      await mkdir(dirname(this.#file), { recursive: true });
      this.#ensured = true;
    }
    const scrubbed = scrubValue({ ...finding, retrievedAt: finding.retrievedAt ?? new Date().toISOString() });
    let line = JSON.stringify(scrubbed);
    let reason = (scrubbed as SwarmFinding).reason;
    while (Buffer.byteLength(line, 'utf8') > MAX_SCOREBOARD_LINE_BYTES && reason.length > 0) {
      reason = `${reason.slice(0, Math.max(0, Math.floor(reason.length / 2)))}…(truncated)`;
      line = JSON.stringify({ ...(scrubbed as SwarmFinding), reason });
    }
    await appendFile(this.#file, `${line}\n`, 'utf8');
  }
}
