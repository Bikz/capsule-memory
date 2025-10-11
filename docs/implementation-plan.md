# Capsule Memory – Implementation Plan

This document expands on the tasks summarized in the README and gives the next agent a clear sequence of actions.

## 1. Scaffold & Baseline
- Run `npx create-modelence-app@latest . --template voyage-ai` (or create in a temp dir and move files in).
- Verify `package.json`, `tsconfig.json`, and Modelence configs are generated.
- Commit scaffold to version control.

## 2. Environment Configuration
- Add `.env.example` listing required variables:
  - `MONGO_URL`
  - `VOYAGE_API_KEY`
- For Modelence Cloud integration, include setup instructions in README appendix.
- Ensure `.gitignore` excludes `.env` variants and Modelence credentials.

## 3. Backend: Memory Module
1. **Store (`src/server/memory/db.ts`):**
   - Define schema: `content`, `embedding`, `createdAt`, `pinned`, optional `metadata`.
   - Register vector search index via `Store.vectorIndex`.
2. **Voyage helpers (`voyage.ts`):**
   - Implement `generateEmbedding` and `rerankResults`.
   - Handle missing API key gracefully.
3. **Module (`index.ts`):**
   - Register store.
   - Queries:
     - `getMemories` with recency ordering + limit.
     - `searchMemory` performing vector search + optional rerank; include explanations.
   - Mutations:
     - `addMemory` with validation, embedding generation, memory-limit enforcement, and explanatory messages.
     - `pinMemory` to toggle `pinned`.
     - `deleteMemory` with audit/log hook placeholder.
   - Export config schema if Voyage key managed via Modelence config.
4. **Wire to app (`src/server/app.ts`):**
   - Import and register memory module in `startApp`.

## 4. Frontend: MemoryPage
- Create route entry in `src/client/routes.ts`.
- Implement `MemoryPage.tsx`:
  - Form to add memory (content textarea, pin checkbox).
  - List view for memories with pin/unpin + forget actions.
  - Search form with results panel and relevance scores.
  - Show messages returned by mutations (policy notes, errors).
  - Use `useQuery` and `useMutation` from `@modelence/react-query`.
- Add lightweight styling (Tailwind or basic CSS from template).

## 5. Testing & Validation
- Manual QA checklist:
  - Adding memory persists and displays.
  - Pinned items survive auto-forget.
  - Memory limit triggers deletion of oldest unpinned entry and produces explanation.
  - Search returns relevant items with scores.
  - Forget action removes item permanently.
- Optional: add unit tests for policy logic (e.g., using Vitest).

## 6. Stretch Goals (Time Permitting)
- Implement summarization path when limit exceeded (calls external LLM and archives original memories).
- Add metadata tags and filters.
- Support multi-tenant agent IDs for shared service deployments.
- Persist audit logs for explainability.

## 7. Deployment Notes
- Prepare MongoDB Atlas cluster with vector search enabled.
- Configure Modelence Cloud or deploy to Vercel/Render.
- Store sensitive keys using provider secrets management.

---

Feel free to add clarifying notes, questions, or experiment logs here as work progresses.
