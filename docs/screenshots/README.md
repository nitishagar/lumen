# Screenshots — visual e2e verification (2026-08-30)

Captured from the live deployment (https://nitishagar.github.io/lumen/) with a
vision-model review pass against the design reference https://pi.dev/.

## Files

| File | What it shows |
|---|---|
| `lumen-landing-dark.png` | Landing page, dark theme (hero, install tabs npm/npx/claude, live audit excerpt) |
| `lumen-landing-light.png` | Landing page, light theme (theme toggle working, accent preserved) |
| `lumen-docs-quickstart-light.png` | Docs — Quickstart, light (sidebar groups, ON THIS PAGE card, code blocks) |
| `lumen-docs-quickstart-dark.png` | Docs — Quickstart, dark |
| `pi-dev-reference-splash.png` | Design reference: pi.dev intro splash |
| `pi-dev-reference-docs.png` | Design reference: pi.dev documentation page |
| `cli-help.txt` | `lumen --help` (commands, global flags, exit envelope) |
| `cli-audit-example-com.txt` | `lumen audit https://example.com --max-pages 3` — real end-to-end run: fetch → robots gate → rules → score 87 → typed findings |

## Vision review verdict (theme match vs pi.dev)

**Structural vocabulary — MATCH:** dark-first chrome with auto/light/dark
toggle; monospace uppercase section labels (`LUMEN · OPEN-SOURCE SEO TOOLKIT`,
`START HERE`, `ON THIS PAGE` — mirroring pi.dev's `DOCUMENTATION`,
`ON THIS PAGE`); bordered raised cards; three-column docs layout
(sidebar / content / TOC); keyboard search chip (`Ctrl K` / pi.dev's `⌘ K`);
compact header with wordmark + mono nav.

**Deliberate deltas (trade dress reimplemented, not copied):** accent is
lumen orange (#f97316) vs pi.dev's steel blue; headings are bold sans vs
pi.dev's serif italic; background neutral zinc-black (#09090b) vs pi.dev's
navy. The footer states: "Visual design inspired by pi.dev; tokens
reimplemented from scratch."

**Verdict: PASS** — the site reads as a sibling of pi.dev without copying
its trade dress.
