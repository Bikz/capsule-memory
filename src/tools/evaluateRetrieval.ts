#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { CapsuleMemoryClient } from '../../packages/node/dist/index.js';

type DatasetSample = {
  id: string;
  prompt?: string;
  query: string;
  expected?: string;
  note?: string;
};

 type EvaluationOptions = {
  rewrite?: boolean;
  rerank?: boolean;
  limit?: number;
  recipe?: string;
};

 type EvaluationRecord = {
  id: string;
  query: string;
  prompt?: string;
  rewriteUsed: boolean;
  rerankUsed: boolean;
  latencyMs: number;
  results: Array<{ id: string; content: string; score?: number }>;
  hit: boolean | null;
  explanation: string;
};

const API_BASE = (process.env.CAPSULE_MEMORY_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.CAPSULE_API_KEY || 'demo-key';
const ORG_ID = process.env.CAPSULE_DEFAULT_ORG_ID || 'demo-org';
const PROJECT_ID = process.env.CAPSULE_DEFAULT_PROJECT_ID || 'demo-project';
const SUBJECT_ID = process.env.CAPSULE_DEFAULT_SUBJECT_ID || 'local-operator';

async function loadDataset(datasetPath: string): Promise<DatasetSample[]> {
  const resolved = path.resolve(process.cwd(), datasetPath);
  const raw = await fs.readFile(resolved, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error('Dataset must be an array');
  }
  return data.map((entry, index) => ({
    id: entry.id ?? String(index),
    prompt: entry.prompt,
    query: entry.query,
    expected: entry.expected,
    note: entry.note
  }));
}

function parseArgs(argv: string[]) {
  const args: EvaluationOptions & { dataset?: string; output?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--dataset':
      case '-d':
        args.dataset = argv[++i];
        break;
      case '--recipe':
      case '-r':
        args.recipe = argv[++i];
        break;
      case '--limit':
      case '-l':
        args.limit = Number.parseInt(argv[++i], 10);
        break;
      case '--rewrite':
        args.rewrite = true;
        break;
      case '--no-rewrite':
        args.rewrite = false;
        break;
      case '--rerank':
        args.rerank = true;
        break;
      case '--no-rerank':
        args.rerank = false;
        break;
      case '--output':
      case '-o':
        args.output = argv[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        break;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Capsule Adaptive Retrieval Eval\n\nUsage: tsx src/tools/evaluateRetrieval.ts --dataset datasets/sample.json [--rewrite] [--rerank]\n\nOptions:\n  --dataset, -d   Path to dataset JSON (required).\n  --recipe, -r    Search recipe (default: default-semantic).\n  --limit, -l     Top-k limit (default: recipe limit).\n  --rewrite       Force rewrite on (default honours server config).\n  --rerank        Force reranker on (default honours server config).\n  --output, -o    Path to write results JSON.\n`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dataset) {
    printHelp();
    process.exit(1);
  }

  const dataset = await loadDataset(args.dataset);
  const client = new CapsuleMemoryClient({
    baseUrl: API_BASE,
    apiKey: API_KEY,
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    defaultSubjectId: SUBJECT_ID
  });

  const results: EvaluationRecord[] = [];
  let hits = 0;
  let totalLatency = 0;

  for (const sample of dataset) {
    const start = performance.now();
    const response = await client.search({
      query: sample.query,
      prompt: sample.prompt,
      limit: args.limit,
      recipe: args.recipe
    });
    const typed = response as any;
    const latencyMs = performance.now() - start;
    totalLatency += latencyMs;

    const best = typed.results?.[0];
    const hit = sample.expected
      ? Boolean(best && best.content?.toLowerCase().includes(sample.expected.toLowerCase()))
      : null;
    if (hit) {
      hits += 1;
    }

    results.push({
      id: sample.id,
      query: sample.query,
      prompt: sample.prompt,
      rewriteUsed: (typed.explanation || '').includes('rewritten'),
      rerankUsed: (typed.explanation || '').includes('reranked'),
      latencyMs: Math.round(latencyMs),
      results: (typed.results || []).map((item: any) => ({
        id: item.id,
        content: item.content,
        score: item.recipeScore ?? item.score
      })),
      hit,
      explanation: typed.explanation
    });
  }

  const summary = {
    samples: dataset.length,
    hits,
    hitRate: dataset.filter((s) => s.expected).length > 0
      ? hits / dataset.filter((s) => s.expected).length
      : null,
    avgLatencyMs: dataset.length > 0 ? Math.round(totalLatency / dataset.length) : null,
    options: {
      recipe: args.recipe ?? 'default-semantic',
      limit: args.limit,
      rewrite: args.rewrite,
      rerank: args.rerank
    },
    results
  };

  if (args.output) {
    await fs.writeFile(path.resolve(process.cwd(), args.output), JSON.stringify(summary, null, 2));
    console.log(`Wrote summary to ${args.output}`);
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
}

run().catch((error) => {
  console.error('Evaluation failed:', error);
  process.exit(1);
});
