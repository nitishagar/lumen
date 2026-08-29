/**
 * Capping fetcher unit tests (I6/B10/E10): Content-Length is rejected BEFORE
 * reading; a streaming body with a missing/lying Content-Length is aborted
 * mid-stream the moment the cumulative read exceeds the 2.5 MB cap, surfacing
 * the typed UpstreamTooLargeError with CLI guidance.
 */
import { describe, expect, it } from 'vitest';
import type { Fetcher } from '@lumen-seo/core';
import { createCappingFetcher, cappedBodyStream, MAX_BODY_BYTES, UpstreamTooLargeError } from './capping-fetcher.js';

const fetcherOf = (res: Response): Fetcher => ({ fetch: async () => res });

describe('capping fetcher (I6/B10)', () => {
  it('rejects Content-Length > 2.5 MB before reading the body', async () => {
    let bodyRead = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          bodyRead = true;
          controller.enqueue(new Uint8Array(16));
        },
      },
      { highWaterMark: 0 }, // no eager pull: default HWM 1 would read one chunk
    );
    const res = new Response(stream, { headers: { 'content-length': String(MAX_BODY_BYTES + 1) } });
    const f = createCappingFetcher(fetcherOf(res));
    await expect(f.fetch(new URL('https://upstream.example/big'))).rejects.toThrow(UpstreamTooLargeError);
    expect(bodyRead).toBe(false); // rejected up-front, not drained (I6 edge)
  });

  it('aborts a lying/missing Content-Length stream mid-read at the cap', async () => {
    const chunk = new Uint8Array(1024 * 1024); // 1 MiB
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk); // endless stream, no content-length declared
      },
    });
    const res = new Response(stream); // no content-length header
    const f = createCappingFetcher(fetcherOf(res));
    const out = await f.fetch(new URL('https://upstream.example/forever'));
    expect(out.body).not.toBeNull();
    const reader = out.body!.getReader();
    let bytes = 0;
    let err: unknown = null;
    for (let i = 0; i < 5; i += 1) {
      try {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value?.byteLength ?? 0;
      } catch (e) {
        err = e;
        break;
      }
    }
    expect(err).toBeInstanceOf(UpstreamTooLargeError);
    // The stream errors BEFORE delivering the overrunning chunk: the consumer
    // never receives more than the cap.
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect((err as UpstreamTooLargeError).host).toBe('upstream.example');
    expect((err as UpstreamTooLargeError).code).toBe('PAYLOAD_TOO_LARGE');
    expect((err as Error).message).toContain('npx @lumen-seo/cli'); // guidance to go local
  });

  it('passes a small response through byte-identical (happy path)', async () => {
    const payload = JSON.stringify({ ok: true, data: 'small' });
    const res = new Response(payload, { headers: { 'content-length': String(payload.length) } });
    const f = createCappingFetcher(fetcherOf(res));
    const out = await f.fetch(new URL('https://upstream.example/small'));
    expect(await out.text()).toBe(payload);
  });

  it('cappedBodyStream errors exactly at the overrun point (unit)', async () => {
    const chunk = new Uint8Array(Math.floor(MAX_BODY_BYTES / 2) + 1); // two chunks exceed the cap
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    const capped = cappedBodyStream(stream, 'host.example');
    const reader = capped.getReader();
    await reader.read();
    await expect(reader.read()).rejects.toThrow(UpstreamTooLargeError);
  });
});
