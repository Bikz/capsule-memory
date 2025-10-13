#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { CapsuleMemoryClient } from '../packages/node/dist/index.js';

const API_BASE = (process.env.CAPSULE_MEMORY_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.CAPSULE_API_KEY || 'demo-key';
const ORG_ID = process.env.CAPSULE_DEFAULT_ORG_ID || 'demo-org';
const PROJECT_ID = process.env.CAPSULE_DEFAULT_PROJECT_ID || 'demo-project';
const SUBJECT_ID = process.env.CAPSULE_DEFAULT_SUBJECT_ID || 'local-operator';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--connector':
      case '-c':
        args.connector = argv[++i];
        break;
      case '--source':
      case '-s':
        args.source = argv[++i];
        break;
      case '--dataset':
      case '-d':
        args.dataset = argv[++i];
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        args._.push(token);
        break;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Capsule Connector Ingest CLI\n\nUsage: npm run ingest -- --connector notion --source path/to/export.json\n       npm run ingest -- --connector google-drive --source ./drive-folder\n\nOptions:\n  --connector, -c   Connector id (notion | google-drive)\n  --source, -s      Source file or directory (export JSON for Notion, folder for Drive).\n  --dataset, -d     Optional label recorded with the ingestion job.\n`);
}

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Capsule-Key': API_KEY
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function createJob(connectorId, dataset) {
  const url = `${API_BASE}/v1/connectors/${connectorId}/jobs`;
  const payload = await request('POST', url, dataset ? { dataset } : undefined);
  return payload.data.jobId;
}

async function updateJob(jobId, patch) {
  await request('PATCH', `${API_BASE}/v1/connectors/jobs/${jobId}`, patch);
}

async function ingestFromNotion(sourcePath) {
  const resolved = path.resolve(process.cwd(), sourcePath);
  const raw = await fsPromises.readFile(resolved, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Notion export must be an array of pages.');
  }
  return parsed.map((page) => ({
    id: page.id || page.slug || page.title,
    title: page.title || 'Untitled',
    content: page.content || page.description || '',
    tags: page.tags || [],
    url: page.url || page.link || null
  }));
}

async function ingestFromDrive(folderPath) {
  const resolved = path.resolve(process.cwd(), folderPath);
  const entries = await fsPromises.readdir(resolved, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (entry.isFile() && /\.(md|txt|markdown|docx?)$/i.test(entry.name)) {
      const filePath = path.join(resolved, entry.name);
      const content = await fsPromises.readFile(filePath, 'utf8').catch(() => '');
      items.push({
        id: entry.name,
        title: entry.name.replace(/\.[^.]+$/, ''),
        content,
        tags: ['drive'],
        url: null
      });
    }
  }
  return items;
}

async function ingest({ connector, source, dataset }) {
  if (!connector) {
    throw new Error('Connector id is required.');
  }
  if (!source) {
    throw new Error('Source path is required.');
  }

  const jobId = await createJob(connector, dataset);
  await updateJob(jobId, { status: 'running' });

  const client = new CapsuleMemoryClient({
    baseUrl: API_BASE,
    apiKey: API_KEY,
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    defaultSubjectId: SUBJECT_ID
  });

  let records = [];
  if (connector === 'notion') {
    records = await ingestFromNotion(source);
  } else if (connector === 'google-drive') {
    records = await ingestFromDrive(source);
  } else {
    throw new Error(`Unsupported connector: ${connector}`);
  }

  let success = 0;
  const errors = [];

  for (const record of records) {
    try {
      const result = await client.storeMemory({
        content: `${record.title}\n\n${record.content}`.trim(),
        tags: Array.from(new Set([connector, ...(record.tags || [])])),
        source: {
          connector,
          url: record.url || undefined,
          fileId: record.id
        },
        type: 'knowledge',
        lang: 'en',
        acl: { visibility: 'shared' }
      });
      console.log(`Stored memory ${result.id} (${connector})`);
      success += 1;
    } catch (error) {
      errors.push({ id: record.id, error: error instanceof Error ? error.message : String(error) });
      console.error(`Failed to store record ${record.id}:`, error);
    }
  }

  if (errors.length > 0) {
    await updateJob(jobId, {
      status: 'error',
      itemCount: success,
      error: errors.map((entry) => `${entry.id}: ${entry.error}`).join('; '),
      metadata: { errors }
    });
    throw new Error(`Ingestion completed with errors (${errors.length}).`);
  }

  await updateJob(jobId, {
    status: 'success',
    itemCount: success,
    metadata: {
      dataset,
      connector,
      source
    }
  });

  console.log(`Ingested ${success} records via ${connector}. Job ${jobId}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  await ingest({ connector: args.connector, source: args.source, dataset: args.dataset });
}

main().catch((error) => {
  console.error('Ingestion failed:', error);
  process.exit(1);
});
