# Wave 2 Implementation Checklist

## Adaptive Retrieval
- [x] Provide evaluation harness (`npm run eval:retrieval`).
- [x] Centralise rewrite/rerank configuration with guardrails.
- [x] Improve logging/metrics for rewrite & rerank usage.

## Capsule Local Packaging
- [x] Support configurable service manifest (for MCP/desktop use).
- [x] Add build helper to emit local bundle artifacts.

## Security & Governance
- [x] Enforce ACL constraints on shared/public visibility when PII is present.
- [x] Document BYOK expectations and ensure BYOK headers propagate to decryptors.
- [x] Outline upcoming work for embedding encryption.
