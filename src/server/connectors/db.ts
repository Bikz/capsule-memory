import { Store, schema } from 'modelence/server';

export type ConnectorStatus = 'pending' | 'running' | 'success' | 'error';

export const dbConnectorJobs = new Store('connector_jobs', {
  schema: {
    connectorId: schema.string(),
    provider: schema.string(),
    status: schema.enum(['pending', 'running', 'success', 'error']),
    dataset: schema.string().optional(),
    error: schema.string().optional(),
    itemCount: schema.number().optional(),
    metadata: schema.object({}).optional(),
    createdAt: schema.date(),
    updatedAt: schema.date(),
    startedAt: schema.date().optional(),
    finishedAt: schema.date().optional()
  },
  indexes: [
    { key: { connectorId: 1, createdAt: -1 } },
    { key: { status: 1, updatedAt: -1 } }
  ]
});
