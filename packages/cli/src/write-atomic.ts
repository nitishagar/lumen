/**
 * Atomic file writes (I13/E3/E14): write to a temp file in the TARGET's
 * directory, then rename — no partially-written file ever exists under the
 * target name (rename is atomic within a filesystem).
 */
import { rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const writeFileAtomic = async (p: string, data: string): Promise<void> => {
  const tmp = join(dirname(p), `.${basename(p)}.tmp-${process.pid}-${Date.now().toString(36)}`);
  try {
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, p);
  } catch (err) {
    await import('node:fs/promises').then((fs) => fs.rm(tmp, { force: true }).catch(() => undefined));
    throw err;
  }
};

const basename = (p: string): string => p.split('/').pop() ?? p;
