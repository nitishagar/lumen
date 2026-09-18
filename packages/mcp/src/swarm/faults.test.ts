/**
 * Fault-injection tests (Stage 1): closed vocabulary, loud admission, and
 * typed-error shapes mirroring real providers.
 */
import { describe, expect, it } from 'vitest';
import { fixtureDeps, fixtureRemoteDeps } from '../testkit/index.js';
import {
  FAULTS,
  MAX_FAULT_LATENCY_MS,
  faultError,
  withProviderFaults,
} from './faults.js';
import type { FaultName } from './faults.js';

describe('fault vocabulary', () => {
  it('exposes exactly the five locked faults', () => {
    expect([...FAULTS]).toEqual(['rate-limited-429', 'upstream-5xx', 'parse-error', 'timeout', 'throw']);
  });

  it('faultError throws the taxonomy name + provider label per fault', () => {
    const names: Record<string, string> = {
      'rate-limited-429': 'RateLimitedError',
      'upstream-5xx': 'UpstreamError',
      'parse-error': 'ParseError',
      timeout: 'TimeoutError',
      throw: 'Error',
    };
    for (const [fault, name] of Object.entries(names)) {
      const e = faultError(fault as FaultName, 'fixture-x');
      expect(e.name).toBe(name);
      expect(e.message).toContain('fixture-x');
    }
  });

  it('unknown fault fails listing the five', () => {
    expect(() => withProviderFaults(fixtureDeps(), [{ capability: 'serp', fault: 'nuke' as never }])).toThrow(
      /Valid: rate-limited-429, upstream-5xx, parse-error, timeout, throw/,
    );
  });

  it('unknown capability fails listing the valid slots', () => {
    expect(() =>
      withProviderFaults(fixtureDeps(), [{ capability: 'nope' as never, fault: 'timeout' }]),
    ).toThrow(/Valid: keyword, authority, serp, pageSpeed, crux, auditRunner, pageMeta/);
  });

  it('duplicate slot fails deterministically', () => {
    expect(() =>
      withProviderFaults(fixtureDeps(), [
        { capability: 'serp', fault: 'timeout' },
        { capability: 'serp', fault: 'throw' },
      ]),
    ).toThrow(/duplicate fault for provider slot serp\[0\]/);
  });

  it(`latency outside 0..${MAX_FAULT_LATENCY_MS} fails`, () => {
    expect(() =>
      withProviderFaults(fixtureDeps(), [{ capability: 'serp', fault: 'timeout', latencyMs: 251 }]),
    ).toThrow(/latencyMs must be an integer/);
  });

  it('fault on an absent capability fails (local-only shape)', () => {
    expect(() =>
      withProviderFaults(fixtureRemoteDeps(), [{ capability: 'serp', fault: 'timeout' }]),
    ).toThrow(/absent from these deps/);
  });

  it('empty faults return deps untouched', () => {
    const deps = fixtureDeps();
    expect(withProviderFaults(deps, [])).toBe(deps);
  });
});

describe('fault wrappers', () => {
  it('keyword wrapper throws the typed taxonomy error with the provider label', async () => {
    const deps = withProviderFaults(fixtureDeps(), [{ capability: 'keyword', fault: 'rate-limited-429' }]);
    await expect(deps.keyword[0]?.ideas('broadfork', {})).rejects.toMatchObject({
      name: 'RateLimitedError',
    });
  });

  it('unwrapped providers keep working beside a faulted slot', async () => {
    const deps = withProviderFaults(fixtureDeps(), [{ capability: 'serp', fault: 'throw' }]);
    await expect(deps.keyword[0]?.ideas('broadfork', {})).resolves.toHaveLength(6);
    await expect(deps.serp?.search('x', {})).rejects.toThrow(/injected crash/);
  });

  it('auditRunner wrapper throws with the fixture-audit label', async () => {
    const deps = withProviderFaults(fixtureDeps(), [{ capability: 'auditRunner', fault: 'upstream-5xx' }]);
    await expect(deps.auditRunner?.run({ url: new URL('https://example.com/') })).rejects.toMatchObject({
      name: 'UpstreamError',
    });
  });
});
