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

Stay aligned with `docs/status.md` and `docs/prioritized-todo.md` as work progresses.
