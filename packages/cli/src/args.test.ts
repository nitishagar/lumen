import { describe, expect, it } from 'vitest';
import { extractConfigFlag, interceptHelp, intFlag, parseCommand } from './args.js';
import { MemoryIo } from './io.js';
import { UsageError } from './usage-error.js';

describe('args dispatch (B1/B12/E15/I15)', () => {
  describe('help intercept runs before strict parsing', () => {
    it('bare invocation prints root usage', () => {
      const io = new MemoryIo();
      expect(interceptHelp([], io)).toBe(true);
      expect(io.stdout.join('')).toContain('Usage:');
      expect(io.stderr).toEqual([]);
    });

    it('--help and -h as first token print root usage', () => {
      for (const flag of ['--help', '-h']) {
        const io = new MemoryIo();
        expect(interceptHelp([flag], io)).toBe(true);
        expect(io.stdout.join('')).toContain('lumen <command> [flags]');
      }
    });

    it('per-command --help prints command usage, including with other flags present', () => {
      const io = new MemoryIo();
      expect(interceptHelp(['audit', 'https://example.com', '--json', '--help'], io)).toBe(true);
      const text = io.stdout.join('');
      expect(text).toContain('lumen audit');
      expect(text).toContain('--fail-threshold');
    });

    it('unknown command with --help still prints root usage (help is never an error)', () => {
      const io = new MemoryIo();
      expect(interceptHelp(['bogus', '--help'], io)).toBe(true);
      expect(io.stdout.join('')).toContain('lumen <command> [flags]');
    });

    it('non-help argv is not intercepted', () => {
      expect(interceptHelp(['audit', 'https://example.com'], new MemoryIo())).toBe(false);
    });

    it('"help" is NOT a subcommand', () => {
      expect(() => parseCommand(['help'])).toThrow(UsageError);
      expect(() => parseCommand(['help'])).toThrow(/unknown command "help"/);
    });
  });

  describe('unknown command/flag -> UsageError (exit 2 path)', () => {
    it('unknown command names the mistake and hints at help', () => {
      expect(() => parseCommand(['auditt'])).toThrow(/unknown command "auditt".*lumen --help/s);
    });

    it('unknown flag is rejected by strict parseArgs with a usage hint', () => {
      expect(() => parseCommand(['audit', 'https://example.com', '--verbose'])).toThrow(UsageError);
      expect(() => parseCommand(['audit', 'https://example.com', '--verbose'])).toThrow(
        /lumen audit --help/,
      );
    });

    it('wrong positional count is a usage error', () => {
      expect(() => parseCommand(['audit'])).toThrow(/expects <url>/);
      expect(() => parseCommand(['audit', 'a', 'b'])).toThrow(UsageError);
      expect(() => parseCommand(['mcp', 'extra'])).toThrow(/expects no positional arguments/);
    });

    it('config only accepts the show subcommand', () => {
      expect(() => parseCommand(['config', 'set'])).toThrow(/only "lumen config show" exists/);
      expect(parseCommand(['config', 'show']).command).toBe('config');
    });

    it('parses a full audit invocation', () => {
      const parsed = parseCommand([
        'audit',
        'https://example.com',
        '--max-pages',
        '25',
        '--out',
        'r.json',
        '--fail-threshold',
        'warning',
        '--json',
      ]);
      expect(parsed.command).toBe('audit');
      expect(parsed.positionals).toEqual(['https://example.com']);
      expect(parsed.flags['max-pages']).toBe('25');
      expect(parsed.flags['fail-threshold']).toBe('warning');
      expect(parsed.flags.json).toBe(true);
    });
  });

  describe('--config extraction (B12)', () => {
    it('extracts --config <path> from any position', () => {
      const { argv, config } = extractConfigFlag(['audit', '--config', '/tmp/c.json', 'https://x.com']);
      expect(config).toBe('/tmp/c.json');
      expect(argv).toEqual(['audit', 'https://x.com']);
    });

    it('extracts --config=<path>', () => {
      const { config } = extractConfigFlag(['--config=/tmp/c.json', 'report', 'https://x.com']);
      expect(config).toBe('/tmp/c.json');
    });

    it('missing value is a usage error', () => {
      expect(() => extractConfigFlag(['audit', '--config'])).toThrow(UsageError);
      expect(() => extractConfigFlag(['--config='])).toThrow(UsageError);
    });

    it('keeps --config out of the command parse', () => {
      const parsed = parseCommand(['keywords', 'seed', '--config', '/tmp/c.json', '--json']);
      expect(parsed.configPathFlag).toBe('/tmp/c.json');
      expect(parsed.flags.json).toBe(true);
    });
  });

  describe('intFlag coercion', () => {
    it('parses decimal integers', () => {
      expect(intFlag({ limit: '20' }, 'limit')).toBe(20);
    });

    it('rejects non-numeric values with a typed error', () => {
      expect(() => intFlag({ limit: 'abc' }, 'limit')).toThrow(UsageError);
      expect(() => intFlag({ limit: '20.5' }, 'limit')).toThrow(/integer/);
    });

    it('returns undefined for absent flags', () => {
      expect(intFlag({}, 'limit')).toBeUndefined();
    });
  });
});

describe('red-team round 1: --config stops at the end-of-options separator', () => {
  it('a --config after -- is left as a positional, not extracted', () => {
    const { argv, config } = extractConfigFlag(['config', 'show', '--', '--config', '/tmp/other.json']);
    expect(config).toBeUndefined();
    expect(argv).toEqual(['config', 'show', '--', '--config', '/tmp/other.json']);
  });

  it('a --config before -- is still extracted', () => {
    const { argv, config } = extractConfigFlag(['--config', 'lumen.config.json', 'config', 'show', '--']);
    expect(config).toBe('lumen.config.json');
    expect(argv).toEqual(['config', 'show', '--']);
  });
});
