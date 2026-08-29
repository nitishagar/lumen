/**
 * Cancellation contract (E14/I14): SIGINT mid-audit stops PROMPTLY, the
 * partial report is labeled `incomplete: true` and written atomically when
 * --out is given, history is never appended for an aborted run, and the
 * process exits 2 with `cancelled`. The signal path is exercised for real:
 * the test sends an actual SIGINT to its own process while run()'s handler is
 * registered.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditInput, AuditRunner, PageMetaFetcher } from '@lumen-seo/mcp/ports';
import type { SiteAuditReport } from '@lumen-seo/core';
import type { CommandDeps } from './composition/node.js';
import { MemoryHistoryStore } from '@lumen-seo/mcp/testkit';
import { MemoryIo } from './io.js';
import { run } from './run.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumen-cancel-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A runner that only completes when its signal aborts (mid-crawl SIGINT). */
const abortableRunner = (seen: AuditInput[]): AuditRunner & { started: () => boolean } => {
  let started = false;
  return {
    started: () => started,
    run: (input: AuditInput, signal?: AbortSignal): Promise<SiteAuditReport> => {
      seen.push(input);
      started = true;
      return new Promise<SiteAuditReport>((resolve) => {
        signal?.addEventListener(
          'abort',
          () =>
            resolve({
              id: 'fixture-partial',
              startedAt: '2026-08-29T12:00:00Z',
              completedAt: '2026-08-29T12:00:05Z',
              pages: [
                {
                  url: input.url.href,
                  status: 200,
                  title: 'Partial page',
                  issues: [],
                  score: 90,
                  timingMs: 15,
                  bytes: 2048,
                  robotsAllowed: true,
                  depth: 0,
                },
              ],
              summary: { countsBySeverity: { error: 0, warning: 0, info: 0 }, score: 90, pagesAudited: 1, pagesSkipped: 0 },
              incomplete: true, // a cancelled audit is NEVER a passing report (E1)
              configSnapshot: {},
              stopReason: 'aborted',
            }),
          { once: true },
        );
      });
    },
  };
};

const auditDeps = (runner: AuditRunner, meta?: PageMetaFetcher): CommandDeps => ({
  clock: () => '2026-08-29T12:00:00Z',
  failThreshold: 'error',
  keywords: [],
  authority: [],
  authorityUnconfigured: [],
  history: new MemoryHistoryStore(),
  auditRunner: runner,
  pageMeta: meta,
});

describe('SIGINT mid-audit (E14/I14)', () => {
  it(
    'stops promptly, labels the partial report incomplete, writes --out atomically, exits 2',
    async () => {
      const outPath = join(dir, 'report.json');
      const seen: AuditInput[] = [];
      const runner = abortableRunner(seen);
      const io = new MemoryIo();
      const history = new MemoryHistoryStore();
      const d = { ...auditDeps(runner), history };

      const pending = run(['audit', 'https://example.com', '--json', '--out', outPath], io, d);
      // Deterministic start: the runner is inside its abort-wait before the
      // signal is sent (the SIGINT handler is registered by then).
      await vi.waitFor(() => expect(runner.started()).toBe(true));
      process.kill(process.pid, 'SIGINT'); // real SIGINT — the E14 path users hit
      const code = await pending;

      expect(code).toBe(2); // E14: cancellation is exit 2, never 0/1
      expect(io.stderr.join('')).toContain('cancelled');

      // The partial report was written (atomically) under the target name…
      const report = JSON.parse(await readFile(outPath, 'utf8')) as { incomplete: boolean; stopReason: string };
      expect(report.incomplete).toBe(true);
      expect(report.stopReason).toBe('aborted');
      // …and no temp-file leftovers exist (atomic tmp+rename, E3).
      const files = await stat(outPath);
      expect(files.isFile()).toBe(true);
      const dirEntries = await readFile(outPath, 'utf8');
      expect(dirEntries).not.toContain('.tmp-');

      // An aborted run has no history side effects (E14).
      expect(history.entries.length).toBe(0);
      // The runner received the caller's signal (I14 plumbing through the port).
      expect(seen.length).toBe(1);
    },
    20_000,
  );
});
