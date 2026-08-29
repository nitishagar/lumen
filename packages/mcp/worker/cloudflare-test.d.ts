/**
 * Minimal ambient types for the `cloudflare:test` module provided at runtime
 * by @cloudflare/vitest-plugin (only what the worker tests use).
 */
declare module 'cloudflare:test' {
  export interface SelfFetcher {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  }
  export const SELF: SelfFetcher;
}
