import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The gate suite tests the BUILT artifact and never rebuilds it for you
 * (no silent rebuilds, no magic — PLAN Testing Strategy). Missing dist
 * fails fast with the exact command to run.
 */
export default function setup(): void {
  if (!existsSync(resolve(import.meta.dirname, '../dist'))) {
    throw new Error(
      'site/dist is missing — run `npm run build -w @lumen-seo/site` first. ' +
        'The gate suite tests the built artifact and will not rebuild it.',
    );
  }
}
