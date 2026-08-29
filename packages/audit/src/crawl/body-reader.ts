/**
 * Capped body reads (I15): Content-Length pre-check plus a capped stream
 * read. Oversized bodies abort the read — pages are skipped `oversized`;
 * sitemaps keep the truncated prefix (`keepPartial`) so their entries still
 * seed discovery, with a warning.
 */
export interface BodyResult {
  text: string;
  bytes: number;
  oversized: boolean;
}

const byteLength = (s: string): number => new TextEncoder().encode(s).length;

export const readBodyCapped = async (res: Response, cap: number, o: { keepPartial?: boolean } = {}): Promise<BodyResult> => {
  const declared = Number(res.headers.get('content-length'));
  if (res.body !== null && Number.isFinite(declared) && declared > cap) {
    await res.body.cancel().catch(() => {});
    return { text: '', bytes: declared, oversized: true };
  }
  if (res.body === null) {
    const text = await res.text();
    return { text, bytes: byteLength(text), oversized: false };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > cap) {
      await reader.cancel().catch(() => {});
      return { text: o.keepPartial === true ? text : '', bytes, oversized: true };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode(); // flush the decoder
  return { text, bytes, oversized: false };
};

/**
 * Content-type classification: HTML flavors are parsed; everything else is
 * skipped `non_html`. An absent content-type is treated as HTML (lenient
 * default — rules then fire naturally on the parsed document).
 */
export const isHtmlContentType = (res: Response): boolean => {
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  if (ct === '') return true;
  return ct.includes('text/html') || ct.includes('application/xhtml+xml');
};
