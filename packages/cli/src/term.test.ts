import { describe, expect, it } from 'vitest';
import { clean, cleanLines } from './term.js';

describe('term sanitizer (I13/E3)', () => {
  it('strips ANSI CSI sequences', () => {
    expect(clean('\x1b[31mred\x1b[0m text')).toBe('red text');
    expect(clean('\x1b[1;92mbold-green\x1b[0m')).toBe('bold-green');
    expect(clean('a\x1b[?25lb')).toBe('ab');
  });

  it('strips OSC sequences', () => {
    expect(clean('\x1b]0;title\x07after')).toBe('after');
    expect(clean('\x1b]8;;http://evil\x1b\\link-end\x1b]8;;\x1b\\')).toBe('link-end');
  });

  it('replaces C0 and C1 control characters with spaces', () => {
    expect(clean('a\x00b\x07c\x1fd')).toBe('a b c d');
    expect(clean('x\x80y\x9fz')).toBe('x y z');
    expect(clean('tab\tkeep')).toBe('tab keep'); // C0 \t is a control char
  });

  it('caps length with a single ellipsis', () => {
    const long = 'a'.repeat(500);
    const out = clean(long, 200);
    expect(out.length).toBe(200);
    expect(out.endsWith('…')).toBe(true);
    expect(out.slice(0, 199)).toBe('a'.repeat(199));
  });

  it('keeps short strings untouched', () => {
    expect(clean('https://example.com/page')).toBe('https://example.com/page');
  });

  it('sanitizes each line independently', () => {
    expect(cleanLines('\x1b[31mone\x1b[0m\ntwo\x00')).toEqual(['one', 'two ']);
  });
});
