/**
 * Deployed lumen Worker base URL (no trailing slash) — the endpoint the
 * /try widget talks to. Set to the `https://lumen-mcp.<subdomain>.workers.dev`
 * URL from the deploy-worker run once the Worker is live; until then the
 * widget ships with an empty default and the visitor pastes an endpoint
 * (e.g. a local `wrangler dev` URL) into the field instead.
 */
export const WORKER_BASE_URL = '';
