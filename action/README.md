# lumen-action

Run a [lumen](https://nitishagar.github.io/lumen/) SEO audit in CI: optional
preview-server startup, a SARIF artifact for code scanning, and a Markdown job
summary. The job gates on findings per `fail-threshold` (or only on NEW
findings with a baseline).

## Usage

```yaml
      - name: Audit the preview build
        uses: nitishagar/lumen/action@main   # pin to a tag/SHA in real use
        with:
          url: http://localhost:4321
          start-command: npm run preview -w site
          wait-on: http://localhost:4321
          fail-threshold: warning
          max-pages: 50
```

With a baseline (gate only on regressions):

```yaml
      - uses: actions/checkout@v4
      - run: npx @lumen-seo/cli audit "$SITE" --update-baseline lumen.baseline.json
      # commit lumen.baseline.json to the repo so CI can read it
      - uses: nitishagar/lumen/action@main
        with:
          url: https://example.com
          baseline: lumen.baseline.json
```

Uploading the SARIF to code scanning:

```yaml
      - uses: nitishagar/lumen/action@main
        with:
          url: https://example.com
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: lumen.sarif
```

## Inputs

| input | default | what it does |
|---|---|---|
| `url` | (required) | the site to audit; loopback URLs automatically imply `--allow-private` (any other private target still needs `crawl.allowPrivateHosts` config) |
| `start-command` | — | command that starts the preview server (background) |
| `wait-on` | — | URL to wait for (up to 60s) before auditing |
| `baseline` | — | baseline file — the job gates only on NEW findings |
| `fail-threshold` | `error` | lowest severity that fails the job |
| `max-pages` | `100` | crawl page budget |
| `upload-sarif` | `true` | write the `lumen-sarif` artifact |
| `source-map` | — | source glob for SARIF page-URL → file mapping — code scanning rejects `http` locations, so set this (e.g. `site/src/pages/**/*.astro`) when uploading to code scanning |

## Pinning note (honest limitation)

The audit runs via `npx -y @lumen-seo/cli@0` — the CLI is version-pinned at
release time, but `npx` transitively resolves with the registry's integrity
checks rather than a committed lockfile (a composite action carrying the whole
workspace lockfile is not maintainable). For strict supply-chain pinning, use
the raw-`npx` workflow from the docs with your own committed lockfile, or
vendor the CLI into your image.

The Markdown summary re-runs the bounded audit with `--fail-threshold off`, so
only the SARIF run gates the job — on a preview server you own, that second
bounded crawl is the tradeoff for the CLI's one-format-per-run contract.
