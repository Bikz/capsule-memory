import type { CapsuleMeta, MemoryStore, StoreWrite } from '@capsule/core';
import { Pool } from 'pg';

export interface PgVectorStoreOptions {
  table?: string;
}

export class PgVectorStore implements MemoryStore {
  private readonly pool: Pool;
  private readonly table: string;

  constructor(pool: Pool, options: PgVectorStoreOptions = {}) {
    this.pool = pool;
    this.table = options.table ?? 'capsules';
  }

  async add(input: StoreWrite): Promise<CapsuleMeta> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const meta: CapsuleMeta = { id, createdAt: now, ...input.meta };
    await this.pool.query('insert into ' + this.table + ' (id, content, meta) values ($1, $2, $3)', [
      id,
      input.content,
      meta
    ]);
    return meta;
  }

  async get(id: string) {
    const { rows } = await this.pool.query<{ content: string; meta: CapsuleMeta }>(
      'select content, meta from ' + this.table + ' where id = $1 limit 1',
      [id]
    );
    const [row] = rows;
    if (!row) return null;
    return { content: row.content, meta: row.meta };
  }

  async search(_query: string, k = 5) {
    const { rows } = await this.pool.query<{ id: string }>(
      "select id from " + this.table + " order by meta->>'createdAt' desc limit $1",
      [k]
    );
    return rows.map((row: { id: string }, index: number) => ({ id: row.id, score: 1 - index * 0.1 }));
  }

  async pin(id: string) {
    await this.pool.query(
      "update " +
        this.table +
        " set meta = jsonb_set(meta, '{pinned}', 'true'::jsonb, true) where id = $1",
      [id]
    );
  }

  async remove(id: string) {
    await this.pool.query('delete from ' + this.table + ' where id = $1', [id]);
  }
}
