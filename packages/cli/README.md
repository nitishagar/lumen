# @lumen-seo/cli

The `lumen` CLI — local SEO audits, keyword ideas, rank checks, authority lookups, JSONL history, and a stdio MCP launcher for coding agents.

```bash
# one-off audit, no install
npx -y @lumen-seo/cli audit https://example.com

# global install
npm install -g @lumen-seo/cli
lumen --help
```

Commands: `audit` · `report` · `keywords` · `rank` · `authority` · `mcp` · `config show`. Every command takes `--json`; `audit` supports `--max-pages`, `--out`, and `--fail-threshold` for CI. Exit codes: `0` pass, `1` findings, `2` usage/abort.

Expose the five MCP tools to your agent:

```bash
claude mcp add --transport stdio lumen -- npx -y @lumen-seo/cli mcp
```

The npm package ships compiled JavaScript — plain `node`, no flags. Full docs: <https://nitishagar.github.io/lumen/docs/cli-reference/>
