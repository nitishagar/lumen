# Security Policy

## Supported versions

The `main` branch (the latest release cut from it) is the only supported
line. lumen is a fast-moving, single-version monorepo — always upgrade to
the latest `main` state before reporting an issue against older code.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/nitishagar/lumen/security/advisories/new>

Include what you can of: affected component (`@lumen-seo/core`,
`@lumen-seo/audit`, `@lumen-seo/providers`, `@lumen-seo/cli`,
`@lumen-seo/mcp`, site), a minimal reproduction, and the impact you see.
You will get an acknowledgment and a timeline in the advisory thread.

## Scope notes

- The crawl/audit engine is designed to be pointed at arbitrary URLs. Reports
  about *lumen fetching a URL it was explicitly asked to fetch* are not
  vulnerabilities by themselves — but SSRF-guard bypasses (requests to
  loopback/private/ link-local targets that the guard should have refused,
  or redirect-based escapes) absolutely are, and are treated as high severity.
- The Cloudflare Worker never parses HTML and only proxies PSI/CrUX-derived
  data; BYOK secrets arrive per-request via headers and must never be logged
  or persisted. Leakage there is in scope.
- This project is Apache-2.0 licensed; by contributing you agree your
  contributions are licensed under it (see [CONTRIBUTING.md](./CONTRIBUTING.md)).
