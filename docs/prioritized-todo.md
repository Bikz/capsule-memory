# Capsule Memory Prioritized TODO

_Last refreshed: 2024-05-07_

## ✅ Wave 1 Foundations
- [x] CapsuleMeta v0.1 schema with ACL/PII safeguards and SDK updates.
- [x] Programmable storage v1 (policies, graph enrich routing, backfill tooling).
- [x] Search recipe runtime + Capsule Studio editors.
- [x] Operational tooling: Router/MCP quick-start, Capsule Bench, logging & backfill.

## 🚀 Wave 2 – Active Focus
1. **Adaptive Retrieval Iteration**
   - Integrate production query rewriting + reranker services with eval coverage.
   - Expose knobs for per-recipe caching and guardrails (latency budgets, fallbacks).
   - Update Capsule Bench datasets to measure rewrite/rerank impact.
2. **Local-First Workflow**
   - Package Capsule Local (desktop app or binary) with sync/backfill support.
   - Expose MCP sharing & multi-client coordination (offline-first experience).
   - Harden local cache encryption/storage and document ops flows.
3. **Security & Governance Enhancements**
   - Finalise BYOK rollout (metadata + embeddings), admin tooling for key rotation.
   - Row-level ACL management (shared groups, auditing, guardrails in Studio).
   - Write-time PII gating policies with reporting and connector compliance checks.

## 🌉 Wave 3 Preview
- Programmable storage v2 (lifecycles, summarisation DAGs, proof-of-recall).
- Capsule Federation (multi-region brokers, BYO embeddings).
- Connectors as a platform (GA catalog, OSS SDK) and vertical solutions (IDE copilots, support agents, GTM tooling).

Keep this list aligned with `docs/status.md` and sprint outcomes.
