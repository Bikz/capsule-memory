# Capsule Memory Prioritized TODO

## ✅ Completed (Wave 1 foundations delivered)
- [x] CapsuleMeta v0.1 schema with ACL enforcement, PII encryption, provenance, and SDK exposure.
- [x] Programmable storage v1: policy engine, graph-enrich routing, backfill tooling, and policy inspector CLI.
- [x] Search recipe runtime: starter library, recipe-weighted scoring, `/v1/memories/recipes` API, and SDK support.
- [x] Observability & safeguards: structured policy/recipe logs, hardening of API guards, and migration/backfill scripts.

## 🚀 Sprint 1 (Wave 1 parity still outstanding)
1. [x] **Capsule Router & MCP polish** (roadmap item 5)
   - Router CLI proxy with templated config + MCP manifest generator for <5 min TTFV.
2. [x] **Studio UX for policies & recipes** (roadmap item 7)
   - Live recipe/policy editors with previews and provenance surfacing in Capsule Studio.
3. [x] **Capsule Bench (eval harness)** (roadmap item 10)
   - CLI + dataset scaffolding for latency/quality benchmarking and shadow-mode logging.

## 🧭 Sprint 2 (Wave 1 completion & Wave 2 kickoff)
1. [x] **Connectors: Notion & Google Drive** (roadmap item 6)
   - Ingestion job tracking module, CLI (`npm run ingest`) for exports, tagging, and Studio monitor view.
2. [x] **Capsule-Graph read-only enrichment** (roadmap item 4)
   - Async entity extraction queue, graph entity store, and recipe-level `graphExpand` support.
3. [x] **Latency & scalability groundwork** (roadmap item 9)
   - Vector backend configuration switches, hotset caching, and vector metric logging for future pgvector/Qdrant adapters.

## 🌉 Near-Term Wave 2 (post-parity acceleration)
- **Adaptive retrieval** – query rewriting + learned rerankers with caches (roadmap item 8).
- **OpenMemory-class local-first** – Capsule Local desktop app + MCP sharing (item 11).
- **Security & governance** – BYOK rollout, row-level ACLs, write-time PII policy gating (item 12).

## 🛣️ Long-Range (Wave 3 / Moat)
- **Programmable storage v2** – lifecycle DAGs, summarisation, proof-of-recall (item 13).
- **Capsule federation** – multi-region brokering & BYO embeddings (item 14).
- **Connectors as a platform** – GA catalog + OSS connector SDK (item 15).
- **Vertical solutions & community GTM** – sample apps, migration tooling, pricing (items 16–17).
