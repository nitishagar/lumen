# @lumen-seo/mcp

MCP tool definitions and transports for lumen. Five tools, strict-arg validation, and a public-URL guard:

| Tool | What it does |
| --- | --- |
| `lumen_audit_site` | bounded crawl + 18-rule audit with severity scoring |
| `lumen_page_report` | PageSpeed Insights lab + CrUX field + local meta checks |
| `lumen_keyword_ideas` | Google Suggest + Wikipedia demand signals |
| `lumen_rank_check` | DuckDuckGo SERP position checks (local engine only) |
| `lumen_authority` | OpenPageRank + Tranco domain context |

Run locally over stdio (`npx -y @lumen-seo/cli mcp`) or deploy the Cloudflare Worker gateway (`worker/`) — a thin, HTML-free proxy for PSI/CrUX-derived data with per-request BYOK headers. Missing capability? Tools answer with a typed `LOCAL_ONLY_CAPABILITY` instead of guessing.

Ships compiled JavaScript + `.d.ts` — plain `node` import, no flags. Onboarding: <https://nitishagar.github.io/lumen/docs/mcp-onboarding/>
