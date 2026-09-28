/**
 * SARIF 2.1.0 offline validation gate (PRD E1.4 AC): renders a real SARIF
 * document through the CLI (spawned bin, fixture loopback site) and validates
 * it against the VENDORED official schema with a minimal zero-dependency
 * validator — type/required/enum/properties/items + local `#/definitions`
 * $ref resolution + anyOf/oneOf OR-over-subschemas (the emitted results hit
 * the `message` and `physicalLocation` anyOf constraints).
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Tolerant runner: the CLI legitimately exits 1 when findings gate — capture
// code/stdout/stderr without rejecting.
const runTolerant = (...args) =>
  promisify(execFile)(...args).then(
    (r) => ({ code: 0, ...r }),
    (e) => ({ code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }),
  );
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BIN = join(HERE, '..', 'packages', 'cli', 'bin', 'lumen.js');
const SCHEMA = JSON.parse(readFileSync(join(HERE, 'schemas', 'sarif-2.1.0.json'), 'utf8'));

// ── minimal validator ────────────────────────────────────────────────────────
const errors = [];
const resolveRef = (schema, ref) => {
  let node = SCHEMA;
  for (const part of ref.replace(/^#\//, '').split('/')) node = node?.[part];
  return node ?? schema;
};

const validate = (value, schema, path) => {
  if (schema === undefined || schema === true) return;
  if (schema.$ref !== undefined) {
    validate(value, resolveRef(schema, schema.$ref), path);
    return;
  }
  if (schema.anyOf !== undefined) {
    const ok = schema.anyOf.some((sub) => {
      const saved = errors.length;
      validate(value, sub, path);
      if (errors.length === saved) return true;
      errors.length = saved;
      return false;
    });
    if (!ok) errors.push(`${path}: matched no anyOf branch`);
    return;
  }
  if (schema.oneOf !== undefined) {
    const matches = schema.oneOf.filter((sub) => {
      const saved = errors.length;
      validate(value, sub, path);
      const ok = errors.length === saved;
      errors.length = saved;
      return ok;
    });
    if (matches.length !== 1) errors.push(`${path}: matched ${matches.length} oneOf branches (need exactly 1)`);
    return;
  }
  if (schema.type !== undefined) {
    const t = schema.type;
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const ok = Array.isArray(t) ? t.includes(actual === 'integer' ? 'number' : actual) || (t.includes('integer') && Number.isInteger(value)) : actual === t || (t === 'integer' && Number.isInteger(value)) || (t === 'number' && typeof value === 'number');
    if (!ok) {
      errors.push(`${path}: expected type ${JSON.stringify(t)}, got ${actual}`);
      return;
    }
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum).slice(0, 80)}`);
  }
  if (schema.required !== undefined) {
    for (const key of schema.required) {
      if (value?.[key] === undefined) errors.push(`${path}: missing required "${key}"`);
    }
  }
  if (schema.properties !== undefined && typeof value === 'object' && value !== null) {
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (value[key] !== undefined) validate(value[key], sub, `${path}.${key}`);
    }
  }
  if (schema.items !== undefined && Array.isArray(value)) {
    value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`));
  }
};

// ── the gate ─────────────────────────────────────────────────────────────────
const PAGE = `<!doctype html><html lang="en"><head><title>x</title></head><body><h1>x</h1></body></html>`;
let server;
let dir;

beforeAll(async () => {
  server = createServer((_q, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'lumen-sarif-'));
  writeFileSync(join(dir, 'lumen.config.json'), '{}', 'utf8');
});

afterAll(async () => {
  await new Promise((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

// The mutation self-test reuses the artifact rendered by the first test
// (re-rendering via sync exec would block this process's event loop and the
// in-process fixture server could not answer the CLI's requests).
let fixtureDoc = null;

describe('SARIF 2.1.0 offline validation (E1.4 AC)', () => {
  it('a real rendered SARIF document validates against the vendored schema', async () => {
    const port = server.address().port;
    const out = join(dir, 'out.sarif');
    // execFile (NOT the sync form): the fixture server lives in THIS process,
    // and a sync exec would block the event loop so the server could never
    // answer the CLI's robots/crawl requests.
    const { code, stderr } = await runTolerant('node', [
      BIN, 'audit', `http://127.0.0.1:${port}`, '--allow-private', '--max-pages', '1',
      '--format', 'sarif', '--out', out,
    ], { cwd: dir, env: { ...process.env, LUMEN_HISTORY_DIR: join(dir, '.lumen', 'history') } });

    // the fixture page HAS findings — exit 1 is the honest gate outcome.
    expect(code).toBe(1);
    expect(stderr).toBe('');
    const doc = JSON.parse(readFileSync(out, 'utf8'));
    fixtureDoc = readFileSync(out, 'utf8');
    expect(doc.runs[0].results.length).toBeGreaterThan(0); // the fixture page really has findings
    errors.length = 0;
    validate(doc, SCHEMA, '$');
    expect(errors, `schema violations:\n${errors.slice(0, 12).join('\n')}`).toEqual([]);
  }, 60_000);

  it('stdout carries the doc WITHOUT --out and stays SILENT with --out (CI contract)', async () => {
    const port = server.address().port;
    const env = { ...process.env, LUMEN_HISTORY_DIR: join(dir, '.lumen', 'history') };
    const piped = await runTolerant('node', [
      BIN, 'audit', `http://127.0.0.1:${port}`, '--allow-private', '--max-pages', '1',
      '--format', 'sarif',
    ], { cwd: dir, env, encoding: 'utf8' });
    expect(piped.stdout.trim().startsWith('{')).toBe(true);
    expect(piped.code).toBe(1);

    const outPath = join(dir, 'silent.sarif');
    const silent = await runTolerant('node', [
      BIN, 'audit', `http://127.0.0.1:${port}`, '--allow-private', '--max-pages', '1',
      '--format', 'sarif', '--out', outPath,
    ], { cwd: dir, env, encoding: 'utf8' });
    expect(silent.stdout).toBe(''); // artifact-only: stdout silent with --out
    expect(silent.code).toBe(1);
    expect(JSON.parse(readFileSync(outPath, 'utf8')).version).toBe('2.1.0');
  }, 60_000);

  it('the validator catches REAL violations (mutation self-test — a neutered gate fails here)', () => {
    expect(fixtureDoc).not.toBeNull();
    const good = JSON.parse(fixtureDoc);
    // mutate: result missing message.text (anyOf text/id must reject)
    const bad = JSON.parse(fixtureDoc);
    bad.runs[0].results[0].message = {};
    errors.length = 0;
    validate(good, SCHEMA, '$');
    expect(errors).toEqual([]);
    errors.length = 0;
    validate(bad, SCHEMA, '$');
    expect(errors.join('\n')).toMatch(/message|anyOf/);
    // mutate: bogus level enum
    const badLevel = JSON.parse(fixtureDoc);
    badLevel.runs[0].results[0].level = 'catastrophic';
    errors.length = 0;
    validate(badLevel, SCHEMA, '$');
    expect(errors.join('\n')).toMatch(/enum|level/);
  });
});
