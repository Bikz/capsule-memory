import { ObjectId } from 'modelence/server';

import { dbMemories } from './db';
import { dbGraphEntities, dbGraphJobs } from './graphDb';

const MAX_ATTEMPTS = 3;
const WORKER_INTERVAL_MS = Number.parseInt(process.env.CAPSULE_GRAPH_WORKER_INTERVAL ?? '5000', 10);
let workerStarted = false;

function now() {
  return new Date();
}

function extractEntities(content: string): string[] {
  const matches = content.match(/\b[A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*\b/g);
  if (!matches) {
    return [];
  }
  const cleaned = matches
    .map((value) => value.trim())
    .filter((value) => value.length >= 3 && !/^[A-Z]{2,}$/.test(value));
  return Array.from(new Set(cleaned)).slice(0, 25);
}

export async function scheduleGraphJob(params: {
  orgId: string;
  projectId: string;
  subjectId: string;
  memoryId: string;
}) {
  const existing = await dbGraphJobs.findOne({ memoryId: params.memoryId });
  const timestamp = now();
  if (existing) {
    await dbGraphJobs.updateOne(
      { _id: existing._id },
      {
        $set: {
          status: 'pending',
          updatedAt: timestamp,
          error: undefined
        }
      }
    );
  } else {
    await dbGraphJobs.insertOne({
      orgId: params.orgId,
      projectId: params.projectId,
      subjectId: params.subjectId,
      memoryId: params.memoryId,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      attempts: 0
    });
  }
}

async function processJob() {
  const job = await dbGraphJobs.findOne(
    { status: { $in: ['pending', 'error'] } },
    { sort: { updatedAt: 1 } }
  );

  if (!job) {
    return;
  }

  if (job.status === 'error' && (job.attempts ?? 0) >= MAX_ATTEMPTS) {
    return;
  }

  const start = now();
  await dbGraphJobs.updateOne(
    { _id: job._id },
    {
      $set: { status: 'running', updatedAt: start },
      $inc: { attempts: 1 }
    }
  );

  try {
    const memory = await dbMemories.findById(new ObjectId(job.memoryId));
    if (!memory) {
      throw new Error('Associated memory no longer exists');
    }

    const content = memory.content ?? '';
    const entities = extractEntities(content);
    if (Array.isArray(memory.tags)) {
      for (const tag of memory.tags) {
        if (tag) {
          entities.push(`#${tag}`);
        }
      }
    }

    const uniqueEntities = Array.from(new Set(entities));

    if (uniqueEntities.length > 0) {
      const memoryId = job.memoryId;
      for (const entity of uniqueEntities) {
        const existingEntity = await dbGraphEntities.findOne({
          orgId: job.orgId,
          projectId: job.projectId,
          entity
        });

        if (existingEntity) {
          await dbGraphEntities.updateOne(
            { _id: existingEntity._id },
            {
              $addToSet: { memoryIds: memoryId },
              $set: { lastSeenAt: now() }
            }
          );
        } else {
          await dbGraphEntities.insertOne({
            orgId: job.orgId,
            projectId: job.projectId,
            entity,
            memoryIds: [memoryId],
            lastSeenAt: now()
          });
        }
      }
    }

    await dbGraphJobs.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'success',
          updatedAt: now(),
          error: undefined
        }
      }
    );
  } catch (error) {
    await dbGraphJobs.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'error',
          updatedAt: now(),
          error: error instanceof Error ? error.message : String(error)
        }
      }
    );
  }
}

export function startGraphWorker() {
  if (workerStarted) {
    return;
  }
  workerStarted = true;
  setInterval(() => {
    processJob().catch((error) => {
      console.error('[CapsuleGraph] Worker error:', error);
    });
  }, WORKER_INTERVAL_MS).unref?.();
}

export async function expandResultsViaGraph(params: {
  orgId: string;
  projectId: string;
  baseMemoryIds: string[];
  excludeIds: Set<string>;
  limit: number;
}) {
  const entities = await dbGraphEntities.fetch(
    {
      orgId: params.orgId,
      projectId: params.projectId,
      memoryIds: { $in: params.baseMemoryIds }
    },
    { limit: 50 }
  );

  const relatedIds = new Set<string>();
  for (const entity of entities) {
    for (const memoryId of entity.memoryIds) {
      if (!params.excludeIds.has(memoryId)) {
        relatedIds.add(memoryId);
        if (relatedIds.size >= params.limit) {
          break;
        }
      }
    }
    if (relatedIds.size >= params.limit) {
      break;
    }
  }

  if (relatedIds.size === 0) {
    return [];
  }

  const docs = await dbMemories.fetch(
    {
      _id: { $in: Array.from(relatedIds).map((id) => new ObjectId(id)) }
    },
    { limit: params.limit }
  );

  return docs;
}
