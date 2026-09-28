/**
 * AI-search readiness rules (E1.7) — site kind. Honest by construction:
 * the UA matrix NEVER recommends a training policy (the owner's choice);
 * llms.txt carries the plain "unproven proposal" disclaimer; missing
 * evidence reports unknown, never a pass.
 */
import type { Issue, Severity } from '@lumen-seo/core';
import { robotsMatrix } from '@lumen-seo/core';
import type { SiteRule } from '../types.js';

/**
 * Vendored AI user-agent tokens (E1.7 FR-1). training = model-crawling;
 * retrieval = live search/assistant fetching. Update via a PR that bumps
 * `asOf` — the provenance (asOf + sourceUrl) is recorded in the report.
 */
export const AI_CRAWLER_UAS = Object.freeze({
  asOf: '2026-09-01',
  sourceUrl: 'https://github.com/nitishagar/lumen/blob/main/packages/audit/src/rules/ai-search.ts',
  training: ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Applebot-Extended', 'Bytespider'] as readonly string[],
  retrieval: ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'PerplexityBot'] as readonly string[],
});

export const LLMS_TXT_DISCLAIMER =
  'llms.txt is a PROPOSAL (llmstxt.org) with unproven ranking impact — treat it as speculative hygiene, not a verified ranking factor.';

export const aiCrawlerAccess = (severity: Severity): SiteRule => ({
  id: 'ai-crawler-access',
  severity,
  categories: ['ai-search'],
  checkSite(ctx): Issue[] {
    const url = ctx.seed.url;
    if (ctx.robots.outcome === 'bypassed') {
      return [
        {
          ruleId: 'ai-crawler-access',
          severity,
          message: 'AI-crawler matrix unknown — the robots gate was disabled (respectRobots: false), so no robots evidence exists (not judged, not a pass)',
          evidence: { selector: 'robots.txt' },
          url,
          fixHint: 're-enable the robots gate (or accept that AI-crawler access is unjudged this run)',
        },
      ];
    }
    if (ctx.robots.outcome === 'absent' || ctx.robots.body === null) {
      // RFC 9309: no robots.txt = unrestricted. Honest allow-all, not unknown.
      const all = [...AI_CRAWLER_UAS.training, ...AI_CRAWLER_UAS.retrieval];
      return [
        {
          ruleId: 'ai-crawler-access',
          severity,
          message: `AI-crawler matrix (robots.txt absent — all crawlers unrestricted per RFC 9309): ${all.join(', ')}:allow. lumen reports the matrix only; a TRAINING policy is the owner's choice — lumen makes no recommendation.`,
          evidence: { selector: 'robots.txt' },
          url,
          fixHint: 'no action needed; add a robots.txt only if you want to restrict AI crawlers',
        },
      ];
    }
    const rows = [
      ...robotsMatrix(ctx.robots.body, url, AI_CRAWLER_UAS.training).map((r) => ({ ...r, group: 'training' as const })),
      ...robotsMatrix(ctx.robots.body, url, AI_CRAWLER_UAS.retrieval).map((r) => ({ ...r, group: 'retrieval' as const })),
    ];
    const blockedRetrieval = rows.filter((r) => r.group === 'retrieval' && r.allowed === false);
    // M12: compact group-count summary (the full per-token matrix rides in
    // evidence.snippet) — never truncated mid-disclaimer.
    const blockedTraining = rows.filter((r) => r.group === 'training' && r.allowed === false);
    const parts = [
      `AI-crawler robots matrix (vendored list asOf ${AI_CRAWLER_UAS.asOf}): training ${AI_CRAWLER_UAS.training.length - blockedTraining.length}/${AI_CRAWLER_UAS.training.length} allowed, retrieval ${AI_CRAWLER_UAS.retrieval.length - blockedRetrieval.length}/${AI_CRAWLER_UAS.retrieval.length} allowed`,
    ];
    if (blockedRetrieval.length > 0) {
      parts.push(
        `RETRIEVAL bots blocked (${blockedRetrieval.map((r) => r.token).join(', ')}) — usually unintended; hides the site from AI search/assistants`,
      );
    }
    parts.push('lumen reports the matrix only; a TRAINING policy is the owner\'s choice — no recommendation.');
    const message = parts.join(' — ');
    return [
      {
        ruleId: 'ai-crawler-access',
        severity,
        message,
        evidence: {
          selector: 'robots.txt',
          snippet: rows.map((r) => `${r.token}:${r.allowed === true ? 'allow' : r.allowed === false ? 'block' : 'unknown'}`).join(' ').slice(0, 280),
        },
        url,
        fixHint:
          blockedRetrieval.length > 0
            ? `if the block is unintended, allow the retrieval bots in robots.txt (${blockedRetrieval.map((r) => r.token).join(', ')})`
            : 'no action needed for retrieval access; training policy is the owner\'s choice',
      },
    ];
  },
});

/** llmstxt.org shape: an H1, an optional blockquote summary, then link sections. */
const llmsShapeOk = (body: string): { ok: boolean; problems: string[] } => {
  const problems: string[] = [];
  const lines = body.split('\n');
  if (!lines.some((l) => /^#\s+\S/.test(l))) problems.push('no H1 title line');
  if (!lines.some((l) => /^>\s+\S/.test(l))) problems.push('no blockquote summary');
  const linkLines = lines.filter((l) => /^-\s+\[[^\]]+\]\(\S+\)/.test(l)).length;
  if (linkLines === 0) problems.push('no markdown link list entries');
  return { ok: problems.length === 0, problems };
};

export const llmsTxt = (severity: Severity): SiteRule => ({
  id: 'llms-txt',
  severity,
  categories: ['ai-search'],
  checkSite(ctx): Issue[] {
    const url = ctx.seed.url;
    if (ctx.llmsTxt.outcome !== 'ok' || ctx.llmsTxt.body === null) {
      // Absent is a legitimate state (it is a proposal) — info-level note, never a warning.
      const state = ctx.llmsTxt.outcome === 'absent' ? 'absent' : 'could not be fetched';
      return [
        {
          ruleId: 'llms-txt',
          severity,
          message: `/llms.txt ${state}. ${LLMS_TXT_DISCLAIMER}`,
          evidence: { selector: 'llms.txt' },
          url,
          fixHint: 'optionally publish an llms.txt (H1 + blockquote summary + link lists per llmstxt.org) — unproven impact, purely optional',
        },
      ];
    }
    const shape = llmsShapeOk(ctx.llmsTxt.body);
    if (shape.ok) {
      return [
        {
          ruleId: 'llms-txt',
          severity: 'info',
          message: `/llms.txt present and well-formed (H1 + summary + links). ${LLMS_TXT_DISCLAIMER}`,
          evidence: { selector: 'llms.txt' },
          url,
          fixHint: 'no action needed — keep the file in sync with the site\'s best content',
        },
      ];
    }
    return [
      {
        ruleId: 'llms-txt',
        severity,
        message: `/llms.txt is present but does not follow the llmstxt.org shape: ${shape.problems.join('; ')}. ${LLMS_TXT_DISCLAIMER}`,
        evidence: { selector: 'llms.txt' },
        url,
        fixHint: 'follow the llmstxt.org shape: one H1 title, a blockquote summary, then markdown link lists',
      },
    ];
  },
});
