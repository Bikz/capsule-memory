# Capsule Memory – Production Platform Plan

This document outlines the roadmap for evolving Capsule Memory into a multi-tenant, production-ready "memory-as-a-service" offering. It distills the deployment and productization strategy into actionable sections that engineering, product, and operations teams can execute sequentially.

## 0. Product Packaging
- **Open-source core**
  - Multi-tenant Capsule Memory server (Modelence + MongoDB).
  - Policy engine for pin rules, TTLs, and audit trail management.
  - Capsule Studio admin UI at `/memory` with per-user views.
  - MCP bridge (`npx @capsule-memory/mcp`) for local or cloud workflows.
  - SDKs: primary Node/JS package (`@capsule-memory/node`) with a lightweight Python client.
- **Managed cloud (Capsule Cloud)**
  - Hosted API with SSO, projects, API keys, usage dashboards, quotas.
  - Organization/project RBAC and environment separation.
  - Webhooks, event log, policy editor, and subject browser.
  - CLI onboarding flow (`npx capsule-memory@latest init`).
- **Documentation site**
  - Quickstarts, SDK/API references, MCP integration guide, governance recipes.

## 1. Production Architecture
- **Core services**: Node (Modelence) API + admin UI, MongoDB Atlas (TLS, backups), Voyage AI embeddings, optional BullMQ/Redis job queue.
- **Edge & observability**: Cloudflare for TLS/rate limiting, Sentry, Prometheus/Grafana or Datadog, centralized logging (Logtail/ELK).
- **Multi-tenant model**: Extend `src/server/memory/db.ts` with `orgId`, `projectId`, `subjectId`, `tags`, optional TTL, and indexes to scope queries per tenant. All API paths must enforce tenant context from auth headers.

## 2. Public API Design
Expose REST endpoints under `/v1`:
- `POST /v1/memories` – create memory (idempotent via `Idempotency-Key`).
- `GET /v1/memories` – list memories with filters (subject, pinned, tag) and pagination.
- `POST /v1/memories/search` – semantic search.
- `PATCH /v1/memories/:id` – update metadata (pin, tags, TTL).
- `DELETE /v1/memories/:id` – delete memory.

Authentication via `X-Capsule-Key` or `Authorization: Bearer` header; subject scoping via `X-Capsule-Subject` (or request body). Provide cURL examples in docs.

## 3. Developer Experience
- **Node SDK**: `@capsule-memory/node` with `store`/`search` helpers.
- **Python mini SDK** for parity.
- **CLI (`packages/cli`)**: device-flow login, project creation, key management, event tailing, import/export utilities.

## 4. Admin Console ("Capsule Studio")
- Overview dashboard (usage, errors, costs).
- Subjects explorer with memory management (pin/unpin/delete, tagging).
- Policy & recipe editors (limits, auto-forget, pin rules, search defaults).
- API key & webhook management.
- Audit log viewer (mutation history with actor and rationale).

## 5. Cloud Deployment
- Containerize with a multi-stage `Dockerfile` and `docker-compose.dev.yml` for local dev.
- Deploy via Render/Railway/Fly/AWS Fargate behind Cloudflare.
- Use GitHub Actions for CI/CD with secrets: `MONGO_URL`, `VOYAGE_API_KEY`, `SESSION_SECRET`, `JWT_SECRET`, `STRIPE_SECRET` (future).

## 6. Authentication & Tenancy
- Google OAuth for console users; entities for users, orgs, projects, apiKeys.
- Role-based access (Owner/Admin/Developer/Analyst).
- API key scopes (`memories.write`, `memories.search`) with per-project rate limits.
- Enforce tenant context across all database operations.

## 7. Policies & Recipes
- Policy model: `maxMemoriesPerSubject`, `autoForgetStrategy`, `defaultTTL`, `autoPinRules`.
- Search recipe options: embedding model, candidate window, limit, min score, optional rerank.
- Apply policy enforcement within `addMemory` and search queries.

## 8. Documentation & Examples
- Docusaurus site with 5-minute quickstart, framework integrations, MCP guide, security/compliance notes, and cookbook scenarios (CRM assistant, support agent, sales researcher).

## 9. Pricing & Go-to-Market
- Free tier: 1 project, 10k memories stored, 50k reads/month, community support.
- Pro: $49/month/project plus usage-based billing for storage/embeddings.
- Team/Enterprise: SSO/SAML, audit exports, data residency, VPC peering.
- Target indie founders and agent teams; highlight governance UI, policy engine, MCP support, and flexible deployment.

## 10. Competitive Positioning
- Vector DBs lack opinionated agent memory UX/governance.
- Framework memory plugins lack multi-tenancy and hosted services.
- Differentiate with transparent policies, per-user controls, MCP integration, and hybrid OSS/cloud deployment story.

## 11. Immediate Engineering Tasks
1. Add tenancy fields and indexes to memory store; enforce in code paths.
2. Implement `/v1` API routes with header-based key authentication.
3. Add Dockerfile + `docker-compose.dev.yml` + CI pipeline.
4. Scaffold Docusaurus docs with getting-started and API reference.
5. Publish `@capsule-memory/node`; create MCP package.
6. Stand up single-region cloud deployment (Mongo Atlas + Node service + Cloudflare).
7. Recruit 5 beta design partners to validate onboarding flow.

## 12. Launch Timeline (4–6 Weeks)
- **Weeks 1–2**: Tenancy, API keys, public routes, Google login, initial deployment, minimal console.
- **Week 3**: Policies, audit/webhooks, Node SDK, docs v1.
- **Week 4**: MCP package, Python SDK, billing scaffolding.
- **Weeks 5–6**: Rate limits, observability, backups, private beta.

## 13. Risks & Mitigations
- **Vendor memory features**: stay neutral, emphasize governance & portability.
- **Embedding costs**: caching, dedupe via content hash, candidate batching, optional rerank.
- **Compliance**: adopt SOC-lite practices early, offer export/delete APIs, document data handling.

## 14. Immediate Checklist
- Extend schema with `orgId/projectId/subjectId`.
- Ship `/v1` routes and header-based auth.
- Publish containerization assets and docs skeleton.
- Release Node SDK + MCP package.
- Deploy cloud instance and onboard beta users.
