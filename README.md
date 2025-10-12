# Capsule Memory

Capsule Memory is an AI-ready long-term memory service built with [Modelence](https://modelence.com/). It exposes a simple API and
React UI that any agent can use to persist knowledge, retrieve relevant memories by semantic similarity, pin critical facts, and
apply basic retention policies that keep the store tidy without losing important information.

## Feature Highlights
- **Memory persistence** – store text memories together with Voyage AI embeddings, timestamps, and pin flags.
- **Semantic search** – embed incoming queries and rank memories by cosine similarity so that lookups work by meaning rather than
  exact keywords.
- **Pin & forget controls** – toggle pinned status to protect critical facts and explicitly delete obsolete memories.
- **Retention policy** – enforce a rolling limit (default `100` memories) that automatically removes the oldest unpinned item and
  reports the action back to the caller.
- **Transparent explanations** – every mutation returns a human-readable explanation so agent orchestrators can reason about what
  happened.
- **Rich UI** – a `/memory` management page lets you add, search, pin, and delete memories while seeing live policy feedback.

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
   Create a `.env` or `.modelence.env` file with your MongoDB and Voyage credentials:
   ```bash
   MONGO_URL="mongodb+srv://…"    # required when running against Atlas/Modelence Cloud
   VOYAGE_API_KEY="sk-…"          # optional – enables true Voyage embeddings
   ```
   Without `VOYAGE_API_KEY` the backend automatically switches to a deterministic fallback embedding so development and tests can
   run offline.
3. **Run the dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173/memory](http://localhost:5173/memory) to try the Capsule Memory UI. The dev command boots both the
   server and Vite client through Modelence.

## Backend Overview
The backend lives in `src/server/memory` and is registered through `startApp`.

### Data Model (`src/server/memory/db.ts`)
| Field           | Type            | Description                                      |
|-----------------|-----------------|--------------------------------------------------|
| `content`       | `string`        | Raw memory text.                                 |
| `embedding`     | `number[]`      | Normalised embedding vector (length 1024).       |
| `embeddingNorm` | `number`        | Original embedding magnitude (used for scoring). |
| `createdAt`     | `Date`          | Insertion timestamp.                             |
| `pinned`        | `boolean`       | Whether the memory is protected from auto-forget.|
| `explanation`   | `string?`       | Audit note about how the memory was created.     |

### Embedding Helper (`src/server/memory/voyage.ts`)
- Lazily instantiates a `VoyageAIClient` using Modelence configuration or `VOYAGE_API_KEY`.
- Provides `generateEmbedding(text, inputType)` for both document and query vectors.
- Implements a deterministic fallback embedding when the API key is missing, ensuring tests and local dev can run without network
  access.

### Module (`src/server/memory/index.ts`)
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
- **Node SDK** – `@capsule-memory/node` offers a typed client for storing, searching, pinning, and deleting memories programmatically.
- **MCP CLI** – `@capsule-memory/mcp` exposes Capsule Memory as a Model Context Protocol toolset for desktop agent hosts.

## Useful Commands
| Command        | Description                         |
|----------------|-------------------------------------|
| `npm run dev`  | Start the Modelence dev server.     |
| `npm run build`| Build the production bundle.        |
| `npm start`    | Launch the compiled server bundle.  |
| `npm run mcp`  | Start the Capsule Memory MCP bridge.|

## Next Steps & Ideas
- Integrate true MongoDB Atlas Vector Search once an Atlas cluster is provisioned (the current scoring runs in Node for simplicity
  and portability).
- Add reranking using Voyage’s `rerank-2.5` model for even better search relevance.
- Implement summarisation of forgotten memories via an LLM before deletion.
- Extend the schema with tags, metadata, and per-agent segmentation.

Capsule Memory is ready to drop into your agent stack—wire it up to your orchestrator, seed it with long-term knowledge, and let
your AI recall the past with confidence.

## Competitive Roadmap

See [docs/memory-roadmap.md](docs/memory-roadmap.md) for the competitive analysis, phased roadmap, and KPI targets that guide Capsule Memory toward best-in-class performance against Mem0 and Supermemory.

## MCP Bridge (Claude / local agents)

Run `npm run mcp` to expose the Capsule Memory API as an MCP server over stdio. Point your MCP-compatible client (e.g. Claude
Desktop) at the resulting manifest and the agent will gain the following tools:

- `capsule-memory.store` – add/pin new memories
- `capsule-memory.search` – semantic lookup
- `capsule-memory.list` – list the most recent memories
- `capsule-memory.pin` – toggle pinned status
- `capsule-memory.forget` – delete a memory with an optional reason

The bridge proxies requests to the running Modelence server (`http://localhost:3000` by default). Set `CAPSULE_MEMORY_URL` if the
API is exposed on a different origin. This keeps the web UI untouched while enabling agents to update and query the memory store.
