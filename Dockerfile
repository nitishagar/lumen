# lumen MCP server (Glama "runs from source" + any stdio MCP client).
# stdio transport: the container speaks MCP on stdin/stdout, nothing listens.
# Build:  docker build -t lumen-mcp .
# Run:    docker run -i --rm lumen-mcp   (then speak JSON-RPC on stdin)
# Smoke:  docker run --rm lumen-mcp node scripts/ci/cli-smoke.mjs
FROM node:22-slim

WORKDIR /app

# Manifests first so dependency layers cache across source edits.
COPY package.json package-lock.json ./
COPY packages/audit/package.json packages/audit/
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/mcp/package.json packages/mcp/
COPY packages/plugin-render/package.json packages/plugin-render/
COPY packages/providers/package.json packages/providers/
COPY site/package.json site/

# Production deps only: the server runs from workspace sources (Node >= 22.18
# type-stripping), no build step, no devDeps at runtime.
RUN npm ci --omit=dev

COPY . .

# Non-root at runtime (Glama safety checks prefer it).
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production

CMD ["node", "packages/cli/bin/lumen.js", "mcp"]
