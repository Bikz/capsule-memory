import { performance } from 'node:perf_hooks';
import { Module, ObjectId, type RouteDefinition, type RouteParams } from 'modelence/server';
import type { UpdateFilter } from 'mongodb';
import { z } from 'zod';

import { dbMemories, EMBEDDING_DIMENSIONS } from './db';
import { dbMemoryCandidates } from './captureDb';
import type { CaptureStatus } from './captureDb';
import {
  CapsuleAcl,
  CapsulePiiFlags,
  CapsuleSource,
  CapsuleStorageState,
  CapsuleRetention,
  StorageDestination,
  DEFAULT_RETENTION,
  EPHEMERAL_TTL_DEFAULT_SECONDS,
  computeImportanceScore,
  computeRecencyScore,
  createProvenanceEvent,
  isRetentionProtected,
  resolveAcl,
  resolveLanguage,
  resolvePiiFlags,
  resolveRetention,
  resolveSource,
  resolveTypeValue,
  retentionPriority
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
import {
  logPolicyDecision,
  logRecipeUsage,
  logVectorMetrics,
  logCaptureDecision,
  logCaptureEvaluation
} from './logging';
import { rewriteQuery } from './rewrite';
import { rerankCandidates } from './rerank';
import { shouldRewrite, shouldRerank } from './adaptiveConfig';
import { generateEmbedding } from './voyage';
import { scoreConversationEvent } from './capture';

type MemoryDocument = typeof dbMemories.Doc;
type MemoryCandidateDocument = typeof dbMemoryCandidates.Doc;

type TenantScope = {
  orgId: string;
  projectId: string;
  subjectId: string;
  byokKey?: string;
};

type RetentionResult = {
  explanation: string;
  forgottenMemoryId: string | null;
};

type StorageConfigInput = {
  store?: StorageDestination | null;
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
  retention?: CapsuleRetention | null;
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
  retention?: CapsuleRetention | null;
};

type MemoryListFilters = {
  limit?: number;
  pinned?: boolean;
  tag?: string;
  type?: string;
  visibility?: CapsuleAcl['visibility'];
  store?: StorageDestination;
  graphEnrich?: boolean;
  retention?: CapsuleRetention;
};

type CaptureEventInput = {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown> | undefined;
  autoAccept?: boolean;
  memory?: CaptureMemoryOverrides | null;
};

type CaptureMemoryOverrides = {
  pinned?: boolean;
  tags?: string[];
  retention?: CapsuleRetention | 'auto' | null;
  type?: string;
  ttlSeconds?: number;
};

type CaptureMemoryOverrideInput = z.infer<typeof captureMemoryOverridesSchema>;
type CaptureEventSchemaInput = z.infer<typeof captureEventSchema>;

const MAX_MEMORIES = Number.parseInt(process.env.CAPSULE_MAX_MEMORIES ?? '100', 10);
const CAPTURE_DEFAULT_THRESHOLD = Number.parseFloat(process.env.CAPSULE_CAPTURE_THRESHOLD ?? '0.5');

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
  visibility: visibilitySchema,
  subjects: z.array(z.string().min(1)).optional()
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
  recipe: recipeDefinitionSchema,
  prompt: z.string().min(1).optional()
});

const policyPreviewSchema = tenantArgSchema.extend({
  type: z.string().min(1).nullish(),
  tags: z.array(z.string().min(1)).optional(),
  pinned: z.boolean().optional(),
  source: sourceSchema.nullish(),
  acl: aclSchema.nullish()
});

const retentionSchema = z.enum(['irreplaceable', 'permanent', 'replaceable', 'ephemeral']);

const metadataCreateFields = {
  type: z.string().min(1).nullish(),
  lang: z.string().min(2).max(8).nullish(),
  importanceScore: z.number().min(0).max(5).nullish(),
  recencyScore: z.number().min(0).max(5).nullish(),
  source: sourceSchema.nullish(),
  acl: aclSchema.nullish(),
  piiFlags: z.record(z.string(), z.boolean()).nullish(),
  retention: retentionSchema.nullish()
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
  graphEnrich: z.boolean().optional(),
  retention: retentionSchema.optional()
});

const captureMemoryOverridesSchema = z
  .object({
    pinned: z.boolean().optional(),
    tags: z.array(z.string().min(1)).optional(),
    retention: retentionSchema.or(z.literal('auto')).nullish(),
    type: z.string().min(1).optional(),
    ttlSeconds: z.number().int().positive().optional()
  })
  .nullable()
  .optional();

const captureEventSchema = z.object({
  id: z.string().min(1).optional(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  autoAccept: z.boolean().optional(),
  memory: captureMemoryOverridesSchema
});

const captureRequestSchema = tenantArgSchema.extend({
  events: z.array(captureEventSchema).min(1),
  threshold: z.number().min(0).max(1).optional()
});

const captureListSchema = tenantArgSchema.extend({
  status: z.enum(['pending', 'approved', 'rejected', 'ignored']).optional(),
  limit: z.number().int().positive().max(200).optional()
});

const captureApproveSchema = tenantArgSchema.extend({
  id: z.string().min(1),
  memory: captureMemoryOverridesSchema
});

const captureRejectSchema = tenantArgSchema.extend({
  id: z.string().min(1),
  reason: z.string().max(512).optional()
});

const searchMemorySchema = tenantArgSchema.extend({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).optional(),
  recipe: recipeNameSchema.optional(),
  prompt: z.string().min(1).optional()
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
  .map((value: string) => value.trim())
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

async function fetchCandidates(filter: Record<string, unknown>, limit: number) {
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

function memoryScopeFilter(scope: TenantScope, options?: { includeSubject?: boolean }) {
  const base = {
    orgId: scope.orgId,
    projectId: scope.projectId
  } as const;
  if (options?.includeSubject === false) {
    return base;
  }
  return {
    ...base,
    subjectId: scope.subjectId
  } as const;
}

function captureScopeFilter(scope: TenantScope, options?: { includeSubject?: boolean }) {
  const base = {
    orgId: scope.orgId,
    projectId: scope.projectId
  } as const;
  if (options?.includeSubject === false) {
    return base;
  }
  return {
    ...base,
    subjectId: scope.subjectId
  } as const;
}

function resolveCaptureThreshold(value?: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1) {
    return value;
  }
  return CAPTURE_DEFAULT_THRESHOLD;
}

function resolveRetentionOverride(retention?: CapsuleRetention | 'auto' | null): CapsuleRetention | undefined {
  if (!retention || retention === 'auto') {
    return undefined;
  }
  return retention;
}

function buildMemoryInputFromCandidate(
  candidate: { content: string; category: string },
  overrides?: CaptureMemoryOverrideInput | null
): CreateMemoryInput {
  const tags = overrides?.tags ?? null;
  const retentionOverride = resolveRetentionOverride(overrides?.retention ?? null);
  const ttlOverride = overrides?.ttlSeconds != null ? overrides.ttlSeconds : undefined;
  const typeOverride = overrides?.type ?? candidate.category;
  return {
    content: candidate.content,
    pinned: overrides?.pinned ?? false,
    tags: tags && tags.length > 0 ? tags : undefined,
    ttlSeconds: ttlOverride,
    type: typeOverride,
    retention: retentionOverride
  };
}

function toClientCandidate(doc: MemoryCandidateDocument) {
  return {
    id: doc._id.toString(),
    eventId: (doc as { eventId?: string }).eventId ?? null,
    role: doc.role,
    content: doc.content,
    metadata: (doc as { metadata?: Record<string, unknown> }).metadata ?? {},
    score: doc.score,
    threshold: doc.threshold,
    recommended: doc.recommended,
    category: doc.category,
    reasons: doc.reasons,
    status: doc.status,
    autoAccepted: (doc as { autoAccepted?: boolean }).autoAccepted ?? false,
    autoDecisionReason: (doc as { autoDecisionReason?: string }).autoDecisionReason ?? null,
    memoryId: (doc as { memoryId?: string }).memoryId ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

async function scoreCaptureEvents(
  scope: TenantScope,
  events: CaptureEventInput[],
  threshold?: number
) {
  const resolvedThreshold = resolveCaptureThreshold(threshold);
  const outcomes: Array<{
    eventId?: string;
    candidateId?: string;
    status: CaptureStatus;
    recommended: boolean;
    score: number;
    reasons: string[];
    memoryId?: string | null;
  }> = [];

  for (const event of events) {
    const scoring = scoreConversationEvent(
      {
        id: event.id,
        role: event.role,
        content: event.content,
        metadata: event.metadata
      },
      { threshold: resolvedThreshold }
    );

    logCaptureEvaluation({
      scope,
      eventId: event.id,
      role: event.role,
      recommended: scoring.recommended,
      score: scoring.score,
      threshold: scoring.threshold,
      category: scoring.category,
      reasons: scoring.reasons
    });

    let status: CaptureStatus = scoring.recommended ? 'pending' : 'ignored';
    let autoAccepted = false;
    let autoDecisionReason: string | undefined;
    let memoryId: string | null = null;
    const now = new Date();

    if (scoring.recommended && event.autoAccept) {
      const memoryInput = buildMemoryInputFromCandidate(
        { content: event.content, category: scoring.category },
        event.memory ?? null
      );
      const created = await createMemory(scope, memoryInput);
      status = 'approved';
      autoAccepted = true;
      autoDecisionReason = 'auto-accepted via capture request';
      memoryId = created.id;
    }

    const insertResult = await dbMemoryCandidates.insertOne({
      orgId: scope.orgId,
      projectId: scope.projectId,
      subjectId: scope.subjectId,
      eventId: event.id,
      role: event.role,
      content: event.content,
      metadata: event.metadata,
      score: scoring.score,
      threshold: scoring.threshold,
      recommended: scoring.recommended,
      category: scoring.category,
      reasons: scoring.reasons,
      status,
      autoAccepted,
      autoDecisionReason,
      memoryId: memoryId ?? undefined,
      createdAt: now,
      updatedAt: now
    });

    const candidateId = insertResult.insertedId.toString();

    if (status !== 'pending') {
      logCaptureDecision({
        scope,
        candidateId,
        status,
        autoAccepted,
        memoryId
      });
    } else {
      logCaptureDecision({
        scope,
        candidateId,
        status,
        autoAccepted: false,
        memoryId: null
      });
    }

    outcomes.push({
      eventId: event.id,
      candidateId,
      status,
      recommended: scoring.recommended,
      score: scoring.score,
      reasons: scoring.reasons,
      memoryId
    });
  }

  return {
    threshold: resolvedThreshold,
    results: outcomes
  };
}

async function listCaptureCandidates(
  scope: TenantScope,
  status: CaptureStatus = 'pending',
  limit = 50
) {
  const documents = await dbMemoryCandidates.fetch(
    {
      ...captureScopeFilter(scope),
      status
    },
    {
      sort: { createdAt: -1 },
      limit
    }
  );

  return documents.map((doc) => toClientCandidate(doc as MemoryCandidateDocument));
}

async function approveCaptureCandidate(
  scope: TenantScope,
  id: string,
  overrides?: CaptureMemoryOverrideInput | null
) {
  const candidate = await dbMemoryCandidates.findOne({
    _id: toObjectId(id),
    ...captureScopeFilter(scope)
  });

  if (!candidate) {
    throw new Error('Capture candidate not found.');
  }

  if (candidate.status !== 'pending') {
    throw new Error(`Cannot approve a candidate with status "${candidate.status}".`);
  }

  const memoryInput = buildMemoryInputFromCandidate(
    { content: candidate.content, category: candidate.category },
    overrides ?? null
  );

  const created = await createMemory(scope, memoryInput);
  const updatedAt = new Date();

  await dbMemoryCandidates.updateOne(
    { _id: candidate._id },
    {
      $set: {
        status: 'approved',
        memoryId: created.id,
        updatedAt
      }
    }
  );

  logCaptureDecision({
    scope,
    candidateId: candidate._id.toString(),
    status: 'approved',
    autoAccepted: false,
    memoryId: created.id
  });

  return {
    candidate: {
      ...toClientCandidate(candidate as MemoryCandidateDocument),
      status: 'approved',
      memoryId: created.id,
      updatedAt
    },
    memory: created
  };
}

async function rejectCaptureCandidate(scope: TenantScope, id: string, reason?: string) {
  const candidate = await dbMemoryCandidates.findOne({
    _id: toObjectId(id),
    ...captureScopeFilter(scope)
  });

  if (!candidate) {
    throw new Error('Capture candidate not found.');
  }

  if (candidate.status !== 'pending') {
    throw new Error(`Cannot reject a candidate with status "${candidate.status}".`);
  }

  const updatedAt = new Date();
  await dbMemoryCandidates.updateOne(
    { _id: candidate._id },
    {
      $set: {
        status: 'rejected',
        autoDecisionReason: reason,
        updatedAt
      }
    }
  );

  logCaptureDecision({
    scope,
    candidateId: candidate._id.toString(),
    status: 'rejected',
    autoAccepted: false,
    memoryId: null,
    reason
  });

  return toClientCandidate({
    ...candidate,
    status: 'rejected',
    autoDecisionReason: reason,
    updatedAt
  } as MemoryCandidateDocument);
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

function toClientMemory(doc: MemoryDocument, options?: { byokKey?: string }) {
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
  const aclValue = resolveAcl(rest.acl ?? null, doc.subjectId);
  const langValue =
    typeof rest.lang === 'string' && rest.lang
      ? rest.lang
      : resolveLanguage((rest as { content: string }).content ?? '', null);
  const provenanceValue = Array.isArray(rest.provenance) ? rest.provenance : [];
  const embeddingModelValue =
    typeof rest.embeddingModel === 'string' && rest.embeddingModel
      ? rest.embeddingModel
      : 'unknown';
  const retentionValue: CapsuleRetention =
    (rest as { retention?: CapsuleRetention }).retention ?? DEFAULT_RETENTION;
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
      : decryptPiiFlags(piiFlagsCipher, options?.byokKey);
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
    retention: retentionValue,
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

function resolveStoredPiiFlags(doc?: MemoryDocument | null, byokKey?: string): CapsulePiiFlags | undefined {
  if (!doc) {
    return undefined;
  }
  if (doc.piiFlags && typeof doc.piiFlags === 'object') {
    return doc.piiFlags as CapsulePiiFlags;
  }
  return decryptPiiFlags((doc as { piiFlagsCipher?: string }).piiFlagsCipher, byokKey);
}

function isAccessibleMemory(doc: MemoryDocument, scope: TenantScope): boolean {
  if (doc.subjectId === scope.subjectId) {
    return true;
  }
  const acl = doc.acl ?? { visibility: 'private' };
  if (acl.visibility === 'public') {
    return true;
  }
  if (acl.visibility === 'shared') {
    if (Array.isArray(acl.subjects) && acl.subjects.length > 0) {
      return acl.subjects.includes(scope.subjectId);
    }
    return true;
  }
  return false;
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
  logEvent: 'capsule.recipe.usage' | 'capsule.recipe.preview' = 'capsule.recipe.usage',
  options?: {
    prompt?: string;
    forceRewrite?: boolean;
    forceRerank?: boolean;
  }
) {
  const limitValue = explicitLimit && explicitLimit > 0 ? explicitLimit : recipe.limit;
  const candidateLimit = Math.max(recipe.candidateLimit, limitValue * 5);

  let rewrittenQuery = queryString;
  let rewriteApplied = false;
  let rewriteLatency = 0;
  const rewriteCandidate = options?.prompt ?? queryString;
  const allowRewrite = options?.forceRewrite === true
    ? true
    : options?.forceRewrite === false
      ? false
      : shouldRewrite(queryString, 0);

  if (allowRewrite && rewriteCandidate) {
    const rewriteResult = await rewriteQuery(rewriteCandidate, queryString);
    rewriteLatency = rewriteResult.latencyMs;
    if (rewriteResult.rewritten) {
      rewrittenQuery = rewriteResult.rewritten;
      rewriteApplied = true;
    }
  }

  const queryEmbeddingResult = await generateEmbedding(rewrittenQuery, 'query');
  const queryEmbedding = normalizeEmbedding(queryEmbeddingResult.embedding);

  const fetchFilter: Record<string, unknown> = { ...memoryScopeFilter(scope, { includeSubject: false }) };
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
      candidates = await fetchCandidates(fetchFilter, candidateLimit);
      HOTSET_CACHE.set(cacheKey, candidates);
    }
  } else {
    candidates = await fetchCandidates(fetchFilter, candidateLimit);
  }

  const accessibleCandidates = candidates.filter((doc) => isAccessibleMemory(doc, scope));

  const vectorLatency = performance.now() - vectorStart;
  logVectorMetrics({
    scope,
    backend: VECTOR_BACKEND,
    latencyMs: Math.round(vectorLatency),
    cacheHit,
    candidateCount: accessibleCandidates.length
  });

  let results: Array<ReturnType<typeof toClientMemory> & { score: number; recipeScore: number; graphHit?: boolean }> = accessibleCandidates
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
          storage: doc.storage,
          retention: (doc as { retention?: CapsuleRetention }).retention ?? DEFAULT_RETENTION
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
        ...toClientMemory(doc, { byokKey: scope.byokKey }),
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
      const expansionItems = expansions
        .filter((doc) => isAccessibleMemory(doc, scope))
        .map((doc) => ({
          ...toClientMemory(doc, { byokKey: scope.byokKey }),
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

  let rerankApplied = false;
  const allowRerankEnv = Boolean(process.env.CAPSULE_RERANKER_URL);
  const allowRerank = options?.forceRerank === true
    ? true
    : options?.forceRerank === false
      ? false
      : allowRerankEnv && shouldRerank(results.length, vectorLatency + rewriteLatency);

  let rerankLatency = 0;

  if (allowRerank) {
    const rerankedResult = await rerankCandidates({
      prompt: options?.prompt ?? '',
      query: rewrittenQuery,
      candidates: results.map((item) => ({
        id: item.id,
        content: item.content,
        score: item.recipeScore ?? item.score ?? 0
      }))
    });
    rerankLatency = rerankedResult.latencyMs;
    if (rerankedResult.applied) {
      const originalMap = new Map(results.map((item) => [item.id, item]));
      results = rerankedResult.candidates
        .map((candidate) => {
          const original = originalMap.get(candidate.id);
          if (!original) {
            return {
              id: candidate.id,
              content: candidate.content,
              score: candidate.score,
              recipeScore: candidate.score
            } as ReturnType<typeof toClientMemory> & { score: number; recipeScore: number; graphHit?: boolean };
          }
          return {
            ...original,
            recipeScore: candidate.score
          };
        })
        .slice(0, limitValue);
      rerankApplied = true;
    }
  }

  const rewriteNote = rewriteApplied ? ' (rewritten)' : '';
  const rerankNote = rerankApplied ? ' (reranked)' : '';
  const explanation =
    `Recipe "${recipe.label}" (${describeRecipeMatch(recipe.filters)}) returned ${results.length} item(s)${rewriteNote}${rerankNote}.`;

  logRecipeUsage({
    scope,
    recipe,
    limit: limitValue,
    candidateLimit,
    resultCount: results.length,
    rewriteApplied,
    rerankApplied,
    rewriteLatencyMs: Math.round(rewriteLatency),
    rerankLatencyMs: Math.round(rerankLatency),
    event: logEvent
  });

  return {
    query: queryString,
    results,
    recipe: recipe.name,
    explanation,
    metrics: {
      rewriteApplied,
      rewriteLatencyMs: Math.round(rewriteLatency),
      rerankApplied,
      rerankLatencyMs: Math.round(rerankLatency)
    }
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

  const candidates = await dbMemories
    .fetch(
      { ...filter, pinned: false },
      { sort: { createdAt: 1 }, limit: 200 }
    )
    .catch(() => [] as MemoryDocument[]);

  let selected: MemoryDocument | null = null;
  for (const candidate of candidates) {
    const retentionValue: CapsuleRetention = (candidate as { retention?: CapsuleRetention }).retention ?? DEFAULT_RETENTION;
    if (isRetentionProtected(retentionValue)) {
      continue;
    }
    if (!selected) {
      selected = candidate;
      continue;
    }
    const currentPriority = retentionPriority(retentionValue);
    const chosenPriority = retentionPriority(
      ((selected as { retention?: CapsuleRetention }).retention ?? DEFAULT_RETENTION) as CapsuleRetention
    );
    if (currentPriority < chosenPriority) {
      selected = candidate;
      continue;
    }
    if (
      currentPriority === chosenPriority &&
      candidate.createdAt < selected.createdAt
    ) {
      selected = candidate;
    }
  }

  if (!selected) {
    return {
      explanation: 'Memory saved but no eviction candidate was found.',
      forgottenMemoryId: null
    };
  }

  await dbMemories.deleteOne({ _id: selected._id });

  const retentionDescriptor = ((selected as { retention?: CapsuleRetention }).retention ?? DEFAULT_RETENTION) as CapsuleRetention;

  return {
    explanation: `Memory limit exceeded. Automatically removed ${retentionDescriptor} memory (ID: ${selected._id.toString()}).`,
    forgottenMemoryId: selected._id.toString()
  };
}

async function createMemory(
  scope: TenantScope,
  input: CreateMemoryInput
): Promise<ReturnType<typeof toClientMemory> & RetentionResult> {
  const { content, pinned, tags, ttlSeconds, idempotencyKey, retention: retentionInput } = input;
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
  const aclValue = resolveAcl(input.acl ?? null, scope.subjectId);
  if (aclValue.visibility === 'shared' && (!aclValue.subjects || aclValue.subjects.length === 0)) {
    throw new Error('Shared memories must include at least one subject in acl.subjects.');
  }
  const piiFlagsValue = resolvePiiFlags(input.piiFlags ?? undefined);

  if (hasSensitivePii(piiFlagsValue) && aclValue.visibility !== 'private') {
    throw new Error('PII memories must remain private.');
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
  let finalTtlSeconds =
    userTtlSeconds !== undefined
      ? userTtlSeconds
      : policyTtlSeconds === null
        ? undefined
        : policyTtlSeconds;

  let { retention: retentionValue, autoAssigned: retentionAutoAssigned } = resolveRetention({
    provided: retentionInput ?? null,
    pinned: pinnedValue,
    ttlSeconds: finalTtlSeconds ?? userTtlSeconds ?? null
  });

  if (retentionAutoAssigned) {
    const reevaluated = resolveRetention({
      provided: null,
      pinned: pinnedValue,
      ttlSeconds: finalTtlSeconds ?? null
    });
    retentionValue = reevaluated.retention;
    retentionAutoAssigned = retentionAutoAssigned || reevaluated.autoAssigned;
  }

  if (isRetentionProtected(retentionValue)) {
    finalTtlSeconds = undefined;
  } else if (retentionValue === 'ephemeral' && finalTtlSeconds === undefined) {
    finalTtlSeconds = EPHEMERAL_TTL_DEFAULT_SECONDS;
  }

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

  const piiEncryption = encryptPiiFlags(piiFlagsValue, scope.byokKey);

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
    acl: aclValue,
    retention: retentionValue,
    retentionAutoAssigned
  });

  const doc = {
    orgId: scope.orgId,
    projectId: scope.projectId,
    subjectId: scope.subjectId,
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
    retention: retentionValue,
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
      orgId: scope.orgId,
      projectId: scope.projectId,
      subjectId: scope.subjectId,
      memoryId: insertedId.toString()
    });
  }

  return {
    id: insertedId.toString(),
    orgId: scope.orgId,
    projectId: scope.projectId,
    subjectId: scope.subjectId,
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
    retention: retentionValue,
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
  const { limit, pinned, tag, type, visibility, store, graphEnrich, retention } = filters;
  const query: Record<string, unknown> = { ...memoryScopeFilter(scope, { includeSubject: false }) };

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

  if (retention) {
    query.retention = retention;
  }

  const memories = await dbMemories.fetch(query, {
    sort: { pinned: -1, importanceScore: -1, recencyScore: -1, createdAt: -1 },
    limit: limit ?? 50
  });

  const accessible = memories.filter((doc) => isAccessibleMemory(doc, scope));

  return {
    items: accessible.map((doc) => toClientMemory(doc, { byokKey: scope.byokKey })),
    explanation: `Loaded ${accessible.length} accessible memories.`
  };
}

async function searchMemories(
  scope: TenantScope,
  queryString: string,
  options?: { limit?: number; recipe?: string; prompt?: string; forceRewrite?: boolean; forceRerank?: boolean }
): Promise<{
  query: string;
  results: Array<ReturnType<typeof toClientMemory> & { score: number; recipeScore: number; graphHit?: boolean }>;
  recipe: string;
  explanation: string;
  metrics: {
    rewriteApplied: boolean;
    rewriteLatencyMs: number;
    rerankApplied: boolean;
    rerankLatencyMs: number;
  };
}> {
  const recipe = getSearchRecipe(options?.recipe);
  return executeRecipeSearch(scope, recipe, queryString, options?.limit, 'capsule.recipe.usage', {
    prompt: options?.prompt ?? queryString,
    forceRewrite: options?.forceRewrite,
    forceRerank: options?.forceRerank
  });
}

async function previewRecipeSearch(
  scope: TenantScope,
  recipeDefinition: z.infer<typeof recipeDefinitionSchema>,
  queryString: string,
  limit?: number,
  prompt?: string,
  overrides?: { forceRewrite?: boolean; forceRerank?: boolean }
) {
  const recipe = buildRecipeFromDefinition(recipeDefinition);
  return executeRecipeSearch(scope, recipe, queryString, limit, 'capsule.recipe.preview', {
    prompt: prompt ?? queryString,
    forceRewrite: overrides?.forceRewrite,
    forceRerank: overrides?.forceRerank
  });
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
  const acl = resolveAcl(context.acl ?? null, scope.subjectId);
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
    storage,
    retention
  } = input;

  const objectId = toObjectId(id);
  const existingDoc = await dbMemories.findOne({
    _id: objectId,
    ...memoryScopeFilter(scope)
  });

  if (!existingDoc) {
    throw new Error('Memory not found.');
  }

  const update: Record<string, unknown> = {};
  const unset: Record<string, '' | 1 | true> = {};
  const response: Record<string, unknown> = {};
  let mutated = false;
  let shouldEnqueueGraphJob = false;
  const existingRetention: CapsuleRetention = (existingDoc.retention as CapsuleRetention) ?? DEFAULT_RETENTION;
  let retentionValue: CapsuleRetention = existingRetention;
  let retentionMutated = false;
  let ttlSecondsResult =
    typeof existingDoc.ttlSeconds === 'number' && Number.isFinite(existingDoc.ttlSeconds)
      ? existingDoc.ttlSeconds
      : undefined;
  let expiresAtResult = existingDoc.expiresAt ? new Date(existingDoc.expiresAt) : null;
  const createdAtReference = existingDoc.createdAt ? new Date(existingDoc.createdAt) : new Date();

  if (typeof pinned === 'boolean') {
    update.pinned = pinned;
    response.pinned = pinned;
    mutated = true;
  }

  const pinnedValue = typeof pinned === 'boolean' ? pinned : existingDoc.pinned;

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

  if (retention !== undefined) {
    const ttlContext =
      ttlSeconds === null
        ? null
        : typeof ttlSeconds === 'number'
          ? ttlSeconds
          : ttlSecondsResult;
    const resolved = resolveRetention({
      provided: retention,
      pinned: pinnedValue,
      ttlSeconds: ttlContext ?? null
    });
    if (resolved.retention !== retentionValue) {
      retentionValue = resolved.retention;
      retentionMutated = true;
      if (retentionValue !== existingRetention) {
        update.retention = retentionValue;
        mutated = true;
      }
      response.retention = retentionValue;
    }
  }

  if (ttlSeconds !== undefined) {
    mutated = true;
    if (ttlSeconds === null || ttlSeconds <= 0) {
      ttlSecondsResult = undefined;
      expiresAtResult = null;
      unset.expiresAt = '';
      unset.ttlSeconds = '';
      response.ttlSeconds = null;
      response.expiresAt = null;
    } else {
      const ttlValue = ttlSeconds;
      ttlSecondsResult = ttlValue;
      const expiresAt = computeExpirationDate(createdAtReference, ttlValue);
      if (expiresAt) {
        update.expiresAt = expiresAt;
        update.ttlSeconds = ttlValue;
        response.ttlSeconds = ttlValue;
        response.expiresAt = expiresAt;
        expiresAtResult = expiresAt;
      } else {
        unset.expiresAt = '';
        unset.ttlSeconds = '';
        response.ttlSeconds = null;
        response.expiresAt = null;
        expiresAtResult = null;
      }
    }
  }

  if (!retentionMutated) {
    const inferred = resolveRetention({
      provided: null,
      pinned: pinnedValue,
      ttlSeconds: ttlSecondsResult ?? null
    });
    if (inferred.retention !== retentionValue) {
      retentionValue = inferred.retention;
      retentionMutated = true;
      if (retentionValue !== existingRetention) {
        update.retention = retentionValue;
        mutated = true;
      }
    }
  }

  if (isRetentionProtected(retentionValue)) {
    if (ttlSecondsResult !== undefined || expiresAtResult) {
      ttlSecondsResult = undefined;
      expiresAtResult = null;
      delete update.ttlSeconds;
      delete update.expiresAt;
      unset.ttlSeconds = '';
      unset.expiresAt = '';
      response.ttlSeconds = null;
      response.expiresAt = null;
      mutated = true;
    }
  } else if (retentionValue === 'ephemeral' && ttlSecondsResult === undefined) {
    ttlSecondsResult = EPHEMERAL_TTL_DEFAULT_SECONDS;
    const expiresAt = computeExpirationDate(createdAtReference, ttlSecondsResult);
    delete unset.ttlSeconds;
    delete unset.expiresAt;
    update.ttlSeconds = ttlSecondsResult;
    if (expiresAt) {
      update.expiresAt = expiresAt;
      response.expiresAt = expiresAt;
      expiresAtResult = expiresAt;
    } else {
      delete update.expiresAt;
      expiresAtResult = null;
    }
    response.ttlSeconds = ttlSecondsResult;
    mutated = true;
  }

  response.retention = retentionValue;

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
    const resolvedAcl = resolveAcl(acl ?? null, existingDoc?.subjectId ?? scope.subjectId);
    if (resolvedAcl.visibility === 'shared' && (!resolvedAcl.subjects || resolvedAcl.subjects.length === 0)) {
      throw new Error('Shared memories must include at least one subject in acl.subjects.');
    }
    if (
      resolvedAcl.visibility !== 'private' &&
      piiFlags === undefined &&
      hasSensitivePii(resolveStoredPiiFlags(existingDoc, scope.byokKey))
    ) {
      throw new Error('Cannot expose PII beyond private scope. Clear PII or adjust ACL.');
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
      resolveAcl(null, scope.subjectId);
    if (hasSensitivePii(resolvedFlags) && effectiveAcl.visibility !== 'private') {
      throw new Error('Cannot expose PII beyond private scope.');
    }

    if (resolvedFlags && Object.keys(resolvedFlags).length > 0) {
      const piiEncryption = encryptPiiFlags(resolvedFlags, scope.byokKey);
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

  const provenanceEntry = createProvenanceEvent({
    event: 'updated',
    actor: scope.subjectId,
    description: 'Memory metadata updated'
  });
  const provenanceHistory = Array.isArray(existingDoc.provenance)
    ? [...existingDoc.provenance, provenanceEntry]
    : [provenanceEntry];
  update.provenance = provenanceHistory;
  response.provenance = provenanceHistory;

  type MemoryDoc = typeof dbMemories['_type'];
  const operations: UpdateFilter<MemoryDoc> = {};
  if (Object.keys(update).length > 0) {
    operations.$set = update as Partial<MemoryDoc>;
  }
  if (Object.keys(unset).length > 0) {
    operations.$unset = unset as Record<string, '' | 1 | true>;
  }

  const result = await dbMemories.updateOne({ _id: objectId, ...memoryScopeFilter(scope) }, operations);

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
      const scopeBase = parseTenantFromHeaders(normalizedHeaders);
      const byokHeader = normalizedHeaders['x-capsule-byok'];
      const scope = byokHeader ? { ...scopeBase, byokKey: byokHeader } : scopeBase;
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
    path: '/v1/memories/capture',
    handlers: {
      get: withAuth(async (params, scope) => {
        const query = typeof params.query === 'object' && params.query ? params.query : {};
        const parsed = captureListSchema.parse({
          ...query,
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId: scope.subjectId
        });
        const tenant = ensureTenant(parsed, { allowFallback: false });
        const status = parsed.status ?? 'pending';
        const limit = parsed.limit ?? 50;
        const items = await listCaptureCandidates(tenant, status, limit);
        return buildResponse({ items });
      }),
      post: withAuth(async (params, scope) => {
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = captureRequestSchema.parse({
          ...body,
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId: scope.subjectId
        });
        const tenant = ensureTenant(parsed, { allowFallback: false });
        const events = (parsed.events as CaptureEventSchemaInput[]).map((event) => ({
          id: event.id,
          role: event.role,
          content: event.content,
          metadata: event.metadata,
          autoAccept: event.autoAccept,
          memory: event.memory ?? null
        }));
        const summary = await scoreCaptureEvents(tenant, events, parsed.threshold);
        return buildResponse(summary, 202);
      })
    }
  },
  {
    path: '/v1/memories/capture/:id/approve',
    handlers: {
      post: withAuth(async (params, scope) => {
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = captureApproveSchema.parse({
          ...body,
          id: params.params.id,
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId: scope.subjectId
        });
        const tenant = ensureTenant(parsed, { allowFallback: false });
        const result = await approveCaptureCandidate(tenant, parsed.id, parsed.memory ?? null);
        return buildResponse(result, 201);
      })
    }
  },
  {
    path: '/v1/memories/capture/:id/reject',
    handlers: {
      post: withAuth(async (params, scope) => {
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = captureRejectSchema.parse({
          ...body,
          id: params.params.id,
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId: scope.subjectId
        });
        const tenant = ensureTenant(parsed, { allowFallback: false });
        const result = await rejectCaptureCandidate(tenant, parsed.id, parsed.reason);
        return buildResponse(result);
      })
    }
  },
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
              : undefined,
          retention: typeof query.retention === 'string' ? query.retention : undefined
        });

        const tenant = ensureTenant(parsed, { allowFallback: false });
        const result = await listMemories(tenant, {
          limit: parsed.limit,
          pinned: parsed.pinned,
          tag: parsed.tag,
          type: parsed.type ?? undefined,
          visibility: parsed.visibility ?? undefined,
          store: parsed.store ?? undefined,
          graphEnrich: parsed.graphEnrich ?? undefined,
          retention: parsed.retention ?? undefined
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
          idempotencyKey: parsed.idempotencyKey,
          type: parsed.type ?? undefined,
          lang: parsed.lang ?? undefined,
          importanceScore: parsed.importanceScore ?? undefined,
          recencyScore: parsed.recencyScore ?? undefined,
          source: parsed.source ?? undefined,
          acl: parsed.acl ?? undefined,
          piiFlags: parsed.piiFlags ?? undefined,
          storage: parsed.storage ?? undefined,
          retention: parsed.retention ?? undefined
        });
        return buildResponse(created, 201);
      })
    }
  },
  {
    path: '/v1/memories/search',
    handlers: {
      post: withAuth(async (params, scope, headers) => {
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = searchMemorySchema.parse({
          ...body,
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId: scope.subjectId
        });
        const tenant = ensureTenant(parsed, { allowFallback: false });
        const rewriteHeader = headers['x-capsule-rewrite'];
        const rerankHeader = headers['x-capsule-rerank'];
        const forceRewrite =
          rewriteHeader === 'true' ? true : rewriteHeader === 'false' ? false : undefined;
        const forceRerank =
          rerankHeader === 'true' ? true : rerankHeader === 'false' ? false : undefined;
        const result = await searchMemories(tenant, parsed.query, {
          limit: parsed.limit,
          recipe: parsed.recipe,
          prompt: parsed.prompt,
          forceRewrite,
          forceRerank
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
      post: withAuth(async (params, scope, headers) => {
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = recipePreviewSchema.parse({
          ...body,
          orgId: scope.orgId,
          projectId: scope.projectId,
          subjectId: scope.subjectId
        });
        const tenant = ensureTenant(parsed, { allowFallback: false });
        const rewriteHeader = headers['x-capsule-rewrite'];
        const rerankHeader = headers['x-capsule-rerank'];
        const forceRewrite =
          rewriteHeader === 'true' ? true : rewriteHeader === 'false' ? false : undefined;
        const forceRerank =
          rerankHeader === 'true' ? true : rerankHeader === 'false' ? false : undefined;
        const result = await previewRecipeSearch(
          tenant,
          parsed.recipe,
          parsed.query,
          parsed.limit,
          parsed.prompt,
          {
            forceRewrite,
            forceRerank
          }
        );
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
        if (parsed.type !== undefined) {
          updatePayload.type = parsed.type;
        }
        if (parsed.lang !== undefined) {
          updatePayload.lang = parsed.lang;
        }
        if (parsed.importanceScore !== undefined) {
          updatePayload.importanceScore = parsed.importanceScore;
        }
        if (parsed.recencyScore !== undefined) {
          updatePayload.recencyScore = parsed.recencyScore;
        }
        if (parsed.source !== undefined) {
          updatePayload.source = parsed.source;
        }
        if (parsed.acl !== undefined) {
          updatePayload.acl = parsed.acl;
        }
        if (parsed.piiFlags !== undefined) {
          updatePayload.piiFlags = parsed.piiFlags;
        }
        if (parsed.storage !== undefined) {
          updatePayload.storage = parsed.storage;
        }
        if (parsed.retention !== undefined) {
          updatePayload.retention = parsed.retention;
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
  stores: [dbMemories, dbGraphJobs, dbGraphEntities, dbMemoryCandidates],
  routes: apiRoutes,
  queries: {
    async getMemories(args) {
      const parsed = listMemoriesSchema.parse(args ?? {});

      try {
        const tenant = ensureTenant(parsed, { allowFallback: true });
        return await listMemories(tenant, {
          limit: parsed.limit,
          pinned: parsed.pinned,
          tag: parsed.tag,
          type: parsed.type ?? undefined,
          visibility: parsed.visibility ?? undefined,
          store: parsed.store ?? undefined,
          graphEnrich: parsed.graphEnrich ?? undefined,
          retention: parsed.retention ?? undefined
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
          recipe: parsed.recipe,
          prompt: parsed.prompt
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
    async listCaptureCandidates(args) {
      const parsed = captureListSchema.parse(args ?? {});
      const tenant = ensureTenant(parsed, { allowFallback: true });
      const status = parsed.status ?? 'pending';
      const limit = parsed.limit ?? 50;
      const items = await listCaptureCandidates(tenant, status, limit);
      return { items };
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
    async scoreCapture(args) {
      const parsed = captureRequestSchema.parse(args ?? {});
      const tenant = ensureTenant(parsed, { allowFallback: true });
      const events = (parsed.events as CaptureEventSchemaInput[]).map((event) => ({
        id: event.id,
        role: event.role,
        content: event.content,
        metadata: event.metadata,
        autoAccept: event.autoAccept,
        memory: event.memory ?? null
      }));
      return scoreCaptureEvents(tenant, events, parsed.threshold);
    },
    async addMemory(args) {
      const parsed = createMemorySchema.parse(args ?? {});

      try {
        const tenant = ensureTenant(parsed, { allowFallback: true });
        return await createMemory(tenant, {
          content: parsed.content,
          pinned: parsed.pinned,
          tags: parsed.tags,
          ttlSeconds: parsed.ttlSeconds,
          idempotencyKey: parsed.idempotencyKey,
          type: parsed.type ?? undefined,
          lang: parsed.lang ?? undefined,
          importanceScore: parsed.importanceScore ?? undefined,
          recencyScore: parsed.recencyScore ?? undefined,
          source: parsed.source ?? undefined,
          acl: parsed.acl ?? undefined,
          piiFlags: parsed.piiFlags ?? undefined,
          storage: parsed.storage ?? undefined,
          retention: parsed.retention ?? undefined
        });
      } catch (error) {
        if (isProvisioningError(error)) {
          throw new Error(PROVISIONING_HINT);
        }
        throw error;
      }
    },
    async approveCaptureCandidate(args) {
      const parsed = captureApproveSchema.parse(args ?? {});
      const tenant = ensureTenant(parsed, { allowFallback: true });
      return approveCaptureCandidate(tenant, parsed.id, parsed.memory ?? null);
    },
    async rejectCaptureCandidate(args) {
      const parsed = captureRejectSchema.parse(args ?? {});
      const tenant = ensureTenant(parsed, { allowFallback: true });
      return rejectCaptureCandidate(tenant, parsed.id, parsed.reason);
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
