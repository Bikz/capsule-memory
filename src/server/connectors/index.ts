import { Module, ObjectId, type RouteDefinition, type RouteParams } from 'modelence/server';
import { z } from 'zod';

import connectorsCatalog from '../../../config/connectors.json' assert { type: 'json' };
import { dbConnectorJobs } from './db';

const API_KEY_HEADER = 'x-capsule-key';
const AUTHORIZATION_HEADER = 'authorization';
const ALLOWED_API_KEYS = (process.env.CAPSULE_API_KEYS ?? 'demo-key')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const CONNECTORS = connectorsCatalog as ReadonlyArray<{
  id: string;
  provider: string;
  label: string;
  description?: string;
  docs?: string;
  env?: string[];
  polling?: string;
  tags?: string[];
}>;

const connectorIdSchema = z.enum(CONNECTORS.map((connector) => connector.id) as [string, ...string[]]);

const scheduleJobSchema = z.object({
  connectorId: connectorIdSchema,
  dataset: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional()
});

const updateJobSchema = z.object({
  jobId: z.string().min(1),
  status: z.enum(['pending', 'running', 'success', 'error']).optional(),
  itemCount: z.number().int().nonnegative().optional(),
  error: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.any()).optional()
});

function normalizeHeaders(headers: Record<string, string>) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function extractApiKey(headers: Record<string, string>): string | undefined {
  const normalized = normalizeHeaders(headers);
  if (normalized[API_KEY_HEADER]) {
    return normalized[API_KEY_HEADER];
  }
  const auth = normalized[AUTHORIZATION_HEADER];
  if (!auth) {
    return undefined;
  }
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return auth.trim();
}

function buildResponse(data: unknown, status = 200) {
  return { data, status } as const;
}

type AuthedRouteHandler = (
  params: RouteParams,
  headers: Record<string, string>
) => Promise<ReturnType<typeof buildResponse>>;

function withAuth(handler: AuthedRouteHandler) {
  return async (params: RouteParams) => {
    const normalizedHeaders = normalizeHeaders((params.headers ?? {}) as Record<string, string>);
    if (ALLOWED_API_KEYS.length > 0) {
      const apiKey = extractApiKey(normalizedHeaders);
      if (!apiKey || !ALLOWED_API_KEYS.includes(apiKey)) {
        return buildResponse({ error: 'Unauthorized' }, 401);
      }
    }

    try {
      return await handler(params, normalizedHeaders);
    } catch (error) {
      console.error('[Capsule] Connector handler failed:', error);
      return buildResponse({ error: 'Internal server error' }, 500);
    }
  };
}

async function listConnectorSummaries() {
  const results = [];
  for (const connector of CONNECTORS) {
    const latest = await dbConnectorJobs.findOne(
      { connectorId: connector.id },
      { sort: { createdAt: -1 } }
    );
    results.push({
      ...connector,
      latestJob: latest
        ? {
            id: latest._id.toString(),
            status: latest.status,
            itemCount: latest.itemCount ?? 0,
            updatedAt: latest.updatedAt,
            error: latest.error ?? null
          }
        : null
    });
  }
  return results;
}

const apiRoutes: RouteDefinition[] = [
  {
    path: '/v1/connectors',
    handlers: {
      get: withAuth(async (_params, _headers) => {
        const connectors = await listConnectorSummaries();
        return buildResponse({ connectors });
      })
    }
  },
  {
    path: '/v1/connectors/jobs',
    handlers: {
      get: withAuth(async (_params, _headers) => {
        const jobs = await dbConnectorJobs.fetch({}, { sort: { createdAt: -1 }, limit: 100 });
        return buildResponse({
          jobs: jobs.map((job) => ({
            id: job._id.toString(),
            ...job
          }))
        });
      })
    }
  },
  {
    path: '/v1/connectors/:id/jobs',
    handlers: {
      post: withAuth(async (params, _headers) => {
        const connectorId = params.params.id;
        if (!CONNECTORS.find((item) => item.id === connectorId)) {
          return buildResponse({ error: 'Unknown connector' }, 404);
        }
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = scheduleJobSchema.parse({ connectorId, ...body });
        const timestamp = new Date();
        const { insertedId } = await dbConnectorJobs.insertOne({
          connectorId: parsed.connectorId,
          provider: CONNECTORS.find((item) => item.id === parsed.connectorId)?.provider ?? parsed.connectorId,
          status: 'pending',
          dataset: parsed.dataset,
          metadata: parsed.metadata,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        return buildResponse({ jobId: insertedId.toString() }, 201);
      })
    }
  },
  {
    path: '/v1/connectors/jobs/:jobId',
    handlers: {
      patch: withAuth(async (params, _headers) => {
        const jobId = params.params.jobId;
        const body = typeof params.body === 'object' && params.body ? params.body : {};
        const parsed = updateJobSchema.parse({ jobId, ...body });
        const job = await dbConnectorJobs.findById(new ObjectId(parsed.jobId));
        if (!job) {
          return buildResponse({ error: 'Job not found' }, 404);
        }
        const update: Record<string, unknown> = { updatedAt: new Date() };
        if (parsed.status) {
          update.status = parsed.status;
          if (parsed.status === 'running') {
            update.startedAt = new Date();
          }
          if (parsed.status === 'success' || parsed.status === 'error') {
            update.finishedAt = new Date();
          }
        }
        if (parsed.itemCount !== undefined) {
          update.itemCount = parsed.itemCount;
        }
        if (parsed.metadata) {
          update.metadata = parsed.metadata;
        }
        if (parsed.error !== undefined) {
          update.error = parsed.error ?? undefined;
        }
        await dbConnectorJobs.updateOne({ _id: job._id }, { $set: update });
        return buildResponse({ ok: true });
      })
    }
  }
];

export default new Module('connectors', {
  stores: [dbConnectorJobs],
  routes: apiRoutes,
  queries: {
    async listConnectors() {
      return {
        connectors: await listConnectorSummaries()
      };
    },
    async listJobs(args) {
      const limit = typeof args?.limit === 'number' ? Math.min(Math.max(args.limit, 1), 200) : 50;
      const jobs = await dbConnectorJobs.fetch({}, { sort: { createdAt: -1 }, limit });
      return {
        jobs: jobs.map((job) => ({ id: job._id.toString(), ...job }))
      };
    }
  },
  mutations: {
    async scheduleIngestion(args) {
      const parsed = scheduleJobSchema.parse(args ?? {});
      const timestamp = new Date();
      const { insertedId } = await dbConnectorJobs.insertOne({
        connectorId: parsed.connectorId,
        provider: CONNECTORS.find((item) => item.id === parsed.connectorId)?.provider ?? parsed.connectorId,
        status: 'pending',
        dataset: parsed.dataset,
        metadata: parsed.metadata,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      return {
        jobId: insertedId.toString()
      };
    },
    async updateIngestionJob(args) {
      const parsed = updateJobSchema.parse(args ?? {});
      const job = await dbConnectorJobs.findById(new ObjectId(parsed.jobId));
      if (!job) {
        throw new Error('Job not found');
      }
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.status) {
        update.status = parsed.status;
        if (parsed.status === 'running') {
          update.startedAt = new Date();
        }
        if (parsed.status === 'success' || parsed.status === 'error') {
          update.finishedAt = new Date();
        }
      }
      if (parsed.itemCount !== undefined) {
        update.itemCount = parsed.itemCount;
      }
      if (parsed.metadata) {
        update.metadata = parsed.metadata;
      }
      if (parsed.error !== undefined) {
        update.error = parsed.error ?? undefined;
      }
      await dbConnectorJobs.updateOne({ _id: job._id }, { $set: update });
      return {
        ok: true
      };
    }
  }
});
