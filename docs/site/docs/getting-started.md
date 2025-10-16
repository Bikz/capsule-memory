---
title: Getting Started
description: Deploy Capsule Memory and make your first API call.
---

Welcome to Capsule Memory! This guide walks you through deploying the production stack and persisting your first memory.

## 1. Provision infrastructure

1. **Database** – Create a MongoDB Atlas cluster (M10 or higher) and capture the connection string.
2. **Embeddings** – Generate a Voyage AI API key for semantic search.
3. **Secrets** – Prepare a `CAPSULE_API_KEY` for your first project along with a `SESSION_SECRET` and `JWT_SECRET`.

## 2. Configure environment

Create a `.env.production` file:

```bash
MONGO_URL="mongodb+srv://..."
VOYAGE_API_KEY="sk-..."
CAPSULE_API_KEYS="prod-key"
CAPSULE_DEFAULT_ORG_ID="acme"
CAPSULE_DEFAULT_PROJECT_ID="assistant"
CAPSULE_DEFAULT_SUBJECT_ID="support-agent"
```

## 3. Build & run the container

```bash
docker build -t capsule-memory .
docker run --env-file .env.production -p 3000:3000 capsule-memory
```

The Modelence server boots at `http://localhost:3000` with the admin UI available on `http://localhost:5173/memory` when running in dev mode.

## 4. Store a memory

Use the Node SDK to persist your first item:

```ts
import { CapsuleMemoryClient } from '@capsule/sdk-js';

const client = new CapsuleMemoryClient({
  baseUrl: 'https://api.example.com',
  apiKey: 'prod-key',
  orgId: 'acme',
  projectId: 'assistant',
  defaultSubjectId: 'support-agent'
});

await client.storeMemory({
  content: 'Customer loves receiving shipping updates via SMS.',
  pinned: true
});
```

You now have a production-grade, multi-tenant memory service ready for your agents.
