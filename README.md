# seolite

<!-- Badges (CI, npm) are placeholders: the CI badge lands with the ci-deploy
     aspect (P6a bootstrap CI), the npm badge with the M2 publish step. -->
<!-- [![CI](https://github.com/nitishagar/seolite/actions/workflows/ci.yml/badge.svg)](https://github.com/nitishagar/seolite/actions/workflows/ci.yml) -->
<!-- [![npm](https://img.shields.io/npm/v/@seolite/cli.svg)](https://www.npmjs.com/package/@seolite/cli) -->

> Lightweight, pluggable, MCP-first SEO toolkit — free services only.

**Status:** under active development (M0 bootstrap). The monorepo scaffold is
in place; package APIs land phase by phase — see `thoughts/shared/plans/`
for the working plan bundles.

## Packages

| Package | Purpose |
| --- | --- |
| `@seolite/core` | types + payload models, config loader (`failThreshold`), Fetcher (SSRF/timeout/backoff), robots, provider/rule SPIs + registries |
| `@seolite/audit` | bounded crawler, built-in AuditRules, severity scorer, report assembly |
| `@seolite/providers` | built-in data providers (BYOK, free services only) |
| `@seolite/cli` | `seolite` CLI, JSONL history, stdio MCP launcher |
| `@seolite/mcp` | MCP tool definitions + transport adapters (Cloudflare Worker) |
| `@seolite/site` | docs site (GitHub Pages) |

## Development

Requires Node >= 22.

```bash
npm install
npm run lint
npm run typecheck
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for conventions.

## License

[Apache-2.0](./LICENSE) — Copyright 2026 Nitish Agarwal
