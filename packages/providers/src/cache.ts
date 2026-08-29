/**
 * The providers-local cache port (BA2): core defines no cache contract, so
 * the TTL cache lives here behind a tiny interface. The in-memory default
 * is deterministic (expiry judged on the injected clock); surfaces may later
 * inject a file-backed store without touching provider code.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, expiresAtMs: number): Promise<void>;
}

interface Entry {
  value: unknown;
  expiresAtMs: number;
}

export class InMemoryCache implements CacheStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly clock: () => number = Date.now) {}

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (this.clock() >= entry.expiresAtMs) {
      this.entries.delete(key); // lazy expiry on the injected clock (I10)
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, expiresAtMs: number): Promise<void> {
    this.entries.set(key, { value, expiresAtMs });
  }

  /** Number of live entries (test introspection only). */
  get size(): number {
    return this.entries.size;
  }
}
