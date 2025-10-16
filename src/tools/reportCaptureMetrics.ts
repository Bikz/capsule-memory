#!/usr/bin/env tsx
import { performance } from 'node:perf_hooks';

const BASE_URL = (process.env.CAPSULE_MEMORY_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.CAPSULE_API_KEY || process.env.X_CAPSULE_KEY || 'demo-key';
const ORG_ID = process.env.CAPSULE_DEFAULT_ORG_ID || 'demo-org';
const PROJECT_ID = process.env.CAPSULE_DEFAULT_PROJECT_ID || 'demo-project';
const SUBJECT_ID = process.env.CAPSULE_DEFAULT_SUBJECT_ID || 'local-operator';

const DEFAULT_STATUSES = ['pending', 'approved', 'rejected', 'ignored'] as const;

type Status = (typeof DEFAULT_STATUSES)[number];

type Args = {
  statuses: Status[];
  limit: number;
  subjectId?: string;
  json: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    statuses: [...DEFAULT_STATUSES],
    limit: 200,
    json: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--statuses':
      case '-s': {
        const value = argv[++i];
        if (!value) break;
        const parts = value.split(',').map((part) => part.trim() as Status).filter(Boolean);
        if (parts.length > 0) args.statuses = parts;
        break;
      }
      case '--limit':
      case '-l':
        args.limit = Number.parseInt(argv[++i], 10) || args.limit;
        break;
      case '--subject':
        args.subjectId = argv[++i];
        break;
      case '--json':
        args.json = true;
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

function printHelp(): void {
  console.log(`Capsule Capture Metrics\n\nUsage: pnpm run report:capture -- [--statuses pending,approved] [--limit 200] [--json]\n`);
}

async function callApi(path: string): Promise<any> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-Capsule-Key': API_KEY,
      'X-Capsule-Org': ORG_ID,
      'X-Capsule-Project': PROJECT_ID,
      'X-Capsule-Subject': SUBJECT_ID
    }
  });
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${await res.text()}`);
  const payload = await res.json();
  return 'data' in payload ? payload.data : payload;
}

async function fetchStatus(status: Status, limit: number, subjectId?: string) {
  const params = new URLSearchParams();
  params.set('status', status);
  if (limit) params.set('limit', String(limit));
  if (subjectId) params.set('subjectId', subjectId);
  const start = performance.now();
  const data = await callApi(`/v1/memories/capture?${params.toString()}`);
  const duration = performance.now() - start;
  return { status, duration, items: data.items ?? [] };
}

function computeMetrics(entries: Array<{ score: number; recommended: boolean; threshold: number }>) {
  if (entries.length === 0) {
    return {
      count: 0,
      avgScore: 0,
      recommendedRate: 0
    };
  }
  const totalScore = entries.reduce((sum, entry) => sum + entry.score, 0);
  const recommended = entries.filter((entry) => entry.recommended).length;
  return {
    count: entries.length,
    avgScore: Number((totalScore / entries.length).toFixed(3)),
    recommendedRate: Number((recommended / entries.length).toFixed(3))
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const subjectId = args.subjectId ?? SUBJECT_ID;
  const sections = [] as Array<{ status: Status; duration: number; metrics: ReturnType<typeof computeMetrics> }>;
  for (const status of args.statuses) {
    const { items, duration } = await fetchStatus(status, args.limit, subjectId);
    const metrics = computeMetrics(items.map((item: any) => ({
      score: item.score ?? 0,
      recommended: Boolean(item.recommended),
      threshold: item.threshold ?? 0
    })));
    sections.push({ status, duration, metrics });
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          baseUrl: BASE_URL,
          orgId: ORG_ID,
          projectId: PROJECT_ID,
          subjectId,
          sections
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`Capsule capture metrics (subject=${subjectId})`);
  for (const section of sections) {
    const { status, duration, metrics } = section;
    console.log(`\nStatus: ${status}`);
    console.log(`  count: ${metrics.count}`);
    console.log(`  avgScore: ${metrics.avgScore}`);
    console.log(`  recommended rate: ${(metrics.recommendedRate * 100).toFixed(1)}%`);
    console.log(`  fetched in ${duration.toFixed(0)}ms`);
  }
}

run().catch((error) => {
  console.error('Capture metrics failed:', error);
  process.exit(1);
});
