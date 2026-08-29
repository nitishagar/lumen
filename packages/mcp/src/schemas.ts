/**
 * Tool input schemas (E7): one strict Zod object per locked tool. Strict
 * objects give wire-level `additionalProperties: false` AND unknown-argument
 * rejection with the installed SDK (asserted in schema-contract tests); the
 * handler-side strictArgs guard remains as the B7 belt-and-braces so the
 * behavior survives an SDK swap. The `failThreshold` enum is the IDENTICAL
 * 4-value set as the CLI flag (I5 parity, R1/R2). `maxPages` carries NO
 * default (R8) — core's config budget applies when omitted.
 */
import { z } from 'zod';

export const TOOL_NAMES = [
  'lumen_audit_site',
  'lumen_page_report',
  'lumen_keyword_ideas',
  'lumen_rank_check',
  'lumen_authority',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const RESPONSE_FORMAT = z.enum(['concise', 'detailed']).default('concise');
export const FAIL_THRESHOLD = z.enum(['info', 'warning', 'error', 'off']).default('error'); // R1/R2
export const STRATEGY = z.enum(['mobile', 'desktop']).default('mobile');
export const LIMIT = z.number().int().min(1).max(50).default(20);

/** Argument keys each handler accepts (strictArgs guard truth — E7/B7). */
export const ALLOWED_ARGS: Record<ToolName, readonly string[]> = {
  lumen_audit_site: ['url', 'maxPages', 'failThreshold', 'response_format'],
  lumen_page_report: ['url', 'strategy', 'includeCrux', 'response_format'],
  lumen_keyword_ideas: ['seed', 'lang', 'limit', 'response_format'],
  lumen_rank_check: ['keyword', 'domain', 'limit', 'response_format'],
  lumen_authority: ['domain', 'response_format'],
};

export const auditSiteSchema = z.strictObject({
  url: z.string().min(1),
  maxPages: z.number().int().min(1).max(10_000).optional(), // no default — R8
  failThreshold: FAIL_THRESHOLD,
  response_format: RESPONSE_FORMAT,
});

export const pageReportSchema = z.strictObject({
  url: z.string().min(1),
  strategy: STRATEGY,
  includeCrux: z.boolean().default(true),
  response_format: RESPONSE_FORMAT,
});

export const keywordIdeasSchema = z.strictObject({
  seed: z.string().min(1).max(120),
  lang: z.string().regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/).optional(),
  limit: LIMIT,
  response_format: RESPONSE_FORMAT,
});

export const rankCheckSchema = z.strictObject({
  keyword: z.string().min(1).max(120),
  domain: z.string().min(1).max(253),
  limit: LIMIT,
  response_format: RESPONSE_FORMAT,
});

export const authoritySchema = z.strictObject({
  domain: z.string().min(1).max(253),
  response_format: RESPONSE_FORMAT,
});
