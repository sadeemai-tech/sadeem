---
name: Security audit
description: Systematic security review of a codebase — injection, authz, secrets, traversal, SSRF, and dependency risk.
---
# Security audit

Review in this order; cite every finding as file:line + severity (critical/high/medium/low) + concrete fix.

1. Injection — SQL, command (`eval`, shell metacharacters, template interpolation into exec), path traversal (`../`, absolute/UNC, symlink escapes), template/XSS sinks.
2. Authz — every entry point (IPC, HTTP route, tool) checks identity/permission; no "trusted caller" assumption; least privilege.
3. Secrets — no hardcoded keys/tokens; secrets never logged or returned in errors; masked in UI; rotation path exists.
4. Network — SSRF: user-controlled URLs restricted to safe schemes/hosts; redirects re-validated; timeouts on all fetches.
5. Supply chain — pinned dependencies where possible; no scripts from untrusted sources; lockfile committed.
6. Data — untrusted content (repo files, web pages, MCP) never auto-executed; taint tracked through to dangerous sinks.

Deliverable: a table of findings ordered by severity, each with evidence (file:line), exploit sketch, and a minimal patch. State explicitly what you could NOT verify — honesty over false assurance.
