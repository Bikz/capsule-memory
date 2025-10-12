export class CapsuleMemoryError extends Error {
    constructor(message, status, details) {
        super(message);
        this.name = 'CapsuleMemoryError';
        this.status = status;
        this.details = details;
    }
}
function toIsoString(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return undefined;
}
export class CapsuleMemoryClient {
    constructor(options) {
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
        this.fetchImpl = options.fetchImplementation ?? globalThis.fetch?.bind(globalThis);
        if (typeof this.fetchImpl !== 'function') {
            throw new Error('No fetch implementation available. Provide fetchImplementation in options.');
        }
    }
    resolveSubject(subjectId) {
        const resolved = subjectId ?? this.defaultSubjectId;
        if (!resolved) {
            throw new Error('subjectId is required but was not provided.');
        }
        return resolved;
    }
    buildHeaders(subjectId, additional) {
        return {
            'Content-Type': 'application/json',
            'X-Capsule-Key': this.apiKey,
            'X-Capsule-Org': this.orgId,
            'X-Capsule-Project': this.projectId,
            'X-Capsule-Subject': subjectId,
            ...Object.fromEntries(Object.entries(additional ?? {}).filter(([, value]) => value !== undefined))
        };
    }
    buildUrl(path, query) {
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
    async request(input, init) {
        const response = await this.fetchImpl(input, init);
        const contentType = response.headers.get('content-type') ?? '';
        const isJson = contentType.includes('application/json');
        const body = isJson ? await response.json().catch(() => null) : await response.text();
        if (!response.ok) {
            const message = body && typeof body === 'object' && 'error' in body
                ? String(body.error)
                : response.statusText || 'Request failed';
            throw new CapsuleMemoryError(message, response.status, body ?? undefined);
        }
        return (body ?? undefined);
    }
    async storeMemory(input) {
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
        const result = await this.request(this.buildUrl('/v1/memories'), {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        return {
            ...result,
            expiresAt: toIsoString(result.expiresAt) ?? null
        };
    }
    async listMemories(input = {}) {
        const subjectId = this.resolveSubject(input.subjectId);
        const headers = this.buildHeaders(subjectId);
        const query = {
            limit: input.limit ? String(input.limit) : undefined,
            pinned: typeof input.pinned === 'boolean' ? (input.pinned ? 'true' : 'false') : undefined,
            tag: input.tag
        };
        const result = await this.request(this.buildUrl('/v1/memories', query), {
            method: 'GET',
            headers
        });
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
    async searchMemories(input) {
        const subjectId = this.resolveSubject(input.subjectId);
        const headers = this.buildHeaders(subjectId);
        const payload = {
            query: input.query,
            limit: input.limit
        };
        const result = await this.request(this.buildUrl('/v1/memories/search'), {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
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
    async pinMemory(input) {
        const subjectId = this.resolveSubject(input.subjectId);
        const headers = this.buildHeaders(subjectId);
        const result = await this.request(this.buildUrl(`/v1/memories/${encodeURIComponent(input.id)}`), {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ pinned: input.pin })
        });
        return result;
    }
    async deleteMemory(input) {
        const subjectId = this.resolveSubject(input.subjectId);
        const headers = this.buildHeaders(subjectId);
        return this.request(this.buildUrl(`/v1/memories/${encodeURIComponent(input.id)}`), {
            method: 'DELETE',
            headers,
            body: JSON.stringify({ reason: input.reason })
        });
    }
}
