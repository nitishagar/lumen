# Distribution runbook — lumen v0.3 release and beyond

> Owner-facing checklist for the external steps the workflows cannot do.
> Everything code-side is already wired; this page is the order of operations.

## 0. Release-prep PR (human commit, before the tag)

1. Bump the versions that ship as files (all in the same PR so the
   anti-drift test stays green — `test/onboard-artifacts.test.mjs` asserts
   they move together):
   - `server.json` → `version` and `packages[0].version`
   - `mcpb/manifest.json` → `version`
   - `plugin-lumen/.claude-plugin/plugin.json` → `version`
   - the `registry` payload constant in `packages/mcp/src/onboard.ts`
2. Rename the CHANGELOG `[Unreleased]` section to the tag version.

## 1. Repo visibility (PRD D1) — done 2026-09-30

The repo is **public** (`gh repo edit nitishagar/lumen --visibility public`)
with GitHub Pages enabled (`build_type: workflow`); the docs site returns
200. The weekly **Link Check** workflow going green on
`workflow_dispatch` is the standing acceptance signal for "every public
link resolves".

## 2. Tag the release

```
git tag v0.3.0 && git push origin v0.3.0
```

The Release workflow then:

1. runs the full validation gate (`npm run validate`),
2. creates the GitHub Release,
3. publishes the six `@lumen-seo/*` packages to npm in dependency order
   (requires the `NODE_AUTH_TOKEN` repository secret — **npm credentials are
   owner-gated**; without it the job skips cleanly and only the GitHub
   Release is produced),
4. asserts `npm view @lumen-seo/cli version` equals the tag,
5. publishes `server.json` to the MCP Registry via `mcp-publisher` with
   GitHub OIDC (requires the repo to run under the `nitishagar` account —
   no stored secret), and
6. builds `lumen.mcpb` and attaches it to the GitHub Release.

## 3. Post-publish verification

```
npm view @lumen-seo/cli version                      # → 0.3.0
npx -y @lumen-seo/cli@0.3.0 audit https://example.com --json   # clean-container smoke
curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.nitishagar/lumen"
gh release view v0.3.0 --json assets                 # lumen.mcpb attached
```

Claude Desktop: install the `.mcpb` from the release assets. Claude Code:

```
/plugin marketplace add nitishagar/lumen
/plugin install lumen@nitishagar-lumen
```

## 4. Directory listings (PRD E0.3 FR-4 — owner accounts)

- **Glama** — claim the server at glama.ai/mcp/servers (GitHub sign-in) and
  point it at `io.github.nitishagar/lumen`.
- **Smithery / mcp.so** — submit the server with the npm package name
  `@lumen-seo/cli` and the stdio command.
- **awesome-mcp-servers** — open a PR adding lumen under "SEO / web
  analysis" with the one-line pitch and repo link.
- Optional complement note for claude-seo users (PRD D5): lumen is the
  deterministic audit backend their prompts can call.

## 5. Docs site

The Pages workflow (`.github/workflows/pages.yml`) deploys on every push to
`main`; once the repo is public, `https://nitishagar.github.io/lumen/` must
return 200 (PRD E0.1 FR-3 — verify after the flip).
