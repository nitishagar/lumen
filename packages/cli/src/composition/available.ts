/**
 * REBASE SEAM (Phase 6 rebase commit — B21/ARCHITECTURE M1).
 *
 * This branch depends only on @lumen-seo/core, so the CLI's available-provider
 * map is EMPTY: a config that selects any provider name fails registry
 * validation with "Available: (none)" (I2), and unselected boundaries degrade
 * to typed PROVIDER_UNCONFIGURED errors. Commands are fully testable through
 * the injected CommandDeps (fixture providers from @lumen-seo/mcp/testkit).
 *
 * REBASE: replace the body with the @lumen-seo/providers barrel, e.g.
 *
 *   import * as providers from '@lumen-seo/providers';
 *   export const availableProviders = (): Record<string, AnyProvider> =>
 *     providers.PROVIDERS; // name per the providers aspect's barrel export
 *
 * and add `@lumen-seo/providers` to packages/cli/package.json dependencies.
 * Nothing else in the CLI changes.
 */
import type { AnyProvider } from '@lumen-seo/core';

export const availableProviders = (): Record<string, AnyProvider> => ({});
