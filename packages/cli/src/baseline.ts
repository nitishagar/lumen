/**
 * Baseline file I/O (E1.3): reads exactly version 1 (the only version; a
 * future format bumps it and this reader will say so loudly), atomic write.
 * Malformed files are typed UsageErrors (exit 2), never a silent "no baseline".
 */
import { readFile } from 'node:fs/promises';
import type { BaselineFile } from '@lumen-seo/audit';
import { UsageError } from './usage-error.js';
import { writeFileAtomic } from './write-atomic.js';

export const readBaseline = async (path: string): Promise<BaselineFile> => {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    throw new UsageError(`cannot read baseline file ${path}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new UsageError(`baseline file ${path} is not valid JSON: ${(e as Error).message}`);
  }
  const b = parsed as Partial<BaselineFile>;
  if (b.version !== 1 || !Array.isArray(b.entries) || typeof b.seed !== 'string' || typeof b.writtenAt !== 'string') {
    throw new UsageError(
      `baseline file ${path} is not a lumen baseline (expected {version:1, seed, writtenAt, entries[]}) — regenerate it with --update-baseline`,
    );
  }
  for (const e of b.entries) {
    if (typeof e?.fp !== 'string' || typeof e?.url !== 'string') {
      throw new UsageError(`baseline file ${path} has a malformed entry (expected {fp, url})`);
    }
  }
  return parsed as BaselineFile;
};

export const writeBaselineAtomic = async (path: string, baseline: BaselineFile): Promise<void> => {
  await writeFileAtomic(path, `${JSON.stringify(baseline, null, 2)}\n`);
};
