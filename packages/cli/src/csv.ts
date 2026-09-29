/**
 * Shared CSV helpers (E2.3, extracted from rank.ts — the formula
 * neutralization is security-relevant and must never fork): `= @` starters
 * are neutralized with a leading apostrophe; quote/escape per RFC 4180.
 */
export const csvCell = (v: string | number | boolean | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v);
  const body = /^[=@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(body) ? `"${body.replace(/"/g, '""')}"` : body;
};

export const csvRow = (cells: readonly (string | number | boolean | null | undefined)[]): string =>
  cells.map(csvCell).join(',');
