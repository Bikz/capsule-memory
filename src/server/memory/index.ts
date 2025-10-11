import { Module, ObjectId } from 'modelence/server';
import { z } from 'zod';

import { dbMemories, EMBEDDING_DIMENSIONS } from './db';
import { generateEmbedding } from './voyage';

type MemoryDocument = typeof dbMemories.Doc;

const MAX_MEMORIES = 100;

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
  const { embedding, embeddingNorm, explanation, _id, ...rest } = doc;
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

const PROVISIONING_HINT =
  'Memory store is not provisioned yet. Configure a MongoDB connection (e.g., MONGO_URL) and restart the server.';

export default new Module('memory', {
  stores: [dbMemories],
  queries: {
    async getMemories(args) {
      const { limit } = z
        .object({
          limit: z.number().int().positive().max(200).optional()
        })
        .parse(args ?? {});

      try {
        const memories = await dbMemories.fetch(
          {},
          {
            sort: { pinned: -1, createdAt: -1 },
            limit: limit ?? 50
          }
        );

        return {
          items: memories.map(toClientMemory),
          explanation: `Loaded ${memories.length} most recent memories.`
        };
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
      const { query, limit } = z
        .object({
          query: z.string().min(1),
          limit: z.number().int().positive().max(50).optional()
        })
        .parse(args);

      try {
        const queryEmbedding = normalizeEmbedding(await generateEmbedding(query, 'query'));

        const candidates = await dbMemories.fetch({}, { sort: { createdAt: -1 }, limit: 500 });

        const scored = candidates
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
          query,
          results: scored,
          explanation: `Found ${scored.length} memory item(s) using semantic similarity.`
        };
      } catch (error) {
        if (isProvisioningError(error)) {
          return {
            query,
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
      const { content, pinned } = z
        .object({
          content: z.string().min(1),
          pinned: z.boolean().optional()
        })
        .parse(args);

      try {
        const rawEmbedding = await generateEmbedding(content, 'document');
        const { embedding, norm } = normalizeEmbedding(rawEmbedding);

        const createdAt = new Date();
        const pinnedValue = pinned ?? false;

        const { insertedId } = await dbMemories.insertOne({
          content,
          embedding,
          embeddingNorm: norm,
          createdAt,
          pinned: pinnedValue,
          explanation: 'Memory added via addMemory mutation.'
        });

        let policyMessage = 'Memory saved successfully.';
        let forgottenMemoryId: string | null = null;

        const total = await dbMemories.countDocuments({});
        if (total > MAX_MEMORIES) {
          const oldest = await dbMemories.findOne(
            { pinned: false },
            { sort: { createdAt: 1 } }
          );

          if (oldest) {
            await dbMemories.deleteOne({ _id: oldest._id });
            const removedId = oldest._id.toString();
            policyMessage = `Memory limit exceeded. Automatically removed the oldest unpinned memory (ID: ${removedId}).`;
            forgottenMemoryId = removedId;
          }
        }

        return {
          id: insertedId.toString(),
          content,
          pinned: pinnedValue,
          createdAt,
          explanation: policyMessage,
          forgottenMemoryId
        };
      } catch (error) {
        if (isProvisioningError(error)) {
          throw new Error(PROVISIONING_HINT);
        }
        throw error;
      }
    },
    async pinMemory(args) {
      const { id, pin } = z
        .object({
          id: z.string(),
          pin: z.boolean().optional()
        })
        .parse(args);

      const pinnedValue = pin ?? true;
      try {
        const result = await dbMemories.updateOne(
          { _id: toObjectId(id) },
          { $set: { pinned: pinnedValue } }
        );

        if (result.matchedCount === 0) {
          throw new Error('Memory not found.');
        }

        return {
          success: true,
          pinned: pinnedValue,
          explanation: pinnedValue ? 'Memory pinned.' : 'Memory unpinned.'
        };
      } catch (error) {
        if (isProvisioningError(error)) {
          throw new Error(PROVISIONING_HINT);
        }
        throw error;
      }
    },
    async deleteMemory(args) {
      const { id, reason } = z
        .object({
          id: z.string(),
          reason: z.string().optional()
        })
        .parse(args);

      try {
        const deletion = await dbMemories.deleteOne({ _id: toObjectId(id) });

        if (deletion.deletedCount === 0) {
          throw new Error('Memory not found.');
        }

        return {
          success: true,
          explanation: reason ? `Memory forgotten: ${reason}` : 'Memory forgotten.'
        };
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
