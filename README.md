# lumen

[![CI](https://github.com/nitishagar/lumen/actions/workflows/ci.yml/badge.svg)](https://github.com/nitishagar/lumen/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@lumen-seo/cli.svg)](https://www.npmjs.com/package/@lumen-seo/cli)
[![Docs](https://img.shields.io/website?url=https%3A%2F%2Fnitishagar.github.io%2Flumen%2F&label=docs)](https://nitishagar.github.io/lumen/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

> Lightweight, pluggable, MCP-first SEO toolkit — free services only, bring your own keys, provenance on every number.

**Status:** v0.2.x — first public release. The CLI, the five MCP tools, and the docs site are live; see [CHANGELOG.md](./CHANGELOG.md) for what shipped and [the docs](https://nitishagar.github.io/lumen/) for the full guides.

## Why lumen

Most SEO tooling is a black box with a subscription. lumen is the opposite: a local-first, agent-first audit toolkit that runs on free data sources, never ships a number it can't attribute, and speaks MCP so your coding agent can run it for you.

- **Local site audits** — bounded, robots-respecting crawler with 18 built-in rules, severity scoring, and CI-friendly exit codes (`0` pass, `1` findings, `2` usage/abort).
- **Free-tier data providers** — PageSpeed Insights, CrUX, Google Suggest, Wikipedia demand, OpenPageRank, Tranco, DuckDuckGo SERP. BYOK: keys are read from env vars by *name*, never stored or logged.
- **MCP-first** — five tools (`lumen_audit_site`, `lumen_page_report`, `lumen_keyword_ideas`, `lumen_rank_check`, `lumen_authority`) over stdio or a thin Cloudflare Worker gateway.
- **Provenance on every number** — each metric carries its source and fetch timestamp; no free source, no number.

## Quickstart

Requires Node >= 22.7.

```bash
# One-off audit — no install
npx -y @lumen-seo/cli audit https://example.com

# Install globally
npm install -g @lumen-seo/cli
lumen audit https://your-site.dev --max-pages 50
```

Wire it into Claude Code (or Cursor / VS Code — [MCP onboarding](https://nitishagar.github.io/lumen/docs/mcp-onboarding/)):

```bash
claude mcp add --transport stdio lumen -- npx -y @lumen-seo/cli mcp
```

Then just ask: *"audit my site and tell me what to fix first."*

## Packages

| Package | Purpose |
| --- | --- |
| [`@lumen-seo/core`](./packages/core) | types + payload models, config loader (`failThreshold`), Fetcher (SSRF/timeout/backoff), robots, provider/rule SPIs + registries |
| [`@lumen-seo/audit`](./packages/audit) | bounded crawler, 18 built-in AuditRules, severity scorer, report assembly |
| [`@lumen-seo/providers`](./packages/providers) | built-in data providers (BYOK, free services only) |
| [`@lumen-seo/cli`](./packages/cli) | `lumen` CLI, JSONL history, stdio MCP launcher |
| [`@lumen-seo/mcp`](./packages/mcp) | MCP tool definitions + transport adapters (Cloudflare Worker) |
| `@lumen-seo/site` | docs site ([live](https://nitishagar.github.io/lumen/)) |

> **Note on packaging:** npm packages ship compiled JavaScript + type declarations (`dist/`) — plain `node` import, no flags, no `tsx`. The TypeScript sources stay the source of truth in the repo; the release pipeline compiles per package at publish time.

## Documentation

- [Quickstart](https://nitishagar.github.io/lumen/docs/quickstart/) — first audit, JSON output, CI usage
- [CLI reference](https://nitishagar.github.io/lumen/docs/cli-reference/) — all seven commands and flags
- [Rules reference](https://nitishagar.github.io/lumen/docs/rules-reference/) — the 18 rules, severities, scoring
- [Providers & BYOK](https://nitishagar.github.io/lumen/docs/providers-byok/) — data sources, keys, rate-limit etiquette
- [MCP onboarding](https://nitishagar.github.io/lumen/docs/mcp-onboarding/) — Claude, Cursor, VS Code, remote gateway

## Development

Requires Node >= 22.

```bash
npm install
npm run lint
npm run typecheck
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for conventions, [SECURITY.md](./SECURITY.md) for the security policy, and [docs/release.md](./docs/release.md) for the release runbook.

## License

[Apache-2.0](./LICENSE) — Copyright 2026 Nitish Agarwal
