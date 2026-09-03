# Release runbook

How a lumen version gets from `main` to npm + GitHub Releases. The whole
pipeline is tag-driven; nothing publishes from a laptop.

## One-time setup

1. **npm scope** — the org/scope `@lumen-seo` must exist on npmjs.com and be
   owned by the publishing account. Create it once at
   <https://www.npmjs.com/org/create> (a free individual scope works for
   `--access public` packages).
2. **Automation token** — create an npm *granular access token* with
   "Read and write" permission limited to the `@lumen-seo` scope packages
   (<https://www.npmjs.com/settings/<user>/tokens/granular-access-tokens/new>).
3. **Repository secret** — add it as `NODE_AUTH_TOKEN` in
   *Settings → Secrets and variables → Actions*. Without it, `release.yml`
   creates the GitHub Release and **skips npm publish with a notice** (this is
   why v0.1.0 shipped a Release but no packages on the registry).

Optional: `CLOUDFLARE_API_TOKEN` enables the Worker gateway deploy
(`deploy-worker.yml`); absent, it skips cleanly.

## Per release

1. **Prepare** — fold `[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md) into a
   `## [X.Y.Z] — YYYY-MM-DD` heading and update the compare links at the
   bottom. Land it on `main` through the usual PR flow.
2. **Dry-run the publish plan** (no registry access needed):

   ```bash
   node scripts/ci/publish-workspaces.mjs --tag vX.Y.Z --dry-run
   ```

   It should print the topological order `core → audit → providers → mcp → cli`
   with the exact version each manifest gets.
3. **Tag and push**:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   Strict SemVer only (`vMAJOR.MINOR.PATCH`) — the publish script rejects
   anything else.
4. **What the workflow does** — `release.yml` runs the full `npm run validate`
   gate (typecheck + lint + worker build + site build + all tests + CLI
   smoke), creates the GitHub Release idempotently (`--generate-notes`), then
   publishes the five workspaces in dependency order with `--access public`.
   Manifest rewrites (version, `private` removal, pinned `@lumen-seo/*`
   ranges) happen runner-local only; nothing is committed back.
5. **Paste the changelog** into the GitHub Release body (the generated notes
   are a PR list; the changelog is the human-readable part).
6. **Verify**:

   ```bash
   npm view @lumen-seo/cli version        # → X.Y.Z
   npx -y @lumen-seo/cli audit https://example.com --max-pages 3
   ```

   A rerun of the same tag is safe: duplicate publishes (403/409) are treated
   as idempotent success, so a partially-published set completes green.

## Publishing model

The packages ship TypeScript sources directly; the `lumen` bin re-execs Node
with `--experimental-transform-types`, so CLI and MCP consumers need nothing
special. Library consumers run under `tsx` or the same flag (see README).
Compiled JS output is a future milestone; when it lands, the rewrite step in
`scripts/ci/publish-workspaces.mjs` is the single place to point `exports` at
`dist/`.
