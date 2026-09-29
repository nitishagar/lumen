/**
 * `lumen.config.json` loader (SC-3/SC-5, BA-14).
 *
 * Rules:
 * - missing file → full defaults, NOT an error;
 * - malformed JSON / non-object root → ConfigError;
 * - unknown keys at any CLOSED-vocabulary level (top level, `providers`
 *   boundaries, `crawl` budgets) → ConfigError listing the valid keys;
 *   `byok` and `severityOverrides` are OPEN maps (provider/rule ids are
 *   validated by the registries against what is actually available);
 * - numeric budgets must be integers (>= 1; `perHostMinDelayMs` may be 0);
 *   `maxPages` is hard-clamped at 10 000 (R3);
 * - `failThreshold` ∈ error|warning|info|off (R1/R2); `severityOverrides`
 *   values ∈ error|warning|info (R1);
 * - `byok` values are env-var NAMES matching ^[A-Z_][A-Z0-9_]*$ — the loader
 *   never reads, resolves, logs, or persists env-var VALUES (I16).
 *
 * The `read` collaborator is injectable (I10 — no filesystem in tests; the
 * disk-backed reader lives in the Node-only `@lumen-seo/core/node` subpath so
 * this module stays Workers-safe). `null` from `read` means "file missing".
 */
import { DEFAULT_BUDGETS, MAX_PAGES_CEILING } from './budgets.js';
import type { CrawlBudgets } from './budgets.js';
import { ConfigError } from './errors.js';
import type { ConfigErrorDetail } from './errors.js';
import { isProviderBoundary, PROVIDER_BOUNDARIES } from './providers.js';
import type { ProviderBoundary } from './providers.js';
import { allowPrivateEntryError } from './private-scope.js';
import { isSeverity, SEVERITIES } from './severity.js';
import type { Severity } from './severity.js';

export type FailThreshold = Severity | 'off';

export const FAIL_THRESHOLDS: readonly FailThreshold[] = ['error', 'warning', 'info', 'off'];

const isFailThreshold = (v: unknown): v is FailThreshold =>
  typeof v === 'string' && (FAIL_THRESHOLDS as readonly string[]).includes(v);

export const VALID_TOP_LEVEL_KEYS = [
  'providers',
  'severityOverrides',
  'crawl',
  'failThreshold',
  'byok',
  'plugins',
  'history',
] as const;

export type TopLevelKey = (typeof VALID_TOP_LEVEL_KEYS)[number];

const CRAWL_KEYS = [
  'maxPages',
  'maxDepth',
  'maxDurationMs',
  'maxConcurrency',
  'perHostMinDelayMs',
  'allowPrivateHosts',
  'checkExternal',
  'externalLinkCap',
] as const;

type CrawlKey = (typeof CRAWL_KEYS)[number];
/** The numeric budget keys — `allowPrivateHosts` is a validated string array, handled separately. */
type NumericCrawlKey = Exclude<CrawlKey, 'allowPrivateHosts' | 'checkExternal' | 'externalLinkCap'>;

const HISTORY_KEYS = ['maxGenerations'] as const;

type HistoryKey = (typeof HISTORY_KEYS)[number];

export interface ResolvedConfig {
  readonly providers: Readonly<Partial<Record<ProviderBoundary, string>>>;
  readonly severityOverrides: Readonly<Record<string, Severity>>;
  readonly crawl: Readonly<CrawlBudgets>;
  readonly failThreshold: FailThreshold;
  readonly byok: Readonly<Record<string, string>>;
  readonly plugins: readonly string[];
  /** E2.3: local history retention. */
  readonly history: { maxGenerations: number };
}

/** Returns the file's text, or `null` when the file does not exist. */
export type ConfigFileReader = (path: string) => Promise<string | null>;

const ENV_VAR_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

export const DEFAULT_CONFIG: ResolvedConfig = deepFreeze({
  providers: {},
  severityOverrides: {},
  crawl: { ...DEFAULT_BUDGETS },
  failThreshold: 'error', // R2
  byok: {},
  plugins: [],
  history: { maxGenerations: 2 }, // current + one rotated (R9)
});

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const expectObject = (
  details: ConfigErrorDetail[],
  path: string,
  value: unknown,
  what: string,
): value is Record<string, unknown> => {
  if (!isPlainObject(value)) {
    details.push({ path, message: `must be an object: ${what}` });
    return false;
  }
  return true;
};

export const loadConfig = async (
  path = 'lumen.config.json',
  read: ConfigFileReader = async () => null,
): Promise<ResolvedConfig> => {
  const content = await read(path);
  if (content === null) return DEFAULT_CONFIG;

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new ConfigError([{ path, message: `malformed JSON: ${(e as Error).message}` }]);
  }
  if (!isPlainObject(raw)) {
    throw new ConfigError([{ path, message: 'config root must be a JSON object' }]);
  }
  return resolveConfig(raw);
};

const resolveConfig = (root: Record<string, unknown>): ResolvedConfig => {
  const details: ConfigErrorDetail[] = [];

  const providers: Partial<Record<ProviderBoundary, string>> = {};
  const severityOverrides: Record<string, Severity> = {};
  const crawl: CrawlBudgets = { ...DEFAULT_BUDGETS };
  let failThreshold: FailThreshold = 'error';
  const byok: Record<string, string> = {};
  const history: { maxGenerations: number } = { ...DEFAULT_CONFIG.history };
  const plugins: string[] = [];

  for (const [key, value] of Object.entries(root)) {
    switch (key) {
      case 'providers': {
        if (!expectObject(details, 'providers', value, 'provider selection per boundary')) break;
        for (const [boundary, name] of Object.entries(value)) {
          if (!isProviderBoundary(boundary)) {
            details.push({
              path: `providers.${boundary}`,
              message: `unknown key. Valid keys under "providers": ${PROVIDER_BOUNDARIES.join(', ')}`,
            });
          } else if (typeof name !== 'string' || name.length === 0) {
            details.push({ path: `providers.${boundary}`, message: 'must be a non-empty provider name string' });
          } else {
            providers[boundary] = name;
          }
        }
        break;
      }
      case 'severityOverrides': {
        if (!expectObject(details, 'severityOverrides', value, 'ruleId → severity')) break;
        for (const [ruleId, severity] of Object.entries(value)) {
          if (!isSeverity(severity)) {
            details.push({
              path: `severityOverrides.${ruleId}`,
              message: `must be one of: ${SEVERITIES.join(', ')} (R1)`,
            });
          } else {
            severityOverrides[ruleId] = severity;
          }
        }
        break;
      }
      case 'crawl': {
        if (!expectObject(details, 'crawl', value, 'crawl budget numbers')) break;
        for (const [k, n] of Object.entries(value)) {
          if (!(CRAWL_KEYS as readonly string[]).includes(k)) {
            details.push({
              path: `crawl.${k}`,
              message: `unknown key. Valid keys under "crawl": ${CRAWL_KEYS.join(', ')}`,
            });
            continue;
          }
          if (k === 'checkExternal') {
            if (typeof n !== 'boolean') {
              details.push({ path: 'crawl.checkExternal', message: 'must be a boolean (external-link checks are opt-in)' });
              continue;
            }
            crawl.checkExternal = n;
            continue;
          }
          if (k === 'externalLinkCap') {
            if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
              details.push({ path: 'crawl.externalLinkCap', message: 'must be an integer >= 1' });
              continue;
            }
            crawl.externalLinkCap = n;
            continue;
          }
          if (k === 'allowPrivateHosts') {
            // E1.1: exact hostnames / CIDRs the SSRF guard may allow AT THE SEED ORIGIN.
            // Loud validation: a malformed or allow-everything entry is a config error.
            if (!Array.isArray(n) || n.some((e) => typeof e !== 'string')) {
              details.push({ path: 'crawl.allowPrivateHosts', message: 'must be an array of hostname or CIDR strings' });
              continue;
            }
            const entryErrors = (n as string[])
              .map((e) => allowPrivateEntryError(e))
              .filter((msg): msg is string => msg !== null);
            if (entryErrors.length > 0) {
              details.push({ path: 'crawl.allowPrivateHosts', message: entryErrors.join('; ') });
              continue;
            }
            crawl.allowPrivateHosts = Object.freeze([...(n as string[])]);
            continue;
          }
          const min = k === 'perHostMinDelayMs' ? 0 : 1; // a zero politeness delay is meaningful; budgets are not
          if (typeof n !== 'number' || !Number.isInteger(n) || n < min) {
            details.push({ path: `crawl.${k}`, message: `must be an integer >= ${min}` });
          } else {
            crawl[k as NumericCrawlKey] = n;
          }
        }
        break;
      }
      case 'failThreshold': {
        if (!isFailThreshold(value)) {
          details.push({
            path: 'failThreshold',
            message: `must be one of: ${FAIL_THRESHOLDS.join(', ')} (R1/R2)`,
          });
        } else {
          failThreshold = value;
        }
        break;
      }
      case 'byok': {
        if (!expectObject(details, 'byok', value, 'provider name → env-var NAME')) break;
        for (const [provider, envName] of Object.entries(value)) {
          if (typeof envName !== 'string' || !ENV_VAR_NAME_RE.test(envName)) {
            details.push({
              path: `byok.${provider}`,
              message:
                'value must be an env-var NAME matching ^[A-Z_][A-Z0-9_]*$ (values are read from the environment at call time and are never stored in config)',
            });
          } else {
            byok[provider] = envName;
          }
        }
        break;
      }
      case 'history': {
        if (!expectObject(details, 'history', value, 'history retention settings')) break;
        for (const [k, n] of Object.entries(value)) {
          if (!(HISTORY_KEYS as readonly string[]).includes(k)) {
            details.push({
              path: `history.${k}`,
              message: `unknown key. Valid keys under "history": ${HISTORY_KEYS.join(', ')}`,
            });
            continue;
          }
          if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 100) {
            details.push({ path: `history.${k}`, message: 'must be an integer 1..100' });
          } else {
            history[k as HistoryKey] = n;
          }
        }
        break;
      }
      case 'plugins': {
        if (!Array.isArray(value)) {
          details.push({ path: 'plugins', message: 'must be an array of local module paths' });
          break;
        }
        value.forEach((p, i) => {
          if (typeof p !== 'string') {
            details.push({ path: `plugins[${i}]`, message: 'must be a string module path' });
          } else {
            plugins.push(p);
          }
        });
        break;
      }
      default:
        details.push({
          path: key,
          message: `unknown key. Valid keys are: ${VALID_TOP_LEVEL_KEYS.join(', ')}`,
        });
    }
  }

  if (crawl.maxPages > MAX_PAGES_CEILING) crawl.maxPages = MAX_PAGES_CEILING; // hard clamp (R3/F5)

  if (details.length > 0) throw new ConfigError(details);

  return deepFreeze({ providers, severityOverrides, crawl, failThreshold, byok, plugins, history });
};
