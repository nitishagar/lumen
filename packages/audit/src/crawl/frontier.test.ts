import { describe, expect, it } from 'vitest';
import { Frontier } from './frontier.js';

describe('frontier', () => {
  it('dedupes fragment variants of the same URL', () => {
    const f = new Frontier(5, 1_000);
    expect(f.add(new URL('https://example.com/a'), 0)).toBe(true);
    expect(f.add(new URL('https://example.com/a#section'), 1)).toBe(false);
    expect(f.add(new URL('https://example.com/a#other'), 2)).toBe(false);
    expect(f.size).toBe(1);
    expect(f.seenSize).toBe(1);
  });

  it('keeps distinct paths and queries distinct', () => {
    const f = new Frontier(5, 1_000);
    f.add(new URL('https://example.com/a'), 0);
    expect(f.add(new URL('https://example.com/b'), 0)).toBe(true);
    expect(f.add(new URL('https://example.com/a?x=1'), 0)).toBe(true);
    expect(f.size).toBe(3);
  });

  it('is FIFO', () => {
    const f = new Frontier(5, 1_000);
    f.add(new URL('https://example.com/a'), 0);
    f.add(new URL('https://example.com/b'), 0);
    expect(f.take()?.url.href).toBe('https://example.com/a');
    expect(f.take()?.url.href).toBe('https://example.com/b');
    expect(f.take()).toBeUndefined();
  });

  it('rejects URLs deeper than maxDepth before they enter the frontier (A5)', () => {
    const f = new Frontier(2, 1_000);
    expect(f.add(new URL('https://example.com/'), 2)).toBe(true);
    expect(f.add(new URL('https://example.com/deep'), 3)).toBe(false);
    expect(f.size).toBe(1);
  });

  it('seen-set cap prevents unbounded growth', () => {
    const f = new Frontier(5, 3);
    expect(f.add(new URL('https://example.com/1'), 0)).toBe(true);
    expect(f.add(new URL('https://example.com/2'), 0)).toBe(true);
    expect(f.add(new URL('https://example.com/3'), 0)).toBe(true);
    expect(f.add(new URL('https://example.com/4'), 0)).toBe(false);
    expect(f.seenSize).toBe(3);
    // already-seen URLs stay deduped even below the cap
    expect(f.add(new URL('https://example.com/1'), 1)).toBe(false);
    expect(f.seenSize).toBe(3);
  });

  it('unshift returns an entry to the front without re-marking seen', () => {
    const f = new Frontier(5, 1_000);
    f.add(new URL('https://example.com/a'), 0);
    f.add(new URL('https://example.com/b'), 0);
    const entry = f.take()!;
    f.add(new URL('https://example.com/a'), 0); // false: already seen
    f.unshift(entry);
    expect(f.take()?.url.href).toBe('https://example.com/a');
    expect(f.seenSize).toBe(2);
  });
});
