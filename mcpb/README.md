# lumen.mcpb — Claude Desktop bundle

One-click install of the lumen MCP server in Claude Desktop:

1. Download `lumen.mcpb` from the
   [latest GitHub release](https://github.com/nitishagar/lumen/releases).
2. Double-click the file (Claude Desktop → Settings → Extensions also works).
3. Optionally paste your three free API keys when prompted — they travel to
   lumen as environment variables and are sent only to their own providers
   (Google Pagespeed, Google CrUX, Open PageRank). No key means that leg
   reports `not-configured` instead of failing.

The bundle is a thin launcher: it runs `npx -y @lumen-seo/cli mcp`, so
Node.js >= 22 must be installed. lumen's code always comes from the npm
package — the bundle never vendors a dependency tree.
