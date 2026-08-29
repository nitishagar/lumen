import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint 9 flat config — the conservative ecosystem default (PLAN.md
 * "Alternatives considered" #3). Ignores build/vendor/docs-thoughts trees.
 */
export default tseslint.config(
  {
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/', 'thoughts/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-Node CI gate scripts and their tests are dependency-free .mjs
    // (ci-deploy PLAN Phase 1) — declare the Node runtime globals for them.
    files: ['scripts/**/*.mjs', 'test/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
);
