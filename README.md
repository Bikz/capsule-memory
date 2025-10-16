# Capsule Memory

Capsule Memory is an AI-ready long-term memory service built with [Modelence](https://modelence.com/). It exposes a simple API and
React UI that any agent can use to persist knowledge, retrieve relevant memories by semantic similarity, pin critical facts, and
apply basic retention policies that keep the store tidy without losing important information.

- **Adaptive retrieval** – semantic search with optional query rewriting, learned rerankers, and Capsule-Graph expansions for
  richer multi-hop answers.
- **Programmable storage** – route memories via policies to short-term/long-term/graph stores, set TTLs, dedupe thresholds, and
  capture provenance with full ACL enforcement.
- **Connectors & ingest** – schedule ingestions (Notion, Google Drive) via the CLI in `tools/capsule-ingest.mjs` (`pnpm exec node tools/capsule-ingest.mjs`), monitor jobs in Capsule Studio, and
  bring third-party knowledge online in minutes.
- **Capsule Local** – run the SQLite-backed local cache (`pnpm exec node tools/capsule-local.mjs`) for offline development and MCP-first experiences.
- **Tooling for operators** – Capsule Studio offers live recipe/policy editors, connector dashboards, and search/policy preview
  tooling; Capsule Bench benchmarks adaptive retrieval against competitors.
- **Router & MCP quick-start** – `pnpm exec node tools/capsule-router.mjs` proxies memory-enriched prompts to any LLM endpoint; the MCP bridge ships as the `@capsule/mcp` package for MCP-compatible agents.

## Tech Stack
- **Framework:** TypeScript + Modelence (Express + MongoDB server, React/Vite client)
- **Database:** MongoDB (Atlas friendly). Data is stored via Modelence `Store`s.
- **Embeddings:** [Voyage AI `voyage-3.5`](https://www.voyageai.com/) for 1024-d vectors. When an API key is absent the server
  falls back to a deterministic local embedding so the app still works in development.
- **UI:** Tailwind-powered React components using `@tanstack/react-query` and Modelence’s RPC client.

## Getting Started
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Configure environment**
   Copy `.env.example` to `.env` (or `.modelence.env`) and populate it with your MongoDB and Voyage credentials. Keep real secrets in the private Capsule Cloud repo:
   ```bash
   MONGO_URL="mongodb+srv://…"    # required when running against Atlas/Modelence Cloud
   VOYAGE_API_KEY="sk-…"          # optional – enables true Voyage embeddings
   CAPSULE_META_ENCRYPTION_KEY="<base64-32-bytes>"  # optional – encrypts piiFlags at rest
   ```
   Without `VOYAGE_API_KEY` the backend automatically switches to a deterministic fallback embedding so development and tests can
   run offline.
3. **Run the dev server**
   ```bash
   pnpm run dev
   ```
   Open [http://localhost:5173/memory](http://localhost:5173/memory) to try the Capsule Memory UI. The dev command boots both the
   server and Vite client through Modelence.

## Backend Overview
The backend lives in `packages/core/src/server/memory` and is registered through `startApp`.

### Data Model (`packages/core/src/server/memory/db.ts`)
| Field           | Type            | Description                                      |
|-----------------|-----------------|--------------------------------------------------|
| `content`       | `string`        | Raw memory text.                                 |
| `embedding`     | `number[]`      | Normalised embedding vector (length 1024).       |
| `embeddingNorm` | `number`        | Original embedding magnitude (used for scoring). |
| `createdAt`     | `Date`          | Insertion timestamp.                             |
| `pinned`        | `boolean`       | Whether the memory is protected from auto-forget.|
| `explanation`   | `string?`       | Audit note about how the memory was created.     |

### Embedding Helper (`packages/core/src/server/memory/voyage.ts`)
- Lazily instantiates a `VoyageAIClient` using Modelence configuration or `VOYAGE_API_KEY`.
- Provides `generateEmbedding(text, inputType)` for both document and query vectors.
- Implements a deterministic fallback embedding when the API key is missing, ensuring tests and local dev can run without network
  access.

### Module (`packages/core/src/server/memory/index.ts`)
Exposes the following RPC methods via Modelence:

| Method                    | Type      | Description |
|---------------------------|-----------|-------------|
| `memory.getMemories`      | Query     | Returns the most recent/pinned memories plus an explanation string. |
| `memory.searchMemory`     | Query     | Embeds the query, scores memories via cosine similarity, and returns ranked results. |
| `memory.addMemory`        | Mutation  | Validates & stores a memory, then enforces the retention limit (removing the oldest unpinned memory if necessary). |
| `memory.pinMemory`        | Mutation  | Pins or unpins a memory by ID. |
| `memory.deleteMemory`     | Mutation  | Deletes a memory by ID with optional reason text. |

The retention policy currently keeps up to 100 memories. When the limit is exceeded the module removes the oldest unpinned entry
and returns the removal in the mutation response (`forgottenMemoryId`).

## Frontend Overview
`src/client/pages/MemoryPage.tsx` delivers an operator console for Capsule Memory:
- Uses `@tanstack/react-query` with Modelence’s `callMethod` to invoke the backend.
- Provides forms for adding memories, toggling pinned status, deleting items, and running semantic searches.
- Displays policy explanations directly in the UI so you can see when the service prunes older items.
- Styled with Tailwind classes for a dark, dashboard-like appearance.

`src/client/pages/HomePage.tsx` includes a quick link to the memory console so landing on `/` provides an easy entry point.

## Production API & SDKs
- **REST API** – Authenticated `/v1` routes expect `X-Capsule-Key`, `X-Capsule-Org`, `X-Capsule-Project`, and `X-Capsule-Subject` headers for multi-tenant scoping.
- **Node SDK** – `@capsule/sdk-js` offers a typed client for storing, searching, pinning, and deleting memories programmatically.
- **Python SDK** – `packages/python` ships a lightweight `CapsuleMemoryClient` (requests-based) with the same capture helpers.
- **MCP CLI** – `@capsule/mcp` exposes Capsule Memory as a Model Context Protocol toolset for desktop agent hosts.
- **Connectors** – configure connector catalog entries in `config/connectors.json`; both the ingest CLI and server reuse the same metadata.
- **Capture API** – `POST /v1/memories/capture` scores conversation events, queues recommended memories, and auto-approves when requested. Approve or reject queued candidates via `/v1/memories/capture/:id/approve|reject` (also exposed in the SDK).

## Useful Commands
| Command        | Description                         |
|----------------|-------------------------------------|
| `pnpm run dev`  | Start the Modelence dev server.     |
| `pnpm run build`| Build the production bundle.        |
| `pnpm run start`    | Launch the compiled server bundle.  |
| `pnpm run mcp`  | Start the Capsule Memory MCP bridge.|
| `pnpm run backfill` | Run the metadata backfill for existing memories. |
| `pnpm run policies` | Print the current storage policy catalogue. |
| `pnpm run router` | Launch the Capsule Router proxy for quick-start integrations. |
| `pnpm run bench` | Execute the Capsule Bench CLI (latency/quality benchmarking). |
| `pnpm run mcp:manifest` | Scaffold a ready-to-use MCP manifest that points at the Capsule bridge. |
| `pnpm run ingest` | Run the connector ingest helper for Notion/Drive exports (uses `config/connectors.json`). |
| `pnpm run local` | Start the Capsule Local SQLite cache service for offline use. |
| `pnpm run local:sync` | Sync memories between cloud Capsule and Capsule Local (pull/push). |
| `pnpm run local:data` | Export or import Capsule Local memories as JSON backups. |
| `pnpm run local:bundle` | Build a distributable Capsule Local bundle (config + manifest + scripts). |
| `pnpm run local:manifest` | Generate an MCP manifest pointing at the local cache. |
| `pnpm run eval:retrieval` | Evaluate adaptive retrieval results against a dataset. |
| `pnpm run eval:capture` | Score conversation events and report capture precision/recall metrics. |
| `pnpm run report:capture` | Summarise capture queue health (per-status counts/averages). |
| `pnpm run check:pii` | Scan for PII policy violations (shared/public memories containing PII). |

## Repository Structure

```
.
├── src/                    # server + client (Capsule Memory runtime & Studio UI)
├── packages/               # SDKs (node, python, mcp) and other tooling
├── tools/                  # CLI scripts, local helpers, evaluation/reporting
├── docs/                   # public documentation, roadmap, architecture notes
├── datasets/               # sample capture datasets for evaluators
└── cloud/                  # scaffolding for private/hosted extensions (see cloud/README.md)
```

Refer to `cloud/README.md` and `docs/cloud/structure.md` for guidance on layering a private cloud/hosted offering on top of
the open-source core.

### Validation checklist

Run these commands before sending a PR or deploying changes:

- `npx tsc --noEmit` – TypeScript structural check for the server, tools, and SDK packages.
- `pnpm run lint` – Lint the codebase (run `npm init @eslint/config` first if ESLint isn't configured locally).
- `pnpm run eval:retrieval -- --dataset <path>` – Spot-check adaptive retrieval behaviour on a pinned dataset.
- `pnpm run eval:capture -- --dataset <path>` – Measure capture precision/recall before adjusting thresholds.
- `pnpm run check:pii` – (Requires `MONGO_URL`) ensure no public/shared memories retain PII flags.

### Backfill existing memories

After upgrading to the CapsuleMeta-aware schema, run the backfill once to populate `lang`, `storage`,
`graphEnrich`, provenance, and default scoring fields for previously stored memories:

```bash
MONGO_URL="mongodb://…" pnpm run backfill -- --dry-run   # inspect changes without writing
MONGO_URL="mongodb://…" pnpm run backfill                # apply updates in-place
```

Optional flags:
- `--dry-run` / `-d` – log the intended updates without persisting.
- `--verbose` / `-v` – print each document update payload for auditing.
- `BACKFILL_BATCH_SIZE` – override the default batch size (`50`).

The script respects `MONGO_DB` if you need to target a specific database within the Mongo deployment.

### Security controls

- **ACL enforcement**: requests cannot set `visibility="public"` while PII flags remain. Clear or redact PII before expanding
  access.
- **Metadata encryption**: set `CAPSULE_META_ENCRYPTION_KEY` (32-byte key, UTF-8 or base64) to encrypt `piiFlags` at rest. The key
  is required to read or mutate encrypted flags—store it securely (e.g., in your KMS).
- **Bring-your-own key**: supply an `X-Capsule-BYOK` header per request to encrypt/decrypt metadata with customer-managed keys. The
  server threads this header through storage, search, and update flows so decryptors always honour the active key.
- **BYOK rotation**: 1) issue a new key in your KMS, 2) replay write/update calls with both the previous and new keys (Capsule
  decrypts with the header-provided key, re-encrypts with the same header), 3) once re-encryption completes, revoke the old key.
  During rotation, route traffic with the new header value to avoid mixed ciphertext.
- **Retention metadata**: tag memories as `irreplaceable`, `permanent`, `replaceable`, or `ephemeral`. Irreplaceable/permanent
  entries bypass automated eviction, while ephemerals inherit short TTLs unless overridden. The UI, REST API, and SDKs accept a
  `retention` field, defaulting to auto-selection (pinned ⇒ irreplaceable).
- **Structured logs**: keep `CAPSULE_LOG_POLICIES` / `CAPSULE_LOG_RECIPES` to their defaults (`true`) to emit structured JSON
  events for storage policy and search recipe usage. Set either to `false` to silence the corresponding logs.
- **Policy catalogue**: run `pnpm run policies` (or `--json`) to inspect the active storage policy stack for auditing.
- **PII compliance checks**: run `pnpm run check:pii` (requires `MONGO_URL`) to surface any non-private memories that still contain
  PII flags or encrypted PII metadata.

### Capsule Router quick-start

1. Generate a starter config (or copy `capsule-router.config.example.json`):
   ```bash
   pnpm run router -- --init
   ```
2. Update the file with your Capsule tenant identifiers, API key, recipe, and upstream endpoint.
3. Launch the proxy:
   ```bash
   pnpm run router -- --config capsule-router.config.json
   ```

POST requests send `{ prompt: "..." }` (plus any extra fields). The router enriches the payload with
`capsule.results` (top memories + metadata) before forwarding to your upstream URL.

### MCP quick-start

Generate a manifest that most MCP hosts (including Claude Desktop) can import:

```bash
pnpm run mcp:manifest  # creates capsule-memory.mcp.json
```

Adjust the embedded environment variables if your Capsule server runs elsewhere. Point your MCP client at the manifest and it will execute `npx @capsule/mcp` with the configured env.

### Capsule Bench (shadow benchmarking)

- Create a dataset describing the prompts you want to evaluate (see `capsule-bench.dataset.example.json`).
- Run the CLI:
  ```bash
  pnpm run bench -- --dataset my-dataset.json --recipe conversation-memory --shadow-url http://localhost:8080/search
  ```

The CLI prints latency statistics, optional accuracy hits (if you supply `expected` strings), and per-sample summaries. Use `--output results.json` to persist structured results.

### Connector ingestion (Notion & Google Drive)

Use the helper to ingest exports into Capsule Memory while tracking job status:

```bash
# Notion JSON export -> Capsule
pnpm run ingest -- --connector notion --source notion-export.json --dataset "notion:customer-success"

# Google Drive folder of notes -> Capsule
pnpm run ingest -- --connector google-drive --source ./drive-notes --dataset "drive:onboarding"
```

Each run registers a job in `/v1/connectors` which you can monitor in Capsule Studio. Provide API credentials or local exports as needed; the CLI tags memories with the connector id so recipes/policies can target them immediately.
- The connector catalog lives in `config/connectors.json` and drives both the API metadata and the ingest CLI help output.

### Capsule Local (offline cache)

Bring Capsule Memory offline via a lightweight SQLite service:

```bash
CAPSULE_LOCAL_DB=./capsule-local.db CAPSULE_LOCAL_PORT=5151 pnpm run local
```

The service exposes `/local/memories` for reads and `/local/status` for health checks. Point the MCP bridge or router at this port when operating fully offline, then sync via connectors or the sync CLI once back online.

```bash
# Pull cloud memories into the local cache
pnpm run local:sync -- --direction pull --limit 500

# Push local memories back to the cloud instance
pnpm run local:sync -- --direction push
```

Customize Capsule Local by creating `capsule-local.config.json` (auto-generated if missing):

```json
{
  "serviceName": "Capsule Local",
  "description": "Offline Capsule cache",
  "defaultSubjectId": "local-operator",
  "defaultTags": ["local", "offline"],
  "manifest": { "version": "1" }
}
```

Generate an MCP manifest pointing at the local cache:

```bash
pnpm run local:manifest   # writes capsule-local.mcp.json
```

### Export or import Capsule Local data

Create JSON backups (or reload them) without running the HTTP service:

```bash
pnpm run local:data -- --export backup.json   # dump all local memories
pnpm run local:data -- --import backup.json   # restore from backup
```

The JSON format mirrors the SQLite schema (`id`, `content`, `pinned`, `created_at`, `tags`, `metadata`). Entries without an `id` receive a new ULID/UUID during import.

### Bundle Capsule Local for distribution

Package the local service, config, and manifest into a tarball:

```bash
pnpm run local:bundle
```

The script stages assets under `dist/capsule-local-bundle/` and produces `dist/capsule-local-bundle.tar.gz` for sharing with teammates or packaging into an Electron build.

### Vector backend controls

Set `CAPSULE_VECTOR_STORE` to `mongo`, `pgvector`, or `qdrant` to toggle candidate selection. The Mongo-backed path remains default; other values log fallbacks until adapters are wired in. Tune the hotset cache with `CAPSULE_HOTSET_SIZE` (entries) and `CAPSULE_HOTSET_TTL` (ms) to balance latency and freshness.

### Adaptive retrieval knobs

- `config/adaptive.json` – centralise defaults for rewrite/rerank enablement, latency budgets, and result thresholds. Override per-deploy via `CAPSULE_ADAPTIVE_CONFIG`.
- `CAPSULE_REWRITER_URL` / `CAPSULE_REWRITER_KEY` – point the query rewriter at your hosted service (heuristic fallbacks remain in place).
- `CAPSULE_RERANKER_URL` / `CAPSULE_RERANKER_KEY` – plug in a learned reranker; when omitted Capsule falls back to recipe-weighted scores.
- `CAPSULE_REWRITE_ENABLED` / `CAPSULE_RERANK_ENABLED` – force-enable/disable adaptive steps regardless of config defaults.
- `CAPSULE_REWRITER_TTL` / `CAPSULE_REWRITER_CACHE` – control the rewrite cache TTL and max entries.

Run `pnpm run eval:retrieval -- --dataset datasets/sample.json --rewrite --csv results.csv` to benchmark adaptive settings. The evaluator accepts `--rewrite/--no-rewrite` and `--rerank/--no-rerank` overrides (sent via `X-Capsule-Rewrite` / `X-Capsule-Rerank` headers) and emits both JSON summaries (`--output summary.json`) and row-level CSV metrics (`--csv results.csv`).

For deterministic evaluation, prefer the Capsule Bench CLI and check `docs/status.md` for the latest roadmap progress.

### Capture pipeline

- Submit conversation events to `POST /v1/memories/capture` (or `client.scoreCapture`) to receive scores, recommended flags, and queued candidate IDs.
- Review pending candidates via `GET /v1/memories/capture?status=pending` or `client.listCaptureCandidates`.
- Approve with optional overrides (pinned/tags/retention/TTL) using `POST /v1/memories/capture/:id/approve` or `client.approveCaptureCandidate`; the server logs both the capture evaluation and final decision (`capsule.capture.*`).
- Reject via `POST /v1/memories/capture/:id/reject` / `client.rejectCaptureCandidate` to track declined items and reasons.
- Auto-accept by setting `autoAccept: true` on the capture request; the evaluator will create a memory immediately and log the decision.
- Tune scoring defaults with `CAPSULE_CAPTURE_THRESHOLD` (fallback `0.5`) or by passing `threshold` on the request.
- Monitor queue health with `pnpm run report:capture` or the MCP capture tools to spot drift in acceptance rates.

## Next Steps & Ideas
- Integrate true MongoDB Atlas Vector Search once an Atlas cluster is provisioned (the current scoring runs in Node for simplicity
  and portability).
- Add reranking using Voyage’s `rerank-2.5` model for even better search relevance.
- Implement summarisation of forgotten memories via an LLM before deletion.
- Extend the schema with tags, metadata, and per-agent segmentation.

Capsule Memory is ready to drop into your agent stack—wire it up to your orchestrator, seed it with long-term knowledge, and let
your AI recall the past with confidence.

## Competitive Roadmap

See [docs/memory-roadmap.md](docs/memory-roadmap.md) for the competitive analysis, phased roadmap, and KPI targets that guide Capsule Memory toward best-in-class performance against Mem0 and Supermemory. A high-level state of delivery is tracked in [docs/status.md](docs/status.md).

## MCP Bridge (Claude / local agents)

Run `pnpm run mcp` to expose the Capsule Memory API as an MCP server over stdio. Point your MCP-compatible client (e.g. Claude
Desktop) at the resulting manifest and the agent will gain the following tools:

- `capsule-memory.store` – add/pin new memories
- `capsule-memory.search` – semantic lookup
- `capsule-memory.list` – list the most recent memories
- `capsule-memory.capture-score` – score raw conversation events and queue recommended memories
- `capsule-memory.capture-list` – inspect pending/approved/rejected capture candidates
- `capsule-memory.capture-approve` / `capture-reject` – resolve items in the capture queue without leaving your MCP host
- `capsule-memory.pin` – toggle pinned status
- `capsule-memory.forget` – delete a memory with an optional reason

The bridge proxies requests to the running Modelence server (`http://localhost:3000` by default). Set `CAPSULE_MEMORY_URL` if the
API is exposed on a different origin. This keeps the web UI untouched while enabling agents to update and query the memory store.
