import { describe, expect, it } from 'vitest';
import type { Issue } from '@lumen-seo/core';
import { sanitizeIssue, sanitizeText } from './sanitize.js';

describe('sanitizeText (I13)', () => {
  it('strips C0 control characters (except tab/LF per the locked plan regex) and DEL/C1', () => {
    expect(sanitizeText('a\u0000b\u0001c\u0008d\u000Be\u001Ff')).toBe('abcdef');
    expect(sanitizeText('a\u007Fb\u009Fc\u0085d')).toBe('abcd');
    // the plan's locked regex keeps \u0009 (tab) and \u000A (LF) — encoded as-is
    expect(sanitizeText('a\tb\nc')).toBe('a\tb\nc');
  });

  it('caps length at 300 code points by default and honors an explicit cap', () => {
    expect(sanitizeText('x'.repeat(400))).toHaveLength(300);
    expect(sanitizeText('x'.repeat(400), 10)).toHaveLength(10);
    // astral characters count as single code points (spread, not UTF-16 units)
    expect(sanitizeText('𐍈'.repeat(400), 5)).toBe('𐍈'.repeat(5));
  });
});

describe('sanitizeIssue (I13 — applied at assembly)', () => {
  it('sanitizes message, evidence.selector, evidence.snippet, and fixHint; preserves the rest', () => {
    const dirty: Issue = {
      ruleId: 'r',
      severity: 'error',
      message: `bad\u0000message${'x'.repeat(400)}`,
      evidence: { selector: 'a[href="\u0001"]', snippet: `snip\u0002${'y'.repeat(400)}` },
      fixHint: `hint\u0003${'z'.repeat(400)}`,
      url: 'https://example.com/page',
    };
    const clean = sanitizeIssue(dirty);
    expect(clean.ruleId).toBe('r');
    expect(clean.severity).toBe('error');
    expect(clean.url).toBe('https://example.com/page');
    expect(clean.message).toHaveLength(300);
    expect(clean.message).not.toContain('\u0000');
    expect(clean.evidence.selector).toBe('a[href=""]');
    expect(clean.evidence.snippet).toHaveLength(300);
    expect(clean.evidence.snippet).not.toContain('\u0002');
    expect(clean.fixHint).toHaveLength(300);
    expect(clean.fixHint).not.toContain('\u0003');
    // original untouched (no in-place mutation of rule output)
    expect(dirty.message).toContain('\u0000');
  });
});
