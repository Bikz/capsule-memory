import { Store, schema } from 'modelence/server';
import type { ModelSchema } from 'modelence/server';

export type ConnectorStatus = 'pending' | 'running' | 'success' | 'error';

const connectorJobSchema: ModelSchema = {
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
};

type ConnectorJobSchema = typeof connectorJobSchema;

export const dbConnectorJobs: Store<ConnectorJobSchema, Record<string, never>> = new Store('connector_jobs', {
  schema: connectorJobSchema,
  indexes: [
    { key: { connectorId: 1, createdAt: -1 } },
    { key: { status: 1, updatedAt: -1 } }
  ]
});
