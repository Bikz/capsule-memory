import { performance } from 'node:perf_hooks';
import { Module, ObjectId, type RouteDefinition, type RouteParams } from 'modelence/server';
import { z } from 'zod';

import { dbMemories, EMBEDDING_DIMENSIONS } from './db';
import {
  CapsuleAcl,
  CapsulePiiFlags,
  CapsuleSource,
  CapsuleStorageState,
  StorageDestination,
  computeImportanceScore,
  computeRecencyScore,
  createProvenanceEvent,
  resolveAcl,
  resolveLanguage,
  resolvePiiFlags,
  resolveSource,
  resolveTypeValue
} from './meta';
import {
  defaultStoragePolicies,
  evaluateStoragePolicies,
  listStoragePolicySummaries
} from './policies';
import { decryptPiiFlags, encryptPiiFlags } from './security';
import type { SearchRecipe } from './recipes';
import {
  applyRecipeWeight,
  describeRecipeMatch,
  getSearchRecipe,
  listSearchRecipes as listRecipeCatalog
} from './recipes';
import { scheduleGraphJob, startGraphWorker, expandResultsViaGraph } from './graph';
import { dbGraphEntities, dbGraphJobs } from './graphDb';
import { logPolicyDecision, logRecipeUsage, logVectorMetrics } from './logging';
import { generateEmbedding } from './voyage';

type MemoryDocument = typeof dbMemories.Doc;

type TenantScope = {
  orgId: string;
  projectId: string;
  subjectId: string;
};

type RetentionResult = {
  explanation: string;
  forgottenMemoryId: string | null;
};

type StorageConfigInput = {
  store?: StorageDestination;
  graphEnrich?: boolean | null;
  dedupeThreshold?: number | null;
};

type CreateMemoryInput = {
  content: string;
  pinned?: boolean;
  tags?: string[];
  ttlSeconds?: number;
  idempotencyKey?: string;
  type?: string;
  lang?: string;
  importanceScore?: number;
  recencyScore?: number;
  source?: CapsuleSource | null;
  acl?: CapsuleAcl | null;
  piiFlags?: CapsulePiiFlags | null;
  storage?: StorageConfigInput | null;
};

type UpdateMemoryInput = {
  pinned?: boolean;
  tags?: string[] | null;
  ttlSeconds?: number | null;
  type?: string | null;
  lang?: string | null;
  importanceScore?: number | null;
  recencyScore?: number | null;
  source?: CapsuleSource | null;
  acl?: CapsuleAcl | null;
  piiFlags?: CapsulePiiFlags | null;
  storage?: StorageConfigInput | null;
};

type MemoryListFilters = {
  limit?: number;
  pinned?: boolean;
  tag?: string;
  type?: string;
  visibility?: CapsuleAcl['visibility'];
  store?: StorageDestination;
  graphEnrich?: boolean;
};

const MAX_MEMORIES = Number.parseInt(process.env.CAPSULE_MAX_MEMORIES ?? '100', 10);

const DEFAULT_TENANT: TenantScope = {
  orgId: process.env.CAPSULE_DEFAULT_ORG_ID ?? 'demo-org',
  projectId: process.env.CAPSULE_DEFAULT_PROJECT_ID ?? 'demo-project',
  subjectId: process.env.CAPSULE_DEFAULT_SUBJECT_ID ?? 'local-operator'
};

const tenantArgSchema = z.object({
  orgId: z.string().min(1, 'orgId is required').optional(),
  projectId: z.string().min(1, 'projectId is required').optional(),
  subjectId: z.string().min(1, 'subjectId is required').optional()
});

const visibilitySchema = z.enum(['private', 'shared', 'public']);

const sourceSchema = z
  .object({
    app: z.string().min(1).optional(),
    connector: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    fileId: z.string().min(1).optional(),
    spanId: z.string().min(1).optional()
  })
  .partial()
  .refine((value) => Object.values(value).some((entry) => typeof entry === 'string' && entry.trim().length > 0), {
    message: 'source must include at least one populated field'
  });

const aclSchema = z.object({
  visibility: visibilitySchema
});

const storageDestinationSchema = z.enum(['short_term', 'long_term', 'capsule_graph']);

const storageInputSchema = z
  .object({
    store: storageDestinationSchema.nullish(),
    graphEnrich: z.boolean().nullish(),
    dedupeThreshold: z.number().min(0).max(1).nullish()
  })
  .nullish();

const recipeNameSchema = z.enum([
  'default-semantic',
  'conversation-memory',
  'knowledge-qa',
  'audit-trace'
]);

const recipeDefinitionSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  limit: z.number().int().positive().max(50),
  candidateLimit: z.number().int().positive().max(2000),
  filters: z
    .object({
      pinnedOnly: z.boolean().optional(),
      graphEnrich: z.boolean().optional(),
      types: z.array(z.string().min(1)).optional()
    })
    .optional(),
  scoring: z.object({
    semanticWeight: z.number(),
    importanceWeight: z.number().optional(),
    recencyWeight: z.number().optional(),
    pinnedBoost: z.number().optional()
  })
});

const recipePreviewSchema = tenantArgSchema.extend({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).optional(),
  recipe: recipeDefinitionSchema
});

const policyPreviewSchema = tenantArgSchema.extend({
  type: z.string().min(1).nullish(),
  tags: z.array(z.string().min(1)).optional(),
  pinned: z.boolean().optional(),
  source: sourceSchema.nullish(),
  acl: aclSchema.nullish()
});

const metadataCreateFields = {
  type: z.string().min(1).nullish(),
  lang: z.string().min(2).max(8).nullish(),
  importanceScore: z.number().min(0).max(5).nullish(),
  recencyScore: z.number().min(0).max(5).nullish(),
  source: sourceSchema.nullish(),
  acl: aclSchema.nullish(),
  piiFlags: z.record(z.string(), z.boolean()).nullish()
};

const createMemorySchema = tenantArgSchema.extend({
  content: z.string().min(1),
  pinned: z.boolean().optional(),
  tags: z.array(z.string().min(1)).optional(),
  ttlSeconds: z
    .number()
    .int()
    .positive()
    .max(60 * 60 * 24 * 365, 'ttlSeconds must be less than or equal to one year in seconds')
    .optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  ...metadataCreateFields,
  storage: storageInputSchema
});

const updateMemorySchema = tenantArgSchema.extend({
  id: z.string().min(1),
  pinned: z.boolean().optional(),
  tags: z.array(z.string().min(1)).nullable().optional(),
  ttlSeconds: z
    .number()
    .int()
    .nonnegative()
    .max(60 * 60 * 24 * 365)
    .nullable()
    .optional(),
  ...metadataCreateFields,
  storage: storageInputSchema
});

const pinMemorySchema = tenantArgSchema.extend({
  id: z.string().min(1),
  pin: z.boolean().optional()
});

const listMemoriesSchema = tenantArgSchema.extend({
  limit: z.number().int().positive().max(200).optional(),
  pinned: z.boolean().optional(),
  tag: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  visibility: visibilitySchema.optional(),
  store: storageDestinationSchema.optional(),
  graphEnrich: z.boolean().optional()
});

const searchMemorySchema = tenantArgSchema.extend({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).optional(),
  recipe: recipeNameSchema.optional()
});

const deleteMemorySchema = tenantArgSchema.extend({
  id: z.string().min(1),
  reason: z.string().optional()
});

const PROVISIONING_HINT =
  'Memory store is not provisioned yet. Configure a MongoDB connection (e.g., MONGO_URL) and restart the server.';

const API_KEY_HEADER = 'x-capsule-key';
const AUTHORIZATION_HEADER = 'authorization';
const ORG_HEADER = 'x-capsule-org';
const PROJECT_HEADER = 'x-capsule-project';
const SUBJECT_HEADER = 'x-capsule-subject';
const IDEMPOTENCY_HEADER = 'idempotency-key';

const ALLOWED_API_KEYS = (process.env.CAPSULE_API_KEYS ?? 'demo-key')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

class HotsetCache<T> {
  #entries: Map<string, { value: T; expiresAt: number }> = new Map();
  constructor(private readonly maxEntries: number, private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T) {
    this.#entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    if (this.#entries.size > this.maxEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey) {
        this.#entries.delete(oldestKey);
      }
    }
  }
}

const VECTOR_BACKEND = (process.env.CAPSULE_VECTOR_STORE ?? 'mongo').toLowerCase();
const HOTSET_CACHE = new HotsetCache<MemoryDocument[]>(
  Number.parseInt(process.env.CAPSULE_HOTSET_SIZE ?? '50', 10),
  Number.parseInt(process.env.CAPSULE_HOTSET_TTL ?? '30000', 10)
);

async function fetchCandidates(scope: TenantScope, filter: Record<string, unknown>, limit: number) {
  if (VECTOR_BACKEND === 'pgvector') {
    console.warn('[Capsule] pgvector backend selected but not yet implemented. Falling back to MongoDB fetch.');
  } else if (VECTOR_BACKEND === 'qdrant') {
    console.warn('[Capsule] Qdrant backend selected but not yet implemented. Falling back to MongoDB fetch.');
  }

  return dbMemories.fetch(filter, {
    sort: { createdAt: -1 },
    limit
  });
}

startGraphWorker();

function ensureTenant(
  input: z.infer<typeof tenantArgSchema>,
  { allowFallback }: { allowFallback: boolean }
): TenantScope {
  const orgId = input.orgId ?? (allowFallback ? DEFAULT_TENANT.orgId : undefined);
  const projectId = input.projectId ?? (allowFallback ? DEFAULT_TENANT.projectId : undefined);
  const subjectId = input.subjectId ?? (allowFallback ? DEFAULT_TENANT.subjectId : undefined);

  if (!orgId || !projectId || !subjectId) {
    throw new Error('Missing tenancy context. Provide orgId, projectId, and subjectId.');
  }

  return { orgId, projectId, subjectId };
}

function memoryScopeFilter(scope: TenantScope) {
  return {
    orgId: scope.orgId,
    projectId: scope.projectId,
    subjectId: scope.subjectId
  } as const;
}

function computeNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function normalizeEmbedding(vector: number[]): { embedding: number[]; norm: number } {
  const norm = computeNorm(vector);
  if (norm === 0) {
    return {
      embedding: [...vector],
      norm: 0
    };
  }

  return {
    embedding: vector.map((value) => value / norm),
    norm
  };
}

function cosineSimilarity(
  queryVector: number[],
  queryNorm: number,
  docVector: number[],
  docNorm: number
): number {
  if (docVector.length !== EMBEDDING_DIMENSIONS || queryVector.length !== EMBEDDING_DIMENSIONS) {
    const minLength = Math.min(queryVector.length, docVector.length);
    let dot = 0;
    for (let i = 0; i < minLength; i += 1) {
      dot += queryVector[i] * docVector[i];
    }
    return minLength === 0 ? 0 : dot / minLength;
  }

  let dot = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i += 1) {
    dot += queryVector[i] * docVector[i];
  }

  const denom = queryNorm * (docNorm === 0 ? computeNorm(docVector) : docNorm);

  if (denom === 0) {
    return 0;
  }

  return dot / denom;
}

function toClientMemory(doc: MemoryDocument) {
  const { embedding, embeddingNorm, _id, piiFlagsCipher, ...rest } = doc as MemoryDocument & {
    embeddingModel?: string;
    provenance?: unknown;
    lang?: string;
    importanceScore?: number;
    recencyScore?: number;
    acl?: CapsuleAcl;
  };
  const pinnedValue = (rest as { pinned: boolean }).pinned;
  const importanceScore =
    typeof rest.importanceScore === 'number'
      ? rest.importanceScore
      : computeImportanceScore(pinnedValue);
  const recencyScore =
    typeof rest.recencyScore === 'number'
      ? rest.recencyScore
      : computeRecencyScore();
  const aclValue = rest.acl ?? resolveAcl(null);
  const langValue =
    typeof rest.lang === 'string' && rest.lang
      ? rest.lang
      : resolveLanguage((rest as { content: string }).content ?? '', null);
  const provenanceValue = Array.isArray(rest.provenance) ? rest.provenance : [];
  const embeddingModelValue =
    typeof rest.embeddingModel === 'string' && rest.embeddingModel
      ? rest.embeddingModel
      : 'unknown';
  const storageValue: CapsuleStorageState =
    rest.storage && typeof rest.storage === 'object'
      ? (rest.storage as CapsuleStorageState)
      : {
          store: 'long_term',
          policies: []
        };
  const graphEnrichValue =
    typeof (rest as { graphEnrich?: unknown }).graphEnrich === 'boolean'
      ? (rest as { graphEnrich?: boolean }).graphEnrich
      : storageValue.graphEnrich ?? false;
  const piiFlagsValue =
    rest.piiFlags && typeof rest.piiFlags === 'object'
      ? (rest.piiFlags as CapsulePiiFlags)
      : decryptPiiFlags(piiFlagsCipher);
  return {
    id: _id.toString(),
    ...rest,
    lang: langValue,
    importanceScore,
    recencyScore,
    acl: aclValue,
    provenance: provenanceValue,
    embeddingModel: embeddingModelValue,
    storage: storageValue,
    graphEnrich: graphEnrichValue,
    ...(piiFlagsValue ? { piiFlags: piiFlagsValue } : {})
  };
}

function toObjectId(id: string): ObjectId {
  return new ObjectId(id);
}

function isProvisioningError(error: unknown): error is Error {
  return error instanceof Error && /not provisioned/i.test(error.message ?? '');
}

function sanitizeTags(tags?: string[] | null): string[] | undefined {
  if (!tags || tags.length === 0) {
    return undefined;
  }
  const unique = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
  return unique.length > 0 ? unique : undefined;
}

function hasSensitivePii(piiFlags?: CapsulePiiFlags | null): boolean {
  if (!piiFlags) {
    return false;
  }
  return Object.values(piiFlags).some((value) => value === true);
}

function resolveStoredPiiFlags(doc?: MemoryDocument | null): CapsulePiiFlags | undefined {
  if (!doc) {
    return undefined;
  }
  if (doc.piiFlags && typeof doc.piiFlags === 'object') {
    return doc.piiFlags as CapsulePiiFlags;
  }
  return decryptPiiFlags((doc as { piiFlagsCipher?: string }).piiFlagsCipher);
}

function sanitizeLanguageOverride(lang?: string | null): string | undefined {
  if (lang === null || lang === undefined) {
    return undefined;
  }
  const trimmed = lang.trim().toLowerCase();
  if (trimmed.length < 2 || trimmed.length > 8) {
    return undefined;
  }
  return trimmed;
}

function computeExpirationDate(createdAt: Date, ttlSeconds?: number | null): Date | undefined {
  if (!ttlSeconds || ttlSeconds <= 0) {
    return undefined;
  }
  return new Date(createdAt.getTime() + ttlSeconds * 1000);
}

function buildRecipeFromDefinition(definition: z.infer<typeof recipeDefinitionSchema>): SearchRecipe {
  const coercedName = definition.name as unknown as SearchRecipe['name'];
  return {
    name: coercedName,
    label: definition.label,
    description: definition.description,
    limit: definition.limit,
    candidateLimit: definition.candidateLimit,
    filters: definition.filters
      ? {
          ...(definition.filters.pinnedOnly !== undefined
            ? { pinnedOnly: definition.filters.pinnedOnly }
            : {}),
          ...(definition.filters.graphEnrich !== undefined
            ? { graphEnrich: definition.filters.graphEnrich }
            : {}),
          ...(definition.filters.types ? { types: definition.filters.types } : {})
        }
      : undefined,
    scoring: {
      semanticWeight: definition.scoring.semanticWeight,
      ...(definition.scoring.importanceWeight !== undefined
        ? { importanceWeight: definition.scoring.importanceWeight }
        : {}),
      ...(definition.scoring.recencyWeight !== undefined
        ? { recencyWeight: definition.scoring.recencyWeight }
        : {}),
      ...(definition.scoring.pinnedBoost !== undefined
        ? { pinnedBoost: definition.scoring.pinnedBoost }
        : {})
    }
  };
}

async function executeRecipeSearch(
  scope: TenantScope,
  recipe: SearchRecipe,
  queryString: string,
  explicitLimit?: number,
  logEvent: 'capsule.recipe.usage' | 'capsule.recipe.preview' = 'capsule.recipe.usage'
) {
  const limitValue = explicitLimit && explicitLimit > 0 ? explicitLimit : recipe.limit;
  const candidateLimit = Math.max(recipe.candidateLimit, limitValue * 5);

  const queryEmbeddingResult = await generateEmbedding(queryString, 'query');
  const queryEmbedding = normalizeEmbedding(queryEmbeddingResult.embedding);

  const fetchFilter: Record<string, unknown> = { ...memoryScopeFilter(scope) };
  if (recipe.filters?.pinnedOnly) {
    fetchFilter.pinned = true;
  }
  if (typeof recipe.filters?.graphEnrich === 'boolean') {
    fetchFilter.graphEnrich = recipe.filters.graphEnrich;
  }
  if (recipe.filters?.types && recipe.filters.types.length > 0) {
    fetchFilter.type = { $in: recipe.filters.types };
  }

  const filterSignature = {
    pinned: recipe.filters?.pinnedOnly ?? null,
    graph: recipe.filters?.graphEnrich ?? null,
    types: recipe.filters?.types ?? []
  };
  const cacheKey = JSON.stringify({ orgId: scope.orgId, projectId: scope.projectId, filterSignature, limit: candidateLimit });

  let cacheHit = false;
  let candidates: MemoryDocument[];
  const vectorStart = performance.now();

  if (VECTOR_BACKEND === 'mongo') {
    const cached = HOTSET_CACHE.get(cacheKey);
    if (cached) {
      cacheHit = true;
      candidates = [...cached];
    } else {
      candidates = await fetchCandidates(scope, fetchFilter, candidateLimit);
      HOTSET_CACHE.set(cacheKey, candidates);
    }
  } else {
    candidates = await fetchCandidates(scope, fetchFilter, candidateLimit);
  }

  const vectorLatency = performance.now() - vectorStart;
  logVectorMetrics({
    scope,
    backend: VECTOR_BACKEND,
    latencyMs: Math.round(vectorLatency),
    cacheHit,
    candidateCount: candidates.length
  });

  let results: Array<ReturnType<typeof toClientMemory> & { score: number; recipeScore: number; graphHit?: boolean }> = candidates
    .map((doc) => {
      const semanticScore = cosineSimilarity(
        queryEmbedding.embedding,
        queryEmbedding.norm,
        doc.embedding,
        doc.embeddingNorm
      );
      const weightedScore = applyRecipeWeight(
        semanticScore,
        {
          pinned: doc.pinned,
          importanceScore: doc.importanceScore,
          recencyScore: doc.recencyScore,
          storage: doc.storage
        },
        recipe.scoring
      );
      return {
        doc,
        semanticScore,
        weightedScore
      };
    })
    .filter((entry) => Number.isFinite(entry.weightedScore))
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, limitValue)
    .map(({ doc, weightedScore, semanticScore }) => ({
      ...toClientMemory(doc),
      score: semanticScore,
      recipeScore: weightedScore,
      graphHit: false
    }));

  const seenIds = new Set(results.map((item) => item.id));

  if (recipe.graphExpand) {
    const expansions = await expandResultsViaGraph({
      orgId: scope.orgId,
      projectId: scope.projectId,
      baseMemoryIds: Array.from(seenIds),
      excludeIds: seenIds,
      limit: recipe.graphExpand.limit
    });
    if (expansions.length > 0) {
      const expansionItems = expansions.map((doc) => ({
        ...toClientMemory(doc),
        score: 0,
        recipeScore: 0,
        graphHit: true
      }));
      results = [...results, ...expansionItems];
      for (const expansion of expansionItems) {
        seenIds.add(expansion.id);
      }
    }
  }

  const explanation =
    `Recipe "${recipe.label}" (${describeRecipeMatch(recipe.filters)}) returned ${results.length} ` +
    `item(s).`;

  logRecipeUsage({
    scope,
    recipe,
    limit: limitValue,
    candidateLimit,
    resultCount: results.length,
    event: logEvent
  });

  return {
    query: queryString,
    results,
    recipe: recipe.name,
    explanation
  };
}

async function applyRetentionPolicy(scope: TenantScope): Promise<RetentionResult> {
  const filter = memoryScopeFilter(scope);
  const total = await dbMemories.countDocuments(filter);

  if (total <= MAX_MEMORIES) {
    return {
      explanation: 'Memory saved successfully.',
      forgottenMemoryId: null
    };
  }

  const oldest = await dbMemories.findOne(
    { ...filter, pinned: false },
    { sort: { createdAt: 1 } }
  );

  if (!oldest) {
    return {
      explanation: 'Memory saved but no eviction candidate was found.',
      forgottenMemoryId: null
    };
  }

  await dbMemories.deleteOne({ _id: oldest._id });

  return {
    explanation: `Memory limit exceeded. Automatically removed the oldest unpinned memory (ID: ${oldest._id.toString()}).`,
    forgottenMemoryId: oldest._id.toString()
  };
}

async function createMemory(
  scope: TenantScope,
  input: CreateMemoryInput
): Promise<ReturnType<typeof toClientMemory> & RetentionResult> {
  const { content, pinned, tags, ttlSeconds, idempotencyKey } = input;
  const filter = memoryScopeFilter(scope);

  if (idempotencyKey) {
    const existing = await dbMemories.findOne({ ...filter, idempotencyKey });
    if (existing) {
      return {
        ...toClientMemory(existing),
        explanation: 'Replayed idempotent request. Returning existing memory.',
        forgottenMemoryId: null
      };
    }
  }

  const embeddingResult = await generateEmbedding(content, 'document');
  const { embedding, norm } = normalizeEmbedding(embeddingResult.embedding);

  const createdAt = new Date();
  const pinnedValue = pinned ?? false;
  const sanitizedTags = sanitizeTags(tags);
  const langValue = resolveLanguage(content, input.lang ?? null);
  const typeValue = resolveTypeValue(input.type ?? null);
  const sourceValue = resolveSource(input.source ?? undefined);
  const aclValue = resolveAcl(input.acl ?? null);
  const piiFlagsValue = resolvePiiFlags(input.piiFlags ?? undefined);

  if (hasSensitivePii(piiFlagsValue) && aclValue.visibility === 'public') {
    throw new Error('Cannot store PII when ACL visibility is public. Choose a private or shared scope.');
  }

  const policyContext = {
    type: typeValue,
    source: sourceValue,
    tags: sanitizedTags,
    pinned: pinnedValue
  };
  const policyResult = evaluateStoragePolicies(policyContext, defaultStoragePolicies);

  const storageInput = input.storage ?? null;
  const userTtlSeconds = typeof ttlSeconds === 'number' && ttlSeconds > 0 ? ttlSeconds : undefined;
  const policyTtlSeconds = policyResult.ttlSeconds;
  const finalTtlSeconds =
    userTtlSeconds !== undefined
      ? userTtlSeconds
      : policyTtlSeconds === null
        ? undefined
        : policyTtlSeconds;
  const expiresAt = computeExpirationDate(createdAt, finalTtlSeconds);

  const policiesApplied = [...policyResult.appliedPolicies];
  if (storageInput) {
    policiesApplied.push('manual-override');
  }

  const finalStore: StorageDestination = storageInput?.store ?? policyResult.store ?? 'long_term';
  const dedupeOverride = storageInput?.dedupeThreshold;
  const dedupeThreshold =
    dedupeOverride === null
      ? undefined
      : typeof dedupeOverride === 'number'
        ? dedupeOverride
        : policyResult.dedupeThreshold;

  const graphOverride = storageInput?.graphEnrich ?? undefined;
  const graphEnrichValue =
    graphOverride === null
      ? false
      : typeof graphOverride === 'boolean'
        ? graphOverride
        : policyResult.graphEnrich ?? false;

  const importanceScore = computeImportanceScore(
    pinnedValue,
    input.importanceScore ?? policyResult.importanceScore
  );
  const recencyScore = computeRecencyScore(input.recencyScore ?? undefined);
  const provenance = [
    createProvenanceEvent({
      event: 'created',
      actor: scope.subjectId,
      description: 'Memory created via Capsule Memory API'
    })
  ];

  const piiEncryption = encryptPiiFlags(piiFlagsValue);

  const storageState: CapsuleStorageState = {
    store: finalStore,
    policies: policiesApplied,
    graphEnrich: graphEnrichValue,
    ...(typeof dedupeThreshold === 'number' ? { dedupeThreshold } : {})
  };

  logPolicyDecision({
    scope,
    storage: storageState,
    policies: policiesApplied,
    pinned: pinnedValue,
    type: typeValue,
    tags: sanitizedTags,
    source: sourceValue,
    acl: aclValue
  });

  const doc = {
    ...filter,
    content,
    lang: langValue,
    embedding,
    embeddingNorm: norm,
    embeddingModel: embeddingResult.model,
    createdAt,
    updatedAt: createdAt,
    pinned: pinnedValue,
    importanceScore,
    recencyScore,
    acl: aclValue,
    provenance,
    storage: storageState,
    graphEnrich: graphEnrichValue,
    explanation: 'Memory added via Capsule Memory.',
    ...(sanitizedTags ? { tags: sanitizedTags } : {}),
    ...(finalTtlSeconds !== undefined ? { ttlSeconds: finalTtlSeconds } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(typeValue ? { type: typeValue } : {}),
    ...(sourceValue ? { source: sourceValue } : {}),
    ...(piiEncryption.cipher
      ? { piiFlagsCipher: piiEncryption.cipher }
      : piiFlagsValue
        ? { piiFlags: piiFlagsValue }
        : {}),
    ...(idempotencyKey ? { idempotencyKey } : {})
  };

  const { insertedId } = await dbMemories.insertOne(doc);

  const retention = await applyRetentionPolicy(scope);

  if (graphEnrichValue) {
    await scheduleGraphJob({
      orgId: filter.orgId,
      projectId: filter.projectId,
      subjectId: filter.subjectId,
      memoryId: insertedId.toString()
    });
  }

  return {
    id: insertedId.toString(),
    ...filter,
    content,
    lang: langValue,
    createdAt,
    updatedAt: createdAt,
    pinned: pinnedValue,
    importanceScore,
    recencyScore,
    acl: aclValue,
    provenance,
    embeddingModel: embeddingResult.model,
    storage: storageState,
    graphEnrich: graphEnrichValue,
    ...(sanitizedTags ? { tags: sanitizedTags } : {}),
    ...(finalTtlSeconds !== undefined ? { ttlSeconds: finalTtlSeconds } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(typeValue ? { type: typeValue } : {}),
    ...(sourceValue ? { source: sourceValue } : {}),
    ...(piiEncryption.cipher
      ? { piiFlagsCipher: piiEncryption.cipher }
      : piiFlagsValue
        ? { piiFlags: piiFlagsValue }
        : {}),
    explanation: retention.explanation,
    forgottenMemoryId: retention.forgottenMemoryId
  };
}

async function listMemories(
  scope: TenantScope,
  filters: MemoryListFilters
): Promise<{ items: ReturnType<typeof toClientMemory>[]; explanation: string }> {
  const { limit, pinned, tag, type, visibility, store, graphEnrich } = filters;
  const query: Record<string, unknown> = { ...memoryScopeFilter(scope) };

  if (typeof pinned === 'boolean') {
    query.pinned = pinned;
  }

  if (tag) {
    query.tags = tag;
  }

  if (type) {
    query.type = type;
  }

  if (visibility) {
    query['acl.visibility'] = visibility;
  }

  if (store) {
    query['storage.store'] = store;
  }

  if (typeof graphEnrich === 'boolean') {
    query.graphEnrich = graphEnrich;
  }

  const memories = await dbMemories.fetch(query, {
    sort: { pinned: -1, importanceScore: -1, recencyScore: -1, createdAt: -1 },
    limit: limit ?? 50
  });

  return {
    items: memories.map(toClientMemory),
    explanation: `Loaded ${memories.length} most recent memories.`
  };
}

async function searchMemories(
  scope: TenantScope,
  queryString: string,
  options?: { limit?: number; recipe?: string }
): Promise<{
  query: string;
  results: Array<ReturnType<typeof toClientMemory> & { score: number; recipeScore: number }>;
  recipe: string;
  explanation: string;
}> {
  const recipe = getSearchRecipe(options?.recipe);
  return executeRecipeSearch(scope, recipe, queryString, options?.limit);
}

async function previewRecipeSearch(
  scope: TenantScope,
  recipeDefinition: z.infer<typeof recipeDefinitionSchema>,
  queryString: string,
  limit?: number
) {
  const recipe = buildRecipeFromDefinition(recipeDefinition);
  return executeRecipeSearch(scope, recipe, queryString, limit, 'capsule.recipe.preview');
}

function previewStoragePolicies(
  scope: TenantScope,
  context: {
    type?: string | null;
    tags?: string[];
    pinned?: boolean;
    source?: CapsuleSource | null;
    acl?: CapsuleAcl | null;
  }
) {
  const acl = resolveAcl(context.acl ?? null);
  const evaluation = evaluateStoragePolicies(
    {
      type: context.type ?? undefined,
      tags: context.tags,
      pinned: context.pinned ?? false,
      source: context.source ?? undefined
    },
    defaultStoragePolicies
  );

  const storageState: CapsuleStorageState = {
    store: evaluation.store ?? 'long_term',
    policies: evaluation.appliedPolicies,
    graphEnrich: evaluation.graphEnrich ?? false,
    ...(typeof evaluation.dedupeThreshold === 'number'
      ? { dedupeThreshold: evaluation.dedupeThreshold }
      : {})
  };

  logPolicyDecision({
    scope,
    storage: storageState,
    policies: evaluation.appliedPolicies,
    pinned: context.pinned ?? false,
    type: context.type ?? undefined,
    tags: context.tags ?? [],
    source: context.source ?? undefined,
    acl,
    event: 'capsule.policy.preview'
  });

  return {
    store: storageState.store,
    graphEnrich: storageState.graphEnrich ?? false,
    dedupeThreshold: storageState.dedupeThreshold ?? null,
    appliedPolicies: evaluation.appliedPolicies,
    ttlSeconds: evaluation.ttlSeconds ?? null,
    importanceScore: evaluation.importanceScore ?? null
  };
}

async function updateMemory(scope: TenantScope, input: UpdateMemoryInput & { id: string }) {
  const {
    id,
    pinned,
    tags,
    ttlSeconds,
    type,
    lang,
    importanceScore,
    recencyScore,
    source,
    acl,
    piiFlags,
    storage
  } = input;

  const objectId = toObjectId(id);
  const needsExistingDoc = storage !== undefined || acl !== undefined || piiFlags !== undefined;
  let existingDoc: MemoryDocument | null = null;
  if (needsExistingDoc) {
    existingDoc = await dbMemories.findOne({
      _id: objectId,
      ...memoryScopeFilter(scope)
    });
    if (!existingDoc) {
      throw new Error('Memory not found.');
    }
  }

  const update: Record<string, unknown> = {};
  const unset: Record<string, '' | 1 | true> = {};
  const push: Record<string, unknown> = {};
  const response: Record<string, unknown> = {};
  let mutated = false;
  let shouldEnqueueGraphJob = false;

  if (typeof pinned === 'boolean') {
    update.pinned = pinned;
    response.pinned = pinned;
    mutated = true;
  }

  if (tags !== undefined) {
    const sanitized = sanitizeTags(tags);
    if (sanitized) {
      update.tags = sanitized;
      response.tags = sanitized;
    } else {
      unset.tags = '';
      response.tags = [];
    }
    mutated = true;
  }

  if (ttlSeconds !== undefined) {
    mutated = true;
    if (ttlSeconds === null || ttlSeconds <= 0) {
      unset.expiresAt = '';
      unset.ttlSeconds = '';
      response.ttlSeconds = null;
      response.expiresAt = null;
    } else {
      const ttlValue = ttlSeconds;
      const expiresAt = computeExpirationDate(new Date(), ttlValue);
      if (expiresAt) {
        update.expiresAt = expiresAt;
        update.ttlSeconds = ttlValue;
        response.ttlSeconds = ttlValue;
        response.expiresAt = expiresAt;
      } else {
        unset.expiresAt = '';
        unset.ttlSeconds = '';
        response.ttlSeconds = null;
        response.expiresAt = null;
      }
    }
  }

  if (type !== undefined) {
    mutated = true;
    const typeValue = resolveTypeValue(type);
    if (typeValue) {
      update.type = typeValue;
      response.type = typeValue;
    } else {
      unset.type = '';
      response.type = null;
    }
  }

  if (lang !== undefined) {
    mutated = true;
    if (lang === null) {
      unset.lang = '';
      response.lang = null;
    } else {
      const langValue = sanitizeLanguageOverride(lang);
      if (langValue) {
        update.lang = langValue;
        response.lang = langValue;
      } else {
        unset.lang = '';
        response.lang = null;
      }
    }
  }

  if (importanceScore !== undefined || typeof pinned === 'boolean') {
    mutated = true;
    const computedImportance = computeImportanceScore(
      typeof pinned === 'boolean' ? pinned : undefined,
      importanceScore ?? undefined
    );
    update.importanceScore = computedImportance;
    response.importanceScore = computedImportance;
  }

  if (recencyScore !== undefined) {
    mutated = true;
    const computedRecency = computeRecencyScore(recencyScore ?? undefined);
    update.recencyScore = computedRecency;
    response.recencyScore = computedRecency;
  }

  if (source !== undefined) {
    mutated = true;
    const resolvedSource = resolveSource(source ?? undefined);
    if (resolvedSource) {
      update.source = resolvedSource;
      response.source = resolvedSource;
    } else {
      unset.source = '';
      response.source = null;
    }
  }

  if (acl !== undefined) {
    mutated = true;
    const resolvedAcl = resolveAcl(acl ?? null);
    if (
      resolvedAcl.visibility === 'public' &&
      piiFlags === undefined &&
      hasSensitivePii(resolveStoredPiiFlags(existingDoc))
    ) {
      throw new Error('Cannot set visibility to public while PII flags remain. Clear PII or choose a private scope.');
    }
    update.acl = resolvedAcl;
    response.acl = resolvedAcl;
  }

  if (piiFlags !== undefined) {
    mutated = true;
    const resolvedFlags = resolvePiiFlags(piiFlags ?? undefined);
    const effectiveAcl =
      (response.acl as CapsuleAcl | undefined) ??
      (update.acl as CapsuleAcl | undefined) ??
      existingDoc?.acl ??
      resolveAcl(null);
    if (hasSensitivePii(resolvedFlags) && effectiveAcl.visibility === 'public') {
      throw new Error('Cannot store PII when ACL visibility is public. Choose a private or shared scope.');
    }

    if (resolvedFlags && Object.keys(resolvedFlags).length > 0) {
      const piiEncryption = encryptPiiFlags(resolvedFlags);
      if (piiEncryption.cipher) {
        update.piiFlagsCipher = piiEncryption.cipher;
        unset.piiFlags = '';
      } else {
        update.piiFlags = resolvedFlags;
        unset.piiFlagsCipher = '';
      }
      response.piiFlags = resolvedFlags;
    } else {
      unset.piiFlags = '';
      unset.piiFlagsCipher = '';
      response.piiFlags = {};
    }
  }

  if (storage !== undefined) {
    mutated = true;
    if (storage === null) {
      unset.storage = '';
      update.graphEnrich = false;
      response.storage = null;
      response.graphEnrich = false;
    } else {
      const existingPolicies = Array.isArray(existingDoc?.storage?.policies)
        ? existingDoc?.storage?.policies ?? []
        : [];
      const mergedPolicies = Array.from(new Set([...existingPolicies, 'manual-override']));

      const storeValue: StorageDestination =
        storage.store ?? existingDoc?.storage?.store ?? 'long_term';

      const dedupeOverride = storage.dedupeThreshold;
      const dedupeValue =
        dedupeOverride === null
          ? undefined
          : typeof dedupeOverride === 'number'
            ? dedupeOverride
            : existingDoc?.storage?.dedupeThreshold;

      const graphOverride = storage.graphEnrich ?? undefined;
      let graphEnrichValue: boolean;
      if (graphOverride === null) {
        graphEnrichValue = false;
      } else if (typeof graphOverride === 'boolean') {
        graphEnrichValue = graphOverride;
      } else if (typeof existingDoc?.graphEnrich === 'boolean') {
        graphEnrichValue = existingDoc.graphEnrich;
      } else if (typeof existingDoc?.storage?.graphEnrich === 'boolean') {
        graphEnrichValue = existingDoc.storage.graphEnrich;
      } else {
        graphEnrichValue = false;
      }

      const storageUpdate: CapsuleStorageState = {
        store: storeValue,
        policies: mergedPolicies,
        graphEnrich: graphEnrichValue,
        ...(typeof dedupeValue === 'number' ? { dedupeThreshold: dedupeValue } : {})
      };

      update.storage = storageUpdate;
      update.graphEnrich = graphEnrichValue;
      response.storage = storageUpdate;
      response.graphEnrich = graphEnrichValue;

      const previouslyEnabled = Boolean(
        existingDoc?.graphEnrich ?? existingDoc?.storage?.graphEnrich
      );
      if (graphEnrichValue && !previouslyEnabled) {
        shouldEnqueueGraphJob = true;
      }
    }
  }

  if (!mutated) {
    return {
      success: true,
      explanation: 'No changes applied.'
    };
  }

  update.updatedAt = new Date();
  response.updatedAt = update.updatedAt;

  push.provenance = createProvenanceEvent({
    event: 'updated',
    actor: scope.subjectId,
    description: 'Memory metadata updated'
  });

  const result = await dbMemories.updateOne(
    { _id: objectId, ...memoryScopeFilter(scope) },
    {
      ...(Object.keys(update).length > 0 ? { $set: update } : {}),
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      ...(Object.keys(push).length > 0 ? { $push: push } : {})
    }
  );

  if (result.matchedCount === 0) {
    throw new Error('Memory not found.');
  }

  if (shouldEnqueueGraphJob) {
    await scheduleGraphJob({
      orgId: scope.orgId,
      projectId: scope.projectId,
      subjectId: scope.subjectId,
      memoryId: id
    });
  }

  return {
    success: true,
    explanation: 'Memory metadata updated.',
    ...response
  };
}

async function deleteMemory(scope: TenantScope, id: string, reason?: string) {
  const deletion = await dbMemories.deleteOne({
    _id: toObjectId(id),
    ...memoryScopeFilter(scope)
  });

  if (deletion.deletedCount === 0) {
    throw new Error('Memory not found.');
  }

  return {
    success: true,
    explanation: reason ? `Memory forgotten: ${reason}` : 'Memory forgotten.'
  };
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
}

function extractApiKey(headers: Record<string, string>): string | undefined {
  if (headers[API_KEY_HEADER]) {
    return headers[API_KEY_HEADER];
  }

  const authorization = headers[AUTHORIZATION_HEADER];
  if (!authorization) {
    return undefined;
  }

  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  return authorization.trim();
}

function parseTenantFromHeaders(headers: Record<string, string>): TenantScope {
  return ensureTenant(
    {
      orgId: headers[ORG_HEADER],
      projectId: headers[PROJECT_HEADER],
      subjectId: headers[SUBJECT_HEADER]
    },
    { allowFallback: false }
  );
}

type AuthedRouteHandler = (
  params: RouteParams,
  scope: TenantScope,
  headers: Record<string, string>
) => Promise<ReturnType<typeof buildResponse>>;

function buildResponse(data: unknown, status = 200) {
  return { data, status } as const;
}

function withAuth(handler: AuthedRouteHandler) {
  return async (params: RouteParams) => {
    const normalizedHeaders = normalizeHeaders(params.headers ?? {});
    const apiKey = extractApiKey(normalizedHeaders);

    if (ALLOWED_API_KEYS.length > 0) {
      if (!apiKey || !ALLOWED_API_KEYS.includes(apiKey)) {
        return buildResponse({ error: 'Unauthorized' }, 401);
      }
    }
    // When no API keys are configured we allow anonymous access for development scenarios.

    try {
      const scope = parseTenantFromHeaders(normalizedHeaders);
      try {
        return await handler(params, scope, normalizedHeaders);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error.';
        return buildResponse({ error: message }, 500);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid tenant headers.';
      return buildResponse({ error: message }, 400);
    }
  };
}

const apiRoutes: RouteDefinition[] = [
  {
    path: '/v1/memories',
    handlers: {
      get: withAuth(async (params, scope) => {
        const { query } = params;

        const limitNumber =
          typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : undefined;
        const normalizedLimit =
          typeof limitNumber === 'number' && Number.isFinite(limitNumber)
            ? limitNumber
            : undefined;
        const parsed = listMemoriesSchema.parse({
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId:
            typeof query.subjectId === 'string' && query.subjectId
              ? query.subjectId
              : scope.subjectId,
          limit: normalizedLimit,
          pinned:
            typeof query.pinned === 'string'
              ? query.pinned === 'true'
              : undefined,
          tag: typeof query.tag === 'string' ? query.tag : undefined,
          type: typeof query.type === 'string' ? query.type : undefined,
          visibility:
            typeof query.visibility === 'string' ? query.visibility : undefined,
          store: typeof query.store === 'string' ? query.store : undefined,
          graphEnrich:
            typeof query.graphEnrich === 'string'
              ? query.graphEnrich === 'true'
              : undefined
        });

        const tenant = ensureTenant(parsed, { allowFallback: false });
        const result = await listMemories(tenant, {
          limit: parsed.limit,
          pinned: parsed.pinned,
          tag: parsed.tag
        });
        return buildResponse(result);
      }),
      post: withAuth(async (params, scope, headers) => {
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = createMemorySchema.parse({
          ...body,
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId: scope.subjectId,
          idempotencyKey: headers[IDEMPOTENCY_HEADER] ?? body.idempotencyKey
        });

        const tenant = ensureTenant(parsed, { allowFallback: false });
        const created = await createMemory(tenant, {
          content: parsed.content,
          pinned: parsed.pinned,
          tags: parsed.tags,
          ttlSeconds: parsed.ttlSeconds,
          idempotencyKey: parsed.idempotencyKey
        });
        return buildResponse(created, 201);
      })
    }
  },
  {
    path: '/v1/memories/search',
    handlers: {
      post: withAuth(async (params, scope) => {
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = searchMemorySchema.parse({
          ...body,
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId: scope.subjectId
        });
        const tenant = ensureTenant(parsed, { allowFallback: false });
        const result = await searchMemories(tenant, parsed.query, {
          limit: parsed.limit,
          recipe: parsed.recipe
        });
        return buildResponse(result);
      })
    }
  },
  {
    path: '/v1/memories/recipes',
    handlers: {
      get: withAuth(async () => buildResponse({ recipes: listRecipeCatalog() }))
    }
  },
  {
    path: '/v1/memories/recipes/preview',
    handlers: {
      post: withAuth(async (params, scope) => {
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = recipePreviewSchema.parse({
          ...body,
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId: scope.subjectId
        });
        const tenant = ensureTenant(parsed, { allowFallback: false });
        const result = await previewRecipeSearch(tenant, parsed.recipe, parsed.query, parsed.limit);
        return buildResponse(result);
      })
    }
  },
  {
    path: '/v1/memories/policies',
    handlers: {
      get: withAuth(async () => buildResponse({ policies: listStoragePolicySummaries() }))
    }
  },
  {
    path: '/v1/memories/policies/preview',
    handlers: {
      post: withAuth(async (params, scope) => {
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = policyPreviewSchema.parse({
          ...body,
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId: scope.subjectId
        });
        const tenant = ensureTenant(parsed, { allowFallback: false });
        const context = {
          type: parsed.type ?? undefined,
          tags: parsed.tags,
          pinned: parsed.pinned,
          source: parsed.source ?? undefined,
          acl: parsed.acl ?? undefined
        };
        const result = previewStoragePolicies(tenant, context);
        return buildResponse(result);
      })
    }
  },
  {
    path: '/v1/memories/:id',
    handlers: {
      patch: withAuth(async (params, scope) => {
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = updateMemorySchema.parse({
          ...body,
          id: params.params.id,
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId: scope.subjectId
        });

        const tenant = ensureTenant(parsed, { allowFallback: false });
        const updatePayload: UpdateMemoryInput & { id: string } = { id: parsed.id };
        if (parsed.pinned !== undefined) {
          updatePayload.pinned = parsed.pinned;
        }
        if (parsed.tags !== undefined) {
          updatePayload.tags = parsed.tags;
        }
        if (parsed.ttlSeconds !== undefined) {
          updatePayload.ttlSeconds = parsed.ttlSeconds;
        }
        const result = await updateMemory(tenant, updatePayload);
        return buildResponse(result);
      }),
      delete: withAuth(async (params, scope) => {
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = deleteMemorySchema.parse({
          ...body,
          id: params.params.id,
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId: scope.subjectId
        });

        const tenant = ensureTenant(parsed, { allowFallback: false });
        const result = await deleteMemory(tenant, parsed.id, parsed.reason);
        return buildResponse(result, 200);
      })
    }
  }
];

export default new Module('memory', {
  stores: [dbMemories, dbGraphJobs, dbGraphEntities],
  routes: apiRoutes,
  queries: {
    async getMemories(args) {
      const parsed = listMemoriesSchema.parse(args ?? {});

      try {
        const tenant = ensureTenant(parsed, { allowFallback: true });
        return await listMemories(tenant, {
          limit: parsed.limit,
          pinned: parsed.pinned,
          tag: parsed.tag
        });
      } catch (error) {
        if (isProvisioningError(error)) {
          return {
            items: [],
            explanation: PROVISIONING_HINT
          };
        }
        throw error;
      }
    },
    async searchMemory(args) {
      const parsed = searchMemorySchema.parse(args ?? {});

      try {
        const tenant = ensureTenant(parsed, { allowFallback: true });
        return await searchMemories(tenant, parsed.query, {
          limit: parsed.limit,
          recipe: parsed.recipe
        });
      } catch (error) {
        if (isProvisioningError(error)) {
          return {
            query: parsed.query,
            results: [],
            recipe: parsed.recipe ?? 'default-semantic',
            explanation: PROVISIONING_HINT
          };
        }
        throw error;
      }
    },
    listSearchRecipes() {
      return {
        recipes: listRecipeCatalog()
      };
    },
    listStoragePolicies() {
      return {
        policies: listStoragePolicySummaries()
      };
    },
    previewRecipe(args) {
      const parsed = recipePreviewSchema.parse(args ?? {});
      const tenant = ensureTenant(parsed, { allowFallback: true });
      return previewRecipeSearch(tenant, parsed.recipe, parsed.query, parsed.limit);
    },
    previewStoragePolicies(args) {
      const parsed = policyPreviewSchema.parse(args ?? {});
      const tenant = ensureTenant(parsed, { allowFallback: true });
      return previewStoragePolicies(tenant, {
        type: parsed.type ?? undefined,
        tags: parsed.tags,
        pinned: parsed.pinned,
        source: parsed.source ?? undefined,
        acl: parsed.acl ?? undefined
      });
    }
  },
  mutations: {
    async addMemory(args) {
      const parsed = createMemorySchema.parse(args ?? {});

      try {
        const tenant = ensureTenant(parsed, { allowFallback: true });
        return await createMemory(tenant, {
          content: parsed.content,
          pinned: parsed.pinned,
          tags: parsed.tags,
          ttlSeconds: parsed.ttlSeconds,
          idempotencyKey: parsed.idempotencyKey
        });
      } catch (error) {
        if (isProvisioningError(error)) {
          throw new Error(PROVISIONING_HINT);
        }
        throw error;
      }
    },
    async pinMemory(args) {
      const parsed = pinMemorySchema.parse(args ?? {});
      const pinValue = parsed.pin ?? true;

      try {
        const tenant = ensureTenant(parsed, { allowFallback: true });
        const result = await updateMemory(tenant, { id: parsed.id, pinned: pinValue });
        return {
          ...result,
          pinned: pinValue
        };
      } catch (error) {
        if (isProvisioningError(error)) {
          throw new Error(PROVISIONING_HINT);
        }
        throw error;
      }
    },
    async deleteMemory(args) {
      const parsed = deleteMemorySchema.parse(args ?? {});

      try {
        const tenant = ensureTenant(parsed, { allowFallback: true });
        return await deleteMemory(tenant, parsed.id, parsed.reason);
      } catch (error) {
        if (isProvisioningError(error)) {
          throw new Error(PROVISIONING_HINT);
        }
        throw error;
      }
    }
  },
  configSchema: {
    apiKey: { type: 'string', default: '', isPublic: false }
  }
});
