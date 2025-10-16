import { Store, schema } from 'modelence/server';
import type { ModelSchema } from 'modelence/server';

export type CaptureStatus = 'pending' | 'approved' | 'rejected' | 'ignored';

const memoryCandidateSchema: ModelSchema = {
  orgId: schema.string(),
  projectId: schema.string(),
  subjectId: schema.string(),
  eventId: schema.string().optional(),
  role: schema.string(),
  content: schema.string(),
  metadata: schema.object({}).optional(),
  score: schema.number(),
  threshold: schema.number(),
  recommended: schema.boolean(),
  category: schema.string(),
  reasons: schema.array(schema.string()),
  status: schema.enum(['pending', 'approved', 'rejected', 'ignored']),
  autoAccepted: schema.boolean().optional(),
  autoDecisionReason: schema.string().optional(),
  memoryId: schema.string().optional(),
  createdAt: schema.date(),
  updatedAt: schema.date()
};

type MemoryCandidateSchema = typeof memoryCandidateSchema;

export const dbMemoryCandidates: Store<MemoryCandidateSchema, Record<string, never>> = new Store(
  'memory_candidates',
  {
    schema: memoryCandidateSchema,
    indexes: [
      { key: { orgId: 1, projectId: 1, subjectId: 1, status: 1, createdAt: -1 } },
      { key: { status: 1, createdAt: -1 } },
      { key: { createdAt: -1 } }
    ]
  }
);
