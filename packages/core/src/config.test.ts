import { afterEach, describe, expect, it } from 'vitest';
import type { ConfigFileReader } from './config.js';
import { DEFAULT_CONFIG, loadConfig, VALID_TOP_LEVEL_KEYS } from './config.js';
import { ConfigError } from './errors.js';

const readerOf = (content: string | null): ConfigFileReader & { calls: string[] } => {
  const calls: string[] = [];
  const read: ConfigFileReader = async (p: string) => {
    calls.push(p);
    return content;
  };
  return Object.assign(read, { calls });
};

const load = async (content: string | null, path?: string) =>
  loadConfig(path ?? 'lumen.config.json', readerOf(content));

afterEach(() => {
  delete process.env.LUMEN_TEST_SECRET;
});

describe('config loader (SC-3 / SC-5)', () => {
  it('missing file → full defaults, NOT an error', async () => {
    const cfg = await load(null);
    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(cfg.failThreshold).toBe('error'); // R2 default
    expect(cfg.crawl.maxPages).toBe(100); // R3 default
  });

  it('default path is lumen.config.json; explicit path is honored (BA-14)', async () => {
    const r1 = readerOf(null);
    await loadConfig(undefined, r1);
    expect(r1.calls).toEqual(['lumen.config.json']);

    const r2 = readerOf(JSON.stringify({ failThreshold: 'off' }));
    const cfg = await loadConfig('/elsewhere/lumen.config.json', r2);
    expect(r2.calls).toEqual(['/elsewhere/lumen.config.json']);
    expect(cfg.failThreshold).toBe('off');
  });

  it('malformed JSON → ConfigError', async () => {
    await expect(load('{ not json')).rejects.toBeInstanceOf(ConfigError);
    await expect(load('{ "failThreshold": ')).rejects.toThrow(/malformed/i);
  });

  it('JSON that is not an object → ConfigError', async () => {
    for (const bad of ['[1,2,3]', '"a string"', '42', 'true', 'null']) {
      await expect(load(bad), bad).rejects.toBeInstanceOf(ConfigError);
    }
  });

  it('unknown TOP-LEVEL key → ConfigError listing the valid keys', async () => {
    const err = await load('{"verbosity": "high"}').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    const details = (err as ConfigError).details;
    expect(details.some((d) => d.path === 'verbosity')).toBe(true);
    const msg = details.map((d) => d.message).join(' ');
    for (const key of VALID_TOP_LEVEL_KEYS) expect(msg).toContain(key);
  });

  it('unknown key under "crawl" → ConfigError listing the crawl keys', async () => {
    const err = await load('{"crawl": {"maxPagez": 5}}').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    const detail = (err as ConfigError).details.find((d) => d.path === 'crawl.maxPagez');
    expect(detail?.message).toMatch(/maxPages/);
    expect(detail?.message).toMatch(/maxDepth/);
    expect(detail?.message).toMatch(/maxDurationMs/);
    expect(detail?.message).toMatch(/maxConcurrency/);
    expect(detail?.message).toMatch(/perHostMinDelayMs/);
  });

  it('unknown key under "providers" → ConfigError listing the five boundaries', async () => {
    const err = await load('{"providers": {"keywordz": "x"}}').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    const detail = (err as ConfigError).details.find((d) => d.path === 'providers.keywordz');
    expect(detail?.message).toMatch(/keywords/);
    expect(detail?.message).toMatch(/serp/);
    expect(detail?.message).toMatch(/pagespeed/);
    expect(detail?.message).toMatch(/crux/);
    expect(detail?.message).toMatch(/authority/);
  });

  it('non-string provider selection values are rejected', async () => {
    await expect(load('{"providers": {"keywords": 7}}')).rejects.toBeInstanceOf(ConfigError);
  });

  it('failThreshold outside error|warning|info|off → ConfigError listing the enum (R1/R2)', async () => {
    const err = await load('{"failThreshold": "fatal"}').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    const detail = (err as ConfigError).details.find((d) => d.path === 'failThreshold');
    expect(detail?.message).toMatch(/error.*warning.*info.*off/);
  });

  it('all four failThreshold values are accepted', async () => {
    for (const t of ['error', 'warning', 'info', 'off'] as const) {
      const cfg = await load(JSON.stringify({ failThreshold: t }));
      expect(cfg.failThreshold).toBe(t);
    }
  });

  it('severityOverrides value outside error|warning|info → ConfigError (R1, F4)', async () => {
    const err = await load('{"severityOverrides": {"title-missing": "fatal"}}').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    const detail = (err as ConfigError).details.find((d) => d.path === 'severityOverrides.title-missing');
    expect(detail?.message).toMatch(/error.*warning.*info/);
  });

  it('severityOverrides with a valid value is preserved verbatim', async () => {
    const cfg = await load('{"severityOverrides": {"title-missing": "info", "img-alt": "warning"}}');
    expect(cfg.severityOverrides).toEqual({ 'title-missing': 'info', 'img-alt': 'warning' });
  });

  it('crawl numbers must be positive integers — 0/negative/fraction/non-number rejected', async () => {
    for (const bad of ['{"crawl": {"maxPages": 0}}', '{"crawl": {"maxDepth": -1}}',
      '{"crawl": {"maxConcurrency": 2.5}}', '{"crawl": {"maxDurationMs": "1000"}}',
      '{"crawl": {"perHostMinDelayMs": -250}}']) {
      await expect(load(bad), bad).rejects.toBeInstanceOf(ConfigError);
    }
  });

  it('perHostMinDelayMs may be 0 (politeness delay disabled); other budgets must be >= 1', async () => {
    const cfg = await load('{"crawl": {"perHostMinDelayMs": 0}}');
    expect(cfg.crawl.perHostMinDelayMs).toBe(0);
  });

  it('maxPages is hard-clamped at 10 000, not an error (R3, F5)', async () => {
    const cfg = await load('{"crawl": {"maxPages": 20000}}');
    expect(cfg.crawl.maxPages).toBe(10_000);
  });

  it('maxPages below the ceiling passes through untouched', async () => {
    const cfg = await load('{"crawl": {"maxPages": 250}}');
    expect(cfg.crawl.maxPages).toBe(250);
  });

  it('byok values must be valid env-var NAMES (SC-5)', async () => {
    await expect(load('{"byok": {"pagespeed": "psi-key"}}')).rejects.toBeInstanceOf(ConfigError); // lowercase
    await expect(load('{"byok": {"pagespeed": "1BAD"}}')).rejects.toBeInstanceOf(ConfigError); // starts with digit
    await expect(load('{"byok": {"pagespeed": 42}}')).rejects.toBeInstanceOf(ConfigError); // not a string
    const cfg = await load('{"byok": {"pagespeed": "LUMEN_PSI_KEY", "crux": "LUMEN_CRUX_KEY"}}');
    expect(cfg.byok).toEqual({ pagespeed: 'LUMEN_PSI_KEY', crux: 'LUMEN_CRUX_KEY' }); // verbatim
  });

  it('loader never reads env-var VALUES (I16) — names only, no leakage', async () => {
    process.env.LUMEN_TEST_SECRET = 'super-secret-value';
    const cfg = await load('{"byok": {"pagespeed": "LUMEN_TEST_SECRET"}}');
    expect(cfg.byok.pagespeed).toBe('LUMEN_TEST_SECRET');
    expect(JSON.stringify(cfg)).not.toContain('super-secret-value');
  });

  it('plugins must be an array of strings', async () => {
    await expect(load('{"plugins": "./my-rule.js"}')).rejects.toBeInstanceOf(ConfigError);
    await expect(load('{"plugins": [42]}')).rejects.toBeInstanceOf(ConfigError);
    const cfg = await load('{"plugins": ["./my-rule.js", "./other.mjs"]}');
    expect(cfg.plugins).toEqual(['./my-rule.js', './other.mjs']);
  });

  it('a fully-valid config resolves to a frozen ResolvedConfig', async () => {
    const cfg = await load(JSON.stringify({
      providers: { keywords: 'google-suggest', serp: 'ddg-serp' },
      severityOverrides: { 'title-missing': 'warning' },
      crawl: { maxPages: 50, maxDepth: 3, maxDurationMs: 60_000, maxConcurrency: 2, perHostMinDelayMs: 500 },
      failThreshold: 'warning',
      byok: { pagespeed: 'LUMEN_PSI_KEY' },
      plugins: ['./my-rule.js'],
    }));
    expect(cfg.providers).toEqual({ keywords: 'google-suggest', serp: 'ddg-serp' });
    expect(cfg.crawl).toEqual({ maxPages: 50, maxDepth: 3, maxDurationMs: 60_000, maxConcurrency: 2, perHostMinDelayMs: 500 });
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.crawl)).toBe(true);
    expect(Object.isFrozen(cfg.providers)).toBe(true);
    expect(Object.isFrozen(cfg.plugins)).toBe(true);
  });

  it('unspecified budget fields fall back to R3 defaults (partial crawl object)', async () => {
    const cfg = await load('{"crawl": {"maxPages": 7}}');
    expect(cfg.crawl).toEqual({ maxPages: 7, maxDepth: 5, maxDurationMs: 300_000, maxConcurrency: 5, perHostMinDelayMs: 250 });
  });

  it('multiple problems accumulate into one ConfigError with one detail each', async () => {
    const err = await load('{"nope1": 1, "failThreshold": "x", "crawl": {"bad": 1}}').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    const paths = (err as ConfigError).details.map((d) => d.path);
    expect(paths).toEqual(['nope1', 'failThreshold', 'crawl.bad']);
  });
});
