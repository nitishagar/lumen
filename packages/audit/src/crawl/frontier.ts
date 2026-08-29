/**
 * FIFO BFS frontier (plan Phase 1).
 *
 * Bounded twice (A3/I15): `maxDepth` rejects too-deep URLs at `add` (they
 * never enter the frontier, so a depth-bounded drain still COMPLETES — A5),
 * and the seen-set is capped at `seenCap` (default `100 x maxPages`) so a
 * pathological link graph cannot grow memory unboundedly.
 */
import { normalizeKey } from './url-normalize.js';

export interface FrontierEntry {
  url: URL;
  key: string;
  depth: number;
}

export class Frontier {
  private readonly queue: FrontierEntry[] = [];
  private readonly seen = new Set<string>();
  private readonly maxDepth: number;
  private readonly seenCap: number;

  constructor(maxDepth: number, seenCap: number) {
    this.maxDepth = maxDepth;
    this.seenCap = seenCap;
  }

  /** Enqueue a URL at `depth`; false when depth-capped, already seen, or over the seen-set cap. */
  add(url: URL, depth: number): boolean {
    if (depth > this.maxDepth) return false;
    const key = normalizeKey(url);
    if (this.seen.has(key)) return false;
    if (this.seen.size >= this.seenCap) return false;
    this.seen.add(key);
    this.queue.push({ url, key, depth });
    return true;
  }

  /** Dequeue the next entry (FIFO). */
  take(): FrontierEntry | undefined {
    return this.queue.shift();
  }

  /** Return an entry to the FRONT of the queue (budget give-back — never re-marks `seen`). */
  unshift(entry: FrontierEntry): void {
    this.queue.unshift(entry);
  }

  get size(): number {
    return this.queue.length;
  }

  get seenSize(): number {
    return this.seen.size;
  }
}
