import js from '@eslint/js';
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
);
