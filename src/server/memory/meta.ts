export type CapsuleVisibility = 'private' | 'shared' | 'public';

export type StorageDestination = 'short_term' | 'long_term' | 'capsule_graph';

export type CapsuleAcl = {
  visibility: CapsuleVisibility;
  subjects?: string[];
};

export type CapsuleSource = {
  app?: string;
  connector?: string;
  url?: string;
  fileId?: string;
  spanId?: string;
};

export type CapsuleProvenanceEvent = {
  event: string;
  at: Date;
  actor?: string;
  description?: string;
  referenceId?: string;
};

export type CapsulePiiFlags = Record<string, boolean>;

export type CapsuleStorageState = {
  store: StorageDestination;
  policies: string[];
  graphEnrich?: boolean;
  dedupeThreshold?: number;
};

export type CapsuleMetadataInput = {
  type?: string;
  importanceScore?: number;
  recencyScore?: number;
  lang?: string;
  source?: CapsuleSource | null;
  acl?: CapsuleAcl | null;
  piiFlags?: CapsulePiiFlags | null;
};

const LANGUAGE_FALLBACK = 'und';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveLanguage(content: string, provided?: string | null): string {
  const normalized = provided?.trim().toLowerCase();
  if (normalized) {
    return normalized;
  }

  if (!content) {
    return LANGUAGE_FALLBACK;
  }

  const asciiMatches = content.match(/[A-Za-z0-9\s,\.\?\!\-\(\)'\"]+/g);
  const asciiLength = asciiMatches?.join('').length ?? 0;
  const ratio = asciiLength / content.length;

  if (ratio >= 0.75) {
    return 'en';
  }

  return LANGUAGE_FALLBACK;
}

export function resolveTypeValue(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function resolveSource(source?: CapsuleSource | null): CapsuleSource | undefined {
  if (!source) {
    return undefined;
  }
  const sanitized: CapsuleSource = {};
  for (const key of ['app', 'connector', 'url', 'fileId', 'spanId'] as const) {
    const incoming = source[key];
    if (typeof incoming === 'string') {
      const value = incoming.trim();
      if (value) {
        sanitized[key] = value;
      }
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeSubjects(subjects?: string[] | null, ownerSubjectId?: string): string[] | undefined {
  if (!Array.isArray(subjects)) {
    return ownerSubjectId ? [ownerSubjectId] : undefined;
  }
  const cleaned = Array.from(
    new Set(subjects.map((subject) => subject?.trim()).filter((value): value is string => Boolean(value)))
  );
  if (cleaned.length === 0) {
    return ownerSubjectId ? [ownerSubjectId] : undefined;
  }
  return cleaned;
}

export function resolveAcl(acl?: CapsuleAcl | null, ownerSubjectId?: string): CapsuleAcl {
  const visibility: CapsuleVisibility = acl?.visibility ?? 'private';

  if (visibility === 'private') {
    return {
      visibility,
      subjects: sanitizeSubjects(acl?.subjects, ownerSubjectId)
    };
  }

  if (visibility === 'shared') {
    const subjects = Array.isArray(acl?.subjects)
      ? Array.from(new Set(acl.subjects.filter((value) => typeof value === 'string' && value.trim().length > 0)))
      : undefined;
    return {
      visibility,
      subjects: subjects && subjects.length > 0 ? subjects : undefined
    };
  }

  return { visibility: 'public' };
}

export function resolvePiiFlags(piiFlags?: CapsulePiiFlags | null): CapsulePiiFlags | undefined {
  if (!piiFlags) {
    return undefined;
  }
  const result: CapsulePiiFlags = {};
  for (const [key, value] of Object.entries(piiFlags)) {
    if (typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function computeImportanceScore(pinned?: boolean, provided?: number): number {
  if (typeof provided === 'number' && Number.isFinite(provided)) {
    return clamp(provided, 0, 5);
  }
  return pinned ? 1.5 : 1;
}

export function computeRecencyScore(provided?: number): number {
  if (typeof provided === 'number' && Number.isFinite(provided)) {
    return clamp(provided, 0, 5);
  }
  return 1;
}

export function createProvenanceEvent(params: {
  event: string;
  actor?: string;
  description?: string;
  referenceId?: string;
  timestamp?: Date;
}): CapsuleProvenanceEvent {
  return {
    event: params.event,
    at: params.timestamp ?? new Date(),
    ...(params.actor ? { actor: params.actor } : {}),
    ...(params.description ? { description: params.description } : {}),
    ...(params.referenceId ? { referenceId: params.referenceId } : {})
  };
}
