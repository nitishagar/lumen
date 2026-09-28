---
name: seo-check
description: Audit a site's SEO with lumen and fix the top findings. Use when the user asks to check, audit, or improve SEO for a site or page, or asks "is my site ok for search?".
---

# seo-check — lumen audit + fix loop

1. Take the target URL (ask if unclear) and call the `lumen_audit_site` MCP
   tool with `response_format: "concise"`.
2. Work the returned `topRules` groups in order — they are ranked by
   severity, then by how many pages they affect. Each group carries a
   `fixHint` and `sampleUrls`; apply fixes in the user's source files.
3. Re-run the audit after fixing and report the score delta. Cite the
   provenance fields lumen returns (provider, kind, retrievedAt) for any
   number you quote — never invent a metric lumen did not return.
4. If CWV/authority legs report `not-configured`, tell the user to run
   `lumen doctor` for guided key setup. Being unconfigured is not an error.

Honesty rules: lumen reports what it measured on the pages it fetched.
Skipped pages are unknown, not passing — do not present an incomplete audit
as a clean bill of health.
