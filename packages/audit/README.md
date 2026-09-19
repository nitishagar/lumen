# @lumen-seo/audit

The lumen site-audit engine: a bounded, robots-respecting crawler, 20 built-in audit rules, a severity scorer, and report assembly.

- **Crawler** — budgeted frontier (`--max-pages`), per-host rate limiting, sitemap discovery, URL normalization.
- **20 built-in rules** — titles, meta descriptions, H1s, canonicals, hreflang, `lang`, viewport, image alt coverage, duplicate content, broken internal links, redirect chains, noindex, status errors, insecure HTTP, mixed content, latency, Open Graph tags.
- **Scoring + reports** — severity-weighted scores, typed findings, abort-safe partial reports, PII-sanitized output.

```ts
import { runSiteAudit } from "@lumen-seo/audit";
```

Usually consumed through the CLI (`npx -y @lumen-seo/cli audit <url>`). Ships compiled JavaScript + `.d.ts` — plain `node` import, no flags. Rules reference: <https://nitishagar.github.io/lumen/docs/rules-reference/>
