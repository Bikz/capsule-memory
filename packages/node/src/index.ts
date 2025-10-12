export type MemoryRecord = {
  id: string;
  orgId: string;
  projectId: string;
  subjectId: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  tags?: string[];
  expiresAt?: string | null;
};

export type StoreMemoryResponse = MemoryRecord & {
  explanation: string;
  forgottenMemoryId: string | null;
};

export type ListMemoriesResponse = {
  explanation: string;
  items: MemoryRecord[];
};

export type SearchMemoriesResponse = {
  query: string;
  explanation: string;
  results: (MemoryRecord & { score?: number })[];
};

export type UpdateMemoryResponse = {
  success: boolean;
  explanation: string;
  pinned?: boolean;
};

export type DeleteMemoryResponse = {
  success: boolean;
  explanation: string;
};

export type StoreMemoryInput = {
  content: string;
  pinned?: boolean;
  tags?: string[];
  ttlSeconds?: number;
  idempotencyKey?: string;
  subjectId?: string;
};

export type SearchMemoriesInput = {
  query: string;
  limit?: number;
  subjectId?: string;
};

export type ListMemoriesInput = {
  limit?: number;
  subjectId?: string;
  pinned?: boolean;
  tag?: string;
};

export type PinMemoryInput = {
  id: string;
  pin?: boolean;
  subjectId?: string;
};

export type DeleteMemoryInput = {
  id: string;
  subjectId?: string;
  reason?: string;
};

export type CapsuleMemoryClientOptions = {
  baseUrl: string;
  apiKey: string;
  orgId: string;
  projectId: string;
  defaultSubjectId?: string;
  fetchImplementation?: typeof fetch;
};

export class CapsuleMemoryError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'CapsuleMemoryError';
    this.status = status;
    this.details = details;
  }
}

function toIsoString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return undefined;
}

export class CapsuleMemoryClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly orgId: string;
  private readonly projectId: string;
  private readonly defaultSubjectId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CapsuleMemoryClientOptions) {
    if (!options.baseUrl) {
      throw new Error('baseUrl is required');
    }
    if (!options.apiKey) {
      throw new Error('apiKey is required');
    }
    if (!options.orgId) {
      throw new Error('orgId is required');
    }
    if (!options.projectId) {
      throw new Error('projectId is required');
    }

    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.orgId = options.orgId;
    this.projectId = options.projectId;
    this.defaultSubjectId = options.defaultSubjectId ?? 'default-subject';
    this.fetchImpl = options.fetchImplementation ?? (globalThis.fetch?.bind(globalThis) as typeof fetch);

    if (typeof this.fetchImpl !== 'function') {
      throw new Error('No fetch implementation available. Provide fetchImplementation in options.');
    }
  }

  private resolveSubject(subjectId?: string): string {
    const resolved = subjectId ?? this.defaultSubjectId;
    if (!resolved) {
      throw new Error('subjectId is required but was not provided.');
    }
    return resolved;
  }

  private buildHeaders(subjectId: string, additional?: Record<string, string | undefined>): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-Capsule-Key': this.apiKey,
      'X-Capsule-Org': this.orgId,
      'X-Capsule-Project': this.projectId,
      'X-Capsule-Subject': subjectId,
      ...Object.fromEntries(
        Object.entries(additional ?? {}).filter(([, value]) => value !== undefined)
      )
    };
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  private async request<T>(input: RequestInfo | URL, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(input, init);
    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const body = isJson ? await response.json().catch(() => null) : await response.text();

    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error?: unknown }).error)
          : response.statusText || 'Request failed';
      throw new CapsuleMemoryError(message, response.status, body ?? undefined);
    }

    return (body ?? undefined) as T;
  }

  async storeMemory(input: StoreMemoryInput): Promise<StoreMemoryResponse> {
    const subjectId = this.resolveSubject(input.subjectId);
    const headers = this.buildHeaders(subjectId, {
      'Idempotency-Key': input.idempotencyKey
    });

    const payload = {
      content: input.content,
      pinned: input.pinned,
      tags: input.tags,
      ttlSeconds: input.ttlSeconds
    };

    const result = await this.request<StoreMemoryResponse>(
      this.buildUrl('/v1/memories'),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      }
    );

    return {
      ...result,
      expiresAt: toIsoString(result.expiresAt) ?? null
    };
  }

  async listMemories(input: ListMemoriesInput = {}): Promise<ListMemoriesResponse> {
    const subjectId = this.resolveSubject(input.subjectId);
    const headers = this.buildHeaders(subjectId);

    const query: Record<string, string | undefined> = {
      limit: input.limit ? String(input.limit) : undefined,
      pinned:
        typeof input.pinned === 'boolean' ? (input.pinned ? 'true' : 'false') : undefined,
      tag: input.tag
    };

    const result = await this.request<ListMemoriesResponse>(
      this.buildUrl('/v1/memories', query),
      {
        method: 'GET',
        headers
      }
    );

    return {
      explanation: result.explanation,
      items: Array.isArray(result.items)
        ? result.items.map((item) => ({
            ...item,
            expiresAt: toIsoString(item.expiresAt) ?? null
          }))
        : []
    };
  }

  async searchMemories(input: SearchMemoriesInput): Promise<SearchMemoriesResponse> {
    const subjectId = this.resolveSubject(input.subjectId);
    const headers = this.buildHeaders(subjectId);

    const payload = {
      query: input.query,
      limit: input.limit
    };

    const result = await this.request<SearchMemoriesResponse>(
      this.buildUrl('/v1/memories/search'),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      }
    );

    const results = Array.isArray(result.results)
      ? result.results.map((item) => ({
          ...item,
          expiresAt: toIsoString(item.expiresAt) ?? null
        }))
      : [];

    return {
      query: result.query,
      explanation: result.explanation,
      results
    };
  }

  async pinMemory(input: PinMemoryInput): Promise<UpdateMemoryResponse> {
    const subjectId = this.resolveSubject(input.subjectId);
    const headers = this.buildHeaders(subjectId);

    const result = await this.request<UpdateMemoryResponse>(
      this.buildUrl(`/v1/memories/${encodeURIComponent(input.id)}`),
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ pinned: input.pin })
      }
    );

    return result;
  }

  async deleteMemory(input: DeleteMemoryInput): Promise<DeleteMemoryResponse> {
    const subjectId = this.resolveSubject(input.subjectId);
    const headers = this.buildHeaders(subjectId);

    return this.request<DeleteMemoryResponse>(
      this.buildUrl(`/v1/memories/${encodeURIComponent(input.id)}`),
      {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ reason: input.reason })
      }
    );
  }
}
