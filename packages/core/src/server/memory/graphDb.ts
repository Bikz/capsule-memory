import { Store, schema } from 'modelence/server';
import type { ModelSchema } from 'modelence/server';

const graphJobSchema: ModelSchema = {
  orgId: schema.string(),
  projectId: schema.string(),
  subjectId: schema.string(),
  memoryId: schema.string(),
  status: schema.enum(['pending', 'running', 'success', 'error']),
  error: schema.string().optional(),
  createdAt: schema.date(),
  updatedAt: schema.date(),
  attempts: schema.number().optional()
};

type GraphJobSchema = typeof graphJobSchema;

export const dbGraphJobs: Store<GraphJobSchema, Record<string, never>> = new Store('graph_jobs', {
  schema: graphJobSchema,
  indexes: [
    { key: { status: 1, updatedAt: 1 } },
    { key: { memoryId: 1 }, unique: true }
  ]
});

const graphEntitySchema: ModelSchema = {
  orgId: schema.string(),
  projectId: schema.string(),
  entity: schema.string(),
  memoryIds: schema.array(schema.string()),
  lastSeenAt: schema.date()
};

type GraphEntitySchema = typeof graphEntitySchema;

export const dbGraphEntities: Store<GraphEntitySchema, Record<string, never>> = new Store('graph_entities', {
  schema: graphEntitySchema,
  indexes: [
    { key: { orgId: 1, projectId: 1, entity: 1 }, unique: true },
    { key: { lastSeenAt: -1 } }
  ]
});
