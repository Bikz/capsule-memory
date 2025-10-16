import { Store, schema } from 'modelence/server';
import type { ModelSchema } from 'modelence/server';

export const EMBEDDING_DIMENSIONS = 1024;

const memorySchema: ModelSchema = {
  orgId: schema.string(),
  projectId: schema.string(),
  subjectId: schema.string(),
  content: schema.string(),
  lang: schema.string().optional(),
  embedding: schema.array(schema.number()),
  embeddingNorm: schema.number(),
  embeddingModel: schema.string(),
  createdAt: schema.date(),
  updatedAt: schema.date(),
  pinned: schema.boolean(),
  ttlSeconds: schema.number().optional(),
  importanceScore: schema.number(),
  recencyScore: schema.number(),
  type: schema.string().optional(),
  tags: schema.array(schema.string()).optional(),
  expiresAt: schema.date().optional(),
  idempotencyKey: schema.string().optional(),
  retention: schema.enum(['irreplaceable', 'permanent', 'replaceable', 'ephemeral']).optional(),
  source: schema
    .object({
      app: schema.string().optional(),
      connector: schema.string().optional(),
      url: schema.string().optional(),
      fileId: schema.string().optional(),
      spanId: schema.string().optional()
    })
    .optional(),
  provenance: schema
    .array(
      schema.object({
        event: schema.string(),
        at: schema.date(),
        actor: schema.string().optional(),
        description: schema.string().optional(),
        referenceId: schema.string().optional()
      })
    )
    .optional(),
  acl: schema
    .object({
      visibility: schema.enum(['private', 'shared', 'public']),
      subjects: schema.array(schema.string()).optional()
    })
    .optional(),
  piiFlags: schema.object({}).catchall(schema.boolean()).optional(),
  piiFlagsCipher: schema.string().optional(),
  graphEnrich: schema.boolean().optional(),
  storage: schema
    .object({
      store: schema.enum(['short_term', 'long_term', 'capsule_graph']),
      policies: schema.array(schema.string()),
      graphEnrich: schema.boolean().optional(),
      dedupeThreshold: schema.number().optional()
    })
    .optional(),
  explanation: schema.string().optional()
};

type MemorySchema = typeof memorySchema;

export const dbMemories: Store<MemorySchema, Record<string, never>> = new Store('memories', {
  schema: memorySchema,
  indexes: [
    { key: { orgId: 1, projectId: 1, subjectId: 1, createdAt: -1 } },
    { key: { orgId: 1, projectId: 1, createdAt: -1 } },
    {
      key: { orgId: 1, projectId: 1, subjectId: 1, idempotencyKey: 1 },
      unique: true,
      sparse: true
    },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    { key: { createdAt: -1 } },
    { key: { pinned: 1, importanceScore: -1, recencyScore: -1, createdAt: -1 } },
    { key: { orgId: 1, projectId: 1, type: 1, createdAt: -1 } },
    { key: { orgId: 1, projectId: 1, 'acl.visibility': 1, createdAt: -1 } },
    { key: { orgId: 1, projectId: 1, tags: 1 } },
    { key: { orgId: 1, projectId: 1, 'storage.store': 1, createdAt: -1 } },
    { key: { orgId: 1, projectId: 1, graphEnrich: 1, createdAt: -1 } },
    { key: { orgId: 1, projectId: 1, retention: 1, createdAt: -1 } }
  ]
});
