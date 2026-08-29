/**
 * No-telemetry enumeration, tool side (E12/I16): with `globalThis.fetch`
 * stubbed to THROW, every one of the five tools runs against fixture
 * providers and issues zero direct fetch calls — all outbound HTTP would have
 * to flow through an injected core Fetcher (which the fixtures never use).
 * This proves the tool layer cannot silently dial home even if a future
 * dependency tries.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectClient, fixtureDeps, fixtureRemoteDeps } from './testkit/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('outbound enumeration over fixture providers (E12/I16)', () => {
  it('global fetch is never called by any tool handler (full composition)', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('TELEMETRY LEAK: direct fetch from the tool layer');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = await connectClient(fixtureDeps());
    const calls = [
      client.callTool({ name: 'lumen_audit_site', arguments: { url: 'https://example.com' } }),
      client.callTool({ name: 'lumen_page_report', arguments: { url: 'https://example.com' } }),
      client.callTool({ name: 'lumen_keyword_ideas', arguments: { seed: 'seo' } }),
      client.callTool({ name: 'lumen_rank_check', arguments: { keyword: 'k', domain: 'example.com' } }),
      client.callTool({ name: 'lumen_authority', arguments: { domain: 'example.com' } }),
    ];
    for (const r of await Promise.all(calls)) expect((r as { isError?: boolean }).isError).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    await client.close();
  });

  it('global fetch is never called on the remote (local-only) composition either', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('TELEMETRY LEAK: direct fetch from the tool layer');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = await connectClient(fixtureRemoteDeps());
    await client.callTool({ name: 'lumen_audit_site', arguments: { url: 'https://example.com' } });
    await client.callTool({ name: 'lumen_rank_check', arguments: { keyword: 'k', domain: 'example.com' } });
    await client.callTool({ name: 'lumen_keyword_ideas', arguments: { seed: 'seo' } });
    await client.callTool({ name: 'lumen_authority', arguments: { domain: 'example.com' } });
    expect(fetchSpy).not.toHaveBeenCalled();
    await client.close();
  });
});
