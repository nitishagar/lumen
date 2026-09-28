#!/usr/bin/env node
/**
 * lumen.mcpb launcher — the bundle delegates to the npm package (P-Thin:
 * no vendored dependency tree inside the bundle). Claude Desktop injects
 * the user_config keys as env vars before spawning this file.
 */
import { spawn } from 'node:child_process';

const child = spawn('npx', ['-y', '@lumen-seo/cli', 'mcp'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
child.on('error', (err) => {
  console.error('lumen mcpb: could not run "npx" — install Node.js >= 22 first.', err.message);
  process.exit(2);
});
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('exit', (code) => process.exit(code ?? 0));
