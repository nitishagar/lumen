/** Shared argument validation for CLI commands (I15). */
import { UsageError } from './usage-error.js';

export const MAX_SEED_LENGTH = 120;

export const validateSeed = (raw: string, what = 'seed'): string => {
  const seed = raw.trim();
  if (seed.length === 0) throw new UsageError(`${what} must not be empty`);
  if (seed.length > MAX_SEED_LENGTH) {
    throw new UsageError(`${what} exceeds ${MAX_SEED_LENGTH} characters (got ${seed.length})`);
  }
  return seed;
};

export const validateLimit = (n: number | undefined, fallback = 20, max = 50): number => {
  const limit = n ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new UsageError(`limit must be an integer between 1 and ${max}`);
  }
  return limit;
};

const LANG_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

export const validateLang = (raw: string | boolean | undefined): string | undefined => {
  if (raw === undefined || raw === true || raw === false) return undefined;
  if (!LANG_RE.test(raw)) throw new UsageError(`lang must look like a language tag, got "${raw}"`);
  return raw;
};
