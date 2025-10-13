# Capsule Memory Self-Starter TODO

## Adaptive Retrieval Productionization
1. Create shared HTTP client helpers for rewriting and reranking services with timeout/retry + structured error logging.
2. Track rewrite and rerank latency in metrics/logs and include in API responses for observability.
3. Allow per-request overrides (headers) for forcing rewrite/rerank behavior when evaluating.
4. Extend Capsule Bench CLI (`eval:retrieval`) to support forcing rewrite/rerank and to emit CSV summaries.
5. Document adaptive knobs + evaluation workflow in README/status docs.

## Capsule Local Packaging & Sync
6. Add `npm run local:bundle` script to archive the local service (config + manifest) for distribution.
7. Support exporting local memories to JSON and importing from JSON.
8. Document desktop packaging workflow in README + roadmap.

## Security & Governance Enhancements
9. Extend BYOK documentation with rotation guidance; ensure decrypt paths honor per-request overrides.
10. Add CLI check for PII policy compliance (warn when ingesting public/shared memories with PII flags).
11. Outline embedding encryption rollout plan in roadmap/status docs.

(We'll work through these sequentially.)
