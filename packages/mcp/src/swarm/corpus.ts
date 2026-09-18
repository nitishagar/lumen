/**
 * Swarm corpus loader (Stage 1): reads + validates `evals/data/adversaries.json`.
 * Admission is loud — an invalid corpus fails the run before any case executes:
 * oversize file, non-array root, bad id, unknown tool, malformed fault spec
 * (vocabulary, latencyMs bounds, providerIndex shape, duplicate slots — the
 * same `validateFaultSpecs` the wrapper enforces), or any arg URL where
 * `redactUrl(url) !== url` (the corpus must be secret-free; the shared
 * predicate, no new one). `SWARM_ONLY` selects a comma-separated id subset;
 * an unknown id fails listing the valid ids.
 */
import { readFileSync } from 'node:fs';
import { redactUrl } from '@lumen-seo/providers';
import { TOOL_NAMES } from '../schemas.js';
import { validateFaultSpecs } from '../swarm/faults.js';
import type { ProviderFault } from '../swarm/faults.js';

export interface AdversaryFixtureIssue {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface AdversaryExpect {
  isError: boolean;
  /** Exact payload.code match (JSON-parsed err payloads). */
  code?: string;
  /** Every string must appear in the joined tool-result text. */
  textContains?: string[];
  /** page_report-style legs that must read {status:'unavailable'}. */
  unavailableLegs?: string[];
  /** Subset match (JSON-strict per key) on the parsed payload. */
  jsonSubset?: Record<string, unknown>;
}

export interface AdversaryCase {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** Fixture composition: full five-tool shape, or the Worker's local-only shape. */
  deps: 'full' | 'remote';
  providerFaults: ProviderFault[];
  /** Canned audit issues (audit_site only): proves rule surfacing + gating. */
  auditIssues?: AdversaryFixtureIssue[];
  expect: AdversaryExpect;
}

/** Corpus files stay KB-scale (read whole — bounded input). */
export const MAX_CORPUS_BYTES = 1_048_576;
const ID_RE = /^[a-z0-9-]{1,64}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const assertSecretFree = (id: string, value: unknown, path: string): void => {
  if (typeof value === 'string') {
    let redacted: string;
    try {
      redacted = redactUrl(new URL(value));
    } catch {
      return;
    }
    if (redacted !== value) {
      throw new Error(
        `adversary "${id}" arg ${path} contains a secret-bearing URL (redacted: ${redacted}) — corpus must be secret-free`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertSecretFree(id, v, `${path}[${i}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) assertSecretFree(id, v, `${path}.${k}`);
  }
};

const validateCase = (raw: unknown, index: number): AdversaryCase => {
  if (!isRecord(raw)) throw new Error(`adversary corpus[${index}]: entry must be an object`);
  const { id, tool, args, deps, providerFaults, auditIssues, expect } = raw;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`adversary corpus[${index}]: id must match ${String(ID_RE)}`);
  }
  if (typeof tool !== 'string' || !(TOOL_NAMES as readonly string[]).includes(tool)) {
    throw new Error(`adversary "${id}": unknown tool "${String(tool)}". Valid: ${TOOL_NAMES.join(', ')}`);
  }
  if (!isRecord(args)) throw new Error(`adversary "${id}": args must be an object`);
  if (deps !== undefined && deps !== 'full' && deps !== 'remote') {
    throw new Error(`adversary "${id}": deps must be "full" or "remote"`);
  }
  if (!Array.isArray(providerFaults)) throw new Error(`adversary "${id}": providerFaults must be an array`);
  for (const [i, f] of providerFaults.entries()) {
    if (!isRecord(f)) throw new Error(`adversary "${id}": providerFaults[${i}] must be an object`);
  }
  // Full spec validation (vocabulary, latencyMs, providerIndex, duplicate
  // slots) at load — an invalid corpus fails before any case executes.
  validateFaultSpecs(providerFaults as unknown as ProviderFault[], `adversary "${id}"`);
  if (!isRecord(expect) || typeof expect.isError !== 'boolean') {
    throw new Error(`adversary "${id}": expect must be an object with boolean isError`);
  }
  assertSecretFree(id, args, 'args');
  let issues: AdversaryFixtureIssue[] | undefined;
  if (auditIssues !== undefined) {
    if (!Array.isArray(auditIssues)) throw new Error(`adversary "${id}": auditIssues must be an array`);
    issues = auditIssues.map((issue, i) => {
      if (!isRecord(issue) || typeof issue.ruleId !== 'string' || typeof issue.message !== 'string') {
        throw new Error(`adversary "${id}": auditIssues[${i}] needs {ruleId, severity, message}`);
      }
      if (issue.severity !== 'error' && issue.severity !== 'warning' && issue.severity !== 'info') {
        throw new Error(`adversary "${id}": auditIssues[${i}].severity must be error|warning|info`);
      }
      return { ruleId: issue.ruleId, severity: issue.severity, message: issue.message };
    });
  }
  return {
    id,
    tool,
    args,
    deps: deps ?? 'full',
    providerFaults: providerFaults as unknown as ProviderFault[],
    ...(issues === undefined ? {} : { auditIssues: issues }),
    expect: expect as unknown as AdversaryExpect,
  };
};

export const loadCorpus = (path: URL | string): AdversaryCase[] => {
  const raw = readFileSync(path, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_CORPUS_BYTES) {
    throw new Error(`adversary corpus exceeds ${MAX_CORPUS_BYTES} bytes (${path.toString()})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`adversary corpus is not valid JSON (${path.toString()})`);
  }
  if (!Array.isArray(parsed)) throw new Error('adversary corpus root must be an array');
  const cases = parsed.map(validateCase);
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`duplicate adversary id "${c.id}"`);
    seen.add(c.id);
  }
  return cases;
};

/** `SWARM_ONLY` id filter (comma-separated); unknown ids fail with the valid list. */
export const selectCases = (cases: readonly AdversaryCase[], only: string | undefined): AdversaryCase[] => {
  if (only === undefined || only.trim() === '') return [...cases];
  const wanted = only.split(',').map((s) => s.trim()).filter((s) => s !== '');
  const unknown = wanted.filter((w) => !cases.some((c) => c.id === w));
  if (unknown.length > 0) {
    throw new Error(`unknown adversary id(s): ${unknown.join(', ')} — valid: ${cases.map((c) => c.id).join(', ')}`);
  }
  return cases.filter((c) => wanted.includes(c.id));
};
