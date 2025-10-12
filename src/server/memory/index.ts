import { Module, ObjectId, type RouteDefinition, type RouteParams } from 'modelence/server';
import { z } from 'zod';

import { dbMemories, EMBEDDING_DIMENSIONS } from './db';
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

type CreateMemoryInput = {
  content: string;
  pinned?: boolean;
  tags?: string[];
  ttlSeconds?: number;
  idempotencyKey?: string;
};

type UpdateMemoryInput = {
  pinned?: boolean;
  tags?: string[] | null;
  ttlSeconds?: number | null;
};

type MemoryListFilters = {
  limit?: number;
  pinned?: boolean;
  tag?: string;
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
  idempotencyKey: z.string().min(1).max(128).optional()
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
    .optional()
});

const pinMemorySchema = tenantArgSchema.extend({
  id: z.string().min(1),
  pin: z.boolean().optional()
});

const listMemoriesSchema = tenantArgSchema.extend({
  limit: z.number().int().positive().max(200).optional(),
  pinned: z.boolean().optional(),
  tag: z.string().min(1).optional()
});

const searchMemorySchema = tenantArgSchema.extend({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).optional()
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
  const { embedding, embeddingNorm, _id, ...rest } = doc;
  return {
    id: _id.toString(),
    ...rest
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

function computeExpirationDate(createdAt: Date, ttlSeconds?: number | null): Date | undefined {
  if (!ttlSeconds || ttlSeconds <= 0) {
    return undefined;
  }
  return new Date(createdAt.getTime() + ttlSeconds * 1000);
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

  const rawEmbedding = await generateEmbedding(content, 'document');
  const { embedding, norm } = normalizeEmbedding(rawEmbedding);

  const createdAt = new Date();
  const expiresAt = computeExpirationDate(createdAt, ttlSeconds);
  const pinnedValue = pinned ?? false;
  const sanitizedTags = sanitizeTags(tags);

  const doc = {
    ...filter,
    content,
    embedding,
    embeddingNorm: norm,
    createdAt,
    pinned: pinnedValue,
    ...(sanitizedTags ? { tags: sanitizedTags } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    explanation: 'Memory added via Capsule Memory.'
  };

  const { insertedId } = await dbMemories.insertOne(doc);

  const retention = await applyRetentionPolicy(scope);

  return {
    id: insertedId.toString(),
    ...filter,
    content,
    createdAt,
    pinned: pinnedValue,
    ...(sanitizedTags ? { tags: sanitizedTags } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    explanation: retention.explanation,
    forgottenMemoryId: retention.forgottenMemoryId
  };
}

async function listMemories(
  scope: TenantScope,
  filters: MemoryListFilters
): Promise<{ items: ReturnType<typeof toClientMemory>[]; explanation: string }> {
  const { limit, pinned, tag } = filters;
  const query: Record<string, unknown> = { ...memoryScopeFilter(scope) };

  if (typeof pinned === 'boolean') {
    query.pinned = pinned;
  }

  if (tag) {
    query.tags = tag;
  }

  const memories = await dbMemories.fetch(query, {
    sort: { pinned: -1, createdAt: -1 },
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
  limit?: number
): Promise<{
  query: string;
  results: Array<ReturnType<typeof toClientMemory> & { score: number }>;
  explanation: string;
}> {
  const queryEmbedding = normalizeEmbedding(await generateEmbedding(queryString, 'query'));

  const candidates = await dbMemories.fetch(memoryScopeFilter(scope), {
    sort: { createdAt: -1 },
    limit: 500
  });

  const results = candidates
    .map((doc) => ({
      doc,
      score: cosineSimilarity(
        queryEmbedding.embedding,
        queryEmbedding.norm,
        doc.embedding,
        doc.embeddingNorm
      )
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit ?? 10)
    .map(({ doc, score }) => ({
      ...toClientMemory(doc),
      score
    }));

  return {
    query: queryString,
    results,
    explanation: `Found ${results.length} memory item(s) using semantic similarity.`
  };
}

async function updateMemory(scope: TenantScope, input: UpdateMemoryInput & { id: string }) {
  const { id, pinned, tags, ttlSeconds } = input;
  const update: Record<string, unknown> = {};
  const unset: Record<string, unknown> = {};

  if (typeof pinned === 'boolean') {
    update.pinned = pinned;
  }

  if (tags !== undefined) {
    const sanitized = sanitizeTags(tags);
    if (sanitized) {
      update.tags = sanitized;
    } else {
      unset.tags = '';
    }
  }

  if (ttlSeconds !== undefined) {
    if (ttlSeconds === null) {
      unset.expiresAt = '';
    } else {
      const baseDate = new Date();
      const expiresAt = computeExpirationDate(baseDate, ttlSeconds);
      if (expiresAt) {
        update.expiresAt = expiresAt;
      } else {
        unset.expiresAt = '';
      }
    }
  }

  if (Object.keys(update).length === 0 && Object.keys(unset).length === 0) {
    return {
      success: true,
      explanation: 'No changes applied.'
    };
  }

  const result = await dbMemories.updateOne(
    { _id: toObjectId(id), ...memoryScopeFilter(scope) },
    {
      ...(Object.keys(update).length > 0 ? { $set: update } : {}),
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {})
    }
  );

  if (result.matchedCount === 0) {
    throw new Error('Memory not found.');
  }

  return {
    success: true,
    explanation: 'Memory metadata updated.',
    ...(typeof pinned === 'boolean' ? { pinned } : {})
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
          tag: typeof query.tag === 'string' ? query.tag : undefined
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
        const result = await searchMemories(tenant, parsed.query, parsed.limit);
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
  stores: [dbMemories],
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
        return await searchMemories(tenant, parsed.query, parsed.limit);
      } catch (error) {
        if (isProvisioningError(error)) {
          return {
            query: parsed.query,
            results: [],
            explanation: PROVISIONING_HINT
          };
        }
        throw error;
      }
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
