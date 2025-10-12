function trimBase(url) {
    return url.replace(/\/+$/, "");
}
export class CapsuleMemoryClient {
    #base;
    #apiKey;
    #org;
    #project;
    #subject;
    #fetch;
    constructor(opts) {
        this.#base = trimBase(opts.baseUrl);
        this.#apiKey = opts.apiKey;
        this.#org = opts.orgId;
        this.#project = opts.projectId;
        this.#subject = opts.defaultSubjectId;
        this.#fetch = opts.fetchImpl ?? globalThis.fetch;
        if (!this.#fetch) {
            throw new Error("No fetch implementation found. Use Node >=18 or pass fetchImpl.");
        }
    }
    headers(subjectId) {
        return {
            "Content-Type": "application/json",
            "X-Capsule-Key": this.#apiKey,
            "X-Capsule-Org": this.#org,
            "X-Capsule-Project": this.#project,
            "X-Capsule-Subject": subjectId ?? this.#subject
        };
    }
    async request(path, init) {
        const url = `${this.#base}${path.startsWith("/") ? path : `/${path}`}`;
        const res = await this.#fetch(url, {
            method: init?.method ?? "GET",
            headers: { ...this.headers(init?.subjectId), ...init?.headers },
            body: init?.body
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(text || `HTTP ${res.status}`);
        }
        const payload = text ? JSON.parse(text) : {};
        return ("data" in payload ? payload.data : payload);
    }
    async storeMemory(input) {
        return this.request("/v1/memories", {
            method: "POST",
            body: JSON.stringify({
                content: input.content,
                pinned: input.pinned,
                tags: input.tags,
                ttlSeconds: input.ttlSeconds,
                idempotencyKey: input.idempotencyKey
            }),
            subjectId: input.subjectId
        });
    }
    async listMemories(input = {}) {
        const params = new URLSearchParams();
        if (input.limit)
            params.set("limit", String(input.limit));
        if (typeof input.pinned === "boolean")
            params.set("pinned", String(input.pinned));
        if (input.tag)
            params.set("tag", input.tag);
        if (input.subjectId)
            params.set("subjectId", input.subjectId);
        const qs = params.toString() ? `?${params.toString()}` : "";
        return this.request(`/v1/memories${qs}`, { method: "GET", subjectId: input.subjectId });
    }
    async search(input) {
        return this.request("/v1/memories/search", {
            method: "POST",
            body: JSON.stringify({ query: input.query, limit: input.limit }),
            subjectId: input.subjectId
        });
    }
    async updateMemory(input) {
        return this.request(`/v1/memories/${encodeURIComponent(input.id)}`, {
            method: "PATCH",
            body: JSON.stringify({
                pinned: input.pinned,
                tags: input.tags,
                ttlSeconds: input.ttlSeconds
            }),
            subjectId: input.subjectId
        });
    }
    async deleteMemory(input) {
        return this.request(`/v1/memories/${encodeURIComponent(input.id)}`, {
            method: "DELETE",
            body: JSON.stringify({ reason: input.reason }),
            subjectId: input.subjectId
        });
    }
}
//# sourceMappingURL=index.js.map