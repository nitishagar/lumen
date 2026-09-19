/**
 * Swarm fault injection (Stage 1): wraps testkit fixture providers so
 * adversary cases can program partial-failure taxonomy faults without
 * touching production code. Every injected fault throws the same TYPED
 * error shape a real provider would surface (`RateLimitedError`,
 * `UpstreamError`, `ParseError`, `TimeoutError` + `label`), so handlers
 * exercise their real degrade paths. A crashing provider (`throw`) is the
 * only novel shape, and it exists to prove tasks catch into scores.
 *
 * Closed vocabulary: unknown capabilities/faults fail loudly listing the
 * valid options (mirrors the provider-registry edge). At most one fault per
 * provider slot (duplicates are a loud error — deterministic runs only).
 * Injected latency is bounded (0..250ms); termination is structural (finite
 * corpus x bounded faults), so there is deliberately NO budget knob here.
 */
import type {
  AuthorityProvider,
  CruxProvider,
  KeywordProvider,
  PageSpeedProvider,
  SerpProvider,
} from '@lumen-seo/core';
import type { AuditRunner, PageMetaFetcher } from '../ports.js';
import type { McpDeps } from '../server.js';

/** Closed fault vocabulary (unknown faults fail listing these five). */
export const FAULTS = [
  'rate-limited-429',
  'upstream-5xx',
  'parse-error',
  'timeout',
  'throw',
] as const;
export type FaultName = (typeof FAULTS)[number];

/** McpDeps keys addressable by a fault (mirrors the McpDeps interface). */
export const FAULT_CAPABILITIES = [
  'keyword',
  'authority',
  'serp',
  'pageSpeed',
  'crux',
  'auditRunner',
  'pageMeta',
] as const;
export type FaultCapability = (typeof FAULT_CAPABILITIES)[number];

export interface ProviderFault {
  capability: FaultCapability;
  /** Index into array capabilities (`keyword`, `authority`); default 0. */
  providerIndex?: number;
  fault: FaultName;
  /** Injected pre-fault delay, bounded 0..250ms; default 0. */
  latencyMs?: number;
}

/** Upper bound for injected latency (keeps the swarm wall-clock honest). */
export const MAX_FAULT_LATENCY_MS = 250;

/** Typed error mirroring what a real provider surfaces for each fault. */
export const faultError = (fault: FaultName, label: string): Error => {
  switch (fault) {
    case 'rate-limited-429':
      return Object.assign(new Error(`${label}: 429 rate limited (injected fault)`), {
        name: 'RateLimitedError',
        label,
      });
    case 'upstream-5xx':
      return Object.assign(new Error(`${label}: 503 upstream failure (injected fault)`), {
        name: 'UpstreamError',
        label,
      });
    case 'parse-error':
      return Object.assign(new Error(`${label}: malformed upstream body (injected fault)`), {
        name: 'ParseError',
        label,
      });
    case 'timeout':
      return Object.assign(new Error(`${label}: timed out (injected fault)`), {
        name: 'TimeoutError',
        label,
      });
    case 'throw':
      return new Error(`${label}: injected crash`);
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const inject = async (label: string, fault: FaultName, latencyMs: number): Promise<never> => {
  if (latencyMs > 0) await sleep(latencyMs);
  throw faultError(fault, label);
};

const slotKey = (f: ProviderFault): string => `${f.capability}[${f.providerIndex ?? 0}]`;

/**
 * Static fault-spec validation (no deps needed) — shared by the corpus loader
 * so an invalid corpus fails at load, before any case executes, with the same
 * rules the wrapper enforces at run time.
 */
export const validateFaultSpecs = (faults: readonly ProviderFault[], where = 'fault'): void => {
  const seen = new Set<string>();
  for (const f of faults) {
    if (!(FAULT_CAPABILITIES as readonly string[]).includes(f.capability)) {
      throw new Error(
        `${where}: unknown fault capability "${(f as { capability: unknown }).capability}". Valid: ${FAULT_CAPABILITIES.join(', ')}`,
      );
    }
    if (!(FAULTS as readonly string[]).includes(f.fault)) {
      throw new Error(`${where}: unknown fault "${(f as { fault: unknown }).fault}". Valid: ${FAULTS.join(', ')}`);
    }
    const latency = f.latencyMs ?? 0;
    if (!Number.isInteger(latency) || latency < 0 || latency > MAX_FAULT_LATENCY_MS) {
      throw new Error(
        `${where}: latencyMs must be an integer 0..${MAX_FAULT_LATENCY_MS} (got ${String(f.latencyMs)})`,
      );
    }
    const idx = f.providerIndex ?? 0;
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`${where}: providerIndex must be a non-negative integer (got ${String(f.providerIndex)})`);
    }
    if (f.providerIndex !== undefined && f.capability !== 'keyword' && f.capability !== 'authority') {
      throw new Error(
        `${where}: providerIndex is only meaningful for keyword/authority (got ${String(f.providerIndex)} for ${f.capability})`,
      );
    }
    const key = slotKey(f);
    if (seen.has(key)) throw new Error(`${where}: duplicate fault for provider slot ${key} — at most one fault per slot`);
    seen.add(key);
  }
};

/** Deps-dependent range checks on top of `validateFaultSpecs`. */
const validateFaults = (deps: McpDeps, faults: readonly ProviderFault[]): void => {
  validateFaultSpecs(faults);
  for (const f of faults) {
    const idx = f.providerIndex ?? 0;
    if (f.capability === 'keyword' || f.capability === 'authority') {
      if (idx >= deps[f.capability].length) {
        throw new Error(`fault providerIndex ${String(f.providerIndex)} out of range for ${f.capability} (size ${deps[f.capability].length})`);
      }
    } else if (
      (f.capability === 'serp' || f.capability === 'pageSpeed' || f.capability === 'crux' ||
        f.capability === 'auditRunner' || f.capability === 'pageMeta') &&
      deps[f.capability] === undefined
    ) {
      throw new Error(`fault targets ${f.capability}, which is absent from these deps (local-only shape?)`);
    }
  }
};

/** Returns deps with the faulted provider slots replaced by throwing wrappers. */
export const withProviderFaults = (deps: McpDeps, faults: readonly ProviderFault[]): McpDeps => {
  validateFaults(deps, faults);
  if (faults.length === 0) return deps;
  const bySlot = new Map(faults.map((f) => [slotKey(f), f] as const));
  const spec = (capability: FaultCapability, index: number): ProviderFault | undefined =>
    bySlot.get(`${capability}[${index}]`);

  const wrapKeyword = (p: KeywordProvider, index: number): KeywordProvider => {
    const s = spec('keyword', index);
    if (s === undefined) return p;
    return { ...p, ideas: async (_seed, _o) => inject(p.name, s.fault, s.latencyMs ?? 0) };
  };
  const wrapAuthority = (p: AuthorityProvider, index: number): AuthorityProvider => {
    const s = spec('authority', index);
    if (s === undefined) return p;
    return { ...p, authority: async (_domain, _o) => inject(p.name, s.fault, s.latencyMs ?? 0) };
  };
  let serp: SerpProvider | undefined = deps.serp;
  {
    const s = spec('serp', 0);
    if (s !== undefined && serp !== undefined) {
      const p = serp;
      serp = { ...p, search: async (_q, _o) => inject(p.name, s.fault, s.latencyMs ?? 0) };
    }
  }
  let pageSpeed: PageSpeedProvider | undefined = deps.pageSpeed;
  {
    const s = spec('pageSpeed', 0);
    if (s !== undefined && pageSpeed !== undefined) {
      const p = pageSpeed;
      pageSpeed = { ...p, report: async (_url, _o) => inject(p.name, s.fault, s.latencyMs ?? 0) };
    }
  }
  let crux: CruxProvider | undefined = deps.crux;
  {
    const s = spec('crux', 0);
    if (s !== undefined && crux !== undefined) {
      const p = crux;
      crux = { ...p, record: async (_url, _o) => inject(p.name, s.fault, s.latencyMs ?? 0) };
    }
  }
  let auditRunner: AuditRunner | undefined = deps.auditRunner;
  {
    const s = spec('auditRunner', 0);
    if (s !== undefined && auditRunner !== undefined) {
      const fault = s.fault;
      const latency = s.latencyMs ?? 0;
      auditRunner = {
        run: async () => inject('fixture-audit', fault, latency),
      };
    }
  }
  let pageMeta: PageMetaFetcher | undefined = deps.pageMeta;
  {
    const s = spec('pageMeta', 0);
    if (s !== undefined && pageMeta !== undefined) {
      const fault = s.fault;
      const latency = s.latencyMs ?? 0;
      pageMeta = {
        fetch: async () => inject('fixture-page-meta', fault, latency),
      };
    }
  }
  return {
    ...deps,
    keyword: deps.keyword.map(wrapKeyword),
    authority: deps.authority.map(wrapAuthority),
    serp,
    pageSpeed,
    crux,
    auditRunner,
    pageMeta,
  };
};
