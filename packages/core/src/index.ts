export type CapsuleId = string;

export interface CapsuleMeta {
  id: CapsuleId;
  org?: string;
  project?: string;
  subject?: string;
  type?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  ttl?: number;
  expiryAt?: string;
  pinned?: boolean;
  importance?: number;
  recencyScore?: number;
  source?: {
    app?: string;
    connector?: string;
    url?: string;
    fileId?: string;
    spanId?: string;
  };
  provenance?: string[];
  acl?: { visibility?: 'private' | 'org' | 'public'; roles?: string[] };
  pii?: Record<string, boolean>;
}

export interface StoreWrite {
  content: string;
  meta?: Partial<CapsuleMeta>;
}

export interface MemoryStore {
  add(input: StoreWrite): Promise<CapsuleMeta>;
  get(id: CapsuleId): Promise<{ content: string; meta: CapsuleMeta } | null>;
  search(query: string, k?: number): Promise<Array<{ id: CapsuleId; score: number }>>;
  pin(id: CapsuleId): Promise<void>;
  remove(id: CapsuleId): Promise<void>;
}

export class InMemoryStore implements MemoryStore {
  private readonly store = new Map<CapsuleId, { content: string; meta: CapsuleMeta }>();

  async add(input: StoreWrite) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const meta: CapsuleMeta = { id, createdAt: now, ...input.meta };
    this.store.set(id, { content: input.content, meta });
    return meta;
  }

  async get(id: CapsuleId) {
    return this.store.get(id) ?? null;
  }

  async search(_query: string, k = 5) {
    const ids = [...this.store.keys()].slice(0, k);
    return ids.map((recordId, index) => ({ id: recordId, score: 1 - index * 0.1 }));
  }

  async pin(id: CapsuleId) {
    const record = this.store.get(id);
    if (record) {
      record.meta.pinned = true;
      this.store.set(id, record);
    }
  }

  async remove(id: CapsuleId) {
    this.store.delete(id);
  }
}

export { default as memoryModule } from './server/memory';
export { default as connectorsModule } from './server/connectors';

export type {
  ConversationEvent,
  CaptureScore,
  CaptureScoreOptions,
  ConversationRole
} from './server/memory/capture';
export { scoreConversationEvent, batchScoreEvents } from './server/memory/capture';
