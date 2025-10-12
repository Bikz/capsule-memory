# Capsule Memory Competitive Roadmap

This document captures the competitive analysis and execution roadmap for Capsule Memory. It summarizes how we will reach and surpass the current leaders in the memory platform market (Mem0 and Supermemory) while building on Capsule's existing strengths.

## North-Star Outcome

Our goal is to win simultaneously on five pillars:

1. **Recall quality** – results are correct, useful, and grounded in source data.
2. **Speed & scale** – p95 latency ≤ 250 ms for `k ≤ 5` on 1–10 M memories with linear scaling.
3. **Programmability** – provide “search recipes” and “programmable storage” that teams can adapt without forking the platform.
4. **Privacy & portability** – support local-first and zero-trust deployments plus simple export/import.
5. **Developer experience & integrations** – 5-minute install, modern SDKs, CLI, dashboard, first-party connectors, MCP integration, and a routing proxy.

Competitive targets: match or exceed Supermemory’s sub-300 ms recall, multi-store retrieval, and connector catalog, and Mem0’s benchmarked accuracy/latency gains plus local OpenMemory MCP offering.

## Starting Point Snapshot

- **API & UI** – add/search/pin/delete with explanations, rolling retention, and a React operator console at `/memory`. Multi-tenant REST headers, Node SDK, and MCP tool already exist.
- **Engine** – TypeScript/Modelence stack backed by MongoDB (Atlas-ready) and Voyage 1024-d embeddings with deterministic local fallback for offline development.

This foundation enables a programmable, privacy-first memory layer.

## Roadmap Overview (12–16 weeks to parity + differentiation; 6–12 months to moat)

### Wave 1 – Competitive Parity & Fit (Weeks 0–6)

1. **Search Recipes v1** – declarative retrieval DSL (YAML/JSON) supporting embedding, vector/BM25 search, merges, reranking, boosts, filters, and structured returns. Validate via A/B testing on sample apps; target +10–15 % answer quality and p95 ≤ 300 ms on ≤ 1 M docs.
2. **Programmable Storage v1** – write-time routing policies for short-term ring buffer, long-term vector store, and capsule-graph. Include conflict resolution with auto-update/dedupe semantics. Validate with unit tests and UI audit log; target ≤1 % duplicates and bounded growth.
3. **CapsuleMeta v0.1** – unified metadata schema with field-level encryption (BYO-KMS) and scoped access controls. Validate via export/import and policy-driven redaction; ensure 100 % metadata coverage and encrypted PII.
4. **Capsule-Graph (read-only enrichment)** – async entity/relation extraction to a property graph with optional `graph_expand` recipe steps. Validate via entity queries; target +8–10 % quality on multi-hop questions with ≤50 ms median impact when disabled.
5. **Router & MCP polish** – Capsule Router (drop-in proxy injecting memory) and streamlined MCP pack for one-command install. Validate in demo apps; ensure time-to-first-value < 5 minutes.
6. **Connectors (Notion & Google Drive)** – OAuth + webhook/polling ingest with tagging. Validate 5 k+ docs ingestion; target <0.1 % errors and p95 search ≤ 350 ms on fresh data.
7. **Developer Experience & Ops** – Capsule Studio upgrade (evals, recipe/policy editors, ingestion monitor, audit log), Python/TS SDKs, CLIs for export/import and shadow benchmarking, and maintain deterministic offline mode.

### Wave 2 – Outperform (Weeks 6–12)

8. **Query Rewriting & Learned Rerankers** – optional LLM-powered rewriting and cross-encoder rerankers. Target +5–8 % quality on ambiguous prompts with <60 ms overhead.
9. **Latency & Scalability Program** – pluggable stores (pgvector, Qdrant) with `capsule-index`, hotset cache, sharding, and precomputed top-k. Target p95 ≤ 250 ms at 1 M memories, ≤ 350 ms at 10 M, and sustained QPS ≥ 200/core.
10. **Evaluation Harness & Public Leaderboard** – LOCOMO-style tests, Recall@k/Answer F1/p95 metrics, and `capsule bench --shadow <mem0|supermemory>` CLI for side-by-side comparisons.
11. **OpenMemory-class Local-First** – Capsule Local desktop service (SQLite + FAISS/pgvector) with MCP-first UX and permissioned sharing across MCP clients.
12. **Security & Governance** – E2E encryption option, BYOK, row-level ACLs, and PII detectors with policy gating at write time.

### Wave 3 – Moat & Differentiation (Months 3–12)

13. **Programmable Storage v2** – memory lifecycles, summarization DAGs, and Proof-of-Recall traces.
14. **Capsule Federation** – multi-region federation, query brokering, and bring-your-own/on-device embeddings.
15. **Connectors as a Platform** – GA connector set (Notion, Google Drive, OneDrive, Slack, Gmail, Confluence, Zendesk) and an OSS connector SDK.
16. **Vertical Solutions & Sample Apps** – IDE copilots, support agents, and sales co-pilots tailored for common buyer needs.
17. **Community & GTM** – Capsule Recipes gallery, Mem0/Supermemory migration tools, and open-core pricing tiers (self-host, Capsule Cloud, Enterprise).

## Concrete Specs to Implement Now

### CapsuleMeta v0.1 Schema

| Field | Type | Purpose |
| --- | --- | --- |
| `id` | string | Global ULID |
| `org`, `project`, `subject` | string | Multi-tenant scoping (from headers) |
| `content`, `lang` | string | Raw text and language |
| `embedding`, `embeddingModel` | float[]/string | Vector data and provenance |
| `createdAt`, `updatedAt`, `ttl`, `expiryAt` | timestamps | Decay and lifecycle control |
| `pinned`, `importance_score`, `recency_score` | boolean/number | Ranking controls |
| `type`, `tags[]` | string | Storage routing metadata |
| `source` | object | `{ app, connector, url, fileId, spanId }` |
| `provenance` | array | Audit trail of merges/updates |
| `acl` | object | `{ visibility: "private" | "shared" | ... }` |
| `pii_flags` | object | `{ email, phone, ssn, ... }` redaction hints |

### Storage Policy Examples

- **Preferences** – if `type = preference` then `ttl = ∞`, `dedupe(0.9)`, `importance = 1.5`, `store = long_term`.
- **Operational logs** – if `type = log` then `ttl = 14d`, `store = short_term`.
- **Knowledge (docs/emails)** – if `source.connector ∈ {notion, drive}` then `store = long_term` and `graph_enrich = true`.

### Search Recipe Library (Starter Set)

- **`default-semantic`** – vector + BM25 merge with rerank, boosts, filters, and structured return (example shown above).
- **`conversation-memory`** – prioritizes pinned and recent entries with small `k` for low latency.
- **`knowledge-qa`** – higher `k`, includes `graph_expand`, rerank, and answerability filter.
- **`audit-trace`** – emphasizes full provenance for compliance logging.

## How We Outperform Mem0 & Supermemory

- **Transparency & control** – open recipes, policies, and export/import by default; neither competitor exposes an equivalent DSL.
- **Local-first defaults** – deterministic offline dev plus Capsule Local with on-device embeddings.
- **Reproducible benchmarks** – publish Capsule Bench with datasets and shadow-mode tooling for live comparisons.
- **Security posture** – E2E encryption and BYOK at record/field level, exceeding typical SaaS defaults.
- **Connectors as code** – OSS connector SDK plus high-quality first-party connectors (Notion/Drive to start) mirroring Supermemory’s breadth.

## Initial Design Partner Use Cases

1. **Editor/IDE copilots** – MCP-heavy, local-first workflows combining repo/issues/PRs/user preferences.
2. **Support agents** – Zendesk/Confluence/Drive/Notion memory with case history and macros.
3. **Team research assistants** – multi-source ingestion with graph expansions for richer insights.

## KPIs & Acceptance Thresholds

- **Latency** – p95 ≤ 250 ms at 1 M memories (best recipe) and ≤ 350 ms at 10 M.
- **Quality** – +10–15 % over current internal evals; competitive with Mem0’s public LOCOMO-style results.
- **Time-to-first-value** – ≤ 5 minutes from onboarding to working memory via router or SDK.
- **Stability** – <0.1 % ingestion failures, zero silent data loss, ≥ 99.9 % availability (cloud).
- **Privacy** – 100 % encryption coverage in secure mode and validated PII redaction policies.

## Risks & Mitigations

- **Cross-encoder latency** – make reranking optional per recipe and cache pairwise scores.
- **Graph enrichment cost** – process asynchronously on deltas with recipe-level toggles.
- **Connector maintenance** – release connector SDK and certify a focused initial set.
- **Store fragmentation** – unify via the `capsule-index` abstraction and recipe orchestration.

## Next 2–3 Sprints (Suggested)

1. **Sprint 1** – Recipes v1, policy engine v1, CapsuleMeta v0.1, Capsule Studio upgrades (recipe/policy editors + audit log), and local eval harness (`capsule bench`).
2. **Sprint 2** – Capsule Router, streamlined MCP install, Notion & Google Drive connectors, and graph enrichment (read-only) with `graph_expand` recipe step.
3. **Sprint 3** – pgvector & Qdrant adapters, hotset cache, query rewriting module, and Capsule Local desktop package with on-device embeddings.

## Why This Strategy Wins

- Meets power users where they are (local-first, MCP, router) while offering unmatched transparency (recipes/policies/export).
- Turns “memory” from a black box into a programmable system so teams can encode product-specific heuristics without forking the engine.
- Benchmarks, migration tooling, and connectors make Capsule easy to adopt and difficult to leave.

## References

- Capsule current capabilities (README and existing tooling).
- Mem0 publications on extraction/update pipeline and OpenMemory MCP.
- Supermemory marketing on low-latency retrieval, graph enrichment, router setup, and connectors.
