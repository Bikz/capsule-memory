# Capsule Memory – Wave 2 Priorities

## Ambient Goals
1. **Adaptive Retrieval (Production Grade)**
   - Wire hosted rewriter & reranker services behind `CAPSULE_REWRITER_URL` / `CAPSULE_RERANKER_URL`.
   - Expand Capsule Bench datasets and add regression guardrails.
   - Surface recipe-level toggles (rewrite mandatory? rerank fallback?).
2. **Local-First Desktop Experience**
   - Package Capsule Local (Electron/binary) with `local:sync` integration, encryption, and MCP sharing.
   - Document offline-to-cloud sync flows and conflict handling.
3. **Security & Governance**
   - BYOK reach: metadata + embeddings, key rotation docs, admin tooling.
   - Row-level ACL management: Studio UI, audit logging, policy templates.
   - PII gating: write-time policies, connector compliance visibility.
   - Embedding encryption: evaluate encrypt-at-rest options for stored vectors and migration guidance.

### Embedding Encryption Rollout Plan
1. **Design (Week 1)** – benchmark candidate approaches (FPE, deterministic AEAD, envelope with BYOK) against retrieval latency; document trade-offs in `docs/embedding-encryption.md`.
2. **Prototype (Weeks 2–3)** – wire optional encryption module behind feature flag, add regression tests for encode/decode integrity, and validate against Capsule Bench datasets.
3. **Migration tooling (Week 4)** – ship one-shot migration CLI to re-encrypt existing embeddings using rolling batches with progress logging.
4. **General Availability (Week 5)** – enable per-tenant toggles, publish ops guide (rotation, incident response), and add monitoring checks for decrypt failures.
5. **Follow-up** – integrate with Capsule Local bundle (on-device key storage) and enforce policy guardrails in connector ingest pipeline.

Stay aligned with `docs/status.md` and `docs/prioritized-todo.md` as work progresses.
