import { describe, expect, it } from 'vitest';
import { reportIdFor } from './id.js';

describe('reportIdFor (I13 path safety)', () => {
  it('report: id is path-safe for hostile hosts AND hostile randomId components (spaces, unicode, control chars, slashes, overlong)', () => {
    // plan worked example: IDN host (URL punycodes) + stamped UTC ISO
    expect(reportIdFor(new URL('https://Bücher.example').host, '2026-08-29T10:15:00.123Z', 'a1b2c3')).toBe(
      'audit-xn--bcher-kva.example-20260829T101500Z-a1b2c3',
    );
    // plan worked example: hostile rand is sanitized through the same filter
    expect(reportIdFor('ok.example', '2026-08-29T10:15:00.123Z', '../evil')).toBe(
      'audit-ok.example-20260829T101500Z-..-evil',
    );
    const hostile = [
      'a b c',
      'héllo.example',
      'bad\u0000\u001Fhost',
      '../../etc/passwd',
      'UPPER.CASE',
      'x'.repeat(200),
    ];
    for (const host of hostile) {
      for (const rand of hostile) {
        const id = reportIdFor(host, '2026-08-29T10:15:00.123Z', rand);
        expect(id).toMatch(/^audit-[a-z0-9.-]+-20260829T101500Z-[a-z0-9.-]+$/);
        // audit- (6) + host ≤63 + '-' + 16-char stamp + '-' + rand ≤63
        expect(id.length).toBeLessThanOrEqual(6 + 63 + 1 + 16 + 1 + 63);
      }
    }
    // empty host falls back to 'site'; empty rand falls back to '0'
    expect(reportIdFor('', '2026-08-29T10:15:00.123Z', '')).toBe('audit-site-20260829T101500Z-0');
    expect(reportIdFor(',,,', '2026-08-29T10:15:00.123Z', '///')).toBe('audit-site-20260829T101500Z-0');
    // overlong components truncate at 63 characters
    expect(reportIdFor('x'.repeat(200), '2026-08-29T10:15:00.123Z', 'y'.repeat(200))).toBe(
      `audit-${'x'.repeat(63)}-20260829T101500Z-${'y'.repeat(63)}`,
    );
  });
});
