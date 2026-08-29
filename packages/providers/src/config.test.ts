import { describe, expect, it } from 'vitest';
import { BUILTIN_PROVIDER_NAMES, DOCUMENTED_LIMITS, PACING_DEFAULTS, PROVIDER_CAPABILITIES } from './builtins.js';
import { assertNoSecretValues, byokMapFromConfig, resolveEnvVar } from './config.js';
import { resolvePacing } from './throttle.js';

describe('TC-REG-1: the canonical name list (I2)', () => {
  it('contains exactly the seven built-ins', () => {
    expect([...BUILTIN_PROVIDER_NAMES]).toEqual([
      'google-suggest',
      'wikipedia-demand',
      'pagespeed',
      'crux',
      'openpagerank',
      'tranco',
      'ddg-serp',
    ]);
  });
});

describe('TC-REG-2: capability map declares each provider\'s core boundary', () => {
  it('every built-in maps to the boundary it implements', () => {
    expect(PROVIDER_CAPABILITIES).toEqual({
      'google-suggest': 'keywords',
      'wikipedia-demand': 'keywords',
      pagespeed: 'pagespeed',
      crux: 'crux',
      openpagerank: 'authority',
      tranco: 'authority',
      'ddg-serp': 'serp',
    });
  });

  it('every default pacing respects its documented limit when one exists (A1–A4)', () => {
    for (const name of BUILTIN_PROVIDER_NAMES) {
      const { rpm, burst } = resolvePacing(PACING_DEFAULTS[name]!, PACING_DEFAULTS[name]!, DOCUMENTED_LIMITS[name]);
      expect(rpm + burst, name).toBeLessThanOrEqual(DOCUMENTED_LIMITS[name] ?? rpm + burst);
    }
    // The two hard-capped providers sit exactly AT their documented limits, never above.
    expect(PACING_DEFAULTS.crux.rpm + PACING_DEFAULTS.crux.burst).toBe(150);
    expect(PACING_DEFAULTS.openpagerank.rpm + PACING_DEFAULTS.openpagerank.burst).toBe(60);
    expect(PACING_DEFAULTS['wikipedia-demand'].rpm + PACING_DEFAULTS['wikipedia-demand'].burst).toBe(70); // 0.35× of 200
  });
});

describe('TC-REG-4: secret VALUES in config are rejected (I1)', () => {
  it('rejects apiKey/token/secret-like keys and names the env-var alternative', () => {
    expect(() => assertNoSecretValues({ crux: { apiKey: 'AIza...' } as unknown as never })).toThrow(
      /environment variable.*LUMEN_CRUX_KEY.*envVar/s,
    );
    expect(() => assertNoSecretValues({ openpagerank: { token: 'x' } as unknown as never })).toThrow(
      /LUMEN_OPR_KEY/,
    );
    expect(() => assertNoSecretValues({ pagespeed: { secret: 'x' } as unknown as never })).toThrow(
      /LUMEN_PSI_KEY/,
    );
    expect(() => assertNoSecretValues({ tranco: { password: 'x' } as unknown as never })).toThrow(
      /LUMEN_TRANCO_KEY/,
    );
  });

  it('accepts knob-only and empty sections', () => {
    expect(() => assertNoSecretValues({})).not.toThrow();
    expect(() => assertNoSecretValues({ crux: { rpm: 100 }, tranco: { maxRows: 1000 }, 'ddg-serp': {} })).not.toThrow();
  });
});

describe('R5 env-var NAME resolution (post-RENAMES: LUMEN_* scheme)', () => {
  it('defaults to the documented names; config may override the NAME only', () => {
    expect(resolveEnvVar('pagespeed')).toBe('LUMEN_PSI_KEY');
    expect(resolveEnvVar('crux')).toBe('LUMEN_CRUX_KEY');
    expect(resolveEnvVar('openpagerank')).toBe('LUMEN_OPR_KEY');
    expect(resolveEnvVar('pagespeed', { envVar: 'MY_OWN_PSI_VAR' })).toBe('MY_OWN_PSI_VAR');
    expect(resolveEnvVar('tranco')).toBe(''); // key-free provider
  });

  it('rejects malformed env-var names (must look like an env NAME, not a value)', () => {
    expect(() => resolveEnvVar('crux', { envVar: 'AIzaSy-not-a-name' })).toThrow(/env-var NAME/);
  });

  it('byokMapFromConfig surfaces only explicit overrides for core registry validation', () => {
    expect(byokMapFromConfig({ crux: { envVar: 'MY_CRUX_VAR' }, tranco: { maxRows: 5 } })).toEqual({
      crux: 'MY_CRUX_VAR',
    });
  });
});

describe('opts-bridge normalizes core opts (BA12)', () => {
  it('applies documented defaults', async () => {
    const { toSuggestOpts, toDemandOpts, toSerpQueryOpts, toCruxQueryOpts, toReportQueryOpts } = await import(
      './opts-bridge.js'
    );
    expect(toSuggestOpts({})).toEqual({ lang: 'en', limit: undefined });
    expect(toDemandOpts({ lang: 'fr' })).toEqual({ lang: 'fr' });
    expect(toSerpQueryOpts({})).toEqual({ lang: 'en', limit: 20 });
    expect(toCruxQueryOpts({})).toEqual({ formFactor: 'phone', scope: 'origin' });
    expect(toCruxQueryOpts({ formFactor: 'desktop', scope: 'url' } as never)).toEqual({
      formFactor: 'desktop',
      scope: 'url',
    });
    expect(toReportQueryOpts({})).toEqual({ strategy: 'mobile', automated: false });
    expect(toReportQueryOpts({ strategy: 'desktop', automated: true })).toEqual({
      strategy: 'desktop',
      automated: true,
    });
  });
});
