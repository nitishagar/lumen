import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readSrc, siteRoot, walk, srcDir } from './helpers';

/**
 * G4 — escaping ban (I13: output safety). Astro escapes every interpolation;
 * the raw-injection escape hatches are banned from site source entirely.
 * The allowlist is intentionally EMPTY — any future need must edit this
 * gate, loudly, in its own commit.
 */

const bannedTokens = ['set:html', 'is:raw'];

type Allowlist = readonly string[];
const allowlist: Allowlist = JSON.parse(
  readFileSync(join(siteRoot, 'tests/allowlists/escaping.json'), 'utf8'),
) as Allowlist;

describe('G4 escaping scan', () => {
  test('allowlist is empty by design', () => {
    expect(allowlist).toEqual([]);
  });

  test.each(bannedTokens)('%j appears in zero site source files', (token) => {
    const offenders: string[] = [];
    for (const rel of walk(srcDir)) {
      if (allowlist.includes(rel)) continue;
      if (readSrc(rel).includes(token)) offenders.push(`${rel} (via "${token}")`);
    }
    expect(offenders).toEqual([]);
  });
});
