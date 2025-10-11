import { Store, schema } from 'modelence/server';

export const EMBEDDING_DIMENSIONS = 1024;

export const dbMemories = new Store('memories', {
  schema: {
    content: schema.string(),
    embedding: schema.array(schema.number()),
    embeddingNorm: schema.number(),
    createdAt: schema.date(),
    pinned: schema.boolean(),
    explanation: schema.string().optional()
  },
  indexes: [
    { key: { createdAt: -1 } },
    { key: { pinned: 1, createdAt: -1 } }
  ]
});
