import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FailThreshold, Issue, SiteAuditReport } from '@lumen-seo/core';
import { countIssuesBySeverity, LumenError } from '@lumen-seo/core';
import type { AuditInput, AuditRunner } from '@lumen-seo/mcp/ports';
import { execute as audit } from './cmd/audit.js';
import type { CommandDeps } from './composition/node.js';
import { MemoryIo } from './io.js';
import { run } from './run.js';
import type { CliContext } from './run.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumen-audit-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const mkIssue = (severity: Issue['severity'], ruleId = `rule/${severity}`): Issue => ({
  ruleId,
  severity,
  message: `${severity} severity fixture issue`,
  evidence: {},
});

/** Fully controllable fixture runner (deterministic, zero network). */
const runnerWith = (
  o: { issues?: Issue[]; incomplete?: boolean; maxPagesSeen?: number[]; fail?: Error } = {},
): AuditRunner & { inputs: AuditInput[] } => {
  const inputs: AuditInput[] = [];
  return {
    inputs,
    run: async (input: AuditInput): Promise<SiteAuditReport> => {
      if (o.fail) throw o.fail;
      inputs.push(input);
      const issues = o.issues ?? [];
      return {
        id: 'fixture',
        startedAt: '2026-08-29T09:00:00Z',
        completedAt: '2026-08-29T09:00:01Z',
        pages: [{ url: input.url.href, status: 200, issues, score: 90, timingMs: 10, bytes: 100, robotsAllowed: true }],
        summary: { countsBySeverity: countIssuesBySeverity(issues), score: 90, pagesAudited: 1, pagesSkipped: 0 },
        incomplete: o.incomplete === true,
        configSnapshot: {},
        stopReason: o.incomplete === true ? 'time_budget' : 'completed',
      };
    },
  };
};

const AT = (): string => '2026-08-29T09:00:00Z';

const depsWith = (runner: AuditRunner, failThreshold: FailThreshold = 'error'): CommandDeps => ({
  clock: AT,
  failThreshold,
  keywords: [],
  authority: [],
  authorityUnconfigured: [],
  history: { append: async () => undefined, list: async () => [] },
  auditRunner: runner,
});

const ctx = (
  args: string[],
  flags: Record<string, string | boolean> = {},
): CliContext & { io: MemoryIo } => {
  const io = new MemoryIo();
  return { io, signal: new AbortController().signal, positionals: args, flags };
};

describe('audit exit-code matrix (E1/R1/R2/R8)', () => {
  it('clean report exits 0', async () => {
    const c = ctx(['https://example.com'], { json: true });
    expect(await audit(c, depsWith(runnerWith()))).toBe(0);
    expect(JSON.parse(c.io.stdout.join('')).incomplete).toBe(false);
  });

  it.each(['info', 'warning', 'error'] as const)(
    'threshold %s: an issue exactly at the threshold gates; strictly lower severities do not',
    async (threshold) => {
      const at = ctx(['https://example.com'], { json: true, 'fail-threshold': threshold });
      expect(await audit(at, depsWith(runnerWith({ issues: [mkIssue(threshold)] }), threshold))).toBe(1);
      // R1 ordering: info < warning < error
      const belowMap: Record<string, Issue['severity'][]> = { info: [], warning: ['info'], error: ['info', 'warning'] };
      const below = belowMap[threshold] ?? [];
      if (below.length > 0) {
        const under = ctx(['https://example.com'], { json: true, 'fail-threshold': threshold });
        expect(
          await audit(under, depsWith(runnerWith({ issues: below.map((s) => mkIssue(s)) }), threshold)),
        ).toBe(0);
      }
    },
  );

  it('default threshold is error (R2): warnings alone pass', async () => {
    const c = ctx(['https://example.com'], {});
    expect(await audit(c, depsWith(runnerWith({ issues: [mkIssue('warning')] })))).toBe(0);
    const c2 = ctx(['https://example.com'], {});
    expect(await audit(c2, depsWith(runnerWith({ issues: [mkIssue('error'), mkIssue('info')] })))).toBe(1);
  });

  it('config threshold warning gates warnings; the flag overrides config (precedence)', async () => {
    // deps.failThreshold models a config file with failThreshold: "warning"
    const cCfg = ctx(['https://example.com'], {});
    expect(await audit(cCfg, depsWith(runnerWith({ issues: [mkIssue('warning')] }), 'warning'))).toBe(1);
    const cFlag = ctx(['https://example.com'], { 'fail-threshold': 'off' });
    expect(await audit(cFlag, depsWith(runnerWith({ issues: [mkIssue('warning')] }), 'warning'))).toBe(0);
  });

  it('"off" NEVER gates on severity — even errors (R2)', async () => {
    const c = ctx(['https://example.com'], { 'fail-threshold': 'off' });
    expect(
      await audit(c, depsWith(runnerWith({ issues: [mkIssue('error'), mkIssue('warning')] }))),
    ).toBe(0);
  });

  it('incomplete reports fail the gate (exit 1) regardless of threshold — even off', async () => {
    const c = ctx(['https://example.com'], { 'fail-threshold': 'off' });
    expect(await audit(c, depsWith(runnerWith({ incomplete: true })))).toBe(1);
    const human = new MemoryIo();
    const code = await run(
      ['audit', 'https://example.com', '--fail-threshold', 'off'],
      human,
      depsWith(runnerWith({ incomplete: true })),
    );
    expect(code).toBe(1);
    expect(human.stdout.join('')).toContain('incomplete');
  });

  it('invalid urls and flags are usage errors (exit 2, I12/I15)', async () => {
    const d = depsWith(runnerWith());
    await expect(run(['audit', 'ftp://example.com'], new MemoryIo(), d)).resolves.toBe(2);
    await expect(run(['audit', 'http://127.0.0.1:8080/'], new MemoryIo(), d)).resolves.toBe(2);
    await expect(run(['audit', 'not a url'], new MemoryIo(), d)).resolves.toBe(2);
    await expect(
      run(['audit', 'https://example.com', '--fail-threshold', 'critical'], new MemoryIo(), d),
    ).resolves.toBe(2);
    await expect(
      run(['audit', 'https://example.com', '--max-pages', '20000'], new MemoryIo(), d),
    ).resolves.toBe(2);
  });

  it('typed runner failures (e.g. robots refusal) map to exit 2 with guidance', async () => {
    const io = new MemoryIo();
    const fail = new LumenError('seed URL is disallowed by robots.txt — see https://github.com/nitishagar/lumen#robots', 'audit');
    const code = await run(['audit', 'https://example.com'], io, depsWith(runnerWith({ fail })));
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('robots.txt');
  });

  it('--max-pages is plumbed with NO flag-level default (R8)', async () => {
    const r1 = runnerWith();
    await audit(ctx(['https://example.com'], {}), depsWith(r1));
    expect(r1.inputs[0]?.maxPages).toBeUndefined(); // core config default applies
    const r2 = runnerWith();
    await audit(ctx(['https://example.com'], { 'max-pages': '7' }), depsWith(r2));
    expect(r2.inputs[0]?.maxPages).toBe(7);
  });

  it('--out writes the full report atomically (no temp leftovers, valid JSON)', async () => {
    const out = join(dir, 'report.json');
    const c = ctx(['https://example.com'], { out });
    expect(await audit(c, depsWith(runnerWith({ issues: [mkIssue('error')] })))).toBe(1);
    const written = JSON.parse(await readFile(out, 'utf8')) as SiteAuditReport;
    expect(written.summary.countsBySeverity.error).toBe(1);
    const leftovers = (await readdir(dir)).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('no audit engine wired exits 2 (typed)', async () => {
    const io = new MemoryIo();
    const d = depsWith(runnerWith());
    const withoutRunner = { ...d, auditRunner: undefined };
    const code = await run(['audit', 'https://example.com'], io, withoutRunner);
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('no audit engine wired');
  });
});

describe('audit cancellation via run() (E14)', () => {
  it('SIGINT-aborted run exits 2 with cancelled on stderr', async () => {
    const ac = new AbortController();
    const runner = {
      run: async (): Promise<SiteAuditReport> => {
        ac.abort();
        return {
          id: 'x', startedAt: 't0', completedAt: 't1',
          pages: [], summary: { countsBySeverity: { error: 0, warning: 0, info: 0 }, score: null },
          incomplete: true, configSnapshot: {}, stopReason: 'aborted',
        };
      },
    };
    const io = new MemoryIo();
    // Inject an already-wired abort through a direct execute + aborted ctx signal
    const c: CliContext = {
      io,
      signal: ac.signal,
      positionals: ['https://example.com'],
      flags: { json: true, out: join(dir, 'partial.json') },
    };
    const code = await audit(c, depsWith(runner));
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('cancelled');
    // the partial report was still written atomically and labeled incomplete
    const partial = JSON.parse(await readFile(join(dir, 'partial.json'), 'utf8')) as SiteAuditReport;
    expect(partial.incomplete).toBe(true);
    expect(partial.stopReason).toBe('aborted');
  });
});

describe('audit via the real bin + REAL engine (spawn, post-rebase)', () => {
  it('exits 2 with typed robots guidance for an unreachable seed; no --out file, no temp leftovers', async () => {
    const { spawnCli } = await import('./spawn.js');
    // `.example` is a reserved TLD that never resolves, so the REAL engine's
    // robots gate refuses the seed conservatively (A2) and zero HTTP leaves
    // the machine — hermetic. The exit-0/exit-1 audit matrix over injected
    // fixture runners is covered by the in-process blocks above.
    const url = 'https://fixture-audit.example/';
    const out = join(dir, 'spawn-report.json');
    const r = await spawnCli(['audit', url, '--json', '--out', out, '--fail-threshold', 'off'], { cwd: dir });
    // LumenRobotsUnreachableError → the exit envelope's error path (2).
    expect(r.code).toBe(2);
    expect(r.stdout).toBe(''); // E2: error diagnostics never mix into stdout
    expect(r.stderr).toContain('LumenRobotsUnreachableError');
    expect(r.stderr).toContain('refusing to crawl');
    expect(existsSync(out)).toBe(false); // no report under the target name on error
    expect((await readdir(dir)).filter((f) => f.includes('.tmp'))).toEqual([]);
  });
});
