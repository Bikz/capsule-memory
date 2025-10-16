#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { CapsuleMemoryClient } from '../packages/node/dist/index.js';

const DEFAULT_DATASET = 'capsule-bench.dataset.example.json';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--dataset' || value === '-d') {
      args.dataset = argv[i + 1];
      i += 1;
    } else if (value === '--recipe' || value === '-r') {
      args.recipe = argv[i + 1];
      i += 1;
    } else if (value === '--limit' || value === '-l') {
      args.limit = Number.parseInt(argv[i + 1], 10);
      i += 1;
    } else if (value === '--shadow-url') {
      args.shadowUrl = argv[i + 1];
      i += 1;
    } else if (value === '--output' || value === '-o') {
      args.output = argv[i + 1];
      i += 1;
    } else if (value === '--help' || value === '-h') {
      args.help = true;
    } else {
      args._.push(value);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Capsule Bench CLI\n\nUsage: pnpm run bench -- [--dataset FILE] [--recipe NAME] [--limit N] [--shadow-url URL]\n\nOptions:\n  --dataset, -d   Path to dataset JSON (default: ${DEFAULT_DATASET}).\n  --recipe, -r    Capsule recipe to evaluate (default: default-semantic).\n  --limit, -l     Top-k to request from Capsule (default: recipe's limit).\n  --shadow-url    Optional competitor endpoint to shadow (expects POST { query }).\n  --output, -o    Write summary JSON to a file.\n`);
}

async function loadDataset(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  const data = await fsPromises.readFile(resolved, 'utf8');
  const parsed = JSON.parse(data);
  if (!Array.isArray(parsed)) {
    throw new Error('Dataset must be an array of { query, expected? } objects');
  }
  return parsed.map((item, index) => {
    if (!item || typeof item.query !== 'string') {
      throw new Error(`Dataset entry ${index} is invalid (missing query string).`);
    }
    return {
      id: item.id ?? index,
      query: item.query,
      expected: typeof item.expected === 'string' ? item.expected : undefined
    };
  });
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

async function runShadow(url, query) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const text = await res.text();
    return {
      status: res.status,
      body: text
    };
  } catch (error) {
    return { status: 0, body: String(error) };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const datasetPath = args.dataset ?? DEFAULT_DATASET;
  const dataset = await loadDataset(datasetPath);

  const client = new CapsuleMemoryClient({
    baseUrl: process.env.CAPSULE_MEMORY_URL || 'http://localhost:3000',
    apiKey: process.env.CAPSULE_API_KEY || 'demo-key',
    orgId: process.env.CAPSULE_DEFAULT_ORG_ID || 'demo-org',
    projectId: process.env.CAPSULE_DEFAULT_PROJECT_ID || 'demo-project',
    defaultSubjectId: process.env.CAPSULE_DEFAULT_SUBJECT_ID || 'local-operator'
  });

  const recipe = args.recipe || 'default-semantic';
  const limit = Number.isFinite(args.limit) ? args.limit : undefined;
  const latencies = [];
  let hits = 0;

  const records = [];

  for (const sample of dataset) {
    const start = performance.now();
    const capsule = await client.search({ query: sample.query, recipe, limit });
    const durationMs = performance.now() - start;
    latencies.push(durationMs);

    if (sample.expected) {
      const normalized = sample.expected.toLowerCase();
      const hit = capsule.results?.some((item) => item.content?.toLowerCase().includes(normalized));
      if (hit) hits += 1;
    }

    let shadowResponse = null;
    if (args.shadowUrl) {
      shadowResponse = await runShadow(args.shadowUrl, sample.query);
    }

    records.push({
      id: sample.id,
      query: sample.query,
      latencyMs: Math.round(durationMs),
      topMemory: capsule.results?.[0]?.content ?? null,
      scores: capsule.results?.slice(0, 3).map((item) => ({
        id: item.id,
        score: item.recipeScore ?? item.score,
        graphHit: item.graphHit ?? false
      })),
      explanation: capsule.explanation,
      shadow: shadowResponse
    });

    console.info(
      JSON.stringify({
        event: 'capsule.bench.sample',
        id: sample.id,
        latencyMs: Math.round(durationMs),
        hit: sample.expected ? records.at(-1)?.scores?.length ?? 0 : undefined
      })
    );
  }

  const summary = {
    recipe,
    samples: dataset.length,
    latency: {
      avgMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
      p95Ms: Math.round(percentile(latencies, 95)),
      maxMs: Math.round(Math.max(...latencies))
    },
    accuracy: dataset.some((item) => item.expected)
      ? hits / dataset.filter((item) => item.expected).length
      : null,
    records
  };

  if (args.output) {
    const resolved = path.resolve(process.cwd(), args.output);
    await fsPromises.writeFile(resolved, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(`Wrote results to ${resolved}`);
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
}

main().catch((error) => {
  console.error('Capsule Bench failed:', error);
  process.exit(1);
});
