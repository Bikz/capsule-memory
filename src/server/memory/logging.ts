import type { CapsuleAcl, CapsuleRetention, CapsuleSource, CapsuleStorageState } from './meta';
import type { SearchRecipe } from './recipes';

const POLICY_LOG_ENABLED = (process.env.CAPSULE_LOG_POLICIES ?? 'true').toLowerCase() !== 'false';
const RECIPE_LOG_ENABLED = (process.env.CAPSULE_LOG_RECIPES ?? 'true').toLowerCase() !== 'false';

type TenantScopeSummary = {
  orgId: string;
  projectId: string;
  subjectId?: string;
};

function baseEvent(event: string, scope: TenantScopeSummary) {
  return {
    event,
    timestamp: new Date().toISOString(),
    scope
  };
}

export function logPolicyDecision(params: {
  scope: TenantScopeSummary;
  storage: CapsuleStorageState;
  policies: string[];
  pinned: boolean;
  type?: string;
  tags?: string[];
  source?: CapsuleSource;
  acl: CapsuleAcl;
  retention?: CapsuleRetention;
  retentionAutoAssigned?: boolean;
  event?: string;
}) {
  if (!POLICY_LOG_ENABLED) {
    return;
  }

  const payload = {
    ...baseEvent(params.event ?? 'capsule.policy.decision', params.scope),
    storage: {
      store: params.storage.store,
      graphEnrich: params.storage.graphEnrich ?? false,
      dedupeThreshold: params.storage.dedupeThreshold ?? null
    },
    policies: params.policies,
    pinned: params.pinned,
    type: params.type ?? null,
    tags: params.tags ?? [],
    source: params.source ?? null,
    acl: params.acl.visibility,
    retention: params.retention ?? null,
    retentionAutoAssigned: params.retentionAutoAssigned ?? null
  };

  console.info(JSON.stringify(payload));
}

export function logRecipeUsage(params: {
  scope: TenantScopeSummary;
  recipe: SearchRecipe;
  limit: number;
  candidateLimit: number;
  resultCount: number;
  rewriteApplied?: boolean;
  rerankApplied?: boolean;
  rewriteLatencyMs?: number;
  rerankLatencyMs?: number;
  event?: string;
}) {
  if (!RECIPE_LOG_ENABLED) {
    return;
  }

  const payload = {
    ...baseEvent(params.event ?? 'capsule.recipe.usage', params.scope),
    recipe: params.recipe.name,
    limit: params.limit,
    candidateLimit: params.candidateLimit,
    resultCount: params.resultCount,
    rewriteApplied: params.rewriteApplied ?? false,
    rerankApplied: params.rerankApplied ?? false,
    rewriteLatencyMs: params.rewriteLatencyMs ?? null,
    rerankLatencyMs: params.rerankLatencyMs ?? null
  };

  console.info(JSON.stringify(payload));
}

export function logVectorMetrics(params: {
  scope: TenantScopeSummary;
  backend: string;
  latencyMs: number;
  cacheHit: boolean;
  candidateCount: number;
}) {
  const payload = {
    ...baseEvent('capsule.vector.metrics', params.scope),
    backend: params.backend,
    latencyMs: params.latencyMs,
    cacheHit: params.cacheHit,
    candidateCount: params.candidateCount
  };

  console.info(JSON.stringify(payload));
}
