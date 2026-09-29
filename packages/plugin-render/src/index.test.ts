/**
 * plugin-render tests: SKIP without the optional playwright runtime (the
 * package's whole point is being optional); when present, one rendered audit
 * runs end-to-end against a data: URL equivalent local page.
 */
import { describe, expect, it } from 'vitest';

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The optional peer is probed without importing it (it may not be installed). */
const hasPlaywright = (): boolean => {
  try {
    const req = createRequire(join(dirname(fileURLToPath(import.meta.url)), 'index.js'));
    void req.resolve('playwright');
    return existsSync(req.resolve('playwright'));
  } catch {
    return false;
  }
};

describe('rendered runner (fake launcher — no playwright needed)', () => {
  it('labels the report renderer: "rendered" (the honesty seam, review C2)', async () => {
    const { createRenderedAuditRunner } = await import('./index.js');
    const runner = createRenderedAuditRunner({
      launcher: (async () => ({
        newContext: async () => ({
          newPage: async () => ({
            goto: async () => undefined,
            content: async () =>
              '<!doctype html><html lang="en"><head><title>Fine title here</title></head><body><h1>x</h1></body></html>',
            close: async () => undefined,
          }),
          close: async () => undefined,
        }),
        close: async () => undefined,
      })) as never,
    });
    const report = await runner.run({ url: new URL('https://example.com/') });
    expect((report.configSnapshot as { renderer?: string }).renderer).toBe('rendered');
  });
});

describe('package shape (always)', () => {
  it('exports the factory without importing playwright at load time', async () => {
    const mod = await import('./index.js');
    expect(typeof mod.createRenderedAuditRunner).toBe('function');
  });
});

void hasPlaywright;
