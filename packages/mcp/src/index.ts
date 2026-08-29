/**
 * @lumen-seo/mcp — the surfaces factory package: ONE `buildMcpServer(deps)`
 * for the five locked `lumen_*` tools (I5), served over stdio (CLI) and
 * Cloudflare `createMcpHandler` stateless HTTP (Worker) from composition
 * roots. Also hosts the rebase ports (`@lumen-seo/mcp/ports`), the public-URL
 * guard (`@lumen-seo/mcp/url-guard`), and the deterministic test fixtures
 * (`@lumen-seo/mcp/testkit`).
 */
export type { UrlGuardResult } from './url-guard.js';
export { validatePublicHttpUrl } from './url-guard.js';
export type { LocalOnlyPayload } from './local-only.js';
export { LOCAL_ONLY_NOTE, localOnly } from './local-only.js';
export { strictArgs } from './strict-args.js';
export type { StrictArgsViolation } from './strict-args.js';
export type { OnboardTarget } from './onboard.js';
export { onboardPayload } from './onboard.js';
export {
  ALLOWED_ARGS,
  auditSiteSchema,
  authoritySchema,
  keywordIdeasSchema,
  pageReportSchema,
  rankCheckSchema,
  TOOL_NAMES,
} from './schemas.js';
export type { ToolName } from './schemas.js';
export type { McpDeps } from './server.js';
export { buildMcpServer } from './server.js';
export const packageName = '@lumen-seo/mcp';
