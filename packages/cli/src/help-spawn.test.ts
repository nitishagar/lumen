import { describe, expect, it } from 'vitest';
import { COMMAND_NAMES } from './args.js';
import { spawnCli } from './spawn.js';

describe('help contract via the real bin (E15)', () => {
  it('bare invocation prints usage to stdout and exits 0', async () => {
    const r = await spawnCli([]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatchSnapshot('bare-invocation');
  });

  it('--help and -h print the same root usage, exit 0', async () => {
    const help = await spawnCli(['--help']);
    const h = await spawnCli(['-h']);
    expect(help.code).toBe(0);
    expect(h.code).toBe(0);
    expect(help.stderr).toBe('');
    expect(h.stderr).toBe('');
    expect(h.stdout).toBe(help.stdout);
    expect(help.stdout).toMatchSnapshot('root-help');
  });

  it.each(COMMAND_NAMES)('%s --help prints command usage, exit 0', async (command) => {
    const r = await spawnCli([command, '--help']);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatchSnapshot(`help-${command}`);
  });

  it('unknown command exits 2 with usage hint on stderr, empty stdout', async () => {
    const r = await spawnCli(['bogus']);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('unknown command "bogus"');
  });

  it('unknown flag exits 2 even with a valid command (strict parseArgs)', async () => {
    const r = await spawnCli(['config', 'show', '--nope']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('lumen config --help');
  });
});
