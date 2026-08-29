# Security Review — feat/lumen-site

Reviewer: adversarial security pass over the branch diff (static Astro site + Vitest gate suite).
Scope: XSS/DOM injection, third-party requests/privacy, supply chain, gate-script fs/exec safety, secrets.

## 1. XSS / DOM injection

- No `set:html` or `is:raw` anywhere in `site/src` — confirmed both by direct grep and by the branch's own gate (`site/tests/escaping.test.ts`, G4), which fails the build if either token appears, with an intentionally empty allowlist.
- `site/src/layouts/Base.astro:140-182` (search results renderer): all result data (`d.meta?.title`, `d.url`) is written via `textContent`, never `innerHTML`. `a.href = ...` assigns a string built from `d.url`, which originates from the Pagefind index generated at build time from the site's own built HTML — not runtime user/network input. No injected `javascript:` or attacker-controlled scheme is reachable here since Pagefind only indexes this repo's own build output.
- `site/src/pages/docs/rules-reference.astro:40-53,134,138` and `mcp-onboarding.astro`: example JSON (including the `evidence.snippet` field simulating crawled content) is interpolated via `{issueExample}` inside `<pre><code>`. Astro auto-escapes all `{}` expressions by default (this is not JSX `dangerouslySetInnerHTML`-equivalent), so `<`, `>`, `&` render as text, not markup. Verified no `set:html` override is applied to these blocks.
- Attribute injection: all dynamic attributes I found (`href={u(...)}`, `class={sevBadge[rule.severity]}`, `data-base={u('/')}`) are Astro template expressions, auto-escaped, sourced from static/local data, not runtime-untrusted strings.
- Verdict: no exploitable sink found. **PASS.**

## 2. Third-party requests / privacy (I16)

- Grepped `site/src` for `fetch(`, `XMLHttpRequest`, `new Image`, `WebSocket`, external `<script src=` / `<link href="http(s)`: zero runtime network calls. All `https://...` occurrences in source are inert `<a href>` anchor text (npm, GitHub, CC BY, CrUX methodology, Tranco, Open PageRank, Wikimedia — all in `attributions.astro`/`Footer.astro`, all links a human clicks, not fetched by the page).
- Pagefind import (`site/src/layouts/Base.astro:136`): `await import(`${base}pagefind/pagefind.js`)` where `base = modal.dataset.base ?? '/'` and `data-base={u('/')}` resolves to `/lumen/` per `astro.config.mjs` (`base: '/lumen'`). This resolves same-origin under the site's own base path — confirmed no protocol-relative or absolute-external base value is possible since `u()` (`site/src/utils/site.ts:10-11`) always prefixes `import.meta.env.BASE_URL`, a build-time constant.
- No analytics/font/CDN scripts anywhere in `site/src` or the built `dist/` output.
- Verdict: **PASS.**

## 3. Supply chain

- `site/package.json`: `astro` (`7.2.9`) and `pagefind` (`1.5.2`) are exact-pinned; `cheerio`, `jest-axe`, `jsdom`, `vitest` use `^` ranges — normal for devDependencies of a build-time-only tool, not shipped to visitors. `package-lock.json` is present and committed, locking the full resolved tree.
- No install/postinstall hooks were added or modified by this branch beyond the standard `astro build && pagefind --site dist` / `vitest run` scripts in `package.json` — no arbitrary code execution from untrusted sources at build time was introduced.
- Verdict: **PASS** (minor note: consider exact-pinning the remaining devDependencies for full reproducibility, not a blocking issue since they're test-only).

## 4. Gate scripts — traversal / exec / ReDoS

- `site/scripts/check-links.mjs`: `walkFiles`/`checkLinks` operate only on a `distDir` argument supplied by the calling test/CLI, itself a fixed local build-output path (`site/dist`) — never derived from network or user input. `resolveInternal` joins parsed `href`/`src` values from the site's own built HTML (authored by the same repo) into a file path; even a hypothetical `../` in a locally-authored link would only affect `statSync`/`readFileSync` existence checks within the same local filesystem the test already has full read access to — no privilege boundary crossed, no attacker-supplied input reaches this path in the deployed system.
- `site/tests/*.ts` (`artifact.test.ts`, `contrast.test.ts`, `escaping.test.ts`, `search.test.ts`, `tokens.test.ts`, `helpers.ts`): all `readFileSync`/`readdirSync` calls use hardcoded relative paths under `siteRoot`/`distDir`/`srcDir`. No `exec`/`execSync`/`spawn`/`child_process` usage anywhere in the gate suite.
- Regexes used (`/^(https?:)?\/\//`, `/^\//`, simple `.replace`/`.split`) are all linear, no nested quantifiers or catastrophic-backtracking shapes — no ReDoS risk even against a maliciously large HTML file.
- Verdict: **PASS.**

## 5. Secrets

- `mcp-onboarding.astro:126-129` and related BYOK docs reference `{locked.envVars}` — rendered as **names only** (e.g. env var identifiers), sourced from `site/src/data/locked-names.json`. No key values, tokens, or credentials found in the diff.
- Grepped diff/source for API-key/secret/token/password/`-----BEGIN` patterns: only hits are documentation prose about *where* to configure BYOK keys (env var names, "BYOK keys pass per-request via headers and are never logged" in `mcp-onboarding.astro:112`) — no literal secret material committed.
- Verdict: **PASS.**

## Overall Verdict

**PASS** — no findings met the bar for MINOR-FAIL or MAJOR-FAIL. The branch has no raw-HTML sinks, makes zero third-party runtime requests, pins its build-critical dependencies, keeps all gate-script filesystem access on fixed local paths with no exec/traversal exposure, and commits no secrets.
