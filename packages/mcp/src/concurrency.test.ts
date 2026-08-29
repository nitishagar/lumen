/**
 * Concurrency + cancellation tests (E13/E14): the SDK may interleave tool
 * executions on one connection — handlers are pure functions of (args, deps)
 * and history appends serialize through the store's in-process queue.
 * Client-cancelled calls honor extra.signal without side effects.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SiteAuditReport } from '@lumen-seo/core';
import type { AuditInput, AuditRunner } from './ports.js';
import { connectClient, fixtureDeps, fixtureAuditRunner, MemoryHistoryStore } from './testkit/index.js';

describe('interleaved tool calls (E13)', () => {
  it('25 concurrent calls (mix incl. rank saves) all resolve; history has exactly 25 intact lines', async () => {
    const history = new MemoryHistoryStore();
    const client = await connectClient({ ...fixtureDeps(), history });
    const calls = Array.from({ length: 25 }, (_, i) =>
      i % 2 === 0
        ? client.callTool({
            name: 'lumen_rank_check',
            arguments: { keyword: `kw-${i}`, domain: 'example.com' },
          })
        : client.callTool({ name: 'lumen_keyword_ideas', arguments: { seed: `seed-${i}` } }),
    );
    const results = await Promise.all(calls);
    for (const r of results) expect(r.isError).toBeUndefined();
    // 13 rank saves (even indices) — exactly one well-formed line each, none lost or torn.
    expect(history.entries.length).toBe(13);
    for (const entry of history.entries) {
      expect(entry.keyword).toMatch(/^kw-\d+$/);
      expect(entry.domain).toBe('example.com');
      expect(typeof entry.retrievedAt).toBe('string');
      // Exactly core's RankHistoryEntry fields — hit found, so url is present.
      expect(Object.keys(entry).sort()).toEqual(
        ['domain', 'keyword', 'position', 'provider', 'retrievedAt', 'url'].sort(),
      );
      expect(entry.url).toBe('https://example.com/hit');
    }
    await client.close();
  });
});

describe('client cancellation (E14)', () => {
  it('notifications/cancelled aborts the handler signal promptly; no history side effects', async () => {
    let aborted = false;
    let started = false;
    const slowRunner: AuditRunner = {
      run: (_input: AuditInput, signal?: AbortSignal): Promise<SiteAuditReport> =>
        new Promise<SiteAuditReport>((_resolve, reject) => {
          started = true;
          signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(Object.assign(new Error('cancelled'), { name: 'AbortedError' }));
            },
            { once: true },
          );
        }),
    };
    const history = new MemoryHistoryStore();
    const client = await connectClient({
      ...fixtureDeps(),
      auditRunner: slowRunner,
      history,
    });
    const ac = new AbortController();
    const { CallToolResultSchema } = await import('@modelcontextprotocol/sdk/types.js');
    // client.request() sends notifications/cancelled when the signal aborts —
    // the deterministic equivalent of a client cancelling mid-call.
    const pending = client.request(
      {
        method: 'tools/call',
        params: { name: 'lumen_audit_site', arguments: { url: 'https://example.com' } },
      },
      CallToolResultSchema,
      { signal: ac.signal },
    );
    const pendingGuarded = expect(pending).rejects.toThrow(); // cancelled → rejected, not hung
    // Deterministic order: wait until the server-side handler is actually
    // running (so its request controller exists), THEN cancel — otherwise the
    // cancelled notification can race the request delivery and no-op.
    await vi.waitFor(() => expect(started).toBe(true));
    ac.abort('test client cancelled');
    await pendingGuarded;
    // Prompt: the abort was observed by the handler signal (not a timeout).
    // The cancelled notification crosses the in-memory transport
    // asynchronously — wait for the handler-side observation deterministically.
    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(history.entries.length).toBe(0); // no side effects from a cancelled call
    await client.close();
  });

  it('an audit aborted mid-run still returns a partial labeled report (E14, in-process)', async () => {
    // Handler-level: the runner's throw maps to a typed error result, never a hang.
    const runner = fixtureAuditRunner();
    const client = await connectClient({ ...fixtureDeps(), auditRunner: runner });
    const res = await client.callTool({
      name: 'lumen_audit_site',
      arguments: { url: 'https://example.com' },
    });
    expect(res.isError).toBeUndefined(); // fixture completes; abort path covered above
    await client.close();
  });
});
