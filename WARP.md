# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Capsule Memory is an AI-ready long-term memory service built with [Modelence](https://modelence.com/). It provides semantic memory storage and retrieval capabilities for AI agents, with both a React web UI and an MCP (Model Context Protocol) bridge for local agent integration.

## Architecture

### Tech Stack
- **Framework**: TypeScript + [Modelence](https://modelence.com/) (Express + MongoDB server, React/Vite client)
- **Database**: MongoDB with vector embeddings storage
- **Embeddings**: Voyage AI `voyage-3.5` model (1024-dimensional vectors) with deterministic fallback
- **Frontend**: React + React Router + TanStack Query + Tailwind CSS
- **MCP Integration**: Node.js bridge exposing memory operations as MCP tools

### Core Components

**Backend (`packages/core/src/server/`)**:
- `app.ts` - Main Modelence application entry point that registers the memory module
- `memory/index.ts` - Core memory module with RPC methods (queries and mutations)
- `memory/db.ts` - MongoDB store definition with schema and indexes for memory documents
- `memory/voyage.ts` - Voyage AI embedding client with deterministic fallback

**Frontend (`src/client/`)**:
- `router.ts` - React Router configuration with lazy loading
- `pages/HomePage.tsx` - Landing page with navigation to memory interface
- `pages/MemoryPage.tsx` - Main memory management UI with forms and search
- Uses `@tanstack/react-query` for server state management

**MCP Bridge (`tools/capsule-memory-mcp.mjs`)**:
- Standalone Node.js script that exposes memory operations as MCP tools
- Proxies requests to the running Modelence server via HTTP API
- Provides 5 MCP tools: store, search, list, pin, forget

### Data Model

Memory documents stored in MongoDB contain:
- `content` (string) - The memory text content
- `embedding` (number[]) - Normalized 1024-dimensional embedding vector
- `embeddingNorm` (number) - Original embedding magnitude for cosine similarity scoring
- `createdAt` (Date) - Creation timestamp
- `pinned` (boolean) - Protection flag preventing auto-deletion
- `explanation` (string, optional) - Audit trail for memory creation

### Memory Management Logic

**Retention Policy**: Maintains a rolling limit of 100 memories maximum. When exceeded, automatically removes the oldest unpinned memory and reports the action.

**Search Algorithm**: Uses in-memory cosine similarity scoring rather than MongoDB vector search for simplicity and portability. Fetches up to 500 recent memories, scores them against query embedding, and returns top results.

## Common Development Commands

```bash
# Install dependencies
pnpm install

# Start development server (both backend and frontend)
pnpm dev

# Build all packages
pnpm build

# Run MCP bridge (for local agents like Claude Desktop)
pnpm run mcp
```

## Environment Configuration

Create `.env` or `.modelence.env` with:
```bash
MONGO_URL="mongodb+srv://..."    # Required for Atlas/production
VOYAGE_API_KEY="sk-..."          # Optional - enables true Voyage embeddings
```

Without `VOYAGE_API_KEY`, the system uses a deterministic fallback embedding for development.

## Development Guidelines

### Working with Memory Module
- All memory operations go through the Modelence module system in `packages/core/src/server/memory/index.ts`
- Queries: `getMemories` (recent/pinned), `searchMemory` (semantic search)
- Mutations: `addMemory`, `pinMemory`, `deleteMemory`
- All operations return explanatory messages for transparency

### Frontend Development
- Memory UI is at `/memory` route
- Uses TanStack Query for caching and optimistic updates
- Forms provide immediate feedback via toast notifications
- All server communication uses Modelence's RPC client

### MCP Integration
- MCP bridge runs independently via `pnpm run mcp`
- Connects to running Modelence server (default: `http://localhost:3000`)
- Override server URL with `CAPSULE_MEMORY_URL` environment variable
- Provides structured and text-based responses for agent consumption

### Embedding System
- Production uses Voyage AI `voyage-3.5` model
- Development fallback creates deterministic embeddings from text hash
- All embeddings are L2-normalized for consistent cosine similarity scoring
- Vector dimensions are fixed at 1024 (constant in `db.ts`)

### Database Considerations
- Uses Modelence's MongoDB Store abstraction
- Indexes on `createdAt` and `pinned, createdAt` for efficient queries
- No MongoDB Atlas Vector Search dependency (pure Node.js scoring)
- Vector search can be upgraded to Atlas when provisioned

## Testing the System

**Manual QA Checklist**:
1. Memory creation persists and displays correctly
2. Pinned memories survive auto-forget policy
3. Memory limit triggers oldest unpinned deletion with explanation
4. Semantic search returns relevant results with scores
5. Pin/unpin toggles work correctly
6. Delete operations remove memories permanently
7. MCP bridge tools work with local agents

**Key URLs**:
- Web UI: `http://localhost:5173/memory` (development)
- API Health: Check Modelence server logs for startup confirmation

## Debugging Tips

- **No embeddings**: Check `VOYAGE_API_KEY` configuration or confirm fallback embedding is working
- **Database errors**: Verify `MONGO_URL` connection and MongoDB Atlas provisioning
- **MCP bridge issues**: Confirm Modelence server is running and accessible on expected port
- **Memory not persisting**: Check MongoDB connection and Modelence Store initialization
- **Search returning no results**: Verify embedding generation and normalization logic
