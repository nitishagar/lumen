/**
 * Path-safe report ids (I13): `audit-<host>-<stamp>-<rand>` with every
 * component reduced to `[a-z0-9.-]` — safe to use as a filename. Hostile
 * hosts AND hostile random components are sanitized through the same filter
 * (the plan's worked example: '../evil' → '..-evil').
 */

export const reportIdFor = (host: string, startedAtIso: string, rand: string): string => {
  const safe = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63);
  const stamp = startedAtIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); // UTC ISO w/ Z
  return `audit-${safe(host) || 'site'}-${stamp}-${safe(rand) || '0'}`;
};
