# Capsule Memory Prioritized TODO

## ✅ Completed (Wave 1 foundations delivered)
- [x] CapsuleMeta v0.1 schema with ACL enforcement, PII encryption, provenance, and SDK exposure.
- [x] Programmable storage v1: policy engine, graph-enrich routing, backfill tooling, and policy inspector CLI.
- [x] Search recipe runtime: starter library, recipe-weighted scoring, `/v1/memories/recipes` API, and SDK support.
- [x] Observability & safeguards: structured policy/recipe logs, hardening of API guards, and migration/backfill scripts.

## 🚀 Sprint 1 (Wave 1 parity still outstanding)
1. **Capsule Router & MCP polish** (roadmap items 5 & Sprint 2 pre-req)
   - One-command router setup with templated recipes/policies.
   - Streamlined MCP packaging + docs to guarantee <5 min TTFV.
2. **Studio UX for policies & recipes** (roadmap item 7)
   - Editors for search recipes/storage policies with validation + live preview.
   - Surface provenance/audit trail (incl. policy decisions) in the console.
3. **Capsule Bench (eval harness)** (roadmap item 10)
   - CLI `capsule bench` for shadow benchmarking vs Mem0/Supermemory.
   - Metrics ingest + dashboard wiring for latency/quality tracking.

## 🧭 Sprint 2 (Wave 1 completion & Wave 2 kickoff)
1. **Connectors: Notion & Google Drive** (roadmap item 6)
   - OAuth + webhook/polling ingest, tagging, retry queues, ingest monitor.
2. **Capsule-Graph read-only enrichment** (roadmap item 4)
   - Async entity/relation extraction pipeline with `graph_expand` recipe step toggle.
3. **Latency & scalability program groundwork** (roadmap item 9)
   - Baseline pgvector/Qdrant adapters, hotset caching prototype, SLA dashboards.

## 🌉 Near-Term Wave 2 (post-parity acceleration)
- **Adaptive retrieval** – query rewriting + learned rerankers with caches (roadmap item 8).
- **OpenMemory-class local-first** – Capsule Local desktop app + MCP sharing (item 11).
- **Security & governance** – BYOK rollout, row-level ACLs, write-time PII policy gating (item 12).

## 🛣️ Long-Range (Wave 3 / Moat)
- **Programmable storage v2** – lifecycle DAGs, summarisation, proof-of-recall (item 13).
- **Capsule federation** – multi-region brokering & BYO embeddings (item 14).
- **Connectors as a platform** – GA catalog + OSS connector SDK (item 15).
- **Vertical solutions & community GTM** – sample apps, migration tooling, pricing (items 16–17).
