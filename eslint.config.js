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
    // I16/I17 fetch restriction (surfaces PLAN Phase 6): ALL HTTP must flow
    // through the @lumen-seo/core Fetcher so the set of outbound requests is
    // enumerable in tests. Direct `fetch` is banned repo-wide; the ONE allowed
    // call site is the Fetcher's default transport seam.
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'All HTTP must go through the @lumen-seo/core Fetcher (packages/core/src/fetcher.ts) — I16/I17',
        },
      ],
    },
  },
  {
    // The Fetcher's default transport is the single sanctioned call site.
    files: ['packages/core/src/fetcher.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    // Package bin entries are plain Node scripts (the CLI bin boots the
    // TypeScript sources — BA-13 no-build convention).
    files: ['packages/*/bin/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
);
