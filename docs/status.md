# Capsule Memory Status Snapshot

_Last updated: 2024-05-07_

## Delivered
- **Wave 1 Foundations** – CapsuleMeta schema + ACL/PII hardening, programmable storage v1, search recipes, Capsule Studio editors, Capsule Router/MCP quick-start, Capsule Bench harness.
- **Sprint 2 Additions** – Connector ingestion jobs + CLI (Notion/Drive), read-only Capsule-Graph enrichment with recipe integration, latency groundwork (hotset cache, vector metrics, backend toggles).
- **Sprint 3 Launchpad** – Adaptive retrieval scaffolding (rewriter + reranker hooks), Capsule Local SQLite prototype, connectors monitor in Studio.

## In Progress / Upcoming
- **Adaptive Retrieval Iteration** – Plug in production rewriting/reranker models with eval coverage and guardrails.
- **Local-First Story** – Package Capsule Local as a desktop app, add sync/backfill with cloud Capsule, and expose MCP sharing.
- **Security & Governance** – Row-level ACLs, BYOK rollout for metadata/embeddings, write-time PII gating policies, and expanded audit tooling.

## Notes
- Vector backend is pluggable (`CAPSULE_VECTOR_STORE`), defaulting to MongoDB. pgvector/Qdrant adapters log fallbacks until wired.
- Connector catalog is now centralized (`config/connectors.json`) and reused by the CLI and server module.
- Recipe preview endpoints allow JSON-defined blends for Studio experimentation; production recipes remain typed.
- Adaptive retrieval toggles live in `config/adaptive.json` and can be evaluated via `npm run eval:retrieval`.
- Retrieval evaluator now supports forced rewrite/rerank runs (`--rewrite`, `--no-rewrite`, `--rerank`, `--no-rerank`) and CSV output for dashboard imports.
- Capsule Local reads `capsule-local.config.json`, exposes `/local/manifest`, and can sync via `npm run local:sync`.
- Capsule Local packaging helpers: `npm run local:data` handles JSON export/import, and `npm run local:bundle` emits a distributable archive with config + manifest.
- Security tooling: BYOK guidance now covers rotation steps and `npm run check:pii` audits for non-private PII.
- Validation baseline: run `npx tsc --noEmit`, `npm run lint` (after bootstrapping ESLint), `npm run eval:retrieval`, and `npm run check:pii` before releases.

Keep `docs/prioritized-todo.md` updated as sprint scope evolves.
