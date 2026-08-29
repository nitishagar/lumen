import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint 9 flat config — the conservative ecosystem default (PLAN.md
 * "Alternatives considered" #3). Ignores build/vendor/docs-thoughts trees.
 */
export default tseslint.config(
  {
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/', 'thoughts/', '**/.astro/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Conventional underscore-prefix allowance for intentionally-unused
    // parameters (interface fixtures, injected seams).
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Plain-Node CI gate scripts and their tests are dependency-free .mjs
    // (ci-deploy PLAN Phase 1) — declare the Node runtime globals for them.
    files: ['scripts/**/*.mjs', 'test/**/*.mjs', 'packages/*/scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Package bin entries are plain Node scripts (the CLI bin boots the
    // TypeScript sources — BA-13 no-build convention).
    files: ['packages/*/bin/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
);
