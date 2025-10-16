import fs from 'node:fs';
import path from 'node:path';

const ADAPTIVE_CONFIG_PATH = process.env.CAPSULE_ADAPTIVE_CONFIG || path.resolve(process.cwd(), 'config/adaptive.json');

type RewriteConfig = {
  enabled: boolean;
  minQueryLength: number;
  latencyBudgetMs: number;
};

type RerankConfig = {
  enabled: boolean;
  maxResults: number;
  latencyBudgetMs: number;
};

type AdaptiveConfig = {
  rewrite: RewriteConfig;
  rerank: RerankConfig;
};

const DEFAULT_CONFIG: AdaptiveConfig = {
  rewrite: {
    enabled: true,
    minQueryLength: 8,
    latencyBudgetMs: 350
  },
  rerank: {
    enabled: true,
    maxResults: 50,
    latencyBudgetMs: 500
  }
};

let cachedConfig: AdaptiveConfig | null = null;

function loadConfig(): AdaptiveConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  try {
    if (fs.existsSync(ADAPTIVE_CONFIG_PATH)) {
      const raw = fs.readFileSync(ADAPTIVE_CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      cachedConfig = {
        rewrite: {
          enabled: parsed?.rewrite?.enabled ?? DEFAULT_CONFIG.rewrite.enabled,
          minQueryLength: parsed?.rewrite?.minQueryLength ?? DEFAULT_CONFIG.rewrite.minQueryLength,
          latencyBudgetMs: parsed?.rewrite?.latencyBudgetMs ?? DEFAULT_CONFIG.rewrite.latencyBudgetMs
        },
        rerank: {
          enabled: parsed?.rerank?.enabled ?? DEFAULT_CONFIG.rerank.enabled,
          maxResults: parsed?.rerank?.maxResults ?? DEFAULT_CONFIG.rerank.maxResults,
          latencyBudgetMs: parsed?.rerank?.latencyBudgetMs ?? DEFAULT_CONFIG.rerank.latencyBudgetMs
        }
      };
      return cachedConfig;
    }
  } catch (error) {
    console.warn('[Capsule] Failed to load adaptive retrieval config:', error);
  }
  cachedConfig = DEFAULT_CONFIG;
  return cachedConfig;
}

export function shouldRewrite(query: string, elapsedLatencyMs: number): boolean {
  const config = loadConfig();
  const envOverride = process.env.CAPSULE_REWRITE_ENABLED;
  const enabled = envOverride != null ? envOverride !== 'false' : config.rewrite.enabled;
  if (!enabled) {
    return false;
  }
  if (query.length < config.rewrite.minQueryLength) {
    return false;
  }
  if (elapsedLatencyMs > config.rewrite.latencyBudgetMs) {
    return false;
  }
  return true;
}

export function shouldRerank(candidateCount: number, totalLatencyMs: number): boolean {
  const config = loadConfig();
  const envOverride = process.env.CAPSULE_RERANK_ENABLED;
  const enabled = envOverride != null ? envOverride !== 'false' : config.rerank.enabled;
  if (!enabled) {
    return false;
  }
  if (candidateCount === 0 || candidateCount > config.rerank.maxResults) {
    return false;
  }
  if (totalLatencyMs > config.rerank.latencyBudgetMs) {
    return false;
  }
  return true;
}
