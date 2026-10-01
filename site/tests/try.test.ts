import { describe, expect, test } from 'vitest';
import { builtJs, readDist } from './helpers';

/**
 * Try-it widget contract — the /try page ships the native demo widget and
 * wires it to the Worker's locked REST subset. Markup assertions run over
 * the built page; behavior assertions run over the built JS bundles (the
 * widget script ships there — presence of the route paths + BYOK headers
 * proves the bundle carried the widget, not a dead button).
 */
const page = 'try/index.html';

describe('try-it widget', () => {
  test('built page exists with the widget root + tabs + forms', () => {
    const html = readDist(page);
    expect(html).toContain('data-try-root');
    expect(html).toContain('data-try-tabs');
    expect(html).toContain('data-try-form="report"');
    expect(html).toContain('data-try-form="ideas"');
    expect(html).toContain('data-try-result="report"');
    expect(html).toContain('data-try-result="ideas"');
    expect(html).toContain('data-try-endpoint');
    expect(html).toContain('data-try-status');
  });

  test('endpoint field is editable (visitor can paste any worker URL)', () => {
    const html = readDist(page);
    expect(html).toMatch(/<input[^>]*data-try-endpoint[^>]*>/);
    expect(html).not.toMatch(/<input[^>]*data-try-endpoint[^>]*disabled/);
  });

  test('BYOK key fields are password inputs (no shoulder-surfing)', () => {
    const html = readDist(page);
    expect(html).toMatch(/<input[^>]*name="psiKey"[^>]*type="password"/);
    expect(html).toMatch(/<input[^>]*name="cruxKey"[^>]*type="password"/);
  });

  test('built JS calls the locked REST subset with the BYOK headers', () => {
    const js = builtJs();
    expect(js).toContain('/api/v1/page-report');
    expect(js).toContain('/api/v1/keyword-ideas');
    expect(js).toContain('x-lumen-psi-key');
    expect(js).toContain('x-lumen-crux-key');
  });

  test('built JS renders honest outcomes (unreachable + unavailability are states, not silence)', () => {
    const js = builtJs();
    expect(js).toContain('Worker unreachable');
    expect(js).toContain('Unavailable:');
    expect(js).toContain('No worker endpoint');
  });

  test('no innerHTML in the widget bundle path (textContent-only rendering)', () => {
    // The widget renders untrusted API payloads; innerHTML anywhere in the
    // shipped JS would be an injection sink. (Pagefind ships its own chunk
    // under pagefind/ — builtJs only covers assets/.)
    expect(builtJs()).not.toContain('innerHTML');
  });
});
