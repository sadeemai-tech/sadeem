---
name: API design
description: Design and review HTTP/CLI/IPC APIs for consistency, safety, and forward compatibility.
---
# API design

1. Contract first — define the shape (method, path/channel, request, response, error codes) before implementation. Keep names stable and verbs consistent.
2. Errors — use a uniform error envelope `{code, message, detail?}`. Never leak stack traces or secrets. Every failure path has a distinct, documented code.
3. Validation — validate at the boundary with an explicit schema; reject unknown fields where it prevents smuggling; cap sizes and lengths.
4. Idempotency — writes are safe to retry (idempotency key or natural key). Reads never mutate state.
5. Versioning — additive changes by default; breaking changes behind a version or capability negotiation.
6. Auth — every endpoint declares its auth requirement; unauthenticated-by-default; check on the server, never only in the UI.
7. Pagination/bounds — list endpoints cap page size and return a cursor; no unbounded responses.
8. Docs — every endpoint has one example request + response and one error example. Generated types are the source of truth shared by both sides.

Deliverable: the contract, the validation schema, the error table, and a note on backward compatibility.
