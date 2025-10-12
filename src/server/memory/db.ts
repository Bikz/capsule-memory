import { Store, schema } from 'modelence/server';

export const EMBEDDING_DIMENSIONS = 1024;

export const dbMemories = new Store('memories', {
  schema: {
    orgId: schema.string(),
    projectId: schema.string(),
    subjectId: schema.string(),
    content: schema.string(),
    embedding: schema.array(schema.number()),
    embeddingNorm: schema.number(),
    createdAt: schema.date(),
    pinned: schema.boolean(),
    tags: schema.array(schema.string()).optional(),
    expiresAt: schema.date().optional(),
    idempotencyKey: schema.string().optional(),
    explanation: schema.string().optional()
  },
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
    { key: { pinned: 1, createdAt: -1 } }
  ]
});
