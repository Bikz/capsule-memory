import type { CapsuleMeta } from '@capsule/core';

export type { CapsuleMeta };

export const CapsuleMetaJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'CapsuleMeta',
  type: 'object',
  required: ['id', 'createdAt'],
  properties: {
    id: { type: 'string' },
    org: { type: 'string' },
    project: { type: 'string' },
    subject: { type: 'string' },
    type: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' }
  }
} as const;
