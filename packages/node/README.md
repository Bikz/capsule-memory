# @capsule-memory/node

The official Node.js client for the Capsule Memory production API. This SDK wraps the `/v1/memories` REST routes with a typed interface, header-based authentication, and sensible defaults for tenancy-aware requests.

## Installation

```bash
npm install @capsule-memory/node
```

## Quick start

```ts
import { CapsuleMemoryClient } from '@capsule-memory/node';

const client = new CapsuleMemoryClient({
  baseUrl: 'https://api.capsulememory.com',
  apiKey: process.env.CAPSULE_API_KEY!,
  orgId: process.env.CAPSULE_ORG_ID!,
  projectId: process.env.CAPSULE_PROJECT_ID!,
  defaultSubjectId: 'agent-123'
});

await client.storeMemory({
  content: 'Customer prefers morning meetings.',
  pinned: true
});

const results = await client.searchMemories({ query: 'meeting preferences' });
console.log(results.results.map((hit) => hit.content));
```

## API

- `storeMemory` – create a memory with optional pin, tags, TTL, and idempotency key support.
- `listMemories` – fetch recent memories for a subject.
- `searchMemories` – semantic lookup scoped to an organisation/project/subject.
- `pinMemory` – toggle the pinned flag on an existing memory.
- `deleteMemory` – forget a memory with an optional audit reason.

Each method accepts an optional `subjectId` argument to override the configured default.

## Development

Build the ESM bundle and type definitions:

```bash
npm run build --workspace @capsule-memory/node
```

The generated files live in `dist/` and are published with the package.
