/**
 * Capping Fetcher (E10/I6/B10): every upstream read on the Worker is capped at
 * 2.5 MB — Content-Length is rejected BEFORE the body is read, and streaming
 * bodies are aborted mid-stream the moment the cumulative read exceeds the
 * cap. Oversize is a typed PAYLOAD_TOO_LARGE error with guidance to use the
 * CLI, never an attempt that runs until the CPU limit.
 */
import type { Fetcher } from '@lumen-seo/core';

export const MAX_BODY_BYTES = 2_500_000; // B10: CPU headroom under the 10 ms ceiling

/** Typed oversize error (I17): names the upstream host and the observed size. */
export class UpstreamTooLargeError extends Error {
  readonly code = 'PAYLOAD_TOO_LARGE';
  constructor(
    readonly host: string,
    readonly bytes: number,
  ) {
    super(
      `upstream response from ${host} exceeds the ${MAX_BODY_BYTES} byte cap (${bytes} bytes observed) — ` +
        `run this analysis locally instead: npx @lumen-seo/cli`,
    );
    this.name = 'UpstreamTooLargeError';
  }
}

/** Wraps a body stream so cumulative reads beyond the cap error out (I6). */
export const cappedBodyStream = (
  body: ReadableStream<Uint8Array>,
  host: string,
): ReadableStream<Uint8Array> => {
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel('payload too large').catch(() => {});
        controller.error(new UpstreamTooLargeError(host, total));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => {});
    },
  });
};

export const createCappingFetcher = (inner: Fetcher): Fetcher => ({
  fetch: async (url: URL, init?: RequestInit): Promise<Response> => {
    const res = await inner.fetch(url, init);
    const contentLength = Number(res.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      await res.body?.cancel(); // reject BEFORE reading (I6 edge)
      throw new UpstreamTooLargeError(url.host, contentLength);
    }
    if (res.body === null) return res;
    // Stream with a missing/lying Content-Length: abort mid-stream on overrun.
    return new Response(cappedBodyStream(res.body, url.host), res);
  },
});
