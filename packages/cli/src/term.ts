/**
 * Terminal output safety (I13/E3): crawled strings rendered in human mode are
 * stripped of ANSI CSI/OSC sequences and all C0/C1 control characters, then
 * length-capped. JSON mode never passes through here — JSON encoding handles
 * escaping; this sanitizer exists for terminal echo only.
 */
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const C0_C1 = /[\x00-\x1f\x7f-\x9f]/g;

export const DEFAULT_TERM_CAP = 200;

export const clean = (s: string, max = DEFAULT_TERM_CAP): string => {
  const stripped = s.replace(OSC, '').replace(CSI, '').replace(C0_C1, ' ');
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
};

/** Sanitize each line of a multi-line block with the same rules. */
export const cleanLines = (s: string, max = DEFAULT_TERM_CAP): string[] =>
  s.split('\n').map((l) => clean(l, max));
