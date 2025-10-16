#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { CapsuleMemoryClient } from '../packages/node/dist/index.js';

const DEFAULT_CONFIG_FILENAME = 'capsule-router.config.json';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--config' || value === '-c') {
      args.config = argv[i + 1];
      i += 1;
    } else if (value === '--init') {
      args.init = true;
    } else if (value === '--help' || value === '-h') {
      args.help = true;
    } else {
      args._.push(value);
    }
  }
  return args;
}

function printHelp() {
  const help = `Capsule Router
Usage: pnpm run router -- [--config file] [--init]

Options:
  --init            Create a sample ${DEFAULT_CONFIG_FILENAME} in the current directory.
  --config FILE     Path to the router config (default: ${DEFAULT_CONFIG_FILENAME}).
  --help            Show this message.

The router acts as a lightweight proxy that enriches requests with Capsule Memory search results
before forwarding them to your upstream service.`;
  console.log(help);
}

const SAMPLE_CONFIG = {
  port: 8787,
  upstream: {
    url: 'http://localhost:11434/api/generate',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  },
  memory: {
    baseUrl: process.env.CAPSULE_MEMORY_URL || 'http://localhost:3000',
    apiKey: process.env.CAPSULE_API_KEY || 'demo-key',
    orgId: process.env.CAPSULE_DEFAULT_ORG_ID || 'demo-org',
    projectId: process.env.CAPSULE_DEFAULT_PROJECT_ID || 'demo-project',
    subjectId: process.env.CAPSULE_DEFAULT_SUBJECT_ID || 'local-operator',
    recipe: 'conversation-memory',
    limit: 5
  }
};

async function initConfig(configPath) {
  const resolved = path.resolve(process.cwd(), configPath ?? DEFAULT_CONFIG_FILENAME);
  if (fs.existsSync(resolved)) {
    console.error(`Config already exists at ${resolved}. Aborting.`);
    process.exit(1);
  }
  await fsPromises.writeFile(resolved, `${JSON.stringify(SAMPLE_CONFIG, null, 2)}\n`, 'utf8');
  console.log(`Created sample router config at ${resolved}. Update it with your upstream + Capsule credentials.`);
}

function loadConfig(configPath) {
  const resolved = path.resolve(process.cwd(), configPath ?? DEFAULT_CONFIG_FILENAME);
  if (!fs.existsSync(resolved)) {
    console.error(`Router config not found at ${resolved}. Use --init to scaffold one.`);
    process.exit(1);
  }
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.memory || !parsed.upstream) {
      throw new Error('Config must include memory and upstream blocks.');
    }
    return { path: resolved, config: parsed };
  } catch (error) {
    console.error(`Failed to parse config at ${resolved}:`, error);
    process.exit(1);
  }
}

function createMemoryClient(config) {
  const memory = config.memory;
  return new CapsuleMemoryClient({
    baseUrl: memory.baseUrl,
    apiKey: memory.apiKey,
    orgId: memory.orgId,
    projectId: memory.projectId,
    defaultSubjectId: memory.subjectId
  });
}

function buildServer({ config, configPath }) {
  const memoryClient = createMemoryClient(config);
  const port = config.port ?? 8787;
  const recipe = config.memory.recipe ?? 'default-semantic';
  const limit = Number.isFinite(config.memory.limit) ? config.memory.limit : 5;
  const upstreamUrl = new URL(config.upstream.url);
  const upstreamMethod = (config.upstream.method || 'POST').toUpperCase();
  const upstreamHeaders = config.upstream.headers || {};

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Only POST is supported' }));
      return;
    }

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));

    req.on('end', async () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const payload = raw ? JSON.parse(raw) : {};
        const prompt = payload.prompt || payload.input || payload.query;
        if (!prompt || typeof prompt !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body must include a prompt string.' }));
          return;
        }

        const subjectId = payload.subjectId || config.memory.subjectId;
        const start = performance.now();
        const search = await memoryClient.search({
          query: prompt,
          limit,
          recipe,
          prompt,
          subjectId
        });
        const durationMs = performance.now() - start;

        const mappedMemories = (search.results || []).map((item) => ({
          id: item.id,
          content: item.content,
          score: typeof item.recipeScore === 'number' ? item.recipeScore : item.score,
          tags: item.tags,
          pinned: item.pinned,
          metadata: {
            createdAt: item.createdAt,
            importanceScore: item.importanceScore,
            recencyScore: item.recencyScore,
            storage: item.storage,
            acl: item.acl,
            graphHit: item.graphHit ?? false
          }
        }));

        const enrichedPayload = {
          ...payload,
          prompt,
          capsule: {
            recipe,
            explanation: search.explanation,
            latencyMs: Math.round(durationMs),
            results: mappedMemories
          }
        };

        const upstreamResponse = await fetch(upstreamUrl.toString(), {
          method: upstreamMethod,
          headers: {
            ...upstreamHeaders,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(enrichedPayload)
        });

        const text = await upstreamResponse.text();
        res.writeHead(upstreamResponse.status, Object.fromEntries(upstreamResponse.headers));
        res.end(text);

        console.info(
          JSON.stringify({
            event: 'capsule.router.request',
            promptPreview: prompt.slice(0, 80),
            memoryResults: mappedMemories.length,
            memoryLatencyMs: Math.round(durationMs),
            recipe
          })
        );
      } catch (error) {
        console.error('Router error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Router failure', details: error.message }));
      }
    });
  });

  server.listen(port, () => {
    console.log(`Capsule Router listening on http://localhost:${port}`);
    console.log(`Loaded config from ${configPath}`);
    console.log(`Forwarding to ${upstreamUrl.toString()} with recipe ${recipe}`);
  });

  return server;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (args.init) {
    await initConfig(args.config);
    process.exit(0);
  }
  const { config, path: configPath } = loadConfig(args.config);
  buildServer({ config, configPath });
}

main().catch((error) => {
  console.error('Fatal router error:', error);
  process.exit(1);
});
