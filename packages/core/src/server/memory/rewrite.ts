import { z } from 'zod';

import { jsonServiceFetch } from './serviceClient';

const responseSchema = z.object({
  rewritten: z.string().optional(),
  context: z.object({}).passthrough().optional()
});

const simpleRewriteCache = new Map<string, { rewritten: string; expiresAt: number }>();
const CACHE_TTL_MS = Number.parseInt(process.env.CAPSULE_REWRITER_TTL ?? '30000', 10);
const CACHE_SIZE = Number.parseInt(process.env.CAPSULE_REWRITER_CACHE ?? '50', 10);

function getCacheKey(prompt: string, query: string): string {
  return JSON.stringify({ prompt, query });
}

function getCachedRewrite(prompt: string, query: string): string | null {
  const key = getCacheKey(prompt, query);
  const entry = simpleRewriteCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    simpleRewriteCache.delete(key);
    return null;
  }
  return entry.rewritten;
}

function setCachedRewrite(prompt: string, query: string, rewritten: string) {
  const key = getCacheKey(prompt, query);
  if (simpleRewriteCache.size >= CACHE_SIZE) {
    const oldestKey = simpleRewriteCache.keys().next().value;
    if (oldestKey) {
      simpleRewriteCache.delete(oldestKey);
    }
  }
  simpleRewriteCache.set(key, { rewritten, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function callRewriteEndpoint(prompt: string, query: string) {
  const endpoint = process.env.CAPSULE_REWRITER_URL;
  if (!endpoint) {
    return { rewritten: null, latencyMs: 0 };
  }

  const key = process.env.CAPSULE_REWRITER_KEY;
  const result = await jsonServiceFetch(endpoint, {
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    body: { prompt, query }
  });

  if (!result.ok || !result.data) {
    return { rewritten: null, latencyMs: result.latencyMs };
  }

  const parsed = responseSchema.safeParse(result.data);
  if (!parsed.success || !parsed.data.rewritten) {
    return { rewritten: null, latencyMs: result.latencyMs };
  }

  return { rewritten: parsed.data.rewritten, latencyMs: result.latencyMs };
}

export async function rewriteQuery(prompt: string, query: string): Promise<{
  rewritten: string | null;
  latencyMs: number;
}> {
  const cached = getCachedRewrite(prompt, query);
  if (cached) {
    return { rewritten: cached, latencyMs: 0 };
  }

  let latencyMs = 0;
  let rewritten: string | null = null;

  if (process.env.CAPSULE_REWRITER_URL) {
    const result = await callRewriteEndpoint(prompt, query);
    latencyMs = result.latencyMs;
    rewritten = result.rewritten;
  }

  if (!rewritten && process.env.CAPSULE_USE_LOCAL_REWRITER !== 'false') {
    const lower = query.toLowerCase();
    if (lower.includes('latest') || lower.includes('recent')) {
      rewritten = `${query} sorted by most recent`;
    }
  }

  if (rewritten) {
    setCachedRewrite(prompt, query, rewritten);
  }

  return { rewritten, latencyMs };
}
