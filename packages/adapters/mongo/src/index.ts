import type { CapsuleMeta, MemoryStore, StoreWrite } from '@capsule/core';
import { Collection, Db, ObjectId } from 'mongodb';

export class MongoStore implements MemoryStore {
  private readonly collection: Collection;

  constructor(db: Db, collectionName = 'capsules') {
    this.collection = db.collection(collectionName);
  }

  async add(input: StoreWrite): Promise<CapsuleMeta> {
    const objectId = new ObjectId();
    const now = new Date().toISOString();
    const meta: CapsuleMeta = { id: objectId.toHexString(), createdAt: now, ...input.meta };
    await this.collection.insertOne({ _id: objectId, content: input.content, meta });
    return meta;
  }

  async get(id: string) {
    const doc = await this.collection.findOne({ _id: new ObjectId(id) });
    return doc ? { content: doc.content as string, meta: doc.meta as CapsuleMeta } : null;
  }

  async search(_query: string, k = 5) {
    const docs = await this.collection
      .find()
      .sort({ 'meta.createdAt': -1 })
      .limit(k)
      .toArray();
    return docs.map((doc, index) => ({ id: (doc._id as ObjectId).toHexString(), score: 1 - index * 0.1 }));
  }

  async pin(id: string) {
    await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: { 'meta.pinned': true } });
  }

  async remove(id: string) {
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }
}
