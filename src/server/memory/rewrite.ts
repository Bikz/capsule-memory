import { z } from 'zod';

const responseSchema = z.object({
  rewritten: z.string().optional(),
  context: z.object({}).passthrough().optional()
});

async function callRewriteEndpoint(prompt: string, query: string): Promise<string | null> {
  const endpoint = process.env.CAPSULE_REWRITER_URL;
  if (!endpoint) {
    return null;
  }

  const key = process.env.CAPSULE_REWRITER_KEY;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {})
    },
    body: JSON.stringify({ prompt, query })
  });

  if (!res.ok) {
    console.warn('[Capsule] Rewriter request failed:', res.status, await res.text());
    return null;
  }

  const payload = await res.json();
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.rewritten) {
    return null;
  }
  return parsed.data.rewritten;
}

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

export async function rewriteQuery(prompt: string, query: string): Promise<string | null> {
  const cached = getCachedRewrite(prompt, query);
  if (cached) {
    return cached;
  }

  let rewritten: string | null = null;

  if (process.env.CAPSULE_REWRITER_URL) {
    rewritten = await callRewriteEndpoint(prompt, query);
  }

  if (!rewritten && process.env.CAPSULE_USE_LOCAL_REWRITER !== 'false') {
    const lower = query.toLowerCase();
    if (lower.includes('latest') || lower.includes('recent')) {
      rewritten = `${query} sorted by most recent`; // naive fallback
    }
  }

  if (rewritten) {
    setCachedRewrite(prompt, query, rewritten);
  }

  return rewritten;
}
