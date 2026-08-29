/**
 * BYOK configuration surface (I1 + R5, renamed per RENAMES.md): config may
 * carry an env-var NAME (`envVar`) and tuning knobs per provider — NEVER a
 * secret value. Secret-like keys are rejected with an error that names the
 * env-var alternative. Values are resolved at call time via `deps.env`.
 */
import { ProviderError } from './errors.js';
import type { BuiltinProviderName } from './builtins.js';

export interface ProviderSettings {
  /** Env-var NAME holding the key (default: the R5 name for this provider). */
  envVar?: string;
  /** Pacing overrides; clamped so rpm+burst stays ≤ the documented limit (TC-REG-6). */
  rpm?: number;
  burst?: number;
  /** Tranco: days between list refreshes (default 7) and the stale ceiling multiplier. */
  refreshDays?: number;
  /** Tranco: how many CSV rows to index (default 100_000). */
  maxRows?: number;
}

export type ProvidersConfig = Readonly<Partial<Record<BuiltinProviderName, ProviderSettings>>>;

/** R5 env-var names (scheme LUMEN_<PROVIDER>_KEY), post-rename. */
export const BYOK_ENV_VARS = {
  pagespeed: 'LUMEN_PSI_KEY',
  crux: 'LUMEN_CRUX_KEY',
  openpagerank: 'LUMEN_OPR_KEY',
} as const satisfies Record<string, string>;

const SECRET_LIKE = /^(api[_-]?key|key|token|secret|password)$/i;
const ENV_VAR_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

/**
 * I1 hardening: a provider section that embeds a secret VALUE is rejected —
 * the error tells the user to put the key in an environment variable and
 * NAME it via `envVar`.
 */
export function assertNoSecretValues(cfg: ProvidersConfig): void {
  for (const [name, settings] of Object.entries(cfg) as [BuiltinProviderName, ProviderSettings | undefined][]) {
    if (settings === undefined) continue;
    for (const k of Object.keys(settings)) {
      if (SECRET_LIKE.test(k)) {
        throw new ProviderError(
          'not_configured',
          name,
          `config key "${k}" looks like a secret value — put the key in an environment variable ` +
            `(e.g. ${BYOK_ENV_VARS[name as keyof typeof BYOK_ENV_VARS] ?? `LUMEN_${name.toUpperCase().replace(/-/g, '_')}_KEY`}) ` +
            `and use "envVar" to NAME it`,
        );
      }
    }
  }
}

/** Validates `envVar` shape and resolves the env-var NAME for a provider (config override → R5 default). */
export function resolveEnvVar(provider: BuiltinProviderName, cfg?: ProviderSettings): string {
  const name = cfg?.envVar ?? BYOK_ENV_VARS[provider as keyof typeof BYOK_ENV_VARS];
  if (name !== undefined && !ENV_VAR_NAME_RE.test(name)) {
    throw new ProviderError(
      'not_configured',
      provider,
      `envVar must be an env-var NAME matching ^[A-Z_][A-Z0-9_]*$ (got "${name}")`,
    );
  }
  return name ?? '';
}

/** The `byok` map core's registry validates: provider name → env-var NAME, from config overrides only. */
export function byokMapFromConfig(cfg: ProvidersConfig): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [name, settings] of Object.entries(cfg) as [BuiltinProviderName, ProviderSettings | undefined][]) {
    if (settings?.envVar !== undefined) map[name] = resolveEnvVar(name, settings);
  }
  return map;
}
