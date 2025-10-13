import { Store, schema } from 'modelence/server';

export const dbGraphJobs = new Store('graph_jobs', {
  schema: {
    orgId: schema.string(),
    projectId: schema.string(),
    subjectId: schema.string(),
    memoryId: schema.string(),
    status: schema.enum(['pending', 'running', 'success', 'error']),
    error: schema.string().optional(),
    createdAt: schema.date(),
    updatedAt: schema.date(),
    attempts: schema.number().optional()
  },
  indexes: [
    { key: { status: 1, updatedAt: 1 } },
    { key: { memoryId: 1 }, unique: true }
  ]
});

export const dbGraphEntities = new Store('graph_entities', {
  schema: {
    orgId: schema.string(),
    projectId: schema.string(),
    entity: schema.string(),
    memoryIds: schema.array(schema.string()),
    lastSeenAt: schema.date()
  },
  indexes: [
    { key: { orgId: 1, projectId: 1, entity: 1 }, unique: true },
    { key: { lastSeenAt: -1 } }
  ]
});
