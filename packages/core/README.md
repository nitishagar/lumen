# @lumen-seo/core

Core primitives for [lumen](https://github.com/nitishagar/lumen) — types, payload models, config loading, the hardened Fetcher, robots handling, and the provider/rule SPIs everything else builds on.

- **Config loader** — `lumen.config.json` with unknown-key rejection, budget clamping, and `failThreshold` for CI gates.
- **Fetcher** — per-attempt timeout, full-jitter exponential backoff, `Retry-After` handling, cross-origin redirect header stripping, SSRF blocklist revalidated per redirect hop.
- **Robots** — policy evaluation via `robots-parser` so every crawl stays polite by construction.
- **SPIs + registries** — provider and rule extension points; load custom rules from plugins with `loadPluginRules` (Node subpath).

```ts
import { loadConfig, createFetcher } from "@lumen-seo/core";
```

Ships TypeScript sources — import under `tsx` or `node --experimental-transform-types`. Full docs: <https://nitishagar.github.io/lumen/>
