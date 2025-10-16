import type { CapsuleMeta, MemoryStore, StoreWrite } from '@capsule/core';
import { QdrantClient } from '@qdrant/js-client-rest';

export interface QdrantStoreOptions {
  vectorSize?: number;
}

export class QdrantStore implements MemoryStore {
  private readonly client: QdrantClient;
  private readonly collection: string;
  private readonly zeroVector: number[];

  constructor(client: QdrantClient, collection: string, options: QdrantStoreOptions = {}) {
    this.client = client;
    this.collection = collection;
    const size = options.vectorSize ?? 3;
    this.zeroVector = Array.from({ length: size }, () => 0);
  }

  async add(input: StoreWrite): Promise<CapsuleMeta> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const meta: CapsuleMeta = { id, createdAt: now, ...input.meta };
    await this.client.upsert(this.collection, {
      wait: true,
      points: [
        {
          id,
          vector: this.zeroVector,
          payload: { content: input.content, meta }
        }
      ]
    });
    return meta;
  }

  async get(id: string) {
    const result = await this.client.retrieve(this.collection, {
      ids: [id],
      with_payload: true,
      with_vector: false
    });
    const point = result[0];
    if (!point || !point.payload) {
      return null;
    }
    return {
      content: (point.payload.content as string) ?? '',
      meta: point.payload.meta as CapsuleMeta
    };
  }

  async search(_query: string, k = 5) {
    const result = await this.client.scroll(this.collection, {
      limit: k,
      with_payload: true,
      with_vector: false
    });
    return result.points.map((point, index) => ({
      id: String(point.id ?? ''),
      score: 1 - index * 0.1
    }));
  }

  async pin(id: string) {
    await this.client.setPayload(this.collection, {
      points: [id],
      payload: { 'meta.pinned': true }
    });
  }

  async remove(id: string) {
    await this.client.delete(this.collection, { points: [id] });
  }
}
