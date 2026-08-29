# @lumen-seo/site

The lumen landing + docs site. A pure static Astro build under `site/` — no
client framework, no web fonts, no third-party requests of any kind. The site
fetches nothing at runtime; fitting, for a tool whose whole personality is
"we tell you what leaves the machine."

## Artifact contract (consumed by ci-deploy / upload-pages-artifact)

```
command:  npm run build -w @lumen-seo/site        (repo root, npm workspaces)
artifact: site/dist/  — pure static; MUST contain index.html, 404.html,
          sitemap.xml, robots.txt, pagefind/ ; no server output
workflow: configure-pages → npm ci → npm run build -w @lumen-seo/site
          → upload-pages-artifact(path: site/dist) → deploy-pages
CI gate:  npm run check -w @lumen-seo/site   (PRs + main; deploy workflow runs build only)
base:     /lumen/  (GitHub Pages project site, https://nitishagar.github.io/lumen/)
```

Commands:

| Command | What it does |
| --- | --- |
| `npm run dev -w @lumen-seo/site` | local dev server |
| `npm run build -w @lumen-seo/site` | `astro build` into `dist/`, then `pagefind --site dist` (static search index) |
| `npm run test -w @lumen-seo/site` | the gate suite over the built artifact (requires a prior build; fails with guidance if `site/dist` is missing) |
| `npm run check -w @lumen-seo/site` | build → test — the single CI gate |

## Gate inventory (G1–G9)

All gates are deterministic Vitest tests over files on disk (`site/tests/`);
no network, no wall clock, no real browser.

| Gate | Test file | Asserts |
| --- | --- | --- |
| G1 token conformance | `tokens.test.ts` | every required CSS variable exists in the built stylesheet; theme blocks + reduced-motion block present |
| G2 contrast math | `contrast.test.ts` | every enumerated fg/bg token pair ≥ 4.5:1 in dark AND light; no-JS media block token-identical to the light block |
| G3 trade-dress scan | `trade-dress.test.ts` | banned distinctive strings absent from `site/src/**` + built HTML; `pi.dev` appears only on `/docs/attributions/` |
| G4 escaping ban | `escaping.test.ts` | zero `set:html` / `is:raw` in `site/src/**` (allowlist intentionally empty) |
| G5 axe + structure | `a11y.test.ts` | jest-axe over 100% of built pages; skip link, landmarks, single `h1`, tabs/modal ARIA structure |
| G6 internal links | `links.test.ts` | every internal link/anchor resolves to a built file/anchor; external links recorded, never fetched |
| G7 locked names | `locked-names.test.ts` | all locked CLI commands / MCP tools / providers / env-var names present byte-exact; no unlocked `lumen_*` tokens anywhere |
| G8 search index | `search.test.ts` | Pagefind entry JSON + index chunks present and non-empty; `data-pagefind-body` scoping correct |
| G9 attribution | `attribution.test.ts` | Apache-2.0 license link in every page footer; CC BY 4.0 + Tranco strings on the attributions page |

## Trade-dress standing checklist (manual review, per release)

The automated G3 scan covers the known distinctive strings; a human walks
this list before merging site changes (asset provenance cannot be
string-matched):

- [ ] every SVG on the site was authored in-repo for lumen (no third-party assets, favicons, or screenshots);
- [ ] no third-party name, tagline, headline set, or section-title set reproduced or trivially paraphrased;
- [ ] copy is original lumen copy — plain, honest, lightly wry.

This workspace is never published to npm and has zero runtime imports from
`packages/*`.
