/**
 * Built-in provider metadata (I2): the seven canonical names, the core
 * boundary each answers, each source's DOCUMENTED request limit (evidence
 * A1–A4; undefined = undocumented gray endpoint), and the default GCRA
 * pacing whose worst-case rolling 60 s window is `rpm + burst`.
 *
 * Constants only — NO provider imports — so the Worker-safe entry
 * (`./worker.ts`) can re-export from here without reaching cheerio (R7/BA9).
 */
export const BUILTIN_PROVIDER_NAMES = [
  'google-suggest',
  'wikipedia-demand',
  'pagespeed',
  'crux',
  'openpagerank',
  'tranco',
  'ddg-serp',
] as const;

export type BuiltinProviderName = (typeof BUILTIN_PROVIDER_NAMES)[number];

/** Core boundary each built-in answers (I2 capability map; core calls them boundaries). */
export const PROVIDER_CAPABILITIES: Readonly<Record<BuiltinProviderName, 'keywords' | 'serp' | 'pagespeed' | 'crux' | 'authority'>> = {
  'google-suggest': 'keywords',
  'wikipedia-demand': 'keywords',
  pagespeed: 'pagespeed',
  crux: 'crux',
  openpagerank: 'authority',
  tranco: 'authority',
  'ddg-serp': 'serp',
};

/**
 * Documented limits per 60 s (IMPLICIT_SPEC A1–A4): crux 150 qpm/project,
 * openpagerank 60 req/min, wikipedia 200 req/min w/ contact UA, pagespeed
 * 240/min. suggest/ddg/tranco have no documented per-minute limit — their
 * defaults are conservative by construction and overrides pass through.
 */
export const DOCUMENTED_LIMITS: Readonly<Partial<Record<BuiltinProviderName, number>>> = {
  'wikipedia-demand': 200,
  pagespeed: 240,
  crux: 150,
  openpagerank: 60,
};

/** Default GCRA pacing (rate/min + burst → worst rolling 60 s window = rpm + burst). */
export const PACING_DEFAULTS: Readonly<Record<BuiltinProviderName, { rpm: number; burst: number }>> = {
  'google-suggest': { rpm: 30, burst: 5 }, // worst 35/min (undocumented endpoint, A5)
  'wikipedia-demand': { rpm: 60, burst: 10 }, // worst 70/min = 0.35× documented 200 (A3)
  pagespeed: { rpm: 60, burst: 10 }, // keyed worst 70/min = 0.29× documented 240 (A4); keyless 6+1 built into the provider
  crux: { rpm: 140, burst: 10 }, // worst 150 = documented limit, never above (A1)
  openpagerank: { rpm: 50, burst: 10 }, // worst 60 = documented limit, never above (A2)
  tranco: { rpm: 1, burst: 1 }, // not rate-limit-bound: 1 meta GET + 1 CSV per refresh window (A7)
  'ddg-serp': { rpm: 6, burst: 1 }, // 10 s spacing, worst 7/min (A6)
};
