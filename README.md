# lumen

[![CI](https://github.com/nitishagar/lumen/actions/workflows/ci.yml/badge.svg)](https://github.com/nitishagar/lumen/actions/workflows/ci.yml)
[![Deploy Pages](https://github.com/nitishagar/lumen/actions/workflows/pages.yml/badge.svg)](https://github.com/nitishagar/lumen/actions/workflows/pages.yml)
[![Docs](https://img.shields.io/website?url=https%3A%2F%2Fnitishagar.github.io%2Flumen%2F)](https://nitishagar.github.io/lumen/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
<!-- npm badge lands with the first verified publish (ci-deploy PLAN Phase 6):
     [![npm](https://img.shields.io/npm/v/@lumen-seo/cli.svg)](https://www.npmjs.com/package/@lumen-seo/cli) -->

> Lightweight, pluggable, MCP-first SEO toolkit — free services only.

**Status:** under active development (M0 bootstrap). The monorepo scaffold is
in place; package APIs land phase by phase — see `thoughts/shared/plans/`
for the working plan bundles.

## Packages

| Package | Purpose |
| --- | --- |
| `@lumen-seo/core` | types + payload models, config loader (`failThreshold`), Fetcher (SSRF/timeout/backoff), robots, provider/rule SPIs + registries |
| `@lumen-seo/audit` | bounded crawler, built-in AuditRules, severity scorer, report assembly |
| `@lumen-seo/providers` | built-in data providers (BYOK, free services only) |
| `@lumen-seo/cli` | `lumen` CLI, JSONL history, stdio MCP launcher |
| `@lumen-seo/mcp` | MCP tool definitions + transport adapters (Cloudflare Worker) |
| `@lumen-seo/site` | docs site (GitHub Pages) |

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
