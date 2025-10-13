#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import { CapsuleMemoryClient } from '../packages/node/dist/index.js';

const API_BASE = (process.env.CAPSULE_MEMORY_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.CAPSULE_API_KEY || 'demo-key';
const ORG_ID = process.env.CAPSULE_DEFAULT_ORG_ID || 'demo-org';
const PROJECT_ID = process.env.CAPSULE_DEFAULT_PROJECT_ID || 'demo-project';
const SUBJECT_ID = process.env.CAPSULE_DEFAULT_SUBJECT_ID || 'local-operator';

const LOCAL_PORT = Number.parseInt(process.env.CAPSULE_LOCAL_PORT ?? '5151', 10);
const LOCAL_BASE = process.env.CAPSULE_LOCAL_URL || `http://localhost:${LOCAL_PORT}`;

function parseArgs(argv) {
  const args = { direction: 'pull', limit: 200 };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--direction':
      case '-d':
        args.direction = argv[++i];
        break;
      case '--limit':
      case '-l':
        args.limit = Number.parseInt(argv[++i], 10);
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Capsule Local Sync CLI\n\nUsage:\n  npm run local:sync -- --direction pull   # cloud -> local\n  npm run local:sync -- --direction push   # local -> cloud\n\nOptions:\n  --direction, -d  pull (cloud → local) or push (local → cloud). Default: pull.\n  --limit, -l      Max memories to transfer per run (default 200).\n`);
}

async function fetchLocalMemories(limit) {
  const res = await fetch(`${LOCAL_BASE}/local/memories?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Local service responded ${res.status}: ${await res.text()}`);
  }
  const payload = await res.json();
  return payload.data ?? [];
}

async function upsertLocalMemory(record) {
  const res = await fetch(`${LOCAL_BASE}/local/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record)
  });
  if (!res.ok) {
    throw new Error(`Failed to upsert local memory: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const client = new CapsuleMemoryClient({
    baseUrl: API_BASE,
    apiKey: API_KEY,
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    defaultSubjectId: SUBJECT_ID
  });

  if (args.direction === 'pull') {
    const remote = await client.listMemories({ limit: args.limit });
    const records = remote.items ?? [];
    for (const item of records) {
      await upsertLocalMemory({
        id: item.id,
        content: item.content,
        pinned: item.pinned,
        created_at: item.createdAt,
        tags: item.tags,
        metadata: {
          orgId: item.orgId,
          projectId: item.projectId,
          subjectId: item.subjectId
        }
      });
      console.log(`Synced ${item.id} → Capsule Local`);
    }
    console.log(`Pulled ${records.length} memories into Capsule Local.`);
    return;
  }

  if (args.direction === 'push') {
    const locals = await fetchLocalMemories(args.limit);
    for (const item of locals) {
      await client.storeMemory({
        content: item.content,
        pinned: Boolean(item.pinned),
        tags: Array.isArray(item.tags) ? item.tags : undefined,
        subjectId: SUBJECT_ID,
        idempotencyKey: item.id
      });
      console.log(`Pushed ${item.id ?? '(new)'} → Capsule Cloud`);
    }
    console.log(`Pushed ${locals.length} memories to Capsule Cloud.`);
    return;
  }

  throw new Error(`Unknown direction "${args.direction}". Use pull or push.`);
}

main().catch((error) => {
  console.error('Capsule Local sync failed:', error);
  process.exit(1);
});
