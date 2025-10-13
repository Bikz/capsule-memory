# Capsule Memory Self-Starter TODO

## Adaptive Retrieval Productionization
- [x] Create shared HTTP client helpers for rewriting and reranking services with timeout/retry + structured error logging.
- [x] Track rewrite and rerank latency in metrics/logs and include in API responses for observability.
- [x] Allow per-request overrides (SDK + CLI headers) for forcing rewrite/rerank behavior when evaluating.
- [x] Extend retrieval evaluator to support forced rewrite/rerank runs, emit CSV/metrics summaries, and flag latency deltas.
- [x] Document adaptive knobs + evaluation workflow in README/status docs.

## Capsule Local Packaging & Sync
- [x] Add `npm run local:bundle` script that stages config + manifest and emits a distributable archive.
- [x] Support exporting local memories to JSON and importing from JSON (CLI tooling + docs).
- [x] Document desktop packaging workflow and sync flows in README + roadmap.

## Security & Governance Enhancements
- [x] Extend BYOK documentation with rotation guidance and verify decrypt paths honour per-request overrides with tests/docs.
- [x] Add CLI check for PII policy compliance (warn when ingesting shared/public memories with PII flags).
- [x] Outline embedding encryption rollout plan in roadmap/status docs (detail milestones, owners, testing hooks).

## Quality Gates
- [x] Add regression checks (tsc, lint, targeted CLI smoke tests) to README/status so contributors know how to validate changes.
- [x] Capture follow-up issues discovered during implementation and backfill into `docs/prioritized-todo.md` if needed.
