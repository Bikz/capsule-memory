# Capsule Memory Prioritized TODO

## P0 – Hardening & Validation (Immediate)
- **Backfill & migrations**: script and run backfill to populate `storage`, `graphEnrich`, provenance, and metadata defaults on existing memories; add migration guardrails to avoid double-writing.
- **Security envelope**: wire CapsuleMeta fields into encryption/BYOK hooks, ensure piiFlags/ACL enforcement on every mutation, and document operational runbooks.
- **Observability & QA**: add structured logs + metrics for policy/recipe selection, create regression tests for policy evaluation + recipe scoring, and add contract tests for Node SDK additions.
- **Operational tooling**: expose admin CLI to inspect/update storage policies, surface recipe catalog + applied policies in Studio console.

## P1 – Productization (Next Sprint)
- **Capsule Router + MCP polish**: ship guided setup with templated recipes/policies; verify sub-5 minute onboarding path.
- **Studio UX**: interactive editors for recipes/storage policies with preview + validation, plus audit log views of provenance and ACL changes.
- **Ingestion ecosystem**: deliver Notion & Google Drive connectors with tagging + error dashboards; add ingestion monitor and retry queues.
- **Capsule Bench**: launch CLI + hosted dashboard for quality/latency evals and shadow benchmarking against Mem0/Supermemory.

## P2 – Differentiators (Following Sprint)
- **Graph enrichment pipeline**: implement async entity extraction, materialize `graph_expand` recipe steps, and expose tuning controls per policy.
- **Adaptive retrieval**: add query rewriting + learned rerankers with caching strategies, including guardrails for latency budgets.
- **Latency & scale**: ship pluggable store adapters (pgvector/Qdrant), hotset cache, sharding docs, and p95 SLA reporting.
- **Local-first**: build Capsule Local desktop service (SQLite + FAISS) with sync + permissioned sharing across MCP clients.
